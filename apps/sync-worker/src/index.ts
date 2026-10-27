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
import { eq, and, sql } from "drizzle-orm";
import { db } from "./db.js";
import * as schema from "@gusto/db-schema/cloud";
import { processInventoryDeduction } from "./handlers/inventory.handler.js";
import dotenv from "dotenv";
import * as Sentry from "@sentry/node";
import { nodeProfilingIntegration } from "@sentry/profiling-node";
import path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
dotenv.config({ path: path.resolve(__dirname, "../../../.env") });
dotenv.config();

Sentry.init({
  dsn: process.env.SENTRY_DSN,
  integrations: [
    nodeProfilingIntegration(),
  ],
  tracesSampleRate: 1.0,
  profilesSampleRate: 1.0,
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
    attempts: 3,
    backoff: { type: "exponential", delay: 3000 },
    removeOnComplete: true,
  },
});
export const webhookQueue = new Queue("webhook-processing", { connection });

// ─── Sync Worker ───

const syncWorker = new Worker(
  "pos-sync",
  async (job) => {
    console.log(`[Sync] Processing job ${job.id}: ${job.name}`);
    const { eventType, payload, localTimestamp } = job.data as any;

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
        await db.transaction(async (tx) => {
          // 1. Upsert Order
          await tx
            .insert(schema.orders)
            .values({
              id: orderId,
              outletId: finalOutletId,
              organizationId: finalOrgId,
              orderNumber,
              orderMode: orderMode || "DINE_IN",
              status: "COMPLETED",
              subtotal: String(subtotal),
              discountAmount: String(discountAmount),
              taxAmount: String(taxAmount),
              totalAmount: String(totalAmount),
              paymentMode,
              createdAt: new Date(completedAt),
              updatedAt: new Date(completedAt),
            })
            .onConflictDoUpdate({
              target: schema.orders.id,
              set: {
                status: "COMPLETED",
                orderMode: orderMode || "DINE_IN",
                subtotal: String(subtotal),
                discountAmount: String(discountAmount),
                taxAmount: String(taxAmount),
                totalAmount: String(totalAmount),
                paymentMode,
                updatedAt: new Date(completedAt),
              },
            });

          // 2. Insert Order Items (clear existing if any, then insert)
          await tx.delete(schema.orderItems).where(eq(schema.orderItems.orderId, orderId));

          if (items && items.length > 0) {
            await tx.insert(schema.orderItems).values(
              items.map((i: any) => ({
                orderId,
                menuItemId: i.menuItemId,
                menuItemName: i.menuItemName,
                quantity: i.quantity,
                unitPrice: String(i.unitPrice),
                gstRate: i.gstRate,
                status: "COMPLETED",
              }))
            );
          }

          // 3. Upsert Invoice
          await tx
            .insert(schema.invoices)
            .values({
              orderId,
              outletId: finalOutletId,
              invoiceNumber,
              subtotal: String(subtotal),
              discountAmount: String(discountAmount),
              totalAmount: String(totalAmount),
              paymentMode,
              isPaid: true,
              createdAt: new Date(completedAt),
            })
            .onConflictDoNothing();
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
          let tableToRelease = null;
          if (tableId) {
            tableToRelease = await db.query.diningTables.findFirst({
              where: eq(schema.diningTables.id, tableId),
            });
          }
          if (!tableToRelease && tableName) {
            tableToRelease = await db.query.diningTables.findFirst({
              where: and(
                eq(schema.diningTables.outletId, finalOutletId),
                eq(schema.diningTables.name, tableName)
              ),
            });
          }
          if (!tableToRelease && orderId) {
            const cloudOrder = await db.query.orders.findFirst({
              where: eq(schema.orders.id, orderId),
            });
            if (cloudOrder?.tableId) {
              tableToRelease = await db.query.diningTables.findFirst({
                where: eq(schema.diningTables.id, cloudOrder.tableId),
              });
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

        // 4. Auto-enqueue inventory deduction job
        if (items && items.length > 0) {
          await inventoryQueue.add("deduct-for-order", {
            orderId,
            orderNumber,
            organizationId: finalOrgId,
            outletId: finalOutletId,
            items: items.map((i: any) => ({
              menuItemId: i.menuItemId,
              menuItemName: i.menuItemName,
              quantity: i.quantity,
            })),
          });
          console.log(`[Sync] 📦 Queued inventory deduction for order ${orderNumber} (outlet: ${outletId})`);
        }
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
    } else if (eventType === "ONLINE_ORDER_ACCEPTED") {
      const { onlineOrderId } = payload;
      if (onlineOrderId) {
        console.log(`[Sync] 🍔 ONLINE_ORDER_ACCEPTED -> Zomato Order ${onlineOrderId}`);
        await db.update(schema.onlineOrders)
          .set({ status: "ACCEPTED", updatedAt: new Date() })
          .where(eq(schema.onlineOrders.id, onlineOrderId));
        
        // Mock Zomato REST API Call
        console.log(`[Zomato API] POST /v1/orders/${onlineOrderId}/accept -> 200 OK`);
      }
    } else if (eventType === "ONLINE_ORDER_REJECTED") {
      const { onlineOrderId, reason } = payload;
      if (onlineOrderId) {
        console.log(`[Sync] 🍔 ONLINE_ORDER_REJECTED -> Zomato Order ${onlineOrderId} (Reason: ${reason})`);
        await db.update(schema.onlineOrders)
          .set({ status: "REJECTED", updatedAt: new Date() })
          .where(eq(schema.onlineOrders.id, onlineOrderId));
        
        // Mock Zomato REST API Call
        console.log(`[Zomato API] POST /v1/orders/${onlineOrderId}/reject -> 200 OK`);
      }
    } else if (eventType === "ONLINE_ORDER_READY") {
      const { onlineOrderId } = payload;
      if (onlineOrderId) {
        console.log(`[Sync] 🍔 ONLINE_ORDER_READY -> Zomato Order ${onlineOrderId} is ready for pickup!`);
        await db.update(schema.onlineOrders)
          .set({ status: "READY_FOR_PICKUP", updatedAt: new Date() })
          .where(eq(schema.onlineOrders.id, onlineOrderId));
        
        // Mock Zomato REST API Call
        console.log(`[Zomato API] POST /v1/orders/${onlineOrderId}/ready -> 200 OK`);
      }
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
        let validTable = null;
        if (tableId) {
          validTable = await db.query.diningTables.findFirst({
            where: eq(schema.diningTables.id, tableId),
          });
        }
        if (!validTable && tableName) {
          validTable = await db.query.diningTables.findFirst({
            where: and(
              eq(schema.diningTables.outletId, finalOutletId),
              eq(schema.diningTables.name, tableName)
            ),
          });
        }

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
            set: {
              tableId: validTableId,
              orderMode: orderMode || "DINE_IN",
              updatedAt: new Date(),
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
          where: eq(schema.orders.id, orderId),
        });

        await db
          .update(schema.orders)
          .set({ status: "CANCELLED", updatedAt: new Date() })
          .where(eq(schema.orders.id, orderId));

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
        let targetTable = null;
        if (tableId) {
          targetTable = await db.query.diningTables.findFirst({
            where: eq(schema.diningTables.id, tableId),
          });
        }
        if (!targetTable && tableName) {
          targetTable = await db.query.diningTables.findFirst({
            where: and(
              eq(schema.diningTables.outletId, finalOutletId),
              eq(schema.diningTables.name, tableName)
            ),
          });
        }

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
        await db
          .update(schema.orderItems)
          .set({ orderId: targetOrderId })
          .where(eq(schema.orderItems.orderId, sourceOrderId));

        await db
          .update(schema.orders)
          .set({
            status: "CANCELLED",
            notes: `Merged into ${targetOrderNumber || targetOrderId}`,
            updatedAt: new Date(),
          })
          .where(eq(schema.orders.id, sourceOrderId));

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
          .set({ orderMode: newMode, updatedAt: new Date() })
          .where(eq(schema.orders.id, orderId));

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
            updatedAt: new Date(),
          })
          .where(eq(schema.orders.id, orderId));

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

// ─── Inventory Deduction Worker ───

const inventoryWorker = new Worker(
  "inventory-deduction",
  async (job) => {
    const { orderId, orderNumber, organizationId, outletId, items } = job.data;
    console.log(`[Inventory] Processing deduction for order ${orderNumber} (${items.length} items)`);

    const result = await processInventoryDeduction(orderId, organizationId, items, outletId, pubClient);

    if (result.deductions.length > 0) {
      console.log(
        `[Inventory] ✅ Deducted ${result.deductions.length} ingredient(s) for order ${orderNumber}`
      );
    }

    if (result.warnings.length > 0) {
      console.log(`[Inventory] ⚠️ ${result.warnings.length} warning(s) for order ${orderNumber}`);
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
      for (const item of payload.items) {
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
        { delay: 2 * 60 * 1000 } // 2 minutes
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

        // TODO (Phase 5): Call Zomato REST API to actually reject the order
        // e.g. await rejectZomatoOrder(order.externalOrderId, config);
        
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

