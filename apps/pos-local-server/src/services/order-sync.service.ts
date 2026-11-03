/**
 * Gusto POS Local Server — Order Snapshot Sync
 *
 * Keeps the Cloud ERP's copy of every order identical to the local SQLite copy.
 *
 * The granular sync events (ORDER_CREATED, ORDER_COMPLETED, …) only cover a few
 * lifecycle moments; items added from the POS or Captain app, KOT/status changes,
 * discounts and implicit cancellations never reached the cloud, so the ERP showed
 * those orders with ₹0 and no items. An ORDER_SNAPSHOT carries the full order
 * (header, items, invoice) and the sync-worker upserts it idempotently.
 *
 * - queueOrderSnapshot(orderId): called whenever an order changes. Coalesces with
 *   any not-yet-pushed snapshot of the same order so bursts produce one push.
 * - reconcileOrderSnapshots(): periodic + startup sweep. Compares a content hash of
 *   every local order with the hash last pushed successfully, and re-queues any
 *   that differ. This also backfills historical orders that were never synced.
 */

import { createHash } from "crypto";
import { eq, and, inArray, like } from "drizzle-orm";
import { v4 as uuid } from "uuid";
import * as schema from "@gusto/db-schema/local";
import { db } from "../db/index.js";

export const ORDER_SNAPSHOT_EVENT = "ORDER_SNAPSHOT";
const HASH_KEY_PREFIX = "order-snap:";

function parseJson<T>(value: string | null | undefined): T | null {
  if (!value) return null;
  try {
    return JSON.parse(value) as T;
  } catch {
    return null;
  }
}

/**
 * Build the full snapshot of an order from local SQLite (without snapshotAt).
 */
export function buildOrderSnapshot(orderId: string): Record<string, unknown> | null {
  const order = db.select().from(schema.orders).where(eq(schema.orders.id, orderId)).get();
  if (!order) return null;

  const items = db
    .select()
    .from(schema.orderItems)
    .where(eq(schema.orderItems.orderId, orderId))
    .all();

  const invoice = db
    .select()
    .from(schema.invoices)
    .where(eq(schema.invoices.orderId, orderId))
    .get();

  const table = order.tableId
    ? db.select().from(schema.diningTables).where(eq(schema.diningTables.id, order.tableId)).get()
    : undefined;

  return {
    orderId: order.id,
    orderNumber: order.orderNumber,
    outletId: order.outletId,
    organizationId: order.organizationId,
    tableId: order.tableId,
    tableName: table?.name ?? null,
    orderMode: order.orderMode,
    status: order.status,
    subtotal: order.subtotal,
    discountAmount: order.discountAmount,
    discountType: order.discountType,
    discountValue: order.discountValue,
    discountLabel: order.discountLabel,
    taxAmount: order.taxAmount,
    totalAmount: order.totalAmount,
    paymentMode: order.paymentMode,
    paymentSubMethod: order.paymentSubMethod,
    paymentSplits: order.paymentSplits,
    customerName: order.customerName,
    customerPhone: order.customerPhone,
    waiterName: order.waiterName,
    cashierName: order.cashierName,
    tokenNumbers: order.tokenNumbers,
    paxCount: order.paxCount,
    notes: order.notes,
    isComplimentary: order.isComplimentary,
    complimentaryReason: order.complimentaryReason,
    mergedIntoOrderId: order.mergedIntoOrderId,
    createdAt: order.createdAt,
    items: items.map((i) => ({
      id: i.id,
      menuItemId: i.menuItemId,
      menuItemName: i.menuItemName,
      variantName: i.variantName,
      quantity: i.quantity,
      unitPrice: i.unitPrice,
      gstRate: i.gstRate,
      modifiers: i.modifiers,
      addOns: i.addOns,
      notes: i.notes,
      status: i.status,
    })),
    invoice: invoice
      ? {
          invoiceNumber: invoice.invoiceNumber,
          receiptStatus: invoice.receiptStatus,
          subtotal: invoice.subtotal,
          discountAmount: invoice.discountAmount,
          cgstRate: invoice.cgstRate,
          cgstAmount: invoice.cgstAmount,
          sgstRate: invoice.sgstRate,
          sgstAmount: invoice.sgstAmount,
          totalQuantity: invoice.totalQuantity,
          totalAmount: invoice.totalAmount,
          paymentMode: invoice.paymentMode,
          paymentSubMethod: invoice.paymentSubMethod,
          paymentSplits: invoice.paymentSplits,
          isPaid: invoice.isPaid,
          createdAt: invoice.createdAt,
        }
      : null,
  };
}

