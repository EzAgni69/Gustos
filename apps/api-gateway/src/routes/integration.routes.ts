/**
 * Gusto Cloud API Gateway — Integration Routes (Zomato)
 *
 * Zomato webhook receiver and integration config management.
 *
 * POST /api/v1/integrations/webhooks/zomato — Receive Zomato order webhook
 * GET  /api/v1/integrations/configs         — List integration configs
 * POST /api/v1/integrations/configs         — Create integration config
 * PUT  /api/v1/integrations/configs/:id     — Update integration config
 * DEL  /api/v1/integrations/configs/:id     — Delete integration config
 *
 * GET  /api/v1/integrations/online-orders         — List online orders
 * GET  /api/v1/integrations/online-orders/:id     — Get online order
 * PATCH /api/v1/integrations/online-orders/:id/status — Update online order status
 */

import type { FastifyInstance } from "fastify";
import crypto from "crypto";
import { eq, and, count } from "drizzle-orm";
import {
  zomatoWebhookOrderSchema,
  createIntegrationConfigSchema,
  updateIntegrationConfigSchema,
  listIntegrationConfigsQuerySchema,
  listOnlineOrdersQuerySchema,
  updateOnlineOrderStatusSchema,
} from "@gusto/api-contracts";
import * as schema from "@gusto/db-schema/cloud";
import { db } from "../db/index.js";
import { getOrganizationId, requireMinRole } from "../middleware/auth.js";
import { success, paginated, error } from "../utils/response.js";
import { webhookQueue } from "../config/queue.js";


