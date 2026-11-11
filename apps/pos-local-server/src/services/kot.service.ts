/**
 * Gusto POS Local Server — KOT Service
 *
 * Kitchen Order Ticket generation and status management.
 */

import { eq, and, ne } from "drizzle-orm";
import { v4 as uuid } from "uuid";
import * as schema from "@gusto/db-schema/local";
import { db } from "../db/index.js";
import { atomicFn } from "../db/tx.js";
import { getNextKOTNumber } from "./sequence.service.js";
import {
  buildKOTReceipt,
  buildModificationKOTReceipt,
  buildCancellationKOTReceipt,
  buildRushKOTReceipt,
  type KOTData,
} from "@gusto/printer";
import {
  emitKOTNew,
  emitKOTStatusUpdate,
  emitOrderUpdated,
  emitKOTCancelled,
  emitKOTRush,
  emitKOTModification,
} from "../socket/events.js";
import { queueSyncEvent } from "./sync.service.js";
import { queuePrint, isKotPrintingEnabled } from "./print.service.js";
import { getOrderChannel } from "./order-channel.js";
import { recalculateOrderTotals } from "./order.service.js";

/**
 * Generate a KOT for items in an order that haven't been sent to kitchen yet.
 */
export const generateKOT = atomicFn(function generateKOT(
  orderId: string,
  itemIds?: string[],
  station?: string,
  userId?: string
) {
  const order = db
    .select()
    .from(schema.orders)
    .where(eq(schema.orders.id, orderId))
    .get();

  if (!order) throw new Error("Order not found");
  if (["COMPLETED", "CANCELLED", "MERGED"].includes(order.status)) {
    throw new Error(`Cannot fire a KOT — order is ${order.status.toLowerCase()}`);
  }
  if (order.orderMode === "ONLINE" && order.status === "DRAFT") {
    throw new Error("Accept the online order before sending it to the kitchen");
  }
  if (itemIds !== undefined && !Array.isArray(itemIds)) {
    throw new Error("itemIds must be an array");
  }

  // Get items that need to be sent to kitchen
  const allItems = db
    .select()
    .from(schema.orderItems)
    .where(eq(schema.orderItems.orderId, orderId))
    .all();

  // Filter to only active (non-voided) items without a kotId (not yet sent), or specific itemIds
  const activeItems = allItems.filter((item) => item.status !== "VOIDED");
  const itemsToSend = itemIds
    ? activeItems.filter((item) => itemIds.includes(item.id) && !item.kotId)
    : activeItems.filter((item) => !item.kotId);

  if (itemsToSend.length === 0) {
    throw new Error("No items to send to kitchen");
  }

  // Create KOT record
  const kotId = uuid();
  const kotNumber = getNextKOTNumber();
  const now = new Date().toISOString();

  db.insert(schema.kitchenOrderTickets)
    .values({
      id: kotId,
      orderId,
      kotNumber,
      station: station ?? null,
      status: "PENDING",
      createdAt: now,
    })
    .run();

  // Create KOT items and link order items
  for (const item of itemsToSend) {
    db.insert(schema.kotItems)
      .values({
        id: uuid(),
        kotId,
        orderItemId: item.id,
        menuItemName: item.menuItemName,
        quantity: item.quantity,
        modifiers: item.modifiers,
        notes: item.notes,
      })
      .run();

    // Mark the order item as linked to this KOT
    db.update(schema.orderItems)
      .set({ kotId })
      .where(eq(schema.orderItems.id, item.id))
      .run();
  }

  // Update order status to IN_PROGRESS
  if (order.status === "DRAFT" || order.status === "PLACED") {
    db.update(schema.orders)
      .set({ status: "IN_PROGRESS", updatedAt: now })
      .where(eq(schema.orders.id, orderId))
      .run();
  }

  // Get table name for KOT
  let tableName: string | undefined;
  if (order.tableId) {
    const table = db
      .select()
      .from(schema.diningTables)
      .where(eq(schema.diningTables.id, order.tableId))
      .get();
    tableName = table?.name;
  }

  // Build KOT print template
  const kotData: KOTData = {
    kotNumber,
    orderNumber: order.orderNumber,
    tableName,
    waiterName: order.waiterName ?? undefined,
    station: station ?? undefined,
    items: itemsToSend.map((item) => ({
      name: item.menuItemName,
      quantity: item.quantity,
      modifiers: item.modifiers ? JSON.parse(item.modifiers) : undefined,
      notes: item.notes ?? undefined,
    })),
    createdAt: new Date(),
  };

  const printTemplate = buildKOTReceipt(kotData);

  console.log(`🍳 [KOT] ${kotNumber} fired — order ${order.orderNumber}, ${itemsToSend.length} item(s)`);

  // Paper ticket for kitchens that run a printer alongside (or instead of) the KDS
  if (isKotPrintingEnabled()) {
    queuePrint(printTemplate, "KOT", "kitchen").catch((err) => {
      console.warn("[Printer] Could not queue KOT print:", err);
    });
  }

  // Emit Socket.IO event to kitchen
  emitKOTNew({
    kotId,
    kotNumber,
    orderId,
    orderNumber: order.orderNumber,
    ...getOrderChannel(order),
    tableName,
    waiterName: order.waiterName,
    station,
    items: itemsToSend.map((item) => {
      const menuItem = item.menuItemId
        ? db
            .select()
            .from(schema.menuItems)
            .where(eq(schema.menuItems.id, item.menuItemId))
            .get()
        : null;
      return {
        name: item.menuItemName,
        variantName: item.variantName ?? null,
        categoryId: menuItem?.categoryId ?? null,
        quantity: item.quantity,
        modifiers: item.modifiers ? JSON.parse(item.modifiers) : [],
        notes: item.notes,
      };
    }),
    createdAt: now,
  });

  emitOrderUpdated({
    type: "KOT_GENERATED",
    kotId,
    kotNumber,
    orderId,
    orderNumber: order.orderNumber,
  });

  return {
    kotId,
    kotNumber,
    orderId,
    station,
    items: itemsToSend,
    printTemplate,
    createdAt: now,
  };
});

