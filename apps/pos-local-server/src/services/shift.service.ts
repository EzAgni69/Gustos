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

import { eq, and, gte, lte, desc } from "drizzle-orm";
import { v4 as uuid } from "uuid";
import * as schema from "@gusto/db-schema/local";
import { db } from "../db/index.js";
import { atomicFn } from "../db/tx.js";

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
export const openShift = atomicFn(function openShift(input: ShiftOpenInput) {
  if (!input.cashierId || !input.cashierName?.trim()) {
    throw new Error("cashierId and cashierName are required");
  }
  if (typeof input.openingFloat !== "number" || !Number.isFinite(input.openingFloat) || input.openingFloat < 0) {
    throw new Error("openingFloat must be zero or more");
  }

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
});

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

const round2 = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100;

/**
 * Aggregate sales data for a shift period.
 * Used by both X-Report and Z-Report.
 *
 * A bill belongs to the shift in which it was PAID (invoice time), not the
 * shift in which the order was opened — a table seated before the shift
 * change and settled after it puts its cash in the new cashier's drawer.
 * Voided / unpaid invoices are excluded.
 */
function aggregateShiftSales(openedAt: string, closedAt?: string) {
  const endTime = closedAt || new Date().toISOString();

  const invoices = db
    .select()
    .from(schema.invoices)
    .where(
      and(
        eq(schema.invoices.isPaid, true),
        gte(schema.invoices.createdAt, openedAt),
        lte(schema.invoices.createdAt, endTime)
      )
    )
    .all();

  let totalCashSales = 0;
  let totalCardSales = 0;
  let totalUpiSales = 0;
  let totalOnlineSales = 0;
  let totalSplitSales = 0;
  let totalDiscounts = 0;
  let totalTips = 0;
  let totalChangeDue = 0;
  // Cash that physically ended up in the drawer (bill amounts + cash tips, net of change)
  let cashCollected = 0;

  for (const inv of invoices) {
    const amount = inv.totalAmount;
    const tip = inv.tipAmount ?? 0;

    switch (inv.paymentMode) {
      case "CASH":
        totalCashSales += amount;
        cashCollected += amount + tip;
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
        // The cash legs of a split bill also land in the drawer
        if (inv.paymentSplits) {
          try {
            const splits = JSON.parse(inv.paymentSplits) as { mode: string; amount: number }[];
            for (const split of splits) {
              if (split.mode === "CASH" && Number.isFinite(split.amount)) {
                cashCollected += split.amount;
              }
            }
          } catch {
            // Ignore parse errors
          }
        }
        break;
    }

    totalDiscounts += inv.discountAmount;
    totalTips += tip;
    totalChangeDue += inv.changeDue ?? 0;
  }

  return {
    totalCashSales: round2(totalCashSales),
    totalCardSales: round2(totalCardSales),
    totalUpiSales: round2(totalUpiSales),
    totalOnlineSales: round2(totalOnlineSales),
    totalSplitSales: round2(totalSplitSales),
    totalOrders: invoices.length,
    totalDiscounts: round2(totalDiscounts),
    totalTips: round2(totalTips),
    totalChangeDue: round2(totalChangeDue),
    cashCollected: round2(cashCollected),
  };
}

/**
 * Cash that should be in the drawer: the opening float plus every rupee of
 * cash kept from customers. Change handed back never entered the drawer's
 * balance (tendered − change = amount kept), so it is not subtracted again.
 */
function expectedCashInDrawer(openingFloat: number, cashCollected: number): number {
  return round2(openingFloat + cashCollected);
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

  // A closed shift's figures were frozen at close — report those, not a recount
  if (shift.status === "CLOSED") {
    return {
      id: shift.id,
      cashierId: shift.cashierId,
      cashierName: shift.cashierName,
      openedAt: shift.openedAt,
      closedAt: shift.closedAt,
      openingFloat: shift.openingFloat,
      totalCashSales: shift.totalCashSales,
      totalCardSales: shift.totalCardSales,
      totalUpiSales: shift.totalUpiSales,
      totalOnlineSales: shift.totalOnlineSales,
      totalSplitSales: shift.totalSplitSales,
      totalOrders: shift.totalOrders,
      totalDiscounts: shift.totalDiscounts,
      totalTips: shift.totalTips,
      totalChangeDue: shift.totalChangeDue,
      expectedCashInDrawer: shift.expectedCashInDrawer,
      actualCashInDrawer: shift.actualCashInDrawer,
      cashVariance: shift.cashVariance,
      status: shift.status,
      reportType: "Z",
    };
  }

  const { cashCollected, ...sales } = aggregateShiftSales(shift.openedAt, undefined);
  const expectedCash = expectedCashInDrawer(shift.openingFloat, cashCollected);

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
export const closeShift = atomicFn(function closeShift(
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
  if (typeof input.actualCashInDrawer !== "number" || !Number.isFinite(input.actualCashInDrawer) || input.actualCashInDrawer < 0) {
    throw new Error("actualCashInDrawer must be zero or more");
  }

  const now = new Date().toISOString();
  const { cashCollected, ...sales } = aggregateShiftSales(shift.openedAt, now);

  const expectedCash = expectedCashInDrawer(shift.openingFloat, cashCollected);
  const cashVariance = round2(input.actualCashInDrawer - expectedCash);

  // Update shift record with final tallies
  db.update(schema.cashierShifts)
    .set({
      closedAt: now,
      ...sales,
      expectedCashInDrawer: expectedCash,
      actualCashInDrawer: input.actualCashInDrawer,
      cashVariance,
      notes: typeof input.notes === "string" && input.notes.trim() ? input.notes.trim().slice(0, 1000) : null,
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
});

/**
 * Get shift history (most recent first).
 */
export function getShiftHistory(limit: number = 20) {
  return db
    .select()
    .from(schema.cashierShifts)
    .orderBy(desc(schema.cashierShifts.openedAt))
    .limit(Math.min(Math.max(Math.floor(limit) || 20, 1), 200))
    .all();
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
