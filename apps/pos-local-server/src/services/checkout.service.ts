/**
 * Gusto POS Local Server — Checkout Service
 *
 * Payment processing, invoice generation, and order completion.
 */

import { eq, and, ne, notInArray } from "drizzle-orm";
import { v4 as uuid } from "uuid";
import * as schema from "@gusto/db-schema/local";
import { db } from "../db/index.js";
import { atomicFn } from "../db/tx.js";
import {
  calculateCartTotals,
  validatePaymentSplits,
  buildReceiptFromOrder,
  roundCurrency,
  getUniformHalfRate,
  type PaymentSplitInput,
  type DiscountConfig,
} from "@gusto/core-logic";
import { buildBillReceipt } from "@gusto/printer";
import { toCartItems, getOrderDiscount } from "./order.service.js";
import { clearUndoStack } from "./undo.service.js";
import { getNextInvoiceNumber } from "./sequence.service.js";
import { queueSyncEvent } from "./sync.service.js";
import { syncOrderToCloud } from "./order-sync.service.js";
import { getActiveShift } from "./shift.service.js";
import { emitOrderUpdated, emitTableStatusChanged } from "../socket/events.js";
import { generateKOT } from "./kot.service.js";

const OUTLET_ID = process.env.OUTLET_ID || "local-outlet";

export const PAYMENT_MODES = ["CASH", "CARD", "UPI", "ONLINE", "SPLIT", "OTHER"] as const;
export type PaymentMode = (typeof PAYMENT_MODES)[number];
const SPLIT_LEG_MODES: readonly string[] = ["CASH", "CARD", "UPI", "ONLINE", "OTHER"];

export interface CheckoutInput {
  paymentMode: PaymentMode;
  paymentSubMethod?: string;
  paymentSplits?: PaymentSplitInput[];
  tipAmount?: number;
  tenderedAmount?: number; // Cash tendered by customer
  /** Ignored — change is always computed by the server from tendered − payable */
  changeDue?: number;
}

function cleanSubMethod(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim().toUpperCase().slice(0, 40) : null;
}

/**
 * Process payment and complete an order.
 */
