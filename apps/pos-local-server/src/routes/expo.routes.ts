/**
 * Gusto POS Local Server — Station readiness & Expo (pass) routes
 *
 *   POST /api/kots/:id/stations/:stationId/ready    station bumps its part of a KOT
 *   POST /api/kots/:id/stations/:stationId/recall   undo a station bump
 *   GET  /api/expo/orders                           whole table orders + station checklist
 *   GET  /api/expo/recent                           orders recently sent from the pass
 *   POST /api/expo/orders/:orderId/bump             send order out → notify waiter  { force? }
 *   POST /api/expo/orders/:orderId/recall           bring the last bump back onto the pass
 */

import { Router, type Response } from "express";
import {
  markStationReady,
  recallStation,
  getExpoBoard,
  getRecentExpoBumps,
  bumpExpoOrder,
  recallExpoOrder,
} from "../services/expo.service.js";

const router = Router();

function fail(res: Response, err: unknown, fallback: string) {
  const message = err instanceof Error ? err.message : fallback;
  const code = /not found|not on the pass|Nothing to recall/i.test(message) ? 404 : 400;
  res.status(code).json({ success: false, message });
}

router.post("/kots/:id/stations/:stationId/ready", (req, res) => {
  try {
    const data = markStationReady(req.params.id!, req.params.stationId!);
    res.json({ success: true, data });
  } catch (err) {
    fail(res, err, "Failed to mark station ready");
  }
});

router.post("/kots/:id/stations/:stationId/recall", (req, res) => {
  try {
    const data = recallStation(req.params.id!, req.params.stationId!);
    res.json({ success: true, data });
  } catch (err) {
    fail(res, err, "Failed to recall station");
  }
});

router.get("/expo/orders", (_req, res) => {
  res.json({ success: true, data: getExpoBoard() });
});

router.get("/expo/recent", (req, res) => {
  const limit = Math.min(Number(req.query.limit) || 20, 100);
  res.json({ success: true, data: getRecentExpoBumps(limit) });
});

router.post("/expo/orders/:orderId/bump", (req, res) => {
  try {
    const force = (req.body as { force?: boolean } | undefined)?.force === true;
    const data = bumpExpoOrder(req.params.orderId!, { force }, req.currentUser?.id);
    res.json({ success: true, data, message: `Order ${data.orderNumber} sent for pickup` });
  } catch (err) {
    fail(res, err, "Failed to bump order");
  }
});

router.post("/expo/orders/:orderId/recall", (req, res) => {
  try {
    const data = recallExpoOrder(req.params.orderId!, req.currentUser?.id);
    res.json({ success: true, data });
  } catch (err) {
    fail(res, err, "Failed to recall order");
  }
});

export { router as expoRoutes };
