/**
 * Gusto POS Local Server — Sequence Service
 *
 * Manages daily-resetting order and KOT number sequences.
 * Uses the `sequences` table in SQLite.
 */

import { eq, and } from "drizzle-orm";
import { v4 as uuid } from "uuid";
import * as schema from "@gusto/db-schema/local";
import { db } from "../db/index.js";
import { generateOrderNumber, generateKOTNumber } from "@gusto/core-logic";

function getTodayKey(): string {
  const d = new Date();
  return (
    d.getFullYear().toString() +
    (d.getMonth() + 1).toString().padStart(2, "0") +
    d.getDate().toString().padStart(2, "0")
  );
}

function getNextSequence(prefix: string): number {
  const dateKey = getTodayKey();
  const seqId = `${prefix}-${dateKey}`;

  const existing = db
    .select()
    .from(schema.sequences)
    .where(eq(schema.sequences.id, seqId))
    .get();

  if (existing) {
    const nextVal = existing.currentValue + 1;
    db.update(schema.sequences)
      .set({ currentValue: nextVal })
      .where(eq(schema.sequences.id, seqId))
      .run();
    return nextVal;
  }

  // First sequence of the day
  db.insert(schema.sequences)
    .values({ id: seqId, currentValue: 1, dateKey })
    .run();
  return 1;
}

/**
 * Get the next order number for today.
 * Format: OUT-YYYYMMDD-XXXX
 */
export function getNextOrderNumber(outletPrefix: string = "OUT"): string {
  const seq = getNextSequence("order");
  return generateOrderNumber(outletPrefix, seq);
}

/**
 * Get the next KOT number for today.
 * Format: KOT-XXXX
 */
export function getNextKOTNumber(): string {
  const seq = getNextSequence("kot");
  return generateKOTNumber(seq);
}

/**
 * Get the next invoice number for today.
 * Format: INV-YYYYMMDD-XXXX
 */
export function getNextInvoiceNumber(): string {
  const seq = getNextSequence("invoice");
  const dateKey = getTodayKey();
  return `INV-${dateKey}-${seq.toString().padStart(4, "0")}`;
}
