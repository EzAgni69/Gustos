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

// ─── Queues ───

export const posSyncQueue = new Queue("pos-sync", {
  connection: redisConnection as any,
  defaultJobOptions: {
    attempts: 3,
    backoff: { type: "exponential", delay: 2000 },
    removeOnComplete: true,
  },
});
