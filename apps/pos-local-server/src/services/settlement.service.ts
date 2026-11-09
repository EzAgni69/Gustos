/**
 * Gusto POS Local Server — Post-Settlement Service
 *
 * Corrections on bills that are already settled:
 *  - Payment mode correction (e.g. recorded as CASH, actually paid by UPI)
 *  - Post-settlement void (bill reversed after payment)
 *
 * Shift X/Z figures are recomputed from invoices of COMPLETED orders, so these
 * edits flow into the open shift automatically. Bills that fall inside an
 * already-closed shift are locked: that shift's totals were frozen at close.
 */

import { and, eq, lte, gte } from "drizzle-orm";
import { v4 as uuid } from "uuid";
import * as schema from "@gusto/db-schema/local";
import { roundCurrency, validatePaymentSplits, type PaymentSplitInput } from "@gusto/core-logic";
import { db } from "../db/index.js";
import { syncOrderToCloud } from "./order-sync.service.js";
import { emitOrderUpdated } from "../socket/events.js";

export const CORRECTABLE_PAYMENT_MODES = ["CASH", "CARD", "UPI", "ONLINE", "SPLIT"] as const;
export type CorrectablePaymentMode = (typeof CORRECTABLE_PAYMENT_MODES)[number];

export interface PaymentCorrectionInput {
  paymentMode: CorrectablePaymentMode;
  paymentSubMethod?: string | null;
  paymentSplits?: PaymentSplitInput[];
  reason: string;
  approvedBy: string;
}

export interface SettledVoidInput {
  reason: string;
  approvedBy: string;
}

/** Returns why a settled order can no longer be changed, or null if it can. */
export function getSettlementLock(orderCreatedAt: string): string | null {
  const closedShift = db
    .select({ id: schema.cashierShifts.id, cashierName: schema.cashierShifts.cashierName, closedAt: schema.cashierShifts.closedAt })
    .from(schema.cashierShifts)
    .where(
      and(
        eq(schema.cashierShifts.status, "CLOSED"),
        lte(schema.cashierShifts.openedAt, orderCreatedAt),
        gte(schema.cashierShifts.closedAt, orderCreatedAt)
      )
    )
    .get();
  return closedShift
    ? `Bill belongs to ${closedShift.cashierName}'s shift, which is already closed (Z-report finalised)`
    : null;
}

function loadSettled(orderId: string) {
  const order = db.select().from(schema.orders).where(eq(schema.orders.id, orderId)).get();
  if (!order) throw new Error("Order not found");

  const invoice = db.select().from(schema.invoices).where(eq(schema.invoices.orderId, orderId)).get();
  if (order.status !== "COMPLETED" || !invoice || !invoice.isPaid) {
    throw new Error("Only settled (paid) bills can be corrected");
  }

  const lock = getSettlementLock(order.createdAt);
  if (lock) throw new Error(lock);

  return { order, invoice };
}

function requireText(value: unknown, field: string): string {
  const text = typeof value === "string" ? value.trim() : "";
  if (!text) throw new Error(`${field} is required`);
  return text;
}

