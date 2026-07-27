/**
 * Gusto API Gateway — Customer Routes
 *
 * GET  /api/v1/customers     — List customers (tenant-scoped, search)
 * POST /api/v1/customers     — Create customer
 * GET  /api/v1/customers/:id — Get customer
 * PUT  /api/v1/customers/:id — Update customer
 */

import type { FastifyInstance } from "fastify";
import { eq, and, count, or, ilike } from "drizzle-orm";
import {
  createCustomerSchema,
  updateCustomerSchema,
  listCustomersQuerySchema,
} from "@gusto/api-contracts";
import * as cloudSchema from "@gusto/db-schema/cloud";
import { db } from "../db/index.js";
import { getOrganizationId } from "../middleware/auth.js";
import { success, paginated, error } from "../utils/response.js";

export async function customerRoutes(fastify: FastifyInstance) {
  fastify.addHook("preHandler", fastify.authenticate);

  // ─── List Customers ───
  fastify.get("/api/v1/customers", async (request, reply) => {
    const orgId = getOrganizationId(request);
    const query = listCustomersQuerySchema.parse(request.query);

    const conditions = [eq(cloudSchema.customers.organizationId, orgId)];

    if (query.search) {
      const searchCondition = or(
        ilike(cloudSchema.customers.name, `%${query.search}%`),
        ilike(cloudSchema.customers.phone, `%${query.search}%`)
      );
      if (searchCondition) {
        conditions.push(searchCondition);
      }
    }

    const where = and(...conditions);

    const [customers, totalResult] = await Promise.all([
      db.query.customers.findMany({
        where,
        limit: query.limit,
        offset: (query.page - 1) * query.limit,
        orderBy: (c, { desc }) => [desc(c.createdAt)],
      }),
      db.select({ count: count() }).from(cloudSchema.customers).where(where),
    ]);

    const total = totalResult[0]?.count ?? 0;
    return reply.send(paginated(customers, total, query.page, query.limit));
  });

  // ─── Create Customer ───
  fastify.post("/api/v1/customers", async (request, reply) => {
    const orgId = getOrganizationId(request);
    const body = createCustomerSchema.parse(request.body);

    // Check for existing customer with same phone in this org
    const existing = await db.query.customers.findFirst({
      where: and(
        eq(cloudSchema.customers.organizationId, orgId),
        eq(cloudSchema.customers.phone, body.phone)
      ),
    });

    if (existing) {
      return reply
        .status(409)
        .send(error("Customer with this phone number already exists"));
    }

    const results = await db
      .insert(cloudSchema.customers)
      .values({
        organizationId: orgId,
        name: body.name,
        phone: body.phone,
        email: body.email,
        notes: body.notes,
      })
      .returning();
    const customer = results[0]!;

    return reply.status(201).send(success(customer, "Customer created"));
  });

  // ─── Get Customer ───
  fastify.get("/api/v1/customers/:id", async (request, reply) => {
    const { id } = request.params as { id: string };
    const orgId = getOrganizationId(request);

    const customer = await db.query.customers.findFirst({
      where: and(
        eq(cloudSchema.customers.id, id),
        eq(cloudSchema.customers.organizationId, orgId)
      ),
    });

    if (!customer) {
      return reply.status(404).send(error("Customer not found"));
    }

    return reply.send(success(customer));
  });

  // ─── Update Customer ───
  fastify.put("/api/v1/customers/:id", async (request, reply) => {
    const { id } = request.params as { id: string };
    const orgId = getOrganizationId(request);
    const body = updateCustomerSchema.parse(request.body);

    const results = await db
      .update(cloudSchema.customers)
      .set({ ...body, updatedAt: new Date() })
      .where(
        and(
          eq(cloudSchema.customers.id, id),
          eq(cloudSchema.customers.organizationId, orgId)
        )
      )
      .returning();

    const updated = results[0];
    if (!updated) {
      return reply.status(404).send(error("Customer not found"));
    }

    return reply.send(success(updated, "Customer updated"));
  });

  // ─── Delete Customer ───
  fastify.delete("/api/v1/customers/:id", async (request, reply) => {
    const { id } = request.params as { id: string };
    const orgId = getOrganizationId(request);

    const results = await db
      .delete(cloudSchema.customers)
      .where(
        and(
          eq(cloudSchema.customers.id, id),
          eq(cloudSchema.customers.organizationId, orgId)
        )
      )
      .returning();

    if (results.length === 0) {
      return reply.status(404).send(error("Customer not found"));
    }

    return reply.send(success(null, "Customer deleted"));
  });
}
