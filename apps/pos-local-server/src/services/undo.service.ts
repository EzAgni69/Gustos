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
 * - Snapshots live in memory: a server restart simply clears the undo history
 */

import { eq } from "drizzle-orm";
import * as schema from "@gusto/db-schema/local";
import { db } from "../db/index.js";
import { atomicFn } from "../db/tx.js";
import { v4 as uuid } from "uuid";
import { emitOrderUpdated } from "../socket/events.js";
import { recalculateOrderTotals, getOrderById } from "./order.service.js";

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
 *
 * Only billing-counter edits made before an item reaches the kitchen are
 * undoable (quantity change, removal, order discount). The restore is
 * deliberately narrow: it puts back what the undone action changed and leaves
 * everything that happened since — items added, fired or voided — untouched.
 */
export const undoLastAction = atomicFn(function undoLastAction(orderId: string, userId?: string) {
  cleanExpired(orderId);

  const stack = undoStacks.get(orderId);
  if (!stack || stack.snapshots.length === 0) {
    return null;
  }

  const current = db.select().from(schema.orders).where(eq(schema.orders.id, orderId)).get();
  if (!current) {
    undoStacks.delete(orderId);
    return null;
  }
  if (["COMPLETED", "CANCELLED", "MERGED"].includes(current.status)) {
    undoStacks.delete(orderId);
    throw new Error(`Cannot undo — order is ${current.status.toLowerCase()}`);
  }

  const snapshot = stack.snapshots.pop()!;

  // Restore the order-level discount
  const orderData = snapshot.order as Record<string, unknown>;
  db.update(schema.orders)
    .set({
      discountType: (orderData.discountType as string | null) ?? null,
      discountValue: (orderData.discountValue as number | null) ?? null,
      discountLabel: (orderData.discountLabel as string | null) ?? null,
      updatedAt: new Date().toISOString(),
    })
    .where(eq(schema.orders.id, orderId))
    .run();

  // Restore items the undone action removed or resized
  for (const item of snapshot.items) {
    const itemData = item as Record<string, unknown>;
    const id = itemData.id as string;
    const existing = db.select().from(schema.orderItems).where(eq(schema.orderItems.id, id)).get();

    if (!existing) {
      db.insert(schema.orderItems)
        .values({
          id,
          orderId,
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
          kotId: null,
          voidedAt: (itemData.voidedAt as string) ?? null,
          voidReason: (itemData.voidReason as string) ?? null,
          voidApprovedBy: (itemData.voidApprovedBy as string) ?? null,
          isNcr: (itemData.isNcr as boolean) ?? false,
          itemDiscountType: (itemData.itemDiscountType as string) ?? null,
          itemDiscountValue: (itemData.itemDiscountValue as number) ?? null,
          itemDiscountReason: (itemData.itemDiscountReason as string) ?? null,
        })
        .run();
      continue;
    }

    // Still there: only un-fired, un-voided lines on this order get their quantity back
    if (
      existing.orderId === orderId &&
      existing.status !== "VOIDED" &&
      !existing.kotId &&
      itemData.status !== "VOIDED" &&
      existing.quantity !== itemData.quantity
    ) {
      db.update(schema.orderItems)
        .set({ quantity: itemData.quantity as number })
        .where(eq(schema.orderItems.id, id))
        .run();
    }
  }

  recalculateOrderTotals(orderId);

  // Log the undo event
  db.insert(schema.eventLog)
    .values({
      id: uuid(),
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

  const restored = getOrderById(orderId);
  emitOrderUpdated({ type: "UNDO", order: restored });

  return restored ? { ...restored, undoneAction: snapshot.actionDescription } : null;
});

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
