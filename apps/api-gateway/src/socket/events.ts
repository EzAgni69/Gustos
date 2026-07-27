/**
 * Gusto Cloud API Gateway — Socket.IO Event Hub
 *
 * Real-time communication hub for the cloud-only MVP.
 * Devices join outlet-scoped rooms for isolated broadcasting.
 *
 * Channels (per outlet):
 * - `outlet:{outletId}:kitchen`  — KDS TV screens
 * - `outlet:{outletId}:captains` — Waiter mobile apps
 * - `outlet:{outletId}:pos`      — Billing UI
 * - `outlet:{outletId}`          — All devices in the outlet (broadcasts)
 */

import type { Server as SocketIOServer } from "socket.io";

let io: SocketIOServer | null = null;

/**
 * Initialize Socket.IO event handlers on the cloud gateway.
 */
export function initSocketEvents(socketServer: SocketIOServer): void {
  io = socketServer;

  io.on("connection", (socket) => {
    console.log(`[Socket.IO] Device connected: ${socket.id}`);

    // Join an outlet room (required for all devices)
    socket.on("join:outlet", (outletId: string) => {
      socket.join(`outlet:${outletId}`);
      socket.data.outletId = outletId;
      console.log(`[Socket.IO] ${socket.id} joined outlet: ${outletId}`);
    });

    // Join kitchen channel (KDS screens)
    socket.on("join:kitchen", (outletId: string) => {
      socket.join(`outlet:${outletId}:kitchen`);
      socket.data.outletId = outletId;
      console.log(`[Socket.IO] ${socket.id} joined kitchen: ${outletId}`);
    });

    // Join captain channel (waiter apps)
    socket.on("join:captain", (outletId: string) => {
      socket.join(`outlet:${outletId}:captains`);
      socket.data.outletId = outletId;
      console.log(`[Socket.IO] ${socket.id} joined captains: ${outletId}`);
    });

    // Join POS channel (billing UI)
    socket.on("join:pos", (outletId: string) => {
      socket.join(`outlet:${outletId}:pos`);
      socket.data.outletId = outletId;
      console.log(`[Socket.IO] ${socket.id} joined POS: ${outletId}`);
    });

    socket.on("disconnect", () => {
      console.log(`[Socket.IO] Device disconnected: ${socket.id}`);
    });
  });
}

/**
 * Get the Socket.IO server instance.
 */
export function getIO(): SocketIOServer | null {
  return io;
}

// ─── Event Emitters ───

/**
 * Emit a new KOT event to the kitchen display for a specific outlet.
 */
export function emitKOTNew(outletId: string, kotData: Record<string, unknown>): void {
  io?.to(`outlet:${outletId}:kitchen`).emit("kot:new", kotData);
  io?.to(`outlet:${outletId}:pos`).emit("kot:new", kotData);
}

/**
 * Emit a KOT status update to kitchen + captains for a specific outlet.
 */
export function emitKOTStatusUpdate(
  outletId: string,
  kotId: string,
  status: string,
  orderNumber: string
): void {
  const data = { kotId, status, orderNumber };
  io?.to(`outlet:${outletId}:kitchen`).emit("kot:status-update", data);
  io?.to(`outlet:${outletId}:captains`).emit("kot:status-update", data);
  io?.to(`outlet:${outletId}:pos`).emit("kot:status-update", data);
}

/**
 * Emit an order update to all devices in the outlet.
 */
export function emitOrderUpdated(outletId: string, orderData: Record<string, unknown>): void {
  io?.to(`outlet:${outletId}`).emit("order:updated", orderData);
}

/**
 * Emit an order created event to all devices in the outlet.
 */
export function emitOrderCreated(outletId: string, orderData: Record<string, unknown>): void {
  io?.to(`outlet:${outletId}`).emit("order:created", orderData);
}

/**
 * Emit a table status change to all devices in the outlet.
 */
export function emitTableStatusChanged(outletId: string, tableData: Record<string, unknown>): void {
  io?.to(`outlet:${outletId}`).emit("table:status-changed", tableData);
}
