/**
 * Gusto Sync Worker
 *
 * Background job processor using BullMQ + Redis.
 * Handles:
 * - Offline POS data sync (Local SQLite → Cloud PostgreSQL)
 * - Recipe-based inventory deductions
 * - Zomato/Swiggy webhook processing
 * - Report generation
 */

import { Worker, Queue } from "bullmq";
import { Redis } from "ioredis";
import { eq, and, or, inArray, sql } from "drizzle-orm";
import { db, closeDb } from "./db.js";
import * as schema from "@gusto/db-schema/cloud";
import { reconcileInventoryForOrder } from "./handlers/inventory.handler.js";
import { processOrderSnapshot } from "./handlers/order-snapshot.handler.js";
import { isUuid, resolveDiningTable, resolveMenuItemId, DEFAULT_OUTLET_ID, DEFAULT_ORG_ID } from "./handlers/resolve.js";
import dotenv from "dotenv";
import * as Sentry from "@sentry/node";
import { nodeProfilingIntegration } from "@sentry/profiling-node";
import path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
dotenv.config({ path: path.resolve(__dirname, "../../../.env") });
dotenv.config();

const sentrySampleRate = Number(process.env.SENTRY_TRACES_SAMPLE_RATE ?? (process.env.NODE_ENV === "production" ? 0.1 : 1));
Sentry.init({
  dsn: process.env.SENTRY_DSN,
  enabled: Boolean(process.env.SENTRY_DSN),
  environment: process.env.NODE_ENV ?? "development",
  integrations: [
    nodeProfilingIntegration(),
  ],
  tracesSampleRate: Number.isFinite(sentrySampleRate) ? sentrySampleRate : 0.1,
  profilesSampleRate: Number.isFinite(sentrySampleRate) ? sentrySampleRate : 0.1,
});

const REDIS_URL = process.env.REDIS_URL ?? "redis://localhost:6379";
const CONCURRENCY = Number(process.env.SYNC_WORKER_CONCURRENCY ?? 5);

// Parse Redis URL into connection config for BullMQ
const redisUrl = new URL(REDIS_URL);
const connection = {
  host: redisUrl.hostname,
  port: Number(redisUrl.port) || 6379,
  username: redisUrl.username ? decodeURIComponent(redisUrl.username) : undefined,
  password: redisUrl.password ? decodeURIComponent(redisUrl.password) : undefined,
  tls: redisUrl.protocol === "rediss:" ? { rejectUnauthorized: false } : undefined,
  maxRetriesPerRequest: null,
};

// ─── PostgreSQL Error Code Helper ───
export function extractPgErrorCode(err: unknown): string | null {
  if (!err || typeof err !== "object") return null;
  const anyErr = err as any;
  if (typeof anyErr.code === "string") return anyErr.code;
  if (typeof anyErr.cause?.code === "string") return anyErr.cause.code;
  if (typeof anyErr.originalError?.code === "string") return anyErr.originalError.code;
  return null;
}

// ─── Startup Schema Assertion Check ───
/**
 * Verifies that the cloud database has migration 0002 applied (specifically column `order_mode` on `orders`).
 * If missing, aborts startup immediately before workers begin processing jobs,
 * preventing silent queue draining and repeated failed retries.
 */
export async function assertSchemaReady(): Promise<void> {
  console.log("[Startup] Checking database schema readiness (verifying Migration 0002 / order_mode)...");
  try {
    const result = await db.execute<{ column_name: string }>(sql`
      SELECT column_name
      FROM information_schema.columns
      WHERE table_schema = 'public'
        AND table_name = 'orders'
        AND column_name = 'order_mode'
      LIMIT 1;
    `);

    const rows = Array.isArray(result) ? result : (result as any)?.rows ?? [];
    const hasOrderMode = rows.length > 0;

    if (!hasOrderMode) {
      const errorLog = {
        level: "fatal",
        service: "sync-worker",
        event: "SCHEMA_ASSERTION_FAILED",
        missingMigration: "0002_oval_shiver_man",
        missingColumn: "orders.order_mode",
        pgCode: "42703",
        message:
          "Database schema is missing column 'order_mode' on table 'orders'. Migration 0002 has not been applied.",
        migrationHint:
          "Run: DATABASE_URL=<cloud_url> pnpm --filter @gusto/db-schema db:migrate",
        timestamp: new Date().toISOString(),
      };

      console.error(JSON.stringify(errorLog, null, 2));
      console.error(`
╔══════════════════════════════════════════════════════════════════════════════╗
║ 🛑 FATAL: Cloud Database Schema Incomplete — Startup Aborted                 ║
╠══════════════════════════════════════════════════════════════════════════════╣
║ Column "order_mode" does NOT exist on table "orders" (Migration 0002 missing)║
║ Worker is exiting immediately to protect BullMQ queue from being drained!    ║
║                                                                              ║
║ 💡 Primary Fix:                                                              ║
║ DATABASE_URL=<cloud_url> pnpm --filter @gusto/db-schema db:migrate          ║
╚══════════════════════════════════════════════════════════════════════════════╝
`);
      process.exit(1);
    }

    console.log("[Startup] ✅ Database schema assertion passed: column orders.order_mode (0002) is ready.");
  } catch (err) {
    const pgCode = extractPgErrorCode(err);
    const errorLog = {
      level: "fatal",
      service: "sync-worker",
      event: "SCHEMA_ASSERTION_ERROR",
      pgCode,
      message: err instanceof Error ? err.message : String(err),
      migrationHint:
        "Run: DATABASE_URL=<cloud_url> pnpm --filter @gusto/db-schema db:migrate",
      timestamp: new Date().toISOString(),
    };
    console.error(JSON.stringify(errorLog, null, 2));
    console.error("[Startup] 🛑 FATAL: Failed to query schema verification on database:", err);
    process.exit(1);
  }
}