/**
 * List KOTs with optional status filter (for KDS display).
 */
export function listKOTs(status?: string) {
  const rawKots = status
    ? db
        .select()
        .from(schema.kitchenOrderTickets)
        .where(eq(schema.kitchenOrderTickets.status, status))
        .all()
    : db.select().from(schema.kitchenOrderTickets).all();

  // Exclude standalone MODIFICATION audit slips so KDS only shows the original updated KOT card
  const kots = rawKots.filter((k) => k.kotType !== "MODIFICATION");

  // Enrich with items and order info
  return kots
    .map((kot) => {
      const items = db
        .select()
        .from(schema.kotItems)
        .where(eq(schema.kotItems.kotId, kot.id))
        .all();

      const order = db
        .select()
        .from(schema.orders)
        .where(eq(schema.orders.id, kot.orderId))
        .get();

      let tableName: string | undefined;
      if (order?.tableId) {
        const table = db
          .select()
          .from(schema.diningTables)
          .where(eq(schema.diningTables.id, order.tableId))
          .get();
        tableName = table?.name;
      }

      const validItems = items
        .map((item) => {
          const orderItem = item.orderItemId
            ? db
                .select()
                .from(schema.orderItems)
                .where(eq(schema.orderItems.id, item.orderItemId))
                .get()
            : null;

          // If the linked order item is voided, exclude from kitchen display
          if (orderItem && orderItem.status === "VOIDED") {
            return null;
          }

          const menuItem = orderItem?.menuItemId
            ? db
                .select()
                .from(schema.menuItems)
                .where(eq(schema.menuItems.id, orderItem.menuItemId))
                .get()
            : null;

          return {
            ...item,
            quantity: orderItem ? orderItem.quantity : item.quantity,
            variantName: orderItem?.variantName ?? null,
            categoryId: menuItem?.categoryId ?? null,
            modifiers: item.modifiers ? JSON.parse(item.modifiers) : [],
          };
        })
        .filter((i): i is NonNullable<typeof i> => i !== null);

      return {
        ...kot,
        orderNumber: order?.orderNumber,
        ...getOrderChannel(order),
        tableName,
        items: validItems,
      };
    })
    .filter((kot) => kot.items.length > 0);
}

const KOT_STATUSES: readonly string[] = ["PENDING", "IN_PROGRESS", "READY", "SERVED"];

/**
 * Update KOT status.
 */
