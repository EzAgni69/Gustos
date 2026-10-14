/**
 * Gusto Cloud API Gateway — CRM Routes
 *
 * Feedback, Coupons, and Loyalty points management.
 *
 * ─── Feedback ───
 * GET  /api/v1/crm/feedbacks     — List feedbacks
 * POST /api/v1/crm/feedbacks     — Create feedback
 *
 * ─── Coupons ───
 * GET    /api/v1/crm/coupons           — List coupons
 * POST   /api/v1/crm/coupons           — Create coupon
 * PUT    /api/v1/crm/coupons/:id       — Update coupon
 * DELETE /api/v1/crm/coupons/:id       — Delete coupon
 * POST   /api/v1/crm/coupons/validate  — Validate coupon for an order
 *
 * ─── Loyalty ───
 * GET  /api/v1/crm/loyalty/:customerId          — Get loyalty balance
 * GET  /api/v1/crm/loyalty/:customerId/history  — Transaction history
 * POST /api/v1/crm/loyalty/earn                  — Earn points
 * POST /api/v1/crm/loyalty/redeem                — Redeem points
 * POST /api/v1/crm/loyalty/adjust                — Manual adjust (admin)
 */

import type { FastifyInstance } from "fastify";
import { eq, and, count, gte, ilike } from "drizzle-orm";
import {
  createFeedbackSchema,
  listFeedbacksQuerySchema,
  createCouponSchema,
  updateCouponSchema,
  validateCouponSchema,
  listCouponsQuerySchema,
  earnLoyaltySchema,
  redeemLoyaltySchema,
  adjustLoyaltySchema,
  listLoyaltyTransactionsQuerySchema,
} from "@gusto/api-contracts";
import * as schema from "@gusto/db-schema/cloud";
import { db } from "../db/index.js";
import { getOrganizationId, requireMinRole } from "../middleware/auth.js";
import { success, paginated, error } from "../utils/response.js";

// ─── Loyalty Config ───
// Earn 1 point per ₹10 spent. Configurable per org in a future phase.
const LOYALTY_EARN_RATE = 10; // ₹ spent per point earned

