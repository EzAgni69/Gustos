/**
 * Gusto POS Local Server — Table Routes
 *
 * Dining table management — status updates and transfers.
 */

import { Router } from "express";
import { eq } from "drizzle-orm";
import * as schema from "@gusto/db-schema/local";
import { db } from "../db/index.js";
import {
  emitTableStatusChanged,
  emitTableSwapped,
  emitTableMerged,
} from "../socket/events.js";
import { mergeOrders } from "../services/order.service.js";

const router = Router();

/**
 * GET /api/tables
 * List all dining tables with current status.
 */
router.get("/", (_req, res) => {
  try {
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
  } catch (err: any) {
    console.error("[GET /api/tables Error]", err);
    res.status(500).json({ success: false, message: err?.message || "Error fetching tables" });
  }
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

/**
 * POST /api/tables/swap
 * Swap orders between two occupied tables.
 */
router.post("/swap", (req, res) => {
  try {
    const { tableAId, tableBId } = req.body as {
      tableAId: string;
      tableBId: string;
    };

    const tableA = db.select().from(schema.diningTables).where(eq(schema.diningTables.id, tableAId)).get();
    const tableB = db.select().from(schema.diningTables).where(eq(schema.diningTables.id, tableBId)).get();

    if (!tableA || !tableB) {
      res.status(404).json({ success: false, message: "One or both tables not found" });
      return;
    }

    if (!tableA.currentOrderId || !tableB.currentOrderId) {
      res.status(400).json({ success: false, message: "Both tables must have active orders to swap" });
      return;
    }

    const orderAId = tableA.currentOrderId;
    const orderBId = tableB.currentOrderId;
    const now = new Date().toISOString();

    // Swap order tableId references
    db.update(schema.orders)
      .set({ tableId: tableBId, updatedAt: now })
      .where(eq(schema.orders.id, orderAId))
      .run();

    db.update(schema.orders)
      .set({ tableId: tableAId, updatedAt: now })
      .where(eq(schema.orders.id, orderBId))
      .run();

    // Swap table currentOrderId references
    db.update(schema.diningTables)
      .set({ currentOrderId: orderBId })
      .where(eq(schema.diningTables.id, tableAId))
      .run();

    db.update(schema.diningTables)
      .set({ currentOrderId: orderAId })
      .where(eq(schema.diningTables.id, tableBId))
      .run();

    emitTableSwapped({
      tableAId,
      tableAName: tableA.name,
      tableBId,
      tableBName: tableB.name,
    });

    res.json({
      success: true,
      message: `Orders swapped between ${tableA.name} and ${tableB.name}`,
    });
  } catch (err: any) {
    console.error("[POST /api/tables/swap Error]", err);
    res.status(500).json({ success: false, message: err?.message || "Failed to swap tables" });
  }
});

/**
 * POST /api/tables/merge
 * Merge orders from source table into target table.
 * Source table is released to AVAILABLE.
 */
router.post("/merge", (req, res) => {
  try {
    const { sourceTableId, targetTableId } = req.body as {
      sourceTableId: string;
      targetTableId: string;
    };

    const sourceTable = db.select().from(schema.diningTables).where(eq(schema.diningTables.id, sourceTableId)).get();
    const targetTable = db.select().from(schema.diningTables).where(eq(schema.diningTables.id, targetTableId)).get();

    if (!sourceTable || !targetTable) {
      res.status(404).json({ success: false, message: "One or both tables not found" });
      return;
    }

    if (!sourceTable.currentOrderId) {
      res.status(400).json({ success: false, message: "Source table has no active order" });
      return;
    }

    if (!targetTable.currentOrderId) {
      res.status(400).json({ success: false, message: "Target table has no active order to merge into" });
      return;
    }

    // Use the order service to merge
    const mergedOrder = mergeOrders(
      sourceTable.currentOrderId,
      targetTable.currentOrderId,
      req.currentUser?.id
    );

    emitTableMerged({
      sourceTableId,
      sourceTableName: sourceTable.name,
      targetTableId,
      targetTableName: targetTable.name,
      targetOrderId: targetTable.currentOrderId,
    });

    res.json({
      success: true,
      data: mergedOrder,
      message: `${sourceTable.name} merged into ${targetTable.name}`,
    });
  } catch (err: any) {
    console.error("[POST /api/tables/merge Error]", err);
    res.status(400).json({ success: false, message: err?.message || "Failed to merge tables" });
  }
});

/**
 * GET /api/tables/:id/reservations
 * List active reservations for a table.
 */
router.get("/:id/reservations", (req, res) => {
  const { id } = req.params;

  const reservations = db
    .select()
    .from(schema.tableReservations)
    .where(
      eq(schema.tableReservations.tableId, id!)
    )
    .all();

  // Filter only ACTIVE ones if needed, or return all so UI can see
  const activeReservations = reservations.filter((r) => r.status === "ACTIVE");

  res.json({ success: true, data: activeReservations });
});

/**
 * POST /api/tables/:id/reservations
 * Create a new reservation.
 */
router.post("/:id/reservations", (req, res) => {
  const { id } = req.params;
  const { customerName, reservationTime, durationMins } = req.body as {
    customerName?: string;
    reservationTime: string;
    durationMins?: number;
  };

  const table = db
    .select()
    .from(schema.diningTables)
    .where(eq(schema.diningTables.id, id!))
    .get();

  if (!table) {
    res.status(404).json({ success: false, message: "Table not found" });
    return;
  }

  const newStart = new Date(reservationTime).getTime();
  const dur = durationMins || 60;
  const newEnd = newStart + dur * 60 * 1000;

  // Check overlap
  const existingReservations = db
    .select()
    .from(schema.tableReservations)
    .where(eq(schema.tableReservations.tableId, id!))
    .all()
    .filter((r) => r.status === "ACTIVE");

  for (const r of existingReservations) {
    const existingStart = new Date(r.reservationTime).getTime();
    const existingEnd = existingStart + r.durationMins * 60 * 1000;

    if (newStart < existingEnd && newEnd > existingStart) {
      res.status(409).json({ success: false, message: "Time slot conflict with existing reservation." });
      return;
    }
  }

  const newId = `res-${Date.now()}`;
  db.insert(schema.tableReservations)
    .values({
      id: newId,
      outletId: table.outletId,
      tableId: id!,
      customerName: customerName || null,
      reservationTime: new Date(reservationTime).toISOString(),
      durationMins: dur,
      status: "ACTIVE",
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    })
    .run();

  // Optionally update table status to RESERVED if within a certain time window, but let's keep it simple
  // UI can show reservations independently of current physical status.
  
  res.status(201).json({ success: true, message: "Reservation created", data: { id: newId } });
});

/**
 * GET /api/tables/reservations
 * List all active reservations across all tables.
 */
router.get("/reservations", (req, res) => {
  try {
    const reservations = db
      .select({
        id: schema.tableReservations.id,
        outletId: schema.tableReservations.outletId,
        tableId: schema.tableReservations.tableId,
        tableName: schema.diningTables.name,
        customerName: schema.tableReservations.customerName,
        reservationTime: schema.tableReservations.reservationTime,
        durationMins: schema.tableReservations.durationMins,
        status: schema.tableReservations.status,
      })
      .from(schema.tableReservations)
      .leftJoin(
        schema.diningTables,
        eq(schema.tableReservations.tableId, schema.diningTables.id)
      )
      .where(eq(schema.tableReservations.status, "ACTIVE"))
      .orderBy(schema.tableReservations.reservationTime)
      .all();

    res.json({ success: true, data: reservations });
  } catch (err: any) {
    console.error("[GET /api/tables/reservations Error]", err);
    res.status(500).json({ success: false, message: err?.message || "Error fetching reservations" });
  }
});

/**
 * PUT /api/tables/reservations/:id
 * Update an existing reservation.
 */
router.put("/reservations/:id", (req, res) => {
  const { id } = req.params;
  const { customerName, reservationTime, durationMins, status } = req.body as {
    customerName?: string;
    reservationTime?: string;
    durationMins?: number;
    status?: string;
  };

  const existingRes = db
    .select()
    .from(schema.tableReservations)
    .where(eq(schema.tableReservations.id, id!))
    .get();

  if (!existingRes) {
    res.status(404).json({ success: false, message: "Reservation not found" });
    return;
  }

  const updatedTime = reservationTime ? new Date(reservationTime).toISOString() : existingRes.reservationTime;
  const updatedDur = durationMins || existingRes.durationMins;
  
  // If time or duration changed and status is still ACTIVE, check conflicts again
  const currentStatus = status || existingRes.status;
  
  if (currentStatus === "ACTIVE" && (reservationTime || durationMins)) {
    const newStart = new Date(updatedTime).getTime();
    const newEnd = newStart + updatedDur * 60 * 1000;

    const otherReservations = db
      .select()
      .from(schema.tableReservations)
      .where(eq(schema.tableReservations.tableId, existingRes.tableId))
      .all()
      .filter((r) => r.status === "ACTIVE" && r.id !== id);

    for (const r of otherReservations) {
      const existingStart = new Date(r.reservationTime).getTime();
      const existingEnd = existingStart + r.durationMins * 60 * 1000;

      if (newStart < existingEnd && newEnd > existingStart) {
        res.status(409).json({ success: false, message: "Time slot conflict with existing reservation." });
        return;
      }
    }
  }

  db.update(schema.tableReservations)
    .set({
      customerName: customerName !== undefined ? customerName : existingRes.customerName,
      reservationTime: updatedTime,
      durationMins: updatedDur,
      status: currentStatus,
      updatedAt: new Date().toISOString(),
    })
    .where(eq(schema.tableReservations.id, id!))
    .run();

  res.json({ success: true, message: "Reservation updated" });
});

export { router as tableRoutes };
