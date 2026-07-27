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
import { eq } from "drizzle-orm";
import { db } from "./db.js";
import * as schema from "@gusto/db-schema/cloud";
import dotenv from "dotenv";

dotenv.config();

const REDIS_URL = process.env.REDIS_URL ?? "redis://localhost:6379";
const CONCURRENCY = Number(process.env.SYNC_WORKER_CONCURRENCY ?? 5);

// Parse Redis URL into connection config for BullMQ
const redisUrl = new URL(REDIS_URL);
const connection = {
  host: redisUrl.hostname,
  port: Number(redisUrl.port) || 6379,
  maxRetriesPerRequest: null,
};

// ─── Queues ───

export const syncQueue = new Queue("pos-sync", { connection });
export const inventoryQueue = new Queue("inventory-deduction", { connection });
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
      } catch (err) {
        console.error(`[Sync] ❌ Failed to sync order ${orderNumber}:`, err);
        throw err;
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
    console.log(`[Inventory] Processing deduction for order ${job.data.orderId}`);

    // TODO (Phase 4): Implement recipe-based deduction
    // 1. Look up recipes for each menu item in the order
    // 2. Calculate ingredient quantities
    // 3. Deduct from inventory_items
    // 4. Trigger low-stock alerts if needed

    return { deducted: true };
  },
  { connection, concurrency: 3 }
);

// ─── Webhook Worker ───

const webhookWorker = new Worker(
  "webhook-processing",
  async (job) => {
    console.log(`[Webhook] Processing ${job.name} from ${job.data.source}`);

    // TODO (Phase 5): Implement webhook handlers
    // 1. Zomato/Swiggy order received → route to outlet POS
    // 2. Payment confirmation → update invoice

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
