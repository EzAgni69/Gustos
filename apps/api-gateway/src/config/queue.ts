/**
 * Gusto API Gateway — Queue Config
 *
 * Configures BullMQ queues for background processing.
 */

import { Queue } from "bullmq";
import Redis from "ioredis";
import dotenv from "dotenv";

dotenv.config();

const redisUrl = process.env.REDIS_URL || "redis://localhost:6379";
export const redisConnection = new Redis(redisUrl, { maxRetriesPerRequest: null });
redisConnection.on("error", (err) => console.error("[Redis] Connection error:", err.message));

// ─── Queues ───

export const posSyncQueue = new Queue("pos-sync", {
  connection: redisConnection as any,
  defaultJobOptions: {
    attempts: 3,
    backoff: { type: "exponential", delay: 2000 },
    // Finished jobs are kept briefly so a re-sent event with the same job id is
    // recognised as a duplicate; failures are kept longer for diagnosis.
    removeOnComplete: { age: 3600, count: 5000 },
    removeOnFail: { age: 7 * 24 * 3600, count: 5000 },
  },
});

export const webhookQueue = new Queue("webhook-processing", {
  connection: redisConnection as any,
  defaultJobOptions: {
    attempts: 3,
    backoff: { type: "exponential", delay: 2000 },
    // Finished jobs are kept briefly so a re-sent event with the same job id is
    // recognised as a duplicate; failures are kept longer for diagnosis.
    removeOnComplete: { age: 3600, count: 5000 },
    removeOnFail: { age: 7 * 24 * 3600, count: 5000 },
  },
});

/** Stock reconciliation for an order (processed by the sync-worker). */
export const inventoryQueue = new Queue("inventory-deduction", {
  connection: redisConnection as any,
  defaultJobOptions: {
    attempts: 5,
    backoff: { type: "exponential", delay: 3000 },
    removeOnComplete: { age: 3600, count: 5000 },
    removeOnFail: { age: 7 * 24 * 3600, count: 5000 },
  },
});

/**
 * Ask the worker to bring stock in line with an order's current state.
 * Never throws: a Redis outage must not fail the ERP request (the next
 * change to the order, or a manual stock adjustment, corrects it).
 */
export async function queueInventoryReconcile(input: {
  orderId: string;
  orderNumber: string;
  organizationId: string;
  outletId: string;
}): Promise<void> {
  try {
    await Promise.race([
      inventoryQueue.add("reconcile-order", input),
      new Promise((_, reject) => setTimeout(() => reject(new Error("Redis timeout")), 2_000)),
    ]);
  } catch (err) {
    console.error(`[Inventory] Could not queue stock reconcile for ${input.orderNumber}:`, err instanceof Error ? err.message : err);
  }
}
