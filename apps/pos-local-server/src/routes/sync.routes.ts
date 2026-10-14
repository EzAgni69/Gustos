import { Router } from "express";
import { getUnsyncedEvents } from "../services/sync.service.js";

const router = Router();

// GET /api/sync/queue
router.get("/queue", (req, res) => {
  try {
    const limit = req.query.limit ? parseInt(req.query.limit as string, 10) : 50;
    const events = getUnsyncedEvents(limit);
    res.json({
      success: true,
      data: events,
    });
  } catch (err) {
    res.status(500).json({
      success: false,
      message: (err as Error).message,
    });
  }
});

export { router as syncRoutes };
