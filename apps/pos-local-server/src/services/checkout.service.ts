/**
 * Gusto POS Local Server — Checkout Service
 *
 * Payment processing, invoice generation, and order completion.
 */

import { eq, and, ne, notInArray } from "drizzle-orm";
import { v4 as uuid } from "uuid";
import * as schema from "@gusto/db-schema/local";
import { db } from "../db/index.js";
import {
  calculateCartTotals,
  validatePaymentSplits,
  buildReceiptFromOrder,
  roundCurrency,
  type PaymentSplitInput,
  type CartItem,
  type DiscountConfig,
  type GSTRate,
} from "@gusto/core-logic";
import { buildBillReceipt, renderToConsole } from "@gusto/printer";
import { getNextInvoiceNumber } from "./sequence.service.js";
import { queueSyncEvent } from "./sync.service.js";
import { getActiveShift } from "./shift.service.js";
import { emitOrderUpdated, emitTableStatusChanged } from "../socket/events.js";
import { generateKOT } from "./kot.service.js";

const OUTLET_ID = process.env.OUTLET_ID || "local-outlet";

export type PaymentMode = "CASH" | "CARD" | "UPI" | "ONLINE" | "SPLIT" | "OTHER";

export interface CheckoutInput {
  paymentMode: PaymentMode;
  paymentSubMethod?: string;
  paymentSplits?: PaymentSplitInput[];
  tipAmount?: number;
  tenderedAmount?: number; // Cash tendered by customer
  changeDue?: number; // Change returned
}

/**
 * Process payment and complete an order.
 */
