/**
 * Gusto POS Local Server — Order Service
 *
 * Core business logic for the order lifecycle.
 * All operations hit local SQLite — zero cloud dependency.
 */

import { eq, and, notInArray, desc } from "drizzle-orm";
import { v4 as uuid } from "uuid";
import * as schema from "@gusto/db-schema/local";
import { db } from "../db/index.js";
import { atomicFn } from "../db/tx.js";
import {
  calculateCartTotals,
  calculateLineGross,
  isOrderEditable,
  type CartItem,
  type DiscountConfig,
  type GSTRate,
} from "@gusto/core-logic";
import { getNextOrderNumber } from "./sequence.service.js";
import { queueSyncEvent } from "./sync.service.js";
import { syncOrderToCloud } from "./order-sync.service.js";
import {
  emitOrderUpdated,
  emitTableStatusChanged,
  emitOrderModeChanged,
  emitOrderItemsMoved,
  emitOnlineOrderReceived,
} from "../socket/events.js";
import { cancelKOT, generateModificationKOT } from "./kot.service.js";
import { captureUndoSnapshot, clearUndoStack } from "./undo.service.js";
import { platformMarkerLabel } from "./order-channel.js";

// ─── Types ───

export interface CreateOrderInput {
  orderMode: "DINE_IN" | "TAKEAWAY" | "DELIVERY" | "ONLINE";
  tableId?: string;
  waiterId?: string;
  waiterName?: string;
  cashierId?: string;
  cashierName?: string;
  tokenNumbers?: number[];
  paxCount?: number;
  customerId?: string;
  customerName?: string;
  customerPhone?: string;
  notes?: string;
}

export interface AddItemInput {
  menuItemId: string;
  menuItemName: string;
  variantName?: string;
  quantity: number;
  unitPrice: number;
  gstRate: GSTRate;
  modifiers?: string[];
  addOns?: { name: string; quantity: number; unitPrice: number; amount: number }[];
  notes?: string;
  /**
   * Client-generated UUID for this line. Used as the order item id so a repeated
   * save of the same line (concurrent saves, offline replays) is ignored.
   */
  clientItemId?: string;
}

const CLIENT_ITEM_ID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export const ORDER_MODES = ["DINE_IN", "TAKEAWAY", "DELIVERY", "ONLINE"] as const;
export type OrderModeValue = (typeof ORDER_MODES)[number];
const GST_RATES: readonly string[] = ["0", "5", "12", "18", "28"];
/** Orders in these states are closed — nothing about them may change. */
export const TERMINAL_STATUSES = ["COMPLETED", "CANCELLED", "MERGED"];
const MAX_ITEM_QUANTITY = 999;
const MAX_UNIT_PRICE = 1_000_000;

// ─── Config (should come from outlet settings) ───

const OUTLET_ID = process.env.OUTLET_ID || "local-outlet";
const ORGANIZATION_ID = process.env.ORGANIZATION_ID || "local-org";

// ─── Helpers ───

type OrderItemRow = typeof schema.orderItems.$inferSelect;
type OrderRow = typeof schema.orders.$inferSelect;

function safeJsonArray<T>(value: string | null | undefined): T[] | undefined {
  if (!value) return undefined;
  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed) ? (parsed as T[]) : undefined;
  } catch {
    return undefined;
  }
}

/** Chargeable (non-voided) order item rows → cart lines for the shared totals engine. */
export function toCartItems(items: OrderItemRow[]): CartItem[] {
  return items
    .filter((item) => item.status !== "VOIDED")
    .map((item) => ({
      menuItemId: item.menuItemId,
      menuItemName: item.menuItemName,
      variantName: item.variantName ?? undefined,
      quantity: item.quantity,
      unitPrice: item.unitPrice,
      gstRate: (GST_RATES.includes(item.gstRate) ? item.gstRate : "5") as GSTRate,
      modifiers: safeJsonArray<string>(item.modifiers),
      notes: item.notes ?? undefined,
      addOns: safeJsonArray<{ name: string; quantity: number; unitPrice: number }>(item.addOns),
      discount:
        item.itemDiscountType && item.itemDiscountValue
          ? { type: item.itemDiscountType as "PERCENTAGE" | "FLAT", value: item.itemDiscountValue }
          : null,
    }));
}

/** Order-level discount stored on the order row, if any. */
export function getOrderDiscount(order: Pick<OrderRow, "discountType" | "discountValue">): DiscountConfig | undefined {
  if (!order.discountType || !order.discountValue) return undefined;
  return { type: order.discountType as "PERCENTAGE" | "FLAT", value: order.discountValue };
}

function requireOrder(orderId: string): OrderRow {
  const order = db.select().from(schema.orders).where(eq(schema.orders.id, orderId)).get();
  if (!order) throw new Error("Order not found");
  return order;
}

/** Load an order that can still be changed (not paid, cancelled or merged). */
function requireOpenOrder(orderId: string, action: string): OrderRow {
  const order = requireOrder(orderId);
  if (TERMINAL_STATUSES.includes(order.status)) {
    throw new Error(`Cannot ${action} — order ${order.orderNumber} is ${order.status.toLowerCase()}`);
  }
  return order;
}

/** Load an item and make sure it really belongs to the given order. */
function requireOrderItem(orderId: string, itemId: string): OrderItemRow {
  const item = db.select().from(schema.orderItems).where(eq(schema.orderItems.id, itemId)).get();
  if (!item || item.orderId !== orderId) throw new Error("Item not found on this order");
  return item;
}

function requireWholeQuantity(value: unknown, label = "Quantity"): number {
  if (typeof value !== "number" || !Number.isInteger(value)) {
    throw new Error(`${label} must be a whole number`);
  }
  return value;
}

/**
 * Free a table that this order was occupying. A table that has since been
 * given to a different live order is left alone.
 */
function releaseTableIfHeldBy(tableId: string | null, orderId: string, order: Pick<OrderRow, "organizationId" | "outletId">): void {
  if (!tableId) return;
  const table = db.select().from(schema.diningTables).where(eq(schema.diningTables.id, tableId)).get();
  if (!table) return;
  if (table.currentOrderId && table.currentOrderId !== orderId) {
    const other = db.select().from(schema.orders).where(eq(schema.orders.id, table.currentOrderId)).get();
    if (other && !TERMINAL_STATUSES.includes(other.status)) return;
  }

  db.update(schema.diningTables)
    .set({ status: "AVAILABLE", currentOrderId: null })
    .where(eq(schema.diningTables.id, tableId))
    .run();

  emitTableStatusChanged({ tableId, tableName: table.name, status: "AVAILABLE" });
  queueSyncEvent("TABLE_STATUS_CHANGED", {
    tableId,
    tableName: table.name,
    status: "AVAILABLE",
    organizationId: order.organizationId,
    outletId: order.outletId,
  });
}

export function recalculateOrderTotals(orderId: string): void {
  const order = db
    .select()
    .from(schema.orders)
    .where(eq(schema.orders.id, orderId))
    .get();

  if (!order) return;

  const items = db
    .select()
    .from(schema.orderItems)
    .where(eq(schema.orderItems.orderId, orderId))
    .all();

  // Voided items are excluded so they are never charged to the customer
  const totals = calculateCartTotals(toCartItems(items), getOrderDiscount(order));

  db.update(schema.orders)
    .set({
      subtotal: totals.subtotal,
      discountAmount: totals.discountAmount,
      taxAmount: totals.totalTax,
      totalAmount: totals.grandTotal,
      updatedAt: new Date().toISOString(),
    })
    .where(eq(schema.orders.id, orderId))
    .run();
}

function logEvent(
  orderId: string,
  eventType: string,
  payload: Record<string, unknown>,
  userId?: string
): void {
  db.insert(schema.eventLog)
    .values({
      id: uuid(),
      orderId,
      eventType,
      payload: JSON.stringify(payload),
      userId,
      createdAt: new Date().toISOString(),
    })
    .run();
}

// ─── Order Operations ───

/**
 * Create a new order.
 */