export async function integrationRoutes(fastify: FastifyInstance) {
  // ─── Zomato Webhook (unauthenticated — verified by webhook secret) ───
  fastify.post("/api/v1/integrations/webhooks/zomato", async (request, reply) => {
    const body = zomatoWebhookOrderSchema.parse(request.body);

    // Find the integration config by restaurant ID
    const config = await db.query.integrationConfigs.findFirst({
      where: and(
        eq(schema.integrationConfigs.provider, "ZOMATO"),
        eq(schema.integrationConfigs.restaurantId, body.restaurant_id),
        eq(schema.integrationConfigs.isActive, true)
      ),
    });

    if (!config) {
      return reply
        .status(404)
        .send(error("No active Zomato integration found for this restaurant"));
    }

    // Phase 1: HMAC Verification
    const signature = request.headers["x-zomato-signature"] as string | undefined;
    if (config.webhookSecret && signature) {
      const hmac = crypto.createHmac("sha256", config.webhookSecret);
      hmac.update(JSON.stringify(request.body));
      const expectedSignature = hmac.digest("hex");
      if (signature !== expectedSignature) {
        return reply.status(401).send(error("Invalid webhook signature"));
      }
    } else if (config.webhookSecret && !signature) {
      return reply.status(401).send(error("Missing webhook signature"));
    }

    // Phase 1: Deduplication (Idempotency)
    const existingOrder = await db.query.onlineOrders.findFirst({
      where: and(
        eq(schema.onlineOrders.provider, "ZOMATO"),
        eq(schema.onlineOrders.externalOrderId, body.order_id),
        eq(schema.onlineOrders.outletId, config.outletId)
      ),
    });

    if (existingOrder) {
      console.log(`[Webhook] Duplicate Zomato order ${body.order_id} ignored`);
      return reply.status(200).send(
        success(
          { onlineOrderId: existingOrder.id, status: existingOrder.status },
          "Order already processed"
        )
      );
    }

    // Store the online order
    const results = await db
      .insert(schema.onlineOrders)
      .values({
        organizationId: config.organizationId,
        outletId: config.outletId,
        provider: "ZOMATO",
        externalOrderId: body.order_id,
        status: "RECEIVED",
        customerName: body.customer?.name || null,
        customerPhone: body.customer?.phone || null,
        deliveryAddress: body.customer?.address || null,
        itemsPayload: JSON.stringify(body.items),
        subtotal: String(body.subtotal),
        totalAmount: String(body.total),
        commissionAmount: String(body.commission || 0),
        rawWebhookPayload: JSON.stringify(request.body),
      })
      .returning();
    const onlineOrder = results[0]!;

    // TODO: Notify outlet devices about new online order (via sync or push)
    console.log(`📡 Online order received for outlet ${config.outletId}:`, {
      id: onlineOrder.id,
      provider: "ZOMATO",
      externalOrderId: body.order_id,
      customerName: body.customer?.name,
      totalAmount: body.total,
      status: "RECEIVED",
    });

    // Enqueue job to publish to POS and handle offline timeout
    await webhookQueue.add("process-zomato-webhook", {
      onlineOrderId: onlineOrder.id,
      organizationId: config.organizationId,
      outletId: config.outletId,
      payload: body,
    });

    console.log(`🍕 ZOMATO ORDER RECEIVED — ${body.order_id} → outlet ${config.outletId}`);

    return reply.status(200).send(
      success(
        { onlineOrderId: onlineOrder.id, status: "RECEIVED" },
        "Zomato order received and queued"
      )
    );
  });

  // ─── Integration Config CRUD (authenticated) ───

  // List configs
  fastify.get(
    "/api/v1/integrations/configs",
    { preHandler: [fastify.authenticate, requireMinRole("MANAGER")] },
    async (request, reply) => {
      const orgId = getOrganizationId(request);
      const query = listIntegrationConfigsQuerySchema.parse(request.query);

      const conditions = [eq(schema.integrationConfigs.organizationId, orgId)];
      if (query.outletId) {
        conditions.push(eq(schema.integrationConfigs.outletId, query.outletId));
      }
      if (query.provider) {
        conditions.push(eq(schema.integrationConfigs.provider, query.provider));
      }

      const configs = await db.query.integrationConfigs.findMany({
        where: and(...conditions),
        with: { outlet: true },
        orderBy: (c, { desc }) => [desc(c.createdAt)],
      });

      // Mask sensitive fields
      const masked = configs.map((c) => ({
        ...c,
        apiKey: c.apiKey ? "••••" + c.apiKey.slice(-4) : null,
        apiSecret: c.apiSecret ? "••••" : null,
        webhookSecret: c.webhookSecret ? "••••" : null,
      }));

      return reply.send(success(masked));
    }
  );

  // Create config
  fastify.post(
    "/api/v1/integrations/configs",
    { preHandler: [fastify.authenticate, requireMinRole("OWNER")] },
    async (request, reply) => {
      const orgId = getOrganizationId(request);
      const body = createIntegrationConfigSchema.parse(request.body);

      // Check for duplicate
      const existing = await db.query.integrationConfigs.findFirst({
        where: and(
          eq(schema.integrationConfigs.organizationId, orgId),
          eq(schema.integrationConfigs.outletId, body.outletId),
          eq(schema.integrationConfigs.provider, body.provider)
        ),
      });

      if (existing) {
        return reply
          .status(409)
          .send(error(`${body.provider} integration already exists for this outlet`));
      }

      const results = await db
        .insert(schema.integrationConfigs)
        .values({
          organizationId: orgId,
          ...body,
        })
        .returning();
      const config = results[0]!;

      return reply.status(201).send(success(config, "Integration config created"));
    }
  );

  // Update config
  fastify.put(
    "/api/v1/integrations/configs/:id",
    { preHandler: [fastify.authenticate, requireMinRole("OWNER")] },
    async (request, reply) => {
      const { id } = request.params as { id: string };
      const orgId = getOrganizationId(request);
      const body = updateIntegrationConfigSchema.parse(request.body);

      const results = await db
        .update(schema.integrationConfigs)
        .set({ ...body, updatedAt: new Date() })
        .where(
          and(
            eq(schema.integrationConfigs.id, id),
            eq(schema.integrationConfigs.organizationId, orgId)
          )
        )
        .returning();

      if (results.length === 0) {
        return reply.status(404).send(error("Integration config not found"));
      }

      return reply.send(success(results[0], "Integration config updated"));
    }
  );

  // Delete config
  fastify.delete(
    "/api/v1/integrations/configs/:id",
    { preHandler: [fastify.authenticate, requireMinRole("OWNER")] },
    async (request, reply) => {
      const { id } = request.params as { id: string };
      const orgId = getOrganizationId(request);

      const results = await db
        .delete(schema.integrationConfigs)
        .where(
          and(
            eq(schema.integrationConfigs.id, id),
            eq(schema.integrationConfigs.organizationId, orgId)
          )
        )
        .returning();

      if (results.length === 0) {
        return reply.status(404).send(error("Integration config not found"));
      }

      return reply.send(success(null, "Integration config deleted"));
    }
  );

  // ─── Online Orders ───

  // List online orders
  fastify.get(
    "/api/v1/integrations/online-orders",
    { preHandler: [fastify.authenticate, requireMinRole("CASHIER")] },
    async (request, reply) => {
      const orgId = getOrganizationId(request);
      const query = listOnlineOrdersQuerySchema.parse(request.query);

      const conditions = [
        eq(schema.onlineOrders.organizationId, orgId),
        eq(schema.onlineOrders.outletId, query.outletId),
      ];

      if (query.provider) {
        conditions.push(eq(schema.onlineOrders.provider, query.provider));
      }
      if (query.status) {
        conditions.push(eq(schema.onlineOrders.status, query.status));
      }

      const where = and(...conditions);

      const [orders, totalResult] = await Promise.all([
        db.query.onlineOrders.findMany({
          where,
          limit: query.limit,
          offset: (query.page - 1) * query.limit,
          orderBy: (o, { desc }) => [desc(o.receivedAt)],
        }),
        db.select({ count: count() }).from(schema.onlineOrders).where(where),
      ]);

      const total = totalResult[0]?.count ?? 0;
      const formatted = orders.map((o) => ({
        ...o,
        subtotal: Number(o.subtotal),
        totalAmount: Number(o.totalAmount),
        commissionAmount: Number(o.commissionAmount),
        itemsPayload: JSON.parse(o.itemsPayload),
      }));

      return reply.send(paginated(formatted, total, query.page, query.limit));
    }
  );

  // Get single online order
  fastify.get(
    "/api/v1/integrations/online-orders/:id",
    { preHandler: [fastify.authenticate, requireMinRole("CASHIER")] },
    async (request, reply) => {
      const { id } = request.params as { id: string };
      const orgId = getOrganizationId(request);

      const onlineOrder = await db.query.onlineOrders.findFirst({
        where: and(
          eq(schema.onlineOrders.id, id),
          eq(schema.onlineOrders.organizationId, orgId)
        ),
      });

      if (!onlineOrder) {
        return reply.status(404).send(error("Online order not found"));
      }

      return reply.send(
        success({
          ...onlineOrder,
          subtotal: Number(onlineOrder.subtotal),
          totalAmount: Number(onlineOrder.totalAmount),
          commissionAmount: Number(onlineOrder.commissionAmount),
          itemsPayload: JSON.parse(onlineOrder.itemsPayload),
          rawWebhookPayload: onlineOrder.rawWebhookPayload
            ? JSON.parse(onlineOrder.rawWebhookPayload)
            : null,
        })
      );
    }
  );

  // Update online order status
  fastify.patch(
    "/api/v1/integrations/online-orders/:id/status",
    { preHandler: [fastify.authenticate, requireMinRole("CASHIER")] },
    async (request, reply) => {
      const { id } = request.params as { id: string };
      const orgId = getOrganizationId(request);
      const body = updateOnlineOrderStatusSchema.parse(request.body);

      const updateData: Record<string, unknown> = {
        status: body.status,
        updatedAt: new Date(),
      };

      if (body.status === "ACCEPTED") {
        updateData.acceptedAt = new Date();
      } else if (body.status === "DELIVERED") {
        updateData.deliveredAt = new Date();
      }

      const results = await db
        .update(schema.onlineOrders)
        .set(updateData)
        .where(
          and(
            eq(schema.onlineOrders.id, id),
            eq(schema.onlineOrders.organizationId, orgId)
          )
        )
        .returning();

      if (results.length === 0) {
        return reply.status(404).send(error("Online order not found"));
      }

      return reply.send(
        success(
          { onlineOrderId: id, status: body.status },
          "Online order status updated"
        )
      );
    }
  );
}
