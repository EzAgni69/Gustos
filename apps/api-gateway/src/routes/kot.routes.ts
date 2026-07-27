/**
 * Gusto Cloud API Gateway — KOT Routes
 *
 * Kitchen Order Ticket management for the cloud-only MVP.
 *
 * POST   /api/v1/orders/:orderId/kot       — Generate a KOT for pending items
 * GET    /api/v1/kots                       — List KOTs (with status filter)
 * PATCH  /api/v1/kots/:kotId/status         — Update KOT status (kitchen marks ready)
 */

import type { FastifyInstance } from "fastify";
import { eq, and } from "drizzle-orm";
import * as schema from "@gusto/db-schema/cloud";
import { db } from "../db/index.js";
import { getOrganizationId, requireMinRole } from "../middleware/auth.js";
import { success, error } from "../utils/response.js";
import { getNextKOTNumber } from "../services/sequence.service.js";
import {
  emitKOTNew,
  emitKOTStatusUpdate,
  emitOrderUpdated,
} from "../socket/events.js";

export async function kotRoutes(fastify: FastifyInstance) {
  fastify.addHook("preHandler", fastify.authenticate);

  // ─── Generate KOT ───
  fastify.post(
    "/api/v1/orders/:orderId/kot",
    { preHandler: [requireMinRole("WAITER")] },
    async (request, reply) => {
      const { orderId } = request.params as { orderId: string };
      const orgId = getOrganizationId(request);
      const body = request.body as {
        itemIds?: string[];
        station?: string;
      };

      // Get order
      const order = await db.query.orders.findFirst({
        where: and(
          eq(schema.orders.id, orderId),
          eq(schema.orders.organizationId, orgId)
        ),
        with: { items: true, table: true },
      });

      if (!order) {
        return reply.status(404).send(error("Order not found"));
      }

      // Filter items to send: either specific items or all unsent items
      const itemsToSend = body.itemIds
        ? order.items.filter((item) => body.itemIds!.includes(item.id))
        : order.items.filter((item) => !item.kotId);

      if (itemsToSend.length === 0) {
        return reply.status(400).send(error("No items to send to kitchen"));
      }

      // Generate KOT number
      const kotNumber = await getNextKOTNumber(order.outletId);

      // Create KOT record
      const results = await db
        .insert(schema.kitchenOrderTickets)
        .values({
          orderId,
          kotNumber,
          station: body.station ?? null,
          status: "PENDING",
        })
        .returning();
      const kot = results[0]!;

      // Create KOT items and link order items
      for (const item of itemsToSend) {
        await db.insert(schema.kotItems).values({
          kotId: kot.id,
          orderItemId: item.id,
          menuItemName: item.menuItemName,
          quantity: item.quantity,
          modifiers: item.modifiers,
          notes: item.notes,
        });

        // Link order item to this KOT
        await db
          .update(schema.orderItems)
          .set({ kotId: kot.id })
          .where(eq(schema.orderItems.id, item.id));
      }

      // Update order status to IN_PROGRESS
      if (order.status === "DRAFT" || order.status === "PLACED") {
        await db
          .update(schema.orders)
          .set({ status: "IN_PROGRESS", updatedAt: new Date() })
          .where(eq(schema.orders.id, orderId));
      }

      // Emit socket events
      const kotPayload = {
        kotId: kot.id,
        kotNumber,
        orderId,
        orderNumber: order.orderNumber,
        tableName: order.table?.name,
        waiterName: order.waiterName,
        station: body.station,
        items: itemsToSend.map((item) => ({
          name: item.menuItemName,
          quantity: item.quantity,
          modifiers: item.modifiers
            ? JSON.parse(item.modifiers as string)
            : [],
          notes: item.notes,
        })),
        createdAt: kot.createdAt,
      };

      emitKOTNew(order.outletId, kotPayload);

      console.log(
        `🍳 KOT FIRED — ${kotNumber} (Order: ${order.orderNumber})`
      );

      return reply.status(201).send(success(kotPayload, "KOT generated"));
    }
  );

  // ─── List KOTs ───
  fastify.get(
    "/api/v1/kots",
    { preHandler: [requireMinRole("WAITER")] },
    async (request, reply) => {
      const query = request.query as {
        outletId: string;
        status?: string;
      };

      if (!query.outletId) {
        return reply.status(400).send(error("outletId is required"));
      }

      const conditions = [
        eq(schema.kitchenOrderTickets.orderId, schema.orders.id),
      ];

      let kots;
      if (query.status) {
        kots = await db.query.kitchenOrderTickets.findMany({
          where: eq(
            schema.kitchenOrderTickets.status,
            query.status as any
          ),
          with: {
            items: true,
            order: {
              with: { table: true },
            },
          },
          orderBy: (k, { desc }) => [desc(k.createdAt)],
        });
      } else {
        kots = await db.query.kitchenOrderTickets.findMany({
          with: {
            items: true,
            order: {
              with: { table: true },
            },
          },
          orderBy: (k, { desc }) => [desc(k.createdAt)],
        });
      }

      // Filter by outlet (through order relation)
      const filteredKots = kots.filter(
        (kot) => kot.order?.outletId === query.outletId
      );

      const formatted = filteredKots.map((kot) => ({
        ...kot,
        orderNumber: kot.order?.orderNumber,
        tableName: kot.order?.table?.name,
        waiterName: kot.order?.waiterName,
        items: kot.items.map((item) => ({
          ...item,
          modifiers: item.modifiers
            ? JSON.parse(item.modifiers as string)
            : [],
        })),
      }));

      return reply.send(success(formatted));
    }
  );

  // ─── Update KOT Status ───
  fastify.patch(
    "/api/v1/kots/:kotId/status",
    { preHandler: [requireMinRole("CHEF")] },
    async (request, reply) => {
      const { kotId } = request.params as { kotId: string };
      const { status } = request.body as {
        status: "PENDING" | "IN_PROGRESS" | "READY" | "SERVED";
      };

      const kot = await db.query.kitchenOrderTickets.findFirst({
        where: eq(schema.kitchenOrderTickets.id, kotId),
        with: { order: true },
      });

      if (!kot) {
        return reply.status(404).send(error("KOT not found"));
      }

      // Update KOT status
      await db
        .update(schema.kitchenOrderTickets)
        .set({ status })
        .where(eq(schema.kitchenOrderTickets.id, kotId));

      // If marked READY, check if all KOTs for this order are ready
      if (status === "READY" && kot.order) {
        const allKOTs = await db.query.kitchenOrderTickets.findMany({
          where: eq(
            schema.kitchenOrderTickets.orderId,
            kot.orderId
          ),
        });

        const allReady = allKOTs.every(
          (k) =>
            k.id === kotId
              ? true
              : k.status === "READY" || k.status === "SERVED"
        );

        if (allReady) {
          await db
            .update(schema.orders)
            .set({ status: "READY", updatedAt: new Date() })
            .where(eq(schema.orders.id, kot.orderId));

          emitOrderUpdated(kot.order.outletId, {
            type: "ORDER_READY",
            orderId: kot.orderId,
            orderNumber: kot.order.orderNumber,
          });
        }
      }

      // Emit socket events
      if (kot.order) {
        emitKOTStatusUpdate(
          kot.order.outletId,
          kotId,
          status,
          kot.order.orderNumber
        );
      }

      return reply.send(
        success({ kotId, status, orderId: kot.orderId }, "KOT status updated")
      );
    }
  );
}
