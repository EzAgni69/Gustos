/**
 * Gusto API Gateway — Tally Accounting Export
 *
 * Builds a Tally-compatible (Tally Prime / ERP 9) XML import file containing a
 * daily sales summary for one outlet: one Sales voucher per order type.
 *
 * Each voucher:
 *   Dr  Payment ledgers (Cash / Card / UPI / …)        = amount collected
 *   Cr  Sales @<rate>% ledgers                         = taxable value per GST rate
 *   Cr  Output CGST / Output SGST / Output IGST        = tax per core-logic engine
 *   Cr/Dr  Round Off                                    = billed total − computed total
 *
 * Tally sign convention: debit amounts are negative with ISDEEMEDPOSITIVE=Yes,
 * credit amounts are positive with ISDEEMEDPOSITIVE=No. Every voucher nets to 0.
 *
 * The ledgers and voucher types named below must exist in the Tally company
 * (voucher types as children of "Sales"); Tally rejects vouchers that refer to
 * missing masters.
 */

import { and, eq, gte, lt } from "drizzle-orm";
import {
  calculateGSTSplit,
  getStateCodeFromGSTIN,
  resolveGSTSupplyType,
  roundCurrency,
  type GSTRate,
  type GSTSupplyType,
} from "@gusto/core-logic";
import * as schema from "@gusto/db-schema/cloud";
import { db } from "../db/index.js";
import { getOrgTimeZone, localDayRange } from "../utils/business-time.js";

// ─── Mapping configuration ───

export type GustoOrderMode = (typeof schema.orderModeEnum.enumValues)[number];

/** Gusto order type → Tally voucher type (create these under "Sales" in Tally). */
export const TALLY_VOUCHER_TYPE_MAP: Record<GustoOrderMode, { voucherType: string; code: string }> = {
  DINE_IN: { voucherType: "Sales - Dine In", code: "DI" },
  TAKEAWAY: { voucherType: "Sales - Takeaway", code: "TA" },
  DELIVERY: { voucherType: "Sales - Delivery", code: "DL" },
  ONLINE: { voucherType: "Sales - Online", code: "ON" },
};

/** Gusto payment mode → Tally ledger debited for the collection. */
export const TALLY_PAYMENT_LEDGER_MAP: Record<string, string> = {
  CASH: "Cash",
  CARD: "Card Receivable",
  UPI: "UPI Receivable",
  ONLINE: "Online Aggregator Receivable",
  OTHER: "Other Receivable",
};
const UNPAID_LEDGER = "Sundry Debtors - Walk-in";

export const TALLY_LEDGERS = {
  sales: (rate: GSTRate) => (rate === "0" ? "Sales - GST Exempt" : `Sales @${rate}%`),
  cgst: "Output CGST",
  sgst: "Output SGST",
  igst: "Output IGST",
  roundOff: "Round Off",
};

// ─── Summary model ───

export interface TallyVoucherSummary {
  orderMode: GustoOrderMode;
  voucherType: string;
  voucherNumber: string;
  remoteId: string;
  orderCount: number;
  firstOrderNumber: string;
  lastOrderNumber: string;
  /** Payment ledger → amount collected */
  payments: Map<string, number>;
  /** GST rate → taxable value / tax */
  taxByRate: Map<GSTRate, { taxable: number; cgst: number; sgst: number; igst: number }>;
  billedTotal: number;
  roundOff: number;
}

export interface TallyDailySummary {
  outlet: { id: string; name: string; gstNumber: string | null };
  date: string; // YYYY-MM-DD (business-local)
  supplyType: GSTSupplyType;
  vouchers: TallyVoucherSummary[];
}

type OrderWithItems = typeof schema.orders.$inferSelect & {
  items: (typeof schema.orderItems.$inferSelect)[];
};

function parseJsonArray<T>(raw: string | null | undefined): T[] {
  if (!raw) return [];
  try {
    const v = JSON.parse(raw);
    return Array.isArray(v) ? (v as T[]) : [];
  } catch {
    return [];
  }
}

