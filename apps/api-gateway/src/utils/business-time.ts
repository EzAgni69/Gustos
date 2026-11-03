/**
 * Gusto API Gateway — Business-day time helpers
 *
 * Report date filters ("today", 2026-11-01 … 2026-11-03) mean the restaurant's
 * local calendar days, not the server's. Servers usually run in UTC, so without
 * this an IST day would be cut at 05:30. All helpers return real UTC instants,
 * which drizzle stores/compares consistently with `timestamp` columns.
 */

import { eq } from "drizzle-orm";
import * as cloudSchema from "@gusto/db-schema/cloud";
import { db } from "../db/index.js";

const DEFAULT_TZ = process.env.BUSINESS_TIMEZONE || "Asia/Kolkata";
const CACHE_MS = 5 * 60_000;
const tzCache = new Map<string, { tz: string; at: number }>();

function isValidTimeZone(tz: string): boolean {
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: tz });
    return true;
  } catch {
    return false;
  }
}

/** The organization's configured time zone (cached), falling back to BUSINESS_TIMEZONE / Asia/Kolkata. */
export async function getOrgTimeZone(organizationId: string): Promise<string> {
  const cached = tzCache.get(organizationId);
  if (cached && Date.now() - cached.at < CACHE_MS) return cached.tz;
  let tz = DEFAULT_TZ;
  try {
    const org = await db.query.organizations.findFirst({
      where: eq(cloudSchema.organizations.id, organizationId),
      columns: { timezone: true },
    });
    if (org?.timezone && isValidTimeZone(org.timezone)) tz = org.timezone;
  } catch {
    // keep default
  }
  tzCache.set(organizationId, { tz, at: Date.now() });
  return tz;
}

/** Offset (ms) of `tz` from UTC at the given instant. */
function tzOffsetMs(instant: number, tz: string): number {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: tz,
    hourCycle: "h23",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  }).formatToParts(new Date(instant));
  const get = (t: string) => Number(parts.find((p) => p.type === t)?.value);
  const asUtc = Date.UTC(get("year"), get("month") - 1, get("day"), get("hour"), get("minute"), get("second"));
  return asUtc - Math.floor(instant / 1000) * 1000;
}

/** UTC instant of local midnight on `ymd` (YYYY-MM-DD) in `tz`. */
export function startOfLocalDay(ymd: string, tz: string): Date {
  const [y, m, d] = ymd.split("-").map(Number) as [number, number, number];
  const guess = Date.UTC(y, m - 1, d);
  let result = guess - tzOffsetMs(guess, tz);
  // Re-evaluate once in case midnight falls on the other side of a DST change
  result = guess - tzOffsetMs(result, tz);
  return new Date(result);
}

function addDays(ymd: string, days: number): string {
  const [y, m, d] = ymd.split("-").map(Number) as [number, number, number];
  return new Date(Date.UTC(y, m - 1, d + days)).toISOString().slice(0, 10);
}

/** Half-open UTC range [start, endExclusive) covering local days startYmd … endYmd. */
export function localDayRange(startYmd: string, endYmd: string, tz: string): { start: Date; endExclusive: Date } {
  return { start: startOfLocalDay(startYmd, tz), endExclusive: startOfLocalDay(addDays(endYmd, 1), tz) };
}

/** Local calendar date (YYYY-MM-DD) of an instant in `tz`. */
export function localDateKey(date: Date, tz: string): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: tz, year: "numeric", month: "2-digit", day: "2-digit" }).format(date);
}

/** Today's local date (YYYY-MM-DD) in `tz`. */
export function localToday(tz: string): string {
  return localDateKey(new Date(), tz);
}

/** Local date (YYYY-MM-DD) of the Sunday starting the week containing `date`. */
export function localWeekStartKey(date: Date, tz: string): string {
  const ymd = localDateKey(date, tz);
  const [y, m, d] = ymd.split("-").map(Number) as [number, number, number];
  const dow = new Date(Date.UTC(y, m - 1, d)).getUTCDay();
  return addDays(ymd, -dow);
}
