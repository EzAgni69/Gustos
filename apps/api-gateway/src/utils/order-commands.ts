/**
 * Gusto API Gateway — ERP → POS order commands
 *
 * Orders taken on the POS / Captain app live on the outlet's POS, which keeps
 * sending the cloud full snapshots of them. An edit made in the ERP would be
 * overwritten by the next snapshot, so instead the ERP queues a command in
 * `sync_queue`; the POS applies it locally and the resulting snapshot brings
 * the cloud back in line.
 */

import { db } from "../db/index.js";
import * as cloudSchema from "@gusto/db-schema/cloud";
import { publishSyncUpdate } from "./sync-publisher.js";

export const ORDER_COMMAND_EVENT = "ORDER_COMMAND";

export type OrderCommand =
  | { action: "UPDATE"; orderId: string; orderNumber: string; status?: string; notes?: string | null }
  | { action: "DELETE"; orderId: string; orderNumber: string };

/** Orders created in the ERP itself are numbered ORD-…; everything else came from a POS. */
export function isPosOrder(order: { orderNumber: string }): boolean {
  return !order.orderNumber.startsWith("ORD-");
}

function pgCode(err: unknown): string | null {
  let cur: any = err;
  for (let i = 0; cur && i < 4; i++) {
    if (typeof cur.code === "string") return cur.code;
    cur = cur.cause;
  }
  return null;
}

/**
 * Queue a command for the outlet's POS and nudge it over the realtime channel.
 * Returns false (and logs) if the command could not be queued.
 */
export async function queueOrderCommand(
  organizationId: string,
  outletId: string,
  command: OrderCommand
): Promise<boolean> {
  try {
    await db.insert(cloudSchema.syncQueue).values({
      outletId,
      eventType: ORDER_COMMAND_EVENT,
      payload: JSON.stringify({ ...command, issuedAt: new Date().toISOString() }),
      localTimestamp: new Date(),
      status: "PENDING",
    });
  } catch (err) {
    const code = pgCode(err);
    console.error(
      `[OrderCommands] Could not queue ${command.action} for order ${command.orderNumber}` +
        (code === "42P01" ? " — table sync_queue is missing; apply the cloud schema." : ":"),
      code === "42P01" ? "" : err
    );
    return false;
  }
  await publishSyncUpdate(organizationId, outletId, ORDER_COMMAND_EVENT);
  return true;
}
