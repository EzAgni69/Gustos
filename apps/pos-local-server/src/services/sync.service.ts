/**
 * Gusto POS Local Server — Sync Service
 *
 * Transactional outbox for everything the POS reports to the cloud. Events are
 * written to SQLite in the same transaction as the change they describe, then
 * pushed to the cloud API gateway in creation order.
 *
 * Delivery rules:
 *  - One push loop at a time (overlapping triggers coalesce into a re-run).
 *  - A network failure stops the run: the cloud is down, later events would
 *    fail too, and order must be preserved. Nothing is counted against them.
 *  - An event the cloud rejects (HTTP 4xx) is retried with backoff and, after
 *    MAX_RETRIES, parked as DEAD so it can never block the queue. Dead events
 *    stay visible in /api/sync/queue and can be requeued.
 *  - Delivered events are pruned after a retention window.
 */

import { eq, and, inArray, lt, sql } from "drizzle-orm";
import { v4 as uuid } from "uuid";
import * as schema from "@gusto/db-schema/local";
import { db } from "../db/index.js";
import { afterCommit } from "../db/tx.js";
import { ORDER_SNAPSHOT_EVENT, markOrderSnapshotPushed } from "./order-sync.service.js";

export const MAX_RETRIES = 10;
const PUSH_TIMEOUT_MS = 15_000;
const BATCH_SIZE = 50;
const SYNCED_RETENTION_DAYS = Number(process.env.SYNC_OUTBOX_RETENTION_DAYS ?? 7);

let isPushing = false;
let pushRequestedWhileBusy = false;

/**
 * Queue a sync event in the outbox for later cloud push.
 */
export function queueSyncEvent(
  eventType: string,
  payload: Record<string, unknown>
): void {
  db.insert(schema.syncOutbox)
    .values({
      id: uuid(),
      eventType,
      payload: JSON.stringify(payload),
      status: "PENDING",
      retryCount: 0,
      createdAt: new Date().toISOString(),
    })
    .run();

  // Push straight away once the surrounding change is committed
  afterCommit(() => {
    import("./realtime-uplink.service.js")
      .then(({ flushOutbox }) => flushOutbox())
      .catch(() => {});
  });
}

/**
 * Events still waiting to reach the cloud, oldest first.
 */
export function getUnsyncedEvents(limit: number = BATCH_SIZE) {
  return db
    .select()
    .from(schema.syncOutbox)
    .where(
      and(
        inArray(schema.syncOutbox.status, ["PENDING", "FAILED"]),
        lt(schema.syncOutbox.retryCount, MAX_RETRIES)
      )
    )
    .orderBy(schema.syncOutbox.createdAt)
    .limit(limit)
    .all();
}

/** Events the cloud kept rejecting — parked so they cannot block the queue. */
export function getDeadEvents(limit: number = BATCH_SIZE) {
  return db
    .select()
    .from(schema.syncOutbox)
    .where(eq(schema.syncOutbox.status, "DEAD"))
    .orderBy(schema.syncOutbox.createdAt)
    .limit(limit)
    .all();
}

export function getOutboxCounts(): { pending: number; failed: number; dead: number } {
  const rows = db
    .select({ status: schema.syncOutbox.status, count: sql<number>`count(*)` })
    .from(schema.syncOutbox)
    .where(inArray(schema.syncOutbox.status, ["PENDING", "FAILED", "DEAD"]))
    .groupBy(schema.syncOutbox.status)
    .all();
  const by = (status: string) => Number(rows.find((r) => r.status === status)?.count ?? 0);
  return { pending: by("PENDING"), failed: by("FAILED"), dead: by("DEAD") };
}

/** Give dead events another round of delivery attempts. Returns how many were requeued. */
export function requeueDeadEvents(): number {
  return db
    .update(schema.syncOutbox)
    .set({ status: "PENDING", retryCount: 0, lastError: null })
    .where(eq(schema.syncOutbox.status, "DEAD"))
    .run().changes;
}

/**
 * Mark a sync event as synced.
 */
export function markEventSynced(eventId: string): void {
  db.update(schema.syncOutbox)
    .set({
      status: "SYNCED",
      syncedAt: new Date().toISOString(),
      lastError: null,
    })
    .where(eq(schema.syncOutbox.id, eventId))
    .run();
}

/**
 * Record a rejected delivery. After MAX_RETRIES the event is parked as DEAD.
 */