export const createOrder = atomicFn(function createOrder(input: CreateOrderInput, userId?: string) {
  if (!input || !ORDER_MODES.includes(input.orderMode)) {
    throw new Error(`orderMode must be one of ${ORDER_MODES.join(", ")}`);
  }
  if (input.tableId) {
    const table = db.select({ id: schema.diningTables.id }).from(schema.diningTables).where(eq(schema.diningTables.id, input.tableId)).get();
    if (!table) throw new Error("Table not found");
  }
  if (input.paxCount !== undefined && (!Number.isInteger(input.paxCount) || input.paxCount < 1 || input.paxCount > 500)) {
    throw new Error("paxCount must be a whole number between 1 and 500");
  }
  if (input.tokenNumbers !== undefined && !Array.isArray(input.tokenNumbers)) {
    throw new Error("tokenNumbers must be an array");
  }

  // If dine-in, check if there is already an active order on this table to prevent duplicates
  if (input.orderMode === "DINE_IN" && input.tableId) {
    const existingOrder = db
      .select()
      .from(schema.orders)
      .where(
        and(
          eq(schema.orders.tableId, input.tableId),
          notInArray(schema.orders.status, ["COMPLETED", "CANCELLED", "MERGED"])
        )
      )
      .orderBy(desc(schema.orders.createdAt))
      .get();

    if (existingOrder) {
      db.update(schema.diningTables)
        .set({ status: "OCCUPIED", currentOrderId: existingOrder.id })
        .where(eq(schema.diningTables.id, input.tableId))
        .run();

      return getOrderById(existingOrder.id);
    }
  }

  const id = uuid();
  const orderNumber = getNextOrderNumber("OUT");
  const now = new Date().toISOString();

  db.insert(schema.orders)
    .values({
      id,
      outletId: OUTLET_ID,
      organizationId: ORGANIZATION_ID,
      tableId: input.tableId,
      orderNumber,
      orderMode: input.orderMode,
      status: "DRAFT",
      subtotal: 0,
      discountAmount: 0,
      taxAmount: 0,
      totalAmount: 0,
      waiterId: input.waiterId,
      waiterName: input.waiterName,
      cashierId: input.cashierId,
      cashierName: input.cashierName,
      tokenNumbers: input.tokenNumbers ? JSON.stringify(input.tokenNumbers) : null,
      paxCount: input.paxCount ?? 1,
      customerId: input.customerId,
      customerName: input.customerName,
      customerPhone: input.customerPhone,
      notes: input.notes,
      isSynced: false,
      createdAt: now,
      updatedAt: now,
    })
    .run();

  // Update table status if dine-in
  let tableName: string | undefined = undefined;
  if (input.orderMode === "DINE_IN" && input.tableId) {
    db.update(schema.diningTables)
      .set({ status: "OCCUPIED", currentOrderId: id })
      .where(eq(schema.diningTables.id, input.tableId))
      .run();

    const tableObj = db.select().from(schema.diningTables).where(eq(schema.diningTables.id, input.tableId)).get();
    tableName = tableObj?.name;

    emitTableStatusChanged({
      tableId: input.tableId,
      tableName,
      status: "OCCUPIED",
      orderId: id,
      orderNumber,
    });

    queueSyncEvent("TABLE_STATUS_CHANGED", {
      tableId: input.tableId,
      tableName,
      status: "OCCUPIED",
      orderId: id,
      orderNumber,
      outletId: OUTLET_ID,
      organizationId: ORGANIZATION_ID,
    });
  }

  logEvent(id, "ORDER_CREATED", { orderNumber, orderMode: input.orderMode, tableId: input.tableId }, userId);

  queueSyncEvent("ORDER_CREATED", {
    orderId: id,
    orderNumber,
    orderMode: input.orderMode,
    tableId: input.tableId,
    tableName,
    outletId: OUTLET_ID,
    organizationId: ORGANIZATION_ID,
  });

  return getOrderById(id);
});

/**
 * Get order by ID with items.
 */
export function getOrderById(orderId: string) {
  const order = db
    .select()
    .from(schema.orders)
    .where(eq(schema.orders.id, orderId))
    .get();

  if (!order) return null;

  const items = db
    .select()
    .from(schema.orderItems)
    .where(eq(schema.orderItems.orderId, orderId))
    .all()
    .filter((item) => item.status !== "VOIDED");

  const kots = db
    .select()
    .from(schema.kitchenOrderTickets)
    .where(eq(schema.kitchenOrderTickets.orderId, orderId))
    .all();

  return {
    ...order,
    items: items.map((item) => ({
      ...item,
      modifiers: item.modifiers ? (typeof item.modifiers === "string" ? JSON.parse(item.modifiers) : item.modifiers) : [],
      addOns: item.addOns ? (typeof item.addOns === "string" ? JSON.parse(item.addOns) : item.addOns) : [],
    })),
    kots,
  };
}

/** Cloud id of the aggregator order a local ONLINE order was created from. */
export function getOnlineOrderId(notes: string | null | undefined): string | null {
  const match = notes?.match(/onlineOrderId:([^\s|]+)/);
  return match ? match[1]! : null;
}

/**
 * Create a DRAFT online order from an incoming Zomato/Swiggy webhook.
 *
 * The cloud may deliver the same order more than once (reconnects, retries),
 * so this is idempotent on the cloud's onlineOrderId: a repeat returns the
 * order that already exists with `created: false`.
 */
export const createOnlineOrderFromWebhook = atomicFn(function createOnlineOrderFromWebhook(payload: any) {
  if (!payload || typeof payload !== "object") throw new Error("Online order payload is missing");
  const onlineOrderId = payload.onlineOrderId ? String(payload.onlineOrderId) : null;
  const aggregatorOrderId = String(payload.order_id ?? onlineOrderId ?? "");
  if (!aggregatorOrderId) throw new Error("Online order has no order id");

  if (onlineOrderId) {
    const existing = db
      .select({ id: schema.orders.id, notes: schema.orders.notes })
      .from(schema.orders)
      .where(eq(schema.orders.orderMode, "ONLINE"))
      .all()
      .find((o) => getOnlineOrderId(o.notes) === onlineOrderId);
    if (existing) return { order: getOrderById(existing.id), created: false };
  }

  // Map aggregator payload to Gustos schema (provider defaults to Zomato,
  // the only integration currently routed by sync-worker)
  const platformLabel = platformMarkerLabel(payload.provider);
  const customerName = payload.customer?.name || `${platformLabel} Customer`;
  const customerPhone = payload.customer?.phone;

  const newOrder = createOrder(
    {
      orderMode: "ONLINE",
      customerName,
      customerPhone,
      // The cloud's onlineOrderId is kept in the notes so accept / reject / ready can be acknowledged
      notes: `onlineOrderId:${onlineOrderId ?? aggregatorOrderId} | ${platformLabel}: ${aggregatorOrderId}`,
    },
    "system"
  );
  if (!newOrder) throw new Error("Failed to create online order");

  // Map items by the cloud's pos_mapped_id, falling back to a name lookup.
  // Lines with an unusable quantity or price are skipped rather than failing the whole order.
  const itemsToAdd: AddItemInput[] = [];
  for (const item of Array.isArray(payload.items) ? payload.items : []) {
    const quantity = Math.trunc(Number(item?.quantity));
    const unitPrice = Number(item?.unit_price);
    const name = typeof item?.item_name === "string" ? item.item_name.trim() : "";
    if (!name || !Number.isFinite(quantity) || quantity <= 0 || !Number.isFinite(unitPrice) || unitPrice < 0) {
      console.warn(`[OrderService] Skipping unusable line on online order ${aggregatorOrderId}:`, item);
      continue;
    }

    let localItem = item.pos_mapped_id
      ? db.select().from(schema.menuItems).where(eq(schema.menuItems.id, String(item.pos_mapped_id))).get()
      : undefined;
    if (!localItem) {
      localItem = db.select().from(schema.menuItems).where(eq(schema.menuItems.name, name)).get();
    }

    itemsToAdd.push({
      menuItemId: localItem?.id || uuid(),
      menuItemName: localItem?.name || name,
      quantity: Math.min(quantity, MAX_ITEM_QUANTITY),
      unitPrice,
      gstRate: (localItem?.gstRate as GSTRate) || "5",
      notes: typeof item.special_instructions === "string" ? item.special_instructions : undefined,
    });
  }

  if (itemsToAdd.length > 0) {
    // The aggregator already sold these — availability is not re-checked
    addItemsToOrder(newOrder.id, itemsToAdd, "system", { skipAvailabilityCheck: true, keepDraft: true });
  }

  const finalOrder = getOrderById(newOrder.id);

  // Alert the POS
  emitOnlineOrderReceived(finalOrder!);

  console.log(`[OrderService] Created DRAFT online order ${finalOrder?.orderNumber} for ${platformLabel} order ${aggregatorOrderId}`);
  return { order: finalOrder, created: true };
});