function hashSnapshot(snapshot: Record<string, unknown>): string {
  return createHash("sha1").update(JSON.stringify(snapshot)).digest("hex");
}

function getPushedHash(orderId: string): string | null {
  const row = db
    .select()
    .from(schema.syncMeta)
    .where(eq(schema.syncMeta.id, HASH_KEY_PREFIX + orderId))
    .get();
  return row?.lastSyncTimestamp ?? null;
}

/**
 * Record that a snapshot with this hash reached the cloud.
 * Called by the outbox pusher after a successful push.
 */
export function markOrderSnapshotPushed(payloadJson: string): void {
  const payload = parseJson<Record<string, unknown> & { snapshotHash?: string; orderId?: string }>(payloadJson);
  if (!payload?.orderId || !payload.snapshotHash) return;

  const id = HASH_KEY_PREFIX + payload.orderId;
  const now = new Date().toISOString();
  const existing = db.select().from(schema.syncMeta).where(eq(schema.syncMeta.id, id)).get();
  if (existing) {
    db.update(schema.syncMeta)
      .set({ lastSyncTimestamp: payload.snapshotHash, updatedAt: now })
      .where(eq(schema.syncMeta.id, id))
      .run();
  } else {
    db.insert(schema.syncMeta)
      .values({ id, lastSyncTimestamp: payload.snapshotHash, updatedAt: now })
      .run();
  }
}

/**
 * Queue (or refresh) an ORDER_SNAPSHOT outbox event for this order.
 * Returns true if something was queued/refreshed.
 */
export function queueOrderSnapshot(orderId: string): boolean {
  const snapshot = buildOrderSnapshot(orderId);
  if (!snapshot) return false;

  const snapshotHash = hashSnapshot(snapshot);
  const payload = JSON.stringify({
    ...snapshot,
    snapshotHash,
    snapshotAt: new Date().toISOString(),
  });

  // Coalesce with a snapshot of this order that has not been pushed yet
  const pending = db
    .select()
    .from(schema.syncOutbox)
    .where(
      and(
        eq(schema.syncOutbox.eventType, ORDER_SNAPSHOT_EVENT),
        inArray(schema.syncOutbox.status, ["PENDING", "FAILED"]),
        like(schema.syncOutbox.payload, `{"orderId":"${orderId}"%`)
      )
    )
    .get();

  if (pending) {
    const pendingHash = parseJson<{ snapshotHash?: string }>(pending.payload)?.snapshotHash;
    if (pendingHash === snapshotHash) return false;
    db.update(schema.syncOutbox)
      .set({ payload, status: "PENDING", retryCount: 0, lastError: null })
      .where(eq(schema.syncOutbox.id, pending.id))
      .run();
    return true;
  }

  if (getPushedHash(orderId) === snapshotHash) return false;

  db.insert(schema.syncOutbox)
    .values({
      id: uuid(),
      eventType: ORDER_SNAPSHOT_EVENT,
      payload,
      status: "PENDING",
      retryCount: 0,
      createdAt: new Date().toISOString(),
    })
    .run();
  return true;
}

/**
 * Queue a snapshot and try to push right away. Safe to call from anywhere —
 * failures are logged, never thrown, so they cannot break the POS flow.
 */
export function syncOrderToCloud(orderId: string | null | undefined): void {
  if (!orderId) return;
  try {
    if (queueOrderSnapshot(orderId)) {
      import("./realtime-uplink.service.js")
        .then(({ flushOutbox }) => flushOutbox())
        .catch(() => {});
    }
  } catch (err) {
    console.warn(`[OrderSync] Could not queue snapshot for order ${orderId}:`, err);
  }
}

/**
 * Sweep all local orders and queue snapshots for any whose cloud copy is out of date.
 * Also backfills historical orders that were never fully synced.
 */
export function reconcileOrderSnapshots(): number {
  const orderIds = db.select({ id: schema.orders.id }).from(schema.orders).all();
  let queued = 0;
  for (const { id } of orderIds) {
    try {
      if (queueOrderSnapshot(id)) queued++;
    } catch (err) {
      console.warn(`[OrderSync] Reconcile failed for order ${id}:`, err);
    }
  }
  if (queued > 0) {
    console.log(`[OrderSync] Queued ${queued} order snapshot(s) for cloud sync`);
  }
  return queued;
}
