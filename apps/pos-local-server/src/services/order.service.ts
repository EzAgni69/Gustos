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
import {
  calculateCartTotals,
  isOrderEditable,
  type CartItem,
  type DiscountConfig,
  type GSTRate,
} from "@gusto/core-logic";
import { getNextOrderNumber } from "./sequence.service.js";
import { queueSyncEvent } from "./sync.service.js";
import {
  emitOrderUpdated,
  emitTableStatusChanged,
  emitOrderModeChanged,
  emitOrderItemsMoved,
  emitOnlineOrderReceived,
} from "../socket/events.js";
import { cancelKOT, generateModificationKOT } from "./kot.service.js";

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
}

// ─── Config (should come from outlet settings) ───

const OUTLET_ID = process.env.OUTLET_ID || "local-outlet";
const ORGANIZATION_ID = process.env.ORGANIZATION_ID || "local-org";

// ─── Helpers ───

export function recalculateOrderTotals(orderId: string): void {
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

  // Filter out voided items so they are not charged to customer
  const activeItems = items.filter((item) => item.status !== "VOIDED");

  // Build CartItem array for core-logic (including add-ons and variant info)
  const cartItems: CartItem[] = activeItems.map((item) => ({
    menuItemId: item.menuItemId,
    menuItemName: item.menuItemName,
    variantName: item.variantName ?? undefined,
    quantity: item.quantity,
    unitPrice: item.unitPrice,
    gstRate: item.gstRate as GSTRate,
    modifiers: item.modifiers ? (typeof item.modifiers === "string" ? JSON.parse(item.modifiers) : item.modifiers) : undefined,
    addOns: item.addOns ? (typeof item.addOns === "string" ? JSON.parse(item.addOns) : item.addOns) : undefined,
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
      modifiers: item.modifiers ? (typeof item.modifiers === "string" ? JSON.parse(item.modifiers) : item.modifiers) : [],
      addOns: item.addOns ? (typeof item.addOns === "string" ? JSON.parse(item.addOns) : item.addOns) : [],
    })),
    kots,
  };
}

/**
 * Create a DRAFT online order from an incoming Zomato/Swiggy webhook.
 */
export function createOnlineOrderFromWebhook(payload: any) {
  // Map Zomato payload to Gustos schema
  const customerName = payload.customer?.name || "Zomato Customer";
  const customerPhone = payload.customer?.phone;
  
  // Create DRAFT order
  const newOrderInput: CreateOrderInput = {
    orderMode: "ONLINE",
    customerName,
    customerPhone,
    notes: `Online Order ID: ${payload.order_id}`,
  };

  const newOrder = createOrder(newOrderInput, "system");
  if (!newOrder) throw new Error("Failed to create online order");

  // Attempt to map items based on pos_mapped_id from cloud, otherwise fallback to name lookup
  const itemsToAdd: AddItemInput[] = (payload.items || []).map((item: any) => {
    let localItem = null;
    
    // 1. Try explicit mapping
    if (item.pos_mapped_id) {
      localItem = db
        .select()
        .from(schema.menuItems)
        .where(eq(schema.menuItems.id, item.pos_mapped_id))
        .get();
    }

    // 2. Fallback local lookup by name
    if (!localItem) {
      localItem = db
        .select()
        .from(schema.menuItems)
        .where(eq(schema.menuItems.name, item.item_name))
        .get();
    }

    return {
      menuItemId: localItem?.id || uuid(),
      menuItemName: localItem?.name || item.item_name,
      quantity: item.quantity,
      unitPrice: item.unit_price,
      gstRate: (localItem?.gstRate as GSTRate) || "5",
      notes: item.special_instructions,
    };
  });

  if (itemsToAdd.length > 0) {
    addItemsToOrder(newOrder.id, itemsToAdd, "system");
  }
  
  // Attach the cloud's onlineOrderId to the notes or a new field so we can ack it later
  db.update(schema.orders)
    .set({ notes: `onlineOrderId:${payload.onlineOrderId} | Zomato: ${payload.order_id}` })
    .where(eq(schema.orders.id, newOrder.id))
    .run();

  const finalOrder = getOrderById(newOrder.id);
  
  // Alert the POS
  emitOnlineOrderReceived(finalOrder!);

  console.log(`[OrderService] Created DRAFT online order ${finalOrder?.orderNumber} for Zomato order ${payload.order_id}`);
  return finalOrder;
}