// Ensure database schema is ready before workers are initialized
await assertSchemaReady();

// ─── Redis Pub/Sub ───
const pubClient = new Redis(REDIS_URL);
pubClient.on("error", (err) => console.error("[Redis PubClient Error]", err));

// ─── Queues ───

export const syncQueue = new Queue("pos-sync", { connection });
export const inventoryQueue = new Queue("inventory-deduction", {
  connection,
  defaultJobOptions: {
    attempts: 5,
    backoff: { type: "exponential", delay: 3000 },
    removeOnComplete: { age: 3600, count: 5000 },
    removeOnFail: { age: 7 * 24 * 3600, count: 5000 },
  },
});
export const webhookQueue = new Queue("webhook-processing", { connection });

/**
 * An order addressed by id AND organization. Every write goes through this, so
 * an event from one tenant can never touch another tenant's order even if it
 * names that order's id.
 */
const ownOrder = (orderId: string, organizationId: string) =>
  and(eq(schema.orders.id, orderId), eq(schema.orders.organizationId, organizationId));

/** Ask the inventory worker to bring stock in line with an order's current state. */
async function queueInventoryReconcile(orderId: string, orderNumber: string, organizationId: string, outletId: string) {
  await inventoryQueue.add("reconcile-order", { orderId, orderNumber, organizationId, outletId });
}

type OnlineOrderStatus = "ACCEPTED" | "REJECTED" | "READY_FOR_PICKUP";

/**
 * Record the outlet's decision on an aggregator order (scoped to the outlet's
 * organization) and tell the ERP.
 *
 * The aggregator itself is NOT called from here: Zomato / Swiggy order-status
 * APIs need partner credentials and an approved integration. Until that client
 * is added the status is recorded and surfaced in the ERP, and staff confirm
 * on the aggregator's own tablet as they do today.
 */
async function setOnlineOrderStatus(payload: any, status: OnlineOrderStatus): Promise<void> {
  const { onlineOrderId, organizationId, outletId, reason } = payload ?? {};
  if (!isUuid(onlineOrderId) || !isUuid(organizationId)) {
    console.warn(`[Sync] Online order ${status} ignored — missing online order id`);
    return;
  }

  const [updated] = await db
    .update(schema.onlineOrders)
    .set({ status, updatedAt: new Date() })
    .where(and(eq(schema.onlineOrders.id, onlineOrderId), eq(schema.onlineOrders.organizationId, organizationId)))
    .returning({ id: schema.onlineOrders.id, externalOrderId: schema.onlineOrders.externalOrderId, provider: schema.onlineOrders.provider });

  if (!updated) {
    console.warn(`[Sync] Online order ${onlineOrderId} not found for this organization`);
    return;
  }

  console.log(
    `[Sync] 🍔 ${updated.provider} order ${updated.externalOrderId} → ${status}` +
      (reason ? ` (${reason})` : "") +
      " — recorded in the ERP; confirm on the aggregator device (no partner API configured)"
  );
  pubClient
    .publish(
      "sync-events",
      JSON.stringify({
        eventType: "ONLINE_ORDER_STATUS",
        organizationId,
        outletId,
        payload: { onlineOrderId, externalOrderId: updated.externalOrderId, status, reason: reason ?? null },
      })
    )
    .catch((err) => console.error("[Sync] Pub/Sub Error:", err));
}

// ─── Sync Worker ───