/**
 * Accept a DRAFT online order.
 */
export const acceptOnlineOrder = atomicFn(function acceptOnlineOrder(orderId: string, userId?: string) {
  const order = db.select().from(schema.orders).where(eq(schema.orders.id, orderId)).get();
  if (!order) throw new Error("Order not found");
  if (order.orderMode !== "ONLINE" || order.status !== "DRAFT") {
    throw new Error("Only DRAFT online orders can be accepted");
  }

  db.update(schema.orders)
    .set({ status: "PLACED", updatedAt: new Date().toISOString() })
    .where(eq(schema.orders.id, orderId))
    .run();
    
  logEvent(orderId, "ONLINE_ORDER_ACCEPTED", {}, userId);

  const updated = getOrderById(orderId);
  emitOrderUpdated({ type: "ONLINE_ORDER_ACCEPTED", order: updated });
  
  // Ack to cloud
  queueSyncEvent("ONLINE_ORDER_ACCEPTED", {
    orderId,
    orderNumber: order.orderNumber,
    onlineOrderId: getOnlineOrderId(order.notes),
    organizationId: order.organizationId,
    outletId: order.outletId,
  });

  return updated;
});

/**
 * Reject a DRAFT online order.
 */
export const rejectOnlineOrder = atomicFn(function rejectOnlineOrder(orderId: string, reason: string, userId?: string) {
  const order = db.select().from(schema.orders).where(eq(schema.orders.id, orderId)).get();
  if (!order) throw new Error("Order not found");
  if (order.orderMode !== "ONLINE" || order.status !== "DRAFT") {
    throw new Error("Only DRAFT online orders can be rejected");
  }

  db.update(schema.orders)
    .set({ status: "CANCELLED", updatedAt: new Date().toISOString() })
    .where(eq(schema.orders.id, orderId))
    .run();
    
  logEvent(orderId, "ONLINE_ORDER_REJECTED", { reason }, userId);

  const updated = getOrderById(orderId);
  emitOrderUpdated({ type: "ONLINE_ORDER_REJECTED", order: updated });
  
  queueSyncEvent("ONLINE_ORDER_REJECTED", {
    orderId,
    orderNumber: order.orderNumber,
    reason,
    onlineOrderId: getOnlineOrderId(order.notes),
    organizationId: order.organizationId,
    outletId: order.outletId,
  });

  return updated;
});

/**
 * List orders with optional filters.
 */
export function listOrders(filters?: {
  status?: string;
  tableId?: string;
  waiterId?: string;
  orderMode?: string;
  customerPhone?: string;
  isComplimentary?: boolean;
  limit?: number;
  activeOnly?: boolean;
}) {
  // Apply filters via chaining
  const conditions = [];
  if (filters?.status) {
    conditions.push(eq(schema.orders.status, filters.status));
  }
  if (filters?.tableId) {
    conditions.push(eq(schema.orders.tableId, filters.tableId));
  }
  if (filters?.waiterId) {
    conditions.push(eq(schema.orders.waiterId, filters.waiterId));
  }
  if (filters?.orderMode) {
    conditions.push(eq(schema.orders.orderMode, filters.orderMode));
  }
  if (filters?.customerPhone) {
    conditions.push(eq(schema.orders.customerPhone, filters.customerPhone));
  }
  if (filters?.isComplimentary !== undefined) {
    conditions.push(eq(schema.orders.isComplimentary, filters.isComplimentary));
  }
  if (filters?.activeOnly) {
    conditions.push(notInArray(schema.orders.status, ["COMPLETED", "CANCELLED", "MERGED"]));
  }

  const orders = conditions.length > 0
    ? db.select().from(schema.orders).where(and(...conditions)).all()
    : db.select().from(schema.orders).all();

  // Sort by createdAt descending
  orders.sort((a, b) => b.createdAt.localeCompare(a.createdAt));

  const limit = filters?.limit && Number.isFinite(filters.limit) && filters.limit > 0 ? Math.floor(filters.limit) : undefined;
  const resultOrders = limit ? orders.slice(0, limit) : orders;

  return resultOrders.map(order => {
    const items = db
      .select()
      .from(schema.orderItems)
      .where(eq(schema.orderItems.orderId, order.id))
      .all()
      .filter((item) => item.status !== "VOIDED");

    return {
      ...order,
      items: items.map((item) => ({
        ...item,
        modifiers: item.modifiers ? (typeof item.modifiers === "string" ? JSON.parse(item.modifiers) : item.modifiers) : [],
        addOns: item.addOns ? (typeof item.addOns === "string" ? JSON.parse(item.addOns) : item.addOns) : [],
      })),
      kots: [], // Return empty array or fetch if needed, UI only needs items for count
    };
  });
}

/**
 * Add items to an existing order.
 */
export const addItemsToOrder = atomicFn(function addItemsToOrder(
  orderId: string,
  items: AddItemInput[],
  userId?: string,
  options: { skipAvailabilityCheck?: boolean; keepDraft?: boolean } = {}
) {
  const order = db
    .select()
    .from(schema.orders)
    .where(eq(schema.orders.id, orderId))
    .get();

  if (!order) throw new Error("Order not found");
  if (["COMPLETED", "CANCELLED", "MERGED"].includes(order.status)) {
    throw new Error(`Cannot add items to a ${order.status.toLowerCase()} order`);
  }

  if (!Array.isArray(items) || items.length === 0) {
    throw new Error("items must be a non-empty array");
  }
  if (items.length > 200) throw new Error("Too many items in one request");

  for (const item of items) {
    if (!item || typeof item !== "object") throw new Error("Invalid item");
    const label = typeof item.menuItemName === "string" && item.menuItemName.trim() ? item.menuItemName.trim() : "";
    if (!label) throw new Error("Each item needs a menuItemName");
    if (typeof item.menuItemId !== "string" || !item.menuItemId) throw new Error(`${label}: menuItemId is required`);
    if (!Number.isInteger(item.quantity) || item.quantity <= 0 || item.quantity > MAX_ITEM_QUANTITY) {
      throw new Error(`${label}: quantity must be a whole number between 1 and ${MAX_ITEM_QUANTITY}`);
    }
    if (typeof item.unitPrice !== "number" || !Number.isFinite(item.unitPrice) || item.unitPrice < 0 || item.unitPrice > MAX_UNIT_PRICE) {
      throw new Error(`${label}: unitPrice is invalid`);
    }
    if (!GST_RATES.includes(String(item.gstRate))) {
      throw new Error(`${label}: gstRate must be one of ${GST_RATES.join(", ")}`);
    }
    if (item.modifiers !== undefined && item.modifiers !== null && !Array.isArray(item.modifiers)) {
      throw new Error(`${label}: modifiers must be an array`);
    }
    if (item.addOns !== undefined && item.addOns !== null) {
      if (!Array.isArray(item.addOns)) throw new Error(`${label}: addOns must be an array`);
      for (const addOn of item.addOns) {
        if (
          !addOn ||
          typeof addOn.name !== "string" ||
          !Number.isInteger(addOn.quantity) ||
          addOn.quantity <= 0 ||
          typeof addOn.unitPrice !== "number" ||
          !Number.isFinite(addOn.unitPrice) ||
          addOn.unitPrice < 0
        ) {
          throw new Error(`${label}: add-on is invalid`);
        }
      }
    }

    // An item 86'd in the meantime (e.g. from another device) must not reach the kitchen
    if (!options.skipAvailabilityCheck) {
      const menuItem = db
        .select({ isAvailable: schema.menuItems.isAvailable })
        .from(schema.menuItems)
        .where(eq(schema.menuItems.id, item.menuItemId))
        .get();
      if (menuItem && !menuItem.isAvailable) {
        throw new Error(`${label} is currently unavailable`);
      }
    }
  }

  // Drop lines this order already has (same client id) — a repeated save must not duplicate them
  const toInsert = items.filter((item) => {
    if (!item.clientItemId || !CLIENT_ITEM_ID_RE.test(item.clientItemId)) return true;
    const existing = db
      .select({ id: schema.orderItems.id, orderId: schema.orderItems.orderId })
      .from(schema.orderItems)
      .where(eq(schema.orderItems.id, item.clientItemId))
      .get();
    if (existing && existing.orderId !== orderId) {
      // Same id on another order (e.g. items moved) — insert under a fresh id
      item.clientItemId = undefined;
      return true;
    }
    return !existing;
  });

  if (toInsert.length === 0) {
    return getOrderById(orderId);
  }

  for (const item of toInsert) {
    db.insert(schema.orderItems)
      .values({
        id: item.clientItemId && CLIENT_ITEM_ID_RE.test(item.clientItemId) ? item.clientItemId : uuid(),
        orderId,
        menuItemId: item.menuItemId,
        menuItemName: item.menuItemName,
        variantName: item.variantName,
        quantity: item.quantity,
        unitPrice: item.unitPrice,
        gstRate: String(item.gstRate),
        modifiers: item.modifiers && item.modifiers.length > 0 ? JSON.stringify(item.modifiers) : null,
        addOns: item.addOns && item.addOns.length > 0 ? JSON.stringify(item.addOns) : null,
        notes: typeof item.notes === "string" && item.notes.trim() ? item.notes.trim().slice(0, 500) : null,
        status: "PLACED",
      })
      .run();
  }

  // Update order status to PLACED if still DRAFT (online orders stay DRAFT until accepted)
  if (order.status === "DRAFT" && !options.keepDraft) {
    db.update(schema.orders)
      .set({ status: "PLACED", updatedAt: new Date().toISOString() })
      .where(eq(schema.orders.id, orderId))
      .run();
  }

  recalculateOrderTotals(orderId);

  logEvent(
    orderId,
    "ITEMS_ADDED",
    { items: toInsert.map((i) => ({ name: i.menuItemName, qty: i.quantity })) },
    userId
  );

  const updated = getOrderById(orderId);
  emitOrderUpdated({ type: "ITEMS_ADDED", order: updated });

  return updated;
});

