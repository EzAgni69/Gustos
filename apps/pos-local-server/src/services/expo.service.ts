/**
 * Gusto POS Local Server — Station readiness & Expo (pass) service
 *
 * A KOT can span several kitchen stations (Pizza Oven + Pasta & Starters).
 * Each station bumps only its own part; the KOT turns READY once every
 * required station is done. The Expo screen sees whole table orders with a
 * per-station checklist and sends the finished order out for pickup, which
 * notifies the Captain app / POS.
 */

import { and, eq, inArray, isNull } from "drizzle-orm";
import { v4 as uuid } from "uuid";
import * as schema from "@gusto/db-schema/local";
import { KDS_STATIONS, getItemStationId, getRequiredStations, getStationConfig } from "@gusto/api-contracts";
import { db } from "../db/index.js";
import { atomicFn } from "../db/tx.js";
import { listKOTs, updateKOTStatus } from "./kot.service.js";
import { getOrderChannel } from "./order-channel.js";
import {
  emitKOTStationStatus,
  emitExpoOrderReady,
  emitExpoOrderRecalled,
  emitOrderUpdated,
} from "../socket/events.js";

type KOTStatus = "PENDING" | "IN_PROGRESS" | "READY" | "SERVED";
const EXPO_KOT_STATUSES: KOTStatus[] = ["PENDING", "IN_PROGRESS", "READY"];

// ─── Helpers ───

function readyRowsFor(kotIds: string[]) {
  if (kotIds.length === 0) return new Map<string, Map<string, string>>();
  const rows = db.select().from(schema.kotStationStatus).where(inArray(schema.kotStationStatus.kotId, kotIds)).all();
  const map = new Map<string, Map<string, string>>();
  for (const row of rows) {
    const perKot = map.get(row.kotId) ?? new Map<string, string>();
    perKot.set(row.stationId, row.readyAt);
    map.set(row.kotId, perKot);
  }
  return map;
}

/** Live (non-voided) items of one KOT with category, for station routing. */
function getKOTRoutingItems(kotId: string) {
  return db
    .select({
      name: schema.kotItems.menuItemName,
      itemStatus: schema.orderItems.status,
      categoryId: schema.menuItems.categoryId,
    })
    .from(schema.kotItems)
    .leftJoin(schema.orderItems, eq(schema.orderItems.id, schema.kotItems.orderItemId))
    .leftJoin(schema.menuItems, eq(schema.menuItems.id, schema.orderItems.menuItemId))
    .where(eq(schema.kotItems.kotId, kotId))
    .all()
    .filter((i) => i.itemStatus !== "VOIDED");
}

function loadKOT(kotId: string) {
  const kot = db.select().from(schema.kitchenOrderTickets).where(eq(schema.kitchenOrderTickets.id, kotId)).get();
  if (!kot) throw new Error("KOT not found");
  return kot;
}

function stationStateFor(kotId: string, kot: { station: string | null; status: string }) {
  const required = getRequiredStations({ station: kot.station, items: getKOTRoutingItems(kotId) });
  const rows = readyRowsFor([kotId]).get(kotId) ?? new Map();
  const readyStations = kot.status === "READY" || kot.status === "SERVED" ? required : required.filter((s) => rows.has(s));
  return { required, readyStations };
}

type ListedKOT = { id: string; status: string; station: string | null; items: { menuItemName: string; categoryId?: string | null }[] };

/** Adapt a listKOTs() KOT to the shared station-routing shape. */
function requiredStationsOf(kot: ListedKOT): string[] {
  return getRequiredStations({
    station: kot.station,
    items: kot.items.map((i) => ({ name: i.menuItemName, categoryId: i.categoryId })),
  });
}

/** Station ids that have marked this KOT ready (all of them once the KOT is READY). */
export function getReadyStationsMap(kots: ListedKOT[]) {
  const rows = readyRowsFor(kots.map((k) => k.id));
  const result = new Map<string, string[]>();
  for (const kot of kots) {
    const required = requiredStationsOf(kot);
    const done = rows.get(kot.id) ?? new Map();
    result.set(kot.id, kot.status === "READY" || kot.status === "SERVED" ? required : required.filter((s) => done.has(s)));
  }
  return result;
}

