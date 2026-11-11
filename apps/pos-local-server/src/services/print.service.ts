/**
 * Gusto POS Local Server — Printer Transport & Queuing
 *
 * Sends ESC/POS buffers to thermal printers (Network, System, Device).
 * Includes resilient offline queuing using the SQLite print_queue table.
 */

import { spawn } from "node:child_process";
import { createConnection } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { unlink, writeFile } from "node:fs/promises";
import { v4 as uuid } from "uuid";
import { eq, and, asc, inArray, lt } from "drizzle-orm";
import { renderToConsole, renderToEscPos, generateCashDrawerKick, type ReceiptLine } from "@gusto/printer";
import * as schema from "@gusto/db-schema/local";
import { db } from "../db/index.js";
import { afterCommit } from "../db/tx.js";

/**
 * Which printer a job goes to:
 *  - "pos"      billing counter printer (POS_BILL_PRINTER_*)
 *  - "captain"  floor / WiFi printer (CAPTAIN_BILL_PRINTER_*)
 *  - "kitchen"  kitchen ticket printer (KITCHEN_PRINTER_*), falls back to "pos"
 */
export type PrintSource = "pos" | "captain" | "kitchen";
export type PrintTransport = "preview" | "network" | "system" | "device";
export type PrintTemplateType = "BILL" | "KOT" | "SHIFT_REPORT";

export interface PrintResult {
  transport: PrintTransport;
  destination: string;
}

interface PrinterConfig {
  transport: PrintTransport;
  host?: string;
  port: number;
  queue?: string;
  device?: string;
}

// ─── Queuing & Retry Logic ───

let retryIntervalHandle: ReturnType<typeof setInterval> | null = null;
let isRetrying = false;

/** A kitchen ticket that could not print within this window is no longer useful. */
const KOT_JOB_MAX_AGE_MS = Number(process.env.KOT_PRINT_MAX_AGE_MINUTES ?? 20) * 60_000;
/** Bills / reports are worth printing late, but not days late. */
const JOB_MAX_AGE_MS = 12 * 3_600_000;
const FINISHED_JOB_RETENTION_DAYS = 3;

/**
 * Queue a print job and attempt to print it immediately.
 * If the printer is offline/unreachable, it remains in the queue for the retry loop.
 *
 * The job row is written in the caller's transaction; the physical print is
 * only attempted once that transaction commits, so a rolled-back order can
 * never produce paper.
 */
export function queuePrint(
  template: ReceiptLine[],
  templateType: PrintTemplateType,
  source: PrintSource = "pos"
): Promise<void> {
  const jobId = uuid();
  const now = new Date().toISOString();

  db.insert(schema.printQueue)
    .values({
      id: jobId,
      templateType,
      templateData: JSON.stringify(template),
      printerTarget: source,
      status: "PENDING",
      createdAt: now,
    })
    .run();

  return new Promise<void>((resolve) => {
    afterCommit(() => {
      executePrintJob(jobId, template, source)
        .catch(() => {
          console.warn(`[Printer] ⚠️ Immediate print failed for job ${jobId}. Queued for retry.`);
        })
        .finally(resolve);
    });
  });
}

/** True when new KOTs should also be printed on paper (kitchen printer configured or forced). */
export function isKotPrintingEnabled(): boolean {
  const flag = process.env.KOT_AUTO_PRINT?.toLowerCase();
  if (flag === "true") return true;
  if (flag === "false") return false;
  return Boolean(
    process.env.KITCHEN_PRINTER_HOST || process.env.KITCHEN_PRINTER_QUEUE || process.env.KITCHEN_PRINTER_DEVICE
  );
}

/**
 * Jobs left in PRINTING belong to a previous process that died mid-print.
 * Put them back in the queue on startup.
 */
export function recoverInterruptedPrintJobs(): number {
  return db
    .update(schema.printQueue)
    .set({ status: "PENDING" })
    .where(eq(schema.printQueue.status, "PRINTING"))
    .run().changes;
}

/** Give up on jobs that are too old to be useful and delete finished history. */
export function prunePrintQueue(): number {
  const now = Date.now();
  const expired = db
    .update(schema.printQueue)
    .set({ status: "EXPIRED", errorMessage: "Printer was unavailable for too long" })
    .where(
      and(
        inArray(schema.printQueue.status, ["PENDING", "FAILED"]),
        lt(schema.printQueue.createdAt, new Date(now - JOB_MAX_AGE_MS).toISOString())
      )
    )
    .run().changes;

  const deleted = db
    .delete(schema.printQueue)
    .where(
      and(
        inArray(schema.printQueue.status, ["COMPLETED", "EXPIRED"]),
        lt(schema.printQueue.createdAt, new Date(now - FINISHED_JOB_RETENTION_DAYS * 86_400_000).toISOString())
      )
    )
    .run().changes;

  return expired + deleted;
}

/**
 * Executes a single print job. Updates the DB status to COMPLETED or FAILED.
 */