/**
 * Update an item's quantity.
 */
export const updateItemQuantity = atomicFn(function updateItemQuantity(
  orderId: string,
  itemId: string,
  quantity: number,
  userId?: string
) {
  const order = requireOpenOrder(orderId, "change items");
  if (!isOrderEditable(new Date(order.createdAt))) {
    throw new Error("Order is past the 48-hour edit window");
  }
  requireWholeQuantity(quantity);
  if (quantity > MAX_ITEM_QUANTITY) throw new Error(`Quantity cannot exceed ${MAX_ITEM_QUANTITY}`);

  const item = requireOrderItem(orderId, itemId);
  if (item.status === "VOIDED") throw new Error("Cannot update a voided item");

  if (quantity <= 0) {
    return removeItem(orderId, itemId, userId);
  }

  const oldQty = item.quantity;
  if (oldQty !== quantity && !item.kotId) {
    captureUndoSnapshot(orderId, `Quantity changed: ${item.menuItemName} ${oldQty} → ${quantity}`);
  }
  if (oldQty === quantity) {
    return getOrderById(orderId);
  }

  db.update(schema.orderItems)
    .set({ quantity })
    .where(eq(schema.orderItems.id, itemId))
    .run();

  // If item was already sent to kitchen, update kotItems & inform kitchen via modification KOT
  if (item.kotId) {
    db.update(schema.kotItems)
      .set({ quantity })
      .where(
        and(
          eq(schema.kotItems.kotId, item.kotId),
          eq(schema.kotItems.orderItemId, itemId)
        )
      )
      .run();

    try {
      generateModificationKOT(
        orderId,
        [
          {
            orderItemId: itemId,
            changeType: "QUANTITY_CHANGE",
            oldValue: `${oldQty}`,
            newValue: `${quantity}`,
          },
        ],
        undefined,
        userId
      );
    } catch (e) {
      console.warn("[KOT] Could not generate modification KOT:", e);
    }
  }

  recalculateOrderTotals(orderId);

  logEvent(orderId, "ITEM_QUANTITY_UPDATED", { itemId, oldQuantity: oldQty, quantity }, userId);

  const updated = getOrderById(orderId);
  emitOrderUpdated({ type: "ITEM_UPDATED", order: updated });
  return updated;
});

/**
 * Remove an item from an order.
 */
export const removeItem = atomicFn(function removeItem(
  orderId: string,
  itemId: string,
  userId?: string
) {
  requireOpenOrder(orderId, "remove items");
  const item = db.select().from(schema.orderItems).where(eq(schema.orderItems.id, itemId)).get();
  // Already gone (double tap / offline replay) — removing is idempotent
  if (!item || item.orderId !== orderId) return getOrderById(orderId);
  if (item.status === "VOIDED") return getOrderById(orderId);

  // If item was already sent on a KOT, it cannot be hard deleted due to foreign key constraints and audit trail.
  // We automatically void it and notify the kitchen!
  if (item.kotId) {
    return voidItem(orderId, itemId, "Item removed from order", userId || "Staff", userId);
  }

  captureUndoSnapshot(orderId, `Item removed: ${item.menuItemName}`);

  db.delete(schema.orderItems)
    .where(eq(schema.orderItems.id, itemId))
    .run();

  recalculateOrderTotals(orderId);

  logEvent(
    orderId,
    "ITEM_REMOVED",
    { itemId, menuItemName: item?.menuItemName },
    userId
  );

  const updated = getOrderById(orderId);
  emitOrderUpdated({ type: "ITEM_REMOVED", order: updated });
  return updated;
});

/**
 * Apply or update discount on an order.
 */
export const applyDiscount = atomicFn(function applyDiscount(
  orderId: string,
  discount: (DiscountConfig & { label?: string }) | null,
  userId?: string
) {
  requireOpenOrder(orderId, "change the discount");

  if (discount) {
    if (discount.type !== "PERCENTAGE" && discount.type !== "FLAT") {
      throw new Error("Discount type must be PERCENTAGE or FLAT");
    }
    if (typeof discount.value !== "number" || !Number.isFinite(discount.value) || discount.value < 0) {
      throw new Error("Discount value must be zero or more");
    }
    if (discount.type === "PERCENTAGE" && discount.value > 100) {
      throw new Error("Percentage discount cannot exceed 100");
    }
  }

  captureUndoSnapshot(orderId, discount ? "Discount applied" : "Discount removed");

  // A zero discount is the same as no discount
  const active = discount && discount.value > 0 ? discount : null;
  const label = active
    ? (typeof active.label === "string" && active.label.trim()
        ? active.label.trim().slice(0, 60)
        : active.type === "PERCENTAGE"
          ? `${active.value}% Off`
          : "Discount")
    : null;

  db.update(schema.orders)
    .set({
      discountType: active ? active.type : null,
      discountValue: active ? active.value : null,
      discountLabel: label,
      updatedAt: new Date().toISOString(),
    })
    .where(eq(schema.orders.id, orderId))
    .run();

  recalculateOrderTotals(orderId);

  logEvent(orderId, "DISCOUNT_APPLIED", { discount: active }, userId);

  const updated = getOrderById(orderId);
  emitOrderUpdated({ type: "DISCOUNT_APPLIED", order: updated });
  return updated;
});

/**
 * Attach a customer to an order.
 */
export const attachCustomer = atomicFn(function attachCustomer(
  orderId: string,
  customer: { id?: string; name: string; phone: string },
  userId?: string
) {
  requireOrder(orderId);
  const name = typeof customer?.name === "string" ? customer.name.trim().slice(0, 120) : "";
  const phone = typeof customer?.phone === "string" ? customer.phone.replace(/[^\d+]/g, "").slice(0, 20) : "";
  if (!name && !phone) throw new Error("Customer name or phone is required");

  db.update(schema.orders)
    .set({
      customerId: customer.id ?? null,
      customerName: name || null,
      customerPhone: phone || null,
      updatedAt: new Date().toISOString(),
    })
    .where(eq(schema.orders.id, orderId))
    .run();

  logEvent(orderId, "CUSTOMER_ATTACHED", { customer: { id: customer.id, name, phone } }, userId);

  const updated = getOrderById(orderId);
  emitOrderUpdated({ type: "CUSTOMER_ATTACHED", order: updated });
  return updated;
});

