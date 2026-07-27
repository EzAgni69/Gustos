/**
 * Gusto API Gateway — Sync Routes
 *
 * Placeholder endpoints for Phase 2 POS ↔ Cloud synchronization.
 *
 * POST /api/v1/sync/push — Receive batch events from local POS
 * GET  /api/v1/sync/pull — Pull updates for a specific outlet
 */

import type { FastifyInstance } from "fastify";
import { success } from "../utils/response.js";
import { posSyncQueue } from "../config/queue.js";

export async function syncRoutes(fastify: FastifyInstance) {
  // TODO (Phase 2): Add API key authentication for POS machines
  // instead of JWT (POS machines use pre-shared keys)

  // ─── Push (POS → Cloud) ───
  fastify.post("/api/v1/sync/push", async (request, reply) => {
    // TODO (Phase 2): Add API key authentication for POS machines

    const { events } = request.body as {
      events: {
        eventType: string;
        payload: Record<string, unknown>;
        localTimestamp: string;
      }[];
    };

    if (!events || !Array.isArray(events)) {
      return reply.status(400).send({ success: false, message: "Invalid payload format" });
    }

    // Queue events into BullMQ sync queue
    const jobs = events.map((event) => ({
      name: event.eventType,
      data: event,
    }));

    if (jobs.length > 0) {
      await posSyncQueue.addBulk(jobs);
    }

    return reply.send(
      success(
        {
          received: events.length,
          queued: jobs.length,
        },
        "Batch sync queued successfully"
      )
    );
  });

  // ─── Pull (Cloud → POS) ───
  fastify.get("/api/v1/sync/pull", async (request, reply) => {
    // TODO (Phase 2):
    // 1. Validate API key from request header
    // 2. Get outlet ID from query params
    // 3. Find all changes since last sync timestamp
    // 4. Return batch of updates (menu changes, user updates, etc.)

    return reply.send(
      success(
        {
          events: [],
          lastSyncTimestamp: new Date().toISOString(),
        },
        "Sync pull endpoint — implementation coming in Phase 2"
      )
    );
  });
}
