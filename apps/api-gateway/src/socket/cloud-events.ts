import { Server, Socket } from "socket.io";
import { Redis } from "ioredis";
import { eq, and } from "drizzle-orm";
import { db } from "../db/index.js";
import * as cloudSchema from "@gusto/db-schema/cloud";

// We keep a single instance of the pub/sub connection for the API gateway
const REDIS_URL = process.env.REDIS_URL ?? "redis://localhost:6379";
const subClient = new Redis(REDIS_URL);

export function initCloudSocket(io: Server) {
  io.on("connection", (socket: Socket) => {
    console.log(`[Cloud Socket] Client connected: ${socket.id}`);

    // Allow POS and Web Admin clients to join their organization/outlet room.
    socket.on("join:store", (data: { organizationId: string; outletId?: string }) => {
      if (data?.organizationId) {
        socket.join(`org:${data.organizationId}`);
      }
      if (data?.organizationId && data?.outletId) {
        const room = `store:${data.organizationId}:${data.outletId}`;
        socket.join(room);
        console.log(`[Cloud Socket] Client ${socket.id} joined room: ${room}`);
      }
      
      socket.emit("store:joined", { success: true, ...data });
    });

    // Handle incoming real-time sync events from the local POS
    socket.on("sync:push_realtime", async (data: any) => {
      console.log(`[Cloud Socket] Received real-time sync payload from POS:`, data);

      if (data?.eventType === "TABLE_STATUS_CHANGED" && data.payload?.status) {
        const { tableId, tableName, status } = data.payload;
        try {
          let targetTable = null;
          if (tableId && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(tableId)) {
            targetTable = await db.query.diningTables.findFirst({
              where: eq(cloudSchema.diningTables.id, tableId),
            });
          }
          if (!targetTable && tableName && data.outletId) {
            targetTable = await db.query.diningTables.findFirst({
              where: and(
                eq(cloudSchema.diningTables.outletId, data.outletId),
                eq(cloudSchema.diningTables.name, tableName)
              ),
            });
          }

          if (targetTable) {
            await db.update(cloudSchema.diningTables)
              .set({ status })
              .where(eq(cloudSchema.diningTables.id, targetTable.id));
            console.log(`[Cloud Socket] ✅ Synced table ${targetTable.name} (${targetTable.id}) status to ${status} in Cloud ERP`);
            data.payload.tableId = targetTable.id;
            data.payload.tableName = targetTable.name;
          }
        } catch (err) {
          console.error(`[Cloud Socket] Failed to update table status:`, err);
        }
      }
      
      // Broadcast to any web-admin clients connected to this store or organization
      if (data?.organizationId && data?.outletId) {
        socket.to(`store:${data.organizationId}:${data.outletId}`).emit("cloud:sync_update", data);
      }
      if (data?.organizationId) {
        socket.to(`org:${data.organizationId}`).emit("cloud:sync_update", data);
      }
    });

    socket.on("disconnect", () => {
      console.log(`[Cloud Socket] Client disconnected: ${socket.id}`);
    });
  });

  // Subscribe to Redis events published by sync-worker
  subClient.subscribe("sync-events", (err, count) => {
    if (err) {
      console.error("[Cloud Socket] Failed to subscribe to Redis sync-events channel", err);
    } else {
      console.log(`[Cloud Socket] Subscribed to sync-events (total subscriptions: ${count})`);
    }
  });

  subClient.on("message", (channel, message) => {
    if (channel === "sync-events") {
      try {
        const data = JSON.parse(message);
        console.log(`[Cloud Socket] Relaying Redis event: ${data.eventType} (org: ${data.organizationId}, outlet: ${data.outletId})`);
        // Relay the real-time update to the connected outlet clients and web-admin users
        if (data.organizationId && data.outletId) {
          io.to(`store:${data.organizationId}:${data.outletId}`).emit("cloud:sync_update", data);
        }
        if (data.organizationId) {
          io.to(`org:${data.organizationId}`).emit("cloud:sync_update", data);
        }
      } catch (err) {
        console.error("[Cloud Socket] Error parsing Redis message", err);
      }
    }
  });
}