export const updateKOTStatus = atomicFn(function updateKOTStatus(
  kotId: string,
  status: "PENDING" | "IN_PROGRESS" | "READY" | "SERVED"
) {
  const kot = db
    .select()
    .from(schema.kitchenOrderTickets)
    .where(eq(schema.kitchenOrderTickets.id, kotId))
    .get();

  if (!kot) throw new Error("KOT not found");
  if (!KOT_STATUSES.includes(status)) {
    throw new Error(`status must be one of ${KOT_STATUSES.join(", ")}`);
  }
  if (kot.status === "CANCELLED") throw new Error("KOT is cancelled");
  if (kot.kotType === "MODIFICATION") throw new Error("Modification slips have no kitchen status");
  if (kot.status === status) {
    return { kotId, status, orderId: kot.orderId };
  }

  db.update(schema.kitchenOrderTickets)
    .set({ status })
    .where(eq(schema.kitchenOrderTickets.id, kotId))
    .run();

  // Get order number for the event
  const order = db
    .select()
    .from(schema.orders)
    .where(eq(schema.orders.id, kot.orderId))
    .get();

  // If all KOTs for this order are READY, update order status to READY
  if (status === "READY") {
    const allKOTs = db
      .select()
      .from(schema.kitchenOrderTickets)
      .where(eq(schema.kitchenOrderTickets.orderId, kot.orderId))
      .all();

    const allReady = allKOTs
      .filter((k) => k.kotType !== "MODIFICATION" && k.status !== "CANCELLED")
      .every((k) => (k.id === kotId ? true : k.status === "READY" || k.status === "SERVED"));

    if (allReady && order?.status !== "COMPLETED" && order?.status !== "CANCELLED") {
      db.update(schema.orders)
        .set({ status: "READY", updatedAt: new Date().toISOString() })
        .where(eq(schema.orders.id, kot.orderId))
        .run();

      emitOrderUpdated({
        type: "ORDER_READY",
        orderId: kot.orderId,
        orderNumber: order?.orderNumber,
      });

      if (order?.orderMode === "ONLINE") {
        const match = order.notes?.match(/onlineOrderId:([^\s|]+)/);
        const onlineOrderId = match ? match[1] : null;
        queueSyncEvent("ONLINE_ORDER_READY", { 
          orderId: kot.orderId, 
          orderNumber: order.orderNumber,
          onlineOrderId 
        });
      }
    }
  }

  // A ticket recalled to the kitchen means the order is no longer ready
  if ((status === "PENDING" || status === "IN_PROGRESS") && order?.status === "READY") {
    db.update(schema.orders)
      .set({ status: "IN_PROGRESS", updatedAt: new Date().toISOString() })
      .where(eq(schema.orders.id, kot.orderId))
      .run();
  }

  // Captains need table / waiter / KOT number to raise a "food ready" pickup alert.
  const tableName = order?.tableId
    ? db.select().from(schema.diningTables).where(eq(schema.diningTables.id, order.tableId)).get()?.name ?? null
    : null;
  emitKOTStatusUpdate(kotId, status, order?.orderNumber ?? "", kot.orderId, {
    kotNumber: kot.kotNumber,
    tableName,
    waiterId: order?.waiterId ?? null,
    waiterName: order?.waiterName ?? null,
    orderMode: order?.orderMode ?? null,
  });
  emitOrderUpdated({
    type: "KOT_STATUS_UPDATED",
    kotId,
    status,
    orderId: kot.orderId,
    orderNumber: order?.orderNumber,
  });

  return { kotId, status, orderId: kot.orderId };
});

// ─── Edge Case KOT Operations ───

/**
 * Items on a KOT that are still live (linked order item not voided), with the
 * current order-item quantity — used for reprint, rush and the POS KOT list.
 */
function getActiveKOTItems(kotId: string) {
  return db
    .select()
    .from(schema.kotItems)
    .where(eq(schema.kotItems.kotId, kotId))
    .all()
    .map((item) => {
      const orderItem = item.orderItemId
        ? db.select().from(schema.orderItems).where(eq(schema.orderItems.id, item.orderItemId)).get()
        : null;
      if (orderItem && orderItem.status === "VOIDED") return null;
      const menuItem = orderItem?.menuItemId
        ? db.select().from(schema.menuItems).where(eq(schema.menuItems.id, orderItem.menuItemId)).get()
        : null;
      return {
        ...item,
        quantity: orderItem ? orderItem.quantity : item.quantity,
        variantName: orderItem?.variantName ?? null,
        categoryId: menuItem?.categoryId ?? null,
      };
    })
    .filter((i): i is NonNullable<typeof i> => i !== null);
}