export function processCheckout(
  orderId: string,
  input: CheckoutInput,
  userId?: string
) {
  const order = db
    .select()
    .from(schema.orders)
    .where(eq(schema.orders.id, orderId))
    .get();

  if (!order) throw new Error("Order not found");
  if (order.status === "COMPLETED" || order.status === "CANCELLED") {
    throw new Error(`Order is already ${order.status.toLowerCase()}`);
  }

  // Permissive Shift Enforcement: warn if no shift is active, but allow checkout
  const activeShift = getActiveShift();
  if (!activeShift) {
    console.warn(`⚠️ [Checkout] Processing payment for ${order.orderNumber} without an active shift!`);
  }

  const items = db
    .select()
    .from(schema.orderItems)
    .where(eq(schema.orderItems.orderId, orderId))
    .all();

  const activeItems = items.filter((item) => item.status !== "VOIDED");

  if (activeItems.length === 0) {
    throw new Error("Cannot checkout an empty order");
  }

  // Auto-generate KOT for any items not yet sent to kitchen so KDS displays the order ticket
  const unfiredItems = activeItems.filter((item) => !item.kotId);
  if (unfiredItems.length > 0) {
    try {
      generateKOT(orderId, undefined, undefined, userId);
    } catch (kotErr) {
      console.warn(`[Checkout] Auto-KOT notice for ${order.orderNumber}:`, kotErr);
    }
  }

  // Calculate final totals
  const cartItems: CartItem[] = activeItems.map((item) => ({
    menuItemId: item.menuItemId,
    menuItemName: item.menuItemName,
    variantName: item.variantName ?? undefined,
    quantity: item.quantity,
    unitPrice: item.unitPrice,
    gstRate: item.gstRate as GSTRate,
    modifiers: item.modifiers ? JSON.parse(item.modifiers) : undefined,
    notes: item.notes ?? undefined,
    addOns: item.addOns ? JSON.parse(item.addOns) : undefined,
  }));

  let discount: DiscountConfig | undefined;
  if (order.discountType && order.discountValue) {
    discount = {
      type: order.discountType as "PERCENTAGE" | "FLAT",
      value: order.discountValue,
    };
  }

  const totals = calculateCartTotals(cartItems, discount);
  const tipAmount = input.tipAmount && input.tipAmount > 0 ? roundCurrency(input.tipAmount) : 0;
  const payableTotal = roundCurrency(totals.grandTotal + tipAmount);

  // Validate split payments if applicable
  if (input.paymentMode === "SPLIT") {
    if (!input.paymentSplits || input.paymentSplits.length === 0) {
      throw new Error("Split payment requires paymentSplits to be provided");
    }
    const validation = validatePaymentSplits(input.paymentSplits, payableTotal);
    if (!validation.valid) {
      throw new Error(validation.error);
    }
  } else if (input.paymentMode === "CASH" && input.tenderedAmount !== undefined) {
    const tenderedAmount = roundCurrency(input.tenderedAmount);
    if (tenderedAmount < payableTotal) {
      throw new Error(
        `Tendered amount (₹${tenderedAmount.toFixed(2)}) is less than payable total (₹${payableTotal.toFixed(2)})`
      );
    }
  }

  // Generate invoice
  const invoiceId = uuid();
  const invoiceNumber = getNextInvoiceNumber();
  const now = new Date().toISOString();

  const tenderedAmount = input.tenderedAmount !== undefined ? roundCurrency(input.tenderedAmount) : null;
  const changeDue = input.changeDue !== undefined ? roundCurrency(input.changeDue) : null;

  db.insert(schema.invoices)
    .values({
      id: invoiceId,
      orderId,
      invoiceNumber,
      receiptStatus: "ORIGINAL",
      subtotal: totals.subtotal,
      discountAmount: totals.discountAmount,
      cgstAmount: totals.totalCgst,
      sgstAmount: totals.totalSgst,
      totalQuantity: totals.totalQuantity,
      totalAmount: totals.grandTotal,
      paymentMode: input.paymentMode,
      paymentSubMethod: input.paymentSubMethod,
      paymentSplits: input.paymentSplits ? JSON.stringify(input.paymentSplits) : null,
      tipAmount,
      tenderedAmount,
      changeDue,
      isPaid: true,
      createdAt: now,
    })
    .run();

  // Update order to COMPLETED
  db.update(schema.orders)
    .set({
      status: "COMPLETED",
      paymentMode: input.paymentMode,
      paymentSubMethod: input.paymentSubMethod,
      paymentSplits: input.paymentSplits ? JSON.stringify(input.paymentSplits) : null,
      tipAmount,
      subtotal: totals.subtotal,
      discountAmount: totals.discountAmount,
      taxAmount: totals.totalTax,
      totalAmount: totals.grandTotal,
      isSynced: false,
      updatedAt: now,
    })
    .where(eq(schema.orders.id, orderId))
    .run();

  // Release table if dine-in
  if (order.tableId) {
    db.update(schema.diningTables)
      .set({ status: "AVAILABLE", currentOrderId: null })
      .where(eq(schema.diningTables.id, order.tableId))
      .run();

    // Cancel any stale, abandoned, or lingering orders on this table so table status doesn't revert to OCCUPIED
    db.update(schema.orders)
      .set({ status: "CANCELLED", updatedAt: now })
      .where(
        and(
          eq(schema.orders.tableId, order.tableId),
          notInArray(schema.orders.status, ["COMPLETED", "CANCELLED", "MERGED"]),
          ne(schema.orders.id, orderId)
        )
      )
      .run();

    emitTableStatusChanged({
      tableId: order.tableId,
      status: "AVAILABLE",
    });
  }

  // Log event
  db.insert(schema.eventLog)
    .values({
      id: uuid(),
      orderId,
      eventType: "PAYMENT_RECEIVED",
      payload: JSON.stringify({
        paymentMode: input.paymentMode,
        paymentSubMethod: input.paymentSubMethod,
        paymentSplits: input.paymentSplits,
        totalAmount: totals.grandTotal,
        tipAmount,
        tenderedAmount,
        changeDue,
        invoiceNumber,
      }),
      userId,
      createdAt: now,
    })
    .run();

  // Queue sync event
  queueSyncEvent("ORDER_COMPLETED", {
    orderId,
    orderNumber: order.orderNumber,
    orderMode: order.orderMode,
    outletId: order.outletId,
    organizationId: order.organizationId,
    invoiceNumber,
    paymentMode: input.paymentMode,
    paymentSubMethod: input.paymentSubMethod,
    paymentSplits: input.paymentSplits,
    tipAmount,
    tenderedAmount,
    changeDue,
    subtotal: totals.subtotal,
    discountAmount: totals.discountAmount,
    taxAmount: totals.totalTax,
    totalAmount: totals.grandTotal,
    items: items.map((i) => ({
      menuItemId: i.menuItemId,
      menuItemName: i.menuItemName,
      quantity: i.quantity,
      unitPrice: i.unitPrice,
      gstRate: i.gstRate,
    })),
    completedAt: now,
  });

  // Fetch outlet config
  let outlet = db.select().from(schema.outletConfig).where(eq(schema.outletConfig.outletId, OUTLET_ID)).get();
  if (!outlet) {
    // Fallback if not configured
    outlet = {
      id: "fallback",
      outletId: OUTLET_ID,
      outletName: "Gusto's Pizzeria (Not Configured)",
      address: "Please complete setup",
      phone: null,
      gstNumber: null,
      fssaiLicenseNo: null,
      greetingMessage: "Thank you, visit again!",
      logoImagePath: null,
      defaultGstRate: "5",
      currencySymbol: "₹",
      updatedAt: now,
    };
  }

  // Build receipt template
  let table: { name: string } | undefined;
  if (order.tableId) {
    const t = db.select().from(schema.diningTables).where(eq(schema.diningTables.id, order.tableId)).get();
    if (t) table = { name: t.name };
  }

  const receiptData = buildReceiptFromOrder({
    order,
    items,
    invoice: {
      invoiceNumber,
      subtotal: totals.subtotal,
      discountAmount: totals.discountAmount,
      cgstAmount: totals.totalCgst,
      sgstAmount: totals.totalSgst,
      totalQuantity: totals.totalQuantity,
      totalAmount: totals.grandTotal,
      paymentMode: input.paymentMode,
      paymentSubMethod: input.paymentSubMethod,
      paymentSplits: input.paymentSplits ? JSON.stringify(input.paymentSplits) : null,
      tipAmount,
      tenderedAmount,
      changeDue,
    },
    outlet,
    table,
  });

  const printTemplate = buildBillReceipt(receiptData);

  // Log receipt to console (simulated print)
  console.log(`\n🧾 RECEIPT — ${invoiceNumber} (Order: ${order.orderNumber})`);
  console.log(renderToConsole(printTemplate));
  console.log("");

  emitOrderUpdated({
    type: "ORDER_COMPLETED",
    orderId,
    orderNumber: order.orderNumber,
  });

  return {
    orderId,
    orderNumber: order.orderNumber,
    invoiceId,
    invoiceNumber,
    totals,
    tipAmount,
    paymentMode: input.paymentMode,
    printTemplate,
  };
}

/**
 * Get invoice data for an order.
 */
export function getInvoice(orderId: string) {
  const invoice = db
    .select()
    .from(schema.invoices)
    .where(eq(schema.invoices.orderId, orderId))
    .get();

  if (!invoice) return null;

  const order = db
    .select()
    .from(schema.orders)
    .where(eq(schema.orders.id, orderId))
    .get();

  const items = db
    .select()
    .from(schema.orderItems)
    .where(eq(schema.orderItems.orderId, orderId))
    .all();

  const activeItems = items.filter((i) => i.status !== "VOIDED");

  return {
    ...invoice,
    order,
    items: activeItems.map((i) => ({
      ...i,
      modifiers: i.modifiers ? JSON.parse(i.modifiers) : [],
    })),
  };
}