export async function crmRoutes(fastify: FastifyInstance) {
  fastify.addHook("preHandler", fastify.authenticate);

  // ═══════════════════════════════════
  // ─── Feedback ───
  // ═══════════════════════════════════

  // List feedbacks
  fastify.get(
    "/api/v1/crm/feedbacks",
    { preHandler: [requireMinRole("MANAGER")] },
    async (request, reply) => {
      const orgId = getOrganizationId(request);
      const query = listFeedbacksQuerySchema.parse(request.query);

      const conditions = [eq(schema.feedbacks.organizationId, orgId)];

      if (query.outletId) {
        conditions.push(eq(schema.feedbacks.outletId, query.outletId));
      }
      if (query.customerId) {
        conditions.push(eq(schema.feedbacks.customerId, query.customerId));
      }
      if (query.minRating) {
        conditions.push(gte(schema.feedbacks.rating, query.minRating));
      }

      const where = and(...conditions);

      const [feedbacks, totalResult] = await Promise.all([
        db.query.feedbacks.findMany({
          where,
          limit: query.limit,
          offset: (query.page - 1) * query.limit,
          orderBy: (f, { desc }) => [desc(f.createdAt)],
          with: { customer: true, order: true },
        }),
        db.select({ count: count() }).from(schema.feedbacks).where(where),
      ]);

      const total = totalResult[0]?.count ?? 0;
      return reply.send(paginated(feedbacks, total, query.page, query.limit));
    }
  );

  // Create feedback
  fastify.post(
    "/api/v1/crm/feedbacks",
    { preHandler: [requireMinRole("WAITER")] },
    async (request, reply) => {
      const orgId = getOrganizationId(request);
      const body = createFeedbackSchema.parse(request.body);

      const results = await db
        .insert(schema.feedbacks)
        .values({
          organizationId: orgId,
          ...body,
        })
        .returning();
      const feedback = results[0]!;

      return reply.status(201).send(success(feedback, "Feedback recorded"));
    }
  );

  // ═══════════════════════════════════
  // ─── Coupons ───
  // ═══════════════════════════════════

  // List coupons
  fastify.get(
    "/api/v1/crm/coupons",
    { preHandler: [requireMinRole("MANAGER")] },
    async (request, reply) => {
      const orgId = getOrganizationId(request);
      const query = listCouponsQuerySchema.parse(request.query);

      const conditions = [eq(schema.coupons.organizationId, orgId)];

      if (query.isActive !== undefined) {
        conditions.push(eq(schema.coupons.isActive, query.isActive));
      }
      if (query.search) {
        conditions.push(ilike(schema.coupons.code, `%${query.search}%`));
      }

      const where = and(...conditions);

      const [coupons, totalResult] = await Promise.all([
        db.query.coupons.findMany({
          where,
          limit: query.limit,
          offset: (query.page - 1) * query.limit,
          orderBy: (c, { desc }) => [desc(c.createdAt)],
        }),
        db.select({ count: count() }).from(schema.coupons).where(where),
      ]);

      const total = totalResult[0]?.count ?? 0;
      const formatted = coupons.map((c) => ({
        ...c,
        value: Number(c.value),
        minOrderAmount: c.minOrderAmount ? Number(c.minOrderAmount) : null,
        maxDiscountAmount: c.maxDiscountAmount
          ? Number(c.maxDiscountAmount)
          : null,
        outletIds: c.outletIds ? JSON.parse(c.outletIds) : null,
      }));

      return reply.send(paginated(formatted, total, query.page, query.limit));
    }
  );

  // Create coupon
  fastify.post(
    "/api/v1/crm/coupons",
    { preHandler: [requireMinRole("MANAGER")] },
    async (request, reply) => {
      const orgId = getOrganizationId(request);
      const body = createCouponSchema.parse(request.body);

      // Check for duplicate code in this org
      const existing = await db.query.coupons.findFirst({
        where: and(
          eq(schema.coupons.organizationId, orgId),
          eq(schema.coupons.code, body.code)
        ),
      });

      if (existing) {
        return reply
          .status(409)
          .send(error("Coupon code already exists"));
      }

      const results = await db
        .insert(schema.coupons)
        .values({
          organizationId: orgId,
          code: body.code,
          description: body.description,
          type: body.type,
          value: String(body.value),
          minOrderAmount: body.minOrderAmount
            ? String(body.minOrderAmount)
            : null,
          maxDiscountAmount: body.maxDiscountAmount
            ? String(body.maxDiscountAmount)
            : null,
          usageLimit: body.usageLimit || null,
          outletIds: body.outletIds ? JSON.stringify(body.outletIds) : null,
          validFrom: body.validFrom,
          validUntil: body.validUntil,
          isActive: body.isActive,
        })
        .returning();
      const coupon = results[0]!;

      return reply.status(201).send(success(coupon, "Coupon created"));
    }
  );

  // Update coupon
  fastify.put(
    "/api/v1/crm/coupons/:id",
    { preHandler: [requireMinRole("MANAGER")] },
    async (request, reply) => {
      const { id } = request.params as { id: string };
      const orgId = getOrganizationId(request);
      const body = updateCouponSchema.parse(request.body);

      const updateData: Record<string, unknown> = { updatedAt: new Date() };

      if (body.value !== undefined) updateData.value = String(body.value);
      if (body.description !== undefined) updateData.description = body.description;
      if (body.minOrderAmount !== undefined)
        updateData.minOrderAmount = body.minOrderAmount !== null ? String(body.minOrderAmount) : null;
      if (body.maxDiscountAmount !== undefined)
        updateData.maxDiscountAmount = body.maxDiscountAmount !== null ? String(body.maxDiscountAmount) : null;
      if (body.usageLimit !== undefined) updateData.usageLimit = body.usageLimit;
      if (body.outletIds !== undefined)
        updateData.outletIds = JSON.stringify(body.outletIds);
      if (body.validFrom !== undefined) updateData.validFrom = body.validFrom;
      if (body.validUntil !== undefined) updateData.validUntil = body.validUntil;
      if (body.isActive !== undefined) updateData.isActive = body.isActive;

      const results = await db
        .update(schema.coupons)
        .set(updateData)
        .where(
          and(
            eq(schema.coupons.id, id),
            eq(schema.coupons.organizationId, orgId)
          )
        )
        .returning();

      if (results.length === 0) {
        return reply.status(404).send(error("Coupon not found"));
      }

      return reply.send(success(results[0], "Coupon updated"));
    }
  );

  // Delete coupon
  fastify.delete(
    "/api/v1/crm/coupons/:id",
    { preHandler: [requireMinRole("MANAGER")] },
    async (request, reply) => {
      const { id } = request.params as { id: string };
      const orgId = getOrganizationId(request);

      const results = await db
        .delete(schema.coupons)
        .where(
          and(
            eq(schema.coupons.id, id),
            eq(schema.coupons.organizationId, orgId)
          )
        )
        .returning();

      if (results.length === 0) {
        return reply.status(404).send(error("Coupon not found"));
      }

      return reply.send(success(null, "Coupon deleted"));
    }
  );

  // Validate coupon
  fastify.post(
    "/api/v1/crm/coupons/validate",
    { preHandler: [requireMinRole("WAITER")] },
    async (request, reply) => {
      const orgId = getOrganizationId(request);
      const body = validateCouponSchema.parse(request.body);

      const coupon = await db.query.coupons.findFirst({
        where: and(
          eq(schema.coupons.organizationId, orgId),
          eq(schema.coupons.code, body.code),
          eq(schema.coupons.isActive, true)
        ),
      });

      if (!coupon) {
        return reply.status(404).send(error("Coupon not found or inactive"));
      }

      const now = new Date();
      if (now < coupon.validFrom || now > coupon.validUntil) {
        return reply.status(400).send(error("Coupon has expired or is not yet valid"));
      }

      if (coupon.usageLimit && coupon.usedCount >= coupon.usageLimit) {
        return reply.status(400).send(error("Coupon usage limit reached"));
      }

      if (
        coupon.minOrderAmount &&
        body.orderAmount < Number(coupon.minOrderAmount)
      ) {
        return reply
          .status(400)
          .send(
            error(
              `Minimum order amount is ₹${Number(coupon.minOrderAmount)}`
            )
          );
      }

      // Check outlet restriction
      if (coupon.outletIds) {
        const allowedOutlets: string[] = JSON.parse(coupon.outletIds);
        if (!allowedOutlets.includes(body.outletId)) {
          return reply
            .status(400)
            .send(error("Coupon is not valid for this outlet"));
        }
      }

      // Calculate discount
      let discountAmount: number;
      if (coupon.type === "PERCENTAGE") {
        discountAmount = (body.orderAmount * Number(coupon.value)) / 100;
        if (coupon.maxDiscountAmount) {
          discountAmount = Math.min(
            discountAmount,
            Number(coupon.maxDiscountAmount)
          );
        }
      } else {
        discountAmount = Number(coupon.value);
      }

      discountAmount = Math.min(discountAmount, body.orderAmount);

      return reply.send(
        success({
          valid: true,
          couponId: coupon.id,
          code: coupon.code,
          type: coupon.type,
          value: Number(coupon.value),
          discountAmount: Math.round(discountAmount * 100) / 100,
          finalAmount:
            Math.round((body.orderAmount - discountAmount) * 100) / 100,
        })
      );
    }
  );

  // ═══════════════════════════════════
  // ─── Loyalty ───
  // ═══════════════════════════════════

  // Get loyalty balance for a customer
  fastify.get(
    "/api/v1/crm/loyalty/:customerId",
    { preHandler: [requireMinRole("WAITER")] },
    async (request, reply) => {
      const { customerId } = request.params as { customerId: string };
      const orgId = getOrganizationId(request);

      const customer = await db.query.customers.findFirst({
        where: and(
          eq(schema.customers.id, customerId),
          eq(schema.customers.organizationId, orgId)
        ),
      });

      if (!customer) {
        return reply.status(404).send(error("Customer not found"));
      }

      return reply.send(
        success({
          customerId: customer.id,
          customerName: customer.name,
          loyaltyPoints: customer.loyaltyPoints,
          totalVisits: customer.totalVisits,
          totalSpend: Number(customer.totalSpend),
        })
      );
    }
  );

  // Get loyalty transaction history
  fastify.get(
    "/api/v1/crm/loyalty/:customerId/history",
    { preHandler: [requireMinRole("CASHIER")] },
    async (request, reply) => {
      const { customerId } = request.params as { customerId: string };
      const orgId = getOrganizationId(request);
      const query = listLoyaltyTransactionsQuerySchema.parse({
        ...request.query as Record<string, unknown>,
        customerId,
      });

      const conditions = [
        eq(schema.loyaltyTransactions.organizationId, orgId),
        eq(schema.loyaltyTransactions.customerId, customerId),
      ];

      if (query.type) {
        conditions.push(eq(schema.loyaltyTransactions.type, query.type));
      }

      const where = and(...conditions);

      const [transactions, totalResult] = await Promise.all([
        db.query.loyaltyTransactions.findMany({
          where,
          limit: query.limit,
          offset: (query.page - 1) * query.limit,
          orderBy: (t, { desc }) => [desc(t.createdAt)],
        }),
        db
          .select({ count: count() })
          .from(schema.loyaltyTransactions)
          .where(where),
      ]);

      const total = totalResult[0]?.count ?? 0;
      return reply.send(paginated(transactions, total, query.page, query.limit));
    }
  );

  // Earn loyalty points
  fastify.post(
    "/api/v1/crm/loyalty/earn",
    { preHandler: [requireMinRole("CASHIER")] },
    async (request, reply) => {
      const orgId = getOrganizationId(request);
      const body = earnLoyaltySchema.parse(request.body);

      const customer = await db.query.customers.findFirst({
        where: and(
          eq(schema.customers.id, body.customerId),
          eq(schema.customers.organizationId, orgId)
        ),
      });

      if (!customer) {
        return reply.status(404).send(error("Customer not found"));
      }

      const pointsEarned = Math.floor(body.orderAmount / LOYALTY_EARN_RATE);
      if (pointsEarned <= 0) {
        return reply.send(
          success({ pointsEarned: 0, balance: customer.loyaltyPoints })
        );
      }

      const newBalance = customer.loyaltyPoints + pointsEarned;

      // Update customer
      await db
        .update(schema.customers)
        .set({
          loyaltyPoints: newBalance,
          totalVisits: customer.totalVisits + 1,
          totalSpend: String(Number(customer.totalSpend) + body.orderAmount),
          updatedAt: new Date(),
        })
        .where(eq(schema.customers.id, body.customerId));

      // Record transaction
      const results = await db
        .insert(schema.loyaltyTransactions)
        .values({
          organizationId: orgId,
          customerId: body.customerId,
          orderId: body.orderId,
          type: "EARN",
          points: pointsEarned,
          balanceAfter: newBalance,
          description: `Earned ${pointsEarned} points on order ₹${body.orderAmount}`,
        })
        .returning();

      return reply.send(
        success(
          {
            pointsEarned,
            balance: newBalance,
            transaction: results[0],
          },
          `${pointsEarned} loyalty points earned`
        )
      );
    }
  );

  // Redeem loyalty points
  fastify.post(
    "/api/v1/crm/loyalty/redeem",
    { preHandler: [requireMinRole("CASHIER")] },
    async (request, reply) => {
      const orgId = getOrganizationId(request);
      const body = redeemLoyaltySchema.parse(request.body);

      const customer = await db.query.customers.findFirst({
        where: and(
          eq(schema.customers.id, body.customerId),
          eq(schema.customers.organizationId, orgId)
        ),
      });

      if (!customer) {
        return reply.status(404).send(error("Customer not found"));
      }

      if (customer.loyaltyPoints < body.points) {
        return reply
          .status(400)
          .send(
            error(
              `Insufficient points. Balance: ${customer.loyaltyPoints}, Requested: ${body.points}`
            )
          );
      }

      const newBalance = customer.loyaltyPoints - body.points;

      await db
        .update(schema.customers)
        .set({
          loyaltyPoints: newBalance,
          updatedAt: new Date(),
        })
        .where(eq(schema.customers.id, body.customerId));

      const results = await db
        .insert(schema.loyaltyTransactions)
        .values({
          organizationId: orgId,
          customerId: body.customerId,
          orderId: body.orderId || null,
          type: "REDEEM",
          points: -body.points,
          balanceAfter: newBalance,
          description: `Redeemed ${body.points} points`,
        })
        .returning();

      return reply.send(
        success(
          {
            pointsRedeemed: body.points,
            balance: newBalance,
            transaction: results[0],
          },
          `${body.points} loyalty points redeemed`
        )
      );
    }
  );

  // Manual adjustment (admin only)
  fastify.post(
    "/api/v1/crm/loyalty/adjust",
    { preHandler: [requireMinRole("MANAGER")] },
    async (request, reply) => {
      const orgId = getOrganizationId(request);
      const body = adjustLoyaltySchema.parse(request.body);

      const customer = await db.query.customers.findFirst({
        where: and(
          eq(schema.customers.id, body.customerId),
          eq(schema.customers.organizationId, orgId)
        ),
      });

      if (!customer) {
        return reply.status(404).send(error("Customer not found"));
      }

      const newBalance = customer.loyaltyPoints + body.points;

      if (newBalance < 0) {
        return reply
          .status(400)
          .send(error("Adjustment would result in negative balance"));
      }

      await db
        .update(schema.customers)
        .set({
          loyaltyPoints: newBalance,
          updatedAt: new Date(),
        })
        .where(eq(schema.customers.id, body.customerId));

      const results = await db
        .insert(schema.loyaltyTransactions)
        .values({
          organizationId: orgId,
          customerId: body.customerId,
          type: "ADJUST",
          points: body.points,
          balanceAfter: newBalance,
          description: body.description,
        })
        .returning();

      return reply.send(
        success(
          {
            adjustment: body.points,
            balance: newBalance,
            transaction: results[0],
          },
          "Loyalty points adjusted"
        )
      );
    }
  );
}
