/**
 * Gusto API Gateway — Inventory Routes
 *
 * GET    /api/v1/inventory     — List inventory (tenant-scoped)
 * POST   /api/v1/inventory     — Create inventory item
 * GET    /api/v1/inventory/:id — Get inventory item
 * PUT    /api/v1/inventory/:id — Update inventory item
 * DELETE /api/v1/inventory/:id — Delete inventory item
 */

import type { FastifyInstance } from "fastify";
import { eq, and, count, or, ilike } from "drizzle-orm";
import {
  createInventoryItemSchema,
  updateInventoryItemSchema,
  listInventoryQuerySchema,
} from "@gusto/api-contracts";
import * as cloudSchema from "@gusto/db-schema/cloud";
import { db } from "../db/index.js";
import { getOrganizationId, requireMinRole } from "../middleware/auth.js";
import { success, paginated, error } from "../utils/response.js";

export async function inventoryRoutes(fastify: FastifyInstance) {
  fastify.addHook("preHandler", fastify.authenticate);

  // ─── List Inventory ───
  fastify.get("/api/v1/inventory", { preHandler: [requireMinRole("MANAGER")] }, async (request, reply) => {
    const orgId = getOrganizationId(request);
    const query = listInventoryQuerySchema.parse(request.query);

    const conditions = [eq(cloudSchema.inventoryItems.organizationId, orgId)];

    if (query.search) {
      const searchCondition = ilike(cloudSchema.inventoryItems.name, `%${query.search}%`);
      if (searchCondition) {
        conditions.push(searchCondition);
      }
    }

    const where = and(...conditions);

    const [items, totalResult] = await Promise.all([
      db.query.inventoryItems.findMany({
        where,
        limit: query.limit,
        offset: (query.page - 1) * query.limit,
        orderBy: (i, { asc }) => [asc(i.name)],
      }),
      db.select({ count: count() }).from(cloudSchema.inventoryItems).where(where),
    ]);

    // Format decimal fields since pg decimal comes back as string sometimes
    const formattedItems = items.map(item => ({
      ...item,
      currentStock: Number(item.currentStock),
      minimumStock: Number(item.minimumStock),
      costPerUnit: Number(item.costPerUnit),
    }));

    const total = totalResult[0]?.count ?? 0;
    return reply.send(paginated(formattedItems, total, query.page, query.limit));
  });

  // ─── Create Inventory Item ───
  fastify.post("/api/v1/inventory", { preHandler: [requireMinRole("MANAGER")] }, async (request, reply) => {
    const orgId = getOrganizationId(request);
    const body = createInventoryItemSchema.parse(request.body);

    const results = await db
      .insert(cloudSchema.inventoryItems)
      .values({
        organizationId: orgId,
        name: body.name,
        unit: body.unit,
        currentStock: body.currentStock.toString(),
        minimumStock: body.minimumStock.toString(),
        costPerUnit: body.costPerUnit.toString(),
        expiryDate: body.expiryDate || null,
      })
      .returning();
      
    const item = results[0]!;

    const formattedItem = {
      ...item,
      currentStock: Number(item.currentStock),
      minimumStock: Number(item.minimumStock),
      costPerUnit: Number(item.costPerUnit),
    };

    return reply.status(201).send(success(formattedItem, "Inventory item created"));
  });

  // ─── Get Inventory Item ───
  fastify.get("/api/v1/inventory/:id", { preHandler: [requireMinRole("MANAGER")] }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const orgId = getOrganizationId(request);

    const item = await db.query.inventoryItems.findFirst({
      where: and(
        eq(cloudSchema.inventoryItems.id, id),
        eq(cloudSchema.inventoryItems.organizationId, orgId)
      ),
    });

    if (!item) {
      return reply.status(404).send(error("Inventory item not found"));
    }
    
    const formattedItem = {
      ...item,
      currentStock: Number(item.currentStock),
      minimumStock: Number(item.minimumStock),
      costPerUnit: Number(item.costPerUnit),
    };

    return reply.send(success(formattedItem));
  });

  // ─── Update Inventory Item ───
  fastify.put("/api/v1/inventory/:id", { preHandler: [requireMinRole("MANAGER")] }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const orgId = getOrganizationId(request);
    const body = updateInventoryItemSchema.parse(request.body);

    const updateData: any = { updatedAt: new Date() };
    if (body.name !== undefined) updateData.name = body.name;
    if (body.unit !== undefined) updateData.unit = body.unit;
    if (body.currentStock !== undefined) updateData.currentStock = body.currentStock.toString();
    if (body.minimumStock !== undefined) updateData.minimumStock = body.minimumStock.toString();
    if (body.costPerUnit !== undefined) updateData.costPerUnit = body.costPerUnit.toString();
    if (body.expiryDate !== undefined) updateData.expiryDate = body.expiryDate || null;

    const results = await db
      .update(cloudSchema.inventoryItems)
      .set(updateData)
      .where(
        and(
          eq(cloudSchema.inventoryItems.id, id),
          eq(cloudSchema.inventoryItems.organizationId, orgId)
        )
      )
      .returning();

    const updated = results[0];
    if (!updated) {
      return reply.status(404).send(error("Inventory item not found"));
    }

    const formattedItem = {
      ...updated,
      currentStock: Number(updated.currentStock),
      minimumStock: Number(updated.minimumStock),
      costPerUnit: Number(updated.costPerUnit),
    };

    return reply.send(success(formattedItem, "Inventory item updated"));
  });

  // ─── Delete Inventory Item ───
  fastify.delete("/api/v1/inventory/:id", { preHandler: [requireMinRole("MANAGER")] }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const orgId = getOrganizationId(request);

    const results = await db
      .delete(cloudSchema.inventoryItems)
      .where(
        and(
          eq(cloudSchema.inventoryItems.id, id),
          eq(cloudSchema.inventoryItems.organizationId, orgId)
        )
      )
      .returning();

    if (results.length === 0) {
      return reply.status(404).send(error("Inventory item not found"));
    }

    return reply.send(success(null, "Inventory item deleted"));
  });
}
