import { Router } from "express";
import {
  getUnsyncedEvents,
  getDeadEvents,
  getOutboxCounts,
  requeueDeadEvents,
  pushToCloud,
} from "../services/sync.service.js";
import { triggerManualSync } from "../services/cloud-sync.service.js";
import { requireRole, MANAGER_ROLES } from "../middleware/auth.js";

const router = Router();

function parseLimit(value: unknown, fallback = 50, max = 500): number {
  const n = Number.parseInt(String(value ?? ""), 10);
  if (!Number.isFinite(n) || n <= 0) return fallback;
  return Math.min(n, max);
}

// GET /api/sync/queue — events still waiting to reach the cloud
router.get("/queue", (req, res) => {
  try {
    const limit = parseLimit(req.query.limit);
    res.json({
      success: true,
      data: getUnsyncedEvents(limit),
      meta: { ...getOutboxCounts(), dead: getDeadEvents(limit) },
    });
  } catch (err) {
    res.status(500).json({ success: false, message: (err as Error).message });
  }
});

// POST /api/sync/pull — pull menu / tables / users from the cloud now
router.post("/pull", async (_req, res) => {
  try {
    const summary = await triggerManualSync();
    res.json({ success: true, data: summary });
  } catch (err) {
    res.status(500).json({ success: false, message: (err as Error).message });
  }
});

// POST /api/sync/push — push the outbox to the cloud now
router.post("/push", async (_req, res) => {
  try {
    const synced = await pushToCloud();
    res.json({ success: true, data: { synced, ...getOutboxCounts() } });
  } catch (err) {
    res.status(500).json({ success: false, message: (err as Error).message });
  }
});

// POST /api/sync/requeue-dead — retry events the cloud kept rejecting
router.post("/requeue-dead", requireRole(...MANAGER_ROLES), async (_req, res) => {
  try {
    const requeued = requeueDeadEvents();
    if (requeued > 0) pushToCloud().catch(() => {});
    res.json({ success: true, data: { requeued }, message: `${requeued} event(s) requeued` });
  } catch (err) {
    res.status(500).json({ success: false, message: (err as Error).message });
  }
});

export { router as syncRoutes };