export const processCheckout = atomicFn(function processCheckout(
  orderId: string,
  input: CheckoutInput,
  userId?: string
) {
  if (!input || !PAYMENT_MODES.includes(input.paymentMode)) {
    throw new Error(`paymentMode must be one of ${PAYMENT_MODES.join(", ")}`);
  }

  const order = db
    .select()
    .from(schema.orders)
    .where(eq(schema.orders.id, orderId))
    .get();

  if (!order) throw new Error("Order not found");
  if (order.status === "COMPLETED" || order.status === "CANCELLED" || order.status === "MERGED") {
    throw new Error(`Order is already ${order.status.toLowerCase()}`);
  }
  if (order.orderMode === "ONLINE" && order.status === "DRAFT") {
    throw new Error("Accept the online order before billing it");
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
    generateKOT(orderId, undefined, undefined, userId);
  }

  // Calculate final totals. A complimentary (NC) order is billed at ₹0: the
  // full value is recorded as discount so sales, tax and cash figures stay true.
  const isComplimentary = order.isComplimentary;
  const discount: DiscountConfig | undefined = isComplimentary
    ? { type: "PERCENTAGE", value: 100 }
    : getOrderDiscount(order);
  const discountLabel = isComplimentary ? "Complimentary" : order.discountLabel;

  const totals = calculateCartTotals(toCartItems(activeItems), discount);

  if (input.tipAmount !== undefined && input.tipAmount !== null) {
    if (typeof input.tipAmount !== "number" || !Number.isFinite(input.tipAmount) || input.tipAmount < 0) {
      throw new Error("tipAmount must be zero or more");
    }
  }
  const tipAmount = input.tipAmount && input.tipAmount > 0 ? roundCurrency(input.tipAmount) : 0;
  const payableTotal = roundCurrency(totals.grandTotal + tipAmount);

  let paymentMode: PaymentMode = input.paymentMode;
  let paymentSubMethod = cleanSubMethod(input.paymentSubMethod);
  let paymentSplits: PaymentSplitInput[] | null = null;
  let tenderedAmount: number | null = null;
  let changeDue: number | null = null;

  if (payableTotal === 0) {
    // Nothing to collect (complimentary or 100% discount)
    paymentMode = "OTHER";
    paymentSubMethod = isComplimentary ? "COMPLIMENTARY" : "NO_CHARGE";
  } else if (paymentMode === "SPLIT") {
    if (!Array.isArray(input.paymentSplits) || input.paymentSplits.length === 0) {
      throw new Error("Split payment requires paymentSplits to be provided");
    }
    paymentSplits = input.paymentSplits.map((leg, i) => {
      const mode = String(leg?.mode ?? "").toUpperCase();
      if (!SPLIT_LEG_MODES.includes(mode)) {
        throw new Error(`Payment leg ${i + 1} has an invalid mode: ${leg?.mode}`);
      }
      const sub = cleanSubMethod(leg.subMethod);
      const reference = typeof leg.reference === "string" && leg.reference.trim() ? leg.reference.trim().slice(0, 80) : undefined;
      return {
        mode,
        ...(sub ? { subMethod: sub } : {}),
        amount: roundCurrency(Number(leg.amount)),
        ...(reference ? { reference } : {}),
      };
    });
    const validation = validatePaymentSplits(paymentSplits, payableTotal);
    if (!validation.valid) {
      throw new Error(validation.error);
    }
    paymentSubMethod = null;
  } else if (paymentMode === "CASH" && input.tenderedAmount !== undefined && input.tenderedAmount !== null) {
    if (typeof input.tenderedAmount !== "number" || !Number.isFinite(input.tenderedAmount)) {
      throw new Error("tenderedAmount must be a number");
    }
    tenderedAmount = roundCurrency(input.tenderedAmount);
    if (tenderedAmount < payableTotal) {
      throw new Error(
        `Tendered amount (₹${tenderedAmount.toFixed(2)}) is less than payable total (₹${payableTotal.toFixed(2)})`
      );
    }
    changeDue = roundCurrency(tenderedAmount - payableTotal);
  }

  const splitsJson = paymentSplits ? JSON.stringify(paymentSplits) : null;
  const halfRate = getUniformHalfRate(totals.taxBreakdown);

  // Generate invoice
  const invoiceId = uuid();
  const invoiceNumber = getNextInvoiceNumber();
  const now = new Date().toISOString();

  db.insert(schema.invoices)
    .values({
      id: invoiceId,
      orderId,
      invoiceNumber,
      receiptStatus: "ORIGINAL",
      subtotal: totals.subtotal,
      discountAmount: totals.discountAmount,
      cgstRate: halfRate,
      cgstAmount: totals.totalCgst,
      sgstRate: halfRate,
      sgstAmount: totals.totalSgst,
      totalQuantity: totals.totalQuantity,
      totalAmount: totals.grandTotal,
      paymentMode,
      paymentSubMethod,
      paymentSplits: splitsJson,
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
      paymentMode,
      paymentSubMethod,
      paymentSplits: splitsJson,
      discountLabel,
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
  let checkoutTableName: string | undefined = undefined;
  if (order.tableId) {
    db.update(schema.diningTables)
      .set({ status: "AVAILABLE", currentOrderId: null })
      .where(eq(schema.diningTables.id, order.tableId))
      .run();

    const tableObj = db.select().from(schema.diningTables).where(eq(schema.diningTables.id, order.tableId)).get();
    checkoutTableName = tableObj?.name;

    // Cancel any stale, abandoned, or lingering orders on this table so table status doesn't revert to OCCUPIED
    const staleOrderIds = db
      .select({ id: schema.orders.id })
      .from(schema.orders)
      .where(
        and(
          eq(schema.orders.tableId, order.tableId),
          notInArray(schema.orders.status, ["COMPLETED", "CANCELLED", "MERGED"]),
          ne(schema.orders.id, orderId)
        )
      )
      .all()
      .map((o) => o.id);
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
    // Mirror the implicit cancellations to the Cloud ERP
    staleOrderIds.forEach((id) => syncOrderToCloud(id));

    emitTableStatusChanged({
      tableId: order.tableId,
      tableName: checkoutTableName,
      status: "AVAILABLE",
    });

    queueSyncEvent("TABLE_STATUS_CHANGED", {
      tableId: order.tableId,
      tableName: checkoutTableName,
      status: "AVAILABLE",
      outletId: order.outletId,
      organizationId: order.organizationId,
    });
  }

  // Log event
  db.insert(schema.eventLog)
    .values({
      id: uuid(),
      orderId,
      eventType: "PAYMENT_RECEIVED",
      payload: JSON.stringify({
        paymentMode,
        paymentSubMethod,
        paymentSplits,
        isComplimentary,
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
    tableId: order.tableId,
    tableName: checkoutTableName,
    outletId: order.outletId,
    organizationId: order.organizationId,
    invoiceNumber,
    paymentMode,
    paymentSubMethod,
    paymentSplits,
    isComplimentary,
    tipAmount,
    tenderedAmount,
    changeDue,
    subtotal: totals.subtotal,
    discountAmount: totals.discountAmount,
    taxAmount: totals.totalTax,
    totalAmount: totals.grandTotal,
    items: activeItems.map((i) => ({
      id: i.id,
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
    order: { ...order, discountLabel },
    items: activeItems,
    invoice: {
      invoiceNumber,
      subtotal: totals.subtotal,
      discountAmount: totals.discountAmount,
      cgstRate: halfRate,
      cgstAmount: totals.totalCgst,
      sgstRate: halfRate,
      sgstAmount: totals.totalSgst,
      totalQuantity: totals.totalQuantity,
      totalAmount: totals.grandTotal,
      paymentMode,
      paymentSubMethod,
      paymentSplits: splitsJson,
      tipAmount,
      tenderedAmount,
      changeDue,
    },
    outlet,
    table,
  });

  const printTemplate = buildBillReceipt(receiptData);

  console.log(
    `🧾 [Checkout] ${invoiceNumber} — order ${order.orderNumber} settled ₹${payableTotal.toFixed(2)} via ${paymentMode}`
  );
  clearUndoStack(orderId);

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
    payableTotal,
    tenderedAmount,
    changeDue,
    paymentMode,
    paymentSubMethod,
    printTemplate,
  };
});

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
      modifiers: safeParseArray(i.modifiers),
      addOns: safeParseArray(i.addOns),
    })),
  };
}

function safeParseArray(value: string | null): unknown[] {
  if (!value) return [];
  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}
