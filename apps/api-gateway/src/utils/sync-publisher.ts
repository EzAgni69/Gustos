import { redisConnection } from "../config/queue.js";

export async function publishSyncUpdate(organizationId: string, outletId: string, eventType: string = "CATALOG_UPDATED") {
  try {
    const payload = JSON.stringify({
      eventType,
      organizationId,
      outletId,
      payload: { timestamp: new Date().toISOString() }
    });
    await redisConnection.publish("sync-events", payload);
  } catch (err) {
    console.error("[SyncPublisher] Failed to publish sync update:", err);
  }
}
