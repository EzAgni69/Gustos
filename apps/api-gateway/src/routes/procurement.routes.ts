/**
 * Gusto Cloud API Gateway — Procurement Routes
 *
 * Purchase orders and goods-received notes (GRNs).
 *
 *   GET    /api/v1/purchase-orders             list (outlet / status / vendor filters)
 *   POST   /api/v1/purchase-orders             create a DRAFT with its lines
 *   GET    /api/v1/purchase-orders/:id         one PO with lines + received quantities
 *   PUT    /api/v1/purchase-orders/:id         edit a DRAFT
 *   PATCH  /api/v1/purchase-orders/:id/status  SENT or CANCELLED
 *   DELETE /api/v1/purchase-orders/:id         delete a DRAFT
 *   GET    /api/v1/grns                        list
 *   POST   /api/v1/grns                        receive goods → stock goes up
 *   GET    /api/v1/grns/:id                    one GRN with lines
 *
 * Lifecycle: DRAFT → SENT → PARTIAL → FULFILLED, or CANCELLED before any
 * goods arrive. PARTIAL / FULFILLED are never set by hand: they follow from
 * the quantities received against the order.
 *
 * Receiving goods is the only thing here that moves stock. It runs in one
 * transaction: GRN + lines, an atomic stock increment per item, a
 * PURCHASE_ORDER stock transaction for the audit trail, and the PO status.
 */

import { randomBytes } from "node:crypto";
import type { FastifyInstance } from "fastify";
import { and, count, desc, eq, inArray, sql } from "drizzle-orm";
import {
  createPurchaseOrderSchema,
  updatePurchaseOrderSchema,
  updatePurchaseOrderStatusSchema,
  createGrnSchema,
  listProcurementQuerySchema,
} from "@gusto/api-contracts";
import * as schema from "@gusto/db-schema/cloud";
import { db } from "../db/index.js";
import { getOrganizationId, requireMinRole } from "../middleware/auth.js";
import { success, paginated, error } from "../utils/response.js";

const round2 = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100;
const round3 = (n: number) => Math.round((n + Number.EPSILON) * 1000) / 1000;

/** e.g. PO-261110-4F2A9C — date for humans, random suffix so two tabs never collide. */
function documentNumber(prefix: "PO" | "GRN"): string {
  const d = new Date();
  const date = `${String(d.getFullYear()).slice(2)}${String(d.getMonth() + 1).padStart(2, "0")}${String(d.getDate()).padStart(2, "0")}`;
  return `${prefix}-${date}-${randomBytes(3).toString("hex").toUpperCase()}`;
}

async function outletInOrg(orgId: string, outletId: string) {
  return db.query.outlets.findFirst({
    where: and(eq(schema.outlets.id, outletId), eq(schema.outlets.organizationId, orgId)),
    columns: { id: true, name: true },
  });
}

async function vendorInOrg(orgId: string, vendorId: string) {
  return db.query.vendors.findFirst({
    where: and(eq(schema.vendors.id, vendorId), eq(schema.vendors.organizationId, orgId)),
    columns: { id: true, name: true },
  });
}

/** Inventory items by id, restricted to the caller's organization. */
async function inventoryInOrg(orgId: string, ids: string[]) {
  const unique = [...new Set(ids)];
  if (unique.length === 0) return new Map<string, { id: string; name: string; unit: string }>();
  const rows = await db
    .select({ id: schema.inventoryItems.id, name: schema.inventoryItems.name, unit: schema.inventoryItems.unit })
    .from(schema.inventoryItems)
    .where(and(inArray(schema.inventoryItems.id, unique), eq(schema.inventoryItems.organizationId, orgId)));
  return new Map(rows.map((r) => [r.id, r]));
}

function hasDuplicates(ids: string[]): boolean {
  return new Set(ids).size !== ids.length;
}

/** Quantity received so far per inventory item, across every GRN of a PO. */
async function receivedByItem(purchaseOrderId: string, executor: Pick<typeof db, "select"> = db) {
  const rows = await executor
    .select({
      inventoryItemId: schema.grnItems.inventoryItemId,
      received: sql<string>`coalesce(sum(${schema.grnItems.receivedQuantity}), 0)`,
    })
    .from(schema.grnItems)
    .innerJoin(schema.goodsReceivedNotes, eq(schema.goodsReceivedNotes.id, schema.grnItems.grnId))
    .where(eq(schema.goodsReceivedNotes.purchaseOrderId, purchaseOrderId))
    .groupBy(schema.grnItems.inventoryItemId);
  return new Map(rows.map((r) => [r.inventoryItemId, Number(r.received)]));
}

