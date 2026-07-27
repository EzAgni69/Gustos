/**
 * Gusto Cloud API Gateway — Order Routes (Cloud-Only MVP)
 *
 * Full order lifecycle management with real-time Socket.IO events.
 *
 * GET    /api/v1/orders             — List orders (tenant-scoped, filters)
 * POST   /api/v1/orders             — Create order (with auto-sequencing)
 * GET    /api/v1/orders/:id         — Get order with items & KOTs
 * PUT    /api/v1/orders/:id         — Update order
 * DELETE /api/v1/orders/:id         — Delete order
 *
 * POST   /api/v1/orders/:id/items        — Add items to order
 * DELETE /api/v1/orders/:id/items/:itemId — Remove item from order
 * POST   /api/v1/orders/:id/discount     — Apply discount
 * PATCH  /api/v1/orders/:id/table        — Move order to different table
 * PATCH  /api/v1/orders/:id/status       — Update order status
 */

import type { FastifyInstance } from "fastify";
import { eq, and, count, ilike } from "drizzle-orm";
import {
  createOrderSchema,
  updateOrderSchema,
  listOrdersQuerySchema,
} from "@gusto/api-contracts";
import * as schema from "@gusto/db-schema/cloud";
import { db } from "../db/index.js";
import { getOrganizationId, requireMinRole } from "../middleware/auth.js";
import { success, paginated, error } from "../utils/response.js";
import { getNextOrderNumber } from "../services/sequence.service.js";
import {
  calculateCartTotals,
  type CartItem,
  type DiscountConfig,
  type GSTRate,
} from "@gusto/core-logic";
import {
  emitOrderCreated,
  emitOrderUpdated,
  emitTableStatusChanged,
} from "../socket/events.js";

// ─── Helper: Recalculate order totals ───
async function recalculateOrderTotals(orderId: string) {
  const order = await db.query.orders.findFirst({
    where: eq(schema.orders.id, orderId),
    with: { items: true },
  });

  if (!order) return;

  const cartItems: CartItem[] = order.items.map((item) => ({
    menuItemId: item.menuItemId,
    menuItemName: item.menuItemName,
    quantity: item.quantity,
    unitPrice: Number(item.unitPrice),
    gstRate: item.gstRate as GSTRate,
    modifiers: item.modifiers
      ? JSON.parse(item.modifiers as string)
      : undefined,
  }));

  let discount: DiscountConfig | undefined;
  if (order.discountType && order.discountValue) {
    discount = {
      type: order.discountType as "PERCENTAGE" | "FLAT",
      value: Number(order.discountValue),
    };
  }

  const totals = calculateCartTotals(cartItems, discount);

  await db
    .update(schema.orders)
    .set({
      subtotal: String(totals.subtotal),
      discountAmount: String(totals.discountAmount),
      taxAmount: String(totals.totalTax),
      totalAmount: String(totals.grandTotal),
      updatedAt: new Date(),
    })
    .where(eq(schema.orders.id, orderId));

  return totals;
}

// ─── Helper: Format order for response ───
function formatOrder(order: any) {
  return {
    ...order,
    subtotal: Number(order.subtotal),
    discountAmount: Number(order.discountAmount),
    taxAmount: Number(order.taxAmount),
    totalAmount: Number(order.totalAmount),
    discountValue: order.discountValue ? Number(order.discountValue) : null,
    items: order.items?.map((item: any) => ({
      ...item,
      unitPrice: Number(item.unitPrice),
      modifiers: item.modifiers ? JSON.parse(item.modifiers as string) : [],
    })),
  };
}

