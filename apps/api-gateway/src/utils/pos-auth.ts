/**
 * Gusto API Gateway — POS device authentication
 *
 * Outlet POS servers do not log in as a user; they present a pre-shared key
 * (`X-POS-API-Key`). Two configurations are supported:
 *
 *   POS_OUTLET_API_KEYS   "outletId=key,outletId=key"
 *       One key per outlet. A key only works for its own outlet, so a leaked
 *       key (or a compromised till) cannot read or write another outlet's
 *       data. Recommended for multi-outlet / multi-tenant deployments.
 *
 *   POS_API_KEY           a single shared key
 *       Accepted for any outlet. Fine for a single-restaurant deployment.
 *
 * With neither configured the gateway fails closed in production. Outside
 * production (or with ALLOW_INSECURE_POS_SYNC=true) requests are accepted
 * with a warning so local development works without setup.
 */

import { timingSafeEqual } from "node:crypto";
import { eq } from "drizzle-orm";
import * as schema from "@gusto/db-schema/cloud";
import { db } from "../db/index.js";
import { isProduction } from "./env.js";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export const isUuid = (v: unknown): v is string => typeof v === "string" && UUID_RE.test(v);

function safeEqual(a: string, b: string): boolean {
  const ab = Buffer.from(a, "utf8");
  const bb = Buffer.from(b, "utf8");
  return ab.length === bb.length && timingSafeEqual(ab, bb);
}

function parseOutletKeys(): Map<string, string> {
  const map = new Map<string, string>();
  for (const pair of (process.env.POS_OUTLET_API_KEYS ?? "").split(",")) {
    const idx = pair.indexOf("=");
    if (idx <= 0) continue;
    const outletId = pair.slice(0, idx).trim().toLowerCase();
    const key = pair.slice(idx + 1).trim();
    if (isUuid(outletId) && key) map.set(outletId, key);
  }
  return map;
}

let warnedInsecure = false;

export type PosKeyCheck =
  | { ok: true; /** Set when the key is bound to one outlet */ boundOutletId: string | null }
  | { ok: false; status: 401 | 403 | 503; message: string };

/**
 * Check a POS API key, optionally for a specific outlet.
 */
export function checkPosApiKey(apiKey: string | undefined | null, outletId?: string | null): PosKeyCheck {
  const outletKeys = parseOutletKeys();
  const sharedKey = process.env.POS_API_KEY?.trim() || "";
  const key = typeof apiKey === "string" ? apiKey.trim() : "";

  if (outletKeys.size === 0 && !sharedKey) {
    const insecureAllowed = process.env.ALLOW_INSECURE_POS_SYNC === "true" || !isProduction();
    if (!insecureAllowed) {
      return {
        ok: false,
        status: 503,
        message: "POS sync is not configured on the server (set POS_API_KEY or POS_OUTLET_API_KEYS)",
      };
    }
    if (!warnedInsecure) {
      warnedInsecure = true;
      console.warn("[POS Auth] ⚠️ No POS API key configured — accepting unauthenticated POS sync (development only)");
    }
    return { ok: true, boundOutletId: null };
  }

  if (!key) return { ok: false, status: 401, message: "POS API key is required" };

  // Outlet-bound keys take precedence
  for (const [boundOutletId, outletKey] of outletKeys) {
    if (safeEqual(key, outletKey)) {
      if (outletId && outletId.toLowerCase() !== boundOutletId) {
        return { ok: false, status: 403, message: "This POS API key is not valid for the requested outlet" };
      }
      return { ok: true, boundOutletId };
    }
  }

  if (sharedKey && safeEqual(key, sharedKey)) return { ok: true, boundOutletId: null };

  return { ok: false, status: 401, message: "Invalid POS API key" };
}

export interface PosOutletContext {
  outletId: string;
  organizationId: string;
}

const outletCache = new Map<string, { ctx: PosOutletContext | null; expires: number }>();
const OUTLET_CACHE_MS = 60_000;

/** Look up the organization an outlet belongs to (cached briefly). */
export async function resolveOutletContext(outletId: string | undefined | null): Promise<PosOutletContext | null> {
  if (!isUuid(outletId)) return null;
  const id = outletId.toLowerCase();
  const cached = outletCache.get(id);
  if (cached && cached.expires > Date.now()) return cached.ctx;

  const outlet = await db.query.outlets.findFirst({
    where: eq(schema.outlets.id, id),
    columns: { id: true, organizationId: true },
  });
  const ctx = outlet ? { outletId: outlet.id, organizationId: outlet.organizationId } : null;
  outletCache.set(id, { ctx, expires: Date.now() + OUTLET_CACHE_MS });
  if (outletCache.size > 2_000) {
    for (const [k, v] of outletCache) if (v.expires < Date.now()) outletCache.delete(k);
  }
  return ctx;
}
