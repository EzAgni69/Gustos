/**
 * Gusto POS Local Server — Auth Middleware
 *
 * Staff devices authenticate with a session token obtained from PIN login
 * (`Authorization: Bearer <token>`). The user row is re-read on every request,
 * so deactivating someone in the ERP takes effect immediately.
 *
 * Older Captain/POS builds only send `X-User-Id`. That header is trivially
 * forgeable by anything on the LAN, so it is honoured only when
 * POS_ALLOW_LEGACY_AUTH=true is set explicitly (for a staged rollout).
 */

import type { Request, Response, NextFunction } from "express";
import { eq } from "drizzle-orm";
import * as schema from "@gusto/db-schema/local";
import { db } from "../db/index.js";
import { verifySessionToken } from "../services/session.service.js";

export interface LocalUser {
  id: string;
  name: string;
  role: string;
  isActive: boolean;
}

// Extend Express Request to include currentUser
declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      currentUser?: LocalUser;
    }
  }
}

/** Roles allowed to approve money-sensitive actions (voids, discounts, shift close). */
export const MANAGER_ROLES = ["SUPER_ADMIN", "ADMIN", "POS_ADMIN", "OWNER", "MANAGER"] as const;
/** Roles allowed to take payments and run the cash drawer. */
export const CASHIER_ROLES = [...MANAGER_ROLES, "CASHIER"] as const;

const allowLegacyAuth = () => process.env.POS_ALLOW_LEGACY_AUTH === "true";

function loadActiveUser(userId: string): LocalUser | undefined {
  const row = db.select().from(schema.localUsers).where(eq(schema.localUsers.id, userId)).get();
  if (!row || !row.isActive) return undefined;
  return { id: row.id, name: row.name, role: row.role, isActive: row.isActive };
}

function bearerToken(req: Request): string | null {
  const header = req.headers.authorization;
  if (typeof header !== "string") return null;
  const match = /^Bearer\s+(.+)$/i.exec(header.trim());
  return match ? match[1]!.trim() : null;
}

/**
 * Attach `req.currentUser` when the request carries valid credentials.
 * Never rejects — route guards decide what needs a user.
 */
export function authMiddleware(req: Request, _res: Response, next: NextFunction): void {
  try {
    const token = bearerToken(req);
    const tokenUserId = verifySessionToken(token);
    if (tokenUserId) {
      req.currentUser = loadActiveUser(tokenUserId);
    } else if (!token && allowLegacyAuth()) {
      const legacyId = req.headers["x-user-id"];
      if (typeof legacyId === "string" && legacyId) {
        req.currentUser = loadActiveUser(legacyId);
      }
    }
  } catch (err) {
    console.error("[Auth] Failed to resolve user:", err instanceof Error ? err.message : err);
  }
  next();
}

/**
 * Middleware that requires a specific role.
 */
export function requireRole(...roles: readonly string[]) {
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
export function requireAuth(req: Request, res: Response, next: NextFunction): void {
  if (!req.currentUser) {
    res.status(401).json({ success: false, message: "Authentication required" });
    return;
  }
  next();
}
