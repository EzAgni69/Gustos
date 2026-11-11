/**
 * Gusto POS Local Server — Auth Routes
 *
 * PIN-based authentication for local POS users.
 */

import { Router, type Request, type Response } from "express";
import { eq, and } from "drizzle-orm";
import * as schema from "@gusto/db-schema/local";
import { db } from "../db/index.js";
import { requireAuth } from "../middleware/auth.js";
import {
  issueSessionToken,
  getLockoutSeconds,
  recordFailedAttempt,
  clearAttempts,
} from "../services/session.service.js";

const router = Router();

/** Lower number = less privilege. Unknown roles rank lowest. */
const ROLE_RANK: Record<string, number> = {
  KITCHEN: 1,
  WAITER: 2,
  CAPTAIN: 2,
  CASHIER: 3,
  MANAGER: 4,
  POS_ADMIN: 5,
  ADMIN: 5,
  OWNER: 6,
  SUPER_ADMIN: 7,
};

function clientKey(req: Request): string {
  return `ip:${req.ip ?? req.socket.remoteAddress ?? "unknown"}`;
}

/**
 * POST /api/auth/pin-login and POST /api/auth/login
 * Validate a PIN and return the user plus a session token.
 * Body: { pin, userId? }
 */
const handlePinLogin = (req: Request, res: Response) => {
  const body = (req.body ?? {}) as { pin?: unknown; userId?: unknown };
  const pin = typeof body.pin === "string" ? body.pin.trim() : typeof body.pin === "number" ? String(body.pin) : "";
  const userId = typeof body.userId === "string" && body.userId ? body.userId : undefined;

  if (!pin) {
    res.status(400).json({ success: false, message: "PIN is required" });
    return;
  }

  const ipKey = clientKey(req);
  const userKey = userId ? `user:${userId}` : null;
  const wait = Math.max(getLockoutSeconds(ipKey), userKey ? getLockoutSeconds(userKey) : 0);
  if (wait > 0) {
    res.setHeader("Retry-After", String(wait));
    res.status(429).json({
      success: false,
      message: `Too many incorrect PIN attempts. Try again in ${wait} second(s).`,
      retryAfterSeconds: wait,
    });
    return;
  }

  const matches = db
    .select()
    .from(schema.localUsers)
    .where(
      userId
        ? and(eq(schema.localUsers.id, userId), eq(schema.localUsers.pin, pin), eq(schema.localUsers.isActive, true))
        : and(eq(schema.localUsers.pin, pin), eq(schema.localUsers.isActive, true))
    )
    .all();

  if (matches.length === 0) {
    recordFailedAttempt(ipKey);
    if (userKey) recordFailedAttempt(userKey);
    res.status(401).json({ success: false, message: "Invalid PIN" });
    return;
  }

  // PIN-only login with a PIN shared by several staff: never guess upwards.
  // Sign in as the least-privileged match so a shared PIN cannot escalate.
  let user = matches[0]!;
  if (matches.length > 1) {
    user = [...matches].sort((a, b) => (ROLE_RANK[a.role] ?? 0) - (ROLE_RANK[b.role] ?? 0))[0]!;
    console.warn(
      `[Auth] PIN is shared by ${matches.length} active users (${matches.map((u) => u.name).join(", ")}). ` +
        `Signed in as ${user.name} (${user.role}). Assign unique PINs in the ERP.`
    );
  }

  clearAttempts(ipKey);
  if (userKey) clearAttempts(userKey);

  const session = issueSessionToken(user.id);
  const userData = { id: user.id, name: user.name, role: user.role };

  res.json({
    success: true,
    data: userData,
    user: userData,
    token: session.token,
    expiresAt: session.expiresAt,
    message: "Login successful",
  });
};

router.post("/pin-login", handlePinLogin);
router.post("/login", handlePinLogin);

/**
 * GET /api/auth/me
 * The user behind the current session token — lets a device confirm its
 * stored session is still valid (user not deactivated, token not expired).
 */
router.get("/me", requireAuth, (req, res) => {
  res.json({ success: true, data: req.currentUser });
});

/**
 * GET /api/auth/users
 * List active local users (login screen chips, waiter / approver pickers).
 * Never includes PINs.
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

  // Deduplicate by user name to avoid duplicate chips in login screen
  const uniqueUsers = Array.from(new Map(users.map((u) => [u.name, u])).values());

  res.json({ success: true, data: uniqueUsers });
});

export { router as authRoutes };
