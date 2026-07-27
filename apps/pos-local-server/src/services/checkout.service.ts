/**
 * Gusto POS Local Server — Checkout Service
 *
 * Payment processing, invoice generation, and order completion.
 */

import { eq } from "drizzle-orm";
import { v4 as uuid } from "uuid";
import * as schema from "@gusto/db-schema/local";
import { db } from "../db/index.js";
import {
  calculateCartTotals,
  calculateGST,
  type CartItem,
  type DiscountConfig,
  type GSTRate,
} from "@gusto/core-logic";
import { buildBillReceipt, type ReceiptData } from "@gusto/printer";
import { getNextInvoiceNumber } from "./sequence.service.js";
import { queueSyncEvent } from "./sync.service.js";
import { emitOrderUpdated, emitTableStatusChanged } from "../socket/events.js";

export type PaymentMode = "CASH" | "CARD" | "UPI" | "ONLINE" | "SPLIT";

export interface CheckoutInput {
  paymentMode: PaymentMode;
  splitDetails?: { mode: PaymentMode; amount: number }[];
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

  const items = db
    .select()
    .from(schema.orderItems)
    .where(eq(schema.orderItems.orderId, orderId))
    .all();

  if (items.length === 0) {
    throw new Error("Cannot checkout an empty order");
  }

  // Calculate final totals
  const cartItems: CartItem[] = items.map((item) => ({
    menuItemId: item.menuItemId,
    menuItemName: item.menuItemName,
    quantity: item.quantity,
    unitPrice: item.unitPrice,
    gstRate: item.gstRate as GSTRate,
    modifiers: item.modifiers ? JSON.parse(item.modifiers) : undefined,
  }));

  let discount: DiscountConfig | undefined;
  if (order.discountType && order.discountValue) {
    discount = {
      type: order.discountType as "PERCENTAGE" | "FLAT",
      value: order.discountValue,
    };
  }

  const totals = calculateCartTotals(cartItems, discount);

  // Calculate CGST and SGST breakdown
  let totalCGST = 0;
  let totalSGST = 0;
  for (const tb of totals.taxBreakdown) {
    totalCGST += tb.cgst;
    totalSGST += tb.sgst;
  }

  // Generate invoice
  const invoiceId = uuid();
  const invoiceNumber = getNextInvoiceNumber();
  const now = new Date().toISOString();

  db.insert(schema.invoices)
    .values({
      id: invoiceId,
      orderId,
      invoiceNumber,
      subtotal: totals.subtotal,
      discountAmount: totals.discountAmount,
      cgstAmount: totalCGST,
      sgstAmount: totalSGST,
      totalAmount: totals.grandTotal,
      paymentMode: input.paymentMode,
      isPaid: true,
      createdAt: now,
    })
    .run();

  // Update order to COMPLETED
  db.update(schema.orders)
    .set({
      status: "COMPLETED",
      paymentMode: input.paymentMode,
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
        totalAmount: totals.grandTotal,
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
    outletId: order.outletId,
    organizationId: order.organizationId,
    invoiceNumber,
    paymentMode: input.paymentMode,
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

  // Build receipt template
  let tableName: string | undefined;
  if (order.tableId) {
    const table = db
      .select()
      .from(schema.diningTables)
      .where(eq(schema.diningTables.id, order.tableId))
      .get();
    tableName = table?.name;
  }

  const receiptData: ReceiptData = {
    outletName: "Gusto Restaurant",
    outletAddress: "Shop 12, Versova Road, Andheri West, Mumbai 400058",
    outletPhone: "+91 22 2634 5678",
    gstNumber: "27AADCG1234A1Z5",
    invoiceNumber,
    orderNumber: order.orderNumber,
    tableName,
    waiterName: order.waiterName ?? undefined,
    items: items.map((i) => ({
      name: i.menuItemName,
      quantity: i.quantity,
      unitPrice: i.unitPrice,
      total: i.unitPrice * i.quantity,
      modifiers: i.modifiers ? JSON.parse(i.modifiers) : undefined,
    })),
    subtotal: totals.subtotal,
    discountAmount: totals.discountAmount,
    cgst: totalCGST,
    sgst: totalSGST,
    grandTotal: totals.grandTotal,
    paymentMode: input.paymentMode,
    customerName: order.customerName ?? undefined,
    customerPhone: order.customerPhone ?? undefined,
    createdAt: new Date(),
  };

  const printTemplate = buildBillReceipt(receiptData);

  // Log receipt to console (simulated print)
  console.log(`\n🧾 RECEIPT — ${invoiceNumber} (Order: ${order.orderNumber})`);
  for (const line of printTemplate) {
    if (line.type === "divider") console.log("─".repeat(40));
    else if (line.type === "blank") console.log("");
    else if (line.columns) {
      const cols = line.columns.map((c: any) => c.text.padEnd(c.width)).join("");
      console.log(cols);
    } else if (line.content) {
      console.log(line.content);
    }
  }
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

  return {
    ...invoice,
    order,
    items: items.map((i) => ({
      ...i,
      modifiers: i.modifiers ? JSON.parse(i.modifiers) : [],
    })),
  };
}
