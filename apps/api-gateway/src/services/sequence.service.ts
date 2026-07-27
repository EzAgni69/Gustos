/**
 * Gusto Cloud API Gateway — Sequence Service
 *
 * Manages daily-resetting order, KOT, and invoice number sequences
 * using the `sequences` table in PostgreSQL.
 */

import { eq } from "drizzle-orm";
import * as schema from "@gusto/db-schema/cloud";
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

async function getNextSequence(prefix: string, outletId: string): Promise<number> {
  const dateKey = getTodayKey();
  const seqId = `${prefix}-${dateKey}-${outletId.slice(0, 8)}`;

  const existing = await db.query.sequences.findFirst({
    where: eq(schema.sequences.id, seqId),
  });

  if (existing) {
    const nextVal = existing.currentValue + 1;
    await db
      .update(schema.sequences)
      .set({ currentValue: nextVal })
      .where(eq(schema.sequences.id, seqId));
    return nextVal;
  }

  // First sequence of the day for this outlet
  await db.insert(schema.sequences).values({
    id: seqId,
    currentValue: 1,
    dateKey,
  });
  return 1;
}

/**
 * Get the next order number for today.
 * Format: OUT-YYYYMMDD-XXXX
 */
export async function getNextOrderNumber(
  outletId: string,
  outletPrefix: string = "OUT"
): Promise<string> {
  const seq = await getNextSequence("order", outletId);
  return generateOrderNumber(outletPrefix, seq);
}

/**
 * Get the next KOT number for today.
 * Format: KOT-XXXX
 */
export async function getNextKOTNumber(outletId: string): Promise<string> {
  const seq = await getNextSequence("kot", outletId);
  return generateKOTNumber(seq);
}

/**
 * Get the next invoice number for today.
 * Format: INV-YYYYMMDD-XXXX
 */
export async function getNextInvoiceNumber(outletId: string): Promise<string> {
  const seq = await getNextSequence("invoice", outletId);
  const dateKey = getTodayKey();
  return `INV-${dateKey}-${seq.toString().padStart(4, "0")}`;
}
