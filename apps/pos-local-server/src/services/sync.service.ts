/**
 * Gusto POS Local Server — Sync Service
 *
 * Manages the sync outbox queue. Events are written to SQLite
 * and periodically pushed to the cloud API gateway.
 */

import { eq } from "drizzle-orm";
import { v4 as uuid } from "uuid";
import * as schema from "@gusto/db-schema/local";
import { db } from "../db/index.js";

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
}

/**
 * Get all unsynced events ordered by creation time.
 */
export function getUnsyncedEvents(limit: number = 50) {
  return db
    .select()
    .from(schema.syncOutbox)
    .where(eq(schema.syncOutbox.status, "PENDING"))
    .orderBy(schema.syncOutbox.createdAt)
    .limit(limit)
    .all();
}

/**
 * Mark a sync event as synced.
 */
export function markEventSynced(eventId: string): void {
  db.update(schema.syncOutbox)
    .set({
      status: "SYNCED",
      syncedAt: new Date().toISOString(),
    })
    .where(eq(schema.syncOutbox.id, eventId))
    .run();
}

/**
 * Mark a sync event as failed and increment retry count.
 */
export function markEventFailed(eventId: string): void {
  const event = db
    .select()
    .from(schema.syncOutbox)
    .where(eq(schema.syncOutbox.id, eventId))
    .get();

  if (event) {
    db.update(schema.syncOutbox)
      .set({
        status: "FAILED",
        retryCount: event.retryCount + 1,
      })
      .where(eq(schema.syncOutbox.id, eventId))
      .run();
  }
}

/**
 * Push unsynced events to the cloud API gateway.
 * Returns the number of successfully synced events.
 */
export async function pushToCloud(): Promise<number> {
  const events = getUnsyncedEvents();
  if (events.length === 0) return 0;

  const apiUrl =
    process.env.API_GATEWAY_URL || "http://localhost:3001";

  let syncedCount = 0;

  for (const event of events) {
    try {
      const response = await fetch(`${apiUrl}/api/v1/sync/push`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          events: [
            {
              eventType: event.eventType,
              payload: JSON.parse(event.payload),
              localTimestamp: event.createdAt,
            },
          ],
        }),
      });

      if (response.ok) {
        markEventSynced(event.id);
        syncedCount++;
      } else {
        markEventFailed(event.id);
      }
    } catch {
      // Network error — cloud is unreachable, mark as failed for retry
      markEventFailed(event.id);
    }
  }

  return syncedCount;
}
