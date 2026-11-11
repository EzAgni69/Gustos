/**
 * Gusto API Gateway — Realtime (Socket.IO) hub
 *
 * Two kinds of clients connect:
 *
 *  - ERP users (web-admin) authenticate with their JWT and may only listen to
 *    their own organization's rooms.
 *  - Outlet POS servers authenticate with the POS API key and may only join
 *    and publish for their own outlet.
 *
 * A connection that presents neither is refused. Room membership is always
 * derived from the verified identity, never from what the client asks for.
 */

import type { Server, Socket } from "socket.io";
import { Redis } from "ioredis";
import { eq, and } from "drizzle-orm";
import { db } from "../db/index.js";
import * as cloudSchema from "@gusto/db-schema/cloud";
import { checkPosApiKey, resolveOutletContext, isUuid } from "../utils/pos-auth.js";
import type { JWTPayload } from "../plugins/auth.js";

const REDIS_URL = process.env.REDIS_URL ?? "redis://localhost:6379";

type SocketIdentity =
  | { kind: "user"; organizationId: string; userId: string; outletId: string | null }
  | { kind: "pos"; organizationId: string; outletId: string };

const TABLE_STATUSES = ["AVAILABLE", "OCCUPIED", "RESERVED", "CLEANING"] as const;
type TableStatus = (typeof TABLE_STATUSES)[number];

let subClient: Redis | null = null;

