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

import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { eq, and, gte, or, isNull, asc, sql } from "drizzle-orm";
import type { OutletSyncStatus } from "@gusto/api-contracts";
import { getOrganizationId, requireMinRole } from "../middleware/auth.js";
import { success, error } from "../utils/response.js";
import { posSyncQueue } from "../config/queue.js";
import { db } from "../db/index.js";
import * as schema from "@gusto/db-schema/cloud";
import { checkPosApiKey, resolveOutletContext, isUuid, type PosOutletContext } from "../utils/pos-auth.js";

const MAX_EVENTS_PER_PUSH = 200;
const KNOWN_EVENT_TYPE = /^[A-Z][A-Z0-9_]{2,63}$/;

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

function header(request: FastifyRequest, name: string): string | undefined {
  const value = request.headers[name];
  return Array.isArray(value) ? value[0] : value;
}

/**
 * Authenticate a POS request and resolve the outlet it speaks for.
 * Replies and returns null when the request must not proceed.
 */
async function authenticatePos(
  request: FastifyRequest,
  reply: FastifyReply,
  claimedOutletId: string | undefined
): Promise<PosOutletContext | null> {
  const check = checkPosApiKey(header(request, "x-pos-api-key"), claimedOutletId);
  if (!check.ok) {
    reply.status(check.status).send(error(check.message));
    return null;
  }

  const outletId = check.boundOutletId ?? claimedOutletId;
  if (!isUuid(outletId)) {
    reply.status(400).send(error("A valid outlet id is required (x-outlet-id header or outletId parameter)"));
    return null;
  }

  const ctx = await resolveOutletContext(outletId);
  if (!ctx) {
    reply.status(404).send(error("Outlet not found"));
    return null;
  }
  return ctx;
}