async function executePrintJob(
  jobId: string,
  template: ReceiptLine[],
  source: PrintSource
): Promise<void> {
  try {
    // Mark as PRINTING
    db.update(schema.printQueue)
      .set({ status: "PRINTING" })
      .where(eq(schema.printQueue.id, jobId))
      .run();

    // Perform actual print transport
    await printBillTemplate(template, source);

    // Mark COMPLETED
    db.update(schema.printQueue)
      .set({ status: "COMPLETED", completedAt: new Date().toISOString() })
      .where(eq(schema.printQueue.id, jobId))
      .run();
  } catch (err) {
    const errorMsg = err instanceof Error ? err.message : String(err);
    
    // Increment retry count and mark FAILED
    const job = db.select().from(schema.printQueue).where(eq(schema.printQueue.id, jobId)).get();
    if (job) {
      db.update(schema.printQueue)
        .set({
          status: "FAILED",
          retryCount: job.retryCount + 1,
          errorMessage: errorMsg,
        })
        .where(eq(schema.printQueue.id, jobId))
        .run();
    }
    throw err;
  }
}

/**
 * Polls the print_queue for FAILED or PENDING jobs and retries them.
 */
export async function retryFailedPrints(): Promise<void> {
  if (isRetrying) return;
  isRetrying = true;

  try {
    // A kitchen ticket printed long after it was fired only causes confusion
    // (the KDS already showed it) — expire those instead of printing them late.
    db.update(schema.printQueue)
      .set({ status: "EXPIRED", errorMessage: "Kitchen ticket expired before the printer came back" })
      .where(
        and(
          inArray(schema.printQueue.status, ["PENDING", "FAILED"]),
          eq(schema.printQueue.templateType, "KOT"),
          lt(schema.printQueue.createdAt, new Date(Date.now() - KOT_JOB_MAX_AGE_MS).toISOString())
        )
      )
      .run();

    // Find all PENDING or FAILED jobs that haven't exceeded maxRetries
    const jobs = db
      .select()
      .from(schema.printQueue)
      .where(inArray(schema.printQueue.status, ["PENDING", "FAILED"]))
      .orderBy(asc(schema.printQueue.createdAt))
      .all()
      .filter((j) => j.retryCount < j.maxRetries);

    if (jobs.length > 0) {
      console.log(`[Printer] Retrying ${jobs.length} queued print job(s)...`);
      
      for (const job of jobs) {
        try {
          const template = JSON.parse(job.templateData) as ReceiptLine[];
          await executePrintJob(job.id, template, job.printerTarget as PrintSource);
          console.log(`[Printer] ✅ Successfully recovered print job ${job.id}`);
        } catch (err) {
          console.error(`[Printer] ❌ Retry failed for job ${job.id}:`, err instanceof Error ? err.message : err);
        }
      }
    }
  } finally {
    isRetrying = false;
  }
}

/**
 * Start the background print retry poller (e.g. every 30 seconds).
 */
export function startPrintRetryLoop(intervalMs = 30_000): void {
  if (retryIntervalHandle) return;
  const recovered = recoverInterruptedPrintJobs();
  if (recovered > 0) console.log(`[Printer] Requeued ${recovered} print job(s) interrupted by the last shutdown`);
  console.log(`[Printer] Starting offline print retry loop (interval: ${intervalMs / 1000}s)`);
  
  retryIntervalHandle = setInterval(() => {
    retryFailedPrints().catch((err) => console.error("[Printer] Retry loop error:", err));
  }, intervalMs);
}

/**
 * Stop the print retry loop.
 */
export function stopPrintRetryLoop(): void {
  if (retryIntervalHandle) {
    clearInterval(retryIntervalHandle);
    retryIntervalHandle = null;
  }
}

/**
 * Get current print queue statistics for the POS UI.
 */
export function getPrintQueueStatus() {
  const jobs = db
    .select({ status: schema.printQueue.status, retryCount: schema.printQueue.retryCount, maxRetries: schema.printQueue.maxRetries })
    .from(schema.printQueue)
    .all();

  return {
    pending: jobs.filter((j) => j.status === "PENDING").length,
    printing: jobs.filter((j) => j.status === "PRINTING").length,
    failed: jobs.filter((j) => j.status === "FAILED").length,
    /** Failed jobs that used up their automatic retries — need a manual retry */
    stuck: jobs.filter((j) => j.status === "FAILED" && j.retryCount >= j.maxRetries).length,
    expired: jobs.filter((j) => j.status === "EXPIRED").length,
    completed: jobs.filter((j) => j.status === "COMPLETED").length,
  };
}

/** Manual retry from the POS: give exhausted jobs a fresh set of attempts, then run the queue. */
export async function retryAllFailedPrints(): Promise<void> {
  db.update(schema.printQueue).set({ retryCount: 0 }).where(eq(schema.printQueue.status, "FAILED")).run();
  await retryFailedPrints();
}

// ─── Transport Implementation ───

function readEnv(source: PrintSource, key: string): string | undefined {
  if (source === "kitchen") {
    // Dedicated kitchen printer, else share the billing counter printer
    return (
      process.env[`KITCHEN_PRINTER_${key}`] ||
      process.env[`POS_BILL_PRINTER_${key}`] ||
      process.env[`BILL_PRINTER_${key}`]
    );
  }
  const prefix = source === "captain" ? "CAPTAIN" : "POS";
  return process.env[`${prefix}_BILL_PRINTER_${key}`] || process.env[`BILL_PRINTER_${key}`];
}

