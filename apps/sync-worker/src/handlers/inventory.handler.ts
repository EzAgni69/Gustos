/**
 * Gusto Sync Worker — Inventory Deduction Handler
 *
 * Processes ORDER_COMPLETED events to deduct ingredient stock
 * based on recipe definitions. Each menu item has a recipe that
 * maps to inventory ingredients with quantities.
 *
 * Flow:
 * 1. For each order item, look up the recipe → recipe_ingredients
 * 2. Multiply ingredient quantities by order item quantity
 * 3. Aggregate all deductions by inventory item (avoid duplicate writes)
 * 4. Execute a single transaction to deduct stock and log audit records
 * 5. Warn on low stock (below minimum_stock threshold)
 */

import { eq } from "drizzle-orm";
import { db } from "../db.js";
import * as schema from "@gusto/db-schema/cloud";

export interface OrderItemForDeduction {
  menuItemId: string;
  menuItemName: string;
  quantity: number;
}

export interface DeductionResult {
  deducted: boolean;
  deductions: {
    inventoryItemId: string;
    inventoryItemName: string;
    quantityDeducted: number;
    balanceAfter: number;
    lowStock: boolean;
  }[];
  warnings: string[];
}

/**
 * Process inventory deductions for a completed order.
 * Looks up recipes for each menu item and deducts ingredients.
 */
export async function processInventoryDeduction(
  orderId: string,
  organizationId: string,
  items: OrderItemForDeduction[],
  outletId?: string,
  pubClient?: any
): Promise<DeductionResult> {
  const warnings: string[] = [];

  // Step 1: Collect all recipe ingredients needed for this order
  const aggregatedDeductions = new Map<
    string,
    { inventoryItemId: string; totalQuantity: number; unit: string }
  >();

  for (const item of items) {
    // Find the recipe for this menu item
    const recipe = await db.query.recipes.findFirst({
      where: eq(schema.recipes.menuItemId, item.menuItemId),
    });

    if (!recipe) {
      // No recipe defined — skip deduction for this item (common for drinks, etc.)
      warnings.push(
        `No recipe found for "${item.menuItemName}" (${item.menuItemId}) — skipping inventory deduction`
      );
      continue;
    }

    // Get all ingredients for this recipe
    const ingredients = await db
      .select()
      .from(schema.recipeIngredients)
      .where(eq(schema.recipeIngredients.recipeId, recipe.id));

    for (const ingredient of ingredients) {
      const key = ingredient.inventoryItemId;
      const neededQty =
        Number(ingredient.quantity) * item.quantity;

      if (aggregatedDeductions.has(key)) {
        const existing = aggregatedDeductions.get(key)!;
        existing.totalQuantity += neededQty;
      } else {
        aggregatedDeductions.set(key, {
          inventoryItemId: ingredient.inventoryItemId,
          totalQuantity: neededQty,
          unit: ingredient.unit,
        });
      }
    }
  }

  if (aggregatedDeductions.size === 0) {
    return { deducted: true, deductions: [], warnings };
  }

  // Step 2: Execute deductions in a single transaction
  const deductions: DeductionResult["deductions"] = [];

  await db.transaction(async (tx) => {
    for (const [inventoryItemId, deduction] of aggregatedDeductions) {
      // Get current stock
      const inventoryItem = await tx.query.inventoryItems.findFirst({
        where: eq(schema.inventoryItems.id, inventoryItemId),
      });

      if (!inventoryItem) {
        warnings.push(
          `Inventory item ${inventoryItemId} not found — skipping deduction`
        );
        continue;
      }

      const currentStock = Number(inventoryItem.currentStock);
      const newStock = currentStock - deduction.totalQuantity;
      const minimumStock = Number(inventoryItem.minimumStock);

      // Deduct stock (allow negative — better to track than to block orders)
      await tx
        .update(schema.inventoryItems)
        .set({
          currentStock: String(newStock),
          updatedAt: new Date(),
        })
        .where(eq(schema.inventoryItems.id, inventoryItemId));

      // Insert audit record
      await tx.insert(schema.stockTransactions).values({
        organizationId,
        inventoryItemId,
        orderId,
        type: "ORDER_DEDUCTION",
        quantityChange: String(-deduction.totalQuantity),
        balanceAfter: String(newStock),
        notes: `Auto-deduction for order ${orderId}`,
      });

      const isLowStock = newStock <= minimumStock;

      deductions.push({
        inventoryItemId,
        inventoryItemName: inventoryItem.name,
        quantityDeducted: deduction.totalQuantity,
        balanceAfter: newStock,
        lowStock: isLowStock,
      });

      if (isLowStock) {
        const warningMsg = `⚠️ LOW STOCK: "${inventoryItem.name}" is at ${newStock.toFixed(1)} ${inventoryItem.unit} (minimum: ${minimumStock} ${inventoryItem.unit})`;
        warnings.push(warningMsg);

        if (pubClient) {
          pubClient.publish(
            "sync-events",
            JSON.stringify({
              eventType: "LOW_STOCK_ALERT",
              organizationId,
              outletId,
              payload: {
                inventoryItemId,
                name: inventoryItem.name,
                currentStock: newStock,
                minimumStock,
                unit: inventoryItem.unit,
                orderId,
                message: warningMsg,
              },
            })
          ).catch((err: any) => console.error("[Inventory] Failed to publish low-stock alert:", err));
        }
      }
    }
  });

  // Log warnings
  for (const warning of warnings) {
    console.warn(`[Inventory] ${warning}`);
  }

  return { deducted: true, deductions, warnings };
}
