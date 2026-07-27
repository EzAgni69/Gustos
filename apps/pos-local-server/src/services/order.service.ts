/**
 * Gusto POS Local Server — Order Service
 *
 * Core business logic for the order lifecycle.
 * All operations hit local SQLite — zero cloud dependency.
 */

import { eq } from "drizzle-orm";
import { v4 as uuid } from "uuid";
import * as schema from "@gusto/db-schema/local";
import { db } from "../db/index.js";
import {
  calculateCartTotals,
  isOrderEditable,
  type CartItem,
  type DiscountConfig,
  type GSTRate,
} from "@gusto/core-logic";
import { getNextOrderNumber } from "./sequence.service.js";
import { queueSyncEvent } from "./sync.service.js";
import { emitOrderUpdated, emitTableStatusChanged } from "../socket/events.js";

// ─── Types ───

export interface CreateOrderInput {
  orderMode: "DINE_IN" | "TAKEAWAY" | "DELIVERY" | "QUICK_BILL";
  tableId?: string;
  waiterId?: string;
  waiterName?: string;
  paxCount?: number;
  customerId?: string;
  customerName?: string;
  customerPhone?: string;
  notes?: string;
}

export interface AddItemInput {
  menuItemId: string;
  menuItemName: string;
  quantity: number;
  unitPrice: number;
  gstRate: GSTRate;
  modifiers?: string[];
  notes?: string;
}

// ─── Config (should come from outlet settings) ───

const OUTLET_ID = process.env.OUTLET_ID || "local-outlet";
const ORGANIZATION_ID = process.env.ORGANIZATION_ID || "local-org";

// ─── Helpers ───

function recalculateOrderTotals(orderId: string): void {
  const items = db
    .select()
    .from(schema.orderItems)
    .where(eq(schema.orderItems.orderId, orderId))
    .all();

  const order = db
    .select()
    .from(schema.orders)
    .where(eq(schema.orders.id, orderId))
    .get();

  if (!order) return;

  // Build CartItem array for core-logic
  const cartItems: CartItem[] = items.map((item) => ({
    menuItemId: item.menuItemId,
    menuItemName: item.menuItemName,
    quantity: item.quantity,
    unitPrice: item.unitPrice,
    gstRate: item.gstRate as GSTRate,
    modifiers: item.modifiers ? JSON.parse(item.modifiers) : undefined,
  }));

  // Build discount config if set
  let discount: DiscountConfig | undefined;
  if (order.discountType && order.discountValue) {
    discount = {
      type: order.discountType as "PERCENTAGE" | "FLAT",
      value: order.discountValue,
    };
  }

  const totals = calculateCartTotals(cartItems, discount);

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
export function createOrder(input: CreateOrderInput, userId?: string) {
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
  if (input.orderMode === "DINE_IN" && input.tableId) {
    db.update(schema.diningTables)
      .set({ status: "OCCUPIED", currentOrderId: id })
      .where(eq(schema.diningTables.id, input.tableId))
      .run();

    emitTableStatusChanged({
      tableId: input.tableId,
      status: "OCCUPIED",
      orderId: id,
      orderNumber,
    });
  }

  logEvent(id, "ORDER_CREATED", { orderNumber, orderMode: input.orderMode, tableId: input.tableId }, userId);

  queueSyncEvent("ORDER_CREATED", {
    orderId: id,
    orderNumber,
    orderMode: input.orderMode,
    tableId: input.tableId,
    outletId: OUTLET_ID,
    organizationId: ORGANIZATION_ID,
  });

  return getOrderById(id);
}

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
    .all();

  const kots = db
    .select()
    .from(schema.kitchenOrderTickets)
    .where(eq(schema.kitchenOrderTickets.orderId, orderId))
    .all();

  return {
    ...order,
    items: items.map((item) => ({
      ...item,
      modifiers: item.modifiers ? JSON.parse(item.modifiers) : [],
    })),
    kots,
  };
}

/**
 * List orders with optional filters.
 */
export function listOrders(filters?: {
  status?: string;
  tableId?: string;
  waiterId?: string;
  limit?: number;
}) {
  let query = db.select().from(schema.orders);

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

  const orders = conditions.length > 0
    ? db.select().from(schema.orders).where(conditions[0]!).all()
    : db.select().from(schema.orders).all();

  // Sort by createdAt descending
  orders.sort((a, b) => b.createdAt.localeCompare(a.createdAt));

  const resultOrders = filters?.limit ? orders.slice(0, filters.limit) : orders;

  return resultOrders.map(order => {
    const items = db
      .select()
      .from(schema.orderItems)
      .where(eq(schema.orderItems.orderId, order.id))
      .all();

    return {
      ...order,
      items: items.map((item) => ({
        ...item,
        modifiers: item.modifiers ? JSON.parse(item.modifiers) : [],
      })),
      kots: [], // Return empty array or fetch if needed, UI only needs items for count
    };
  });
}

/**
 * Add items to an existing order.
 */
