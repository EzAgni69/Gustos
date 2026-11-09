/**
 * Gusto POS Local Server — KOT Routes
 *
 * Kitchen Order Ticket generation and management.
 */

import { Router } from "express";
import {
  generateKOT,
  listKOTs,
  updateKOTStatus,
  reprintKOT,
  cancelKOT,
  generateModificationKOT,
  markRush,
  listKOTsForOrder,
  assertKOTBelongsToOrder,
} from "../services/kot.service.js";
import { getReadyStationsMap, resetStationStatus } from "../services/expo.service.js";

const router = Router();

/**
 * POST /api/orders/:id/kot
 * Generate a KOT for new items in the order.
 */
router.post("/orders/:id/kot", (req, res) => {
  try {
    const { itemIds, station } = (req.body || {}) as {
      itemIds?: string[];
      station?: string;
    };
    const result = generateKOT(
      req.params.id!,
      itemIds,
      station,
      req.currentUser?.id
    );
    res.status(201).json({
      success: true,
      data: {
        kotId: result.kotId,
        kotNumber: result.kotNumber,
        orderId: result.orderId,
        station: result.station,
        itemCount: result.items.length,
      },
      message: `KOT ${result.kotNumber} fired to kitchen`,
    });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Failed to generate KOT";
    res.status(400).json({ success: false, message });
  }
});

/**
 * GET /api/kots
 * List KOTs (for KDS display).
 */
router.get("/kots", (req, res) => {
  const { status } = req.query;
  const kots = listKOTs(status as string | undefined);
  // Which stations already finished their part (station KDS screens hide those)
  const readyStations = getReadyStationsMap(kots);
  res.json({ success: true, data: kots.map((k) => ({ ...k, readyStations: readyStations.get(k.id) ?? [] })) });
});

/**
 * PATCH /api/kots/:id/status
 * Update KOT status (used by KDS).
 */
router.patch("/kots/:id/status", (req, res) => {
  try {
    const { status } = (req.body || {}) as {
      status: "PENDING" | "IN_PROGRESS" | "READY" | "SERVED";
    };
    // Whole ticket sent back to the kitchen → per-station marks no longer apply
    if (status === "PENDING" || status === "IN_PROGRESS") resetStationStatus(req.params.id!);
    const result = updateKOTStatus(req.params.id!, status);
    res.json({
      success: true,
      data: result,
      message: `KOT status updated to ${status}`,
    });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Failed to update KOT status";
    res.status(400).json({ success: false, message });
  }
});

// ─── Edge Case KOT Routes ───

/**
 * GET /api/orders/:orderId/kots
 * Fired KOTs for one order (newest first) — POS KOT history panel.
 */
router.get("/orders/:orderId/kots", (req, res) => {
  res.json({ success: true, data: listKOTsForOrder(req.params.orderId!) });
});

/**
 * POST /api/orders/:orderId/kot/:kotId/reprint
 * Reprint a KOT (resend to printer/KDS with REPRINT label).
 */
router.post("/orders/:orderId/kot/:kotId/reprint", (req, res) => {
  try {
    assertKOTBelongsToOrder(req.params.kotId!, req.params.orderId!);
    const result = reprintKOT(req.params.kotId!);
    res.json({
      success: true,
      data: { kotId: result.kotId, kotNumber: result.kotNumber },
      message: `KOT ${result.kotNumber} reprinted`,
    });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Failed to reprint KOT";
    res.status(400).json({ success: false, message });
  }
});

/**
 * POST /api/orders/:orderId/kot/:kotId/cancel
 * Cancel an entire KOT (requires reason + manager approval).
 */
router.post("/orders/:orderId/kot/:kotId/cancel", (req, res) => {
  try {
    const { reason, approvedBy } = (req.body || {}) as { reason: string; approvedBy: string };
    if (!reason || !approvedBy) {
      res.status(400).json({ success: false, message: "reason and approvedBy are required" });
      return;
    }
    assertKOTBelongsToOrder(req.params.kotId!, req.params.orderId!);
    const result = cancelKOT(req.params.kotId!, reason, approvedBy, req.currentUser?.id);
    res.json({
      success: true,
      data: result,
      message: `KOT ${result.kotNumber} cancelled`,
    });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Failed to cancel KOT";
    res.status(400).json({ success: false, message });
  }
});

/**
 * POST /api/orders/:orderId/kot/modify
 * Generate a modification KOT (correction slip for post-fire changes).
 */
router.post("/orders/:orderId/kot/modify", (req, res) => {
  try {
    const { modifications, station } = (req.body || {}) as {
      modifications: Array<{
        orderItemId: string;
        changeType: "MODIFIER_CHANGE" | "QUANTITY_CHANGE" | "NOTE_CHANGE";
        oldValue?: string;
        newValue?: string;
      }>;
      station?: string;
    };
    if (!modifications || modifications.length === 0) {
      res.status(400).json({ success: false, message: "modifications array is required" });
      return;
    }
    const result = generateModificationKOT(
      req.params.orderId!,
      modifications,
      station,
      req.currentUser?.id
    );
    res.status(201).json({
      success: true,
      data: result,
      message: `Modification KOT ${result.kotNumber} sent`,
    });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Failed to generate modification KOT";
    res.status(400).json({ success: false, message });
  }
});

/**
 * POST /api/orders/:orderId/kot/:kotId/rush
 * Mark a KOT as rush/priority.
 */
router.post("/orders/:orderId/kot/:kotId/rush", (req, res) => {
  try {
    assertKOTBelongsToOrder(req.params.kotId!, req.params.orderId!);
    const result = markRush(req.params.kotId!, req.currentUser?.id, req.currentUser?.name);
    res.json({
      success: true,
      data: result,
      message: `KOT ${result.kotNumber} marked as RUSH`,
    });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Failed to mark KOT as rush";
    res.status(400).json({ success: false, message });
  }
});

export { router as kotRoutes };

