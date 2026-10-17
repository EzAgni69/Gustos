/**
 * Gusto POS Local Server — Socket.IO Event Handlers
 *
 * Manages real-time communication with LAN devices:
 * - KDS (kitchen display) — receives KOT events
 * - Captain App — receives order/table updates
 */

import type { Server as SocketIOServer } from "socket.io";

let io: SocketIOServer | null = null;
const lockedTables = new Map<string, string>(); // tableId -> lockedBy (user name or ID)

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
      
      // Send current locks to newly joined POS clients
      socket.emit("table:locks-sync", Array.from(lockedTables.entries()));
    });

    // ─── Table Locking Logic ───
    
    socket.on("table:lock", (data: { tableId: string; lockedBy: string }) => {
      lockedTables.set(data.tableId, data.lockedBy);
      console.log(`[Socket.IO] Table ${data.tableId} locked by ${data.lockedBy}`);
      io?.emit("table:locked", { tableId: data.tableId, lockedBy: data.lockedBy });
    });

    socket.on("table:unlock", (data: { tableId: string }) => {
      if (lockedTables.has(data.tableId)) {
        lockedTables.delete(data.tableId);
        console.log(`[Socket.IO] Table ${data.tableId} unlocked`);
        io?.emit("table:unlocked", { tableId: data.tableId });
      }
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
 * Emit a table status change to all devices and notify Cloud ERP.
 */
export function emitTableStatusChanged(tableData: Record<string, unknown>): void {
  io?.emit("table:status-changed", tableData);
  if (typeof tableData.tableId === "string" && typeof tableData.status === "string") {
    import("../services/realtime-uplink.service.js").then(({ notifyCloudTableStatus }) => {
      notifyCloudTableStatus(tableData.tableId as string, tableData.status as string);
    }).catch(() => {});
  }
}

// ─── Edge Case Events ───

/**
 * Emit a KOT cancellation to kitchen displays.
 */
export function emitKOTCancelled(data: {
  kotId: string;
  kotNumber: string;
  orderId: string;
  orderNumber: string;
  reason: string;
}): void {
  io?.to("kitchen").emit("kot:cancelled", data);
  io?.to("captains").emit("kot:cancelled", data);
  io?.to("pos").emit("kot:cancelled", data);
}

/**
 * Emit a rush/priority alert to kitchen displays.
 */
export function emitKOTRush(data: {
  kotId: string;
  kotNumber: string;
  orderId: string;
  orderNumber: string;
  tableName?: string;
}): void {
  io?.to("kitchen").emit("kot:rush", data);
}

/**
 * Emit a modification KOT to kitchen displays.
 */
export function emitKOTModification(data: {
  kotId: string;
  kotNumber: string;
  orderId: string;
  orderNumber: string;
  tableName?: string;
  modifications: Array<{
    itemName: string;
    changeType: "MODIFIER_CHANGE" | "QUANTITY_CHANGE" | "NOTE_CHANGE";
    oldValue?: string;
    newValue?: string;
  }>;
}): void {
  io?.to("kitchen").emit("kot:modification", data);
}

/**
 * Emit a table swap event to all devices.
 */
export function emitTableSwapped(data: {
  tableAId: string;
  tableAName: string;
  tableBId: string;
  tableBName: string;
}): void {
  io?.emit("table:swapped", data);
}

/**
 * Emit a table merge event to all devices.
 */
export function emitTableMerged(data: {
  sourceTableId: string;
  sourceTableName: string;
  targetTableId: string;
  targetTableName: string;
  targetOrderId: string;
}): void {
  io?.emit("table:merged", data);
}

/**
 * Emit an order mode change to captains and POS.
 */
export function emitOrderModeChanged(data: {
  orderId: string;
  orderNumber: string;
  oldMode: string;
  newMode: string;
  tableId?: string | null;
}): void {
  io?.to("captains").emit("order:mode-changed", data);
  io?.to("pos").emit("order:mode-changed", data);
}

/**
 * Emit items moved between orders.
 */
export function emitOrderItemsMoved(data: {
  sourceOrderId: string;
  targetOrderId: string;
  movedItemCount: number;
  sourceTableName?: string;
  targetTableName?: string;
}): void {
  io?.to("captains").emit("order:items-moved", data);
  io?.to("pos").emit("order:items-moved", data);
}

/**
 * Emit a new online order to POS for acceptance.
 */
export function emitOnlineOrderReceived(data: Record<string, unknown>): void {
  io?.to("pos").emit("online-order:received", data);
}

