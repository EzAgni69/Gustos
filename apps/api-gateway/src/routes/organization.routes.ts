/**
 * Gusto API Gateway — Organization Routes
 *
 * GET /api/v1/organizations/:id  — Get organization details
 * PUT /api/v1/organizations/:id  — Update organization
 * GET /api/v1/organizations/:id/tax-rules  — List tax rules
 * POST /api/v1/organizations/:id/tax-rules — Create tax rule
 * DELETE /api/v1/organizations/:id/tax-rules/:ruleId — Delete tax rule
 */

import type { FastifyInstance } from "fastify";
import { eq, and } from "drizzle-orm";
import { updateOrganizationSchema, createTaxRuleSchema } from "@gusto/api-contracts";
import * as cloudSchema from "@gusto/db-schema/cloud";
import { db } from "../db/index.js";
import { requireMinRole, getOrganizationId } from "../middleware/auth.js";
import { success, error } from "../utils/response.js";

export async function organizationRoutes(fastify: FastifyInstance) {
  // All routes require authentication
  fastify.addHook("preHandler", fastify.authenticate);

  // ─── Get Organization ───
  fastify.get("/api/v1/organizations/:id", async (request, reply) => {
    const { id } = request.params as { id: string };
    const orgId = getOrganizationId(request);

    // Support "me" alias for current user's organization
    const targetId = id === "me" ? orgId : id;

    // Tenant isolation: can only view own organization
    if (targetId !== orgId) {
      return reply.status(403).send(error("Access denied"));
    }

    const org = await db.query.organizations.findFirst({
      where: eq(cloudSchema.organizations.id, targetId),
    });

    if (!org) {
      return reply.status(404).send(error("Organization not found"));
    }

    return reply.send(success(org));
  });

  // ─── Update Organization ───
  fastify.put(
    "/api/v1/organizations/:id",
    { preHandler: [requireMinRole("OWNER")] },
    async (request, reply) => {
      const { id } = request.params as { id: string };
      const orgId = getOrganizationId(request);

      const targetId = id === "me" ? orgId : id;

      if (targetId !== orgId) {
        return reply.status(403).send(error("Access denied"));
      }

      const body = updateOrganizationSchema.parse(request.body);

      const results = await db
        .update(cloudSchema.organizations)
        .set({ ...body, updatedAt: new Date() })
        .where(eq(cloudSchema.organizations.id, targetId))
        .returning();

      const updated = results[0];
      if (!updated) {
        return reply.status(404).send(error("Organization not found"));
      }

      return reply.send(success(updated, "Organization updated"));
    }
  );

  // ─── List Tax Rules ───
  fastify.get("/api/v1/organizations/:id/tax-rules", async (request, reply) => {
    const { id } = request.params as { id: string };
    const orgId = getOrganizationId(request);
    const targetId = id === "me" ? orgId : id;
    if (targetId !== orgId) return reply.status(403).send(error("Access denied"));

    const rules = await db.query.taxRules.findMany({
      where: eq(cloudSchema.taxRules.organizationId, orgId),
      orderBy: (r, { asc }) => [asc(r.createdAt)],
    });
    return reply.send(success(rules));
  });

  // ─── Create Tax Rule ───
  fastify.post(
    "/api/v1/organizations/:id/tax-rules",
    { preHandler: [requireMinRole("OWNER")] },
    async (request, reply) => {
      const { id } = request.params as { id: string };
      const orgId = getOrganizationId(request);
      const targetId = id === "me" ? orgId : id;
      if (targetId !== orgId) return reply.status(403).send(error("Access denied"));

      const body = createTaxRuleSchema.parse(request.body);
      const results = await db
        .insert(cloudSchema.taxRules)
        .values({ organizationId: orgId, ...body, percentage: String(body.percentage) })
        .returning();
      return reply.status(201).send(success(results[0], "Tax rule created"));
    }
  );

  // ─── Delete Tax Rule ───
  fastify.delete(
    "/api/v1/organizations/:id/tax-rules/:ruleId",
    { preHandler: [requireMinRole("OWNER")] },
    async (request, reply) => {
      const { id, ruleId } = request.params as { id: string; ruleId: string };
      const orgId = getOrganizationId(request);
      const targetId = id === "me" ? orgId : id;
      if (targetId !== orgId) return reply.status(403).send(error("Access denied"));

      const results = await db
        .delete(cloudSchema.taxRules)
        .where(
          and(
            eq(cloudSchema.taxRules.id, ruleId),
            eq(cloudSchema.taxRules.organizationId, orgId)
          )
        )
        .returning();

      if (results.length === 0) return reply.status(404).send(error("Tax rule not found"));
      return reply.send(success(null, "Tax rule deleted"));
    }
  );
}