const syncWorker = new Worker(
  "pos-sync",
  async (job) => {
    console.log(`[Sync] Processing job ${job.id}: ${job.name}`);
    const { eventType, payload, localTimestamp } = job.data as any;
    // Timestamps written to the cloud come from the POS clock so ORDER_SNAPSHOT
    // staleness checks compare like with like.
    const eventTime = localTimestamp && !Number.isNaN(new Date(localTimestamp).getTime())
      ? new Date(localTimestamp)
      : new Date();

    if (eventType === "ORDER_COMPLETED") {
      const {
        orderId,
        orderNumber,
        orderMode,
        tableId,
        tableName,
        outletId,
        organizationId,
        invoiceNumber,
        paymentMode,
        subtotal,
        discountAmount,
        taxAmount,
        totalAmount,
        items,
        completedAt,
      } = payload;

      const finalOutletId = outletId || "00000000-0000-0000-0000-000000000003";
      const finalOrgId = organizationId || "00000000-0000-0000-0000-000000000001";

      try {
        // Resolve local IDs to cloud IDs before writing (see ID Resolution Helpers)
        const resolvedTable = await resolveDiningTable(finalOutletId, tableId, tableName);
        const resolvedItems: any[] = [];
        const unresolvedItems: string[] = [];
        for (const i of (items ?? []) as any[]) {
          const cloudMenuItemId = await resolveMenuItemId(finalOutletId, i.menuItemId, i.menuItemName);
          if (cloudMenuItemId) {
            resolvedItems.push({ ...i, menuItemId: cloudMenuItemId });
          } else {
            unresolvedItems.push(`${i.quantity}x ${i.menuItemName ?? i.menuItemId}`);
          }
        }
        if (unresolvedItems.length > 0) {
          console.warn(
            `[Sync] ⚠️ Order ${orderNumber}: ${unresolvedItems.length} item(s) not found in cloud menu, ` +
            `recorded in order notes instead: ${unresolvedItems.join(", ")}`
          );
        }
        const unresolvedNote = unresolvedItems.length > 0
          ? `Unmapped POS items: ${unresolvedItems.join(", ")}`
          : undefined;

        await db.transaction(async (tx) => {
          const foreign = await tx.query.orders.findFirst({
            where: eq(schema.orders.id, orderId),
            columns: { organizationId: true },
          });
          if (foreign && foreign.organizationId !== finalOrgId) {
            throw new Error(`Order ${orderId} belongs to a different organization — event rejected`);
          }

          // 1. Upsert Order
          await tx
            .insert(schema.orders)
            .values({
              id: orderId,
              outletId: finalOutletId,
              organizationId: finalOrgId,
              orderNumber,
              tableId: resolvedTable?.id ?? null,
              orderMode: orderMode || "DINE_IN",
              status: "COMPLETED",
              subtotal: String(subtotal),
              discountAmount: String(discountAmount),
              taxAmount: String(taxAmount),
              totalAmount: String(totalAmount),
              paymentMode,
              notes: unresolvedNote,
              createdAt: new Date(completedAt),
              updatedAt: new Date(completedAt),
            })
            .onConflictDoUpdate({
              target: schema.orders.id,
              // Never overwrite an order that belongs to a different organization
              setWhere: eq(schema.orders.organizationId, finalOrgId),
              set: {
                status: "COMPLETED",
                orderMode: orderMode || "DINE_IN",
                subtotal: String(subtotal),
                discountAmount: String(discountAmount),
                taxAmount: String(taxAmount),
                totalAmount: String(totalAmount),
                paymentMode,
                ...(unresolvedNote ? { notes: unresolvedNote } : {}),
                updatedAt: new Date(completedAt),
              },
            });

          // 2. Insert Order Items (clear existing if any, then insert).
          //    Local item IDs are kept so ITEM_VOIDED / ORDER_SNAPSHOT address the same rows.
          const itemIds = resolvedItems.map((i: any) => i.id).filter(isUuid);
          await tx.delete(schema.orderItems).where(
            itemIds.length > 0
              ? or(eq(schema.orderItems.orderId, orderId), inArray(schema.orderItems.id, itemIds))
              : eq(schema.orderItems.orderId, orderId)
          );

          if (resolvedItems.length > 0) {
            await tx.insert(schema.orderItems).values(
              resolvedItems.map((i: any) => ({
                ...(isUuid(i.id) ? { id: i.id } : {}),
                orderId,
                menuItemId: i.menuItemId,
                menuItemName: i.menuItemName,
                quantity: i.quantity,
                unitPrice: String(i.unitPrice),
                gstRate: i.gstRate,
                status: "COMPLETED" as const,
              }))
            );
          }

          // 3. Upsert Invoice (invoices has no unique key, so check explicitly —
          //    otherwise every job retry adds a duplicate invoice)
          const existingInvoice = await tx.query.invoices.findFirst({
            where: eq(schema.invoices.orderId, orderId),
          });
          if (!existingInvoice) {
            await tx.insert(schema.invoices).values({
              orderId,
              outletId: finalOutletId,
              invoiceNumber,
              subtotal: String(subtotal),
              discountAmount: String(discountAmount),
              totalAmount: String(totalAmount),
              paymentMode,
              isPaid: true,
              createdAt: new Date(completedAt),
            });
          }
        });

        console.log(`[Sync] ✅ Successfully synced ORDER_COMPLETED: ${orderNumber}`);

        // 3.5 Publish real-time sync event for Cloud ERP updates
        pubClient.publish("sync-events", JSON.stringify({
          eventType: "ORDER_COMPLETED",
          organizationId: finalOrgId,
          outletId: finalOutletId,
          payload: { orderId, orderNumber, status: "COMPLETED" },
        })).catch(err => console.error("[Sync] Pub/Sub Error:", err));

        // 3.6 Release dining table if dine-in
        try {
          let tableToRelease = resolvedTable;
          if (!tableToRelease && orderId) {
            const cloudOrder = await db.query.orders.findFirst({
              where: eq(schema.orders.id, orderId),
            });
            if (cloudOrder?.tableId) {
              tableToRelease = (await db.query.diningTables.findFirst({
                where: eq(schema.diningTables.id, cloudOrder.tableId),
              })) ?? null;
            }
          }

          if (tableToRelease) {
            await db
              .update(schema.diningTables)
              .set({ status: "AVAILABLE" })
              .where(eq(schema.diningTables.id, tableToRelease.id));

            console.log(`[Sync] 🪑 Released dining table ${tableToRelease.name} (${tableToRelease.id}) to AVAILABLE in Cloud ERP`);

            pubClient.publish("sync-events", JSON.stringify({
              eventType: "TABLE_STATUS_CHANGED",
              organizationId: finalOrgId,
              outletId: finalOutletId,
              payload: { tableId: tableToRelease.id, tableName: tableToRelease.name, status: "AVAILABLE" },
            })).catch(err => console.error("[Sync] Pub/Sub Error:", err));
          }
        } catch (tableErr) {
          console.warn("[Sync] Could not release table for completed order:", tableErr);
        }

        // 4. Bring ingredient stock in line with the completed order
        await queueInventoryReconcile(orderId, orderNumber, finalOrgId, finalOutletId);
      } catch (err) {
        Sentry.captureException(err);
        const pgCode = extractPgErrorCode(err);
        const isSchemaMismatch = pgCode === "42703" || pgCode === "42P01";

        const structuredError = {
          level: "error",
          worker: "pos-sync",
          service: "sync-worker",
          event: isSchemaMismatch ? "SYNC_SCHEMA_MISMATCH" : "SYNC_JOB_FAILED",
          jobId: job.id,
          jobName: job.name,
          eventType,
          orderNumber: orderNumber ?? null,
          orderId: orderId ?? null,
          outletId: outletId ?? null,
          pgCode: pgCode ?? null,
          pgErrorCode: pgCode ?? null,
          pgErrorName:
            pgCode === "42703"
              ? "UNDEFINED_COLUMN"
              : pgCode === "42P01"
              ? "UNDEFINED_TABLE"
              : null,
          message: err instanceof Error ? err.message : String(err),
          errorMessage: err instanceof Error ? err.message : String(err),
          ...(isSchemaMismatch
            ? {
                hint: "Database schema mismatch — run: pnpm --filter @gusto/db-schema db:migrate",
                migrationHint:
                  "Database schema is missing columns or tables. Run: DATABASE_URL=<cloud_url> pnpm --filter @gusto/db-schema db:migrate",
              }
            : {}),
          timestamp: new Date().toISOString(),
        };

        console.error(JSON.stringify(structuredError, null, 2));

        if (isSchemaMismatch) {
          console.error(
            `[Sync] 🚨 MIGRATION HINT (PG Code ${pgCode}): Missing schema while syncing order ${orderNumber}!\n` +
            `       Run: DATABASE_URL=<cloud_url> pnpm --filter @gusto/db-schema db:migrate`
          );
        } else {
          console.error(`[Sync] ❌ Failed to sync order ${orderNumber}:`, err);
        }

        throw err;
      }
    } else if (eventType === "ORDER_SNAPSHOT") {
      try {
        const result = await processOrderSnapshot(payload, localTimestamp);
        if (!result.applied) {
          console.log(`[Sync] ⏭️ Skipped ORDER_SNAPSHOT ${result.orderNumber}: ${result.reason}`);
        } else {
          if (result.unresolvedItems.length > 0) {
            console.warn(
              `[Sync] ⚠️ Order ${result.orderNumber}: ${result.unresolvedItems.length} item(s) not found in cloud menu: ` +
              result.unresolvedItems.join(", ")
            );
          }
          console.log(`[Sync] ✅ Synced ORDER_SNAPSHOT: ${result.orderNumber} (${result.status})`);

          // Completed → deduct ingredients; cancelled/voided after payment → return them.
          // The reconcile is idempotent, so repeated snapshots cost nothing.
          if (result.status === "COMPLETED" || result.status === "CANCELLED") {
            await queueInventoryReconcile(result.orderId, result.orderNumber, result.organizationId, result.outletId);
          }
          pubClient.publish("sync-events", JSON.stringify({
            eventType: "ORDER_UPDATED",
            organizationId: result.organizationId,
            outletId: result.outletId,
            payload: { orderId: result.orderId, orderNumber: result.orderNumber, status: result.status, tableId: result.tableId },
          })).catch(err => console.error("[Sync] Pub/Sub Error:", err));
          for (const change of result.tableChanges) {
            console.log(`[Sync] 🪑 Table ${change.tableName} -> ${change.status} (from ORDER_SNAPSHOT ${result.orderNumber})`);
            pubClient.publish("sync-events", JSON.stringify({
              eventType: "TABLE_STATUS_CHANGED",
              organizationId: result.organizationId,
              outletId: result.outletId,
              payload: change,
            })).catch(err => console.error("[Sync] Pub/Sub Error:", err));
          }
        }
      } catch (err) {
        Sentry.captureException(err);
        console.error(`[Sync] ❌ Failed to sync ORDER_SNAPSHOT ${payload?.orderNumber}:`, err);
        throw err;
      }
    } else if (eventType === "MENU_ITEM_AVAILABILITY") {
      const { menuItemId, menuItemName, isAvailable, organizationId, outletId } = payload;
      const finalOutletId = isUuid(outletId) ? outletId : DEFAULT_OUTLET_ID;
      const finalOrgId = isUuid(organizationId) ? organizationId : DEFAULT_ORG_ID;
      const cloudItemId = await resolveMenuItemId(finalOutletId, menuItemId, menuItemName);
      if (!cloudItemId) {
        console.warn(`[Sync] ⚠️ MENU_ITEM_AVAILABILITY: item "${menuItemName ?? menuItemId}" not found in cloud menu`);
      } else {
        await db
          .update(schema.menuItems)
          .set({ isAvailable: Boolean(isAvailable), updatedAt: eventTime })
          .where(eq(schema.menuItems.id, cloudItemId));
        console.log(`[Sync] 🍕 ${menuItemName ?? cloudItemId} is now ${isAvailable ? "available" : "86'd"} in Cloud ERP`);
        // Not MENU_UPDATED: that would make every POS re-pull the whole menu.
        pubClient.publish("sync-events", JSON.stringify({
          eventType: "MENU_ITEM_AVAILABILITY",
          organizationId: finalOrgId,
          outletId: finalOutletId,
          payload: { menuItemId: cloudItemId, menuItemName, isAvailable: Boolean(isAvailable) },
        })).catch(err => console.error("[Sync] Pub/Sub Error:", err));
      }
    } else if (eventType === "ONLINE_ORDER_ACCEPTED") {
      await setOnlineOrderStatus(payload, "ACCEPTED");
    } else if (eventType === "ONLINE_ORDER_REJECTED") {
      await setOnlineOrderStatus(payload, "REJECTED");
    } else if (eventType === "ONLINE_ORDER_READY") {
      await setOnlineOrderStatus(payload, "READY_FOR_PICKUP");
    } else if (eventType === "ORDER_CREATED") {
      const {
        orderId,
        orderNumber,
        orderMode,
        tableId,
        tableName,
        outletId,
        organizationId,
      } = payload;

      const finalOutletId = outletId || "00000000-0000-0000-0000-000000000003";
      const finalOrgId = organizationId || "00000000-0000-0000-0000-000000000001";

      try {
        const validTable = await resolveDiningTable(finalOutletId, tableId, tableName);

        const validTableId = validTable?.id || null;

        await db
          .insert(schema.orders)
          .values({
            id: orderId,
            outletId: finalOutletId,
            organizationId: finalOrgId,
            orderNumber,
            tableId: validTableId,
            orderMode: orderMode || "DINE_IN",
            status: "PLACED",
            subtotal: "0",
            discountAmount: "0",
            taxAmount: "0",
            totalAmount: "0",
            createdAt: localTimestamp ? new Date(localTimestamp) : new Date(),
            updatedAt: localTimestamp ? new Date(localTimestamp) : new Date(),
          })
          .onConflictDoUpdate({
            target: schema.orders.id,
            setWhere: eq(schema.orders.organizationId, finalOrgId),
            set: {
              tableId: validTableId,
              orderMode: orderMode || "DINE_IN",
            },
          });

        console.log(`[Sync] ✅ Successfully synced ORDER_CREATED: ${orderNumber} (table: ${validTable?.name || validTableId || "none"})`);

        // If dine-in order with table, mark table as OCCUPIED in Cloud ERP
        if (validTable && (orderMode === "DINE_IN" || !orderMode)) {
          await db
            .update(schema.diningTables)
            .set({ status: "OCCUPIED" })
            .where(eq(schema.diningTables.id, validTable.id));

          console.log(`[Sync] 🪑 Marked dining table ${validTable.name} (${validTable.id}) as OCCUPIED in Cloud ERP`);

          pubClient.publish("sync-events", JSON.stringify({
            eventType: "TABLE_STATUS_CHANGED",
            organizationId: finalOrgId,
            outletId: finalOutletId,
            payload: { tableId: validTable.id, tableName: validTable.name, status: "OCCUPIED" },
          })).catch(err => console.error("[Sync] Pub/Sub Error:", err));
        }

        pubClient.publish("sync-events", JSON.stringify({
          eventType: "ORDER_CREATED",
          organizationId: finalOrgId,
          outletId: finalOutletId,
          payload: { orderId, orderNumber, tableId: validTableId, status: "PLACED" },
        })).catch(err => console.error("[Sync] Pub/Sub Error:", err));
      } catch (err) {
        console.error(`[Sync] ❌ Failed to sync ORDER_CREATED ${orderNumber}:`, err);
        throw err;
      }
    } else if (eventType === "ORDER_CANCELLED") {
      const { orderId, orderNumber, organizationId, outletId } = payload;
      const finalOutletId = outletId || "00000000-0000-0000-0000-000000000003";
      const finalOrgId = organizationId || "00000000-0000-0000-0000-000000000001";
      try {
        const cloudOrder = await db.query.orders.findFirst({
          where: ownOrder(orderId, finalOrgId),
        });
        await db
          .update(schema.orders)
          .set({ status: "CANCELLED", updatedAt: eventTime })
          .where(ownOrder(orderId, finalOrgId));
        if (cloudOrder) await queueInventoryReconcile(orderId, orderNumber, finalOrgId, finalOutletId);

        console.log(`[Sync] ✅ Successfully synced ORDER_CANCELLED: ${orderNumber}`);

        // Release table if order was attached to one
        if (cloudOrder?.tableId) {
          await db
            .update(schema.diningTables)
            .set({ status: "AVAILABLE" })
            .where(eq(schema.diningTables.id, cloudOrder.tableId));

          console.log(`[Sync] 🪑 Released dining table ${cloudOrder.tableId} to AVAILABLE on cancellation`);

          pubClient.publish("sync-events", JSON.stringify({
            eventType: "TABLE_STATUS_CHANGED",
            organizationId: finalOrgId,
            outletId: finalOutletId,
            payload: { tableId: cloudOrder.tableId, status: "AVAILABLE" },
          })).catch(err => console.error("[Sync] Pub/Sub Error:", err));
        }

        pubClient.publish("sync-events", JSON.stringify({
          eventType: "ORDER_CANCELLED",
          organizationId: finalOrgId,
          outletId: finalOutletId,
          payload: { orderId, orderNumber, status: "CANCELLED" },
        })).catch(err => console.error("[Sync] Pub/Sub Error:", err));
      } catch (err) {
        console.error(`[Sync] ❌ Failed to sync ORDER_CANCELLED ${orderNumber}:`, err);
        throw err;
      }
    } else if (eventType === "TABLE_STATUS_CHANGED") {
      const { tableId, tableName, status, organizationId, outletId } = payload;
      const finalOutletId = outletId || "00000000-0000-0000-0000-000000000003";
      const finalOrgId = organizationId || "00000000-0000-0000-0000-000000000001";
      try {
        const targetTable = await resolveDiningTable(finalOutletId, tableId, tableName);

        if (targetTable && status) {
          await db
            .update(schema.diningTables)
            .set({ status: status as any })
            .where(eq(schema.diningTables.id, targetTable.id));
          console.log(`[Sync] 🪑 Updated dining table ${targetTable.name} (${targetTable.id}) status to ${status}`);

          pubClient.publish("sync-events", JSON.stringify({
            eventType: "TABLE_STATUS_CHANGED",
            organizationId: finalOrgId,
            outletId: finalOutletId,
            payload: { tableId: targetTable.id, tableName: targetTable.name, status },
          })).catch(err => console.error("[Sync] Pub/Sub Error:", err));
        }
      } catch (err) {
        console.error(`[Sync] ❌ Failed to update table status:`, err);
      }
    } else if (eventType === "ITEM_VOIDED") {
      const { orderId, itemId, reason, approvedBy, voidQuantity, remainingQuantity, organizationId, outletId } = payload;
      const finalOutletId = outletId || "00000000-0000-0000-0000-000000000003";
      const finalOrgId = organizationId || "00000000-0000-0000-0000-000000000001";
      try {
        const owned = await db.query.orders.findFirst({ where: ownOrder(orderId, finalOrgId), columns: { id: true } });
        if (!owned) {
          console.warn(`[Sync] ITEM_VOIDED skipped — order ${orderId} not found in this organization`);
          return { synced: true, timestamp: new Date().toISOString() };
        }
        if (voidQuantity !== undefined && remainingQuantity !== undefined && remainingQuantity > 0) {
          await db
            .update(schema.orderItems)
            .set({ quantity: remainingQuantity })
            .where(and(eq(schema.orderItems.orderId, orderId), eq(schema.orderItems.id, itemId)));
        } else {
          await db
            .update(schema.orderItems)
            .set({ status: "CANCELLED" })
            .where(and(eq(schema.orderItems.orderId, orderId), eq(schema.orderItems.id, itemId)));
        }
        console.log(`[Sync] ❌ Item ${itemId} voided for order ${orderId}`);

        pubClient.publish("sync-events", JSON.stringify({
          eventType: "ITEM_VOIDED",
          organizationId: finalOrgId,
          outletId: finalOutletId,
          payload: { orderId, itemId, reason, approvedBy, voidQuantity, remainingQuantity },
        })).catch(err => console.error("[Sync] Pub/Sub Error:", err));
      } catch (err) {
        console.error(`[Sync] ❌ Failed to sync ITEM_VOIDED:`, err);
      }
    } else if (eventType === "ORDERS_MERGED") {
      const { sourceOrderId, targetOrderId, sourceOrderNumber, targetOrderNumber, organizationId, outletId } = payload;
      const finalOutletId = outletId || "00000000-0000-0000-0000-000000000003";
      const finalOrgId = organizationId || "00000000-0000-0000-0000-000000000001";
      try {
        // Both orders must exist in this organization before anything moves
        const [src, dst] = await Promise.all([
          db.query.orders.findFirst({ where: ownOrder(sourceOrderId, finalOrgId), columns: { id: true } }),
          db.query.orders.findFirst({ where: ownOrder(targetOrderId, finalOrgId), columns: { id: true } }),
        ]);
        if (!src || !dst) {
          console.warn(`[Sync] ORDERS_MERGED skipped — order not found in this organization (the snapshots will reconcile it)`);
          return { synced: true, timestamp: new Date().toISOString() };
        }
        await db.transaction(async (tx) => {
          await tx
            .update(schema.orderItems)
            .set({ orderId: targetOrderId })
            .where(eq(schema.orderItems.orderId, sourceOrderId));
          await tx
            .update(schema.orders)
            .set({
              status: "CANCELLED",
              notes: `Merged into ${targetOrderNumber || targetOrderId}`,
              updatedAt: eventTime,
            })
            .where(ownOrder(sourceOrderId, finalOrgId));
        });

        console.log(`[Sync] 🔀 Orders merged: ${sourceOrderNumber || sourceOrderId} -> ${targetOrderNumber || targetOrderId}`);

        pubClient.publish("sync-events", JSON.stringify({
          eventType: "ORDERS_MERGED",
          organizationId: finalOrgId,
          outletId: finalOutletId,
          payload: { sourceOrderId, targetOrderId, sourceOrderNumber, targetOrderNumber },
        })).catch(err => console.error("[Sync] Pub/Sub Error:", err));
      } catch (err) {
        console.error(`[Sync] ❌ Failed to sync ORDERS_MERGED:`, err);
      }
    } else if (eventType === "ORDER_MODE_CHANGED") {
      const { orderId, orderNumber, oldMode, newMode, organizationId, outletId } = payload;
      const finalOutletId = outletId || "00000000-0000-0000-0000-000000000003";
      const finalOrgId = organizationId || "00000000-0000-0000-0000-000000000001";
      try {
        await db
          .update(schema.orders)
          .set({ orderMode: newMode, updatedAt: eventTime })
          .where(ownOrder(orderId, finalOrgId));

        console.log(`[Sync] 🔄 Order ${orderNumber || orderId} mode changed: ${oldMode} -> ${newMode}`);

        pubClient.publish("sync-events", JSON.stringify({
          eventType: "ORDER_MODE_CHANGED",
          organizationId: finalOrgId,
          outletId: finalOutletId,
          payload: { orderId, orderNumber, oldMode, newMode },
        })).catch(err => console.error("[Sync] Pub/Sub Error:", err));
      } catch (err) {
        console.error(`[Sync] ❌ Failed to sync ORDER_MODE_CHANGED:`, err);
      }
    } else if (eventType === "ORDER_COMPLIMENTARY") {
      const { orderId, orderNumber, reason, approvedBy, organizationId, outletId } = payload;
      const finalOutletId = outletId || "00000000-0000-0000-0000-000000000003";
      const finalOrgId = organizationId || "00000000-0000-0000-0000-000000000001";
      try {
        await db
          .update(schema.orders)
          .set({
            discountLabel: `COMPLIMENTARY: ${reason || "Approved"}`,
            totalAmount: "0",
            notes: `Complimentary by ${approvedBy || "Manager"}. Reason: ${reason || ""}`,
            updatedAt: eventTime,
          })
          .where(ownOrder(orderId, finalOrgId));

        console.log(`[Sync] 🎁 Order ${orderNumber || orderId} marked COMPLIMENTARY`);

        pubClient.publish("sync-events", JSON.stringify({
          eventType: "ORDER_COMPLIMENTARY",
          organizationId: finalOrgId,
          outletId: finalOutletId,
          payload: { orderId, orderNumber, reason, approvedBy },
        })).catch(err => console.error("[Sync] Pub/Sub Error:", err));
      } catch (err) {
        console.error(`[Sync] ❌ Failed to sync ORDER_COMPLIMENTARY:`, err);
      }
    }

    return { synced: true, timestamp: new Date().toISOString() };
  },
  { connection, concurrency: CONCURRENCY }
);

