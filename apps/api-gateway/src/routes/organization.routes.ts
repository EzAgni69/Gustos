/**
 * Gusto API Gateway — Organization Routes
 *
 * GET /api/v1/organizations/:id  — Get organization details
 * PUT /api/v1/organizations/:id  — Update organization
 */

import type { FastifyInstance } from "fastify";
import { eq } from "drizzle-orm";
import { updateOrganizationSchema } from "@gusto/api-contracts";
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

    // Tenant isolation: can only view own organization
    if (id !== orgId) {
      return reply.status(403).send(error("Access denied"));
    }

    const org = await db.query.organizations.findFirst({
      where: eq(cloudSchema.organizations.id, id),
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

      if (id !== orgId) {
        return reply.status(403).send(error("Access denied"));
      }

      const body = updateOrganizationSchema.parse(request.body);

      const results = await db
        .update(cloudSchema.organizations)
        .set({ ...body, updatedAt: new Date() })
        .where(eq(cloudSchema.organizations.id, id))
        .returning();

      const updated = results[0];
      if (!updated) {
        return reply.status(404).send(error("Organization not found"));
      }

      return reply.send(success(updated, "Organization updated"));
    }
  );
}