export async function syncRoutes(fastify: FastifyInstance) {
  // ─── Push (POS → Cloud) ───
  fastify.post("/api/v1/sync/push", { bodyLimit: 5 * 1024 * 1024 }, async (request, reply) => {
    const body = (request.body ?? {}) as { events?: unknown };
    const events = body.events;
    if (!Array.isArray(events)) {
      return reply.status(400).send(error("Invalid payload format: events[] is required"));
    }
    if (events.length > MAX_EVENTS_PER_PUSH) {
      return reply.status(413).send(error(`Too many events in one push (max ${MAX_EVENTS_PER_PUSH})`));
    }

    // The outlet comes from the header; older POS builds only put it in the payload
    const firstPayload = (events[0] as { payload?: { outletId?: unknown } } | undefined)?.payload;
    const claimedOutletId =
      header(request, "x-outlet-id") ?? (typeof firstPayload?.outletId === "string" ? firstPayload.outletId : undefined);

    const ctx = await authenticatePos(request, reply, claimedOutletId);
    if (!ctx) return reply;

    const jobs = [];
    for (const raw of events) {
      const event = raw as { id?: unknown; eventType?: unknown; payload?: unknown; localTimestamp?: unknown };
      if (
        !event ||
        typeof event.eventType !== "string" ||
        !KNOWN_EVENT_TYPE.test(event.eventType) ||
        !event.payload ||
        typeof event.payload !== "object" ||
        Array.isArray(event.payload)
      ) {
        return reply.status(400).send(error("Each event needs an eventType and an object payload"));
      }

      const payload = event.payload as Record<string, unknown>;
      // A POS may only report on its own outlet
      if (isUuid(payload.outletId) && payload.outletId.toLowerCase() !== ctx.outletId) {
        return reply.status(403).send(error("Event outlet does not match the authenticated outlet"));
      }

      const localTimestamp =
        typeof event.localTimestamp === "string" && !Number.isNaN(Date.parse(event.localTimestamp))
          ? event.localTimestamp
          : new Date().toISOString();

      jobs.push({
        name: event.eventType,
        data: {
          eventType: event.eventType,
          // Tenant identity is always the server-verified one, never the client's claim
          payload: { ...payload, outletId: ctx.outletId, organizationId: ctx.organizationId },
          localTimestamp,
          ctx,
        },
        // The POS outbox id makes a re-sent event (lost response, retry) a no-op
        opts: typeof event.id === "string" && event.id.length <= 64 ? { jobId: `pos-${event.id}` } : undefined,
      });
    }

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
    const { outletId } = request.query as { outletId?: string };
    const ctx = await authenticatePos(request, reply, outletId ?? header(request, "x-outlet-id"));
    if (!ctx) return reply;

    try {
      const rows = await db
        .select()
        .from(schema.syncQueue)
        .where(and(eq(schema.syncQueue.outletId, ctx.outletId), eq(schema.syncQueue.status, "PENDING")))
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
    const { outletId, results } = (request.body ?? {}) as {
      outletId?: string;
      results?: { id: string; ok: boolean; message?: string }[];
    };
    const ctx = await authenticatePos(request, reply, outletId ?? header(request, "x-outlet-id"));
    if (!ctx) return reply;
    if (!Array.isArray(results)) {
      return reply.status(400).send(error("results[] is required"));
    }

    const now = new Date();
    for (const r of results.slice(0, 500)) {
      if (!r?.id || !isUuid(r.id)) continue;
      const current = await db.query.syncQueue.findFirst({
        where: and(eq(schema.syncQueue.id, r.id), eq(schema.syncQueue.outletId, ctx.outletId)),
      });
      if (!current || current.status !== "PENDING") continue;

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
        request.log.warn(
          { commandId: r.id, attempt: retryCount, reason: r.message ?? "unknown error" },
          "POS could not apply ERP command"
        );
      }
    }

    return reply.send(success({ acknowledged: results.length }));
  });

  // ─── Heartbeat (POS → Cloud) ───
  // The POS reports in every ~30s. One row per outlet is kept up to date; the
  // ERP's Edge Sync Monitor derives ONLINE / DEGRADED / OFFLINE from its age.
  fastify.post("/api/v1/sync/heartbeat", async (request, reply) => {
    const body = (request.body ?? {}) as {
      outletId?: string;
      latencyMs?: unknown;
      pendingUploads?: unknown;
      deadUploads?: unknown;
      posVersion?: unknown;
    };
    const ctx = await authenticatePos(request, reply, body.outletId ?? header(request, "x-outlet-id"));
    if (!ctx) return reply;

    const int = (v: unknown, max: number) => {
      const n = Math.trunc(Number(v));
      return Number.isFinite(n) && n >= 0 ? Math.min(n, max) : 0;
    };
    const now = new Date();
    const values = {
      lastSeen: now,
      latencyMs: int(body.latencyMs, 600_000),
      pendingUploads: int(body.pendingUploads, 10_000_000),
      deadUploads: int(body.deadUploads, 10_000_000),
      posVersion: typeof body.posVersion === "string" ? body.posVersion.slice(0, 30) : null,
      status: "ONLINE",
      updatedAt: now,
    };

    const updated = await db
      .update(schema.posHeartbeats)
      .set(values)
      .where(eq(schema.posHeartbeats.outletId, ctx.outletId))
      .returning({ id: schema.posHeartbeats.id });
    if (updated.length === 0) {
      await db.insert(schema.posHeartbeats).values({ outletId: ctx.outletId, ...values });
    }

    return reply.send(success({ serverTime: now.toISOString() }));
  });

  // ─── Sync status (ERP) ───
  fastify.get(
    "/api/v1/sync/status",
    { preHandler: [fastify.authenticate, requireMinRole("MANAGER")] },
    async (request, reply) => {
      const orgId = getOrganizationId(request);

      const [outlets, heartbeats, commandCounts] = await Promise.all([
        db.query.outlets.findMany({
          where: eq(schema.outlets.organizationId, orgId),
          columns: { id: true, name: true },
          orderBy: (o, { asc: a }) => [a(o.name)],
        }),
        db
          .select({ hb: schema.posHeartbeats })
          .from(schema.posHeartbeats)
          .innerJoin(schema.outlets, eq(schema.outlets.id, schema.posHeartbeats.outletId))
          .where(eq(schema.outlets.organizationId, orgId)),
        db
          .select({ outletId: schema.syncQueue.outletId, pending: sql<number>`count(*)::int` })
          .from(schema.syncQueue)
          .innerJoin(schema.outlets, eq(schema.outlets.id, schema.syncQueue.outletId))
          .where(and(eq(schema.outlets.organizationId, orgId), eq(schema.syncQueue.status, "PENDING")))
          .groupBy(schema.syncQueue.outletId)
          .catch((err) => {
            if (isMissingTable(err)) return [] as { outletId: string; pending: number }[];
            throw err;
          }),
      ]);

      // Latest heartbeat per outlet
      const latest = new Map<string, (typeof heartbeats)[number]["hb"]>();
      for (const { hb } of heartbeats) {
        const current = latest.get(hb.outletId);
        if (!current || current.lastSeen < hb.lastSeen) latest.set(hb.outletId, hb);
      }
      const pendingByOutlet = new Map(commandCounts.map((c) => [c.outletId, Number(c.pending)]));

      const now = Date.now();
      const data: OutletSyncStatus[] = outlets.map((outlet) => {
        const hb = latest.get(outlet.id);
        const age = hb ? Math.max(0, Math.round((now - hb.lastSeen.getTime()) / 1000)) : null;
        // Heartbeats arrive every 30s: a couple missed is "late", several is "down"
        const status: OutletSyncStatus["status"] =
          age === null ? "NEVER" : age <= 90 ? "ONLINE" : age <= 300 ? "DEGRADED" : "OFFLINE";
        return {
          outletId: outlet.id,
          outletName: outlet.name,
          status,
          lastSeen: hb ? hb.lastSeen.toISOString() : null,
          secondsSinceLastSeen: age,
          latencyMs: hb ? hb.latencyMs : null,
          pendingUploads: hb ? hb.pendingUploads : null,
          deadUploads: hb ? hb.deadUploads : null,
          pendingCommands: pendingByOutlet.get(outlet.id) ?? 0,
          posVersion: hb?.posVersion ?? null,
        };
      });

      return reply.send(success(data));
    }
  );

  // ─── Pull (Cloud → POS) ───
  fastify.get("/api/v1/sync/pull", async (request, reply) => {
    const { outletId: queryOutletId, since } = request.query as {
      outletId?: string;
      since?: string;
    };

    const ctx = await authenticatePos(request, reply, queryOutletId ?? header(request, "x-outlet-id"));
    if (!ctx) return reply;
    const outletId = ctx.outletId;

    const outlet = await db.query.outlets.findFirst({
      where: eq(schema.outlets.id, outletId),
    });
    if (!outlet) {
      return reply.status(404).send(error("Outlet not found"));
    }

    // An unparseable `since` means "send everything" rather than a 500
    const parsedSince = since ? new Date(since) : null;
    const sinceDate = parsedSince && !Number.isNaN(parsedSince.getTime()) ? parsedSince : null;

    // 1. Menu Categories (modified since)
    const menuCategories = await db
      .select()
      .from(schema.menuCategories)
      .where(eq(schema.menuCategories.outletId, outletId));

    // 2. Menu Items (with updatedAt filter)
    const menuItemConditions = [eq(schema.menuItems.outletId, outletId)];
    if (sinceDate) {
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