// ─── Inventory Worker ───
// Handles both "reconcile-order" and the older "deduct-for-order" job name.
const inventoryWorker = new Worker(
  "inventory-deduction",
  async (job) => {
    const { orderId, orderNumber, organizationId } = job.data as {
      orderId?: string;
      orderNumber?: string;
      organizationId?: string;
    };
    if (!isUuid(orderId) || !isUuid(organizationId)) {
      console.warn(`[Inventory] Job ${job.id} has no valid order / organization — skipped`);
      return { applied: false };
    }

    const result = await reconcileInventoryForOrder(orderId, organizationId, pubClient);
    if (result.movements.length > 0) {
      console.log(
        `[Inventory] ✅ ${result.movements.length} stock movement(s) for order ${orderNumber ?? orderId}`
      );
    }
    return result;
  },
  { connection, concurrency: 3 }
);

// ─── Webhook Worker ───

const webhookWorker = new Worker(
  "webhook-processing",
  async (job) => {
    console.log(`[Webhook] Processing ${job.name}`);

    if (job.name === "process-zomato-webhook") {
      const { onlineOrderId, organizationId, outletId, payload } = job.data;
      
      console.log(`[Webhook] Routing Zomato order ${payload.order_id} to outlet ${outletId}`);
      
      // Phase 2: Menu Mapping Engine
      const mappedItems = [];
      for (const item of Array.isArray(payload?.items) ? payload.items : []) {
        const mapping = await db.query.aggregatorMenuMappings.findFirst({
          where: and(
            eq(schema.aggregatorMenuMappings.provider, "ZOMATO"),
            eq(schema.aggregatorMenuMappings.aggregatorItemId, String(item.item_id)),
            eq(schema.aggregatorMenuMappings.outletId, outletId)
          ),
        });

        mappedItems.push({
          ...item,
          pos_mapped_id: mapping?.posMenuItemId || null,
        });
      }
      
      payload.items = mappedItems;

      // 1. Zomato order received → route to outlet POS
      pubClient.publish(
        "sync-events",
        JSON.stringify({
          eventType: "ONLINE_ORDER_RECEIVED",
          organizationId,
          outletId,
          payload: {
            onlineOrderId,
            ...payload,
          },
        })
      ).catch(err => console.error("[Webhook] Pub/Sub Error:", err));

      // 2. Schedule timeout check (Phase 3: 2-minute fallback)
      await webhookQueue.add(
        "check-zomato-ack",
        { onlineOrderId, organizationId, outletId },
        { delay: 2 * 60 * 1000, jobId: `zomato-ack-${onlineOrderId}`, removeOnComplete: true, removeOnFail: { age: 86_400 } }
      );
    } 
    else if (job.name === "check-zomato-ack") {
      const { onlineOrderId, organizationId, outletId } = job.data;
      
      const order = await db.query.onlineOrders.findFirst({
        where: eq(schema.onlineOrders.id, onlineOrderId),
      });

      if (order && order.status === "RECEIVED") {
        console.log(`[Webhook] ⚠️ POS timeout! Auto-rejecting Zomato order ${order.externalOrderId}`);
        
        await db
          .update(schema.onlineOrders)
          .set({ status: "REJECTED", updatedAt: new Date() })
          .where(eq(schema.onlineOrders.id, onlineOrderId));

        // (See setOnlineOrderStatus: the aggregator is not called from here.)
        
        // Notify POS that it was auto-rejected
        pubClient.publish(
          "sync-events",
          JSON.stringify({
            eventType: "ONLINE_ORDER_AUTO_REJECTED",
            organizationId,
            outletId,
            payload: { onlineOrderId },
          })
        ).catch(err => console.error("[Webhook] Pub/Sub Error:", err));
      } else {
        console.log(`[Webhook] Order ${onlineOrderId} was acknowledged (status: ${order?.status})`);
      }
    }

    return { processed: true };
  },
  { connection, concurrency: 2 }
);

