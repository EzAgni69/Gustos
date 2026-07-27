/**
 * Gusto POS Local Server — PIN Auth Middleware
 *
 * Simple auth middleware for the local POS. Checks X-User-Id header
 * against the local_users SQLite table.
 */

import type { Request, Response, NextFunction } from "express";
import { eq } from "drizzle-orm";
import * as schema from "@gusto/db-schema/local";
import { db } from "../db/index.js";

export interface LocalUser {
  id: string;
  name: string;
  role: string;
  isActive: boolean;
}

// Extend Express Request to include currentUser
declare global {
  namespace Express {
    interface Request {
      currentUser?: LocalUser;
    }
  }
}

/**
 * Middleware that checks X-User-Id header and attaches user to request.
 * For the local POS, this is a lightweight auth — no JWT needed.
 */
export function authMiddleware(
  req: Request,
  res: Response,
  next: NextFunction
): void {
  const userId = req.headers["x-user-id"] as string | undefined;

  if (!userId) {
    // Allow unauthenticated access for some routes
    next();
    return;
  }

  const user = db.query.localUsers.findFirst({
    where: eq(schema.localUsers.id, userId),
  });

  // Drizzle better-sqlite3 returns synchronously via .get()
  // but findFirst returns a promise-like. Use select instead.
  const result = db
    .select()
    .from(schema.localUsers)
    .where(eq(schema.localUsers.id, userId))
    .get();

  if (result && result.isActive) {
    req.currentUser = {
      id: result.id,
      name: result.name,
      role: result.role,
      isActive: result.isActive,
    };
  }

  next();
}

/**
 * Middleware that requires a specific role.
 */
export function requireRole(...roles: string[]) {
  return (req: Request, res: Response, next: NextFunction): void => {
    if (!req.currentUser) {
      res.status(401).json({ success: false, message: "Authentication required" });
      return;
    }

    if (!roles.includes(req.currentUser.role)) {
      res.status(403).json({ success: false, message: "Insufficient permissions" });
      return;
    }

    next();
  };
}

/**
 * Middleware that requires any authenticated user.
 */
export function requireAuth(
  req: Request,
  res: Response,
  next: NextFunction
): void {
  if (!req.currentUser) {
    res.status(401).json({ success: false, message: "Authentication required" });
    return;
  }
  next();
}