/**
 * Put an order on hold.
 */
export const holdOrder = atomicFn(function holdOrder(orderId: string, userId?: string) {
  const order = db.select().from(schema.orders).where(eq(schema.orders.id, orderId)).get();
  if (!order) throw new Error("Order not found");

  // Parking only applies to orders the kitchen hasn't started; a fired order keeps its status
  if (order.status === "PLACED") {
    db.update(schema.orders)
      .set({ status: "DRAFT", updatedAt: new Date().toISOString() })
      .where(eq(schema.orders.id, orderId))
      .run();
  }

  logEvent(orderId, "ORDER_HELD", {}, userId);

  const updated = getOrderById(orderId);
  emitOrderUpdated({ type: "ORDER_HELD", order: updated });
  return updated;
});

/**
 * Cancel an open (unpaid) order.
 *
 * - A paid bill is reversed with a post-settlement void instead, so the
 *   invoice and shift totals stay consistent.
 * - Tickets already in the kitchen are cancelled so cooking stops.
 * - The table is freed only if this order still holds it.
 *
 * `force` skips the 48-hour edit window (used for ERP-initiated cancels).
 */
export const cancelOrder = atomicFn(function cancelOrder(
  orderId: string,
  userId?: string,
  options: { reason?: string; force?: boolean } = {}
) {
  const order = requireOrder(orderId);
  if (order.status === "COMPLETED") {
    throw new Error("Order is already paid — void the settled bill instead");
  }
  if (order.status === "CANCELLED") return getOrderById(orderId); // idempotent
  if (order.status === "MERGED") throw new Error("Order was merged into another order");
  if (!options.force && !isOrderEditable(new Date(order.createdAt))) {
    throw new Error("Order is past the 48-hour edit window");
  }

  const reason = options.reason?.trim() || "Order cancelled";
  const now = new Date().toISOString();

  // Stop the kitchen: cancel every ticket that has not gone out yet
  const liveKots = db
    .select()
    .from(schema.kitchenOrderTickets)
    .where(eq(schema.kitchenOrderTickets.orderId, orderId))
    .all()
    .filter((k) => k.kotType !== "MODIFICATION" && ["PENDING", "IN_PROGRESS", "READY"].includes(k.status));
  for (const kot of liveKots) {
    cancelKOT(kot.id, reason, userId || "Staff", userId);
  }

  db.update(schema.orders)
    .set({ status: "CANCELLED", updatedAt: now })
    .where(eq(schema.orders.id, orderId))
    .run();

  releaseTableIfHeldBy(order.tableId, orderId, order);
  clearUndoStack(orderId);

  logEvent(orderId, "ORDER_CANCELLED", { reason, kotsCancelled: liveKots.length }, userId);
  queueSyncEvent("ORDER_CANCELLED", {
    orderId,
    orderNumber: order.orderNumber,
    reason,
    organizationId: order.organizationId,
    outletId: order.outletId,
  });

  const updated = getOrderById(orderId);
  emitOrderUpdated({ type: "ORDER_CANCELLED", orderId, orderNumber: order.orderNumber, order: updated });
  return updated;
});

// ─── Edge Case Operations ───

/**
 * Void an item (NCR — Non-Chargeable Revenue).
 * Item stays in DB for audit trail. Requires reason and manager approval.
 */
export const voidItem = atomicFn(function voidItem(
  orderId: string,
  itemId: string,
  reason: string,
  approvedBy: string,
  userId?: string,
  voidQuantity?: number
) {
  const order = requireOpenOrder(orderId, "void items");
  const item = requireOrderItem(orderId, itemId);
  if (item.status === "VOIDED") throw new Error("Item is already voided");

  reason = typeof reason === "string" ? reason.trim().slice(0, 300) : "";
  approvedBy = typeof approvedBy === "string" ? approvedBy.trim().slice(0, 120) : "";
  if (!reason) throw new Error("A reason is required to void an item");
  if (!approvedBy) throw new Error("An approver is required to void an item");

  if (voidQuantity !== undefined && voidQuantity !== null) {
    requireWholeQuantity(voidQuantity, "voidQuantity");
    if (voidQuantity <= 0 || voidQuantity > item.quantity) {
      throw new Error(`voidQuantity must be between 1 and ${item.quantity}`);
    }
  }

  const now = new Date().toISOString();
  const isPartial = voidQuantity !== undefined && voidQuantity !== null && voidQuantity < item.quantity;
  const qtyToVoid = isPartial ? (voidQuantity as number) : item.quantity;
  const remainingQty = item.quantity - qtyToVoid;

  if (isPartial) {
    // 1. Update existing item with remaining quantity
    db.update(schema.orderItems)
      .set({ quantity: remainingQty })
      .where(eq(schema.orderItems.id, itemId))
      .run();

    // 2. Insert new audit record for the voided portion
    const voidRecordId = uuid();
    db.insert(schema.orderItems)
      .values({
        id: voidRecordId,
        orderId,
        menuItemId: item.menuItemId,
        menuItemName: item.menuItemName,
        variantName: item.variantName,
        quantity: qtyToVoid,
        unitPrice: item.unitPrice,
        gstRate: item.gstRate,
        modifiers: item.modifiers,
        notes: item.notes,
        addOns: item.addOns,
        status: "VOIDED",
        kotId: item.kotId,
        voidedAt: now,
        voidReason: reason,
        voidApprovedBy: approvedBy,
        isNcr: true,
      })
      .run();

    // 3. If item was fired on KOT, update kotItems quantity & notify kitchen
    if (item.kotId) {
      db.update(schema.kotItems)
        .set({ quantity: remainingQty })
        .where(
          and(
            eq(schema.kotItems.kotId, item.kotId),
            eq(schema.kotItems.orderItemId, itemId)
          )
        )
        .run();

      try {
        generateModificationKOT(
          orderId,
          [
            {
              orderItemId: itemId,
              changeType: "QUANTITY_CHANGE",
              oldValue: `${item.quantity}`,
              newValue: `${remainingQty} (Voided ${qtyToVoid}: ${reason})`,
            },
          ],
          undefined,
          userId
        );
      } catch (e) {
        console.warn("[KOT] Could not generate modification KOT:", e);
      }
    }
  } else {
    // Full void
    db.update(schema.orderItems)
      .set({
        status: "VOIDED",
        voidedAt: now,
        voidReason: reason,
        voidApprovedBy: approvedBy,
        isNcr: true,
      })
      .where(eq(schema.orderItems.id, itemId))
      .run();

    if (item.kotId) {
      // Check if all items in this KOT are now voided
      const allOrderItemsInOrder = db.select().from(schema.orderItems)
        .where(eq(schema.orderItems.orderId, orderId))
        .all();

      const activeInSameKOT = allOrderItemsInOrder.filter(
        (i) => i.kotId === item.kotId && i.id !== itemId && i.status !== "VOIDED"
      );

      if (activeInSameKOT.length === 0) {
        // Entire KOT is now voided, cancel the KOT ticket
        try {
          cancelKOT(item.kotId, reason, approvedBy, userId);
        } catch (e) {
          console.warn("[KOT] KOT cancellation notice:", e);
        }
      } else {
        // Send modification slip to kitchen for the cancelled item
        try {
          generateModificationKOT(
            orderId,
            [
              {
                orderItemId: itemId,
                changeType: "QUANTITY_CHANGE",
                oldValue: `${item.quantity}x ${item.menuItemName}`,
                newValue: `CANCELLED (${reason})`,
              },
            ],
            undefined,
            userId
          );
        } catch (e) {
          console.warn("[KOT] Could not generate modification KOT:", e);
        }
      }
    }
  }

  recalculateOrderTotals(orderId);

  logEvent(orderId, "ITEM_VOIDED", {
    itemId,
    menuItemName: item.menuItemName,
    voidQuantity: qtyToVoid,
    remainingQuantity: remainingQty,
    reason,
    approvedBy,
  }, userId);

  queueSyncEvent("ITEM_VOIDED", {
    orderId,
    itemId,
    reason,
    approvedBy,
    voidQuantity: qtyToVoid,
    remainingQuantity: remainingQty,
    organizationId: order.organizationId,
    outletId: order.outletId,
  });

  const updated = getOrderById(orderId);
  emitOrderUpdated({ type: "ITEM_VOIDED", order: updated });
  return updated;
});