// ─── Event Handlers ───

syncWorker.on("completed", (job) => {
  console.log(`[Sync] Job ${job.id} completed`);
});

syncWorker.on("failed", (job, err) => {
  const pgCode = extractPgErrorCode(err);
  const isSchemaError = pgCode === "42703" || pgCode === "42P01";

  if (isSchemaError) {
    console.error(
      JSON.stringify(
        {
          level: "error",
          service: "sync-worker",
          event: "SYNC_JOB_FAILED_SCHEMA_ERROR",
          jobId: job?.id,
          attemptsMade: job?.attemptsMade,
          pgCode,
          pgErrorName: pgCode === "42703" ? "UNDEFINED_COLUMN" : "UNDEFINED_TABLE",
          errorMessage: err.message,
          migrationHint:
            "Database schema is missing required columns/tables. Run: DATABASE_URL=<cloud_url> pnpm --filter @gusto/db-schema db:migrate",
          timestamp: new Date().toISOString(),
        },
        null,
        2
      )
    );
  } else {
    console.error(`[Sync] Job ${job?.id} failed:`, err.message);
  }
});

inventoryWorker.on("completed", (job) => {
  console.log(`[Inventory] Job ${job.id} completed`);
});

inventoryWorker.on("failed", (job, err) => {
  console.error(`[Inventory] Job ${job?.id} failed:`, err.message);
});

