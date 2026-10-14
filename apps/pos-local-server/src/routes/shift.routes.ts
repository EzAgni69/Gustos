/**
 * Gusto POS Local Server — Shift Routes
 *
 * POST   /api/shifts/open        — Open a new cashier shift
 * GET    /api/shifts/active      — Get current active shift
 * POST   /api/shifts/:id/close   — Close shift with cash count
 * GET    /api/shifts/:id/x-report — Generate X-Report (mid-shift)
 * GET    /api/shifts/history     — List past shifts
 * GET    /api/shifts/warning     — Check if shift warning is active
 */

import { Router } from "express";
import path from "node:path";
import {
  openShift,
  getActiveShift,
  closeShift,
  generateXReport,
  getShiftHistory,
  getShiftWarning,
} from "../services/shift.service.js";
import { queuePrint } from "../services/print.service.js";
import { buildShiftReport } from "@gusto/printer";
import { db } from "../db/index.js";
import * as schema from "@gusto/db-schema/local";
import { eq } from "drizzle-orm";

const OUTLET_ID = process.env.OUTLET_ID || "local-outlet";

function getOutletConfig() {
  const outlet = db.select().from(schema.outletConfig).where(eq(schema.outletConfig.outletId, OUTLET_ID)).get();
  if (outlet) {
    if (!outlet.logoImagePath) {
      outlet.logoImagePath = path.resolve(process.cwd(), "assets/logo.png");
    }
    return outlet;
  }
  return {
    outletName: "Gusto's Pizzeria",
    address: "",
    logoImagePath: path.resolve(process.cwd(), "assets/logo.png"),
  };
}

export const shiftRoutes = Router();

// ─── Open Shift ───
shiftRoutes.post("/open", (req, res) => {
  try {
    const { cashierId, cashierName, openingFloat } = req.body;

    if (!cashierId || !cashierName) {
      return res.status(400).json({
        success: false,
        message: "cashierId and cashierName are required",
      });
    }

    const shift = openShift({
      cashierId,
      cashierName,
      openingFloat: Number(openingFloat) || 0,
    });

    return res.json({ success: true, data: shift });
  } catch (err) {
    return res.status(400).json({
      success: false,
      message: err instanceof Error ? err.message : "Failed to open shift",
    });
  }
});

// ─── Get Active Shift ───
shiftRoutes.get("/active", (_req, res) => {
  const shift = getActiveShift();
  return res.json({
    success: true,
    data: shift,
  });
});

// ─── Close Shift ───
shiftRoutes.post("/:id/close", (req, res) => {
  try {
    const { id } = req.params;
    const { actualCashInDrawer, notes } = req.body;

    if (actualCashInDrawer === undefined || actualCashInDrawer === null) {
      return res.status(400).json({
        success: false,
        message: "actualCashInDrawer is required",
      });
    }

    const report = closeShift(id, {
      actualCashInDrawer: Number(actualCashInDrawer),
      notes,
    });

    const outlet = getOutletConfig();
    const printData = {
      ...report,
      outletName: outlet.outletName,
      outletAddress: outlet.address ?? undefined,
      openedAt: new Date(report.openedAt),
      closedAt: report.closedAt ? new Date(report.closedAt) : undefined,
      actualCashInDrawer: report.actualCashInDrawer ?? undefined,
      cashVariance: report.cashVariance ?? undefined,
    };
    
    // Automatically print Z-Report
    queuePrint(buildShiftReport(printData), "SHIFT_REPORT", "pos").catch(console.error);

    return res.json({ success: true, data: report });
  } catch (err) {
    return res.status(400).json({
      success: false,
      message: err instanceof Error ? err.message : "Failed to close shift",
    });
  }
});

// ─── X-Report (Mid-Shift Audit) ───
shiftRoutes.get("/:id/x-report", (req, res) => {
  try {
    const { id } = req.params;
    const report = generateXReport(id);

    const outlet = getOutletConfig();
    const printData = {
      ...report,
      outletName: outlet.outletName,
      outletAddress: outlet.address ?? undefined,
      openedAt: new Date(report.openedAt),
      closedAt: undefined,
      actualCashInDrawer: report.actualCashInDrawer ?? undefined,
      cashVariance: report.cashVariance ?? undefined,
    };
    
    // Automatically print X-Report
    queuePrint(buildShiftReport(printData), "SHIFT_REPORT", "pos").catch(console.error);

    return res.json({ success: true, data: report });
  } catch (err) {
    return res.status(400).json({
      success: false,
      message: err instanceof Error ? err.message : "Failed to generate X-Report",
    });
  }
});

// ─── Shift History ───
shiftRoutes.get("/history", (req, res) => {
  const limit = Number(req.query.limit) || 20;
  const shifts = getShiftHistory(limit);
  return res.json({ success: true, data: shifts });
});

// ─── Shift Warning (for checkout flow) ───
shiftRoutes.get("/warning", (_req, res) => {
  const warning = getShiftWarning();
  return res.json({
    success: true,
    data: { warning, hasActiveShift: warning === null },
  });
});
