/**
 * Gusto POS Local Server — KOT Service
 *
 * Kitchen Order Ticket generation and status management.
 */

import { eq } from "drizzle-orm";
import { v4 as uuid } from "uuid";
import * as schema from "@gusto/db-schema/local";
import { db } from "../db/index.js";
import { getNextKOTNumber } from "./sequence.service.js";
import {
  buildKOTReceipt,
  buildModificationKOTReceipt,
  buildCancellationKOTReceipt,
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
import { queuePrint } from "./print.service.js";

/**
 * Generate a KOT for items in an order that haven't been sent to kitchen yet.
 */
export function generateKOT(
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

  // Log KOT to console (simulated print)
  console.log(`\n🍳 KOT FIRED — ${kotNumber} (Order: ${order.orderNumber})`);
  for (const line of printTemplate) {
    if (line.type === "divider") console.log("─".repeat(40));
    else if (line.type === "blank") console.log("");
    else if (line.content) console.log(line.content);
  }
  console.log("");

  // Emit Socket.IO event to kitchen
  emitKOTNew({
    kotId,
    kotNumber,
    orderId,
    orderNumber: order.orderNumber,
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
}

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
        tableName,
        items: validItems,
      };
    })
    .filter((kot) => kot.items.length > 0);
}

/**
 * Update KOT status.
 */
export function updateKOTStatus(
  kotId: string,
  status: "PENDING" | "IN_PROGRESS" | "READY" | "SERVED"
) {
  const kot = db
    .select()
    .from(schema.kitchenOrderTickets)
    .where(eq(schema.kitchenOrderTickets.id, kotId))
    .get();

  if (!kot) throw new Error("KOT not found");

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

    const allReady = allKOTs.every(
      (k) => k.id === kotId ? true : k.status === "READY" || k.status === "SERVED"
    );

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

  emitKOTStatusUpdate(kotId, status, order?.orderNumber ?? "", kot.orderId);
  emitOrderUpdated({
    type: "KOT_STATUS_UPDATED",
    kotId,
    status,
    orderId: kot.orderId,
    orderNumber: order?.orderNumber,
  });

  return { kotId, status, orderId: kot.orderId };
}

// ─── Edge Case KOT Operations ───

/**
 * Reprint a KOT — regenerates print template from existing data.
 * Marks output as "REPRINT" for kitchen clarity.
 */
export function reprintKOT(kotId: string) {
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

  const kotItemsList = db
    .select()
    .from(schema.kotItems)
    .where(eq(schema.kotItems.kotId, kotId))
    .all();

  const activeReprintItems = kotItemsList
    .map((item) => {
      const orderItem = item.orderItemId
        ? db
            .select()
            .from(schema.orderItems)
            .where(eq(schema.orderItems.id, item.orderItemId))
            .get()
        : null;

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
      };
    })
    .filter((i): i is NonNullable<typeof i> => i !== null);

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

  console.log(`\n🔄 KOT REPRINT — ${kot.kotNumber} (Order: ${order?.orderNumber})`);
  for (const line of printTemplate) {
    if (line.type === "divider") console.log("─".repeat(40));
    else if (line.type === "blank") console.log("");
    else if (line.content) console.log(line.content);
  }
  console.log("");

  // Re-emit to kitchen with reprint flag
  emitKOTNew({
    kotId,
    kotNumber: kot.kotNumber,
    orderId: kot.orderId,
    orderNumber: order?.orderNumber,
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
}

/**
 * Cancel an entire KOT — marks all linked items as voided.
 * Kitchen receives a cancellation alert on KDS.
 */
export function cancelKOT(
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
    db.update(schema.orderItems)
      .set({
        status: "VOIDED",
        voidedAt: now,
        voidReason: `KOT ${kot.kotNumber} cancelled: ${reason}`,
        voidApprovedBy: approvedBy,
        isNcr: true,
      })
      .where(eq(schema.orderItems.id, kotItem.orderItemId))
      .run();
  }

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

  queuePrint(cancelPrintTemplate, "KOT", "pos").catch((err) => {
    console.warn("[Printer] Could not queue cancellation KOT print:", err);
  });

  return { kotId, kotNumber: kot.kotNumber, status: "CANCELLED", reason };
}

/**
 * Generate a modification KOT — correction slip for post-fire changes.
 * Shows old → new differences for the kitchen.
 */
export function generateModificationKOT(
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

  queuePrint(modPrintTemplate, "KOT", "pos").catch((err) => {
    console.warn("[Printer] Could not queue modification KOT print:", err);
  });

  return { kotId, kotNumber, kotType: "MODIFICATION", modifications: modItems };
}

/**
 * Mark a KOT as Rush / Priority.
 * Kitchen receives an urgent alert on KDS.
 */
export function markRush(kotId: string, userId?: string) {
  const kot = db
    .select()
    .from(schema.kitchenOrderTickets)
    .where(eq(schema.kitchenOrderTickets.id, kotId))
    .get();

  if (!kot) throw new Error("KOT not found");
  if (kot.status === "CANCELLED") throw new Error("Cannot rush a cancelled KOT");
  if (kot.status === "READY" || kot.status === "SERVED") throw new Error("KOT is already ready/served");

  db.update(schema.kitchenOrderTickets)
    .set({ isRush: true })
    .where(eq(schema.kitchenOrderTickets.id, kotId))
    .run();

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

  emitKOTRush({
    kotId,
    kotNumber: kot.kotNumber,
    orderId: kot.orderId,
    orderNumber: order?.orderNumber ?? "",
    tableName,
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
}