console.log(`
╔══════════════════════════════════════════════╗
║       ⚙️  Gusto Sync Worker                  ║
╠══════════════════════════════════════════════╣
║  Redis:       ${REDIS_URL.slice(0, 30).padEnd(30)}║
║  Concurrency: ${CONCURRENCY}                              ║
║  Queues:      pos-sync, inventory, webhooks  ║
║  Status:      ✅ Listening                    ║
╚══════════════════════════════════════════════╝
`);


// ─── Graceful Shutdown ───
// Let in-flight jobs finish (BullMQ returns unfinished ones to the queue),
// then close Redis and Postgres so nothing is cut off mid-transaction.
let shuttingDown = false;
async function shutdown(signal: string, exitCode = 0) {
  if (shuttingDown) return;
  shuttingDown = true;
  console.log(`[${signal}] Sync worker shutting down...`);
  setTimeout(() => process.exit(exitCode || 1), 30_000).unref();

  const results = await Promise.allSettled([syncWorker.close(), inventoryWorker.close(), webhookWorker.close()]);
  for (const r of results) if (r.status === "rejected") console.error("[Shutdown] Worker close failed:", r.reason);

  await Promise.allSettled([syncQueue.close(), inventoryQueue.close(), webhookQueue.close()]);
  await pubClient.quit().catch(() => pubClient.disconnect());
  await closeDb().catch((err) => console.error("[Shutdown] Database close failed:", err));
  await Sentry.close(2_000).catch(() => undefined);
  process.exit(exitCode);
}

process.on("SIGINT", () => void shutdown("SIGINT"));
process.on("SIGTERM", () => void shutdown("SIGTERM"));
process.on("unhandledRejection", (reason) => {
  Sentry.captureException(reason);
  console.error("[Sync Worker] Unhandled promise rejection:", reason);
});
process.on("uncaughtException", (err) => {
  Sentry.captureException(err);
  console.error("[Sync Worker] Uncaught exception:", err);
  void shutdown("uncaughtException", 1);
});

for (const worker of [syncWorker, inventoryWorker, webhookWorker]) {
  worker.on("error", (err) => console.error("[Worker] Connection error:", err.message));
}
webhookWorker.on("failed", (job, err) => {
  console.error(`[Webhook] Job ${job?.id} failed:`, err.message);
});