function getTableName(tableId: string | null | undefined): string | undefined {
  if (!tableId) return undefined;
  return db.select().from(schema.diningTables).where(eq(schema.diningTables.id, tableId)).get()?.name;
}

/**
 * Throw unless the KOT exists and belongs to the given order. Guards the
 * /orders/:orderId/kot/:kotId/* routes against mismatched IDs.
 */
export function assertKOTBelongsToOrder(kotId: string, orderId: string): void {
  const kot = db
    .select({ orderId: schema.kitchenOrderTickets.orderId })
    .from(schema.kitchenOrderTickets)
    .where(eq(schema.kitchenOrderTickets.id, kotId))
    .get();
  if (!kot) throw new Error("KOT not found");
  if (kot.orderId !== orderId) throw new Error("KOT does not belong to this order");
}

/**
 * List the kitchen tickets fired for one order (newest first), for the POS
 * KOT history panel. Modification audit slips are excluded. Cancelled KOTs are
 * included with their original items so staff can see what was cancelled.
 */
export function listKOTsForOrder(orderId: string) {
  return db
    .select()
    .from(schema.kitchenOrderTickets)
    .where(eq(schema.kitchenOrderTickets.orderId, orderId))
    .all()
    .filter((k) => k.kotType !== "MODIFICATION")
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
    .map((kot) => {
      const items =
        kot.status === "CANCELLED"
          ? db.select().from(schema.kotItems).where(eq(schema.kotItems.kotId, kot.id)).all()
          : getActiveKOTItems(kot.id);
      return {
        id: kot.id,
        kotNumber: kot.kotNumber,
        station: kot.station,
        status: kot.status,
        isRush: kot.isRush,
        cancelReason: kot.cancelReason,
        cancelApprovedBy: kot.cancelApprovedBy,
        cancelledAt: kot.cancelledAt,
        createdAt: kot.createdAt,
        items: items.map((i) => ({
          orderItemId: i.orderItemId,
          name: i.menuItemName,
          quantity: i.quantity,
          modifiers: i.modifiers ? (JSON.parse(i.modifiers) as string[]) : [],
          notes: i.notes ?? null,
        })),
      };
    })
    .filter((k) => k.status === "CANCELLED" || k.items.length > 0);
}

/**
 * Reprint a KOT — regenerates print template from existing data.
 * Marks output as "REPRINT" for kitchen clarity.
 */
export const reprintKOT = atomicFn(function reprintKOT(kotId: string) {
  const kot = db
    .select()
    .from(schema.kitchenOrderTickets)
    .where(eq(schema.kitchenOrderTickets.id, kotId))
    .get();

  if (!kot) throw new Error("KOT not found");
  if (kot.status === "CANCELLED") throw new Error("Cannot reprint a cancelled KOT");

  const order = db
    .select()
    .from(schema.orders)
    .where(eq(schema.orders.id, kot.orderId))
    .get();

  const activeReprintItems = getActiveKOTItems(kotId);

  if (activeReprintItems.length === 0) {
    throw new Error("No active items remaining on this KOT to reprint");
  }

  let tableName: string | undefined;
  if (order?.tableId) {
    const table = db
      .select()
      .from(schema.diningTables)
      .where(eq(schema.diningTables.id, order.tableId))
      .get();
    tableName = table?.name;
  }

  // Build reprint KOT template
  const kotData: KOTData = {
    kotNumber: `${kot.kotNumber} (REPRINT)`,
    orderNumber: order?.orderNumber ?? "--",
    tableName,
    waiterName: order?.waiterName ?? undefined,
    station: kot.station ?? undefined,
    items: activeReprintItems.map((item) => ({
      name: item.menuItemName,
      quantity: item.quantity,
      modifiers: item.modifiers ? JSON.parse(item.modifiers) : undefined,
      notes: item.notes ?? undefined,
    })),
    createdAt: new Date(kot.createdAt),
  };

  const printTemplate = buildKOTReceipt(kotData);

  // Physical reprint for the kitchen printer (jammed printer / lost slip)
  queuePrint(printTemplate, "KOT", "kitchen").catch((err) => {
    console.warn("[Printer] Could not queue KOT reprint:", err);
  });

  console.log(`🔄 [KOT] ${kot.kotNumber} reprinted — order ${order?.orderNumber}`);

  // Re-emit to kitchen with reprint flag
  emitKOTNew({
    kotId,
    kotNumber: kot.kotNumber,
    orderId: kot.orderId,
    orderNumber: order?.orderNumber,
    ...getOrderChannel(order),
    tableName,
    waiterName: order?.waiterName,
    station: kot.station,
    isReprint: true,
    items: activeReprintItems.map((item) => ({
      name: item.menuItemName,
      variantName: item.variantName,
      categoryId: item.categoryId,
      quantity: item.quantity,
      modifiers: item.modifiers ? JSON.parse(item.modifiers) : [],
      notes: item.notes,
    })),
    createdAt: kot.createdAt,
  });

  return { kotId, kotNumber: kot.kotNumber, printTemplate };
});

