/**
 * Gusto POS Local Server — Menu Routes
 *
 * Read-only menu data from local SQLite (synced from cloud).
 */

import { Router } from "express";
import { eq } from "drizzle-orm";
import * as schema from "@gusto/db-schema/local";
import { db } from "../db/index.js";

const router = Router();

/**
 * GET /api/menu/categories
 * List active menu categories.
 */
router.get("/categories", (_req, res) => {
  const categories = db
    .select()
    .from(schema.menuCategories)
    .where(eq(schema.menuCategories.isActive, true))
    .orderBy(schema.menuCategories.sortOrder)
    .all();

  // Deduplicate by normalized category name as defensive safety guard
  const seenNames = new Set<string>();
  const uniqueCategories = categories.filter((cat) => {
    const key = cat.name.trim().toLowerCase();
    if (seenNames.has(key)) return false;
    seenNames.add(key);
    return true;
  });

  res.json({ success: true, data: uniqueCategories });
});

/**
 * GET /api/menu/items
 * List menu items with optional filters.
 */
router.get("/items", (req, res) => {
  const { categoryId, available } = req.query;

  const activeCategories = db
    .select({ id: schema.menuCategories.id })
    .from(schema.menuCategories)
    .where(eq(schema.menuCategories.isActive, true))
    .all();
  const activeCatIdSet = new Set(activeCategories.map((c) => c.id));

  let items;

  if (categoryId) {
    items = db
      .select()
      .from(schema.menuItems)
      .where(eq(schema.menuItems.categoryId, categoryId as string))
      .orderBy(schema.menuItems.sortOrder)
      .all();
  } else {
    items = db
      .select()
      .from(schema.menuItems)
      .orderBy(schema.menuItems.sortOrder)
      .all();
  }

  // Filter out any items belonging to missing or inactive categories
  items = items.filter((item) => activeCatIdSet.has(item.categoryId));

  // Filter by availability if requested
  if (available === "true") {
    items = items.filter((item) => item.isAvailable);
  }

  const itemsWithShortCode = items.map((item) => ({
    ...item,
    shortCode: String(item.sortOrder),
  }));

  res.json({ success: true, data: itemsWithShortCode });
});

/**
 * PATCH /api/menu/items/:id/availability
 * Toggle item availability (86'd / available).
 */
router.patch("/items/:id/availability", (req, res) => {
  const { id } = req.params;
  const { isAvailable } = req.body as { isAvailable: boolean };

  const item = db
    .select()
    .from(schema.menuItems)
    .where(eq(schema.menuItems.id, id!))
    .get();

  if (!item) {
    res.status(404).json({ success: false, message: "Menu item not found" });
    return;
  }

  db.update(schema.menuItems)
    .set({
      isAvailable: isAvailable ?? !item.isAvailable,
      updatedAt: new Date().toISOString(),
    })
    .where(eq(schema.menuItems.id, id!))
    .run();

  res.json({
    success: true,
    data: { id: item.id, isAvailable: isAvailable ?? !item.isAvailable },
    message: `Item ${isAvailable ?? !item.isAvailable ? "available" : "86'd (unavailable)"}`,
  });
});

export { router as menuRoutes };