async function loadPurchaseOrder(orgId: string, id: string) {
  const po = await db.query.purchaseOrders.findFirst({
    where: and(eq(schema.purchaseOrders.id, id), eq(schema.purchaseOrders.organizationId, orgId)),
  });
  if (!po) return null;

  const [items, vendor, outlet, received] = await Promise.all([
    db
      .select({
        id: schema.purchaseOrderItems.id,
        purchaseOrderId: schema.purchaseOrderItems.purchaseOrderId,
        inventoryItemId: schema.purchaseOrderItems.inventoryItemId,
        quantity: schema.purchaseOrderItems.quantity,
        unitPrice: schema.purchaseOrderItems.unitPrice,
        totalPrice: schema.purchaseOrderItems.totalPrice,
        inventoryItemName: schema.inventoryItems.name,
        unit: schema.inventoryItems.unit,
      })
      .from(schema.purchaseOrderItems)
      .innerJoin(schema.inventoryItems, eq(schema.inventoryItems.id, schema.purchaseOrderItems.inventoryItemId))
      .where(eq(schema.purchaseOrderItems.purchaseOrderId, id)),
    db.query.vendors.findFirst({ where: eq(schema.vendors.id, po.vendorId), columns: { name: true } }),
    db.query.outlets.findFirst({ where: eq(schema.outlets.id, po.outletId), columns: { name: true } }),
    receivedByItem(id),
  ]);

  return {
    ...po,
    totalAmount: Number(po.totalAmount),
    vendorName: vendor?.name ?? "Unknown vendor",
    outletName: outlet?.name,
    items: items.map((i) => ({
      ...i,
      quantity: Number(i.quantity),
      unitPrice: Number(i.unitPrice),
      totalPrice: Number(i.totalPrice),
      receivedQuantity: received.get(i.inventoryItemId) ?? 0,
    })),
  };
}