export function markEventFailed(eventId: string, errorMessage?: string): void {
  const event = db
    .select()
    .from(schema.syncOutbox)
    .where(eq(schema.syncOutbox.id, eventId))
    .get();
  if (!event) return;

  const retryCount = event.retryCount + 1;
  const dead = retryCount >= MAX_RETRIES;
  db.update(schema.syncOutbox)
    .set({
      status: dead ? "DEAD" : "FAILED",
      retryCount,
      lastError: errorMessage?.slice(0, 1000),
    })
    .where(eq(schema.syncOutbox.id, eventId))
    .run();

  if (dead) {
    console.error(
      `[Sync] ☠️ Event ${event.eventType} (${eventId}) parked after ${retryCount} failed attempts: ${errorMessage ?? "unknown error"}`
    );
  }
}

/** Remember why the cloud could not be reached, without spending a retry. */
function noteTransientFailure(eventId: string, errorMessage: string): void {
  db.update(schema.syncOutbox)
    .set({ lastError: errorMessage.slice(0, 1000) })
    .where(eq(schema.syncOutbox.id, eventId))
    .run();
}

/** Delete delivered events older than the retention window. */
export function pruneSyncedEvents(): number {
  const cutoff = new Date(Date.now() - SYNCED_RETENTION_DAYS * 86_400_000).toISOString();
  return db
    .delete(schema.syncOutbox)
    .where(and(eq(schema.syncOutbox.status, "SYNCED"), lt(schema.syncOutbox.syncedAt, cutoff)))
    .run().changes;
}

function cloudHeaders(): Record<string, string> {
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (process.env.POS_API_KEY) headers["X-POS-API-Key"] = process.env.POS_API_KEY;
  if (process.env.ORGANIZATION_ID) headers["x-organization-id"] = process.env.ORGANIZATION_ID;
  if (process.env.OUTLET_ID) headers["x-outlet-id"] = process.env.OUTLET_ID;
  return headers;
}

/** Exponential backoff between attempts on an event the cloud rejected. */
function isDueForRetry(event: { status: string; retryCount: number; createdAt: string; syncedAt: string | null }, lastAttempt: Map<string, number>, id: string): boolean {
  if (event.status !== "FAILED") return true;
  const last = lastAttempt.get(id);
  if (!last) return true;
  const waitMs = Math.min(2 ** event.retryCount * 5_000, 15 * 60_000);
  return Date.now() - last >= waitMs;
}

const lastAttemptAt = new Map<string, number>();

/**
 * Push unsynced events to the cloud API gateway.
 * Returns the number of successfully synced events.
 */
export async function pushToCloud(): Promise<number> {
  const apiUrl = process.env.API_GATEWAY_URL || "http://localhost:3001";

  if (process.env.CLOUD_SYNC_ENABLED === "false" || !apiUrl) {
    return 0;
  }

  if (isPushing) {
    pushRequestedWhileBusy = true;
    return 0;
  }
  isPushing = true;

  let syncedCount = 0;
  try {
    let cloudReachable = true;
    while (cloudReachable) {
      pushRequestedWhileBusy = false;
      const events = getUnsyncedEvents().filter((e) => isDueForRetry(e, lastAttemptAt, e.id));
      if (events.length === 0) break;

      for (const event of events) {
        let payload: unknown;
        try {
          payload = JSON.parse(event.payload);
        } catch {
          // Corrupt row — can never be delivered
          db.update(schema.syncOutbox)
            .set({ status: "DEAD", lastError: "Payload is not valid JSON" })
            .where(eq(schema.syncOutbox.id, event.id))
            .run();
          continue;
        }

        lastAttemptAt.set(event.id, Date.now());
        try {
          const response = await fetch(`${apiUrl}/api/v1/sync/push`, {
            method: "POST",
            headers: cloudHeaders(),
            body: JSON.stringify({
              events: [
                {
                  id: event.id,
                  eventType: event.eventType,
                  payload,
                  localTimestamp: event.createdAt,
                },
              ],
            }),
            signal: AbortSignal.timeout(PUSH_TIMEOUT_MS),
          });

          if (response.ok) {
            markEventSynced(event.id);
            lastAttemptAt.delete(event.id);
            if (event.eventType === ORDER_SNAPSHOT_EVENT) {
              markOrderSnapshotPushed(event.payload);
            }
            syncedCount++;
          } else if (response.status >= 500 || response.status === 429 || response.status === 408) {
            // Cloud is unhealthy or throttling — not this event's fault
            noteTransientFailure(event.id, `HTTP ${response.status}`);
            cloudReachable = false;
            break;
          } else {
            const text = await response.text().catch(() => "");
            markEventFailed(event.id, `HTTP ${response.status}: ${text}`);
          }
        } catch (err) {
          // Network error / timeout — cloud unreachable, keep order and retry later
          noteTransientFailure(event.id, String(err));
          cloudReachable = false;
          break;
        }
      }

      // Loop again only if more arrived meanwhile or the batch was full
      if (!pushRequestedWhileBusy && events.length < BATCH_SIZE) break;
    }
  } finally {
    isPushing = false;
  }

  return syncedCount;
}
