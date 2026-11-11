/**
 * Gusto POS Local Server — Sessions & PIN attempt limiting
 *
 * LAN devices (POS UI, Captain app) log in with a staff PIN and receive a
 * signed session token, sent back as `Authorization: Bearer <token>`.
 *
 * Tokens are stateless (HMAC-SHA256 over the payload) so they survive server
 * restarts and need no session table. The signing secret is generated once and
 * kept in the local database; set POS_SESSION_SECRET to pin it explicitly.
 * A user who is deactivated in the ERP loses access on the next request,
 * because the middleware re-checks the user row every time.
 */

import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import { eq } from "drizzle-orm";
import * as schema from "@gusto/db-schema/local";
import { db } from "../db/index.js";

const SECRET_META_ID = "session-secret";
const DEFAULT_TTL_HOURS = 24 * 7;

let cachedSecret: Buffer | null = null;

function getSecret(): Buffer {
  if (cachedSecret) return cachedSecret;

  const fromEnv = process.env.POS_SESSION_SECRET?.trim();
  if (fromEnv) {
    cachedSecret = Buffer.from(fromEnv, "utf8");
    return cachedSecret;
  }

  const row = db.select().from(schema.syncMeta).where(eq(schema.syncMeta.id, SECRET_META_ID)).get();
  if (row?.lastSyncTimestamp) {
    cachedSecret = Buffer.from(row.lastSyncTimestamp, "hex");
    return cachedSecret;
  }

  const secret = randomBytes(32);
  db.insert(schema.syncMeta)
    .values({ id: SECRET_META_ID, lastSyncTimestamp: secret.toString("hex"), updatedAt: new Date().toISOString() })
    .onConflictDoNothing()
    .run();
  // Re-read in case another process won the insert
  const stored = db.select().from(schema.syncMeta).where(eq(schema.syncMeta.id, SECRET_META_ID)).get();
  cachedSecret = stored?.lastSyncTimestamp ? Buffer.from(stored.lastSyncTimestamp, "hex") : secret;
  return cachedSecret;
}

function sign(body: string): string {
  return createHmac("sha256", getSecret()).update(body).digest("base64url");
}

function ttlMs(): number {
  const hours = Number(process.env.POS_SESSION_TTL_HOURS);
  return (Number.isFinite(hours) && hours > 0 ? hours : DEFAULT_TTL_HOURS) * 3_600_000;
}

export function issueSessionToken(userId: string): { token: string; expiresAt: string } {
  const exp = Date.now() + ttlMs();
  const body = Buffer.from(JSON.stringify({ uid: userId, exp }), "utf8").toString("base64url");
  return { token: `${body}.${sign(body)}`, expiresAt: new Date(exp).toISOString() };
}

/** Returns the user id a token was issued for, or null if it is invalid or expired. */
export function verifySessionToken(token: string | undefined | null): string | null {
  if (!token) return null;
  const dot = token.indexOf(".");
  if (dot <= 0 || dot === token.length - 1) return null;

  const body = token.slice(0, dot);
  const given = Buffer.from(token.slice(dot + 1), "utf8");
  const expected = Buffer.from(sign(body), "utf8");
  if (given.length !== expected.length || !timingSafeEqual(given, expected)) return null;

  try {
    const payload = JSON.parse(Buffer.from(body, "base64url").toString("utf8")) as { uid?: unknown; exp?: unknown };
    if (typeof payload.uid !== "string" || typeof payload.exp !== "number") return null;
    if (payload.exp < Date.now()) return null;
    return payload.uid;
  } catch {
    return null;
  }
}

// ─── PIN attempt limiting ───
// A 4-digit PIN has only 10,000 combinations, so guessing must be throttled.
// Failures are tracked per client address and per targeted user.

// 8 tries, then a 1-minute pause: a busy counter is barely slowed by a typo,
// while exhausting all PINs would take most of a day.
const MAX_ATTEMPTS = 8;
const WINDOW_MS = 5 * 60_000;
const LOCKOUT_MS = 60_000;

interface AttemptState {
  failures: number;
  firstFailureAt: number;
  lockedUntil: number;
}

const attempts = new Map<string, AttemptState>();

/** Seconds the key must still wait, or 0 if it may try now. */
export function getLockoutSeconds(key: string): number {
  const state = attempts.get(key);
  if (!state) return 0;
  const now = Date.now();
  if (state.lockedUntil > now) return Math.ceil((state.lockedUntil - now) / 1000);
  if (now - state.firstFailureAt > WINDOW_MS) attempts.delete(key);
  return 0;
}

export function recordFailedAttempt(key: string): void {
  const now = Date.now();
  let state = attempts.get(key);
  if (!state || now - state.firstFailureAt > WINDOW_MS) {
    state = { failures: 0, firstFailureAt: now, lockedUntil: 0 };
    attempts.set(key, state);
  }
  state.failures++;
  if (state.failures >= MAX_ATTEMPTS) {
    state.lockedUntil = now + LOCKOUT_MS;
    state.failures = 0;
    state.firstFailureAt = now;
  }

  // Keep the map bounded
  if (attempts.size > 5_000) {
    for (const [k, s] of attempts) {
      if (s.lockedUntil < now && now - s.firstFailureAt > WINDOW_MS) attempts.delete(k);
    }
  }
}

export function clearAttempts(key: string): void {
  attempts.delete(key);
}
