/**
 * Gusto API Gateway — Table Routes
 *
 * GET    /api/v1/tables            — List tables (outletId required)
 * POST   /api/v1/tables            — Create table
 * PUT    /api/v1/tables/:id        — Update table
 * DELETE /api/v1/tables/:id        — Delete table
 * PATCH  /api/v1/tables/:id/status — Update table status
 */

import type { FastifyInstance } from "fastify";
import { eq, and, inArray } from "drizzle-orm";
import {
  createDiningTableSchema,
  updateDiningTableSchema,
  updateTableStatusSchema,
  listTablesQuerySchema,
} from "@gusto/api-contracts";
import * as cloudSchema from "@gusto/db-schema/cloud";
import { db } from "../db/index.js";
import { requireMinRole, getOrganizationId } from "../middleware/auth.js";
import { success, error } from "../utils/response.js";
import { publishSyncUpdate } from "../utils/sync-publisher.js";

export async function tableRoutes(fastify: FastifyInstance) {
  fastify.addHook("preHandler", fastify.authenticate);

  // ─── List Tables ───
  fastify.get("/api/v1/tables", async (request, reply) => {
    const orgId = getOrganizationId(request);
    const query = listTablesQuerySchema.parse(request.query);

    const outlet = await db.query.outlets.findFirst({
      where: and(
        eq(cloudSchema.outlets.id, query.outletId),
        eq(cloudSchema.outlets.organizationId, orgId)
      ),
    });

    if (!outlet) {
      return reply.status(404).send(error("Outlet not found"));
    }

    const conditions = [eq(cloudSchema.diningTables.outletId, query.outletId)];

    if (query.status) {
      conditions.push(eq(cloudSchema.diningTables.status, query.status));
    }

    const tables = await db.query.diningTables.findMany({
      where: and(...conditions),
      orderBy: (t, { asc }) => [asc(t.sortOrder), asc(t.name)],
    });

    // Check if any table currently has an active order in the cloud DB
    const activeOrders = await db.query.orders.findMany({
      where: and(
        eq(cloudSchema.orders.outletId, query.outletId),
        inArray(cloudSchema.orders.status, ["DRAFT", "PLACED", "IN_PROGRESS", "READY", "SERVED"])
      ),
    });

    const occupiedTableIds = new Set(
      activeOrders.map((o) => o.tableId).filter(Boolean) as string[]
    );

    const enrichedTables = tables.map((t) => ({
      ...t,
      status: occupiedTableIds.has(t.id) ? "OCCUPIED" : t.status,
    }));

    return reply.send(success(enrichedTables));
  });

  // ─── Create Table ───
  fastify.post(
    "/api/v1/tables",
    { preHandler: [requireMinRole("MANAGER")] },
    async (request, reply) => {
      const orgId = getOrganizationId(request);
      const body = createDiningTableSchema.parse(request.body);

      const outlet = await db.query.outlets.findFirst({
        where: and(
          eq(cloudSchema.outlets.id, body.outletId),
          eq(cloudSchema.outlets.organizationId, orgId)
        ),
      });

      if (!outlet) {
        return reply.status(400).send(error("Outlet not found in your organization"));
      }

      const results = await db
        .insert(cloudSchema.diningTables)
        .values({
          outletId: body.outletId,
          name: body.name,
          capacity: body.capacity,
          section: body.section,
          sortOrder: body.sortOrder,
        })
        .returning();
      const table = results[0]!;

      await publishSyncUpdate(orgId, body.outletId, "TABLE_UPDATED");

      return reply.status(201).send(success(table, "Table created"));
    }
  );

  // ─── Update Table ───
  fastify.put(
    "/api/v1/tables/:id",
    { preHandler: [requireMinRole("MANAGER")] },
    async (request, reply) => {
      const { id } = request.params as { id: string };
      const orgId = getOrganizationId(request);
      const body = updateDiningTableSchema.parse(request.body);

      const table = await db.query.diningTables.findFirst({
        where: eq(cloudSchema.diningTables.id, id),
      });

      if (!table) {
        return reply.status(404).send(error("Table not found"));
      }

      const outlet = await db.query.outlets.findFirst({
        where: and(
          eq(cloudSchema.outlets.id, table.outletId),
          eq(cloudSchema.outlets.organizationId, orgId)
        ),
      });

      if (!outlet) {
        return reply.status(403).send(error("Access denied"));
      }

      const results = await db
        .update(cloudSchema.diningTables)
        .set(body)
        .where(eq(cloudSchema.diningTables.id, id))
        .returning();
      const updated = results[0]!;

      await publishSyncUpdate(orgId, table.outletId, "TABLE_UPDATED");

      return reply.send(success(updated, "Table updated"));
    }
  );

  // ─── Delete Table ───
  fastify.delete(
    "/api/v1/tables/:id",
    { preHandler: [requireMinRole("MANAGER")] },
    async (request, reply) => {
      const { id } = request.params as { id: string };
      const orgId = getOrganizationId(request);

      const table = await db.query.diningTables.findFirst({
        where: eq(cloudSchema.diningTables.id, id),
      });

      if (!table) {
        return reply.status(404).send(error("Table not found"));
      }

      const outlet = await db.query.outlets.findFirst({
        where: and(
          eq(cloudSchema.outlets.id, table.outletId),
          eq(cloudSchema.outlets.organizationId, orgId)
        ),
      });

      if (!outlet) {
        return reply.status(403).send(error("Access denied"));
      }

      await db
        .delete(cloudSchema.diningTables)
        .where(eq(cloudSchema.diningTables.id, id));

      await publishSyncUpdate(orgId, table.outletId, "TABLE_UPDATED");

      return reply.send(success(null, "Table deleted"));
    }
  );

  // ─── Update Table Status ───
  fastify.patch("/api/v1/tables/:id/status", async (request, reply) => {
    const { id } = request.params as { id: string };
    const orgId = getOrganizationId(request);
    const body = updateTableStatusSchema.parse(request.body);

    const table = await db.query.diningTables.findFirst({
      where: eq(cloudSchema.diningTables.id, id),
    });

    if (!table) {
      return reply.status(404).send(error("Table not found"));
    }

    const outlet = await db.query.outlets.findFirst({
      where: and(
        eq(cloudSchema.outlets.id, table.outletId),
        eq(cloudSchema.outlets.organizationId, orgId)
      ),
    });

    if (!outlet) {
      return reply.status(403).send(error("Access denied"));
    }

    const results = await db
      .update(cloudSchema.diningTables)
      .set({ status: body.status })
      .where(eq(cloudSchema.diningTables.id, id))
      .returning();
    const updated = results[0]!;

    await publishSyncUpdate(orgId, table.outletId, "TABLE_UPDATED");

    return reply.send(success(updated, "Table status updated"));
  });
}
