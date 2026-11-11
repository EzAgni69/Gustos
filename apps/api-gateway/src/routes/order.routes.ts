/**
 * Gusto Cloud API Gateway — Order Routes (Local-First)
 *
 * Simple CRUD for order management. The real-time order lifecycle
 * is handled by the pos-local-server; this is for cloud sync and admin.
 */

import type { FastifyInstance } from "fastify";
import { randomBytes } from "node:crypto";
import { eq, and, count, ilike, sql, gte, lt, inArray } from "drizzle-orm";
import { calculateCartTotals, type CartItem, type GSTRate } from "@gusto/core-logic";
import { queueInventoryReconcile } from "../config/queue.js";
import {
  createOrderSchema,
  updateOrderSchema,
  listOrdersQuerySchema,
  orderHistoryQuerySchema,
} from "@gusto/api-contracts";
import * as cloudSchema from "@gusto/db-schema/cloud";
import { db } from "../db/index.js";
import { getOrganizationId, requireMinRole } from "../middleware/auth.js";
import { success, paginated, error } from "../utils/response.js";
import { generateInvoicePdf, type InvoicePdfData } from "../services/pdf-generator.js";
import { isPosOrder, queueOrderCommand } from "../utils/order-commands.js";
import { getOrgTimeZone, localDayRange, startOfLocalDay } from "../utils/business-time.js";