export async function orderRoutes(fastify: FastifyInstance) {
  fastify.addHook("preHandler", fastify.authenticate);

  // ─── List Orders ───
  fastify.get(
    "/api/v1/orders",
    { preHandler: [requireMinRole("WAITER")] },
    async (request, reply) => {
      const orgId = getOrganizationId(request);
      const query = listOrdersQuerySchema.parse(request.query);

      const conditions = [
        eq(schema.orders.organizationId, orgId),
        eq(schema.orders.outletId, query.outletId),
      ];

      if (query.status) {
        conditions.push(eq(schema.orders.status, query.status));
      }

      if (query.search) {
        conditions.push(
          ilike(schema.orders.orderNumber, `%${query.search}%`)
        );
      }

      const where = and(...conditions);

      const [orders, totalResult] = await Promise.all([
        db.query.orders.findMany({
          where,
          limit: query.limit,
          offset: (query.page - 1) * query.limit,
          orderBy: (o, { desc }) => [desc(o.createdAt)],
          with: {
            items: true,
            table: true,
            kots: { with: { items: true } },
          },
        }),
        db.select({ count: count() }).from(schema.orders).where(where),
      ]);

      const formattedOrders = orders.map(formatOrder);
      const total = totalResult[0]?.count ?? 0;
      return reply.send(
        paginated(formattedOrders, total, query.page, query.limit)
      );
    }
  );

  // ─── Create Order ───
  fastify.post(
    "/api/v1/orders",
    { preHandler: [requireMinRole("WAITER")] },
    async (request, reply) => {
      const orgId = getOrganizationId(request);
      const body = createOrderSchema.parse(request.body);

      // Generate sequential order number
      const orderNumber = await getNextOrderNumber(body.outletId);

      // Create order
      const orderResults = await db
        .insert(schema.orders)
        .values({
          organizationId: orgId,
          outletId: body.outletId,
          tableId: body.tableId || null,
          orderNumber,
          orderMode: (body as any).orderMode || "DINE_IN",
          status: body.status || "DRAFT",
          paymentMode: body.paymentMode || null,
          customerId: body.customerId || null,
          customerName: (body as any).customerName || null,
          customerPhone: (body as any).customerPhone || null,
          waiterId: body.waiterId || null,
          waiterName: (body as any).waiterName || null,
          paxCount: (body as any).paxCount || 1,
          notes: body.notes || null,
        })
        .returning();
      const order = orderResults[0]!;

      // Insert items
      if (body.items && body.items.length > 0) {
        const itemsToInsert = await Promise.all(
          body.items.map(async (item) => {
            const menuItem = await db.query.menuItems.findFirst({
              where: eq(schema.menuItems.id, item.menuItemId),
            });

            return {
              orderId: order.id,
              menuItemId: item.menuItemId,
              menuItemName: menuItem?.name || "Unknown Item",
              quantity: item.quantity,
              unitPrice: menuItem?.price
                ? String(menuItem.price)
                : "0",
              gstRate: (menuItem?.gstRate as any) || "5",
              modifiers: JSON.stringify(item.modifiers || []),
              notes: item.notes || null,
            };
          })
        );

        await db.insert(schema.orderItems).values(itemsToInsert);
      }

      // Recalculate totals
      await recalculateOrderTotals(order.id);

      // Update table status if dine-in
      if (body.tableId) {
        await db
          .update(schema.diningTables)
          .set({ status: "OCCUPIED" })
          .where(eq(schema.diningTables.id, body.tableId));

        emitTableStatusChanged(body.outletId, {
          tableId: body.tableId,
          status: "OCCUPIED",
          orderId: order.id,
        });
      }

      // Fetch full order with items
      const createdOrder = await db.query.orders.findFirst({
        where: eq(schema.orders.id, order.id),
        with: { items: true, table: true },
      });

      const formatted = formatOrder(createdOrder);

      // Emit socket event
      emitOrderCreated(body.outletId, {
        type: "ORDER_CREATED",
        orderId: order.id,
        orderNumber,
        order: formatted,
      });

      console.log(`📝 ORDER CREATED — ${orderNumber}`);

      return reply.status(201).send(success(formatted, "Order created"));
    }
  );

  // ─── Get Order ───
  fastify.get(
    "/api/v1/orders/:id",
    { preHandler: [requireMinRole("WAITER")] },
    async (request, reply) => {
      const { id } = request.params as { id: string };
      const orgId = getOrganizationId(request);

      const order = await db.query.orders.findFirst({
        where: and(
          eq(schema.orders.id, id),
          eq(schema.orders.organizationId, orgId)
        ),
        with: {
          items: true,
          table: true,
          kots: { with: { items: true } },
          invoice: true,
        },
      });

      if (!order) {
        return reply.status(404).send(error("Order not found"));
      }

      return reply.send(success(formatOrder(order)));
    }
  );

  // ─── Update Order ───
  fastify.put(
    "/api/v1/orders/:id",
    { preHandler: [requireMinRole("WAITER")] },
    async (request, reply) => {
      const { id } = request.params as { id: string };
      const orgId = getOrganizationId(request);
      const body = updateOrderSchema.parse(request.body);

      const existingOrder = await db.query.orders.findFirst({
        where: and(
          eq(schema.orders.id, id),
          eq(schema.orders.organizationId, orgId)
        ),
      });

      if (!existingOrder) {
        return reply.status(404).send(error("Order not found"));
      }

      const updateData: any = { updatedAt: new Date() };
      if (body.status !== undefined) updateData.status = body.status;
      if (body.tableId !== undefined) updateData.tableId = body.tableId;
      if (body.paymentMode !== undefined)
        updateData.paymentMode = body.paymentMode;
      if (body.customerId !== undefined)
        updateData.customerId = body.customerId;
      if (body.waiterId !== undefined) updateData.waiterId = body.waiterId;
      if (body.notes !== undefined) updateData.notes = body.notes;

      await db
        .update(schema.orders)
        .set(updateData)
        .where(eq(schema.orders.id, id));

      // Update items if provided
      if (body.items) {
        await db
          .delete(schema.orderItems)
          .where(eq(schema.orderItems.orderId, id));
        if (body.items.length > 0) {
          const itemsToInsert = await Promise.all(
            body.items.map(async (item) => {
              const menuItem = await db.query.menuItems.findFirst({
                where: eq(schema.menuItems.id, item.menuItemId),
              });

              return {
                orderId: id,
                menuItemId: item.menuItemId,
                menuItemName: menuItem?.name || "Unknown Item",
                quantity: item.quantity,
                unitPrice: menuItem?.price
                  ? String(menuItem.price)
                  : "0",
                gstRate: (menuItem?.gstRate as any) || "5",
                modifiers: JSON.stringify(item.modifiers || []),
                notes: item.notes || null,
              };
            })
          );

          await db.insert(schema.orderItems).values(itemsToInsert);
        }

        // Recalculate totals
        await recalculateOrderTotals(id);
      }

      const finalOrder = await db.query.orders.findFirst({
        where: eq(schema.orders.id, id),
        with: { items: true, table: true },
      });

      const formatted = formatOrder(finalOrder);

      // Emit socket event
      emitOrderUpdated(existingOrder.outletId, {
        type: "ORDER_UPDATED",
        orderId: id,
        orderNumber: existingOrder.orderNumber,
        order: formatted,
      });

      return reply.send(success(formatted, "Order updated"));
    }
  );

  // ─── Delete Order ───
  fastify.delete(
    "/api/v1/orders/:id",
    { preHandler: [requireMinRole("MANAGER")] },
    async (request, reply) => {
      const { id } = request.params as { id: string };
      const orgId = getOrganizationId(request);

      const order = await db.query.orders.findFirst({
        where: and(
          eq(schema.orders.id, id),
          eq(schema.orders.organizationId, orgId)
        ),
      });

      if (!order) {
        return reply.status(404).send(error("Order not found"));
      }

      // Release table if assigned
      if (order.tableId) {
        await db
          .update(schema.diningTables)
          .set({ status: "AVAILABLE" })
          .where(eq(schema.diningTables.id, order.tableId));

        emitTableStatusChanged(order.outletId, {
          tableId: order.tableId,
          status: "AVAILABLE",
        });
      }

      await db.delete(schema.orders).where(eq(schema.orders.id, id));

      emitOrderUpdated(order.outletId, {
        type: "ORDER_DELETED",
        orderId: id,
        orderNumber: order.orderNumber,
      });

      return reply.send(success(null, "Order deleted"));
    }
  );

  // ─── Add Items to Order ───
  fastify.post(
    "/api/v1/orders/:id/items",
    { preHandler: [requireMinRole("WAITER")] },
    async (request, reply) => {
      const { id } = request.params as { id: string };
      const orgId = getOrganizationId(request);
      const body = request.body as {
        items: {
          menuItemId: string;
          quantity: number;
          modifiers?: string[];
          notes?: string;
        }[];
      };

      const order = await db.query.orders.findFirst({
        where: and(
          eq(schema.orders.id, id),
          eq(schema.orders.organizationId, orgId)
        ),
      });

      if (!order) {
        return reply.status(404).send(error("Order not found"));
      }

      if (
        order.status === "COMPLETED" ||
        order.status === "CANCELLED"
      ) {
        return reply
          .status(400)
          .send(error("Cannot add items to a completed or cancelled order"));
      }

      // Insert new items
      const itemsToInsert = await Promise.all(
        body.items.map(async (item) => {
          const menuItem = await db.query.menuItems.findFirst({
            where: eq(schema.menuItems.id, item.menuItemId),
          });

          return {
            orderId: id,
            menuItemId: item.menuItemId,
            menuItemName: menuItem?.name || "Unknown Item",
            quantity: item.quantity,
            unitPrice: menuItem?.price ? String(menuItem.price) : "0",
            gstRate: (menuItem?.gstRate as any) || "5",
            modifiers: JSON.stringify(item.modifiers || []),
            notes: item.notes || null,
          };
        })
      );

      await db.insert(schema.orderItems).values(itemsToInsert);

      // Recalculate totals
      const totals = await recalculateOrderTotals(id);

      const updatedOrder = await db.query.orders.findFirst({
        where: eq(schema.orders.id, id),
        with: { items: true, table: true },
      });

      const formatted = formatOrder(updatedOrder);

      emitOrderUpdated(order.outletId, {
        type: "ITEMS_ADDED",
        orderId: id,
        orderNumber: order.orderNumber,
        order: formatted,
      });

      return reply.send(success(formatted, "Items added to order"));
    }
  );

  // ─── Remove Item from Order ───
  fastify.delete(
    "/api/v1/orders/:id/items/:itemId",
    { preHandler: [requireMinRole("WAITER")] },
    async (request, reply) => {
      const { id, itemId } = request.params as {
        id: string;
        itemId: string;
      };
      const orgId = getOrganizationId(request);

      const order = await db.query.orders.findFirst({
        where: and(
          eq(schema.orders.id, id),
          eq(schema.orders.organizationId, orgId)
        ),
      });

      if (!order) {
        return reply.status(404).send(error("Order not found"));
      }

      if (
        order.status === "COMPLETED" ||
        order.status === "CANCELLED"
      ) {
        return reply
          .status(400)
          .send(
            error("Cannot remove items from a completed or cancelled order")
          );
      }

      const item = await db.query.orderItems.findFirst({
        where: and(
          eq(schema.orderItems.id, itemId),
          eq(schema.orderItems.orderId, id)
        ),
      });

      if (!item) {
        return reply
          .status(404)
          .send(error("Item not found in this order"));
      }

      await db
        .delete(schema.orderItems)
        .where(eq(schema.orderItems.id, itemId));

      // Recalculate totals
      await recalculateOrderTotals(id);

      const updatedOrder = await db.query.orders.findFirst({
        where: eq(schema.orders.id, id),
        with: { items: true, table: true },
      });

      const formatted = formatOrder(updatedOrder);

      emitOrderUpdated(order.outletId, {
        type: "ITEM_REMOVED",
        orderId: id,
        orderNumber: order.orderNumber,
        order: formatted,
      });

      return reply.send(success(formatted, "Item removed from order"));
    }
  );

  // ─── Apply Discount ───
  fastify.post(
    "/api/v1/orders/:id/discount",
    { preHandler: [requireMinRole("CASHIER")] },
    async (request, reply) => {
      const { id } = request.params as { id: string };
      const orgId = getOrganizationId(request);
      const body = request.body as {
        discountType: "PERCENTAGE" | "FLAT";
        discountValue: number;
      };

      const order = await db.query.orders.findFirst({
        where: and(
          eq(schema.orders.id, id),
          eq(schema.orders.organizationId, orgId)
        ),
      });

      if (!order) {
        return reply.status(404).send(error("Order not found"));
      }

      if (order.status === "COMPLETED") {
        return reply
          .status(400)
          .send(error("Cannot apply discount to a completed order"));
      }

      // Update discount fields
      await db
        .update(schema.orders)
        .set({
          discountType: body.discountType,
          discountValue: String(body.discountValue),
          updatedAt: new Date(),
        })
        .where(eq(schema.orders.id, id));

      // Recalculate totals
      await recalculateOrderTotals(id);

      const updatedOrder = await db.query.orders.findFirst({
        where: eq(schema.orders.id, id),
        with: { items: true, table: true },
      });

      const formatted = formatOrder(updatedOrder);

      emitOrderUpdated(order.outletId, {
        type: "DISCOUNT_APPLIED",
        orderId: id,
        orderNumber: order.orderNumber,
        order: formatted,
      });

      return reply.send(success(formatted, "Discount applied"));
    }
  );

  // ─── Move Order to Different Table ───
  fastify.patch(
    "/api/v1/orders/:id/table",
    { preHandler: [requireMinRole("WAITER")] },
    async (request, reply) => {
      const { id } = request.params as { id: string };
      const orgId = getOrganizationId(request);
      const body = request.body as { tableId: string };

      const order = await db.query.orders.findFirst({
        where: and(
          eq(schema.orders.id, id),
          eq(schema.orders.organizationId, orgId)
        ),
      });

      if (!order) {
        return reply.status(404).send(error("Order not found"));
      }

      // Release old table
      if (order.tableId) {
        await db
          .update(schema.diningTables)
          .set({ status: "AVAILABLE" })
          .where(eq(schema.diningTables.id, order.tableId));

        emitTableStatusChanged(order.outletId, {
          tableId: order.tableId,
          status: "AVAILABLE",
        });
      }

      // Assign new table
      await db
        .update(schema.orders)
        .set({ tableId: body.tableId, updatedAt: new Date() })
        .where(eq(schema.orders.id, id));

      await db
        .update(schema.diningTables)
        .set({ status: "OCCUPIED" })
        .where(eq(schema.diningTables.id, body.tableId));

      emitTableStatusChanged(order.outletId, {
        tableId: body.tableId,
        status: "OCCUPIED",
        orderId: id,
      });

      const updatedOrder = await db.query.orders.findFirst({
        where: eq(schema.orders.id, id),
        with: { items: true, table: true },
      });

      emitOrderUpdated(order.outletId, {
        type: "TABLE_MOVED",
        orderId: id,
        orderNumber: order.orderNumber,
        oldTableId: order.tableId,
        newTableId: body.tableId,
      });

      return reply.send(
        success(formatOrder(updatedOrder), "Order moved to new table")
      );
    }
  );

  // ─── Update Order Status ───
  fastify.patch(
    "/api/v1/orders/:id/status",
    { preHandler: [requireMinRole("WAITER")] },
    async (request, reply) => {
      const { id } = request.params as { id: string };
      const orgId = getOrganizationId(request);
      const body = request.body as { status: string };

      const order = await db.query.orders.findFirst({
        where: and(
          eq(schema.orders.id, id),
          eq(schema.orders.organizationId, orgId)
        ),
      });

      if (!order) {
        return reply.status(404).send(error("Order not found"));
      }

      await db
        .update(schema.orders)
        .set({ status: body.status as any, updatedAt: new Date() })
        .where(eq(schema.orders.id, id));

      // If cancelled, release table
      if (body.status === "CANCELLED" && order.tableId) {
        await db
          .update(schema.diningTables)
          .set({ status: "AVAILABLE" })
          .where(eq(schema.diningTables.id, order.tableId));

        emitTableStatusChanged(order.outletId, {
          tableId: order.tableId,
          status: "AVAILABLE",
        });
      }

      emitOrderUpdated(order.outletId, {
        type: "STATUS_CHANGED",
        orderId: id,
        orderNumber: order.orderNumber,
        status: body.status,
      });

      return reply.send(
        success({ orderId: id, status: body.status }, "Order status updated")
      );
    }
  );
}
