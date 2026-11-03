/**
 * Gusto API Gateway — Sync Routes
 *
 * Endpoints for POS ↔ Cloud synchronization.
 *
 * POST /api/v1/sync/push — Receive batch events from local POS
 * GET  /api/v1/sync/pull — Pull updates for a specific outlet (menu, tables, users, config)
 * GET  /api/v1/sync/commands — Pending ERP → POS order commands for an outlet
 * POST /api/v1/sync/commands/ack — POS reports which commands it applied
 */

import type { FastifyInstance } from "fastify";
import { eq, and, gte, or, isNull, asc } from "drizzle-orm";
import { success, error } from "../utils/response.js";
import { posSyncQueue } from "../config/queue.js";
import { db } from "../db/index.js";
import * as schema from "@gusto/db-schema/cloud";

/**
 * Validate POS API key from request headers.
 * POS machines authenticate with a pre-shared key instead of JWT.
 */
function validatePosApiKey(apiKey: string | undefined): boolean {
  const expectedKey = process.env.POS_API_KEY;
  if (!expectedKey) {
    // If no key is configured, accept all requests (dev mode)
    console.warn("[Sync] ⚠️ POS_API_KEY not configured — accepting all sync requests");
    return true;
  }
  return apiKey === expectedKey;
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function safeJson(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

function isMissingTable(err: unknown): boolean {
  let cur: any = err;
  for (let i = 0; cur && i < 4; i++) {
    if (cur.code === "42P01") return true;
    cur = cur.cause;
  }
  return false;
}

export async function syncRoutes(fastify: FastifyInstance) {
  // ─── Push (POS → Cloud) ───
  fastify.post("/api/v1/sync/push", async (request, reply) => {
    const apiKey = request.headers["x-pos-api-key"] as string | undefined;
    if (!validatePosApiKey(apiKey)) {
      return reply.status(401).send(error("Invalid POS API key"));
    }

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

  // ─── Commands (ERP → POS) ───
  // Pending ERP edits to POS-owned orders (see utils/order-commands.ts).
  fastify.get("/api/v1/sync/commands", async (request, reply) => {
    const apiKey = request.headers["x-pos-api-key"] as string | undefined;
    if (!validatePosApiKey(apiKey)) {
      return reply.status(401).send(error("Invalid POS API key"));
    }
    const { outletId } = request.query as { outletId?: string };
    if (!outletId || !UUID_RE.test(outletId)) {
      return reply.status(400).send(error("A valid outletId query parameter is required"));
    }

    try {
      const rows = await db
        .select()
        .from(schema.syncQueue)
        .where(and(eq(schema.syncQueue.outletId, outletId), eq(schema.syncQueue.status, "PENDING")))
        .orderBy(asc(schema.syncQueue.createdAt))
        .limit(100);

      return reply.send(
        success(
          rows.map((r) => ({
            id: r.id,
            eventType: r.eventType,
            payload: safeJson(r.payload),
            createdAt: r.createdAt?.toISOString(),
          }))
        )
      );
    } catch (err) {
      if (isMissingTable(err)) return reply.send(success([]));
      throw err;
    }
  });

  fastify.post("/api/v1/sync/commands/ack", async (request, reply) => {
    const apiKey = request.headers["x-pos-api-key"] as string | undefined;
    if (!validatePosApiKey(apiKey)) {
      return reply.status(401).send(error("Invalid POS API key"));
    }
    const { outletId, results } = (request.body ?? {}) as {
      outletId?: string;
      results?: { id: string; ok: boolean; message?: string }[];
    };
    if (!outletId || !UUID_RE.test(outletId) || !Array.isArray(results)) {
      return reply.status(400).send(error("outletId and results[] are required"));
    }

    const now = new Date();
    for (const r of results) {
      if (!r?.id || !UUID_RE.test(r.id)) continue;
      const current = await db.query.syncQueue.findFirst({
        where: and(eq(schema.syncQueue.id, r.id), eq(schema.syncQueue.outletId, outletId)),
      });
      if (!current) continue;
      if (r.ok) {
        await db
          .update(schema.syncQueue)
          .set({ status: "DONE", syncedAt: now })
          .where(eq(schema.syncQueue.id, r.id));
      } else {
        // Retry a few times, then park it as FAILED
        const retryCount = current.retryCount + 1;
        await db
          .update(schema.syncQueue)
          .set({ retryCount, status: retryCount >= 5 ? "FAILED" : "PENDING" })
          .where(eq(schema.syncQueue.id, r.id));
        console.warn(`[Sync] POS could not apply command ${r.id} (attempt ${retryCount}): ${r.message ?? "unknown error"}`);
      }
    }

    return reply.send(success({ acknowledged: results.length }));
  });

  // ─── Pull (Cloud → POS) ───
  fastify.get("/api/v1/sync/pull", async (request, reply) => {
    const apiKey = request.headers["x-pos-api-key"] as string | undefined;
    if (!validatePosApiKey(apiKey)) {
      return reply.status(401).send(error("Invalid POS API key"));
    }

    const { outletId, since } = request.query as {
      outletId?: string;
      since?: string;
    };

    if (!outletId) {
      return reply.status(400).send(error("outletId query parameter is required"));
    }

    // Validate outlet exists
    const outlet = await db.query.outlets.findFirst({
      where: eq(schema.outlets.id, outletId),
    });

    if (!outlet) {
      return reply.status(404).send(error("Outlet not found"));
    }

    const sinceDate = since ? new Date(since) : new Date(0); // If no since, pull everything

    // 1. Menu Categories (modified since)
    const menuCategories = await db
      .select()
      .from(schema.menuCategories)
      .where(eq(schema.menuCategories.outletId, outletId));

    // 2. Menu Items (with updatedAt filter)
    const menuItemConditions = [eq(schema.menuItems.outletId, outletId)];
    if (since) {
      menuItemConditions.push(gte(schema.menuItems.updatedAt, sinceDate));
    }
    const menuItems = await db
      .select()
      .from(schema.menuItems)
      .where(and(...menuItemConditions));

    // 3. Dining Tables
    const diningTables = await db
      .select()
      .from(schema.diningTables)
      .where(eq(schema.diningTables.outletId, outletId));

    // 4. Users/Staff (assigned to this outlet, or org-wide staff without specific outlet)
    const users = await db
      .select({
        id: schema.users.id,
        name: schema.users.name,
        pin: schema.users.pin,
        role: schema.users.role,
        isActive: schema.users.isActive,
      })
      .from(schema.users)
      .where(
        and(
          eq(schema.users.organizationId, outlet.organizationId),
          or(
            eq(schema.users.outletId, outletId),
            isNull(schema.users.outletId)
          )
        )
      );

    // 5. Outlet config
    const outletConfig = {
      outletId: outlet.id,
      outletName: outlet.name,
      address: outlet.address,
      phone: outlet.phone,
      gstNumber: outlet.gstNumber,
      isActive: outlet.isActive,
    };

    const now = new Date().toISOString();

    return reply.send(
      success(
        {
          menuCategories: menuCategories.map((c) => ({
            id: c.id,
            outletId: c.outletId,
            name: c.name,
            sortOrder: c.sortOrder,
            isActive: c.isActive,
          })),
          menuItems: menuItems.map((item) => ({
            id: item.id,
            categoryId: item.categoryId,
            outletId: item.outletId,
            name: item.name,
            description: item.description,
            variants: item.variants,
            price: Number(item.price),
            gstRate: item.gstRate,
            isVeg: item.isVeg,
            isAvailable: item.isAvailable,
            sortOrder: item.sortOrder,
            createdAt: item.createdAt?.toISOString() ?? now,
            updatedAt: item.updatedAt?.toISOString() ?? now,
          })),
          diningTables: diningTables.map((t) => ({
            id: t.id,
            outletId: t.outletId,
            name: t.name,
            capacity: t.capacity,
            status: t.status,
            section: t.section,
            sortOrder: t.sortOrder,
          })),
          users: users.map((u) => ({
            id: u.id,
            name: u.name,
            pin: u.pin,
            role: u.role,
            isActive: u.isActive,
          })),
          outletConfig,
          lastSyncTimestamp: now,
        },
        "Sync pull data retrieved successfully"
      )
    );
  });
}
