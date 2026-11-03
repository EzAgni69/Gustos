import { redisConnection } from "../config/queue.js";

/** Max time an ERP request waits on Redis before giving up on the notification. */
const PUBLISH_TIMEOUT_MS = 2_000;

/**
 * Notify connected POS terminals (via Redis → Socket.IO) that cloud data changed.
 *
 * Never throws and never blocks the caller for long: the Redis connection is
 * configured to retry forever, so without the timeout an ERP save would hang
 * while Redis is down. POS terminals also poll every 60s, so a missed
 * notification only delays the update.
 */
export async function publishSyncUpdate(organizationId: string, outletId: string, eventType: string = "CATALOG_UPDATED") {
  const payload = JSON.stringify({
    eventType,
    organizationId,
    outletId,
    payload: { timestamp: new Date().toISOString() },
  });

  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    await Promise.race([
      redisConnection.publish("sync-events", payload),
      new Promise((_, reject) => {
        timer = setTimeout(() => reject(new Error(`Redis publish timed out after ${PUBLISH_TIMEOUT_MS}ms`)), PUBLISH_TIMEOUT_MS);
      }),
    ]);
  } catch (err) {
    console.error(`[SyncPublisher] Failed to publish ${eventType}:`, err instanceof Error ? err.message : err);
  } finally {
    if (timer) clearTimeout(timer);
  }
}
