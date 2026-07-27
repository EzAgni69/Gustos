/**
 * Gusto API Gateway — Outlet Routes
 *
 * GET    /api/v1/outlets     — List outlets (tenant-scoped, optional franchiseId filter)
 * POST   /api/v1/outlets     — Create outlet
 * GET    /api/v1/outlets/:id — Get outlet
 * PUT    /api/v1/outlets/:id — Update outlet
 * DELETE /api/v1/outlets/:id — Delete outlet
 */

import type { FastifyInstance } from "fastify";
import { eq, and, count } from "drizzle-orm";
import {
  createOutletSchema,
  updateOutletSchema,
  listOutletsQuerySchema,
} from "@gusto/api-contracts";
import * as cloudSchema from "@gusto/db-schema/cloud";
import { db } from "../db/index.js";
import { requireMinRole, getOrganizationId } from "../middleware/auth.js";
import { success, paginated, error } from "../utils/response.js";

export async function outletRoutes(fastify: FastifyInstance) {
  fastify.addHook("preHandler", fastify.authenticate);

  // ─── List Outlets ───
  fastify.get("/api/v1/outlets", async (request, reply) => {
    const orgId = getOrganizationId(request);
    const query = listOutletsQuerySchema.parse(request.query);

    const conditions = [eq(cloudSchema.outlets.organizationId, orgId)];

    if (query.franchiseId) {
      conditions.push(eq(cloudSchema.outlets.franchiseId, query.franchiseId));
    }
    if (query.isActive !== undefined) {
      conditions.push(eq(cloudSchema.outlets.isActive, query.isActive));
    }

    const where = and(...conditions);

    const [outlets, totalResult] = await Promise.all([
      db.query.outlets.findMany({
        where,
        limit: query.limit,
        offset: (query.page - 1) * query.limit,
        orderBy: (o, { asc }) => [asc(o.name)],
      }),
      db.select({ count: count() }).from(cloudSchema.outlets).where(where),
    ]);

    const total = totalResult[0]?.count ?? 0;
    return reply.send(paginated(outlets, total, query.page, query.limit));
  });

  // ─── Create Outlet ───
  fastify.post(
    "/api/v1/outlets",
    { preHandler: [requireMinRole("MANAGER")] },
    async (request, reply) => {
      const orgId = getOrganizationId(request);
      const body = createOutletSchema.parse(request.body);

      // Verify franchise belongs to this org
      const franchise = await db.query.franchises.findFirst({
        where: and(
          eq(cloudSchema.franchises.id, body.franchiseId),
          eq(cloudSchema.franchises.organizationId, orgId)
        ),
      });

      if (!franchise) {
        return reply.status(400).send(error("Franchise not found in your organization"));
      }

      const results = await db
        .insert(cloudSchema.outlets)
        .values({
          franchiseId: body.franchiseId,
          organizationId: orgId,
          name: body.name,
          address: body.address,
          phone: body.phone,
          gstNumber: body.gstNumber,
        })
        .returning();
      const outlet = results[0]!;

      return reply.status(201).send(success(outlet, "Outlet created"));
    }
  );

  // ─── Get Outlet ───
  fastify.get("/api/v1/outlets/:id", async (request, reply) => {
    const { id } = request.params as { id: string };
    const orgId = getOrganizationId(request);

    const outlet = await db.query.outlets.findFirst({
      where: and(
        eq(cloudSchema.outlets.id, id),
        eq(cloudSchema.outlets.organizationId, orgId)
      ),
      with: {
        franchise: true,
        menuCategories: true,
        diningTables: true,
      },
    });

    if (!outlet) {
      return reply.status(404).send(error("Outlet not found"));
    }

    return reply.send(success(outlet));
  });

  // ─── Update Outlet ───
  fastify.put(
    "/api/v1/outlets/:id",
    { preHandler: [requireMinRole("MANAGER")] },
    async (request, reply) => {
      const { id } = request.params as { id: string };
      const orgId = getOrganizationId(request);
      const body = updateOutletSchema.parse(request.body);

      const results = await db
        .update(cloudSchema.outlets)
        .set({ ...body, updatedAt: new Date() })
        .where(
          and(
            eq(cloudSchema.outlets.id, id),
            eq(cloudSchema.outlets.organizationId, orgId)
          )
        )
        .returning();

      const updated = results[0];
      if (!updated) {
        return reply.status(404).send(error("Outlet not found"));
      }

      return reply.send(success(updated, "Outlet updated"));
    }
  );

  // ─── Delete Outlet ───
  fastify.delete(
    "/api/v1/outlets/:id",
    { preHandler: [requireMinRole("OWNER")] },
    async (request, reply) => {
      const { id } = request.params as { id: string };
      const orgId = getOrganizationId(request);

      const results = await db
        .delete(cloudSchema.outlets)
        .where(
          and(
            eq(cloudSchema.outlets.id, id),
            eq(cloudSchema.outlets.organizationId, orgId)
          )
        )
        .returning();

      const deleted = results[0];
      if (!deleted) {
        return reply.status(404).send(error("Outlet not found"));
      }

      return reply.send(success(null, "Outlet deleted"));
    }
  );
}
