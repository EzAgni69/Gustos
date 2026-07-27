/**
 * Gusto POS Local Server — Socket.IO Event Handlers
 *
 * Manages real-time communication with LAN devices:
 * - KDS (kitchen display) — receives KOT events
 * - Captain App — receives order/table updates
 */

import type { Server as SocketIOServer } from "socket.io";

let io: SocketIOServer | null = null;

/**
 * Initialize Socket.IO event handlers.
 */
export function initSocketEvents(socketServer: SocketIOServer): void {
  io = socketServer;

  io.on("connection", (socket) => {
    console.log(`[Socket.IO] Device connected: ${socket.id}`);

    socket.on("join:kitchen", () => {
      socket.join("kitchen");
      console.log(`[Socket.IO] ${socket.id} joined kitchen channel`);
    });

    socket.on("join:captain", () => {
      socket.join("captains");
      console.log(`[Socket.IO] ${socket.id} joined captains channel`);
    });

    socket.on("join:pos", () => {
      socket.join("pos");
      console.log(`[Socket.IO] ${socket.id} joined POS channel`);
    });

    socket.on("disconnect", () => {
      console.log(`[Socket.IO] Device disconnected: ${socket.id}`);
    });
  });
}

/**
 * Emit a new KOT event to the kitchen display.
 */
export function emitKOTNew(kotData: Record<string, unknown>): void {
  io?.to("kitchen").emit("kot:new", kotData);
}

/**
 * Emit a KOT status update to kitchen + captains.
 */
export function emitKOTStatusUpdate(
  kotId: string,
  status: string,
  orderNumber: string
): void {
  const data = { kotId, status, orderNumber };
  io?.to("kitchen").emit("kot:status-update", data);
  io?.to("captains").emit("kot:status-update", data);
}

/**
 * Emit an order update to captains.
 */
export function emitOrderUpdated(orderData: Record<string, unknown>): void {
  io?.to("captains").emit("order:updated", orderData);
  io?.to("pos").emit("order:updated", orderData);
}

/**
 * Emit a table status change to all devices.
 */
export function emitTableStatusChanged(tableData: Record<string, unknown>): void {
  io?.emit("table:status-changed", tableData);
}
