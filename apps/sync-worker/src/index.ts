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
import { eq, and } from "drizzle-orm";
import { db } from "./db.js";
import * as schema from "@gusto/db-schema/cloud";
import { processInventoryDeduction } from "./handlers/inventory.handler.js";
import dotenv from "dotenv";
import * as Sentry from "@sentry/node";
import { nodeProfilingIntegration } from "@sentry/profiling-node";

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
  maxRetriesPerRequest: null,
};

// ─── Redis Pub/Sub ───
const pubClient = new Redis(REDIS_URL);

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

      try {
        await db.transaction(async (tx) => {
          // 1. Upsert Order
          await tx
            .insert(schema.orders)
            .values({
              id: orderId,
              outletId,
              organizationId,
              orderNumber,
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
              outletId,
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
          organizationId,
          outletId,
          payload: { orderId, orderNumber, status: "COMPLETED" },
        })).catch(err => console.error("[Sync] Pub/Sub Error:", err));

        // 4. Auto-enqueue inventory deduction job
        if (items && items.length > 0) {
          await inventoryQueue.add("deduct-for-order", {
            orderId,
            orderNumber,
            organizationId,
            outletId,
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
        console.error(`[Sync] ❌ Failed to sync order ${orderNumber}:`, err);
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
  console.error(`[Sync] Job ${job?.id} failed:`, err.message);
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

