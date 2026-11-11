/**
 * Gusto Captain — Offline Action Queue
 *
 * Persists failed API actions to AsyncStorage for retry when
 * the captain walks back into Wi-Fi range. Actions include:
 * CREATE_ORDER, ADD_ITEMS, FIRE_KOT, CHECKOUT, and HOLD_ORDER.
 *
 * The queue is auto-drained on socket reconnect (see socket.ts), in order.
 * See drainOfflineQueue for the retry / failure rules.
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

// ─── Temporary → real order ids ───
// An order created offline is known by a temporary "local-…" id. Once its
// CREATE_ORDER syncs, later queued actions (add items, fire KOT, checkout) and
// any screen still holding the temporary id must be pointed at the real order.

const ID_MAP_KEY = "gusto_captain_offline_id_map";
let idMap: Record<string, string> = {};
let idMapLoaded = false;

async function loadIdMap(): Promise<void> {
  if (idMapLoaded) return;
  try {
    const stored = await AsyncStorage.getItem(ID_MAP_KEY);
    idMap = stored ? JSON.parse(stored) : {};
  } catch {
    idMap = {};
  }
  idMapLoaded = true;
}

async function rememberId(localId: string, realId: string): Promise<void> {
  idMap[localId] = realId;
  // Keep the map small — only recent offline orders matter
  const keys = Object.keys(idMap);
  if (keys.length > 200) {
    for (const k of keys.slice(0, keys.length - 200)) delete idMap[k];
  }
  await AsyncStorage.setItem(ID_MAP_KEY, JSON.stringify(idMap)).catch(() => {});
}

/** Replace any temporary order id in an API path with the real id, once known. */
export function resolveLocalIds(path: string): string {
  if (!path.includes("local-")) return path;
  let resolved = path;
  for (const [localId, realId] of Object.entries(idMap)) {
    if (resolved.includes(localId)) resolved = resolved.split(localId).join(realId);
  }
  return resolved;
}

/** The real order id for a temporary one, if it has synced. */
export function getSyncedOrderId(localId: string): string | undefined {
  return idMap[localId];
}

// Load the map as soon as the module is used
loadIdMap().catch(() => {});

let isDraining = false;

/**
 * Drain the offline queue by replaying each action against the API, in the
 * order the captain performed them. Called on socket (re)connect.
 *
 *  - Success                → removed from the queue.
 *  - Server unreachable     → stop; everything stays queued, nothing is counted.
 *  - Session rejected (401) → stop; the captain signs in again and the queue resumes.
 *  - Server said no (4xx)   → the action can never succeed: marked FAILED for
 *                             review, along with later actions on the same
 *                             unsynced order.
 *  - Server error (5xx)     → stop and retry later, up to MAX_RETRIES.
 *
 * @param baseUrl - The POS server base URL (e.g., "http://192.168.1.100:8080")
 * @param auth - Session token (and user id for older servers)
 */
export async function drainOfflineQueue(
  baseUrl: string,
  auth?: { token?: string | null; userId?: string | null } | string | null
): Promise<{ synced: number; failed: number; remaining: number }> {
  if (isDraining) return { synced: 0, failed: 0, remaining: await getOfflineQueueCount() };
  isDraining = true;

  try {
    await loadIdMap();
    const queue = await loadQueue();
    if (!queue.some((a) => a.status === "PENDING")) {
      return { synced: 0, failed: 0, remaining: 0 };
    }

    const credentials = typeof auth === "string" ? { userId: auth } : auth ?? {};
    if (!credentials.token) {
      // Not signed in — the server would reject everything. Keep the queue.
      return { synced: 0, failed: 0, remaining: queue.filter((a) => a.status === "PENDING").length };
    }

    console.log(`[OfflineQueue] Draining ${queue.filter((a) => a.status === "PENDING").length} pending actions...`);

    let synced = 0;
    let failed = 0;
    let stopped = false;
    const updatedQueue: OfflineAction[] = [];
    /** Temporary order ids whose creation failed for good */
    const deadLocalIds = new Set<string>();

    for (const action of queue) {
      if (action.status !== "PENDING" || stopped) {
        updatedQueue.push(action); // Keep failed items for user review
        continue;
      }

      // Its order was never created — it cannot succeed either
      const deadParent = [...deadLocalIds].find((id) => action.path.includes(id));
      if (deadParent) {
        action.status = "FAILED";
        action.lastError = "The order this belongs to could not be created";
        failed++;
        updatedQueue.push(action);
        continue;
      }

      // Waiting on an order that has not synced yet (should not happen in order, but be safe)
      const path = resolveLocalIds(action.path);
      if (path.includes("local-")) {
        updatedQueue.push(action);
        continue;
      }

      const headers: Record<string, string> = {
        "Content-Type": "application/json",
        Authorization: `Bearer ${credentials.token}`,
      };
      if (credentials.userId) headers["X-User-Id"] = credentials.userId;

      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 15_000);
      try {
        const response = await fetch(`${baseUrl}${path}`, {
          method: action.method,
          headers,
          body: JSON.stringify(action.payload),
          signal: controller.signal,
        });

        if (response.ok) {
          if (action.type === "CREATE_ORDER" && action.localId) {
            const body = await response.json().catch(() => null);
            const realId = body?.data?.id;
            if (typeof realId === "string") await rememberId(action.localId, realId);
          }
          synced++;
          // Not kept — it has been processed
          continue;
        }

        const body = await response.json().catch(() => null);
        const message = body?.message || `HTTP ${response.status}`;

        if (response.status === 401) {
          stopped = true; // session expired — resume after sign-in
          updatedQueue.push(action);
        } else if (response.status >= 500 || response.status === 429 || response.status === 408) {
          action.retryCount++;
          action.lastError = message;
          if (action.retryCount >= MAX_RETRIES) {
            action.status = "FAILED";
            failed++;
            if (action.type === "CREATE_ORDER" && action.localId) deadLocalIds.add(action.localId);
          } else {
            stopped = true;
          }
          updatedQueue.push(action);
        } else {
          // The server understood and refused — retrying will not help
          action.status = "FAILED";
          action.lastError = message;
          failed++;
          if (action.type === "CREATE_ORDER" && action.localId) deadLocalIds.add(action.localId);
          updatedQueue.push(action);
        }
      } catch {
        // Still offline — keep everything, in order, for the next reconnect
        stopped = true;
        updatedQueue.push(action);
      } finally {
        clearTimeout(timer);
      }
    }

    await saveQueue(updatedQueue);

    const remaining = updatedQueue.filter((a) => a.status === "PENDING").length;
    console.log(`[OfflineQueue] Done: ${synced} synced, ${failed} failed, ${remaining} remaining`);

    return { synced, failed, remaining };
  } finally {
    isDraining = false;
  }
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
