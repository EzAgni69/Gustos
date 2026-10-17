import { Server, Socket } from "socket.io";
import { Redis } from "ioredis";
import { eq } from "drizzle-orm";
import { db } from "../db/index.js";
import * as cloudSchema from "@gusto/db-schema/cloud";

// We keep a single instance of the pub/sub connection for the API gateway
const REDIS_URL = process.env.REDIS_URL ?? "redis://localhost:6379";
const subClient = new Redis(REDIS_URL);

export function initCloudSocket(io: Server) {
  io.on("connection", (socket: Socket) => {
    console.log(`[Cloud Socket] Client connected: ${socket.id}`);

    // Allow POS clients to join their organization/outlet room.
    socket.on("join:store", (data: { organizationId: string; outletId: string }) => {
      const room = `store:${data.organizationId}:${data.outletId}`;
      socket.join(room);
      console.log(`[Cloud Socket] Client ${socket.id} joined room: ${room}`);
      
      socket.emit("store:joined", { room, success: true });
    });

    // Handle incoming real-time sync events from the local POS
    socket.on("sync:push_realtime", async (data: any) => {
      console.log(`[Cloud Socket] Received real-time sync payload from POS:`, data);

      if (data?.eventType === "TABLE_STATUS_CHANGED" && data.payload?.tableId && data.payload?.status) {
        try {
          await db.update(cloudSchema.diningTables)
            .set({ status: data.payload.status })
            .where(eq(cloudSchema.diningTables.id, data.payload.tableId));
          console.log(`[Cloud Socket] ✅ Synced table ${data.payload.tableId} status to ${data.payload.status} in Cloud ERP`);
        } catch (err) {
          console.error(`[Cloud Socket] Failed to update table status:`, err);
        }
      }
      
      // We can also broadcast this back to any web-admin clients connected to this room
      if (data?.organizationId && data?.outletId) {
        socket.to(`store:${data.organizationId}:${data.outletId}`).emit("cloud:sync_update", data);
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
        console.log(`[Cloud Socket] Relaying Redis event to room store:${data.organizationId}:${data.outletId}`, data.eventType);
        // Relay the real-time update to the connected outlet clients and web-admin users
        io.to(`store:${data.organizationId}:${data.outletId}`).emit("cloud:sync_update", data);
      } catch (err) {
        console.error("[Cloud Socket] Error parsing Redis message", err);
      }
    }
  });
}
