/**
 * Gusto POS Local Server — Shift Management Service
 *
 * Manages cashier shifts with cash drawer reconciliation.
 * Supports:
 * - Opening shifts with an opening cash float
 * - X-Report: mid-shift audit snapshot (non-destructive)
 * - Z-Report: end-of-day shift close with cash reconciliation
 *
 * Mode: Permissive — billing is allowed without an active shift,
 * but a warning is returned to the POS UI.
 */

import { eq, and, isNull } from "drizzle-orm";
import { v4 as uuid } from "uuid";
import * as schema from "@gusto/db-schema/local";
import { db } from "../db/index.js";

// ─── Types ───

export interface ShiftOpenInput {
  cashierId: string;
  cashierName: string;
  openingFloat: number;
}

export interface ShiftCloseInput {
  actualCashInDrawer: number;
  notes?: string;
}

export interface ShiftReportData {
  id: string;
  cashierId: string;
  cashierName: string;
  openedAt: string;
  closedAt: string | null;
  openingFloat: number;
  totalCashSales: number;
  totalCardSales: number;
  totalUpiSales: number;
  totalOnlineSales: number;
  totalSplitSales: number;
  totalOrders: number;
  totalDiscounts: number;
  totalTips: number;
  totalChangeDue: number;
  expectedCashInDrawer: number;
  actualCashInDrawer: number | null;
  cashVariance: number | null;
  status: string;
  reportType: "X" | "Z";
}

// ─── Service Functions ───

/**
 * Open a new cashier shift.
 * Validates that no other shift is currently active.
 */
export function openShift(input: ShiftOpenInput) {
  // Check for existing open shift
  const activeShift = getActiveShift();
  if (activeShift) {
    throw new Error(
      `Shift already open by ${activeShift.cashierName} since ${activeShift.openedAt}. Close it before opening a new one.`
    );
  }

  const now = new Date().toISOString();
  const shiftId = uuid();

  db.insert(schema.cashierShifts)
    .values({
      id: shiftId,
      cashierId: input.cashierId,
      cashierName: input.cashierName,
      openedAt: now,
      openingFloat: input.openingFloat,
      status: "OPEN",
    })
    .run();

  return {
    id: shiftId,
    cashierId: input.cashierId,
    cashierName: input.cashierName,
    openedAt: now,
    openingFloat: input.openingFloat,
    status: "OPEN",
  };
}

/**
 * Get the currently active (open) shift, or null.
 */
export function getActiveShift() {
  return db
    .select()
    .from(schema.cashierShifts)
    .where(eq(schema.cashierShifts.status, "OPEN"))
    .get() ?? null;
}

/**
 * Aggregate sales data for a shift period.
 * Used by both X-Report and Z-Report.
 */
function aggregateShiftSales(openedAt: string, closedAt?: string) {
  const endTime = closedAt || new Date().toISOString();

  // Get all completed orders in the shift window
  const orders = db
    .select()
    .from(schema.orders)
    .where(eq(schema.orders.status, "COMPLETED"))
    .all()
    .filter((o) => o.createdAt >= openedAt && o.createdAt <= endTime);

  // Get invoices for these orders
  const orderIds = orders.map((o) => o.id);
  const allInvoices = db.select().from(schema.invoices).all();
  const invoices = allInvoices.filter((inv) => orderIds.includes(inv.orderId));

  let totalCashSales = 0;
  let totalCardSales = 0;
  let totalUpiSales = 0;
  let totalOnlineSales = 0;
  let totalSplitSales = 0;
  let totalDiscounts = 0;
  let totalTips = 0;
  let totalChangeDue = 0;

  for (const inv of invoices) {
    const amount = inv.totalAmount;

    switch (inv.paymentMode) {
      case "CASH":
        totalCashSales += amount;
        break;
      case "CARD":
        totalCardSales += amount;
        break;
      case "UPI":
        totalUpiSales += amount;
        break;
      case "ONLINE":
        totalOnlineSales += amount;
        break;
      case "SPLIT":
        totalSplitSales += amount;
        // For splits, count the cash portion separately
        if (inv.paymentSplits) {
          try {
            const splits = JSON.parse(inv.paymentSplits) as { mode: string; amount: number }[];
            for (const split of splits) {
              if (split.mode === "CASH") {
                totalCashSales += split.amount;
              }
            }
          } catch {
            // Ignore parse errors
          }
        }
        break;
    }

    totalDiscounts += inv.discountAmount;
    totalTips += inv.tipAmount ?? 0;
    totalChangeDue += inv.changeDue ?? 0;
  }

  return {
    totalCashSales,
    totalCardSales,
    totalUpiSales,
    totalOnlineSales,
    totalSplitSales,
    totalOrders: orders.length,
    totalDiscounts,
    totalTips,
    totalChangeDue,
  };
}