// ─── Station bumps ───

/**
 * A station marks its part of a KOT ready. When every required station is
 * done the KOT itself becomes READY (which also drives order READY).
 */
export const markStationReady = atomicFn(function markStationReady(kotId: string, stationId: string) {
  if (!getStationConfig(stationId)) throw new Error(`Unknown station: ${stationId}`);
  const kot = loadKOT(kotId);
  if (kot.status === "CANCELLED") throw new Error("KOT is cancelled");

  const { required } = stationStateFor(kotId, kot);
  if (!required.includes(stationId)) {
    throw new Error(`KOT ${kot.kotNumber} has no items for ${getStationConfig(stationId)!.name}`);
  }

  db.insert(schema.kotStationStatus)
    .values({ id: uuid(), kotId, orderId: kot.orderId, stationId, readyAt: new Date().toISOString() })
    .onConflictDoNothing()
    .run();

  const { readyStations } = stationStateFor(kotId, kot);
  const allDone = required.every((s) => readyStations.includes(s));

  if (allDone && kot.status !== "READY" && kot.status !== "SERVED") {
    updateKOTStatus(kotId, "READY");
  } else if (kot.status === "PENDING") {
    // Some of the kitchen is already done — the ticket is clearly being worked on
    updateKOTStatus(kotId, "IN_PROGRESS");
  }

  const payload = {
    kotId,
    kotNumber: kot.kotNumber,
    orderId: kot.orderId,
    stationId,
    requiredStations: required,
    readyStations: allDone ? required : readyStations,
    kotReady: allDone,
  };
  emitKOTStationStatus(payload);
  return payload;
});

/** Undo a station bump (station-level recall from KDS history). */
export const recallStation = atomicFn(function recallStation(kotId: string, stationId: string) {
  const kot = loadKOT(kotId);
  const required = getRequiredStations({ station: kot.station, items: getKOTRoutingItems(kotId) });

  // A whole-KOT READY implies every station; recalling one station leaves the others done.
  if (kot.status === "READY" || kot.status === "SERVED") {
    const now = new Date().toISOString();
    for (const s of required) {
      if (s === stationId) continue;
      db.insert(schema.kotStationStatus)
        .values({ id: uuid(), kotId, orderId: kot.orderId, stationId: s, readyAt: now })
        .onConflictDoNothing()
        .run();
    }
  }

  db.delete(schema.kotStationStatus)
    .where(and(eq(schema.kotStationStatus.kotId, kotId), eq(schema.kotStationStatus.stationId, stationId)))
    .run();

  if (kot.expoBumpedAt) {
    db.update(schema.kitchenOrderTickets).set({ expoBumpedAt: null }).where(eq(schema.kitchenOrderTickets.id, kotId)).run();
  }
  if (kot.status === "READY" || kot.status === "SERVED") {
    updateKOTStatus(kotId, "IN_PROGRESS");
  }

  const { readyStations } = stationStateFor(kotId, { ...kot, status: "IN_PROGRESS" });
  const payload = {
    kotId,
    kotNumber: kot.kotNumber,
    orderId: kot.orderId,
    stationId,
    requiredStations: required,
    readyStations,
    kotReady: false,
  };
  emitKOTStationStatus(payload);
  return payload;
});

/**
 * Whole-KOT status reset (KDS "ALL" recall / POS): station marks no longer apply.
 */
export const resetStationStatus = atomicFn(function resetStationStatus(kotId: string) {
  db.delete(schema.kotStationStatus).where(eq(schema.kotStationStatus.kotId, kotId)).run();
  db.update(schema.kitchenOrderTickets).set({ expoBumpedAt: null }).where(eq(schema.kitchenOrderTickets.id, kotId)).run();
});

// ─── Expo board ───

export type ExpoStationState = "READY" | "COOKING" | "QUEUED";

