/**
 * Gusto POS Local Server — Cloud Commands (ERP → POS)
 *
 * Applies edits made in the Cloud ERP to orders this POS owns. The ERP queues
 * them (GET /api/v1/sync/commands); we apply each locally, then acknowledge.
 * The resulting order snapshot is force-sent so the ERP always ends up showing
 * what the POS actually has — including when a command could not be applied
 * (e.g. the order was already paid).
 *
 * Supported:
 *   ORDER_COMMAND { action: "UPDATE", orderId, status?, notes? }
 *   ORDER_COMMAND { action: "DELETE", orderId }
 */

import { eq, and } from "drizzle-orm";
import { v4 as uuid } from "uuid";
import * as schema from "@gusto/db-schema/local";
import { db } from "../db/index.js";
import { cancelOrder } from "./order.service.js";
import { queueOrderSnapshot, suppressOrderSnapshot } from "./order-sync.service.js";
import { emitOrderUpdated, emitTableStatusChanged } from "../socket/events.js";

const OUTLET_ID = process.env.OUTLET_ID || "";
const API_GATEWAY_URL = process.env.API_GATEWAY_URL || "http://localhost:3001";
const POS_API_KEY = process.env.POS_API_KEY || "";
const CLOUD_SYNC_ENABLED = process.env.CLOUD_SYNC_ENABLED !== "false" && !!API_GATEWAY_URL;

const TERMINAL = ["COMPLETED", "CANCELLED", "MERGED"];
// Statuses the POS understands; SERVED has no POS equivalent and maps to READY.
const SETTABLE: Record<string, string> = {
  DRAFT: "DRAFT",
  PLACED: "PLACED",
  IN_PROGRESS: "IN_PROGRESS",
  READY: "READY",
  SERVED: "READY",
};

interface CloudCommand {
  id: string;
  eventType: string;
  payload: {
    action?: "UPDATE" | "DELETE";
    orderId?: string;
    orderNumber?: string;
    status?: string;
    notes?: string | null;
  } | null;
}

let isPulling = false;

function headers(): Record<string, string> {
  const h: Record<string, string> = { "Content-Type": "application/json" };
  if (POS_API_KEY) h["X-POS-API-Key"] = POS_API_KEY;
  return h;
}

function logEvent(orderId: string, eventType: string, payload: Record<string, unknown>) {
  db.insert(schema.eventLog)
    .values({
      id: uuid(),
      orderId,
      eventType,
      payload: JSON.stringify(payload),
      userId: "cloud-erp",
      createdAt: new Date().toISOString(),
    })
    .run();
}

/**
 * Cancel an open order. Uses the normal cancel flow (releases the table, syncs);
 * falls back to a direct cancel when that refuses (e.g. outside the edit window).
 */
function cancelOpenOrder(orderId: string): void {
  try {
    cancelOrder(orderId, "cloud-erp");
    return;
  } catch (err) {
    console.warn(`[CloudCommands] Standard cancel refused (${err instanceof Error ? err.message : err}); cancelling directly`);
  }

  const order = db.select().from(schema.orders).where(eq(schema.orders.id, orderId)).get();
  if (!order) return;
  const now = new Date().toISOString();
  db.update(schema.orders).set({ status: "CANCELLED", updatedAt: now }).where(eq(schema.orders.id, orderId)).run();

  if (order.tableId) {
    const table = db.select().from(schema.diningTables).where(eq(schema.diningTables.id, order.tableId)).get();
    if (table?.currentOrderId === orderId) {
      db.update(schema.diningTables)
        .set({ status: "AVAILABLE", currentOrderId: null })
        .where(and(eq(schema.diningTables.id, table.id), eq(schema.diningTables.currentOrderId, orderId)))
        .run();
      emitTableStatusChanged({ tableId: table.id, tableName: table.name, status: "AVAILABLE" });
    }
  }
}