/**
 * Generate an X-Report (mid-shift audit).
 * Does NOT close the shift — just a read-only snapshot.
 */
export function generateXReport(shiftId: string): ShiftReportData {
  const shift = db
    .select()
    .from(schema.cashierShifts)
    .where(eq(schema.cashierShifts.id, shiftId))
    .get();

  if (!shift) throw new Error("Shift not found");

  const sales = aggregateShiftSales(shift.openedAt, undefined);

  const expectedCash = shift.openingFloat + sales.totalCashSales - sales.totalChangeDue;

  return {
    id: shift.id,
    cashierId: shift.cashierId,
    cashierName: shift.cashierName,
    openedAt: shift.openedAt,
    closedAt: null,
    openingFloat: shift.openingFloat,
    ...sales,
    expectedCashInDrawer: expectedCash,
    actualCashInDrawer: null,
    cashVariance: null,
    status: shift.status,
    reportType: "X",
  };
}

/**
 * Close a shift with cash reconciliation.
 * Generates a Z-Report (final, immutable shift close).
 */
export function closeShift(
  shiftId: string,
  input: ShiftCloseInput
): ShiftReportData {
  const shift = db
    .select()
    .from(schema.cashierShifts)
    .where(eq(schema.cashierShifts.id, shiftId))
    .get();

  if (!shift) throw new Error("Shift not found");
  if (shift.status === "CLOSED") throw new Error("Shift is already closed");

  const now = new Date().toISOString();
  const sales = aggregateShiftSales(shift.openedAt, now);

  const expectedCash = shift.openingFloat + sales.totalCashSales - sales.totalChangeDue;
  const cashVariance = input.actualCashInDrawer - expectedCash;

  // Update shift record with final tallies
  db.update(schema.cashierShifts)
    .set({
      closedAt: now,
      ...sales,
      expectedCashInDrawer: expectedCash,
      actualCashInDrawer: input.actualCashInDrawer,
      cashVariance,
      notes: input.notes ?? null,
      status: "CLOSED",
    })
    .where(eq(schema.cashierShifts.id, shiftId))
    .run();

  return {
    id: shift.id,
    cashierId: shift.cashierId,
    cashierName: shift.cashierName,
    openedAt: shift.openedAt,
    closedAt: now,
    openingFloat: shift.openingFloat,
    ...sales,
    expectedCashInDrawer: expectedCash,
    actualCashInDrawer: input.actualCashInDrawer,
    cashVariance,
    status: "CLOSED",
    reportType: "Z",
  };
}

/**
 * Get shift history (most recent first).
 */
export function getShiftHistory(limit: number = 20) {
  return db
    .select()
    .from(schema.cashierShifts)
    .orderBy(schema.cashierShifts.openedAt)
    .limit(limit)
    .all()
    .reverse(); // Most recent first
}

/**
 * Check if billing should show a warning (no active shift).
 * Returns null if a shift is active, or a warning message if not.
 */
export function getShiftWarning(): string | null {
  const active = getActiveShift();
  if (!active) {
    return "⚠️ No active shift. Open a shift for accurate cash drawer reconciliation.";
  }

  // Stale shift warning not needed for Phase 1 - commented out so it can be reactivated in the future
  // const openedAt = new Date(active.openedAt);
  // const now = new Date();
  // const hoursOpen = (now.getTime() - openedAt.getTime()) / (1000 * 60 * 60);

  // if (hoursOpen > 16) {
  //   return `⚠️ Stale shift detected. Shift has been open for ${Math.round(hoursOpen)} hours. Please close it (Z-Report).`;
  // }

  return null;
}