export function getExpoBoard() {
  const kots = EXPO_KOT_STATUSES.flatMap((s) => listKOTs(s)).filter((k) => !k.expoBumpedAt);
  if (kots.length === 0) return [];

  const readyMap = getReadyStationsMap(kots);

  const orderIds = [...new Set(kots.map((k) => k.orderId))];
  const orders = db.select().from(schema.orders).where(inArray(schema.orders.id, orderIds)).all();
  const orderById = new Map(orders.map((o) => [o.id, o]));

  const grouped = new Map<string, typeof kots>();
  for (const kot of kots) {
    const order = orderById.get(kot.orderId);
    if (!order || order.status === "CANCELLED" || order.status === "MERGED") continue;
    const list = grouped.get(kot.orderId) ?? [];
    list.push(kot);
    grouped.set(kot.orderId, list);
  }

  const board = [...grouped.entries()].map(([orderId, orderKots]) => {
    const order = orderById.get(orderId)!;
    orderKots.sort((a, b) => a.createdAt.localeCompare(b.createdAt));

    const stations = KDS_STATIONS.map((st) => {
      const involved = orderKots.filter((k) => requiredStationsOf(k).includes(st.id));
      if (involved.length === 0) return null;
      const readyKots = involved.filter((k) => readyMap.get(k.id)!.includes(st.id));
      const state: ExpoStationState =
        readyKots.length === involved.length ? "READY" : involved.some((k) => k.status !== "PENDING") ? "COOKING" : "QUEUED";
      const items = involved.flatMap((k) => {
        const pinned = k.station?.toLowerCase() === st.id;
        return k.items
          .filter((i) => pinned || getItemStationId({ name: i.menuItemName, categoryId: i.categoryId }) === st.id)
          .map((i) => ({
            name: i.menuItemName,
            variantName: i.variantName,
            quantity: i.quantity,
            modifiers: i.modifiers as string[],
            notes: i.notes,
            kotNumber: k.kotNumber,
            ready: readyMap.get(k.id)!.includes(st.id),
          }));
      });
      return {
        stationId: st.id,
        name: st.name,
        icon: st.icon,
        state,
        readyKots: readyKots.length,
        totalKots: involved.length,
        items,
      };
    }).filter((s): s is NonNullable<typeof s> => s !== null);

    const allReady = stations.length > 0 && stations.every((s) => s.state === "READY");

    return {
      orderId,
      orderNumber: order.orderNumber,
      tableName: orderKots[0]!.tableName ?? null,
      ...getOrderChannel(order),
      waiterId: order.waiterId,
      waiterName: order.waiterName,
      paxCount: order.paxCount,
      isRush: orderKots.some((k) => k.isRush),
      kotIds: orderKots.map((k) => k.id),
      kotNumbers: orderKots.map((k) => k.kotNumber),
      firstFiredAt: orderKots[0]!.createdAt,
      stations,
      readyStations: stations.filter((s) => s.state === "READY").length,
      allReady,
    };
  });

  // Rush first, then oldest ticket first
  return board.sort(
    (a, b) => Number(b.isRush) - Number(a.isRush) || a.firstFiredAt.localeCompare(b.firstFiredAt)
  );
}

export type ExpoOrder = ReturnType<typeof getExpoBoard>[number];

// ─── Expo bump / recall ───

function logEvent(orderId: string, eventType: string, payload: Record<string, unknown>, userId?: string) {
  db.insert(schema.eventLog)
    .values({ id: uuid(), orderId, eventType, payload: JSON.stringify(payload), userId, createdAt: new Date().toISOString() })
    .run();
}

/**
 * The pass sends the whole table order out. Requires every station to be
 * ready unless `force` (expediter override, e.g. a station forgot to bump).
 */
