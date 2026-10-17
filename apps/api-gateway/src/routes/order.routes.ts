/**
 * Gusto Cloud API Gateway — Order Routes (Local-First)
 *
 * Simple CRUD for order management. The real-time order lifecycle
 * is handled by the pos-local-server; this is for cloud sync and admin.
 */

import type { FastifyInstance } from "fastify";
import { eq, and, count, ilike, sql } from "drizzle-orm";
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

    const formattedOrders = orders.map(order => ({
      ...order,
      subtotal: Number(order.subtotal),
      discountAmount: Number(order.discountAmount),
      taxAmount: Number(order.taxAmount),
      totalAmount: Number(order.totalAmount),
      items: order.items.map(item => ({
        ...item,
        unitPrice: Number(item.unitPrice),
        modifiers: item.modifiers ? JSON.parse(item.modifiers as string) : []
      }))
    }));

    const total = totalResult[0]?.count ?? 0;
    return reply.send(paginated(formattedOrders, total, query.page, query.limit));
  });

  // ─── Create Order ───
  fastify.post("/api/v1/orders", { preHandler: [requireMinRole("MANAGER")] }, async (request, reply) => {
    const orgId = getOrganizationId(request);
    const body = createOrderSchema.parse(request.body);

    // Simple order number generation for now
    const orderNumber = `ORD-${Date.now().toString().slice(-6)}`;

    // Note: A real implementation would calculate totals and handle items transactionally
    const results = await db
      .insert(cloudSchema.orders)
      .values({
        organizationId: orgId,
        outletId: body.outletId,
        tableId: body.tableId || null,
        orderNumber,
        status: body.status,
        paymentMode: body.paymentMode || null,
        customerId: body.customerId || null,
        waiterId: body.waiterId || null,
        notes: body.notes || null,
      })
      .returning();
      
    const order = results[0]!;

    if (body.items.length > 0) {
      const itemsToInsert = await Promise.all(body.items.map(async item => {
        const menuItem = await db.query.menuItems.findFirst({
          where: eq(cloudSchema.menuItems.id, item.menuItemId)
        });

        // --- INVENTORY DEDUCTION LOGIC ---
        const recipe = await db.query.recipes.findFirst({
          where: eq(cloudSchema.recipes.menuItemId, item.menuItemId),
          with: { ingredients: true }
        });

        if (recipe && recipe.ingredients.length > 0) {
          for (const ingredient of recipe.ingredients) {
            const deductionQuantity = Number(ingredient.quantity) * item.quantity;
            
            const invItem = await db.query.inventoryItems.findFirst({
              where: eq(cloudSchema.inventoryItems.id, ingredient.inventoryItemId)
            });

            if (invItem) {
              const currentStock = Number(invItem.currentStock);
              const balanceAfter = currentStock - deductionQuantity;

              await db.update(cloudSchema.inventoryItems)
                .set({ currentStock: String(balanceAfter) })
                .where(eq(cloudSchema.inventoryItems.id, invItem.id));

              await db.insert(cloudSchema.stockTransactions).values({
                organizationId: orgId,
                inventoryItemId: invItem.id,
                orderId: order.id,
                type: "ORDER_DEDUCTION",
                quantityChange: String(-deductionQuantity),
                balanceAfter: String(balanceAfter),
                notes: `Deducted for Order ${orderNumber}`,
              });
            }
          }
        }
        // ---------------------------------
        
        return {
          orderId: order.id,
          menuItemId: item.menuItemId,
          menuItemName: menuItem?.name || "Unknown Item",
          quantity: item.quantity,
          unitPrice: menuItem?.price ? String(menuItem.price) : "0",
          gstRate: menuItem?.gstRate || "5",
          modifiers: JSON.stringify(item.modifiers),
          notes: item.notes || null,
        };
      }));

      await db.insert(cloudSchema.orderItems).values(itemsToInsert);
    }

    const createdOrder = await db.query.orders.findFirst({
      where: eq(cloudSchema.orders.id, order.id),
      with: { items: true }
    });

    return reply.status(201).send(success(createdOrder, "Order created"));
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

    const formattedOrder = {
      ...order,
      subtotal: Number(order.subtotal),
      discountAmount: Number(order.discountAmount),
      taxAmount: Number(order.taxAmount),
      totalAmount: Number(order.totalAmount),
      items: order.items.map(item => ({
        ...item,
        unitPrice: Number(item.unitPrice),
        modifiers: item.modifiers ? JSON.parse(item.modifiers as string) : []
      }))
    };

    return reply.send(success(formattedOrder));
  });

  // ─── Update Order ───
  fastify.put("/api/v1/orders/:id", { preHandler: [requireMinRole("MANAGER")] }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const orgId = getOrganizationId(request);
    const body = updateOrderSchema.parse(request.body);

    const updateData: any = { updatedAt: new Date() };
    if (body.status !== undefined) updateData.status = body.status;
    if (body.tableId !== undefined) updateData.tableId = body.tableId;
    if (body.paymentMode !== undefined) updateData.paymentMode = body.paymentMode;
    if (body.customerId !== undefined) updateData.customerId = body.customerId;
    if (body.waiterId !== undefined) updateData.waiterId = body.waiterId;
    if (body.notes !== undefined) updateData.notes = body.notes;

    const results = await db
      .update(cloudSchema.orders)
      .set(updateData)
      .where(
        and(
          eq(cloudSchema.orders.id, id),
          eq(cloudSchema.orders.organizationId, orgId)
        )
      )
      .returning();

    const updated = results[0];
    if (!updated) {
      return reply.status(404).send(error("Order not found"));
    }
    
    // Simplistic items update logic for demo (usually involves careful diffing)
    if (body.items) {
      await db.delete(cloudSchema.orderItems).where(eq(cloudSchema.orderItems.orderId, id));
      if (body.items.length > 0) {
        const itemsToInsert = await Promise.all(body.items.map(async item => {
          const menuItem = await db.query.menuItems.findFirst({
            where: eq(cloudSchema.menuItems.id, item.menuItemId)
          });
          
          return {
            orderId: id,
            menuItemId: item.menuItemId,
            menuItemName: menuItem?.name || "Unknown Item",
            quantity: item.quantity,
            unitPrice: menuItem?.price ? String(menuItem.price) : "0",
            gstRate: menuItem?.gstRate || "5",
            modifiers: JSON.stringify(item.modifiers),
            notes: item.notes || null,
          };
        }));
  
        await db.insert(cloudSchema.orderItems).values(itemsToInsert);
      }
    }

    const finalOrder = await db.query.orders.findFirst({
      where: eq(cloudSchema.orders.id, id),
      with: { items: true }
    });

    return reply.send(success(finalOrder, "Order updated"));
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

    if (results.length === 0) {
      return reply.status(404).send(error("Order not found"));
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
    if (query.startDate) {
      conditions.push(
        sql`${cloudSchema.orders.createdAt} >= ${new Date(`${query.startDate}T00:00:00`)}`
      );
    }
    if (query.endDate) {
      conditions.push(
        sql`${cloudSchema.orders.createdAt} <= ${new Date(`${query.endDate}T23:59:59`)}`
      );
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

    if (query.startDate) {
      conditions.push(
        sql`${cloudSchema.orders.createdAt} >= ${new Date(`${query.startDate}T00:00:00`)}`
      );
    }
    if (query.endDate) {
      conditions.push(
        sql`${cloudSchema.orders.createdAt} <= ${new Date(`${query.endDate}T23:59:59`)}`
      );
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