/**
 * Accept a DRAFT online order.
 */
export function acceptOnlineOrder(orderId: string, userId?: string) {
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
  const match = order.notes?.match(/onlineOrderId:([^\s|]+)/);
  const onlineOrderId = match ? match[1] : null;
  queueSyncEvent("ONLINE_ORDER_ACCEPTED", { orderId, orderNumber: order.orderNumber, onlineOrderId });

  return updated;
}

/**
 * Reject a DRAFT online order.
 */
export function rejectOnlineOrder(orderId: string, reason: string, userId?: string) {
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
  
  const match = order.notes?.match(/onlineOrderId:([^\s|]+)/);
  const onlineOrderId = match ? match[1] : null;
  queueSyncEvent("ONLINE_ORDER_REJECTED", { orderId, orderNumber: order.orderNumber, reason, onlineOrderId });

  return updated;
}

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
        variantName: item.variantName,
        quantity: item.quantity,
        unitPrice: item.unitPrice,
        gstRate: item.gstRate,
        modifiers: item.modifiers ? JSON.stringify(item.modifiers) : null,
        addOns: item.addOns ? JSON.stringify(item.addOns) : null,
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

  const item = db.select().from(schema.orderItems).where(eq(schema.orderItems.id, itemId)).get();
  if (!item) throw new Error("Item not found");
  if (item.status === "VOIDED") throw new Error("Cannot update a voided item");

  if (quantity <= 0) {
    return removeItem(orderId, itemId, userId);
  }

  const oldQty = item.quantity;
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
  if (!item) return getOrderById(orderId);

  // If item was already sent on a KOT, it cannot be hard deleted due to foreign key constraints and audit trail.
  // We automatically void it and notify the kitchen!
  if (item.kotId) {
    return voidItem(orderId, itemId, "Item removed from order", userId || "Staff", userId);
  }

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

    const tableObj = db.select().from(schema.diningTables).where(eq(schema.diningTables.id, order.tableId)).get();

    emitTableStatusChanged({
      tableId: order.tableId,
      tableName: tableObj?.name,
      status: "AVAILABLE",
    });

    queueSyncEvent("TABLE_STATUS_CHANGED", {
      tableId: order.tableId,
      tableName: tableObj?.name,
      status: "AVAILABLE",
      organizationId: order.organizationId,
      outletId: order.outletId,
    });
  }

  logEvent(orderId, "ORDER_CANCELLED", {}, userId);
  queueSyncEvent("ORDER_CANCELLED", {
    orderId,
    orderNumber: order.orderNumber,
    organizationId: order.organizationId,
    outletId: order.outletId,
  });

  return getOrderById(orderId);
}

// ─── Edge Case Operations ───

/**
 * Void an item (NCR — Non-Chargeable Revenue).
 * Item stays in DB for audit trail. Requires reason and manager approval.
 */
export function voidItem(
  orderId: string,
  itemId: string,
  reason: string,
  approvedBy: string,
  userId?: string,
  voidQuantity?: number
) {
  const order = db.select().from(schema.orders).where(eq(schema.orders.id, orderId)).get();
  if (!order) throw new Error("Order not found");

  const item = db.select().from(schema.orderItems).where(eq(schema.orderItems.id, itemId)).get();
  if (!item) throw new Error("Item not found");
  if (item.status === "VOIDED") throw new Error("Item is already voided");

  const now = new Date().toISOString();
  const isPartial = voidQuantity !== undefined && voidQuantity > 0 && voidQuantity < item.quantity;
  const qtyToVoid = isPartial ? voidQuantity : item.quantity;
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
}

/**
 * Merge all items from source order into target order.
 * Source order is marked as MERGED, its table is released.
 */
