/**
 * Gusto POS Local Server — Cloud Sync Service
 *
 * Periodically pulls updates from the cloud API gateway and
 * applies them to the local SQLite database. This enables
 * menu, table, user, and outlet config changes made in the
 * web-admin to propagate to the local POS.
 *
 * Sync interval is configurable via CLOUD_SYNC_INTERVAL_MS env var.
 * Default: 60 seconds.
 *
 * Mode: Permissive — if the cloud is unreachable, the POS continues
 * operating with its cached local data.
 */

import { eq } from "drizzle-orm";
import * as schema from "@gusto/db-schema/local";
import { db } from "../db/index.js";

const OUTLET_ID = process.env.OUTLET_ID || "local-outlet";
const ORGANIZATION_ID = process.env.ORGANIZATION_ID || "";
const API_GATEWAY_URL = process.env.API_GATEWAY_URL || "http://localhost:3001";
const POS_API_KEY = process.env.POS_API_KEY || "";
const SYNC_INTERVAL_MS = Number(process.env.CLOUD_SYNC_INTERVAL_MS ?? 60_000);

let syncIntervalHandle: ReturnType<typeof setInterval> | null = null;
let isSyncing = false;

// Callback to notify connected devices when data changes
let onSyncComplete: ((changes: SyncChangeSummary) => void) | null = null;

export interface SyncChangeSummary {
  menuCategoriesUpdated: number;
  menuItemsUpdated: number;
  diningTablesUpdated: number;
  usersUpdated: number;
  outletConfigUpdated: boolean;
  timestamp: string;
}

/**
 * Get the last sync timestamp from local SQLite.
 */
function getLastSyncTimestamp(): string | null {
  const row = db
    .select()
    .from(schema.syncMeta)
    .where(eq(schema.syncMeta.id, "cloud-pull"))
    .get();

  return row?.lastSyncTimestamp ?? null;
}

/**
 * Update the last sync timestamp in local SQLite.
 */
function setLastSyncTimestamp(timestamp: string): void {
  const existing = db
    .select()
    .from(schema.syncMeta)
    .where(eq(schema.syncMeta.id, "cloud-pull"))
    .get();

  if (existing) {
    db.update(schema.syncMeta)
      .set({ lastSyncTimestamp: timestamp, updatedAt: new Date().toISOString() })
      .where(eq(schema.syncMeta.id, "cloud-pull"))
      .run();
  } else {
    db.insert(schema.syncMeta)
      .values({
        id: "cloud-pull",
        lastSyncTimestamp: timestamp,
        updatedAt: new Date().toISOString(),
      })
      .run();
  }
}

/**
 * Pull updates from the cloud and apply to local SQLite.
 */
