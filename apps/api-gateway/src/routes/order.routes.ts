/**
 * Gusto Cloud API Gateway — Order Routes (Local-First)
 *
 * Simple CRUD for order management. The real-time order lifecycle
 * is handled by the pos-local-server; this is for cloud sync and admin.
 */

import type { FastifyInstance } from "fastify";
import { eq, and, count, ilike } from "drizzle-orm";
import {
  createOrderSchema,
  updateOrderSchema,
  listOrdersQuerySchema,
} from "@gusto/api-contracts";
import * as cloudSchema from "@gusto/db-schema/cloud";
import { db } from "../db/index.js";
import { getOrganizationId, requireMinRole } from "../middleware/auth.js";
import { success, paginated, error } from "../utils/response.js";


export async function orderRoutes(fastify: FastifyInstance) {
  fastify.addHook("preHandler", fastify.authenticate);

  // ─── List Orders ───
  fastify.get("/api/v1/orders", { preHandler: [requireMinRole("MANAGER")] }, async (request, reply) => {
    const orgId = getOrganizationId(request);
    const query = listOrdersQuerySchema.parse(request.query);

    const conditions = [
      eq(cloudSchema.orders.organizationId, orgId),
      eq(cloudSchema.orders.outletId, query.outletId)
    ];

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
}
