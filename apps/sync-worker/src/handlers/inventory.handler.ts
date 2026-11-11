/**
 * Gusto Sync Worker — Recipe-based inventory reconciliation
 *
 * Keeps ingredient stock in line with what an order actually consumed.
 *
 * Rather than "deduct once when the order completes", each run compares what
 * the order SHOULD have consumed with what has ALREADY been booked against it
 * (the sum of its stock transactions) and applies only the difference:
 *
 *   order COMPLETED          → consumption = Σ recipe quantity × item quantity
 *   order anything else      → consumption = 0
 *
 * That single rule makes the job:
 *   - idempotent   — a retry or a re-sent event books nothing twice
 *   - self-healing — a bill voided after payment gets its stock back,
 *                    and a corrected order is adjusted to the right amount
 *
 * Stock is changed with an atomic `current_stock = current_stock + Δ`, and all
 * work for one order is serialized with an advisory lock, so concurrent jobs
 * can never lose an update.
 */

import { and, eq, inArray, ne, sql } from "drizzle-orm";
import { db } from "../db.js";
import * as schema from "@gusto/db-schema/cloud";

export interface StockMovement {
  inventoryItemId: string;
  inventoryItemName: string;
  /** Negative = deducted, positive = returned to stock */
  quantityChange: number;
  balanceAfter: number;
  lowStock: boolean;
}

export interface ReconcileResult {
  applied: boolean;
  reason?: string;
  movements: StockMovement[];
  warnings: string[];
}

interface Publisher {
  publish(channel: string, message: string): Promise<unknown>;
}

/** Quantities are stored to 3 decimals; ignore differences below that. */
const EPSILON = 0.0005;
const round3 = (n: number) => Math.round(n * 1000) / 1000;

