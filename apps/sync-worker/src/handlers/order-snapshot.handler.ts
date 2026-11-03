/**
 * Gusto Sync Worker — Order Snapshot Handler
 *
 * Applies an ORDER_SNAPSHOT event from the POS: the full local state of one order
 * (header, totals, items, invoice). The cloud copy is made identical to it, so
 * items added from the POS / Captain app, KOT status changes, discounts, voids and
 * cancellations are all reflected in the ERP — and historical orders that were
 * recorded with ₹0 are backfilled.
 *
 * Idempotent and order-safe: the order row is locked, and a snapshot older than
 * the cloud row's updated_at (both POS clock) is skipped as stale.
 *
 * Inventory is NOT deducted here — that stays with ORDER_COMPLETED so stock is
 * never deducted twice.
 */

import { eq, ne, and, or, inArray, sql } from "drizzle-orm";
import { db } from "../db.js";
import * as schema from "@gusto/db-schema/cloud";
import {
  isUuid,
  resolveDiningTable,
  resolveMenuItemId,
  DEFAULT_OUTLET_ID,
  DEFAULT_ORG_ID,
} from "./resolve.js";

const ORDER_STATUSES = ["DRAFT", "PLACED", "IN_PROGRESS", "READY", "SERVED", "COMPLETED", "CANCELLED"] as const;
const ORDER_MODES = ["DINE_IN", "TAKEAWAY", "DELIVERY", "ONLINE"] as const;
const PAYMENT_MODES = ["CASH", "CARD", "UPI", "ONLINE", "SPLIT", "OTHER"] as const;
const GST_RATES = ["0", "5", "12", "18", "28"] as const;

type OrderStatus = (typeof ORDER_STATUSES)[number];
type OrderMode = (typeof ORDER_MODES)[number];
type PaymentMode = (typeof PAYMENT_MODES)[number];
type GstRate = (typeof GST_RATES)[number];

function pick<T extends string>(allowed: readonly T[], value: unknown): T | null {
  return typeof value === "string" && (allowed as readonly string[]).includes(value) ? (value as T) : null;
}

function mapOrderStatus(status: unknown): OrderStatus {
  if (status === "MERGED") return "CANCELLED";
  return pick(ORDER_STATUSES, status) ?? "PLACED";
}

function mapGstRate(rate: unknown): GstRate {
  const n = Number(rate);
  return pick(GST_RATES, Number.isFinite(n) ? String(n) : null) ?? "5";
}

function money(value: unknown): string {
  const n = Number(value);
  return (Number.isFinite(n) ? n : 0).toFixed(2);
}

function toDate(value: unknown, fallback: Date): Date {
  if (typeof value !== "string" && !(value instanceof Date)) return fallback;
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? fallback : d;
}

/** Keep the last 10 digits (Indian mobile) so "+91 98765-43210" and "9876543210" match. */
function normalizePhone(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const digits = value.replace(/\D/g, "");
  if (digits.length < 7) return null;
  return digits.length > 10 ? digits.slice(-10) : digits;
}

function nullableString(value: unknown): string | null {
  if (value === null || value === undefined) return null;
  return typeof value === "string" ? value : JSON.stringify(value);
}

export interface OrderSnapshotResult {
  applied: boolean;
  reason?: string;
  orderId: string;
  orderNumber: string;
  organizationId: string;
  outletId: string;
  status: OrderStatus;
  tableId: string | null;
  unresolvedItems: string[];
  /** Dining tables whose status this snapshot changed (for real-time fan-out). */
  tableChanges: { tableId: string; tableName: string; status: "AVAILABLE" | "OCCUPIED" }[];
}

const ACTIVE_STATUSES: OrderStatus[] = ["DRAFT", "PLACED", "IN_PROGRESS", "READY", "SERVED"];
const isActive = (s: string | null | undefined) => !!s && (ACTIVE_STATUSES as string[]).includes(s);

