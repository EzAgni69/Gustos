/**
 * KDS-TV — Offline Bump Queue
 *
 * Persists KOT status bumps in localStorage when the network is down.
 * On reconnect, flushes the queue by retrying each PATCH request.
 * Max 5 retries per item before moving to a dead-letter log.
 *
 * Uses localStorage (not IndexedDB) for simplicity — the queue is
 * small (< 50 items) and JSON serialization is fast enough.
 */

import { useState, useCallback, useRef } from "react";
import type { BumpQueueItem } from "../types";

const STORAGE_KEY = "gusto_kds_bump_queue";
const DEAD_LETTER_KEY = "gusto_kds_bump_dead_letter";
const MAX_RETRIES = 5;

// ─── Persistence Helpers ───

function loadQueue(): BumpQueueItem[] {
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    return stored ? JSON.parse(stored) : [];
  } catch {
    return [];
  }
}

function saveQueue(queue: BumpQueueItem[]): void {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(queue));
}

function appendDeadLetter(item: BumpQueueItem): void {
  try {
    const stored = localStorage.getItem(DEAD_LETTER_KEY);
    const deadLetters: BumpQueueItem[] = stored ? JSON.parse(stored) : [];
    deadLetters.push(item);
    // Keep last 20 dead-letter items
    localStorage.setItem(
      DEAD_LETTER_KEY,
      JSON.stringify(deadLetters.slice(-20))
    );
  } catch {
    // Silent fail — dead letter is best-effort logging
  }
}

// ─── Hook ───

export function useBumpQueue() {
  const [queueLength, setQueueLength] = useState(() => loadQueue().length);
  const flushingRef = useRef(false);

  /**
   * Add a failed bump to the offline queue.
   */
  const enqueue = useCallback(
    (
      kotId: string,
      targetStatus: "PENDING" | "IN_PROGRESS" | "READY" | "SERVED"
    ) => {
      const queue = loadQueue();

      // Deduplicate: if same kotId+status already queued, skip
      const exists = queue.some(
        (item) =>
          item.kotId === kotId && item.targetStatus === targetStatus
      );
      if (exists) return;

      // If same kotId with different status, replace (latest intent wins)
      const filtered = queue.filter((item) => item.kotId !== kotId);

      const newItem: BumpQueueItem = {
        kotId,
        targetStatus,
        timestamp: new Date().toISOString(),
        retryCount: 0,
      };

      const updated = [...filtered, newItem];
      saveQueue(updated);
      setQueueLength(updated.length);

      console.log(
        `[BumpQueue] Enqueued: ${kotId} → ${targetStatus} (${updated.length} in queue)`
      );
    },
    []
  );

  /**
   * Flush all pending bumps by sending them to the POS server.
   * Called on socket reconnect.
   */
  const flush = useCallback(
    async (serverUrl: string, authToken?: string) => {
      if (flushingRef.current) return; // Prevent concurrent flushes
      flushingRef.current = true;

      const queue = loadQueue();
      if (queue.length === 0) {
        flushingRef.current = false;
        return;
      }

      console.log(`[BumpQueue] Flushing ${queue.length} pending bumps...`);

      const remaining: BumpQueueItem[] = [];

      for (const item of queue) {
        try {
          const headers: Record<string, string> = {
            "Content-Type": "application/json",
          };
          if (authToken) {
            headers["Authorization"] = `Bearer ${authToken}`;
          }

          const res = await fetch(
            `${serverUrl}/api/kots/${item.kotId}/status`,
            {
              method: "PATCH",
              headers,
              body: JSON.stringify({ status: item.targetStatus }),
            }
          );

          if (res.ok) {
            console.log(
              `[BumpQueue] ✅ Flushed: ${item.kotId} → ${item.targetStatus}`
            );
            // Success — don't add to remaining
          } else {
            // Server rejected — retry or dead-letter
            item.retryCount++;
            if (item.retryCount >= MAX_RETRIES) {
              console.warn(
                `[BumpQueue] 💀 Dead-lettered: ${item.kotId} after ${MAX_RETRIES} retries`
              );
              appendDeadLetter(item);
            } else {
              remaining.push(item);
            }
          }
        } catch {
          // Network still down — keep in queue
          item.retryCount++;
          if (item.retryCount >= MAX_RETRIES) {
            console.warn(
              `[BumpQueue] 💀 Dead-lettered: ${item.kotId} after ${MAX_RETRIES} retries`
            );
            appendDeadLetter(item);
          } else {
            remaining.push(item);
          }
        }
      }

      saveQueue(remaining);
      setQueueLength(remaining.length);

      if (remaining.length > 0) {
        console.log(`[BumpQueue] ${remaining.length} items still pending`);
      } else {
        console.log(`[BumpQueue] ✅ Queue fully flushed`);
      }

      flushingRef.current = false;
    },
    []
  );

  /**
   * Get the current queue for debugging/display.
   */
  const getQueue = useCallback((): BumpQueueItem[] => {
    return loadQueue();
  }, []);

  return {
    queueLength,
    enqueue,
    flush,
    getQueue,
  };
}
