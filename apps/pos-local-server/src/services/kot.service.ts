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
import { buildKOTReceipt, type KOTData } from "@gusto/printer";
import {
  emitKOTNew,
  emitKOTStatusUpdate,
} from "../socket/events.js";

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

  // Filter to only items without a kotId (not yet sent), or specific itemIds
  const itemsToSend = itemIds
    ? allItems.filter((item) => itemIds.includes(item.id))
    : allItems.filter((item) => !item.kotId);

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
    items: itemsToSend.map((item) => ({
      name: item.menuItemName,
      quantity: item.quantity,
      modifiers: item.modifiers ? JSON.parse(item.modifiers) : [],
      notes: item.notes,
    })),
    createdAt: now,
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
  const kots = status
    ? db
        .select()
        .from(schema.kitchenOrderTickets)
        .where(eq(schema.kitchenOrderTickets.status, status))
        .all()
    : db.select().from(schema.kitchenOrderTickets).all();

  // Enrich with items and order info
  return kots.map((kot) => {
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

    return {
      ...kot,
      orderNumber: order?.orderNumber,
      tableName,
      items: items.map((item) => ({
        ...item,
        modifiers: item.modifiers ? JSON.parse(item.modifiers) : [],
      })),
    };
  });
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

    if (allReady) {
      db.update(schema.orders)
        .set({ status: "READY", updatedAt: new Date().toISOString() })
        .where(eq(schema.orders.id, kot.orderId))
        .run();
    }
  }

  emitKOTStatusUpdate(kotId, status, order?.orderNumber ?? "");

  return { kotId, status, orderId: kot.orderId };
}
