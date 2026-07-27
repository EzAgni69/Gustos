/**
 * Gusto API Gateway — User Routes
 *
 * GET    /api/v1/users     — List users (tenant-scoped, filters)
 * POST   /api/v1/users     — Create user/employee
 * GET    /api/v1/users/:id — Get user
 * PUT    /api/v1/users/:id — Update user
 * DELETE /api/v1/users/:id — Deactivate user (soft delete)
 */

import type { FastifyInstance } from "fastify";
import { eq, and, count } from "drizzle-orm";
import {
  createUserSchema,
  updateUserSchema,
  listUsersQuerySchema,
  type UserRole,
} from "@gusto/api-contracts";
import * as cloudSchema from "@gusto/db-schema/cloud";
import { db } from "../db/index.js";
import { requireMinRole, getOrganizationId } from "../middleware/auth.js";
import { hashPassword } from "../utils/password.js";
import { success, paginated, error } from "../utils/response.js";

/** Strip sensitive fields from user objects before sending to client */
function sanitizeUser(user: typeof cloudSchema.users.$inferSelect) {
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const { passwordHash, pin, ...safe } = user;
  return safe;
}

// Role hierarchy for permission checks
const ROLE_HIERARCHY: UserRole[] = [
  "CHEF",
  "WAITER",
  "CASHIER",
  "MANAGER",
  "OWNER",
  "SUPER_ADMIN",
];

export async function userRoutes(fastify: FastifyInstance) {
  fastify.addHook("preHandler", fastify.authenticate);

  // ─── List Users ───
  fastify.get(
    "/api/v1/users",
    { preHandler: [requireMinRole("MANAGER")] },
    async (request, reply) => {
      const orgId = getOrganizationId(request);
      const query = listUsersQuerySchema.parse(request.query);

      const conditions = [eq(cloudSchema.users.organizationId, orgId)];

      if (query.outletId) {
        conditions.push(eq(cloudSchema.users.outletId, query.outletId));
      }
      if (query.role) {
        conditions.push(eq(cloudSchema.users.role, query.role));
      }
      if (query.isActive !== undefined) {
        conditions.push(eq(cloudSchema.users.isActive, query.isActive));
      }

      const where = and(...conditions);

      const [users, totalResult] = await Promise.all([
        db.query.users.findMany({
          where,
          limit: query.limit,
          offset: (query.page - 1) * query.limit,
          orderBy: (u, { asc }) => [asc(u.name)],
        }),
        db.select({ count: count() }).from(cloudSchema.users).where(where),
      ]);

      const total = totalResult[0]?.count ?? 0;
      return reply.send(
        paginated(users.map(sanitizeUser), total, query.page, query.limit)
      );
    }
  );

  // ─── Create User ───
  fastify.post(
    "/api/v1/users",
    { preHandler: [requireMinRole("MANAGER")] },
    async (request, reply) => {
      const orgId = getOrganizationId(request);
      const body = createUserSchema.parse(request.body);

      // If email provided, check uniqueness
      if (body.email) {
        const existing = await db.query.users.findFirst({
          where: eq(cloudSchema.users.email, body.email),
        });
        if (existing) {
          return reply.status(409).send(error("Email already registered"));
        }
      }

      // If outlet specified, verify it belongs to this org
      if (body.outletId) {
        const outlet = await db.query.outlets.findFirst({
          where: and(
            eq(cloudSchema.outlets.id, body.outletId),
            eq(cloudSchema.outlets.organizationId, orgId)
          ),
        });
        if (!outlet) {
          return reply.status(400).send(error("Outlet not found in your organization"));
        }
      }

      // Prevent managers from creating users with higher roles
      const creatorLevel = ROLE_HIERARCHY.indexOf(request.user.role);
      const newUserLevel = ROLE_HIERARCHY.indexOf(body.role);
      if (newUserLevel > creatorLevel) {
        return reply.status(403).send(error("Cannot create user with a higher role than your own"));
      }

      let passwordHash: string | undefined;
      if (body.password) {
        passwordHash = await hashPassword(body.password);
      }

      const results = await db
        .insert(cloudSchema.users)
        .values({
          organizationId: orgId,
          outletId: body.outletId,
          name: body.name,
          email: body.email,
          phone: body.phone,
          passwordHash,
          pin: body.pin,
          role: body.role,
        })
        .returning();
      const user = results[0]!;

      return reply.status(201).send(success(sanitizeUser(user), "User created"));
    }
  );

  // ─── Get User ───
  fastify.get("/api/v1/users/:id", async (request, reply) => {
    const { id } = request.params as { id: string };
    const orgId = getOrganizationId(request);

    const user = await db.query.users.findFirst({
      where: and(
        eq(cloudSchema.users.id, id),
        eq(cloudSchema.users.organizationId, orgId)
      ),
    });

    if (!user) {
      return reply.status(404).send(error("User not found"));
    }

    return reply.send(success(sanitizeUser(user)));
  });

  // ─── Update User ───
  fastify.put(
    "/api/v1/users/:id",
    { preHandler: [requireMinRole("MANAGER")] },
    async (request, reply) => {
      const { id } = request.params as { id: string };
      const orgId = getOrganizationId(request);
      const body = updateUserSchema.parse(request.body);

      // Build update payload
      const updateData: Record<string, unknown> = { updatedAt: new Date() };

      // Copy allowed fields
      if (body.outletId !== undefined) updateData.outletId = body.outletId;
      if (body.name !== undefined) updateData.name = body.name;
      if (body.email !== undefined) updateData.email = body.email;
      if (body.phone !== undefined) updateData.phone = body.phone;
      if (body.pin !== undefined) updateData.pin = body.pin;
      if (body.role !== undefined) updateData.role = body.role;
      if (body.isActive !== undefined) updateData.isActive = body.isActive;

      // Hash password if being updated
      if (body.password) {
        updateData.passwordHash = await hashPassword(body.password);
      }

      // If outlet specified, verify it belongs to this org
      if (body.outletId) {
        const outlet = await db.query.outlets.findFirst({
          where: and(
            eq(cloudSchema.outlets.id, body.outletId),
            eq(cloudSchema.outlets.organizationId, orgId)
          ),
        });
        if (!outlet) {
          return reply.status(400).send(error("Outlet not found in your organization"));
        }
      }

      const results = await db
        .update(cloudSchema.users)
        .set(updateData)
        .where(
          and(
            eq(cloudSchema.users.id, id),
            eq(cloudSchema.users.organizationId, orgId)
          )
        )
        .returning();

      const updated = results[0];
      if (!updated) {
        return reply.status(404).send(error("User not found"));
      }

      return reply.send(success(sanitizeUser(updated), "User updated"));
    }
  );

  // ─── Delete (Deactivate) User ───
  fastify.delete(
    "/api/v1/users/:id",
    { preHandler: [requireMinRole("OWNER")] },
    async (request, reply) => {
      const { id } = request.params as { id: string };
      const orgId = getOrganizationId(request);

      // Prevent self-deactivation
      if (id === request.user.id) {
        return reply.status(400).send(error("Cannot deactivate your own account"));
      }

      const results = await db
        .update(cloudSchema.users)
        .set({ isActive: false, updatedAt: new Date() })
        .where(
          and(
            eq(cloudSchema.users.id, id),
            eq(cloudSchema.users.organizationId, orgId)
          )
        )
        .returning();

      const deactivated = results[0];
      if (!deactivated) {
        return reply.status(404).send(error("User not found"));
      }

      return reply.send(success(null, "User deactivated"));
    }
  );
}