/** Apply one command. Returns a human-readable outcome; throws on failure. */
export function applyCloudCommand(cmd: CloudCommand): string {
  if (cmd.eventType !== "ORDER_COMMAND" || !cmd.payload?.orderId || !cmd.payload.action) {
    return "ignored: unsupported command";
  }
  const { action, orderId, status, notes } = cmd.payload;

  const order = db.select().from(schema.orders).where(eq(schema.orders.id, orderId)).get();
  if (!order) return "ignored: order not on this POS";
  const isOpen = !TERMINAL.includes(order.status);

  if (action === "DELETE") {
    if (isOpen) cancelOpenOrder(orderId);
    logEvent(orderId, "ERP_DELETED", { wasStatus: order.status });
    suppressOrderSnapshot(orderId);
    // (Any snapshot this triggers is a no-op: the current state is marked as pushed.)
    emitOrderUpdated({ type: "ERP_DELETED", orderId, orderNumber: order.orderNumber });
    return isOpen ? "cancelled and removed" : "removed from cloud sync";
  }

  // UPDATE
  const applied: string[] = [];
  if (notes !== undefined) {
    db.update(schema.orders)
      .set({ notes, updatedAt: new Date().toISOString() })
      .where(eq(schema.orders.id, orderId))
      .run();
    applied.push("notes");
  }

  if (status && status !== order.status) {
    if (!isOpen) {
      applied.push(`status ignored (order is ${order.status} on the POS)`);
    } else if (status === "CANCELLED") {
      cancelOpenOrder(orderId);
      applied.push("cancelled");
    } else if (SETTABLE[status]) {
      db.update(schema.orders)
        .set({ status: SETTABLE[status], updatedAt: new Date().toISOString() })
        .where(eq(schema.orders.id, orderId))
        .run();
      applied.push(`status ${SETTABLE[status]}`);
    } else {
      applied.push(`status ${status} not applicable on the POS`);
    }
  }

  logEvent(orderId, "ERP_UPDATED", { status, notes, applied });
  emitOrderUpdated({ type: "ERP_UPDATED", orderId, orderNumber: order.orderNumber });
  // Always re-send, so the ERP reflects the POS even when nothing changed locally
  queueOrderSnapshot(orderId, true);
  return applied.join(", ") || "no changes";
}

/**
 * Fetch pending ERP commands for this outlet, apply them and acknowledge.
 */
export async function pullCloudCommands(): Promise<number> {
  if (!CLOUD_SYNC_ENABLED || !OUTLET_ID || isPulling) return 0;
  isPulling = true;
  try {
    const res = await fetch(
      `${API_GATEWAY_URL}/api/v1/sync/commands?outletId=${encodeURIComponent(OUTLET_ID)}`,
      { headers: headers(), signal: AbortSignal.timeout(10_000) }
    );
    if (!res.ok) return 0;
    const body = (await res.json()) as { success: boolean; data?: CloudCommand[] };
    const commands = body.success && Array.isArray(body.data) ? body.data : [];
    if (commands.length === 0) return 0;

    const results = commands.map((cmd) => {
      try {
        const outcome = applyCloudCommand(cmd);
        console.log(`[CloudCommands] ${cmd.payload?.action ?? cmd.eventType} ${cmd.payload?.orderNumber ?? ""}: ${outcome}`);
        return { id: cmd.id, ok: true, message: outcome };
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        console.error(`[CloudCommands] Failed to apply ${cmd.id}:`, message);
        return { id: cmd.id, ok: false, message };
      }
    });

    await fetch(`${API_GATEWAY_URL}/api/v1/sync/commands/ack`, {
      method: "POST",
      headers: headers(),
      body: JSON.stringify({ outletId: OUTLET_ID, results }),
      signal: AbortSignal.timeout(10_000),
    });

    // Push the resulting snapshots right away
    import("./realtime-uplink.service.js").then(({ flushOutbox }) => flushOutbox()).catch(() => {});
    return commands.length;
  } catch {
    return 0; // cloud unreachable — retried on the next poll
  } finally {
    isPulling = false;
  }
}