export async function reconcileInventoryForOrder(
  orderId: string,
  organizationId: string,
  pubClient?: Publisher
): Promise<ReconcileResult> {
  const warnings: string[] = [];

  const result = await db.transaction(async (tx) => {
    // One reconcile per order at a time
    await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${"inventory:" + orderId}))`);

    const order = await tx.query.orders.findFirst({
      where: and(eq(schema.orders.id, orderId), eq(schema.orders.organizationId, organizationId)),
      columns: { id: true, orderNumber: true, status: true, outletId: true },
    });
    if (!order) {
      return { applied: false, reason: "order not found", movements: [] as StockMovement[], outletId: null as string | null };
    }

    // ── What the order should have consumed ──
    const desired = new Map<string, number>();
    if (order.status === "COMPLETED") {
      const items = await tx
        .select({
          menuItemId: schema.orderItems.menuItemId,
          menuItemName: schema.orderItems.menuItemName,
          quantity: schema.orderItems.quantity,
        })
        .from(schema.orderItems)
        .where(and(eq(schema.orderItems.orderId, orderId), ne(schema.orderItems.status, "CANCELLED")));

      const menuItemIds = [...new Set(items.map((i) => i.menuItemId))];
      const recipes = menuItemIds.length
        ? await tx.query.recipes.findMany({
            where: inArray(schema.recipes.menuItemId, menuItemIds),
            with: { ingredients: true },
          })
        : [];
      const recipeByMenuItem = new Map(recipes.map((r) => [r.menuItemId, r]));

      for (const item of items) {
        const recipe = recipeByMenuItem.get(item.menuItemId);
        if (!recipe || recipe.ingredients.length === 0) continue; // nothing to deduct (e.g. bottled drinks)
        for (const ingredient of recipe.ingredients) {
          const qty = Number(ingredient.quantity) * item.quantity;
          if (!Number.isFinite(qty) || qty <= 0) continue;
          desired.set(ingredient.inventoryItemId, (desired.get(ingredient.inventoryItemId) ?? 0) + qty);
        }
      }
    }

    // ── What has already been booked against this order ──
    const booked = await tx
      .select({
        inventoryItemId: schema.stockTransactions.inventoryItemId,
        net: sql<string>`coalesce(sum(${schema.stockTransactions.quantityChange}), 0)`,
      })
      .from(schema.stockTransactions)
      .where(eq(schema.stockTransactions.orderId, orderId))
      .groupBy(schema.stockTransactions.inventoryItemId);
    const bookedNet = new Map(booked.map((b) => [b.inventoryItemId, Number(b.net)]));

    // ── Apply only the difference ──
    const movements: StockMovement[] = [];
    const itemIds = new Set([...desired.keys(), ...bookedNet.keys()]);
    for (const inventoryItemId of itemIds) {
      const target = -(desired.get(inventoryItemId) ?? 0); // consumption is a negative movement
      const delta = round3(target - (bookedNet.get(inventoryItemId) ?? 0));
      if (Math.abs(delta) < EPSILON) continue;

      // Atomic, tenant-scoped update. Stock may go negative: better to record
      // the truth and alert than to block a sale that already happened.
      const [updated] = await tx
        .update(schema.inventoryItems)
        .set({
          currentStock: sql`${schema.inventoryItems.currentStock} + ${String(delta)}`,
          updatedAt: new Date(),
        })
        .where(
          and(eq(schema.inventoryItems.id, inventoryItemId), eq(schema.inventoryItems.organizationId, organizationId))
        )
        .returning({
          name: schema.inventoryItems.name,
          unit: schema.inventoryItems.unit,
          currentStock: schema.inventoryItems.currentStock,
          minimumStock: schema.inventoryItems.minimumStock,
        });

      if (!updated) {
        warnings.push(`Inventory item ${inventoryItemId} not found for order ${order.orderNumber} — skipped`);
        continue;
      }

      const balanceAfter = Number(updated.currentStock);
      await tx.insert(schema.stockTransactions).values({
        organizationId,
        inventoryItemId,
        orderId,
        type: delta < 0 ? "ORDER_DEDUCTION" : "ADJUSTMENT",
        quantityChange: String(delta),
        balanceAfter: String(balanceAfter),
        notes:
          delta < 0
            ? `Auto-deduction for order ${order.orderNumber}`
            : `Stock returned — order ${order.orderNumber} ${order.status === "COMPLETED" ? "corrected" : order.status.toLowerCase()}`,
      });

      const minimumStock = Number(updated.minimumStock);
      const lowStock = delta < 0 && balanceAfter <= minimumStock;
      movements.push({
        inventoryItemId,
        inventoryItemName: updated.name,
        quantityChange: delta,
        balanceAfter,
        lowStock,
      });
      if (lowStock) {
        warnings.push(
          `LOW STOCK: "${updated.name}" is at ${balanceAfter.toFixed(1)} ${updated.unit} (minimum: ${minimumStock} ${updated.unit})`
        );
      }
    }

    return { applied: true, movements, outletId: order.outletId as string | null, orderNumber: order.orderNumber };
  });

  // Alerts go out only after the stock change is committed
  if (pubClient && result.applied) {
    for (const m of result.movements.filter((x) => x.lowStock)) {
      pubClient
        .publish(
          "sync-events",
          JSON.stringify({
            eventType: "LOW_STOCK_ALERT",
            organizationId,
            outletId: result.outletId,
            payload: {
              inventoryItemId: m.inventoryItemId,
              name: m.inventoryItemName,
              currentStock: m.balanceAfter,
              orderId,
              message: `Low stock: ${m.inventoryItemName} is at ${m.balanceAfter.toFixed(1)}`,
            },
          })
        )
        .catch((err: unknown) => console.error("[Inventory] Failed to publish low-stock alert:", err));
    }
  }

  for (const warning of warnings) console.warn(`[Inventory] ${warning}`);

  return { applied: result.applied, reason: "reason" in result ? result.reason : undefined, movements: result.movements, warnings };
}
