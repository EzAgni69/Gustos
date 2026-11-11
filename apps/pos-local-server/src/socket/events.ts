/**
 * Gusto POS Local Server — Socket.IO Event Handlers
 *
 * Manages real-time communication with LAN devices:
 * - KDS (kitchen display) — receives KOT events
 * - Captain App — receives order/table updates
 */

import type { Server as SocketIOServer } from "socket.io";
import { afterCommit } from "../db/tx.js";

let io: SocketIOServer | null = null;
const lockedTables = new Map<string, { lockedBy: string; socketId: string }>(); // tableId -> lock owner

/**
 * Initialize Socket.IO event handlers.
 */
export function initSocketEvents(socketServer: SocketIOServer): void {
  io = socketServer;

  io.on("connection", (socket) => {

    socket.on("join:kitchen", (outletId?: string) => {
      socket.join("kitchen");
      if (outletId) {
        socket.join(`kitchen:${outletId}`);
      }
      console.log(`[Socket.IO] ${socket.id} joined kitchen channel${outletId ? ` (${outletId})` : ""}`);
    });

    socket.on("join:captain", () => {
      socket.join("captains");
      console.log(`[Socket.IO] ${socket.id} joined captains channel`);
    });

    socket.on("join:pos", () => {
      socket.join("pos");
      console.log(`[Socket.IO] ${socket.id} joined POS channel`);
      
      // Send current locks to newly joined POS clients
      socket.emit(
        "table:locks-sync",
        Array.from(lockedTables.entries()).map(([tableId, lock]) => [tableId, lock.lockedBy])
      );
    });

    // ─── Table Locking Logic ───
    // A lock belongs to the socket that took it and is released when that
    // device disconnects, so a crashed tablet can never leave a table stuck.

    socket.on("table:lock", (data: { tableId?: unknown; lockedBy?: unknown } | undefined) => {
      const tableId = typeof data?.tableId === "string" ? data.tableId : "";
      const lockedBy = typeof data?.lockedBy === "string" && data.lockedBy.trim() ? data.lockedBy.trim() : "Staff";
      if (!tableId) return;

      const existing = lockedTables.get(tableId);
      if (existing && existing.socketId !== socket.id) {
        // Someone else holds it — tell only the requester
        socket.emit("table:lock-denied", { tableId, lockedBy: existing.lockedBy });
        return;
      }
      lockedTables.set(tableId, { lockedBy, socketId: socket.id });
      io?.emit("table:locked", { tableId, lockedBy });
    });

    socket.on("table:unlock", (data: { tableId?: unknown } | undefined) => {
      const tableId = typeof data?.tableId === "string" ? data.tableId : "";
      // Only the device holding the lock may release it
      if (tableId && lockedTables.get(tableId)?.socketId === socket.id) {
        lockedTables.delete(tableId);
        io?.emit("table:unlocked", { tableId });
      }
    });

    socket.on("disconnect", () => {
      for (const [tableId, lock] of lockedTables) {
        if (lock.socketId === socket.id) {
          lockedTables.delete(tableId);
          io?.emit("table:unlocked", { tableId });
        }
      }
    });
  });
}

/**
 * Emit a new KOT event to the kitchen display and all devices.
 */
export function emitKOTNew(kotData: Record<string, unknown>): void {
  afterCommit(() => { io?.emit("kot:new", kotData); });
}

/**
 * Emit a KOT status update to kitchen, captains, and POS.
 */
export function emitKOTStatusUpdate(
  kotId: string,
  status: string,
  orderNumber: string,
  orderId?: string,
  extra: {
    kotNumber?: string;
    tableName?: string | null;
    waiterId?: string | null;
    waiterName?: string | null;
    orderMode?: string | null;
  } = {}
): void {
  const data = { kotId, status, orderNumber, orderId, ...extra };
  afterCommit(() => { io?.emit("kot:status-update", data); });
}

/**
 * Emit an order update to captains and POS.
 */
export function emitOrderUpdated(orderData: Record<string, unknown>): void {
  afterCommit(() => { io?.emit("order:updated", orderData); });

  // Every local order change (POS or Captain app) is mirrored to the Cloud ERP.
  // Updates relayed *from* the cloud carry no local change, so the snapshot hash
  // check inside syncOrderToCloud makes those a no-op.
  const order = orderData.order as { id?: unknown } | null | undefined;
  const orderId =
    typeof orderData.orderId === "string"
      ? orderData.orderId
      : typeof order?.id === "string"
        ? order.id
        : undefined;
  if (orderId) {
    import("../services/order-sync.service.js")
      .then(({ syncOrderToCloud }) => syncOrderToCloud(orderId))
      .catch(() => {});
  }
}

/**
 * Tell LAN devices (Captain, POS UI) the menu changed locally, e.g. an item was 86'd.
 */
export function emitMenuUpdated(data: Record<string, unknown>): void {
  afterCommit(() => { io?.emit("sync:menu-updated", { ...data, timestamp: new Date().toISOString() }); });
}