/**
 * Cancel an entire KOT — marks all linked items as voided.
 * Kitchen receives a cancellation alert on KDS.
 */
export const cancelKOT = atomicFn(function cancelKOT(
  kotId: string,
  reason: string,
  approvedBy: string,
  userId?: string
) {
  const kot = db
    .select()
    .from(schema.kitchenOrderTickets)
    .where(eq(schema.kitchenOrderTickets.id, kotId))
    .get();

  if (!kot) throw new Error("KOT not found");
  if (kot.status === "CANCELLED") throw new Error("KOT is already cancelled");
  if (kot.kotType === "MODIFICATION") throw new Error("Modification slips cannot be cancelled");
  const kotOrder = db.select({ status: schema.orders.status }).from(schema.orders).where(eq(schema.orders.id, kot.orderId)).get();
  if (kotOrder?.status === "COMPLETED") {
    throw new Error("Order is already paid — void the settled bill instead");
  }

  const now = new Date().toISOString();

  // Cancel the KOT
  db.update(schema.kitchenOrderTickets)
    .set({
      status: "CANCELLED",
      cancelledAt: now,
      cancelReason: reason,
      cancelApprovedBy: approvedBy,
    })
    .where(eq(schema.kitchenOrderTickets.id, kotId))
    .run();

  // Void all items linked to this KOT
  const kotItemsList = db
    .select()
    .from(schema.kotItems)
    .where(eq(schema.kotItems.kotId, kotId))
    .all();

  for (const kotItem of kotItemsList) {
    // Items voided earlier keep their original void reason / approver
    db.update(schema.orderItems)
      .set({
        status: "VOIDED",
        voidedAt: now,
        voidReason: `KOT ${kot.kotNumber} cancelled: ${reason}`,
        voidApprovedBy: approvedBy,
        isNcr: true,
      })
      .where(and(eq(schema.orderItems.id, kotItem.orderItemId), ne(schema.orderItems.status, "VOIDED")))
      .run();
  }

  db.delete(schema.kotStationStatus).where(eq(schema.kotStationStatus.kotId, kotId)).run();

  const order = db
    .select()
    .from(schema.orders)
    .where(eq(schema.orders.id, kot.orderId))
    .get();

  // Log event
  db.insert(schema.eventLog)
    .values({
      id: uuid(),
      orderId: kot.orderId,
      eventType: "KOT_CANCELLED",
      payload: JSON.stringify({
        kotId,
        kotNumber: kot.kotNumber,
        reason,
        approvedBy,
        itemsCancelled: kotItemsList.length,
      }),
      userId,
      createdAt: now,
    })
    .run();

  // The voided items no longer count towards the bill
  recalculateOrderTotals(kot.orderId);
  emitOrderUpdated({ type: "KOT_CANCELLED", kotId, orderId: kot.orderId, orderNumber: order?.orderNumber });

  // Emit cancellation to KDS
  emitKOTCancelled({
    kotId,
    kotNumber: kot.kotNumber,
    orderId: kot.orderId,
    orderNumber: order?.orderNumber ?? "",
    reason,
  });

  console.log(`\n❌ KOT CANCELLED — ${kot.kotNumber} (Reason: ${reason})`);

  let tableName: string | undefined;
  if (order?.tableId) {
    const table = db
      .select()
      .from(schema.diningTables)
      .where(eq(schema.diningTables.id, order.tableId))
      .get();
    tableName = table?.name;
  }

  // Queue physical cancellation slip for kitchen thermal printer
  const cancelPrintTemplate = buildCancellationKOTReceipt({
    kotNumber: kot.kotNumber,
    orderNumber: order?.orderNumber ?? "--",
    tableName,
    waiterName: order?.waiterName ?? undefined,
    station: kot.station ?? undefined,
    reason,
    approvedBy,
    items: kotItemsList.map((i) => ({ name: i.menuItemName, quantity: i.quantity })),
    createdAt: new Date(now),
  });

  queuePrint(cancelPrintTemplate, "KOT", "kitchen").catch((err) => {
    console.warn("[Printer] Could not queue cancellation KOT print:", err);
  });

  return { kotId, kotNumber: kot.kotNumber, status: "CANCELLED", reason };
});