export function addItemsToOrder(
  orderId: string,
  items: AddItemInput[],
  userId?: string
) {
  const order = db
    .select()
    .from(schema.orders)
    .where(eq(schema.orders.id, orderId))
    .get();

  if (!order) throw new Error("Order not found");

  for (const item of items) {
    db.insert(schema.orderItems)
      .values({
        id: uuid(),
        orderId,
        menuItemId: item.menuItemId,
        menuItemName: item.menuItemName,
        quantity: item.quantity,
        unitPrice: item.unitPrice,
        gstRate: item.gstRate,
        modifiers: item.modifiers ? JSON.stringify(item.modifiers) : null,
        notes: item.notes,
        status: "PLACED",
      })
      .run();
  }

  // Update order status to PLACED if still DRAFT
  if (order.status === "DRAFT") {
    db.update(schema.orders)
      .set({ status: "PLACED", updatedAt: new Date().toISOString() })
      .where(eq(schema.orders.id, orderId))
      .run();
  }

  recalculateOrderTotals(orderId);

  logEvent(
    orderId,
    "ITEMS_ADDED",
    { items: items.map((i) => ({ name: i.menuItemName, qty: i.quantity })) },
    userId
  );

  const updated = getOrderById(orderId);
  emitOrderUpdated({ type: "ITEMS_ADDED", order: updated });

  return updated;
}

/**
 * Update an item's quantity.
 */
export function updateItemQuantity(
  orderId: string,
  itemId: string,
  quantity: number,
  userId?: string
) {
  const order = db.select().from(schema.orders).where(eq(schema.orders.id, orderId)).get();
  if (!order) throw new Error("Order not found");
  if (!isOrderEditable(new Date(order.createdAt))) {
    throw new Error("Order is past the 48-hour edit window");
  }

  if (quantity <= 0) {
    return removeItem(orderId, itemId, userId);
  }

  db.update(schema.orderItems)
    .set({ quantity })
    .where(eq(schema.orderItems.id, itemId))
    .run();

  recalculateOrderTotals(orderId);

  logEvent(orderId, "ITEM_QUANTITY_UPDATED", { itemId, quantity }, userId);

  const updated = getOrderById(orderId);
  emitOrderUpdated({ type: "ITEM_UPDATED", order: updated });
  return updated;
}

/**
 * Remove an item from an order.
 */
export function removeItem(
  orderId: string,
  itemId: string,
  userId?: string
) {
  const item = db.select().from(schema.orderItems).where(eq(schema.orderItems.id, itemId)).get();

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
}

/**
 * Apply or update discount on an order.
 */
export function applyDiscount(
  orderId: string,
  discount: DiscountConfig | null,
  userId?: string
) {
  if (discount) {
    db.update(schema.orders)
      .set({
        discountType: discount.type,
        discountValue: discount.value,
        updatedAt: new Date().toISOString(),
      })
      .where(eq(schema.orders.id, orderId))
      .run();
  } else {
    db.update(schema.orders)
      .set({
        discountType: null,
        discountValue: null,
        updatedAt: new Date().toISOString(),
      })
      .where(eq(schema.orders.id, orderId))
      .run();
  }

  recalculateOrderTotals(orderId);

  logEvent(orderId, "DISCOUNT_APPLIED", { discount }, userId);

  return getOrderById(orderId);
}

/**
 * Attach a customer to an order.
 */
export function attachCustomer(
  orderId: string,
  customer: { id?: string; name: string; phone: string },
  userId?: string
) {
  db.update(schema.orders)
    .set({
      customerId: customer.id,
      customerName: customer.name,
      customerPhone: customer.phone,
      updatedAt: new Date().toISOString(),
    })
    .where(eq(schema.orders.id, orderId))
    .run();

  logEvent(orderId, "CUSTOMER_ATTACHED", { customer }, userId);

  return getOrderById(orderId);
}

/**
 * Put an order on hold.
 */
export function holdOrder(orderId: string, userId?: string) {
  db.update(schema.orders)
    .set({ status: "DRAFT", updatedAt: new Date().toISOString() })
    .where(eq(schema.orders.id, orderId))
    .run();

  logEvent(orderId, "ORDER_HELD", {}, userId);

  return getOrderById(orderId);
}

/**
 * Cancel an order (within 48-hour window).
 */
export function cancelOrder(orderId: string, userId?: string) {
  const order = db.select().from(schema.orders).where(eq(schema.orders.id, orderId)).get();
  if (!order) throw new Error("Order not found");
  if (!isOrderEditable(new Date(order.createdAt))) {
    throw new Error("Order is past the 48-hour edit window");
  }

  db.update(schema.orders)
    .set({ status: "CANCELLED", updatedAt: new Date().toISOString() })
    .where(eq(schema.orders.id, orderId))
    .run();

  // Release table if dine-in
  if (order.tableId) {
    db.update(schema.diningTables)
      .set({ status: "AVAILABLE", currentOrderId: null })
      .where(eq(schema.diningTables.id, order.tableId))
      .run();

    emitTableStatusChanged({
      tableId: order.tableId,
      status: "AVAILABLE",
    });
  }

  logEvent(orderId, "ORDER_CANCELLED", {}, userId);
  queueSyncEvent("ORDER_CANCELLED", { orderId, orderNumber: order.orderNumber });

  return getOrderById(orderId);
}
