/**
 * Gusto POS Local Server — KOT Routes
 *
 * Kitchen Order Ticket generation and management.
 */

import { Router } from "express";
import { generateKOT, listKOTs, updateKOTStatus } from "../services/kot.service.js";

const router = Router();

/**
 * POST /api/orders/:id/kot
 * Generate a KOT for new items in the order.
 */
router.post("/orders/:id/kot", (req, res) => {
  try {
    const { itemIds, station } = req.body as {
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
  res.json({ success: true, data: kots });
});

/**
 * PATCH /api/kots/:id/status
 * Update KOT status (used by KDS).
 */
router.patch("/kots/:id/status", (req, res) => {
  try {
    const { status } = req.body as {
      status: "PENDING" | "IN_PROGRESS" | "READY" | "SERVED";
    };
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

export { router as kotRoutes };
