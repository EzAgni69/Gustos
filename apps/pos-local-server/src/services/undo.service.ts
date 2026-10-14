/**
 * Gusto POS Local Server — Undo Service
 *
 * In-memory undo stack for order operations.
 * Captures state snapshots before mutations and supports single-step undo.
 *
 * Rules:
 * - 30-second TTL on undo entries (configurable)
 * - Max 5 undo levels per order
 * - Only works for active (non-completed/cancelled) orders
 */

import { eq } from "drizzle-orm";
import * as schema from "@gusto/db-schema/local";
import { db } from "../db/index.js";
import { emitOrderUpdated, emitTableStatusChanged } from "../socket/events.js";

// ─── Types ───

interface OrderSnapshot {
  order: Record<string, unknown>;
  items: Record<string, unknown>[];
  capturedAt: number; // Date.now()
  actionDescription: string; // e.g. "Item removed: Pizza Margherita"
}

interface UndoStack {
  snapshots: OrderSnapshot[];
}

// ─── Config ───

const UNDO_TTL_MS = 30_000; // 30 seconds
const MAX_UNDO_LEVELS = 5;

// ─── In-Memory Store ───

const undoStacks = new Map<string, UndoStack>();

// ─── Cleanup expired entries ───

function cleanExpired(orderId: string): void {
  const stack = undoStacks.get(orderId);
  if (!stack) return;

  const now = Date.now();
  stack.snapshots = stack.snapshots.filter(
    (s) => now - s.capturedAt < UNDO_TTL_MS
  );

  if (stack.snapshots.length === 0) {
    undoStacks.delete(orderId);
  }
}

// ─── Public API ───

/**
 * Capture a snapshot of the current order state before a mutation.
 * Call this BEFORE any destructive operation.
 */
export function captureUndoSnapshot(
  orderId: string,
  actionDescription: string
): void {
  cleanExpired(orderId);

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

  const snapshot: OrderSnapshot = {
    order: { ...order },
    items: items.map((i) => ({ ...i })),
    capturedAt: Date.now(),
    actionDescription,
  };

  let stack = undoStacks.get(orderId);
  if (!stack) {
    stack = { snapshots: [] };
    undoStacks.set(orderId, stack);
  }

  stack.snapshots.push(snapshot);

  // Enforce max levels
  if (stack.snapshots.length > MAX_UNDO_LEVELS) {
    stack.snapshots = stack.snapshots.slice(-MAX_UNDO_LEVELS);
  }
}

/**
 * Undo the last action on an order by restoring the previous snapshot.
 * Returns the restored order or null if no undo is available.
 */
export function undoLastAction(orderId: string, userId?: string) {
  cleanExpired(orderId);

  const stack = undoStacks.get(orderId);
  if (!stack || stack.snapshots.length === 0) {
    return null;
  }

  const snapshot = stack.snapshots.pop()!;

  // Restore order state
  const orderData = snapshot.order as Record<string, unknown>;
  db.update(schema.orders)
    .set({
      status: orderData.status as string,
      subtotal: orderData.subtotal as number,
      discountAmount: orderData.discountAmount as number,
      discountType: orderData.discountType as string | null,
      discountValue: orderData.discountValue as number | null,
      taxAmount: orderData.taxAmount as number,
      totalAmount: orderData.totalAmount as number,
      notes: orderData.notes as string | null,
      updatedAt: new Date().toISOString(),
    })
    .where(eq(schema.orders.id, orderId))
    .run();

  // Delete current items and restore snapshot items
  db.delete(schema.orderItems)
    .where(eq(schema.orderItems.orderId, orderId))
    .run();

  for (const item of snapshot.items) {
    const itemData = item as Record<string, unknown>;
    db.insert(schema.orderItems)
      .values({
        id: itemData.id as string,
        orderId: itemData.orderId as string,
        menuItemId: itemData.menuItemId as string,
        menuItemName: itemData.menuItemName as string,
        variantName: (itemData.variantName as string) ?? null,
        quantity: itemData.quantity as number,
        unitPrice: itemData.unitPrice as number,
        gstRate: itemData.gstRate as string,
        modifiers: (itemData.modifiers as string) ?? null,
        notes: (itemData.notes as string) ?? null,
        addOns: (itemData.addOns as string) ?? null,
        status: itemData.status as string,
        kotId: (itemData.kotId as string) ?? null,
        voidedAt: (itemData.voidedAt as string) ?? null,
        voidReason: (itemData.voidReason as string) ?? null,
        voidApprovedBy: (itemData.voidApprovedBy as string) ?? null,
        isNcr: (itemData.isNcr as boolean) ?? false,
        itemDiscountType: (itemData.itemDiscountType as string) ?? null,
        itemDiscountValue: (itemData.itemDiscountValue as number) ?? null,
        itemDiscountReason: (itemData.itemDiscountReason as string) ?? null,
      })
      .run();
  }

  // Log the undo event
  db.insert(schema.eventLog)
    .values({
      id: `undo-${Date.now()}`,
      orderId,
      eventType: "UNDO",
      payload: JSON.stringify({
        restoredAction: snapshot.actionDescription,
        snapshotAge: `${Math.round((Date.now() - snapshot.capturedAt) / 1000)}s ago`,
      }),
      userId,
      createdAt: new Date().toISOString(),
    })
    .run();

  // Fetch the restored order
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

  const result = {
    ...order,
    items: items.map((item) => ({
      ...item,
      modifiers: item.modifiers ? JSON.parse(item.modifiers) : [],
    })),
    undoneAction: snapshot.actionDescription,
  };

  emitOrderUpdated({ type: "UNDO", order: result });

  return result;
}

/**
 * Check if undo is available for an order.
 */
export function canUndo(orderId: string): {
  available: boolean;
  actionDescription?: string;
  expiresInMs?: number;
} {
  cleanExpired(orderId);

  const stack = undoStacks.get(orderId);
  if (!stack || stack.snapshots.length === 0) {
    return { available: false };
  }

  const latest = stack.snapshots[stack.snapshots.length - 1]!;
  const expiresInMs = UNDO_TTL_MS - (Date.now() - latest.capturedAt);

  return {
    available: true,
    actionDescription: latest.actionDescription,
    expiresInMs: Math.max(0, expiresInMs),
  };
}

/**
 * Clear undo stack for an order (e.g., after checkout).
 */
export function clearUndoStack(orderId: string): void {
  undoStacks.delete(orderId);
}