/**
 * Merge all items from source order into target order.
 * Source order is marked as MERGED, its table is released.
 */
export const mergeOrders = atomicFn(function mergeOrders(
  sourceOrderId: string,
  targetOrderId: string,
  userId?: string
) {
  const sourceOrder = db.select().from(schema.orders).where(eq(schema.orders.id, sourceOrderId)).get();
  const targetOrder = db.select().from(schema.orders).where(eq(schema.orders.id, targetOrderId)).get();

  if (!sourceOrder) throw new Error("Source order not found");
  if (!targetOrder) throw new Error("Target order not found");
  if (sourceOrderId === targetOrderId) throw new Error("Cannot merge an order into itself");
  if (TERMINAL_STATUSES.includes(sourceOrder.status)) {
    throw new Error(`Source order is ${sourceOrder.status} — cannot merge`);
  }
  if (TERMINAL_STATUSES.includes(targetOrder.status)) {
    throw new Error(`Target order is ${targetOrder.status} — cannot merge into it`);
  }

  const now = new Date().toISOString();

  // Move all items from source to target
  const sourceItems = db.select().from(schema.orderItems)
    .where(eq(schema.orderItems.orderId, sourceOrderId))
    .all();

  for (const item of sourceItems) {
    if (item.status === "VOIDED") continue; // Skip voided items
    db.update(schema.orderItems)
      .set({ orderId: targetOrderId })
      .where(eq(schema.orderItems.id, item.id))
      .run();
  }

  // Move KOTs (and their per-station progress) from source to target
  db.update(schema.kitchenOrderTickets)
    .set({ orderId: targetOrderId })
    .where(eq(schema.kitchenOrderTickets.orderId, sourceOrderId))
    .run();
  db.update(schema.kotStationStatus)
    .set({ orderId: targetOrderId })
    .where(eq(schema.kotStationStatus.orderId, sourceOrderId))
    .run();

  // Mark source order as MERGED
  db.update(schema.orders)
    .set({
      status: "MERGED",
      mergedIntoOrderId: targetOrderId,
      updatedAt: now,
    })
    .where(eq(schema.orders.id, sourceOrderId))
    .run();

  // Release source table (unless both orders share the same table)
  if (sourceOrder.tableId && sourceOrder.tableId !== targetOrder.tableId) {
    releaseTableIfHeldBy(sourceOrder.tableId, sourceOrderId, sourceOrder);
  }

  // Combine covers; a target that was still an empty draft is now a live order
  const movedCount = sourceItems.filter((i) => i.status !== "VOIDED").length;
  const movedFired = sourceItems.some((i) => i.status !== "VOIDED" && i.kotId);
  let targetStatus = targetOrder.status;
  if (movedCount > 0 && targetStatus === "DRAFT") targetStatus = "PLACED";
  if (movedFired && (targetStatus === "DRAFT" || targetStatus === "PLACED")) targetStatus = "IN_PROGRESS";
  // Newly arrived items are not ready yet
  if (movedCount > 0 && targetStatus === "READY" && sourceOrder.status !== "READY") targetStatus = "IN_PROGRESS";

  db.update(schema.orders)
    .set({
      paxCount: targetOrder.paxCount + sourceOrder.paxCount,
      status: targetStatus,
      updatedAt: now,
    })
    .where(eq(schema.orders.id, targetOrderId))
    .run();

  clearUndoStack(sourceOrderId);
  clearUndoStack(targetOrderId);

  recalculateOrderTotals(targetOrderId);

  logEvent(targetOrderId, "ORDERS_MERGED", {
    sourceOrderId,
    sourceOrderNumber: sourceOrder.orderNumber,
    itemsMoved: sourceItems.filter(i => i.status !== "VOIDED").length,
  }, userId);

  logEvent(sourceOrderId, "ORDER_MERGED_INTO", {
    targetOrderId,
    targetOrderNumber: targetOrder.orderNumber,
  }, userId);

  queueSyncEvent("ORDERS_MERGED", {
    sourceOrderId,
    targetOrderId,
    sourceOrderNumber: sourceOrder.orderNumber,
    targetOrderNumber: targetOrder.orderNumber,
    organizationId: targetOrder.organizationId,
    outletId: targetOrder.outletId,
  });

  syncOrderToCloud(sourceOrderId);
  const updated = getOrderById(targetOrderId);
  emitOrderUpdated({ type: "ORDERS_MERGED", order: updated });
  return updated;
});

/**
 * Move selected items from one order to another (or create a new order).
 * Handles partial splits — e.g., 3 guests from Table 5 move to Table 9.
 */
export const moveItemsToOrder = atomicFn(function moveItemsToOrder(
  sourceOrderId: string,
  itemIds: string[],
  targetOrderId?: string,
  targetTableId?: string,
  userId?: string
) {
  const sourceOrder = requireOpenOrder(sourceOrderId, "move items");
  if (!Array.isArray(itemIds) || itemIds.length === 0) throw new Error("itemIds array is required");
  itemIds = [...new Set(itemIds)];
  if (targetOrderId && targetOrderId === sourceOrderId) throw new Error("Items are already on this order");

  // Validate items belong to source order
  const itemsToMove = itemIds.map(itemId => {
    const item = db.select().from(schema.orderItems).where(eq(schema.orderItems.id, itemId)).get();
    if (!item) throw new Error(`Item ${itemId} not found`);
    if (item.orderId !== sourceOrderId) throw new Error(`Item ${itemId} does not belong to source order`);
    if (item.status === "VOIDED") throw new Error(`Item ${item.menuItemName} is voided and cannot be moved`);
    return item;
  });

  const now = new Date().toISOString();
  let targetOrder;

  // Create new order if no target specified
  if (!targetOrderId) {
    const newOrderInput: CreateOrderInput = {
      orderMode: sourceOrder.orderMode as "DINE_IN" | "TAKEAWAY" | "DELIVERY" | "ONLINE",
      tableId: targetTableId,
      waiterId: sourceOrder.waiterId ?? undefined,
      waiterName: sourceOrder.waiterName ?? undefined,
      notes: `Split from ${sourceOrder.orderNumber}`,
    };
    targetOrder = createOrder(newOrderInput, userId);
    if (!targetOrder) throw new Error("Failed to create target order");
    targetOrderId = targetOrder.id;
    // createOrder returns the table's existing order when it already has one
    if (targetOrderId === sourceOrderId) throw new Error("Items are already on this table's order");
  } else {
    targetOrder = db.select().from(schema.orders).where(eq(schema.orders.id, targetOrderId)).get();
    if (!targetOrder) throw new Error("Target order not found");
    if (TERMINAL_STATUSES.includes(targetOrder.status)) {
      throw new Error(`Target order is ${targetOrder.status.toLowerCase()} — cannot move items into it`);
    }
  }

  // Move each item
  for (const item of itemsToMove) {
    db.update(schema.orderItems)
      .set({ orderId: targetOrderId })
      .where(eq(schema.orderItems.id, item.id))
      .run();
  }

  // A kitchen ticket whose live items have all moved now belongs to the target
  // order, so the kitchen / pass keep tracking it under the right table.
  const affectedKotIds = [...new Set(itemsToMove.map((i) => i.kotId).filter((id): id is string => !!id))];
  for (const kotId of affectedKotIds) {
    const stillOnSource = db
      .select({ id: schema.orderItems.id })
      .from(schema.orderItems)
      .where(and(eq(schema.orderItems.kotId, kotId), eq(schema.orderItems.orderId, sourceOrderId)))
      .all()
      .length;
    if (stillOnSource === 0) {
      db.update(schema.kitchenOrderTickets).set({ orderId: targetOrderId }).where(eq(schema.kitchenOrderTickets.id, kotId)).run();
      db.update(schema.kotStationStatus).set({ orderId: targetOrderId! }).where(eq(schema.kotStationStatus.kotId, kotId)).run();
    }
  }

  // The target is a live order once it holds items
  const targetNow = db.select().from(schema.orders).where(eq(schema.orders.id, targetOrderId!)).get()!;
  const anyFired = itemsToMove.some((i) => i.kotId);
  let targetStatus = targetNow.status;
  if (targetStatus === "DRAFT") targetStatus = "PLACED";
  if (anyFired && targetStatus === "PLACED") targetStatus = "IN_PROGRESS";
  if (targetStatus !== targetNow.status) {
    db.update(schema.orders).set({ status: targetStatus, updatedAt: now }).where(eq(schema.orders.id, targetOrderId!)).run();
  }

  // Recalculate both orders
  recalculateOrderTotals(sourceOrderId);
  recalculateOrderTotals(targetOrderId!);

  // Check if source order has no items left — if so, cancel it
  const remainingItems = db.select().from(schema.orderItems)
    .where(eq(schema.orderItems.orderId, sourceOrderId))
    .all()
    .filter(i => i.status !== "VOIDED");

  if (remainingItems.length === 0) {
    db.update(schema.orders)
      .set({ status: "CANCELLED", updatedAt: now })
      .where(eq(schema.orders.id, sourceOrderId))
      .run();

    releaseTableIfHeldBy(sourceOrder.tableId, sourceOrderId, sourceOrder);
  }

  clearUndoStack(sourceOrderId);
  clearUndoStack(targetOrderId!);

  logEvent(sourceOrderId, "ITEMS_MOVED_OUT", {
    targetOrderId,
    itemIds,
    itemNames: itemsToMove.map(i => i.menuItemName),
  }, userId);

  logEvent(targetOrderId!, "ITEMS_MOVED_IN", {
    sourceOrderId,
    sourceOrderNumber: sourceOrder.orderNumber,
    itemIds,
    itemNames: itemsToMove.map(i => i.menuItemName),
  }, userId);

  emitOrderItemsMoved({
    sourceOrderId,
    targetOrderId: targetOrderId!,
    movedItemCount: itemsToMove.length,
  });
  // Mirror both orders to the Cloud ERP
  emitOrderUpdated({ type: "ITEMS_MOVED", orderId: sourceOrderId });
  emitOrderUpdated({ type: "ITEMS_MOVED", orderId: targetOrderId! });

  return {
    sourceOrder: getOrderById(sourceOrderId),
    targetOrder: getOrderById(targetOrderId!),
  };
});