export async function pullFromCloud(): Promise<SyncChangeSummary | null> {
  if (isSyncing) {
    console.log("[CloudSync] Sync already in progress, skipping...");
    return null;
  }

  isSyncing = true;

  try {
    const since = getLastSyncTimestamp();
    const queryParams = new URLSearchParams({ outletId: OUTLET_ID });
    if (since) queryParams.set("since", since);

    const headers: Record<string, string> = {
      "Content-Type": "application/json",
    };
    if (POS_API_KEY) {
      headers["X-POS-API-Key"] = POS_API_KEY;
    }

    const response = await fetch(
      `${API_GATEWAY_URL}/api/v1/sync/pull?${queryParams}`,
      { headers, signal: AbortSignal.timeout(10_000) }
    );

    if (!response.ok) {
      console.warn(`[CloudSync] Pull failed with status ${response.status}`);
      return null;
    }

    const result = (await response.json()) as { success: boolean; data: any };
    if (!result.success || !result.data) {
      console.warn("[CloudSync] Pull returned unsuccessful response");
      return null;
    }

    const data = result.data;
    const summary: SyncChangeSummary = {
      menuCategoriesUpdated: 0,
      menuItemsUpdated: 0,
      diningTablesUpdated: 0,
      usersUpdated: 0,
      outletConfigUpdated: false,
      timestamp: data.lastSyncTimestamp,
    };

    // Apply changes in a transaction
    db.transaction((tx) => {
      // 1. Upsert menu categories
      if (data.menuCategories?.length > 0) {
        for (const cat of data.menuCategories) {
          const existing = tx.select().from(schema.menuCategories)
            .where(eq(schema.menuCategories.id, cat.id)).get();
          if (existing) {
            tx.update(schema.menuCategories)
              .set({
                name: cat.name,
                sortOrder: cat.sortOrder,
                isActive: cat.isActive,
              })
              .where(eq(schema.menuCategories.id, cat.id))
              .run();
          } else {
            tx.insert(schema.menuCategories)
              .values({
                id: cat.id,
                outletId: cat.outletId,
                name: cat.name,
                sortOrder: cat.sortOrder,
                isActive: cat.isActive,
              })
              .run();
          }
          summary.menuCategoriesUpdated++;
        }
      }

      // 2. Upsert menu items
      if (data.menuItems?.length > 0) {
        for (const item of data.menuItems) {
          const existing = tx.select().from(schema.menuItems)
            .where(eq(schema.menuItems.id, item.id)).get();
          if (existing) {
            tx.update(schema.menuItems)
              .set({
                categoryId: item.categoryId,
                name: item.name,
                description: item.description,
                price: item.price,
                gstRate: item.gstRate,
                isVeg: item.isVeg,
                isAvailable: item.isAvailable,
                sortOrder: item.sortOrder,
                updatedAt: item.updatedAt,
              })
              .where(eq(schema.menuItems.id, item.id))
              .run();
          } else {
            tx.insert(schema.menuItems)
              .values({
                id: item.id,
                categoryId: item.categoryId,
                outletId: item.outletId,
                name: item.name,
                description: item.description,
                price: item.price,
                gstRate: item.gstRate,
                isVeg: item.isVeg,
                isAvailable: item.isAvailable,
                sortOrder: item.sortOrder,
                createdAt: item.createdAt,
                updatedAt: item.updatedAt,
              })
              .run();
          }
          summary.menuItemsUpdated++;
        }
      }

      // 3. Upsert dining tables
      if (data.diningTables?.length > 0) {
        for (const table of data.diningTables) {
          const existing = tx.select().from(schema.diningTables)
            .where(eq(schema.diningTables.id, table.id)).get();
          if (existing) {
            tx.update(schema.diningTables)
              .set({
                name: table.name,
                capacity: table.capacity,
                section: table.section,
                sortOrder: table.sortOrder,
              })
              .where(eq(schema.diningTables.id, table.id))
              .run();
          } else {
            tx.insert(schema.diningTables)
              .values({
                id: table.id,
                outletId: table.outletId,
                name: table.name,
                capacity: table.capacity,
                status: "AVAILABLE",
                section: table.section,
                sortOrder: table.sortOrder,
              })
              .run();
          }
          summary.diningTablesUpdated++;
        }
      }

      // 4. Upsert local users (PIN-based auth)
      if (data.users?.length > 0) {
        for (const user of data.users) {
          const existing = tx.select().from(schema.localUsers)
            .where(eq(schema.localUsers.id, user.id)).get();
          if (existing) {
            tx.update(schema.localUsers)
              .set({
                name: user.name,
                pin: user.pin ?? "0000",
                role: user.role,
                isActive: user.isActive,
              })
              .where(eq(schema.localUsers.id, user.id))
              .run();
          } else {
            tx.insert(schema.localUsers)
              .values({
                id: user.id,
                name: user.name,
                pin: user.pin ?? "0000",
                role: user.role,
                isActive: user.isActive,
              })
              .run();
          }
          summary.usersUpdated++;
        }
      }

      // 5. Upsert outlet config
      if (data.outletConfig) {
        const cfg = data.outletConfig;
        const existing = tx.select().from(schema.outletConfig)
          .where(eq(schema.outletConfig.outletId, cfg.outletId)).get();
        if (existing) {
          tx.update(schema.outletConfig)
            .set({
              outletName: cfg.outletName,
              address: cfg.address ?? "",
              phone: cfg.phone,
              gstNumber: cfg.gstNumber,
              updatedAt: new Date().toISOString(),
            })
            .where(eq(schema.outletConfig.outletId, cfg.outletId))
            .run();
        } else {
          tx.insert(schema.outletConfig)
            .values({
              id: `config-${cfg.outletId}`,
              outletId: cfg.outletId,
              outletName: cfg.outletName,
              address: cfg.address ?? "",
              phone: cfg.phone,
              gstNumber: cfg.gstNumber,
              updatedAt: new Date().toISOString(),
            })
            .run();
        }
        summary.outletConfigUpdated = true;
      }
    });

    // Update sync timestamp
    setLastSyncTimestamp(data.lastSyncTimestamp);

    const hasChanges =
      summary.menuCategoriesUpdated > 0 ||
      summary.menuItemsUpdated > 0 ||
      summary.diningTablesUpdated > 0 ||
      summary.usersUpdated > 0 ||
      summary.outletConfigUpdated;

    if (hasChanges) {
      console.log(
        `[CloudSync] ✅ Pulled: ${summary.menuItemsUpdated} menu items, ` +
        `${summary.diningTablesUpdated} tables, ${summary.usersUpdated} users`
      );
      // Notify connected devices
      onSyncComplete?.(summary);
    }

    return summary;
  } catch (err) {
    if (err instanceof Error && err.name === "TimeoutError") {
      console.warn("[CloudSync] ⏱️ Cloud API timed out — POS continues with cached data");
    } else {
      console.warn("[CloudSync] ❌ Cloud sync failed:", err instanceof Error ? err.message : err);
    }
    return null;
  } finally {
    isSyncing = false;
  }
}

/**
 * Start the periodic cloud sync poller.
 */
export function startCloudSyncPoller(
  callback?: (changes: SyncChangeSummary) => void
): void {
  if (callback) {
    onSyncComplete = callback;
  }

  console.log(
    `[CloudSync] Starting cloud sync poller (interval: ${SYNC_INTERVAL_MS / 1000}s, outlet: ${OUTLET_ID})`
  );

  // Initial sync after a short delay (let server boot first)
  setTimeout(() => {
    pullFromCloud().catch(() => {});
  }, 5_000);

  // Periodic sync
  syncIntervalHandle = setInterval(() => {
    pullFromCloud().catch(() => {});
  }, SYNC_INTERVAL_MS);
}

/**
 * Stop the cloud sync poller.
 */
export function stopCloudSyncPoller(): void {
  if (syncIntervalHandle) {
    clearInterval(syncIntervalHandle);
    syncIntervalHandle = null;
    console.log("[CloudSync] Poller stopped");
  }
}

/**
 * Trigger an immediate sync (for manual refresh button in POS UI).
 */
export async function triggerManualSync(): Promise<SyncChangeSummary | null> {
  console.log("[CloudSync] Manual sync triggered");
  return pullFromCloud();
}