/**
 * Emit a table status change to all devices and notify Cloud ERP.
 */
export function emitTableStatusChanged(tableData: Record<string, unknown>): void {
  afterCommit(() => { io?.emit("table:status-changed", tableData); });
  if (typeof tableData.tableId === "string" && typeof tableData.status === "string") {
    import("../services/realtime-uplink.service.js").then(({ notifyCloudTableStatus }) => {
      notifyCloudTableStatus(
        tableData.tableId as string,
        tableData.status as string,
        typeof tableData.tableName === "string" ? tableData.tableName : undefined
      );
    }).catch(() => {});
  }
}

// ─── Edge Case Events ───

/**
 * Emit a KOT cancellation to all displays.
 */
export function emitKOTCancelled(data: {
  kotId: string;
  kotNumber: string;
  orderId: string;
  orderNumber: string;
  reason: string;
}): void {
  afterCommit(() => { io?.emit("kot:cancelled", data); });
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
  afterCommit(() => { io?.emit("kot:rush", data); });
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
  afterCommit(() => { io?.emit("kot:modification", data); });
}

/**
 * Emit a table swap event to all devices.
 */
export function emitTableSwapped(data: {
  tableAId: string;
  tableAName: string;
  tableBId: string;
  tableBName: string;
  orderAId?: string | null;
  orderBId?: string | null;
}): void {
  afterCommit(() => { io?.emit("table:swapped", data); });
  // Clients (Captain, POS UI) and the Cloud ERP only react to the generic events,
  // so re-announce both tables and both orders.
  emitTableStatusChanged({ tableId: data.tableAId, tableName: data.tableAName, status: "OCCUPIED", orderId: data.orderBId ?? undefined });
  emitTableStatusChanged({ tableId: data.tableBId, tableName: data.tableBName, status: "OCCUPIED", orderId: data.orderAId ?? undefined });
  if (data.orderAId) emitOrderUpdated({ type: "TABLE_SWAPPED", orderId: data.orderAId });
  if (data.orderBId) emitOrderUpdated({ type: "TABLE_SWAPPED", orderId: data.orderBId });
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
  sourceOrderId?: string | null;
}): void {
  afterCommit(() => { io?.emit("table:merged", data); });
  // As with swap: clients and the Cloud ERP only react to the generic events.
  // The source table's release is already announced by mergeOrders().
  emitOrderUpdated({ type: "TABLE_MERGED", orderId: data.targetOrderId });
  if (data.sourceOrderId) {
    emitOrderUpdated({ type: "TABLE_MERGED", orderId: data.sourceOrderId, mergedIntoOrderId: data.targetOrderId });
  }
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
  afterCommit(() => { io?.to("captains").emit("order:mode-changed", data); });
  afterCommit(() => { io?.to("pos").emit("order:mode-changed", data); });
  // KDS re-badges open tickets (e.g. dine-in switched to takeaway → pack it)
  afterCommit(() => { io?.to("kitchen").emit("order:mode-changed", data); });
  emitOrderUpdated({ type: "ORDER_MODE_CHANGED", orderId: data.orderId, orderNumber: data.orderNumber });
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
  afterCommit(() => { io?.to("captains").emit("order:items-moved", data); });
  afterCommit(() => { io?.to("pos").emit("order:items-moved", data); });
  emitOrderUpdated({ type: "ITEMS_MOVED", orderId: data.sourceOrderId });
  emitOrderUpdated({ type: "ITEMS_MOVED", orderId: data.targetOrderId });
}

/**
 * Emit a new online order to POS for acceptance.
 */
export function emitOnlineOrderReceived(data: Record<string, unknown>): void {
  afterCommit(() => { io?.to("pos").emit("online-order:received", data); });
}


// ─── Station readiness & Expo (pass) ───

/**
 * A station marked (or recalled) its part of a KOT. KDS station screens hide
 * the KOT once their station is in readyStations; Expo refreshes its checklist.
 */
export function emitKOTStationStatus(data: {
  kotId: string;
  kotNumber: string;
  orderId: string;
  stationId: string;
  requiredStations: string[];
  readyStations: string[];
  kotReady: boolean;
}): void {
  afterCommit(() => { io?.emit("kot:station-status", data); });
}

/**
 * The pass bumped a finished table order — food is ready for pickup.
 * Captain app alerts the assigned waiter; POS shows a toast; KDS refreshes.
 */
export function emitExpoOrderReady(data: {
  orderId: string;
  orderNumber: string;
  tableName: string | null;
  orderMode: string;
  platform: string | null;
  waiterId: string | null;
  waiterName: string | null;
  kotNumbers: string[];
  itemCount: number;
  stations: string[];
  forced: boolean;
  bumpedAt: string;
}): void {
  afterCommit(() => { io?.emit("expo:order-ready", data); });
}

/** The pass pulled an order back (bumped by mistake). */
export function emitExpoOrderRecalled(data: { orderId: string; orderNumber: string; tableName: string | null }): void {
  afterCommit(() => { io?.emit("expo:order-recalled", data); });
}