/**
 * Generate a modification KOT — correction slip for post-fire changes.
 * Shows old → new differences for the kitchen.
 */
export const generateModificationKOT = atomicFn(function generateModificationKOT(
  orderId: string,
  modifications: Array<{
    orderItemId: string;
    changeType: "MODIFIER_CHANGE" | "QUANTITY_CHANGE" | "NOTE_CHANGE";
    oldValue?: string;
    newValue?: string;
  }>,
  station?: string,
  userId?: string
) {
  const order = db
    .select()
    .from(schema.orders)
    .where(eq(schema.orders.id, orderId))
    .get();

  if (!order) throw new Error("Order not found");

  const kotId = uuid();
  const kotNumber = getNextKOTNumber();
  const now = new Date().toISOString();

  // Create modification KOT record (marked SERVED so it doesn't appear as a duplicate active card on KDS)
  db.insert(schema.kitchenOrderTickets)
    .values({
      id: kotId,
      orderId,
      kotNumber,
      station: station ?? null,
      status: "SERVED",
      kotType: "MODIFICATION",
      createdAt: now,
    })
    .run();

  // Build modification items with change details and update original KOT notes
  const modItems: Array<{ itemName: string; changeType: string; oldValue?: string; newValue?: string; originalKotId?: string | null }> = [];
  const targetKotIds = new Set<string>();

  for (const mod of modifications) {
    const orderItem = db
      .select()
      .from(schema.orderItems)
      .where(eq(schema.orderItems.id, mod.orderItemId))
      .get();

    if (!orderItem) continue;

    const modNote = `[${mod.changeType}] ${mod.oldValue ?? ""} → ${mod.newValue ?? ""}`;

    // Also update the original KOT item's note in DB so KDS hydration shows the modification note on the original card
    if (orderItem.kotId) {
      targetKotIds.add(orderItem.kotId);
      const origKotItems = db
        .select()
        .from(schema.kotItems)
        .where(eq(schema.kotItems.kotId, orderItem.kotId))
        .all()
        .filter((ki) => ki.orderItemId === mod.orderItemId);

      for (const origKi of origKotItems) {
        db.update(schema.kotItems)
          .set({
            quantity: orderItem.quantity,
            notes: origKi.notes ? `${origKi.notes} | ${modNote}` : modNote,
          })
          .where(eq(schema.kotItems.id, origKi.id))
          .run();
      }
    }

    db.insert(schema.kotItems)
      .values({
        id: uuid(),
        kotId,
        orderItemId: mod.orderItemId,
        menuItemName: orderItem.menuItemName,
        quantity: orderItem.quantity,
        modifiers: orderItem.modifiers,
        notes: modNote,
      })
      .run();

    modItems.push({
      itemName: orderItem.menuItemName,
      changeType: mod.changeType,
      oldValue: mod.oldValue,
      newValue: mod.newValue,
      originalKotId: orderItem.kotId,
    });
  }

  let tableName: string | undefined;
  if (order.tableId) {
    const table = db
      .select()
      .from(schema.diningTables)
      .where(eq(schema.diningTables.id, order.tableId))
      .get();
    tableName = table?.name;
  }

  // Emit to KDS using the original KOT ID so KDS updates the existing card in-place
  const primaryTargetKotId = Array.from(targetKotIds)[0] ?? kotId;
  emitKOTModification({
    kotId: primaryTargetKotId,
    kotNumber,
    orderId,
    orderNumber: order.orderNumber,
    tableName,
    modifications: modItems.map(m => ({
      itemName: m.itemName,
      changeType: m.changeType as "MODIFIER_CHANGE" | "QUANTITY_CHANGE" | "NOTE_CHANGE",
      oldValue: m.oldValue,
      newValue: m.newValue,
    })),
  });

  console.log(`\n✏️ MODIFICATION KOT — ${kotNumber} (Order: ${order.orderNumber})`);
  for (const m of modItems) {
    console.log(`  ${m.itemName}: [${m.changeType}] ${m.oldValue ?? ""} → ${m.newValue ?? ""}`);
  }
  console.log("");

  // Log event
  db.insert(schema.eventLog)
    .values({
      id: uuid(),
      orderId,
      eventType: "MODIFICATION_KOT",
      payload: JSON.stringify({ kotId, kotNumber, modifications: modItems }),
      userId,
      createdAt: now,
    })
    .run();

  // Queue physical modification slip for kitchen thermal printer
  const modPrintTemplate = buildModificationKOTReceipt({
    kotNumber,
    orderNumber: order.orderNumber,
    tableName,
    waiterName: order.waiterName ?? undefined,
    station: station ?? undefined,
    modifications: modItems.map((m) => ({
      itemName: m.itemName,
      changeType: m.changeType as "MODIFIER_CHANGE" | "QUANTITY_CHANGE" | "NOTE_CHANGE",
      oldValue: m.oldValue,
      newValue: m.newValue,
    })),
    createdAt: new Date(now),
  });

  queuePrint(modPrintTemplate, "KOT", "kitchen").catch((err) => {
    console.warn("[Printer] Could not queue modification KOT print:", err);
  });

  return { kotId, kotNumber, kotType: "MODIFICATION", modifications: modItems };
});

