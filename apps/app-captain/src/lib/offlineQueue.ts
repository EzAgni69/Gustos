/**
 * Gusto Captain — Offline Action Queue
 *
 * Persists failed API actions to AsyncStorage for retry when
 * the captain walks back into Wi-Fi range. Actions include:
 * CREATE_ORDER, ADD_ITEMS, FIRE_KOT, CHECKOUT, and HOLD_ORDER.
 *
 * The queue is auto-drained on socket reconnect (see socket.ts).
 * Max 10 retries per action before marking as FAILED.
 */

import AsyncStorage from "@react-native-async-storage/async-storage";

const QUEUE_KEY = "gusto_captain_offline_queue";
const MAX_RETRIES = 10;

// ─── Types ───

export type OfflineActionType =
  | "CREATE_ORDER"
  | "ADD_ITEMS"
  | "FIRE_KOT"
  | "CHECKOUT"
  | "HOLD_ORDER";

export interface OfflineAction {
  id: string;
  type: OfflineActionType;
  /** The HTTP method (POST, PATCH, etc.) */
  method: string;
  /** The API path (e.g., /api/orders) */
  path: string;
  /** The request body */
  payload: Record<string, unknown>;
  /** A locally-generated ID for optimistic responses */
  localId?: string;
  createdAt: string;
  retryCount: number;
  status: "PENDING" | "FAILED";
  lastError?: string;
}

// ─── Queue Management ───

let cachedQueue: OfflineAction[] | null = null;

async function loadQueue(): Promise<OfflineAction[]> {
  if (cachedQueue !== null) return cachedQueue;
  try {
    const stored = await AsyncStorage.getItem(QUEUE_KEY);
    cachedQueue = stored ? JSON.parse(stored) : [];
    return cachedQueue!;
  } catch {
    cachedQueue = [];
    return [];
  }
}

async function saveQueue(queue: OfflineAction[]): Promise<void> {
  cachedQueue = queue;
  await AsyncStorage.setItem(QUEUE_KEY, JSON.stringify(queue));
}

/**
 * Generate a unique ID for an offline action.
 */
function generateId(): string {
  return `offline-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

/**
 * Enqueue a failed API action for later retry.
 * Returns a local ID for optimistic responses.
 */
export async function enqueueOfflineAction(
  type: OfflineActionType,
  method: string,
  path: string,
  payload: Record<string, unknown>
): Promise<string> {
  const queue = await loadQueue();
  const localId = `local-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;

  const action: OfflineAction = {
    id: generateId(),
    type,
    method,
    path,
    payload,
    localId,
    createdAt: new Date().toISOString(),
    retryCount: 0,
    status: "PENDING",
  };

  queue.push(action);
  await saveQueue(queue);

  console.log(
    `[OfflineQueue] Enqueued: ${type} ${path} (${queue.length} in queue)`
  );

  return localId;
}

/**
 * Drain the offline queue by retrying each action against the API.
 * Called on socket reconnect.
 *
 * @param baseUrl - The POS server base URL (e.g., "http://192.168.1.100:8080")
 * @param userId - Current user ID for X-User-Id header
 */
export async function drainOfflineQueue(
  baseUrl: string,
  userId?: string | null
): Promise<{ synced: number; failed: number; remaining: number }> {
  const queue = await loadQueue();
  const pending = queue.filter((a) => a.status === "PENDING");

  if (pending.length === 0) {
    return { synced: 0, failed: 0, remaining: 0 };
  }

  console.log(`[OfflineQueue] Draining ${pending.length} pending actions...`);

  let synced = 0;
  let failed = 0;
  const updatedQueue: OfflineAction[] = [];

  for (const action of queue) {
    if (action.status !== "PENDING") {
      updatedQueue.push(action); // Keep failed items for user review
      continue;
    }

    try {
      const headers: Record<string, string> = {
        "Content-Type": "application/json",
      };
      if (userId) {
        headers["X-User-Id"] = userId;
      }

      const response = await fetch(`${baseUrl}${action.path}`, {
        method: action.method,
        headers,
        body: JSON.stringify(action.payload),
      });

      if (response.ok) {
        console.log(
          `[OfflineQueue] Synced: ${action.type} ${action.path}`
        );
        synced++;
        // Don't add to updatedQueue — it's been processed
      } else {
        action.retryCount++;
        if (action.retryCount >= MAX_RETRIES) {
          console.warn(
            `[OfflineQueue] Max retries reached: ${action.type} ${action.path}`
          );
          action.status = "FAILED";
          action.lastError = `HTTP ${response.status}: ${response.statusText}`;
          failed++;
        }
        updatedQueue.push(action);
      }
    } catch (err) {
      // Network still down
      action.retryCount++;
      if (action.retryCount >= MAX_RETRIES) {
        action.status = "FAILED";
        action.lastError = String(err);
        failed++;
      }
      updatedQueue.push(action);
    }
  }

  await saveQueue(updatedQueue);

  const remaining = updatedQueue.filter((a) => a.status === "PENDING").length;
  console.log(
    `[OfflineQueue] Done: ${synced} synced, ${failed} failed, ${remaining} remaining`
  );

  return { synced, failed, remaining };
}

/**
 * Get the count of pending actions in the queue.
 */
export async function getOfflineQueueCount(): Promise<number> {
  const queue = await loadQueue();
  return queue.filter((a) => a.status === "PENDING").length;
}

/**
 * Get all queue items (for debugging / UI display).
 */
export async function getOfflineQueue(): Promise<OfflineAction[]> {
  return await loadQueue();
}

/**
 * Clear all successfully synced / failed items from the queue.
 */
export async function clearCompletedActions(): Promise<void> {
  const queue = await loadQueue();
  const pending = queue.filter((a) => a.status === "PENDING");
  await saveQueue(pending);
}

/**
 * Remove a specific action from the queue (e.g., user discards a failed action).
 */
export async function removeAction(actionId: string): Promise<void> {
  const queue = await loadQueue();
  await saveQueue(queue.filter((a) => a.id !== actionId));
}