function logEvent(orderId: string, eventType: string, payload: Record<string, unknown>, userId?: string) {
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

/**
 * Change how a settled bill was paid. Amounts are untouched; only the tender changes.
 */
export function correctPaymentMode(orderId: string, input: PaymentCorrectionInput, userId?: string) {
  const reason = requireText(input.reason, "reason");
  const approvedBy = requireText(input.approvedBy, "approvedBy");
  if (!CORRECTABLE_PAYMENT_MODES.includes(input.paymentMode)) {
    throw new Error(`Invalid payment mode: ${input.paymentMode}`);
  }

  const { order, invoice } = loadSettled(orderId);
  const payable = roundCurrency(invoice.totalAmount + (invoice.tipAmount ?? 0));

  let splits: PaymentSplitInput[] | null = null;
  if (input.paymentMode === "SPLIT") {
    splits = (input.paymentSplits ?? []).map((s) => ({ ...s, amount: roundCurrency(Number(s.amount)) }));
    const validation = validatePaymentSplits(splits, payable);
    if (!validation.valid) throw new Error(validation.error);
  }

  const subMethod = input.paymentMode === "SPLIT" ? null : input.paymentSubMethod?.trim() || null;
  const splitsJson = splits ? JSON.stringify(splits) : null;

  const unchanged =
    invoice.paymentMode === input.paymentMode &&
    (invoice.paymentSubMethod ?? null) === subMethod &&
    (invoice.paymentSplits ?? null) === splitsJson;
  if (unchanged) throw new Error("Payment details are unchanged");

  const now = new Date().toISOString();
  const previous = {
    paymentMode: invoice.paymentMode,
    paymentSubMethod: invoice.paymentSubMethod,
    paymentSplits: invoice.paymentSplits ? JSON.parse(invoice.paymentSplits) : null,
    tenderedAmount: invoice.tenderedAmount,
    changeDue: invoice.changeDue,
  };

  db.transaction((tx) => {
    tx.update(schema.invoices)
      .set({
        paymentMode: input.paymentMode,
        paymentSubMethod: subMethod,
        paymentSplits: splitsJson,
        // The original cash tender no longer applies; clearing it keeps
        // the shift's expected-cash (float + cash − change) correct.
        tenderedAmount: null,
        changeDue: null,
        receiptStatus: "CORRECTED",
      })
      .where(eq(schema.invoices.id, invoice.id))
      .run();

    tx.update(schema.orders)
      .set({
        paymentMode: input.paymentMode,
        paymentSubMethod: subMethod,
        paymentSplits: splitsJson,
        isSynced: false,
        updatedAt: now,
      })
      .where(eq(schema.orders.id, orderId))
      .run();
  });

  logEvent(
    orderId,
    "PAYMENT_MODE_CORRECTED",
    {
      invoiceNumber: invoice.invoiceNumber,
      from: previous,
      to: { paymentMode: input.paymentMode, paymentSubMethod: subMethod, paymentSplits: splits },
      amount: payable,
      reason,
      approvedBy,
    },
    userId
  );

  syncOrderToCloud(orderId);
  emitOrderUpdated({ type: "PAYMENT_MODE_CORRECTED", orderId, orderNumber: order.orderNumber });

  return {
    orderId,
    orderNumber: order.orderNumber,
    invoiceNumber: invoice.invoiceNumber,
    paymentMode: input.paymentMode,
    paymentSubMethod: subMethod,
    paymentSplits: splits,
  };
}

/**
 * Reverse a settled bill. The order is cancelled and the invoice marked VOIDED,
 * which removes it from shift, day-history and cloud sales figures.
 */
export function voidSettledOrder(orderId: string, input: SettledVoidInput, userId?: string) {
  const reason = requireText(input.reason, "reason");
  const approvedBy = requireText(input.approvedBy, "approvedBy");
  const { order, invoice } = loadSettled(orderId);

  const now = new Date().toISOString();
  const refundAmount = roundCurrency(invoice.totalAmount + (invoice.tipAmount ?? 0));

  db.transaction((tx) => {
    tx.update(schema.invoices)
      .set({ receiptStatus: "VOIDED", isPaid: false, tenderedAmount: null, changeDue: null })
      .where(eq(schema.invoices.id, invoice.id))
      .run();

    tx.update(schema.orders)
      .set({
        status: "CANCELLED",
        notes: [order.notes, `POST-SETTLEMENT VOID: ${reason} (approved by ${approvedBy})`].filter(Boolean).join("\n"),
        isSynced: false,
        updatedAt: now,
      })
      .where(eq(schema.orders.id, orderId))
      .run();
  });

  logEvent(
    orderId,
    "SETTLED_BILL_VOIDED",
    {
      invoiceNumber: invoice.invoiceNumber,
      paymentMode: invoice.paymentMode,
      paymentSplits: invoice.paymentSplits ? JSON.parse(invoice.paymentSplits) : null,
      refundAmount,
      reason,
      approvedBy,
    },
    userId
  );

  syncOrderToCloud(orderId);
  emitOrderUpdated({ type: "SETTLED_BILL_VOIDED", orderId, orderNumber: order.orderNumber });

  return {
    orderId,
    orderNumber: order.orderNumber,
    invoiceNumber: invoice.invoiceNumber,
    refundAmount,
    refundMode: invoice.paymentMode,
  };
}
