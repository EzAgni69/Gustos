/**
 * Gusto POS Local Server — Sync Service
 *
 * Manages the sync outbox queue. Events are written to SQLite
 * and periodically pushed to the cloud API gateway.
 */

import { eq, and, inArray, lt } from "drizzle-orm";
import { v4 as uuid } from "uuid";
import * as schema from "@gusto/db-schema/local";
import { db } from "../db/index.js";
import { flushOutbox } from "./realtime-uplink.service.js";

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

  // Instantly attempt to flush if realtime connection is active
  flushOutbox().catch(console.error);
}

/**
 * Get all unsynced events ordered by creation time.
 */
export function getUnsyncedEvents(limit: number = 50) {
  return db
    .select()
    .from(schema.syncOutbox)
    .where(
      and(
        inArray(schema.syncOutbox.status, ["PENDING", "FAILED"]),
        lt(schema.syncOutbox.retryCount, 10)
      )
    )
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
export function markEventFailed(eventId: string, errorMessage?: string): void {
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
        lastError: errorMessage,
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
  const apiUrl =
    process.env.API_GATEWAY_URL || "http://localhost:3001";

  // Skip if cloud sync is disabled
  if (process.env.CLOUD_SYNC_ENABLED === "false" || !apiUrl) {
    return 0;
  }

  const events = getUnsyncedEvents();
  if (events.length === 0) return 0;

  let syncedCount = 0;

  for (const event of events) {
    try {
      const headers: Record<string, string> = {
        "Content-Type": "application/json",
      };

      const apiKey = process.env.POS_API_KEY;
      if (apiKey) {
        headers["X-POS-API-Key"] = apiKey;
      }
      if (process.env.ORGANIZATION_ID) {
        headers["x-organization-id"] = process.env.ORGANIZATION_ID;
      }
      if (process.env.OUTLET_ID) {
        headers["x-outlet-id"] = process.env.OUTLET_ID;
      }

      const response = await fetch(`${apiUrl}/api/v1/sync/push`, {
        method: "POST",
        headers,
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
        const text = await response.text();
        markEventFailed(event.id, `HTTP ${response.status}: ${text}`);
      }
    } catch (err) {
      // Network error — cloud is unreachable, mark as failed for retry
      markEventFailed(event.id, String(err));
    }
  }

  return syncedCount;
}