export function mergeOrders(
  sourceOrderId: string,
  targetOrderId: string,
  userId?: string
) {
  const sourceOrder = db.select().from(schema.orders).where(eq(schema.orders.id, sourceOrderId)).get();
  const targetOrder = db.select().from(schema.orders).where(eq(schema.orders.id, targetOrderId)).get();

  if (!sourceOrder) throw new Error("Source order not found");
  if (!targetOrder) throw new Error("Target order not found");
  if (sourceOrder.status === "COMPLETED" || sourceOrder.status === "CANCELLED" || sourceOrder.status === "MERGED") {
    throw new Error(`Source order is ${sourceOrder.status} — cannot merge`);
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

  // Move KOTs from source to target
  db.update(schema.kitchenOrderTickets)
    .set({ orderId: targetOrderId })
    .where(eq(schema.kitchenOrderTickets.orderId, sourceOrderId))
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

  // Release source table
  if (sourceOrder.tableId) {
    db.update(schema.diningTables)
      .set({ status: "AVAILABLE", currentOrderId: null })
      .where(eq(schema.diningTables.id, sourceOrder.tableId))
      .run();

    emitTableStatusChanged({ tableId: sourceOrder.tableId, status: "AVAILABLE" });
  }

  // Update paxCount on target (combine both)
  db.update(schema.orders)
    .set({
      paxCount: targetOrder.paxCount + sourceOrder.paxCount,
      updatedAt: now,
    })
    .where(eq(schema.orders.id, targetOrderId))
    .run();

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

  const updated = getOrderById(targetOrderId);
  emitOrderUpdated({ type: "ORDERS_MERGED", order: updated });
  return updated;
}

/**
 * Move selected items from one order to another (or create a new order).
 * Handles partial splits — e.g., 3 guests from Table 5 move to Table 9.
 */
export function moveItemsToOrder(
  sourceOrderId: string,
  itemIds: string[],
  targetOrderId?: string,
  targetTableId?: string,
  userId?: string
) {
  const sourceOrder = db.select().from(schema.orders).where(eq(schema.orders.id, sourceOrderId)).get();
  if (!sourceOrder) throw new Error("Source order not found");

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
  } else {
    targetOrder = db.select().from(schema.orders).where(eq(schema.orders.id, targetOrderId)).get();
    if (!targetOrder) throw new Error("Target order not found");
  }

  // Move each item
  for (const item of itemsToMove) {
    db.update(schema.orderItems)
      .set({ orderId: targetOrderId })
      .where(eq(schema.orderItems.id, item.id))
      .run();
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

    if (sourceOrder.tableId) {
      db.update(schema.diningTables)
        .set({ status: "AVAILABLE", currentOrderId: null })
        .where(eq(schema.diningTables.id, sourceOrder.tableId))
        .run();
      emitTableStatusChanged({ tableId: sourceOrder.tableId, status: "AVAILABLE" });
    }
  }

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

  return {
    sourceOrder: getOrderById(sourceOrderId),
    targetOrder: getOrderById(targetOrderId!),
  };
}

/**
 * Reorder / Repeat — create a new order with items from a past order.
 */
export function reorderFromPast(
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
    modifiers: item.modifiers ? JSON.parse(item.modifiers) : undefined,
    notes: item.notes ?? undefined,
  }));

  addItemsToOrder(newOrder.id, itemInputs, userId);

  logEvent(newOrder.id, "REORDERED_FROM", {
    sourceOrderId,
    sourceOrderNumber: sourceOrder.orderNumber,
  }, userId);

  return getOrderById(newOrder.id);
}

/**
 * Change order mode mid-order (e.g., DINE_IN → TAKEAWAY).
 * Handles table assignment/release accordingly.
 */
