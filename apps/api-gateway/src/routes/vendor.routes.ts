/**
 * Gusto API Gateway — Vendor Routes
 *
 * GET    /api/v1/vendors     — List vendors for organization
 * POST   /api/v1/vendors     — Create vendor
 * GET    /api/v1/vendors/:id — Get vendor by ID
 * PUT    /api/v1/vendors/:id — Update vendor
 * DELETE /api/v1/vendors/:id — Delete vendor
 */

import type { FastifyInstance } from "fastify";
import { eq, and } from "drizzle-orm";
import {
  createVendorSchema,
  updateVendorSchema,
} from "@gusto/api-contracts";
import * as cloudSchema from "@gusto/db-schema/cloud";
import { db } from "../db/index.js";
import { getOrganizationId, requireMinRole } from "../middleware/auth.js";
import { success, error } from "../utils/response.js";

export async function vendorRoutes(fastify: FastifyInstance) {
  fastify.addHook("preHandler", fastify.authenticate);

  // ─── List Vendors ───
  fastify.get(
    "/api/v1/vendors",
    { preHandler: [requireMinRole("MANAGER")] },
    async (request, reply) => {
      const orgId = getOrganizationId(request);

      const vendors = await db.query.vendors.findMany({
        where: eq(cloudSchema.vendors.organizationId, orgId),
        orderBy: (v, { asc }) => [asc(v.name)],
      });

      return reply.send(success(vendors));
    }
  );

  // ─── Create Vendor ───
  fastify.post(
    "/api/v1/vendors",
    { preHandler: [requireMinRole("MANAGER")] },
    async (request, reply) => {
      const orgId = getOrganizationId(request);
      const body = createVendorSchema.parse(request.body);

      const results = await db
        .insert(cloudSchema.vendors)
        .values({
          organizationId: orgId,
          name: body.name,
          contactName: body.contactName ?? null,
          phone: body.phone ?? null,
          email: body.email ?? null,
          address: body.address ?? null,
          gstNumber: body.gstNumber ?? null,
        })
        .returning();

      return reply.status(201).send(success(results[0], "Vendor created"));
    }
  );

  // ─── Get Vendor ───
  fastify.get(
    "/api/v1/vendors/:id",
    { preHandler: [requireMinRole("MANAGER")] },
    async (request, reply) => {
      const { id } = request.params as { id: string };
      const orgId = getOrganizationId(request);

      const vendor = await db.query.vendors.findFirst({
        where: and(
          eq(cloudSchema.vendors.id, id),
          eq(cloudSchema.vendors.organizationId, orgId)
        ),
      });

      if (!vendor) {
        return reply.status(404).send(error("Vendor not found"));
      }

      return reply.send(success(vendor));
    }
  );

  // ─── Update Vendor ───
  fastify.put(
    "/api/v1/vendors/:id",
    { preHandler: [requireMinRole("MANAGER")] },
    async (request, reply) => {
      const { id } = request.params as { id: string };
      const orgId = getOrganizationId(request);
      const body = updateVendorSchema.parse(request.body);

      const updateData: Record<string, unknown> = { updatedAt: new Date() };
      if (body.name !== undefined) updateData.name = body.name;
      if (body.contactName !== undefined) updateData.contactName = body.contactName;
      if (body.phone !== undefined) updateData.phone = body.phone;
      if (body.email !== undefined) updateData.email = body.email;
      if (body.address !== undefined) updateData.address = body.address;
      if (body.gstNumber !== undefined) updateData.gstNumber = body.gstNumber;

      const results = await db
        .update(cloudSchema.vendors)
        .set(updateData)
        .where(
          and(
            eq(cloudSchema.vendors.id, id),
            eq(cloudSchema.vendors.organizationId, orgId)
          )
        )
        .returning();

      if (results.length === 0) {
        return reply.status(404).send(error("Vendor not found"));
      }

      return reply.send(success(results[0], "Vendor updated"));
    }
  );

  // ─── Delete Vendor ───
  fastify.delete(
    "/api/v1/vendors/:id",
    { preHandler: [requireMinRole("MANAGER")] },
    async (request, reply) => {
      const { id } = request.params as { id: string };
      const orgId = getOrganizationId(request);

      const results = await db
        .delete(cloudSchema.vendors)
        .where(
          and(
            eq(cloudSchema.vendors.id, id),
            eq(cloudSchema.vendors.organizationId, orgId)
          )
        )
        .returning();

      if (results.length === 0) {
        return reply.status(404).send(error("Vendor not found"));
      }

      return reply.send(success(null, "Vendor deleted"));
    }
  );
}
