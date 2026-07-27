/**
 * Gusto POS Local Server — Table Routes
 *
 * Dining table management — status updates and transfers.
 */

import { Router } from "express";
import { eq } from "drizzle-orm";
import * as schema from "@gusto/db-schema/local";
import { db } from "../db/index.js";
import { emitTableStatusChanged } from "../socket/events.js";

const router = Router();

/**
 * GET /api/tables
 * List all dining tables with current status.
 */
router.get("/", (_req, res) => {
  const tables = db
    .select()
    .from(schema.diningTables)
    .orderBy(schema.diningTables.sortOrder)
    .all();

  // Enrich with current order info if occupied
  const enriched = tables.map((table) => {
    if (table.currentOrderId) {
      const order = db
        .select()
        .from(schema.orders)
        .where(eq(schema.orders.id, table.currentOrderId))
        .get();

      return {
        ...table,
        currentOrder: order
          ? {
              id: order.id,
              orderNumber: order.orderNumber,
              totalAmount: order.totalAmount,
              waiterName: order.waiterName,
              paxCount: order.paxCount,
              createdAt: order.createdAt,
            }
          : null,
      };
    }
    return { ...table, currentOrder: null };
  });

  res.json({ success: true, data: enriched });
});

/**
 * PATCH /api/tables/:id/status
 * Update table status.
 */
router.patch("/:id/status", (req, res) => {
  const { id } = req.params;
  const { status } = req.body as { status: string };

  const table = db
    .select()
    .from(schema.diningTables)
    .where(eq(schema.diningTables.id, id!))
    .get();

  if (!table) {
    res.status(404).json({ success: false, message: "Table not found" });
    return;
  }

  const updateData: Record<string, unknown> = { status };
  if (status === "AVAILABLE") {
    updateData.currentOrderId = null;
  }

  db.update(schema.diningTables)
    .set(updateData as { status: string; currentOrderId?: string | null })
    .where(eq(schema.diningTables.id, id!))
    .run();

  emitTableStatusChanged({ tableId: id, status });

  res.json({
    success: true,
    data: { id, status },
    message: `Table status updated to ${status}`,
  });
});

/**
 * POST /api/tables/transfer
 * Transfer order from one table to another.
 */
router.post("/transfer", (req, res) => {
  const { fromTableId, toTableId } = req.body as {
    fromTableId: string;
    toTableId: string;
  };

  const fromTable = db
    .select()
    .from(schema.diningTables)
    .where(eq(schema.diningTables.id, fromTableId))
    .get();

  const toTable = db
    .select()
    .from(schema.diningTables)
    .where(eq(schema.diningTables.id, toTableId))
    .get();

  if (!fromTable || !toTable) {
    res.status(404).json({ success: false, message: "Table not found" });
    return;
  }

  if (toTable.status !== "AVAILABLE") {
    res.status(400).json({ success: false, message: "Target table is not available" });
    return;
  }

  if (!fromTable.currentOrderId) {
    res.status(400).json({ success: false, message: "Source table has no active order" });
    return;
  }

  // Move order to new table
  db.update(schema.orders)
    .set({ tableId: toTableId, updatedAt: new Date().toISOString() })
    .where(eq(schema.orders.id, fromTable.currentOrderId))
    .run();

  // Update table statuses
  db.update(schema.diningTables)
    .set({ status: "AVAILABLE", currentOrderId: null })
    .where(eq(schema.diningTables.id, fromTableId))
    .run();

  db.update(schema.diningTables)
    .set({ status: "OCCUPIED", currentOrderId: fromTable.currentOrderId })
    .where(eq(schema.diningTables.id, toTableId))
    .run();

  emitTableStatusChanged({ tableId: fromTableId, status: "AVAILABLE" });
  emitTableStatusChanged({ tableId: toTableId, status: "OCCUPIED" });

  res.json({
    success: true,
    message: `Order transferred from ${fromTable.name} to ${toTable.name}`,
  });
});

export { router as tableRoutes };