function parseJsonArray(value: unknown): unknown[] {
  if (Array.isArray(value)) return value;
  if (typeof value !== "string" || !value) return [];
  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

/** Numeric columns arrive as strings and JSON columns as text — normalise for the client. */
function formatOrder<T extends { subtotal: unknown; discountAmount: unknown; taxAmount: unknown; totalAmount: unknown; items: any[] }>(order: T) {
  return {
    ...order,
    subtotal: Number(order.subtotal),
    discountAmount: Number(order.discountAmount),
    taxAmount: Number(order.taxAmount),
    totalAmount: Number(order.totalAmount),
    items: order.items.map((item) => ({
      ...item,
      unitPrice: Number(item.unitPrice),
      modifiers: parseJsonArray(item.modifiers),
    })),
  };
}

/** ORD-YYMMDD-XXXXXX. The ORD- prefix marks an order as created in the ERP (see isPosOrder). */
function generateErpOrderNumber(): string {
  const d = new Date();
  const date = `${String(d.getFullYear()).slice(2)}${String(d.getMonth() + 1).padStart(2, "0")}${String(d.getDate()).padStart(2, "0")}`;
  return `ORD-${date}-${randomBytes(4).toString("hex").slice(0, 6).toUpperCase()}`;
}

/**
 * Every id an order points at must belong to the caller's organization —
 * otherwise an order could attach another tenant's table, customer or staff.
 * Returns an error message, or null when everything checks out.
 */
async function validateOrderReferences(
  orgId: string,
  outletId: string,
  refs: { tableId?: string | null; customerId?: string | null; waiterId?: string | null }
): Promise<string | null> {
  const outlet = await db.query.outlets.findFirst({
    where: and(eq(cloudSchema.outlets.id, outletId), eq(cloudSchema.outlets.organizationId, orgId)),
    columns: { id: true },
  });
  if (!outlet) return "Outlet not found in your organization";

  if (refs.tableId) {
    const table = await db.query.diningTables.findFirst({
      where: and(eq(cloudSchema.diningTables.id, refs.tableId), eq(cloudSchema.diningTables.outletId, outletId)),
      columns: { id: true },
    });
    if (!table) return "Table not found in this outlet";
  }
  if (refs.customerId) {
    const customer = await db.query.customers.findFirst({
      where: and(eq(cloudSchema.customers.id, refs.customerId), eq(cloudSchema.customers.organizationId, orgId)),
      columns: { id: true },
    });
    if (!customer) return "Customer not found in your organization";
  }
  if (refs.waiterId) {
    const waiter = await db.query.users.findFirst({
      where: and(eq(cloudSchema.users.id, refs.waiterId), eq(cloudSchema.users.organizationId, orgId)),
      columns: { id: true },
    });
    if (!waiter) return "Waiter not found in your organization";
  }
  return null;
}

type OrderItemInput = {
  menuItemId: string;
  quantity: number;
  variantName?: string;
  notes?: string;
  modifiers: string[];
  addOns: { name: string; quantity: number; unitPrice: number }[];
};

const GST_RATES = ["0", "5", "12", "18", "28"] as const;

interface BuiltOrderRow {
  menuItemId: string;
  menuItemName: string;
  variantName: string | null;
  quantity: number;
  unitPrice: string;
  gstRate: GSTRate;
  modifiers: string;
  addOns: string | null;
  notes: string | null;
}

/**
 * Price order lines from the outlet's own menu (never from the request) and
 * compute the order totals with the shared tax engine.
 */
async function buildOrderItems(
  outletId: string,
  items: OrderItemInput[]
): Promise<{ error: string } | { rows: BuiltOrderRow[]; totals: ReturnType<typeof calculateCartTotals> }> {
  const ids = [...new Set(items.map((i) => i.menuItemId))];
  const menuRows = ids.length
    ? await db
        .select()
        .from(cloudSchema.menuItems)
        .where(and(inArray(cloudSchema.menuItems.id, ids), eq(cloudSchema.menuItems.outletId, outletId)))
    : [];
  const menuById = new Map(menuRows.map((m) => [m.id, m]));

  const rows: BuiltOrderRow[] = [];
  const cart: CartItem[] = [];
  for (const item of items) {
    const menuItem = menuById.get(item.menuItemId);
    if (!menuItem) return { error: "One or more menu items do not belong to this outlet" };

    // A named variant carries its own price
    let unitPrice = Number(menuItem.price);
    if (item.variantName) {
      const variants = parseJsonArray(menuItem.variants) as { name?: string; price?: number }[];
      const variant = variants.find((v) => v?.name === item.variantName);
      if (!variant || !Number.isFinite(Number(variant.price))) {
        return { error: `"${menuItem.name}" has no variant "${item.variantName}"` };
      }
      unitPrice = Number(variant.price);
    }
    const gstRate = ((GST_RATES as readonly string[]).includes(menuItem.gstRate) ? menuItem.gstRate : "5") as GSTRate;

    cart.push({
      menuItemId: menuItem.id,
      menuItemName: menuItem.name,
      quantity: item.quantity,
      unitPrice,
      gstRate,
      addOns: item.addOns,
    });
    rows.push({
      menuItemId: menuItem.id,
      menuItemName: menuItem.name,
      variantName: item.variantName ?? null,
      quantity: item.quantity,
      unitPrice: String(unitPrice),
      gstRate,
      modifiers: JSON.stringify(item.modifiers ?? []),
      addOns: item.addOns?.length ? JSON.stringify(item.addOns) : null,
      notes: item.notes || null,
    });
  }

  return { rows, totals: calculateCartTotals(cart) };
}

export async function orderRoutes(fastify: FastifyInstance) {
  fastify.addHook("preHandler", fastify.authenticate);

  // ─── List Orders ───
  fastify.get("/api/v1/orders", { preHandler: [requireMinRole("MANAGER")] }, async (request, reply) => {
    const orgId = getOrganizationId(request);
    const query = listOrdersQuerySchema.parse(request.query);

    const conditions = [
      eq(cloudSchema.orders.organizationId, orgId),
    ];
    if (query.outletId && query.outletId !== "all") {
      conditions.push(eq(cloudSchema.orders.outletId, query.outletId));
    }

    if (query.status) {
      conditions.push(eq(cloudSchema.orders.status, query.status));
    }

    if (query.search) {
      const searchCondition = ilike(cloudSchema.orders.orderNumber, `%${query.search}%`);
      if (searchCondition) {
        conditions.push(searchCondition);
      }
    }

    const where = and(...conditions);

    const [orders, totalResult] = await Promise.all([
      db.query.orders.findMany({
        where,
        limit: query.limit,
        offset: (query.page - 1) * query.limit,
        orderBy: (o, { desc }) => [desc(o.createdAt)],
        with: {
          items: true
        }
      }),
      db.select({ count: count() }).from(cloudSchema.orders).where(where),
    ]);

    const formattedOrders = orders.map(formatOrder);

    const total = totalResult[0]?.count ?? 0;
    return reply.send(paginated(formattedOrders, total, query.page, query.limit));
  });

  // ─── Create Order ───
  fastify.post("/api/v1/orders", { preHandler: [requireMinRole("MANAGER")] }, async (request, reply) => {
    const orgId = getOrganizationId(request);
    const body = createOrderSchema.parse(request.body);

    const refError = await validateOrderReferences(orgId, body.outletId, body);
    if (refError) return reply.status(400).send(error(refError));

    const built = await buildOrderItems(body.outletId, body.items);
    if ("error" in built) return reply.status(400).send(error(built.error));

    // Header, items and totals are written together or not at all
    const order = await db.transaction(async (tx) => {
      const [created] = await tx
        .insert(cloudSchema.orders)
        .values({
          organizationId: orgId,
          outletId: body.outletId,
          tableId: body.tableId || null,
          orderNumber: generateErpOrderNumber(),
          orderMode: body.orderType,
          status: body.status,
          subtotal: String(built.totals.subtotal),
          discountAmount: String(built.totals.discountAmount),
          taxAmount: String(built.totals.totalTax),
          totalAmount: String(built.totals.grandTotal),
          paymentMode: body.paymentMode || null,
          customerId: body.customerId || null,
          customerName: body.customerName || null,
          waiterId: body.waiterId || null,
          notes: body.notes || null,
        })
        .returning();

      if (built.rows.length > 0) {
        await tx.insert(cloudSchema.orderItems).values(built.rows.map((row) => ({ ...row, orderId: created!.id })));
      }
      return created!;
    });

    await queueInventoryReconcile({
      orderId: order.id,
      orderNumber: order.orderNumber,
      organizationId: orgId,
      outletId: order.outletId,
    });

    const createdOrder = await db.query.orders.findFirst({
      where: eq(cloudSchema.orders.id, order.id),
      with: { items: true }
    });

    return reply.status(201).send(success(createdOrder ? formatOrder(createdOrder) : null, "Order created"));
  });

  // ─── Get Order ───
  fastify.get("/api/v1/orders/:id", { preHandler: [requireMinRole("MANAGER")] }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const orgId = getOrganizationId(request);

    const order = await db.query.orders.findFirst({
      where: and(
        eq(cloudSchema.orders.id, id),
        eq(cloudSchema.orders.organizationId, orgId)
      ),
      with: { items: true }
    });

    if (!order) {
      return reply.status(404).send(error("Order not found"));
    }

    return reply.send(success(formatOrder(order)));
  });

  // ─── Update Order ───
  fastify.put("/api/v1/orders/:id", { preHandler: [requireMinRole("MANAGER")] }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const orgId = getOrganizationId(request);
    const body = updateOrderSchema.parse(request.body);

    const existing = await db.query.orders.findFirst({
      where: and(eq(cloudSchema.orders.id, id), eq(cloudSchema.orders.organizationId, orgId)),
    });
    if (!existing) {
      return reply.status(404).send(error("Order not found"));
    }

    // Orders from the POS / Captain app are owned by the outlet's POS. Only the
    // changes the POS can apply are allowed; they are sent to it as a command
    // so the POS's next sync doesn't overwrite them.
    const fromPos = isPosOrder(existing);
    if (fromPos) {
      if (body.items !== undefined || body.tableId !== undefined || body.paymentMode !== undefined || body.customerId !== undefined || body.waiterId !== undefined) {
        return reply
          .status(400)
          .send(error("Items, table, payment, customer and waiter of a POS order can only be changed on the POS."));
      }
      if (body.status === "COMPLETED" && existing.status !== "COMPLETED") {
        return reply.status(400).send(error("Take payment on the POS to complete this order."));
      }
      if ((existing.status === "COMPLETED" || existing.status === "CANCELLED") && body.status !== undefined && body.status !== existing.status) {
        return reply.status(400).send(error(`This order is already ${existing.status.toLowerCase()} on the POS.`));
      }
    }

    if (!fromPos) {
      const refError = await validateOrderReferences(orgId, existing.outletId, body);
      if (refError) return reply.status(400).send(error(refError));
    }

    // Replacing the items of an ERP order re-prices the whole order
    let built: Awaited<ReturnType<typeof buildOrderItems>> | null = null;
    if (body.items !== undefined) {
      built = await buildOrderItems(existing.outletId, body.items);
      if ("error" in built) return reply.status(400).send(error(built.error));
    }

    // POS orders keep the POS-clock updatedAt so the POS's follow-up snapshot
    // isn't mistaken for an older one.
    const updateData: any = fromPos ? {} : { updatedAt: new Date() };
    if (body.status !== undefined) updateData.status = body.status;
    if (body.orderType !== undefined && !fromPos) updateData.orderMode = body.orderType;
    if (body.tableId !== undefined) updateData.tableId = body.tableId;
    if (body.paymentMode !== undefined) updateData.paymentMode = body.paymentMode;
    if (body.customerId !== undefined) updateData.customerId = body.customerId;
    if (body.customerName !== undefined && !fromPos) updateData.customerName = body.customerName;
    if (body.waiterId !== undefined) updateData.waiterId = body.waiterId;
    if (body.notes !== undefined) updateData.notes = body.notes;
    if (built && !("error" in built)) {
      updateData.subtotal = String(built.totals.subtotal);
      updateData.discountAmount = String(built.totals.discountAmount);
      updateData.taxAmount = String(built.totals.totalTax);
      updateData.totalAmount = String(built.totals.grandTotal);
    }

    const updated = await db.transaction(async (tx) => {
      const rows = Object.keys(updateData).length === 0
        ? [existing]
        : await tx
            .update(cloudSchema.orders)
            .set(updateData)
            .where(
              and(
                eq(cloudSchema.orders.id, id),
                eq(cloudSchema.orders.organizationId, orgId)
              )
            )
            .returning();

      if (rows[0] && built && !("error" in built)) {
        await tx.delete(cloudSchema.orderItems).where(eq(cloudSchema.orderItems.orderId, id));
        if (built.rows.length > 0) {
          await tx.insert(cloudSchema.orderItems).values(built.rows.map((row) => ({ ...row, orderId: id })));
        }
      }
      return rows[0];
    });

    if (!updated) {
      return reply.status(404).send(error("Order not found"));
    }

    if (fromPos && (body.status !== undefined || body.notes !== undefined)) {
      await queueOrderCommand(orgId, existing.outletId, {
        action: "UPDATE",
        orderId: id,
        orderNumber: existing.orderNumber,
        ...(body.status !== undefined && body.status !== existing.status ? { status: body.status } : {}),
        ...(body.notes !== undefined ? { notes: body.notes } : {}),
      });
    }

    // Status or items changed on an ERP order → bring stock in line
    // (POS orders are reconciled when their snapshot arrives)
    if (!fromPos && (body.status !== undefined || body.items !== undefined)) {
      await queueInventoryReconcile({
        orderId: id,
        orderNumber: existing.orderNumber,
        organizationId: orgId,
        outletId: existing.outletId,
      });
    }

    const finalOrder = await db.query.orders.findFirst({
      where: eq(cloudSchema.orders.id, id),
      with: { items: true }
    });

    return reply.send(success(finalOrder ? formatOrder(finalOrder) : null, "Order updated"));
  });

  // ─── Delete Order ───
  fastify.delete("/api/v1/orders/:id", { preHandler: [requireMinRole("MANAGER")] }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const orgId = getOrganizationId(request);

    const results = await db
      .delete(cloudSchema.orders)
      .where(
        and(
          eq(cloudSchema.orders.id, id),
          eq(cloudSchema.orders.organizationId, orgId)
        )
      )
      .returning();

    const deleted = results[0];
    if (!deleted) {
      return reply.status(404).send(error("Order not found"));
    }

    // Tell the POS: it cancels the order if still open and stops re-sending it.
    if (isPosOrder(deleted)) {
      await queueOrderCommand(orgId, deleted.outletId, {
        action: "DELETE",
        orderId: id,
        orderNumber: deleted.orderNumber,
      });
    }

    return reply.send(success(null, "Order deleted"));
  });

  // ─── Order History (Enhanced filters) ───
  fastify.get("/api/v1/orders/history", { preHandler: [requireMinRole("MANAGER")] }, async (request, reply) => {
    const orgId = getOrganizationId(request);
    const query = orderHistoryQuerySchema.parse(request.query);

    const conditions: any[] = [
      eq(cloudSchema.orders.organizationId, orgId),
    ];
    if (query.outletId && query.outletId !== "all") {
      conditions.push(eq(cloudSchema.orders.outletId, query.outletId));
    }

    // Date range filter
    if (query.startDate || query.endDate) {
      // Business-local calendar days (not the server's time zone)
      const tz = await getOrgTimeZone(orgId);
      if (query.startDate) {
        conditions.push(gte(cloudSchema.orders.createdAt, startOfLocalDay(query.startDate, tz)));
      }
      if (query.endDate) {
        conditions.push(lt(cloudSchema.orders.createdAt, localDayRange(query.endDate, query.endDate, tz).endExclusive));
      }
    }

    // Status filter
    if (query.status) {
      conditions.push(eq(cloudSchema.orders.status, query.status));
    }

    // Payment mode filter
    if (query.paymentMode) {
      conditions.push(eq(cloudSchema.orders.paymentMode, query.paymentMode));
    }

    // Order mode filter
    if (query.orderMode) {
      conditions.push(eq(cloudSchema.orders.orderMode, query.orderMode));
    }

    // Amount range filters
    if (query.minAmount !== undefined) {
      conditions.push(
        sql`CAST(${cloudSchema.orders.totalAmount} AS NUMERIC) >= ${query.minAmount}`
      );
    }
    if (query.maxAmount !== undefined) {
      conditions.push(
        sql`CAST(${cloudSchema.orders.totalAmount} AS NUMERIC) <= ${query.maxAmount}`
      );
    }

    // Search (order number, customer name, phone)
    if (query.search) {
      const searchTerm = `%${query.search}%`;
      conditions.push(
        sql`(
          ${cloudSchema.orders.orderNumber} ILIKE ${searchTerm} OR
          ${cloudSchema.orders.customerName} ILIKE ${searchTerm} OR
          ${cloudSchema.orders.customerPhone} ILIKE ${searchTerm}
        )`
      );
    }

    const where = and(...conditions);

    // Determine sort field
    const sortColumn =
      query.sortBy === "amount"
        ? cloudSchema.orders.totalAmount
        : query.sortBy === "orderNumber"
        ? cloudSchema.orders.orderNumber
        : cloudSchema.orders.createdAt;

    const [orders, totalResult] = await Promise.all([
      db.query.orders.findMany({
        where,
        limit: query.limit,
        offset: (query.page - 1) * query.limit,
        orderBy: (o, { asc, desc }) =>
          query.order === "asc" ? [asc(sortColumn)] : [desc(sortColumn)],
        with: {
          items: true,
          invoice: true,
        },
      }),
      db.select({ count: count() }).from(cloudSchema.orders).where(where),
    ]);

    const formattedOrders = orders.map((order) => ({
      ...order,
      subtotal: Number(order.subtotal),
      discountAmount: Number(order.discountAmount),
      taxAmount: Number(order.taxAmount),
      totalAmount: Number(order.totalAmount),
      items: order.items.map((item) => ({
        ...item,
        unitPrice: Number(item.unitPrice),
        modifiers: item.modifiers ? JSON.parse(item.modifiers as string) : [],
      })),
      invoice: order.invoice
        ? {
            ...order.invoice,
            subtotal: Number(order.invoice.subtotal),
            discountAmount: Number(order.invoice.discountAmount),
            cgstRate: Number(order.invoice.cgstRate),
            cgstAmount: Number(order.invoice.cgstAmount),
            sgstRate: Number(order.invoice.sgstRate),
            sgstAmount: Number(order.invoice.sgstAmount),
            totalAmount: Number(order.invoice.totalAmount),
          }
        : null,
    }));

    const total = totalResult[0]?.count ?? 0;
    return reply.send(paginated(formattedOrders, total, query.page, query.limit));
  });

  // ─── Get Invoice Detail (for a specific order) ───
  fastify.get("/api/v1/orders/:id/invoice", { preHandler: [requireMinRole("MANAGER")] }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const orgId = getOrganizationId(request);

    const order = await db.query.orders.findFirst({
      where: and(
        eq(cloudSchema.orders.id, id),
        eq(cloudSchema.orders.organizationId, orgId)
      ),
      with: {
        items: true,
        invoice: true,
        outlet: true,
      },
    });

    if (!order) {
      return reply.status(404).send(error("Order not found"));
    }

    // Get the organization details
    const org = await db.query.organizations.findFirst({
      where: eq(cloudSchema.organizations.id, orgId),
    });

    const formattedOrder = {
      ...order,
      subtotal: Number(order.subtotal),
      discountAmount: Number(order.discountAmount),
      taxAmount: Number(order.taxAmount),
      totalAmount: Number(order.totalAmount),
      items: order.items.map((item) => ({
        ...item,
        unitPrice: Number(item.unitPrice),
        modifiers: item.modifiers ? JSON.parse(item.modifiers as string) : [],
      })),
    };

    const invoiceData = order.invoice
      ? {
          ...order.invoice,
          subtotal: Number(order.invoice.subtotal),
          discountAmount: Number(order.invoice.discountAmount),
          cgstRate: Number(order.invoice.cgstRate),
          cgstAmount: Number(order.invoice.cgstAmount),
          sgstRate: Number(order.invoice.sgstRate),
          sgstAmount: Number(order.invoice.sgstAmount),
          totalAmount: Number(order.invoice.totalAmount),
        }
      : null;

    return reply.send(
      success({
        order: formattedOrder,
        invoice: invoiceData,
        outlet: {
          id: order.outlet.id,
          name: order.outlet.name,
          address: order.outlet.address,
          phone: order.outlet.phone,
          gstNumber: order.outlet.gstNumber,
          fssaiLicenseNo: (order.outlet as any).fssaiLicenseNo || null,
        },
        organization: org
          ? {
              id: org.id,
              name: org.name,
              gstNumber: org.gstNumber,
            }
          : null,
      })
    );
  });

  // ─── Download Invoice PDF ───
  fastify.get("/api/v1/orders/:id/invoice/pdf", { preHandler: [requireMinRole("MANAGER")] }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const orgId = getOrganizationId(request);

    const order = await db.query.orders.findFirst({
      where: and(
        eq(cloudSchema.orders.id, id),
        eq(cloudSchema.orders.organizationId, orgId)
      ),
      with: {
        items: true,
        invoice: true,
        outlet: true,
      },
    });

    if (!order) {
      return reply.status(404).send(error("Order not found"));
    }

    const org = await db.query.organizations.findFirst({
      where: eq(cloudSchema.organizations.id, orgId),
    });

    // Build PDF data
    const pdfData: InvoicePdfData = {
      orgName: org?.name || "Gustos",
      orgGstNumber: org?.gstNumber,
      outletName: order.outlet.name,
      outletAddress: order.outlet.address || "",
      outletPhone: order.outlet.phone,
      outletGstNumber: order.outlet.gstNumber,
      outletFssaiNo: (order.outlet as any).fssaiLicenseNo || null,
      invoiceNumber: order.invoice?.invoiceNumber || order.orderNumber,
      invoiceDate: new Date(order.createdAt).toLocaleString("en-IN", {
        dateStyle: "medium",
        timeStyle: "short",
        timeZone: "Asia/Kolkata",
      }),
      receiptStatus: order.invoice?.receiptStatus || "ORIGINAL",
      orderNumber: order.orderNumber,
      orderMode: order.orderMode,
      tableName: order.tableId || null,
      customerName: order.customerName,
      customerPhone: order.customerPhone,
      waiterName: order.waiterName,
      cashierName: order.cashierName,
      paxCount: order.paxCount,
      items: order.items.map((item) => ({
        name: item.menuItemName,
        variantName: item.variantName,
        quantity: item.quantity,
        unitPrice: Number(item.unitPrice),
        gstRate: item.gstRate,
        modifiers: item.modifiers
          ? JSON.parse(item.modifiers as string)
          : [],
        total: Number(item.unitPrice) * item.quantity,
      })),
      subtotal: Number(order.subtotal),
      discountAmount: Number(order.discountAmount),
      discountLabel: order.discountLabel,
      cgstRate: order.invoice ? Number(order.invoice.cgstRate) : 2.5,
      cgstAmount: order.invoice
        ? Number(order.invoice.cgstAmount)
        : Number(order.taxAmount) / 2,
      sgstRate: order.invoice ? Number(order.invoice.sgstRate) : 2.5,
      sgstAmount: order.invoice
        ? Number(order.invoice.sgstAmount)
        : Number(order.taxAmount) / 2,
      totalQuantity: order.invoice
        ? order.invoice.totalQuantity
        : order.items.reduce((s, i) => s + i.quantity, 0),
      totalAmount: Number(order.totalAmount),
      paymentMode: order.paymentMode || "CASH",
      paymentSubMethod: order.paymentSubMethod,
      isPaid: order.invoice?.isPaid ?? order.status === "COMPLETED",
    };

    const pdfBuffer = await generateInvoicePdf(pdfData);

    const filename = `Invoice_${order.orderNumber}_${new Date().toISOString().split("T")[0]}.pdf`;
    return reply
      .header("Content-Type", "application/pdf")
      .header(
        "Content-Disposition",
        `attachment; filename="${filename}"`
      )
      .send(pdfBuffer);
  });

  // ─── Export Orders CSV ───
  fastify.get("/api/v1/orders/export/csv", { preHandler: [requireMinRole("MANAGER")] }, async (request, reply) => {
    const orgId = getOrganizationId(request);
    const query = orderHistoryQuerySchema.parse(request.query);

    const conditions: any[] = [
      eq(cloudSchema.orders.organizationId, orgId),
    ];
    if (query.outletId && query.outletId !== "all") {
      conditions.push(eq(cloudSchema.orders.outletId, query.outletId));
    }

    if (query.startDate || query.endDate) {
      // Business-local calendar days (not the server's time zone)
      const tz = await getOrgTimeZone(orgId);
      if (query.startDate) {
        conditions.push(gte(cloudSchema.orders.createdAt, startOfLocalDay(query.startDate, tz)));
      }
      if (query.endDate) {
        conditions.push(lt(cloudSchema.orders.createdAt, localDayRange(query.endDate, query.endDate, tz).endExclusive));
      }
    }
    if (query.status) {
      conditions.push(eq(cloudSchema.orders.status, query.status));
    }

    const orders = await db.query.orders.findMany({
      where: and(...conditions),
      orderBy: (o, { desc }) => [desc(o.createdAt)],
      with: { items: true },
    });

    // Build CSV
    const headers = [
      "Order Number",
      "Date",
      "Time",
      "Type",
      "Status",
      "Items",
      "Subtotal",
      "Discount",
      "Tax",
      "Total",
      "Payment Mode",
      "Customer Name",
      "Customer Phone",
      "Waiter",
    ];

    const rows = orders.map((o) => [
      o.orderNumber,
      new Date(o.createdAt).toLocaleDateString("en-IN"),
      new Date(o.createdAt).toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit" }),
      o.orderMode,
      o.status,
      String(o.items.reduce((s, i) => s + i.quantity, 0)),
      Number(o.subtotal).toFixed(2),
      Number(o.discountAmount).toFixed(2),
      Number(o.taxAmount).toFixed(2),
      Number(o.totalAmount).toFixed(2),
      o.paymentMode || "",
      o.customerName || "",
      o.customerPhone || "",
      o.waiterName || "",
    ]);

    const csvContent = [
      headers.join(","),
      ...rows.map((r) => r.map((v) => `"${v}"`).join(",")),
    ].join("\n");

    const filename = `Orders_${query.startDate || "all"}_to_${query.endDate || "all"}.csv`;
    return reply
      .header("Content-Type", "text/csv")
      .header("Content-Disposition", `attachment; filename="${filename}"`)
      .send(csvContent);
  });
}

