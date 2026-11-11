/**
 * Gusto POS Local Server — Day History Service
 *
 * Builds a full picture of one business day from local SQLite:
 * every order created or billed that day (with items, KOTs, invoice and
 * its event-log trail), a sales summary, and a merged activity feed.
 */

import { and, gte, lt, inArray } from "drizzle-orm";
import * as schema from "@gusto/db-schema/local";
import { db } from "../db/index.js";
import { getSettlementLock } from "./settlement.service.js";

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

function parseJson<T>(value: unknown, fallback: T): T {
  if (value == null || value === "") return fallback;
  if (typeof value !== "string") return value as T;
  try {
    return JSON.parse(value) as T;
  } catch {
    return fallback;
  }
}

const round2 = (n: number) => Math.round(n * 100) / 100;

/**
 * Resolve a YYYY-MM-DD date (in the server's local timezone, i.e. the outlet's)
 * into an ISO [start, end) range comparable with stored ISO timestamps.
 */
export function getLocalDayRange(date?: string): { date: string; start: string; end: string } {
  let y: number, m: number, d: number;
  if (date && DATE_RE.test(date)) {
    [y, m, d] = date.split("-").map(Number) as [number, number, number];
  } else {
    const now = new Date();
    y = now.getFullYear();
    m = now.getMonth() + 1;
    d = now.getDate();
  }
  const start = new Date(y, m - 1, d, 0, 0, 0, 0);
  const end = new Date(y, m - 1, d + 1, 0, 0, 0, 0);
  const label = `${y}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
  return { date: label, start: start.toISOString(), end: end.toISOString() };
}

export function getDayHistory(date?: string) {
  const range = getLocalDayRange(date);

  // Orders created today, plus older orders that were billed today.
  const createdToday = db
    .select()
    .from(schema.orders)
    .where(and(gte(schema.orders.createdAt, range.start), lt(schema.orders.createdAt, range.end)))
    .all();

  const invoicesToday = db
    .select()
    .from(schema.invoices)
    .where(and(gte(schema.invoices.createdAt, range.start), lt(schema.invoices.createdAt, range.end)))
    .all();

  const orderIds = new Set(createdToday.map((o) => o.id));
  const carriedOverIds = invoicesToday.map((i) => i.orderId).filter((id) => !orderIds.has(id));
  const carriedOver = carriedOverIds.length
    ? db.select().from(schema.orders).where(inArray(schema.orders.id, carriedOverIds)).all()
    : [];

  const orders = [...createdToday, ...carriedOver];
  const ids = orders.map((o) => o.id);

  if (ids.length === 0) {
    return { ...range, summary: emptySummary(), orders: [], activity: [] };
  }

  const items = db.select().from(schema.orderItems).where(inArray(schema.orderItems.orderId, ids)).all();
  const kots = db
    .select()
    .from(schema.kitchenOrderTickets)
    .where(inArray(schema.kitchenOrderTickets.orderId, ids))
    .all();
  const invoices = db.select().from(schema.invoices).where(inArray(schema.invoices.orderId, ids)).all();
  const events = db.select().from(schema.eventLog).where(inArray(schema.eventLog.orderId, ids)).all();
  const tables = db.select().from(schema.diningTables).all();
  const users = db.select({ id: schema.localUsers.id, name: schema.localUsers.name }).from(schema.localUsers).all();

  const tableName = new Map(tables.map((t) => [t.id, t.name]));
  const userName = new Map(users.map((u) => [u.id, u.name]));

  const groupBy = <T extends { orderId: string }>(rows: T[]) => {
    const map = new Map<string, T[]>();
    for (const row of rows) {
      const list = map.get(row.orderId);
      if (list) list.push(row);
      else map.set(row.orderId, [row]);
    }
    return map;
  };

  const itemsByOrder = groupBy(items);
  const kotsByOrder = groupBy(kots);
  const eventsByOrder = groupBy(events);
  // If an order somehow has multiple invoices, keep the latest one.
  const invoiceByOrder = new Map<string, (typeof invoices)[number]>();
  for (const inv of invoices) {
    const prev = invoiceByOrder.get(inv.orderId);
    if (!prev || prev.createdAt < inv.createdAt) invoiceByOrder.set(inv.orderId, inv);
  }

  const historyOrders = orders
    .map((order) => {
      const orderItems = (itemsByOrder.get(order.id) ?? []).map((item) => ({
        ...item,
        modifiers: parseJson<string[]>(item.modifiers, []),
        addOns: parseJson<{ name: string; quantity: number; unitPrice: number; amount: number }[]>(item.addOns, []),
      }));
      const orderKots = (kotsByOrder.get(order.id) ?? []).sort((a, b) => a.createdAt.localeCompare(b.createdAt));
      const orderEvents = (eventsByOrder.get(order.id) ?? [])
        .sort((a, b) => a.createdAt.localeCompare(b.createdAt))
        .map((e) => ({
          id: e.id,
          eventType: e.eventType,
          payload: parseJson<Record<string, unknown>>(e.payload, {}),
          userId: e.userId,
          userName: e.userId ? userName.get(e.userId) ?? null : null,
          createdAt: e.createdAt,
        }));
      const invoice = invoiceByOrder.get(order.id) ?? null;

      return {
        ...order,
        tableName: order.tableId ? tableName.get(order.tableId) ?? null : null,
        tokenNumbers: parseJson<number[]>(order.tokenNumbers, []),
        paymentSplits: parseJson<{ mode: string; subMethod?: string; amount: number }[]>(order.paymentSplits, []),
        items: orderItems,
        kots: orderKots,
        invoice: invoice
          ? { ...invoice, paymentSplits: parseJson<{ mode: string; amount: number }[]>(invoice.paymentSplits, []) }
          : null,
        events: orderEvents,
        carriedOver: !orderIds.has(order.id),
        // Why post-settlement edits (payment correction / void) are blocked, if they are.
        settlementLock: order.status === "COMPLETED" && invoice?.isPaid ? getSettlementLock(invoice.createdAt) : null,
      };
    })
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt));

  // ─── Summary ───
  const summary = emptySummary();
  for (const order of historyOrders) {
    summary.totalOrders += 1;
    summary.byStatus[order.status] = (summary.byStatus[order.status] ?? 0) + 1;
    summary.byOrderMode[order.orderMode] = (summary.byOrderMode[order.orderMode] ?? 0) + 1;
    summary.kotCount += order.kots.filter((k) => k.kotType !== "CANCELLATION").length;

    for (const item of order.items) {
      if (item.status === "VOIDED") {
        summary.voidedItems += item.quantity;
        summary.voidedValue += item.quantity * item.unitPrice;
      }
    }

    if (order.status === "CANCELLED") summary.cancelledOrders += 1;
    if (order.isComplimentary) summary.complimentaryOrders += 1;

    const inv = order.invoice;
    // Only count sales billed within this day.
    if (inv && inv.isPaid && order.status === "COMPLETED" && inv.createdAt >= range.start && inv.createdAt < range.end) {
      summary.billedOrders += 1;
      summary.netSales += inv.totalAmount;
      summary.subtotal += inv.subtotal;
      summary.discount += inv.discountAmount;
      summary.tax += inv.cgstAmount + inv.sgstAmount;
      summary.tips += inv.tipAmount;

      if (inv.paymentSplits.length > 0) {
        for (const split of inv.paymentSplits) {
          const mode = (split.mode || "OTHER").toUpperCase();
          summary.byPaymentMode[mode] = (summary.byPaymentMode[mode] ?? 0) + Number(split.amount || 0);
        }
      } else {
        const mode = (inv.paymentMode || "OTHER").toUpperCase();
        summary.byPaymentMode[mode] = (summary.byPaymentMode[mode] ?? 0) + inv.totalAmount;
      }
    } else if (!["COMPLETED", "CANCELLED", "MERGED"].includes(order.status)) {
      summary.openOrders += 1;
      summary.openValue += order.totalAmount;
    }
  }
  summary.avgTicket = summary.billedOrders ? summary.netSales / summary.billedOrders : 0;
  for (const key of ["netSales", "subtotal", "discount", "tax", "tips", "voidedValue", "openValue", "avgTicket"] as const) {
    summary[key] = round2(summary[key]);
  }
  for (const key of Object.keys(summary.byPaymentMode)) {
    summary.byPaymentMode[key] = round2(summary.byPaymentMode[key]!);
  }

  // ─── Activity feed (events that happened within the day) ───
  const activity = historyOrders
    .flatMap((order) =>
      order.events
        .filter((e) => e.createdAt >= range.start && e.createdAt < range.end)
        .map((e) => ({
          ...e,
          orderId: order.id,
          orderNumber: order.orderNumber,
          tableName: order.tableName,
          orderMode: order.orderMode,
        }))
    )
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt));

  return { ...range, summary, orders: historyOrders, activity };
}

function emptySummary() {
  return {
    totalOrders: 0,
    billedOrders: 0,
    openOrders: 0,
    openValue: 0,
    cancelledOrders: 0,
    complimentaryOrders: 0,
    netSales: 0,
    subtotal: 0,
    discount: 0,
    tax: 0,
    tips: 0,
    avgTicket: 0,
    kotCount: 0,
    voidedItems: 0,
    voidedValue: 0,
    byStatus: {} as Record<string, number>,
    byOrderMode: {} as Record<string, number>,
    byPaymentMode: {} as Record<string, number>,
  };
}