function getPrinterConfig(source: PrintSource): PrinterConfig {
  const requestedMode = readEnv(source, "MODE")?.toLowerCase();
  const host = readEnv(source, "HOST");
  const port = Number(readEnv(source, "PORT") || 9100);
  const queue = readEnv(source, "QUEUE");
  const device = readEnv(source, "DEVICE");

  let transport: PrintTransport;
  if (requestedMode === "network" || requestedMode === "system" || requestedMode === "device" || requestedMode === "preview") {
    transport = requestedMode;
  } else if (source === "captain" && host) {
    transport = "network";
  } else if (device) {
    transport = "device";
  } else if (queue) {
    transport = "system";
  } else if (host) {
    transport = "network";
  } else {
    transport = "preview";
  }

  return { transport, host, port, queue, device };
}

/**
 * Low-level print function (bypasses queue).
 * Use queuePrint() instead for normal usage.
 */
export async function printBillTemplate(
  template: ReceiptLine[],
  source: PrintSource = "pos"
): Promise<PrintResult> {
  const config = getPrinterConfig(source);
  const buffer = Buffer.from(renderToEscPos(template));

  if (config.transport === "network") {
    if (!config.host) throw new Error("Network printer host is not configured");
    await writeToNetworkPrinter(buffer, config.host, config.port);
    return { transport: "network", destination: `${config.host}:${config.port}` };
  }

  if (config.transport === "device") {
    if (!config.device) throw new Error("Cable printer device path is not configured");
    await writeFile(config.device, buffer);
    return { transport: "device", destination: config.device };
  }

  if (config.transport === "system") {
    await writeToSystemQueue(buffer, config.queue);
    return { transport: "system", destination: config.queue || "default printer" };
  }

  // Preview / Console fallback
  console.log(renderToConsole(template));
  return { transport: "preview", destination: "console" };
}

/**
 * Triggers the hardware cash drawer via printer kick command.
 */
export async function triggerCashDrawer(source: PrintSource = "pos"): Promise<PrintResult> {
  const config = getPrinterConfig(source);
  const buffer = Buffer.from(generateCashDrawerKick());

  if (config.transport === "network") {
    if (!config.host) throw new Error("Network printer host is not configured");
    await writeToNetworkPrinter(buffer, config.host, config.port);
    return { transport: "network", destination: `${config.host}:${config.port}` };
  }

  if (config.transport === "device") {
    if (!config.device) throw new Error("Cable printer device path is not configured");
    await writeFile(config.device, buffer);
    return { transport: "device", destination: config.device };
  }

  if (config.transport === "system") {
    await writeToSystemQueue(buffer, config.queue);
    return { transport: "system", destination: config.queue || "default printer" };
  }

  console.log("[Cash Drawer] * KICK COMMAND SENT TO PREVIEW *");
  return { transport: "preview", destination: "console" };
}

function writeToNetworkPrinter(buffer: Buffer, host: string, port: number): Promise<void> {
  return new Promise((resolve, reject) => {
    let settled = false;
    const done = (err?: Error) => {
      if (settled) return;
      settled = true;
      if (err) reject(err);
      else resolve();
    };

    const socket = createConnection({ host, port, timeout: 5000 }, () => {
      socket.write(buffer, (err) => {
        if (err) {
          socket.destroy(err);
          return;
        }
        socket.end();
      });
    });

    socket.on("close", (hadError) => done(hadError ? new Error("Printer connection closed with an error") : undefined));
    socket.on("timeout", () => socket.destroy(new Error(`Printer ${host}:${port} timed out`)));
    socket.on("error", (err) => done(err));
  });
}

async function writeToSystemQueue(buffer: Buffer, queue?: string): Promise<void> {
  const tempPath = join(tmpdir(), `gusto-bill-${process.pid}-${Date.now()}.bin`);
  await writeFile(tempPath, buffer);

  try {
    if (process.platform === "win32") {
      const args = queue ? ["/c", "print", `/D:${queue}`, tempPath] : ["/c", "print", tempPath];
      await runCommand("cmd", args);
      return;
    }

    const lpArgs = ["-o", "raw"];
    if (queue) lpArgs.push("-d", queue);
    lpArgs.push(tempPath);

    try {
      await runCommand("lp", lpArgs);
    } catch {
      const lprArgs = ["-l"];
      if (queue) lprArgs.push("-P", queue);
      lprArgs.push(tempPath);
      await runCommand("lpr", lprArgs);
    }
  } finally {
    await unlink(tempPath).catch(() => undefined);
  }
}

function runCommand(command: string, args: string[]): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { stdio: ["ignore", "ignore", "pipe"] });
    let stderr = "";

    child.stderr.on("data", (chunk) => {
      stderr += chunk.toString();
    });

    child.on("error", reject);
    child.on("close", (code) => {
      if (code === 0) {
        resolve();
        return;
      }
      reject(new Error(stderr.trim() || `${command} exited with code ${code}`));
    });
  });
}