export const bumpExpoOrder = atomicFn(function bumpExpoOrder(orderId: string, options: { force?: boolean } = {}, userId?: string) {
  const entry = getExpoBoard().find((o) => o.orderId === orderId);
  if (!entry) throw new Error("Order is not on the pass");
  if (!entry.allReady && !options.force) {
    const waiting = entry.stations.filter((s) => s.state !== "READY").map((s) => s.name);
    throw new Error(`Still waiting on: ${waiting.join(", ")}`);
  }

  if (options.force) {
    for (const kotId of entry.kotIds) {
      const kot = loadKOT(kotId);
      if (kot.status !== "READY" && kot.status !== "SERVED") updateKOTStatus(kotId, "READY");
    }
  }

  const bumpedAt = new Date().toISOString();
  db.update(schema.kitchenOrderTickets)
    .set({ expoBumpedAt: bumpedAt })
    .where(and(inArray(schema.kitchenOrderTickets.id, entry.kotIds), isNull(schema.kitchenOrderTickets.expoBumpedAt)))
    .run();

  const itemCount = entry.stations.reduce((n, s) => n + s.items.reduce((m, i) => m + i.quantity, 0), 0);
  const payload = {
    orderId,
    orderNumber: entry.orderNumber,
    tableName: entry.tableName,
    orderMode: entry.orderMode,
    platform: entry.platform,
    waiterId: entry.waiterId,
    waiterName: entry.waiterName,
    kotNumbers: entry.kotNumbers,
    itemCount,
    stations: entry.stations.map((s) => s.name),
    forced: !!options.force,
    bumpedAt,
  };

  logEvent(orderId, "EXPO_BUMPED", { kotNumbers: entry.kotNumbers, itemCount, forced: !!options.force }, userId);
  emitExpoOrderReady(payload);
  emitOrderUpdated({ type: "EXPO_ORDER_READY", orderId, orderNumber: entry.orderNumber });
  return payload;
});

/** Bring the most recently bumped batch of an order back onto the pass. */
export const recallExpoOrder = atomicFn(function recallExpoOrder(orderId: string, userId?: string) {
  const kots = db
    .select()
    .from(schema.kitchenOrderTickets)
    .where(eq(schema.kitchenOrderTickets.orderId, orderId))
    .all()
    .filter((k) => k.expoBumpedAt);
  if (kots.length === 0) throw new Error("Nothing to recall for this order");

  const latest = kots.reduce((max, k) => (k.expoBumpedAt! > max ? k.expoBumpedAt! : max), "");
  const ids = kots.filter((k) => k.expoBumpedAt === latest).map((k) => k.id);
  db.update(schema.kitchenOrderTickets).set({ expoBumpedAt: null }).where(inArray(schema.kitchenOrderTickets.id, ids)).run();

  const order = db.select().from(schema.orders).where(eq(schema.orders.id, orderId)).get();
  logEvent(orderId, "EXPO_RECALLED", { kotIds: ids }, userId);
  const tableName = order?.tableId
    ? db.select().from(schema.diningTables).where(eq(schema.diningTables.id, order.tableId)).get()?.name ?? null
    : null;
  const payload = { orderId, orderNumber: order?.orderNumber ?? "", tableName };
  emitExpoOrderRecalled(payload);
  return payload;
});

/** Orders sent out from the pass recently (Expo history / recall list). */
export function getRecentExpoBumps(limit = 20) {
  const kots = db
    .select()
    .from(schema.kitchenOrderTickets)
    .all()
    .filter((k) => k.expoBumpedAt)
    .sort((a, b) => b.expoBumpedAt!.localeCompare(a.expoBumpedAt!));

  const seen = new Map<string, { orderId: string; bumpedAt: string; kotNumbers: string[] }>();
  for (const k of kots) {
    const key = `${k.orderId}|${k.expoBumpedAt}`;
    const entry = seen.get(key) ?? { orderId: k.orderId, bumpedAt: k.expoBumpedAt!, kotNumbers: [] };
    entry.kotNumbers.push(k.kotNumber);
    seen.set(key, entry);
    if (seen.size > limit) break;
  }
  const entries = [...seen.values()].slice(0, limit);
  const orders = entries.length
    ? db.select().from(schema.orders).where(inArray(schema.orders.id, [...new Set(entries.map((e) => e.orderId))])).all()
    : [];
  const tables = db.select().from(schema.diningTables).all();
  return entries.map((e) => {
    const order = orders.find((o) => o.id === e.orderId);
    return {
      ...e,
      orderNumber: order?.orderNumber ?? "",
      tableName: order?.tableId ? tables.find((t) => t.id === order.tableId)?.name ?? null : null,
      ...getOrderChannel(order),
      waiterName: order?.waiterName ?? null,
    };
  });
}