/**
 * Reorder / Repeat — create a new order with items from a past order.
 */
export const reorderFromPast = atomicFn(function reorderFromPast(
  sourceOrderId: string,
  newTableId?: string,
  orderMode?: "DINE_IN" | "TAKEAWAY" | "DELIVERY" | "ONLINE",
  userId?: string
) {
  const sourceOrder = db.select().from(schema.orders).where(eq(schema.orders.id, sourceOrderId)).get();
  if (!sourceOrder) throw new Error("Source order not found");

  const sourceItems = db.select().from(schema.orderItems)
    .where(eq(schema.orderItems.orderId, sourceOrderId))
    .all()
    .filter(i => i.status !== "VOIDED");

  if (sourceItems.length === 0) throw new Error("Source order has no items to reorder");

  // Create new order
  const newOrder = createOrder({
    orderMode: orderMode ?? (sourceOrder.orderMode as "DINE_IN" | "TAKEAWAY" | "DELIVERY" | "ONLINE"),
    tableId: newTableId,
    waiterId: sourceOrder.waiterId ?? undefined,
    waiterName: sourceOrder.waiterName ?? undefined,
    customerId: sourceOrder.customerId ?? undefined,
    customerName: sourceOrder.customerName ?? undefined,
    customerPhone: sourceOrder.customerPhone ?? undefined,
    notes: `Reorder from ${sourceOrder.orderNumber}`,
  }, userId);

  if (!newOrder) throw new Error("Failed to create new order");

  // Add items from source
  const itemInputs: AddItemInput[] = sourceItems.map(item => ({
    menuItemId: item.menuItemId,
    menuItemName: item.menuItemName,
    variantName: item.variantName ?? undefined,
    quantity: item.quantity,
    unitPrice: item.unitPrice,
    gstRate: item.gstRate as GSTRate,
    modifiers: safeJsonArray<string>(item.modifiers),
    addOns: safeJsonArray<{ name: string; quantity: number; unitPrice: number; amount: number }>(item.addOns),
    notes: item.notes ?? undefined,
  }));

  addItemsToOrder(newOrder.id, itemInputs, userId);

  logEvent(newOrder.id, "REORDERED_FROM", {
    sourceOrderId,
    sourceOrderNumber: sourceOrder.orderNumber,
  }, userId);

  return getOrderById(newOrder.id);
});

/**
 * Change order mode mid-order (e.g., DINE_IN → TAKEAWAY).
 * Handles table assignment/release accordingly.
 */
export const changeOrderMode = atomicFn(function changeOrderMode(
  orderId: string,
  newMode: "DINE_IN" | "TAKEAWAY" | "DELIVERY" | "ONLINE",
  newTableId?: string,
  userId?: string
) {
  if (!ORDER_MODES.includes(newMode)) {
    throw new Error(`mode must be one of ${ORDER_MODES.join(", ")}`);
  }
  const order = requireOpenOrder(orderId, "change the order mode");

  const oldMode = order.orderMode;
  const now = new Date().toISOString();
  let assignedTableId: string | null = order.tableId;

  if (newMode === "DINE_IN") {
    const wantsTable = newTableId ?? order.tableId;
    if (!wantsTable) throw new Error("A table is required for a dine-in order");

    if (wantsTable !== order.tableId) {
      const targetTable = db.select().from(schema.diningTables).where(eq(schema.diningTables.id, wantsTable)).get();
      if (!targetTable) throw new Error("Target table not found");
      if (targetTable.status !== "AVAILABLE") throw new Error("Target table is not available");

      // Leaving the previous table (dine-in → dine-in on another table)
      releaseTableIfHeldBy(order.tableId, orderId, order);

      db.update(schema.diningTables)
        .set({ status: "OCCUPIED", currentOrderId: orderId })
        .where(eq(schema.diningTables.id, wantsTable))
        .run();
      emitTableStatusChanged({ tableId: wantsTable, tableName: targetTable.name, status: "OCCUPIED", orderId });
      queueSyncEvent("TABLE_STATUS_CHANGED", {
        tableId: wantsTable,
        tableName: targetTable.name,
        status: "OCCUPIED",
        orderId,
        orderNumber: order.orderNumber,
        organizationId: order.organizationId,
        outletId: order.outletId,
      });
    }
    assignedTableId = wantsTable;
  } else {
    // Takeaway / delivery / online orders hold no table
    releaseTableIfHeldBy(order.tableId, orderId, order);
    assignedTableId = null;
  }

  if (oldMode === newMode && assignedTableId === order.tableId) {
    return getOrderById(orderId);
  }

  db.update(schema.orders)
    .set({
      orderMode: newMode,
      previousOrderMode: oldMode,
      tableId: assignedTableId,
      updatedAt: now,
    })
    .where(eq(schema.orders.id, orderId))
    .run();

  logEvent(orderId, "ORDER_MODE_CHANGED", {
    oldMode,
    newMode,
    oldTableId: order.tableId,
    newTableId: assignedTableId,
  }, userId);

  emitOrderModeChanged({
    orderId,
    orderNumber: order.orderNumber,
    oldMode,
    newMode,
    tableId: assignedTableId,
  });

  queueSyncEvent("ORDER_MODE_CHANGED", {
    orderId,
    orderNumber: order.orderNumber,
    oldMode,
    newMode,
    organizationId: order.organizationId,
    outletId: order.outletId,
  });

  const updated = getOrderById(orderId);
  emitOrderUpdated({ type: "ORDER_MODE_CHANGED", order: updated });
  return updated;
});

/**
 * Reassign waiter for an active order.
 */