export function initCloudSocket(io: Server, verifyJwt: (token: string) => JWTPayload) {
  // ─── Authentication ───
  io.use(async (socket, next) => {
    try {
      const auth = (socket.handshake.auth ?? {}) as {
        token?: unknown;
        posApiKey?: unknown;
        outletId?: unknown;
      };

      // ERP user
      if (typeof auth.token === "string" && auth.token) {
        let payload: JWTPayload;
        try {
          payload = verifyJwt(auth.token);
        } catch {
          return next(new Error("Unauthorized: invalid or expired token"));
        }
        const user = await db.query.users.findFirst({
          where: eq(cloudSchema.users.id, payload.id),
          columns: { id: true, isActive: true, organizationId: true, outletId: true },
        });
        if (!user || !user.isActive) return next(new Error("Unauthorized: account is not active"));
        socket.data.identity = {
          kind: "user",
          organizationId: user.organizationId,
          userId: user.id,
          outletId: user.outletId,
        } satisfies SocketIdentity;
        return next();
      }

      // Outlet POS
      const outletId = typeof auth.outletId === "string" ? auth.outletId : undefined;
      const check = checkPosApiKey(typeof auth.posApiKey === "string" ? auth.posApiKey : undefined, outletId);
      if (!check.ok) return next(new Error(`Unauthorized: ${check.message}`));

      const ctx = await resolveOutletContext(check.boundOutletId ?? outletId);
      if (!ctx) return next(new Error("Unauthorized: unknown outlet"));
      socket.data.identity = { kind: "pos", organizationId: ctx.organizationId, outletId: ctx.outletId } satisfies SocketIdentity;
      return next();
    } catch (err) {
      console.error("[Cloud Socket] Authentication error:", err);
      return next(new Error("Unauthorized"));
    }
  });

  io.on("connection", (socket: Socket) => {
    const identity = socket.data.identity as SocketIdentity;

    // ERP users hear their whole organization; a POS hears only its own outlet
    if (identity.kind === "pos") {
      socket.join(`store:${identity.organizationId}:${identity.outletId}`);
    } else {
      socket.join(`org:${identity.organizationId}`);
    }

    /**
     * Join an outlet room. The organization always comes from the verified
     * identity; an ERP user may pick any outlet of their own organization.
     */
    socket.on("join:store", async (data: { outletId?: unknown } | undefined) => {
      try {
        if (identity.kind === "pos") {
          socket.emit("store:joined", {
            success: true,
            organizationId: identity.organizationId,
            outletId: identity.outletId,
            room: `store:${identity.organizationId}:${identity.outletId}`,
          });
          return;
        }

        const outletId = isUuid(data?.outletId) ? data.outletId : null;
        // Leave any outlet room joined earlier (outlet switcher)
        for (const room of socket.rooms) {
          if (room.startsWith("store:")) socket.leave(room);
        }
        if (outletId) {
          const ctx = await resolveOutletContext(outletId);
          if (!ctx || ctx.organizationId !== identity.organizationId) {
            socket.emit("store:joined", { success: false, message: "Outlet not found" });
            return;
          }
          socket.join(`store:${identity.organizationId}:${ctx.outletId}`);
        }
        socket.emit("store:joined", {
          success: true,
          organizationId: identity.organizationId,
          outletId,
          room: outletId ? `store:${identity.organizationId}:${outletId}` : `org:${identity.organizationId}`,
        });
      } catch (err) {
        console.error("[Cloud Socket] join:store failed:", err);
        socket.emit("store:joined", { success: false, message: "Could not join outlet" });
      }
    });

    // Real-time pushes from the outlet POS (e.g. live table status)
    socket.on("sync:push_realtime", async (data: any) => {
      if (identity.kind !== "pos" || !data || typeof data !== "object") return;

      // Identity is ours, not the client's
      const event = { ...data, organizationId: identity.organizationId, outletId: identity.outletId };

      if (event.eventType === "TABLE_STATUS_CHANGED" && event.payload && typeof event.payload === "object") {
        const { tableId, tableName } = event.payload as { tableId?: unknown; tableName?: unknown };
        const status = String((event.payload as { status?: unknown }).status ?? "").toUpperCase();
        if (!(TABLE_STATUSES as readonly string[]).includes(status)) return;

        try {
          let targetTable = null;
          if (isUuid(tableId)) {
            targetTable = await db.query.diningTables.findFirst({
              where: and(eq(cloudSchema.diningTables.id, tableId), eq(cloudSchema.diningTables.outletId, identity.outletId)),
            });
          }
          if (!targetTable && typeof tableName === "string" && tableName) {
            targetTable = await db.query.diningTables.findFirst({
              where: and(
                eq(cloudSchema.diningTables.outletId, identity.outletId),
                eq(cloudSchema.diningTables.name, tableName)
              ),
            });
          }

          if (targetTable) {
            await db
              .update(cloudSchema.diningTables)
              .set({ status: status as TableStatus })
              .where(eq(cloudSchema.diningTables.id, targetTable.id));
            event.payload = { ...event.payload, tableId: targetTable.id, tableName: targetTable.name, status };
          }
        } catch (err) {
          console.error("[Cloud Socket] Failed to update table status:", err);
        }
      }

      // Fan out to ERP users watching this organization (store rooms are a subset of the org room)
      socket.to(`org:${identity.organizationId}`).emit("cloud:sync_update", event);
    });
  });

  // ─── Relay events published by the sync-worker / ERP routes ───
  subClient = new Redis(REDIS_URL, { maxRetriesPerRequest: null });
  subClient.on("error", (err) => console.error("[Cloud Socket] Redis subscriber error:", err.message));

  subClient.subscribe("sync-events", (err) => {
    if (err) console.error("[Cloud Socket] Failed to subscribe to Redis sync-events channel", err);
  });

  subClient.on("message", (channel, message) => {
    if (channel !== "sync-events") return;
    try {
      const data = JSON.parse(message);
      if (!isUuid(data?.organizationId)) return;
      // Outlet room first (its POS + users viewing it), then the rest of the
      // organization, excluding that room so nobody receives the event twice.
      if (isUuid(data.outletId)) {
        const store = `store:${data.organizationId}:${data.outletId}`;
        io.to(store).emit("cloud:sync_update", data);
        io.to(`org:${data.organizationId}`).except(store).emit("cloud:sync_update", data);
      } else {
        io.to(`org:${data.organizationId}`).emit("cloud:sync_update", data);
      }
    } catch (err) {
      console.error("[Cloud Socket] Error parsing Redis message", err);
    }
  });
}

/** Close the Redis subscriber (graceful shutdown). */
export async function closeCloudSocket(): Promise<void> {
  const client = subClient;
  subClient = null;
  if (client) await client.quit().catch(() => client.disconnect());
}