export async function procurementRoutes(fastify: FastifyInstance) {
  fastify.addHook("preHandler", fastify.authenticate);
  const manager = { preHandler: [requireMinRole("MANAGER")] };

  // ════════════════ Purchase orders ════════════════

  fastify.get("/api/v1/purchase-orders", manager, async (request, reply) => {
    const orgId = getOrganizationId(request);
    const query = listProcurementQuerySchema.parse(request.query);

    const conditions = [eq(schema.purchaseOrders.organizationId, orgId)];
    if (query.outletId && query.outletId !== "all") conditions.push(eq(schema.purchaseOrders.outletId, query.outletId));
    if (query.status) conditions.push(eq(schema.purchaseOrders.status, query.status));
    if (query.vendorId) conditions.push(eq(schema.purchaseOrders.vendorId, query.vendorId));
    const where = and(...conditions);

    const [rows, totalResult] = await Promise.all([
      db
        .select({
          po: schema.purchaseOrders,
          vendorName: schema.vendors.name,
          outletName: schema.outlets.name,
          itemCount: sql<number>`(select count(*)::int from ${schema.purchaseOrderItems} where ${schema.purchaseOrderItems.purchaseOrderId} = ${schema.purchaseOrders.id})`,
        })
        .from(schema.purchaseOrders)
        .innerJoin(schema.vendors, eq(schema.vendors.id, schema.purchaseOrders.vendorId))
        .innerJoin(schema.outlets, eq(schema.outlets.id, schema.purchaseOrders.outletId))
        .where(where)
        .orderBy(desc(schema.purchaseOrders.createdAt))
        .limit(query.limit)
        .offset((query.page - 1) * query.limit),
      db.select({ count: count() }).from(schema.purchaseOrders).where(where),
    ]);

    return reply.send(
      paginated(
        rows.map((r) => ({
          ...r.po,
          totalAmount: Number(r.po.totalAmount),
          vendorName: r.vendorName,
          outletName: r.outletName,
          itemCount: Number(r.itemCount),
        })),
        totalResult[0]?.count ?? 0,
        query.page,
        query.limit
      )
    );
  });

  fastify.post("/api/v1/purchase-orders", manager, async (request, reply) => {
    const orgId = getOrganizationId(request);
    const body = createPurchaseOrderSchema.parse(request.body);

    if (!(await outletInOrg(orgId, body.outletId))) {
      return reply.status(400).send(error("Outlet not found in your organization"));
    }
    if (!(await vendorInOrg(orgId, body.vendorId))) {
      return reply.status(400).send(error("Vendor not found in your organization"));
    }
    const itemIds = body.items.map((i) => i.inventoryItemId);
    if (hasDuplicates(itemIds)) {
      return reply.status(400).send(error("Each material may appear only once on a purchase order"));
    }
    const inventory = await inventoryInOrg(orgId, itemIds);
    if (inventory.size !== itemIds.length) {
      return reply.status(400).send(error("One or more materials were not found in your inventory"));
    }

    const lines = body.items.map((i) => ({
      inventoryItemId: i.inventoryItemId,
      quantity: round3(i.quantity),
      unitPrice: round2(i.unitPrice),
      totalPrice: round2(i.quantity * i.unitPrice),
    }));
    const total = round2(lines.reduce((sum, l) => sum + l.totalPrice, 0));

    const id = await db.transaction(async (tx) => {
      const [po] = await tx
        .insert(schema.purchaseOrders)
        .values({
          organizationId: orgId,
          outletId: body.outletId,
          vendorId: body.vendorId,
          poNumber: documentNumber("PO"),
          status: "DRAFT",
          totalAmount: String(total),
          expectedDeliveryDate: body.expectedDeliveryDate ?? null,
          notes: body.notes?.trim() || null,
        })
        .returning({ id: schema.purchaseOrders.id });

      await tx.insert(schema.purchaseOrderItems).values(
        lines.map((l) => ({
          purchaseOrderId: po!.id,
          inventoryItemId: l.inventoryItemId,
          quantity: String(l.quantity),
          unitPrice: String(l.unitPrice),
          totalPrice: String(l.totalPrice),
        }))
      );
      return po!.id;
    });

    return reply.status(201).send(success(await loadPurchaseOrder(orgId, id), "Purchase order created"));
  });

  fastify.get("/api/v1/purchase-orders/:id", manager, async (request, reply) => {
    const { id } = request.params as { id: string };
    const po = await loadPurchaseOrder(getOrganizationId(request), id);
    if (!po) return reply.status(404).send(error("Purchase order not found"));
    return reply.send(success(po));
  });

  fastify.put("/api/v1/purchase-orders/:id", manager, async (request, reply) => {
    const { id } = request.params as { id: string };
    const orgId = getOrganizationId(request);
    const body = updatePurchaseOrderSchema.parse(request.body);

    const existing = await db.query.purchaseOrders.findFirst({
      where: and(eq(schema.purchaseOrders.id, id), eq(schema.purchaseOrders.organizationId, orgId)),
    });
    if (!existing) return reply.status(404).send(error("Purchase order not found"));
    // Once sent, the vendor is working from that document
    if (existing.status !== "DRAFT") {
      return reply.status(409).send(error(`A ${existing.status.toLowerCase()} purchase order can no longer be edited`));
    }

    if (body.vendorId && !(await vendorInOrg(orgId, body.vendorId))) {
      return reply.status(400).send(error("Vendor not found in your organization"));
    }

    let lines: { inventoryItemId: string; quantity: number; unitPrice: number; totalPrice: number }[] | null = null;
    if (body.items) {
      const itemIds = body.items.map((i) => i.inventoryItemId);
      if (hasDuplicates(itemIds)) {
        return reply.status(400).send(error("Each material may appear only once on a purchase order"));
      }
      const inventory = await inventoryInOrg(orgId, itemIds);
      if (inventory.size !== itemIds.length) {
        return reply.status(400).send(error("One or more materials were not found in your inventory"));
      }
      lines = body.items.map((i) => ({
        inventoryItemId: i.inventoryItemId,
        quantity: round3(i.quantity),
        unitPrice: round2(i.unitPrice),
        totalPrice: round2(i.quantity * i.unitPrice),
      }));
    }

    await db.transaction(async (tx) => {
      const update: Record<string, unknown> = { updatedAt: new Date() };
      if (body.vendorId !== undefined) update.vendorId = body.vendorId;
      if (body.expectedDeliveryDate !== undefined) update.expectedDeliveryDate = body.expectedDeliveryDate;
      if (body.notes !== undefined) update.notes = body.notes?.trim() || null;
      if (lines) update.totalAmount = String(round2(lines.reduce((sum, l) => sum + l.totalPrice, 0)));

      // Guard on status again inside the transaction (someone may have sent it meanwhile)
      const [updated] = await tx
        .update(schema.purchaseOrders)
        .set(update)
        .where(and(eq(schema.purchaseOrders.id, id), eq(schema.purchaseOrders.status, "DRAFT")))
        .returning({ id: schema.purchaseOrders.id });
      if (!updated) throw Object.assign(new Error("Purchase order is no longer a draft"), { statusCode: 409 });

      if (lines) {
        await tx.delete(schema.purchaseOrderItems).where(eq(schema.purchaseOrderItems.purchaseOrderId, id));
        await tx.insert(schema.purchaseOrderItems).values(
          lines.map((l) => ({
            purchaseOrderId: id,
            inventoryItemId: l.inventoryItemId,
            quantity: String(l.quantity),
            unitPrice: String(l.unitPrice),
            totalPrice: String(l.totalPrice),
          }))
        );
      }
    });

    return reply.send(success(await loadPurchaseOrder(orgId, id), "Purchase order updated"));
  });

  fastify.patch("/api/v1/purchase-orders/:id/status", manager, async (request, reply) => {
    const { id } = request.params as { id: string };
    const orgId = getOrganizationId(request);
    const { status } = updatePurchaseOrderStatusSchema.parse(request.body);

    const existing = await db.query.purchaseOrders.findFirst({
      where: and(eq(schema.purchaseOrders.id, id), eq(schema.purchaseOrders.organizationId, orgId)),
    });
    if (!existing) return reply.status(404).send(error("Purchase order not found"));
    if (existing.status === status) return reply.send(success(await loadPurchaseOrder(orgId, id)));

    // DRAFT → SENT; DRAFT / SENT → CANCELLED. Goods already received cannot be un-ordered.
    const allowedFrom = status === "SENT" ? ["DRAFT"] : ["DRAFT", "SENT"];
    if (!allowedFrom.includes(existing.status)) {
      const why =
        status === "CANCELLED" && (existing.status === "PARTIAL" || existing.status === "FULFILLED")
          ? "goods have already been received against it"
          : `it is ${existing.status.toLowerCase()}`;
      return reply.status(409).send(error(`This purchase order cannot be marked ${status.toLowerCase()} — ${why}`));
    }

    const [updated] = await db
      .update(schema.purchaseOrders)
      .set({ status, updatedAt: new Date() })
      .where(and(eq(schema.purchaseOrders.id, id), eq(schema.purchaseOrders.status, existing.status)))
      .returning({ id: schema.purchaseOrders.id });
    if (!updated) return reply.status(409).send(error("Purchase order was changed by someone else — reload and try again"));

    return reply.send(success(await loadPurchaseOrder(orgId, id), `Purchase order marked ${status.toLowerCase()}`));
  });

  fastify.delete("/api/v1/purchase-orders/:id", manager, async (request, reply) => {
    const { id } = request.params as { id: string };
    const orgId = getOrganizationId(request);

    const existing = await db.query.purchaseOrders.findFirst({
      where: and(eq(schema.purchaseOrders.id, id), eq(schema.purchaseOrders.organizationId, orgId)),
      columns: { status: true },
    });
    if (!existing) return reply.status(404).send(error("Purchase order not found"));
    if (existing.status !== "DRAFT") {
      return reply.status(409).send(error("Only draft purchase orders can be deleted — cancel it instead"));
    }

    await db
      .delete(schema.purchaseOrders)
      .where(and(eq(schema.purchaseOrders.id, id), eq(schema.purchaseOrders.status, "DRAFT")));
    return reply.send(success(null, "Purchase order deleted"));
  });

  // ════════════════ Goods-received notes ════════════════

  fastify.get("/api/v1/grns", manager, async (request, reply) => {
    const orgId = getOrganizationId(request);
    const query = listProcurementQuerySchema.parse(request.query);

    const conditions = [eq(schema.goodsReceivedNotes.organizationId, orgId)];
    if (query.outletId && query.outletId !== "all") conditions.push(eq(schema.goodsReceivedNotes.outletId, query.outletId));
    const where = and(...conditions);

    const [rows, totalResult] = await Promise.all([
      db
        .select({
          grn: schema.goodsReceivedNotes,
          poNumber: schema.purchaseOrders.poNumber,
          vendorName: schema.vendors.name,
          outletName: schema.outlets.name,
          itemCount: sql<number>`(select count(*)::int from ${schema.grnItems} where ${schema.grnItems.grnId} = ${schema.goodsReceivedNotes.id})`,
          totalValue: sql<string>`(select coalesce(sum(${schema.grnItems.totalPrice}), 0) from ${schema.grnItems} where ${schema.grnItems.grnId} = ${schema.goodsReceivedNotes.id})`,
        })
        .from(schema.goodsReceivedNotes)
        .innerJoin(schema.outlets, eq(schema.outlets.id, schema.goodsReceivedNotes.outletId))
        .leftJoin(schema.purchaseOrders, eq(schema.purchaseOrders.id, schema.goodsReceivedNotes.purchaseOrderId))
        .leftJoin(schema.vendors, eq(schema.vendors.id, schema.purchaseOrders.vendorId))
        .where(where)
        .orderBy(desc(schema.goodsReceivedNotes.receivedDate))
        .limit(query.limit)
        .offset((query.page - 1) * query.limit),
      db.select({ count: count() }).from(schema.goodsReceivedNotes).where(where),
    ]);

    return reply.send(
      paginated(
        rows.map((r) => ({
          ...r.grn,
          poNumber: r.poNumber,
          vendorName: r.vendorName,
          outletName: r.outletName,
          itemCount: Number(r.itemCount),
          totalValue: Number(r.totalValue),
        })),
        totalResult[0]?.count ?? 0,
        query.page,
        query.limit
      )
    );
  });

  fastify.get("/api/v1/grns/:id", manager, async (request, reply) => {
    const { id } = request.params as { id: string };
    const orgId = getOrganizationId(request);

    const grn = await db.query.goodsReceivedNotes.findFirst({
      where: and(eq(schema.goodsReceivedNotes.id, id), eq(schema.goodsReceivedNotes.organizationId, orgId)),
    });
    if (!grn) return reply.status(404).send(error("Goods received note not found"));

    const [items, po] = await Promise.all([
      db
        .select({
          id: schema.grnItems.id,
          grnId: schema.grnItems.grnId,
          inventoryItemId: schema.grnItems.inventoryItemId,
          receivedQuantity: schema.grnItems.receivedQuantity,
          unitPrice: schema.grnItems.unitPrice,
          totalPrice: schema.grnItems.totalPrice,
          inventoryItemName: schema.inventoryItems.name,
          unit: schema.inventoryItems.unit,
        })
        .from(schema.grnItems)
        .innerJoin(schema.inventoryItems, eq(schema.inventoryItems.id, schema.grnItems.inventoryItemId))
        .where(eq(schema.grnItems.grnId, id)),
      grn.purchaseOrderId
        ? db
            .select({ poNumber: schema.purchaseOrders.poNumber, vendorName: schema.vendors.name })
            .from(schema.purchaseOrders)
            .innerJoin(schema.vendors, eq(schema.vendors.id, schema.purchaseOrders.vendorId))
            .where(eq(schema.purchaseOrders.id, grn.purchaseOrderId))
            .then((r) => r[0] ?? null)
        : Promise.resolve(null),
    ]);

    const mapped = items.map((i) => ({
      ...i,
      receivedQuantity: Number(i.receivedQuantity),
      unitPrice: Number(i.unitPrice),
      totalPrice: Number(i.totalPrice),
    }));
    return reply.send(
      success({
        ...grn,
        poNumber: po?.poNumber ?? null,
        vendorName: po?.vendorName ?? null,
        totalValue: round2(mapped.reduce((sum, i) => sum + i.totalPrice, 0)),
        items: mapped,
      })
    );
  });

  fastify.post("/api/v1/grns", manager, async (request, reply) => {
    const orgId = getOrganizationId(request);
    const body = createGrnSchema.parse(request.body);

    if (!(await outletInOrg(orgId, body.outletId))) {
      return reply.status(400).send(error("Outlet not found in your organization"));
    }
    const itemIds = body.items.map((i) => i.inventoryItemId);
    if (hasDuplicates(itemIds)) {
      return reply.status(400).send(error("Each material may appear only once on a goods received note"));
    }
    const inventory = await inventoryInOrg(orgId, itemIds);
    if (inventory.size !== itemIds.length) {
      return reply.status(400).send(error("One or more materials were not found in your inventory"));
    }
    if (body.receivedDate && body.receivedDate.getTime() > Date.now() + 24 * 3_600_000) {
      return reply.status(400).send(error("Received date cannot be in the future"));
    }

    try {
      const grnId = await db.transaction(async (tx) => {
        let poNumber: string | null = null;

        if (body.purchaseOrderId) {
          // Lock the PO so two people receiving against it cannot both read the same "received so far"
          const [po] = await tx
            .select()
            .from(schema.purchaseOrders)
            .where(and(eq(schema.purchaseOrders.id, body.purchaseOrderId), eq(schema.purchaseOrders.organizationId, orgId)))
            .for("update");
          if (!po) throw Object.assign(new Error("Purchase order not found"), { statusCode: 404 });
          if (po.outletId !== body.outletId) {
            throw Object.assign(new Error("This purchase order belongs to a different outlet"), { statusCode: 400 });
          }
          if (po.status === "DRAFT") {
            throw Object.assign(new Error("Send the purchase order to the vendor before receiving goods against it"), { statusCode: 409 });
          }
          if (po.status === "CANCELLED" || po.status === "FULFILLED") {
            throw Object.assign(new Error(`This purchase order is already ${po.status.toLowerCase()}`), { statusCode: 409 });
          }
          poNumber = po.poNumber;

          const ordered = await tx
            .select({ inventoryItemId: schema.purchaseOrderItems.inventoryItemId, quantity: schema.purchaseOrderItems.quantity })
            .from(schema.purchaseOrderItems)
            .where(eq(schema.purchaseOrderItems.purchaseOrderId, po.id));
          const orderedQty = new Map(ordered.map((o) => [o.inventoryItemId, Number(o.quantity)]));
          const already = await receivedByItem(po.id, tx);

          for (const item of body.items) {
            if (!orderedQty.has(item.inventoryItemId)) {
              const name = inventory.get(item.inventoryItemId)?.name ?? "A material";
              throw Object.assign(new Error(`${name} is not on purchase order ${po.poNumber}`), { statusCode: 400 });
            }
          }

          // Status follows from the totals after this receipt (over-delivery still counts as fulfilled)
          const receivedNow = new Map(body.items.map((i) => [i.inventoryItemId, i.receivedQuantity]));
          const fulfilled = [...orderedQty.entries()].every(
            ([itemId, qty]) => (already.get(itemId) ?? 0) + (receivedNow.get(itemId) ?? 0) >= qty - 0.0005
          );
          await tx
            .update(schema.purchaseOrders)
            .set({ status: fulfilled ? "FULFILLED" : "PARTIAL", updatedAt: new Date() })
            .where(eq(schema.purchaseOrders.id, po.id));
        }

        const grnNumber = documentNumber("GRN");
        const [grn] = await tx
          .insert(schema.goodsReceivedNotes)
          .values({
            organizationId: orgId,
            outletId: body.outletId,
            purchaseOrderId: body.purchaseOrderId ?? null,
            grnNumber,
            receivedDate: body.receivedDate ?? new Date(),
            notes: body.notes?.trim() || null,
          })
          .returning({ id: schema.goodsReceivedNotes.id });

        for (const item of body.items) {
          const quantity = round3(item.receivedQuantity);
          const unitPrice = round2(item.unitPrice);

          await tx.insert(schema.grnItems).values({
            grnId: grn!.id,
            inventoryItemId: item.inventoryItemId,
            receivedQuantity: String(quantity),
            unitPrice: String(unitPrice),
            totalPrice: String(round2(quantity * unitPrice)),
          });

          // Atomic increment — concurrent sales deductions cannot be lost
          const [stock] = await tx
            .update(schema.inventoryItems)
            .set({
              currentStock: sql`${schema.inventoryItems.currentStock} + ${String(quantity)}`,
              updatedAt: new Date(),
            })
            .where(and(eq(schema.inventoryItems.id, item.inventoryItemId), eq(schema.inventoryItems.organizationId, orgId)))
            .returning({ currentStock: schema.inventoryItems.currentStock });

          await tx.insert(schema.stockTransactions).values({
            organizationId: orgId,
            inventoryItemId: item.inventoryItemId,
            type: "PURCHASE_ORDER",
            quantityChange: String(quantity),
            balanceAfter: String(stock!.currentStock),
            notes: poNumber ? `Received via ${grnNumber} against ${poNumber}` : `Received via ${grnNumber}`,
          });
        }

        return grn!.id;
      });

      const created = await db.query.goodsReceivedNotes.findFirst({ where: eq(schema.goodsReceivedNotes.id, grnId) });
      return reply.status(201).send(success(created, "Goods received and stock updated"));
    } catch (err) {
      const status = (err as { statusCode?: number }).statusCode;
      if (status && status < 500) return reply.status(status).send(error((err as Error).message));
      throw err;
    }
  });
}