export function changeOrderMode(
  orderId: string,
  newMode: "DINE_IN" | "TAKEAWAY" | "DELIVERY" | "ONLINE",
  newTableId?: string,
  userId?: string
) {
  const order = db.select().from(schema.orders).where(eq(schema.orders.id, orderId)).get();
  if (!order) throw new Error("Order not found");
  if (order.status === "COMPLETED" || order.status === "CANCELLED") {
    throw new Error(`Cannot change mode of ${order.status} order`);
  }

  const oldMode = order.orderMode;
  const now = new Date().toISOString();

  // Release old table if switching away from DINE_IN
  if (oldMode === "DINE_IN" && newMode !== "DINE_IN" && order.tableId) {
    db.update(schema.diningTables)
      .set({ status: "AVAILABLE", currentOrderId: null })
      .where(eq(schema.diningTables.id, order.tableId))
      .run();
    emitTableStatusChanged({ tableId: order.tableId, status: "AVAILABLE" });
  }

  // Assign new table if switching to DINE_IN
  let assignedTableId = order.tableId;
  if (newMode === "DINE_IN" && newTableId) {
    const targetTable = db.select().from(schema.diningTables).where(eq(schema.diningTables.id, newTableId)).get();
    if (!targetTable) throw new Error("Target table not found");
    if (targetTable.status !== "AVAILABLE") throw new Error("Target table is not available");

    db.update(schema.diningTables)
      .set({ status: "OCCUPIED", currentOrderId: orderId })
      .where(eq(schema.diningTables.id, newTableId))
      .run();
    emitTableStatusChanged({ tableId: newTableId, status: "OCCUPIED", orderId });
    assignedTableId = newTableId;
  } else if (newMode !== "DINE_IN") {
    assignedTableId = null;
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

  return getOrderById(orderId);
}

/**
 * Reassign waiter for an active order.
 */
export function reassignWaiter(
  orderId: string,
  newWaiterId: string,
  newWaiterName: string,
  userId?: string
) {
  const order = db.select().from(schema.orders).where(eq(schema.orders.id, orderId)).get();
  if (!order) throw new Error("Order not found");

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
}

/**
 * Apply item-level discount (separate from order-level discount).
 */
export function applyItemDiscount(
  orderId: string,
  itemId: string,
  discount: { type: "PERCENTAGE" | "FLAT"; value: number; reason?: string } | null,
  userId?: string
) {
  const order = db.select().from(schema.orders).where(eq(schema.orders.id, orderId)).get();
  if (!order) throw new Error("Order not found");

  const item = db.select().from(schema.orderItems).where(eq(schema.orderItems.id, itemId)).get();
  if (!item) throw new Error("Item not found");
  if (item.status === "VOIDED") throw new Error("Cannot discount a voided item");

  if (discount) {
    // Validate discount amount
    if (discount.type === "PERCENTAGE" && (discount.value < 0 || discount.value > 100)) {
      throw new Error("Percentage discount must be between 0 and 100");
    }
    if (discount.type === "FLAT" && discount.value > item.unitPrice * item.quantity) {
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
}

/**
 * Mark an entire order as complimentary (NC — No Charge).
 * Order total stays for tracking, but payment is ₹0.
 */
export function markAsComplimentary(
  orderId: string,
  reason: string,
  approvedBy: string,
  userId?: string
) {
  const order = db.select().from(schema.orders).where(eq(schema.orders.id, orderId)).get();
  if (!order) throw new Error("Order not found");
  if (order.status === "COMPLETED" || order.status === "CANCELLED") {
    throw new Error(`Cannot mark ${order.status} order as complimentary`);
  }

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
}

/**
 * Split an order item's quantity into two separate items.
 * E.g., split qty=3 into qty=2 and qty=1.
 */
export function splitOrderItemQuantity(
  orderId: string,
  itemId: string,
  splitQuantity: number,
  userId?: string
) {
  const order = db.select().from(schema.orders).where(eq(schema.orders.id, orderId)).get();
  if (!order) throw new Error("Order not found");
  if (!isOrderEditable(new Date(order.createdAt))) {
    throw new Error("Order is past the 48-hour edit window");
  }

  const item = db.select().from(schema.orderItems).where(eq(schema.orderItems.id, itemId)).get();
  if (!item) throw new Error("Item not found");
  if (item.status === "VOIDED") throw new Error("Cannot split a voided item");

  if (splitQuantity <= 0 || splitQuantity >= item.quantity) {
    throw new Error("Split quantity must be strictly greater than 0 and less than current quantity");
  }

  const remainingQuantity = item.quantity - splitQuantity;

  // 1. Update the original item's quantity to the remaining quantity
  db.update(schema.orderItems)
    .set({ quantity: remainingQuantity })
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
      itemDiscountValue: item.itemDiscountValue,
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
}

