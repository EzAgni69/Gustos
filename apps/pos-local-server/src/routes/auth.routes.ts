/**
 * Gusto POS Local Server — Auth Routes
 *
 * PIN-based authentication for local POS users.
 */

import { Router } from "express";
import { eq } from "drizzle-orm";
import * as schema from "@gusto/db-schema/local";
import { db } from "../db/index.js";

const router = Router();

/**
 * POST /api/auth/pin-login
 * Validate PIN and return user object.
 */
router.post("/pin-login", (req, res) => {
  const { pin } = req.body as { pin?: string };

  if (!pin) {
    res.status(400).json({ success: false, message: "PIN is required" });
    return;
  }

  const user = db
    .select()
    .from(schema.localUsers)
    .where(eq(schema.localUsers.pin, pin))
    .get();

  if (!user || !user.isActive) {
    res.status(401).json({ success: false, message: "Invalid PIN" });
    return;
  }

  res.json({
    success: true,
    data: {
      id: user.id,
      name: user.name,
      role: user.role,
    },
    message: "Login successful",
  });
});

/**
 * GET /api/auth/users
 * List active local users (for PIN login dropdown).
 */
router.get("/users", (_req, res) => {
  const users = db
    .select({
      id: schema.localUsers.id,
      name: schema.localUsers.name,
      role: schema.localUsers.role,
    })
    .from(schema.localUsers)
    .where(eq(schema.localUsers.isActive, true))
    .all();

  res.json({ success: true, data: users });
});

export { router as authRoutes };
