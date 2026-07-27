/**
 * Gusto API Gateway — Franchise Routes
 *
 * GET    /api/v1/franchises     — List franchises (tenant-scoped)
 * POST   /api/v1/franchises     — Create franchise
 * GET    /api/v1/franchises/:id — Get franchise
 * PUT    /api/v1/franchises/:id — Update franchise
 * DELETE /api/v1/franchises/:id — Delete franchise
 */

import type { FastifyInstance } from "fastify";
import { eq, and } from "drizzle-orm";
import {
  createFranchiseSchema,
  updateFranchiseSchema,
} from "@gusto/api-contracts";
import * as cloudSchema from "@gusto/db-schema/cloud";
import { db } from "../db/index.js";
import { requireMinRole, getOrganizationId } from "../middleware/auth.js";
import { success, error } from "../utils/response.js";

export async function franchiseRoutes(fastify: FastifyInstance) {
  fastify.addHook("preHandler", fastify.authenticate);

  // ─── List Franchises ───
  fastify.get("/api/v1/franchises", async (request, reply) => {
    const orgId = getOrganizationId(request);

    const franchises = await db.query.franchises.findMany({
      where: eq(cloudSchema.franchises.organizationId, orgId),
      orderBy: (f, { asc }) => [asc(f.name)],
    });

    return reply.send(success(franchises));
  });

  // ─── Create Franchise ───
  fastify.post(
    "/api/v1/franchises",
    { preHandler: [requireMinRole("OWNER")] },
    async (request, reply) => {
      const orgId = getOrganizationId(request);
      const body = createFranchiseSchema.parse(request.body);

      const results = await db
        .insert(cloudSchema.franchises)
        .values({
          organizationId: orgId,
          name: body.name,
        })
        .returning();
      const franchise = results[0]!;

      return reply.status(201).send(success(franchise, "Franchise created"));
    }
  );

  // ─── Get Franchise ───
  fastify.get("/api/v1/franchises/:id", async (request, reply) => {
    const { id } = request.params as { id: string };
    const orgId = getOrganizationId(request);

    const franchise = await db.query.franchises.findFirst({
      where: and(
        eq(cloudSchema.franchises.id, id),
        eq(cloudSchema.franchises.organizationId, orgId)
      ),
      with: {
        outlets: true,
      },
    });

    if (!franchise) {
      return reply.status(404).send(error("Franchise not found"));
    }

    return reply.send(success(franchise));
  });

  // ─── Update Franchise ───
  fastify.put(
    "/api/v1/franchises/:id",
    { preHandler: [requireMinRole("OWNER")] },
    async (request, reply) => {
      const { id } = request.params as { id: string };
      const orgId = getOrganizationId(request);
      const body = updateFranchiseSchema.parse(request.body);

      const results = await db
        .update(cloudSchema.franchises)
        .set({ ...body, updatedAt: new Date() })
        .where(
          and(
            eq(cloudSchema.franchises.id, id),
            eq(cloudSchema.franchises.organizationId, orgId)
          )
        )
        .returning();

      const updated = results[0];
      if (!updated) {
        return reply.status(404).send(error("Franchise not found"));
      }

      return reply.send(success(updated, "Franchise updated"));
    }
  );

  // ─── Delete Franchise ───
  fastify.delete(
    "/api/v1/franchises/:id",
    { preHandler: [requireMinRole("OWNER")] },
    async (request, reply) => {
      const { id } = request.params as { id: string };
      const orgId = getOrganizationId(request);

      const results = await db
        .delete(cloudSchema.franchises)
        .where(
          and(
            eq(cloudSchema.franchises.id, id),
            eq(cloudSchema.franchises.organizationId, orgId)
          )
        )
        .returning();

      const deleted = results[0];
      if (!deleted) {
        return reply.status(404).send(error("Franchise not found"));
      }

      return reply.send(success(null, "Franchise deleted"));
    }
  );
}