export async function processOrderSnapshot(payload: any, localTimestamp?: string): Promise<OrderSnapshotResult> {
  const orderId: string = payload.orderId;
  const orderNumber: string = payload.orderNumber;
  if (!isUuid(orderId)) {
    throw new Error(`ORDER_SNAPSHOT has invalid orderId "${orderId}"`);
  }

  const outletId = isUuid(payload.outletId) ? payload.outletId : DEFAULT_OUTLET_ID;
  const organizationId = isUuid(payload.organizationId) ? payload.organizationId : DEFAULT_ORG_ID;
  const status = mapOrderStatus(payload.status);
  const now = new Date();
  const snapshotAt = toDate(payload.snapshotAt ?? localTimestamp, now);
  const createdAt = toDate(payload.createdAt, snapshotAt);

  // Resolve local IDs to cloud IDs before opening the transaction
  const table = await resolveDiningTable(outletId, payload.tableId, payload.tableName);

  const items: any[] = [];
  const unresolvedItems: string[] = [];
  for (const i of (payload.items ?? []) as any[]) {
    const menuItemId = await resolveMenuItemId(outletId, i.menuItemId, i.menuItemName);
    if (!menuItemId) {
      if (i.status !== "VOIDED") unresolvedItems.push(`${i.quantity}x ${i.menuItemName ?? i.menuItemId}`);
      continue;
    }
    items.push({
      ...(isUuid(i.id) ? { id: i.id } : {}),
      orderId,
      menuItemId,
      menuItemName: String(i.menuItemName ?? "Item"),
      variantName: i.variantName ?? null,
      quantity: Math.max(0, Math.trunc(Number(i.quantity) || 0)),
      unitPrice: money(i.unitPrice),
      gstRate: mapGstRate(i.gstRate),
      modifiers: nullableString(i.modifiers),
      addOns: nullableString(i.addOns),
      notes: i.notes ?? null,
      status: i.status === "VOIDED" ? ("CANCELLED" as const) : status === "COMPLETED" ? ("COMPLETED" as const) : ("PLACED" as const),
    });
  }

  const noteParts = [payload.notes, unresolvedItems.length > 0 ? `Unmapped POS items: ${unresolvedItems.join(", ")}` : null]
    .filter((p): p is string => typeof p === "string" && p.length > 0);
  const notes = noteParts.length > 0 ? noteParts.join(" | ") : null;

  const orderValues = {
    outletId,
    organizationId,
    orderNumber,
    tableId: table?.id ?? null,
    orderMode: (pick(ORDER_MODES, payload.orderMode) ?? "DINE_IN") as OrderMode,
    status,
    subtotal: money(payload.subtotal),
    discountAmount: money(payload.discountAmount),
    discountType: payload.discountType ?? null,
    discountValue: payload.discountValue === null || payload.discountValue === undefined ? null : money(payload.discountValue),
    discountLabel: payload.isComplimentary
      ? `COMPLIMENTARY: ${payload.complimentaryReason || "Approved"}`
      : payload.discountLabel ?? null,
    taxAmount: money(payload.taxAmount),
    totalAmount: money(payload.totalAmount),
    paymentMode: pick(PAYMENT_MODES, payload.paymentMode) as PaymentMode | null,
    paymentSubMethod: payload.paymentSubMethod ?? null,
    paymentSplits: nullableString(payload.paymentSplits),
    customerName: payload.customerName ?? null,
    customerPhone: payload.customerPhone ?? null,
    waiterName: payload.waiterName ?? null,
    cashierName: payload.cashierName ?? null,
    tokenNumbers: nullableString(payload.tokenNumbers),
    paxCount: Math.max(1, Math.trunc(Number(payload.paxCount) || 1)),
    notes,
    createdAt,
    updatedAt: snapshotAt,
  };

  const base = {
    orderId,
    orderNumber,
    organizationId,
    outletId,
    status,
    tableId: table?.id ?? null,
    unresolvedItems,
    tableChanges: [] as OrderSnapshotResult["tableChanges"],
  };

  return db.transaction(async (tx) => {
    // Serialize with any other job touching this order (e.g. ORDER_COMPLETED)
    // (Read via drizzle, not raw SQL, so the timestamp-without-timezone column is
    // mapped exactly the way drizzle wrote it — raw postgres-js parses it as local time.)
    const [locked] = await tx
      .select({
        updatedAt: schema.orders.updatedAt,
        tableId: schema.orders.tableId,
        status: schema.orders.status,
        customerId: schema.orders.customerId,
      })
      .from(schema.orders)
      .where(eq(schema.orders.id, orderId))
      .for("update");
    const existingUpdatedAt = locked?.updatedAt ?? null;

    if (existingUpdatedAt && existingUpdatedAt.getTime() > snapshotAt.getTime()) {
      return { ...base, applied: false, reason: "stale snapshot" };
    }

    // 1. Upsert order header
    await tx
      .insert(schema.orders)
      .values({ id: orderId, ...orderValues })
      .onConflictDoUpdate({ target: schema.orders.id, set: orderValues });

    // 2. Replace items. Also clear rows with the same IDs under another order
    //    (items moved by a merge whose ORDERS_MERGED event has not landed yet).
    const itemIds = items.map((i) => i.id).filter(isUuid);
    await tx
      .delete(schema.orderItems)
      .where(
        itemIds.length > 0
          ? or(eq(schema.orderItems.orderId, orderId), inArray(schema.orderItems.id, itemIds))
          : eq(schema.orderItems.orderId, orderId)
      );
    if (items.length > 0) {
      await tx.insert(schema.orderItems).values(items);
    }

    // 3. Upsert invoice (one per order)
    const inv = payload.invoice;
    if (inv) {
      const invoiceValues = {
        outletId,
        invoiceNumber: String(inv.invoiceNumber),
        receiptStatus: inv.receiptStatus ?? "ORIGINAL",
        subtotal: money(inv.subtotal),
        discountAmount: money(inv.discountAmount),
        cgstRate: money(inv.cgstRate ?? 2.5),
        cgstAmount: money(inv.cgstAmount),
        sgstRate: money(inv.sgstRate ?? 2.5),
        sgstAmount: money(inv.sgstAmount),
        totalQuantity: Math.trunc(Number(inv.totalQuantity) || 0),
        totalAmount: money(inv.totalAmount),
        paymentMode: (pick(PAYMENT_MODES, inv.paymentMode) ?? "OTHER") as PaymentMode,
        paymentSubMethod: inv.paymentSubMethod ?? null,
        paymentSplits: nullableString(inv.paymentSplits),
        isPaid: Boolean(inv.isPaid),
        createdAt: toDate(inv.createdAt, snapshotAt),
      };
      const existingInvoice = await tx.query.invoices.findFirst({
        where: eq(schema.invoices.orderId, orderId),
      });
      if (existingInvoice) {
        await tx.update(schema.invoices).set(invoiceValues).where(eq(schema.invoices.id, existingInvoice.id));
      } else {
        await tx.insert(schema.invoices).values({ orderId, ...invoiceValues });
      }
    }

    // 4. Derive dining-table occupancy from the order, so the ERP floor view is
    //    correct even when the POS's live table updates were missed (offline).
    //    Only transitions are acted on, so a backfill of old orders cannot flip
    //    tables that are in use by newer orders.
    const tableChanges: OrderSnapshotResult["tableChanges"] = [];
    const prevTableId = locked?.tableId ?? null;
    const newTableId = table?.id ?? null;
    const wasActive = isActive(locked?.status);
    const nowActive = isActive(status);

    const releaseIfFree = async (tableId: string) => {
      const [other] = await tx
        .select({ id: schema.orders.id })
        .from(schema.orders)
        .where(
          and(
            eq(schema.orders.tableId, tableId),
            ne(schema.orders.id, orderId),
            inArray(schema.orders.status, ACTIVE_STATUSES)
          )
        )
        .limit(1);
      if (other) return;
      const [released] = await tx
        .update(schema.diningTables)
        .set({ status: "AVAILABLE" })
        .where(and(eq(schema.diningTables.id, tableId), eq(schema.diningTables.status, "OCCUPIED")))
        .returning({ id: schema.diningTables.id, name: schema.diningTables.name });
      if (released) tableChanges.push({ tableId: released.id, tableName: released.name, status: "AVAILABLE" });
    };

    // Order left its previous table (transfer/swap) or closed on it
    if (prevTableId && wasActive && (prevTableId !== newTableId || !nowActive)) {
      await releaseIfFree(prevTableId);
    }
    // Order newly seated on a table (new order, or moved here)
    if (newTableId && nowActive && orderValues.orderMode === "DINE_IN" && (!locked || prevTableId !== newTableId || !wasActive)) {
      const [occupied] = await tx
        .update(schema.diningTables)
        .set({ status: "OCCUPIED" })
        .where(and(eq(schema.diningTables.id, newTableId), ne(schema.diningTables.status, "OCCUPIED")))
        .returning({ id: schema.diningTables.id, name: schema.diningTables.name });
      if (occupied) tableChanges.push({ tableId: occupied.id, tableName: occupied.name, status: "OCCUPIED" });
    }

    // 5. CRM: link a completed order to its customer (by phone) and roll up
    //    visits/spend. customerId doubles as the "already counted" marker, so
    //    re-sent snapshots never double count.
    const phone = normalizePhone(payload.customerPhone);
    if (status === "COMPLETED" && phone && !locked?.customerId) {
      let [customer] = await tx
        .select()
        .from(schema.customers)
        .where(and(eq(schema.customers.organizationId, organizationId), eq(schema.customers.phone, phone)))
        .limit(1);
      if (!customer) {
        [customer] = await tx
          .insert(schema.customers)
          .values({
            organizationId,
            phone,
            name: (typeof payload.customerName === "string" && payload.customerName.trim()) || "Guest",
          })
          .returning();
      }
      if (customer) {
        await tx
          .update(schema.customers)
          .set({
            totalVisits: sql`${schema.customers.totalVisits} + 1`,
            totalSpend: sql`${schema.customers.totalSpend} + ${orderValues.totalAmount}`,
            updatedAt: new Date(),
          })
          .where(eq(schema.customers.id, customer.id));
        await tx.update(schema.orders).set({ customerId: customer.id }).where(eq(schema.orders.id, orderId));
      }
    }

    return { ...base, applied: true, tableChanges };
  });
}
