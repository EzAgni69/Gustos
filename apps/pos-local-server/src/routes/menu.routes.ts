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

  res.json({ success: true, data: categories });
});

/**
 * GET /api/menu/items
 * List menu items with optional filters.
 */
router.get("/items", (req, res) => {
  const { categoryId, available } = req.query;

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

  // Filter by availability if requested
  if (available === "true") {
    items = items.filter((item) => item.isAvailable);
  }

  res.json({ success: true, data: items });
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