function itemGrossAmount(item: typeof schema.orderItems.$inferSelect): number {
  let total = roundCurrency(Number(item.unitPrice) * item.quantity);
  for (const addOn of parseJsonArray<{ unitPrice?: number; quantity?: number }>(item.addOns)) {
    total += roundCurrency(Number(addOn.unitPrice ?? 0) * Number(addOn.quantity ?? 1));
  }
  return total;
}

/** Split an order's collected amount across payment ledgers. */
function paymentLegs(order: OrderWithItems): [string, number][] {
  const total = Number(order.totalAmount);
  if (order.paymentMode === "SPLIT") {
    const splits = parseJsonArray<{ mode?: string; amount?: number }>(order.paymentSplits);
    if (splits.length > 0) {
      const legs: [string, number][] = splits.map((s) => [
        TALLY_PAYMENT_LEDGER_MAP[s.mode ?? ""] ?? TALLY_PAYMENT_LEDGER_MAP.OTHER!,
        Number(s.amount ?? 0),
      ]);
      // Absorb any paise drift between splits and the bill into the first leg
      const drift = roundCurrency(total - legs.reduce((s, [, a]) => s + a, 0));
      if (drift !== 0 && legs[0]) legs[0][1] = roundCurrency(legs[0][1] + drift);
      return legs;
    }
  }
  const ledger = order.paymentMode
    ? TALLY_PAYMENT_LEDGER_MAP[order.paymentMode] ?? TALLY_PAYMENT_LEDGER_MAP.OTHER!
    : UNPAID_LEDGER;
  return [[ledger, total]];
}

/**
 * Aggregate completed orders into per-order-type voucher summaries.
 * GST is recomputed per order using the core-logic engine: taxable value per
 * rate = item gross × (1 − order discount share), mirroring calculateCartTotals.
 */
export function summarizeOrders(
  orders: OrderWithItems[],
  ctx: { outletId: string; date: string; supplyType: GSTSupplyType }
): TallyVoucherSummary[] {
  const byMode = new Map<GustoOrderMode, TallyVoucherSummary>();
  const ymd = ctx.date.replace(/-/g, "");
  const outletCode = ctx.outletId.slice(0, 8).toUpperCase();

  const sorted = [...orders].sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime());

  for (const order of sorted) {
    const mapping = TALLY_VOUCHER_TYPE_MAP[order.orderMode];
    let v = byMode.get(order.orderMode);
    if (!v) {
      v = {
        orderMode: order.orderMode,
        voucherType: mapping.voucherType,
        voucherNumber: `${outletCode}/${ymd}/${mapping.code}`,
        remoteId: `gusto-${ctx.outletId}-${ctx.date}-${order.orderMode}`,
        orderCount: 0,
        firstOrderNumber: order.orderNumber,
        lastOrderNumber: order.orderNumber,
        payments: new Map(),
        taxByRate: new Map(),
        billedTotal: 0,
        roundOff: 0,
      };
      byMode.set(order.orderMode, v);
    }

    v.orderCount += 1;
    v.lastOrderNumber = order.orderNumber;
    v.billedTotal = roundCurrency(v.billedTotal + Number(order.totalAmount));

    for (const [ledger, amount] of paymentLegs(order)) {
      v.payments.set(ledger, roundCurrency((v.payments.get(ledger) ?? 0) + amount));
    }

    // Per-rate taxable value after proportional discount
    const gross = order.items.reduce((s, i) => s + itemGrossAmount(i), 0);
    const discount = Number(order.discountAmount);
    const ratio = gross > 0 ? Math.max(0, gross - discount) / gross : 0;
    const taxableByRate = new Map<GSTRate, number>();
    for (const item of order.items) {
      const taxable = roundCurrency(itemGrossAmount(item) * ratio);
      taxableByRate.set(item.gstRate, (taxableByRate.get(item.gstRate) ?? 0) + taxable);
    }

    for (const [rate, taxable] of taxableByRate) {
      const split = calculateGSTSplit(taxable, rate, ctx.supplyType);
      const acc = v.taxByRate.get(rate) ?? { taxable: 0, cgst: 0, sgst: 0, igst: 0 };
      acc.taxable = roundCurrency(acc.taxable + split.taxableAmount);
      acc.cgst = roundCurrency(acc.cgst + split.cgst);
      acc.sgst = roundCurrency(acc.sgst + split.sgst);
      acc.igst = roundCurrency(acc.igst + split.igst);
      v.taxByRate.set(rate, acc);
    }
  }

  // Round-off balances computed (taxable + tax) against what was actually billed
  for (const v of byMode.values()) {
    let computed = 0;
    for (const t of v.taxByRate.values()) computed += t.taxable + t.cgst + t.sgst + t.igst;
    v.roundOff = roundCurrency(v.billedTotal - computed);
  }

  const order: GustoOrderMode[] = ["DINE_IN", "TAKEAWAY", "DELIVERY", "ONLINE"];
  return order.flatMap((m) => (byMode.has(m) ? [byMode.get(m)!] : []));
}