export const reassignWaiter = atomicFn(function reassignWaiter(
  orderId: string,
  newWaiterId: string,
  newWaiterName: string,
  userId?: string
) {
  const order = requireOpenOrder(orderId, "reassign the waiter");

  const oldWaiterName = order.waiterName;

  db.update(schema.orders)
    .set({
      waiterId: newWaiterId,
      waiterName: newWaiterName,
      updatedAt: new Date().toISOString(),
    })
    .where(eq(schema.orders.id, orderId))
    .run();

  logEvent(orderId, "WAITER_REASSIGNED", {
    oldWaiterId: order.waiterId,
    oldWaiterName,
    newWaiterId,
    newWaiterName,
  }, userId);

  const updated = getOrderById(orderId);
  emitOrderUpdated({ type: "WAITER_REASSIGNED", order: updated });
  return updated;
});

/**
 * Apply item-level discount (separate from order-level discount).
 */
export const applyItemDiscount = atomicFn(function applyItemDiscount(
  orderId: string,
  itemId: string,
  discount: { type: "PERCENTAGE" | "FLAT"; value: number; reason?: string } | null,
  userId?: string
) {
  requireOpenOrder(orderId, "discount items");
  const item = requireOrderItem(orderId, itemId);
  if (item.status === "VOIDED") throw new Error("Cannot discount a voided item");

  // A zero discount clears it
  if (discount && discount.value === 0) discount = null;

  if (discount) {
    // Validate discount amount
    if (discount.type !== "PERCENTAGE" && discount.type !== "FLAT") {
      throw new Error("Discount type must be PERCENTAGE or FLAT");
    }
    if (typeof discount.value !== "number" || !Number.isFinite(discount.value) || discount.value < 0) {
      throw new Error("Discount value must be zero or more");
    }
    if (discount.type === "PERCENTAGE" && discount.value > 100) {
      throw new Error("Percentage discount must be between 0 and 100");
    }
    const lineGross = calculateLineGross({
      unitPrice: item.unitPrice,
      quantity: item.quantity,
      addOns: safeJsonArray<{ name: string; quantity: number; unitPrice: number }>(item.addOns),
    });
    if (discount.type === "FLAT" && discount.value > lineGross) {
      throw new Error("Flat discount cannot exceed item total");
    }

    db.update(schema.orderItems)
      .set({
        itemDiscountType: discount.type,
        itemDiscountValue: discount.value,
        itemDiscountReason: discount.reason ?? null,
      })
      .where(eq(schema.orderItems.id, itemId))
      .run();
  } else {
    // Clear discount
    db.update(schema.orderItems)
      .set({
        itemDiscountType: null,
        itemDiscountValue: null,
        itemDiscountReason: null,
      })
      .where(eq(schema.orderItems.id, itemId))
      .run();
  }

  recalculateOrderTotals(orderId);

  logEvent(orderId, "ITEM_DISCOUNT_APPLIED", {
    itemId,
    menuItemName: item.menuItemName,
    discount,
  }, userId);

  const updated = getOrderById(orderId);
  emitOrderUpdated({ type: "ITEM_DISCOUNT", order: updated });
  return updated;
});

/**
 * Mark an entire order as complimentary (NC — No Charge).
 * Order total stays for tracking, but payment is ₹0.
 */
export const markAsComplimentary = atomicFn(function markAsComplimentary(
  orderId: string,
  reason: string,
  approvedBy: string,
  userId?: string
) {
  const order = requireOpenOrder(orderId, "mark it complimentary");
  reason = typeof reason === "string" ? reason.trim().slice(0, 300) : "";
  approvedBy = typeof approvedBy === "string" ? approvedBy.trim().slice(0, 120) : "";
  if (!reason || !approvedBy) throw new Error("reason and approvedBy are required");

  db.update(schema.orders)
    .set({
      isComplimentary: true,
      complimentaryReason: reason,
      complimentaryApprovedBy: approvedBy,
      updatedAt: new Date().toISOString(),
    })
    .where(eq(schema.orders.id, orderId))
    .run();

  logEvent(orderId, "ORDER_COMPLIMENTARY", {
    reason,
    approvedBy,
    originalTotal: order.totalAmount,
  }, userId);

  queueSyncEvent("ORDER_COMPLIMENTARY", {
    orderId,
    orderNumber: order.orderNumber,
    reason,
    approvedBy,
    organizationId: order.organizationId,
    outletId: order.outletId,
  });

  const updated = getOrderById(orderId);
  emitOrderUpdated({ type: "ORDER_COMPLIMENTARY", order: updated });
  return updated;
});

/**
 * Split an order item's quantity into two separate items.
 * E.g., split qty=3 into qty=2 and qty=1.
 */
export const splitOrderItemQuantity = atomicFn(function splitOrderItemQuantity(
  orderId: string,
  itemId: string,
  splitQuantity: number,
  userId?: string
) {
  const order = requireOpenOrder(orderId, "split items");
  if (!isOrderEditable(new Date(order.createdAt))) {
    throw new Error("Order is past the 48-hour edit window");
  }
  requireWholeQuantity(splitQuantity, "splitQuantity");

  const item = requireOrderItem(orderId, itemId);
  if (item.status === "VOIDED") throw new Error("Cannot split a voided item");

  if (splitQuantity <= 0 || splitQuantity >= item.quantity) {
    throw new Error("Split quantity must be strictly greater than 0 and less than current quantity");
  }

  const remainingQuantity = item.quantity - splitQuantity;

  // A flat line discount is shared between the two halves in proportion to
  // quantity (a percentage applies to each half as-is).
  let splitDiscountValue = item.itemDiscountValue;
  let remainingDiscountValue = item.itemDiscountValue;
  if (item.itemDiscountType === "FLAT" && item.itemDiscountValue) {
    splitDiscountValue = Math.round(((item.itemDiscountValue * splitQuantity) / item.quantity) * 100) / 100;
    remainingDiscountValue = Math.round((item.itemDiscountValue - splitDiscountValue) * 100) / 100;
  }

  // 1. Update the original item's quantity to the remaining quantity
  db.update(schema.orderItems)
    .set({ quantity: remainingQuantity, itemDiscountValue: remainingDiscountValue })
    .where(eq(schema.orderItems.id, itemId))
    .run();

  // 2. Create a new item for the split quantity
  const newItemId = uuid();
  db.insert(schema.orderItems)
    .values({
      id: newItemId,
      orderId,
      menuItemId: item.menuItemId,
      menuItemName: item.menuItemName,
      variantName: item.variantName,
      quantity: splitQuantity,
      unitPrice: item.unitPrice,
      gstRate: item.gstRate,
      modifiers: item.modifiers,
      addOns: item.addOns,
      notes: item.notes,
      status: item.status,
      kotId: item.kotId, // If the original was sent to kitchen, the split is too
      isNcr: item.isNcr,
      itemDiscountType: item.itemDiscountType,
      itemDiscountValue: splitDiscountValue,
      itemDiscountReason: item.itemDiscountReason,
    })
    .run();

  // If the item was part of a KOT, we should also duplicate the KOT item
  // so the kitchen knows the split happened (mostly for database integrity).
  // But wait, KOT items just have kotId. 
  if (item.kotId) {
    const kotItem = db.select().from(schema.kotItems)
      .where(and(eq(schema.kotItems.kotId, item.kotId), eq(schema.kotItems.orderItemId, itemId)))
      .get();
      
    if (kotItem) {
      db.update(schema.kotItems)
        .set({ quantity: remainingQuantity })
        .where(eq(schema.kotItems.id, kotItem.id))
        .run();

      db.insert(schema.kotItems)
        .values({
          id: uuid(),
          kotId: item.kotId,
          orderItemId: newItemId,
          menuItemName: kotItem.menuItemName,
          quantity: splitQuantity,
          modifiers: kotItem.modifiers,
          notes: kotItem.notes,
        })
        .run();
    }
  }

  recalculateOrderTotals(orderId);

  logEvent(orderId, "ITEM_QUANTITY_SPLIT", {
    originalItemId: itemId,
    newItemId,
    originalQuantity: item.quantity,
    splitQuantity,
    remainingQuantity,
  }, userId);

  const updated = getOrderById(orderId);
  emitOrderUpdated({ type: "ITEM_UPDATED", order: updated });
  return updated;
});