/**
 * Mark a KOT as Rush / Priority.
 * Kitchen receives an urgent alert on KDS.
 */
export const markRush = atomicFn(function markRush(kotId: string, userId?: string, rushedBy?: string) {
  const kot = db
    .select()
    .from(schema.kitchenOrderTickets)
    .where(eq(schema.kitchenOrderTickets.id, kotId))
    .get();

  if (!kot) throw new Error("KOT not found");
  if (kot.status === "CANCELLED") throw new Error("Cannot rush a cancelled KOT");
  if (kot.status === "READY" || kot.status === "SERVED") throw new Error("KOT is already ready/served");

  const activeItems = getActiveKOTItems(kotId);
  if (activeItems.length === 0) throw new Error("No active items remaining on this KOT to rush");

  db.update(schema.kitchenOrderTickets)
    .set({ isRush: true })
    .where(eq(schema.kitchenOrderTickets.id, kotId))
    .run();

  const order = db
    .select()
    .from(schema.orders)
    .where(eq(schema.orders.id, kot.orderId))
    .get();

  const tableName = getTableName(order?.tableId);

  emitKOTRush({
    kotId,
    kotNumber: kot.kotNumber,
    orderId: kot.orderId,
    orderNumber: order?.orderNumber ?? "",
    tableName,
  });

  // Urgent slip for the kitchen printer
  const rushTemplate = buildRushKOTReceipt({
    kotNumber: kot.kotNumber,
    orderNumber: order?.orderNumber ?? "--",
    tableName,
    waiterName: order?.waiterName ?? undefined,
    station: kot.station ?? undefined,
    rushedBy,
    items: activeItems.map((item) => ({
      name: item.menuItemName,
      quantity: item.quantity,
      variantName: item.variantName ?? undefined,
      modifiers: item.modifiers ? JSON.parse(item.modifiers) : undefined,
      notes: item.notes ?? undefined,
    })),
    createdAt: new Date(kot.createdAt),
  });
  queuePrint(rushTemplate, "KOT", "kitchen").catch((err) => {
    console.warn("[Printer] Could not queue RUSH KOT print:", err);
  });

  // Log event
  db.insert(schema.eventLog)
    .values({
      id: uuid(),
      orderId: kot.orderId,
      eventType: "KOT_RUSH",
      payload: JSON.stringify({ kotId, kotNumber: kot.kotNumber }),
      userId,
      createdAt: new Date().toISOString(),
    })
    .run();

  console.log(`\n🔥 RUSH KOT — ${kot.kotNumber} (Order: ${order?.orderNumber})`);

  return { kotId, kotNumber: kot.kotNumber, isRush: true };
});
