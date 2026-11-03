/**
 * Gusto Sync Worker — ID Resolution Helpers
 *
 * Local POS IDs are not guaranteed to exist in the cloud (legacy seed IDs like
 * "item-201" / "table-ac-1", or menu rows re-created in the ERP). Querying a uuid
 * column with a non-UUID string throws 22P02 and a missing FK target throws 23503,
 * either of which would fail the entire job — so resolve defensively.
 */

import { eq, and } from "drizzle-orm";
import { db } from "../db.js";
import * as schema from "@gusto/db-schema/cloud";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export const isUuid = (v: unknown): v is string => typeof v === "string" && UUID_RE.test(v);

export const DEFAULT_OUTLET_ID = "00000000-0000-0000-0000-000000000003";
export const DEFAULT_ORG_ID = "00000000-0000-0000-0000-000000000001";

export async function resolveDiningTable(outletId: string, tableId?: string | null, tableName?: string | null) {
  let table = null;
  if (isUuid(tableId)) {
    table = await db.query.diningTables.findFirst({ where: eq(schema.diningTables.id, tableId) });
  }
  if (!table && tableName) {
    table = await db.query.diningTables.findFirst({
      where: and(eq(schema.diningTables.outletId, outletId), eq(schema.diningTables.name, tableName)),
    });
  }
  return table ?? null;
}

export async function resolveMenuItemId(outletId: string, menuItemId?: string | null, menuItemName?: string | null): Promise<string | null> {
  if (isUuid(menuItemId)) {
    const byId = await db.query.menuItems.findFirst({ where: eq(schema.menuItems.id, menuItemId) });
    if (byId) return byId.id;
  }
  if (menuItemName) {
    const byName = await db.query.menuItems.findFirst({
      where: and(eq(schema.menuItems.outletId, outletId), eq(schema.menuItems.name, menuItemName)),
    });
    if (byName) return byName.id;
  }
  return null;
}