// ─── XML rendering ───

function xmlEscape(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

function ledgerEntry(ledgerName: string, amount: number, isDebit: boolean, isParty = false): string {
  const signed = isDebit ? -Math.abs(amount) : Math.abs(amount);
  return [
    "      <ALLLEDGERENTRIES.LIST>",
    `       <LEDGERNAME>${xmlEscape(ledgerName)}</LEDGERNAME>`,
    `       <ISDEEMEDPOSITIVE>${isDebit ? "Yes" : "No"}</ISDEEMEDPOSITIVE>`,
    `       <ISPARTYLEDGER>${isParty ? "Yes" : "No"}</ISPARTYLEDGER>`,
    `       <AMOUNT>${signed.toFixed(2)}</AMOUNT>`,
    "      </ALLLEDGERENTRIES.LIST>",
  ].join("\n");
}

function renderVoucher(v: TallyVoucherSummary, summary: TallyDailySummary): string {
  const ymd = summary.date.replace(/-/g, "");
  const entries: string[] = [];

  // Debits: collections by payment ledger
  const paymentEntries = [...v.payments.entries()].filter(([, a]) => a !== 0);
  for (const [ledger, amount] of paymentEntries) {
    entries.push(ledgerEntry(ledger, amount, amount > 0, true));
  }

  // Credits: sales and output tax per rate
  let cgst = 0;
  let sgst = 0;
  let igst = 0;
  const rates = [...v.taxByRate.keys()].sort((a, b) => Number(a) - Number(b));
  for (const rate of rates) {
    const t = v.taxByRate.get(rate)!;
    if (t.taxable !== 0) entries.push(ledgerEntry(TALLY_LEDGERS.sales(rate), t.taxable, false));
    cgst += t.cgst;
    sgst += t.sgst;
    igst += t.igst;
  }
  if (roundCurrency(cgst) !== 0) entries.push(ledgerEntry(TALLY_LEDGERS.cgst, roundCurrency(cgst), false));
  if (roundCurrency(sgst) !== 0) entries.push(ledgerEntry(TALLY_LEDGERS.sgst, roundCurrency(sgst), false));
  if (roundCurrency(igst) !== 0) entries.push(ledgerEntry(TALLY_LEDGERS.igst, roundCurrency(igst), false));

  // Positive round-off → extra credit; negative → debit
  if (v.roundOff !== 0) entries.push(ledgerEntry(TALLY_LEDGERS.roundOff, v.roundOff, v.roundOff < 0));

  const partyLedger = paymentEntries[0]?.[0] ?? TALLY_PAYMENT_LEDGER_MAP.CASH!;
  const narration =
    `Gusto daily sales summary — ${summary.outlet.name} — ${v.voucherType} — ${summary.date}. ` +
    `${v.orderCount} order(s), ${v.firstOrderNumber} to ${v.lastOrderNumber}.`;

  return [
    "    <TALLYMESSAGE xmlns:UDF=\"TallyUDF\">",
    `     <VOUCHER REMOTEID="${xmlEscape(v.remoteId)}" VCHTYPE="${xmlEscape(v.voucherType)}" ACTION="Create" OBJVIEW="Accounting Voucher View">`,
    `      <DATE>${ymd}</DATE>`,
    `      <EFFECTIVEDATE>${ymd}</EFFECTIVEDATE>`,
    `      <VOUCHERTYPENAME>${xmlEscape(v.voucherType)}</VOUCHERTYPENAME>`,
    `      <VOUCHERNUMBER>${xmlEscape(v.voucherNumber)}</VOUCHERNUMBER>`,
    `      <REFERENCE>${xmlEscape(v.voucherNumber)}</REFERENCE>`,
    `      <PARTYLEDGERNAME>${xmlEscape(partyLedger)}</PARTYLEDGERNAME>`,
    `      <NARRATION>${xmlEscape(narration)}</NARRATION>`,
    "      <PERSISTEDVIEW>Accounting Voucher View</PERSISTEDVIEW>",
    "      <ISINVOICE>No</ISINVOICE>",
    ...entries,
    "     </VOUCHER>",
    "    </TALLYMESSAGE>",
  ].join("\n");
}

/** Render a daily summary as a Tally "Import Data → Vouchers" XML envelope. */
export function renderTallyXml(summary: TallyDailySummary, options: { companyName?: string } = {}): string {
  const staticVars = options.companyName
    ? `\n     <STATICVARIABLES>\n      <SVCURRENTCOMPANY>${xmlEscape(options.companyName)}</SVCURRENTCOMPANY>\n     </STATICVARIABLES>`
    : "";

  return [
    '<?xml version="1.0" encoding="UTF-8"?>',
    "<ENVELOPE>",
    " <HEADER>",
    "  <TALLYREQUEST>Import Data</TALLYREQUEST>",
    " </HEADER>",
    " <BODY>",
    "  <IMPORTDATA>",
    "   <REQUESTDESC>",
    `    <REPORTNAME>Vouchers</REPORTNAME>${staticVars}`,
    "   </REQUESTDESC>",
    "   <REQUESTDATA>",
    ...summary.vouchers.map((v) => renderVoucher(v, summary)),
    "   </REQUESTDATA>",
    "  </IMPORTDATA>",
    " </BODY>",
    "</ENVELOPE>",
    "",
  ].join("\n");
}

// ─── Data loading ───

export class TallyExportError extends Error {
  constructor(message: string, public statusCode: number) {
    super(message);
  }
}

/** Load completed orders for one outlet on one business-local day and summarise them. */
export async function buildTallyDailySummary(
  organizationId: string,
  outletId: string,
  date: string
): Promise<TallyDailySummary> {
  const outlet = await db.query.outlets.findFirst({
    where: and(eq(schema.outlets.id, outletId), eq(schema.outlets.organizationId, organizationId)),
  });
  if (!outlet) throw new TallyExportError("Outlet not found", 404);

  const tz = await getOrgTimeZone(organizationId);
  const { start, endExclusive } = localDayRange(date, date, tz);

  const orders = await db.query.orders.findMany({
    where: and(
      eq(schema.orders.organizationId, organizationId),
      eq(schema.orders.outletId, outletId),
      eq(schema.orders.status, "COMPLETED"),
      gte(schema.orders.createdAt, start),
      lt(schema.orders.createdAt, endExclusive)
    ),
    with: { items: true },
  });

  // Restaurant service is supplied at the outlet; Gusto doesn't capture a
  // customer place of supply, so this resolves to intra-state (CGST+SGST).
  const supplyType = resolveGSTSupplyType(getStateCodeFromGSTIN(outlet.gstNumber), null);

  return {
    outlet: { id: outlet.id, name: outlet.name, gstNumber: outlet.gstNumber },
    date,
    supplyType,
    vouchers: summarizeOrders(orders, { outletId, date, supplyType }),
  };
}
