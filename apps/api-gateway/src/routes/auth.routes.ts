/**
 * Gusto API Gateway — Auth Routes
 *
 * POST /api/v1/auth/register — Create org + owner (first-time setup)
 * POST /api/v1/auth/login    — Email + password login → JWT
 * GET  /api/v1/auth/me       — Get current user profile
 */

import type { FastifyInstance } from "fastify";
import { eq } from "drizzle-orm";
import {
  registerRequestSchema,
  loginRequestSchema,
} from "@gusto/api-contracts";
import * as cloudSchema from "@gusto/db-schema/cloud";
import { db } from "../db/index.js";
import { hashPassword, verifyPassword } from "../utils/password.js";
import { success, error } from "../utils/response.js";

export async function authRoutes(fastify: FastifyInstance) {
  // ─── Register (Create Organization + Owner) ───
  fastify.post("/api/v1/auth/register", async (request, reply) => {
    const body = registerRequestSchema.parse(request.body);

    // Check if slug is already taken
    const existingOrg = await db.query.organizations.findFirst({
      where: eq(cloudSchema.organizations.slug, body.organizationSlug),
    });

    if (existingOrg) {
      return reply.status(409).send(error("Organization slug already taken"));
    }

    // Check if email is already taken
    const existingUser = await db.query.users.findFirst({
      where: eq(cloudSchema.users.email, body.email),
    });
    if (existingUser) {
      return reply.status(409).send(error("Email already registered"));
    }

    // Create organization
    const orgs = await db
      .insert(cloudSchema.organizations)
      .values({
        name: body.organizationName,
        slug: body.organizationSlug,
        gstNumber: body.gstNumber,
      })
      .returning();
    const org = orgs[0]!;

    // Hash password and create owner user
    const passwordHash = await hashPassword(body.password);

    const users = await db
      .insert(cloudSchema.users)
      .values({
        organizationId: org.id,
        name: body.name,
        email: body.email,
        phone: body.phone,
        passwordHash,
        role: "OWNER",
      })
      .returning();
    const user = users[0]!;

    // Generate JWT
    const token = fastify.jwt.sign({
      id: user.id,
      organizationId: org.id,
      role: user.role,
      email: user.email ?? undefined,
    });

    return reply.status(201).send(
      success(
        {
          token,
          user: {
            id: user.id,
            organizationId: user.organizationId,
            name: user.name,
            email: user.email,
            phone: user.phone,
            role: user.role,
          },
          organization: {
            id: org.id,
            name: org.name,
            slug: org.slug,
          },
        },
        "Registration successful"
      )
    );
  });

  // ─── Login ───
  fastify.post("/api/v1/auth/login", async (request, reply) => {
    const body = loginRequestSchema.parse(request.body);

    // Find user by email
    const user = await db.query.users.findFirst({
      where: eq(cloudSchema.users.email, body.email),
    });

    if (!user || !user.passwordHash) {
      return reply.status(401).send(error("Invalid email or password"));
    }

    // Verify password
    const isValid = await verifyPassword(body.password, user.passwordHash);
    if (!isValid) {
      return reply.status(401).send(error("Invalid email or password"));
    }

    // Check if user is active
    if (!user.isActive) {
      return reply.status(403).send(error("Account is deactivated"));
    }

    // Generate JWT
    const token = fastify.jwt.sign({
      id: user.id,
      organizationId: user.organizationId,
      role: user.role,
      email: user.email ?? undefined,
    });

    return reply.send(
      success(
        {
          token,
          user: {
            id: user.id,
            organizationId: user.organizationId,
            outletId: user.outletId,
            name: user.name,
            email: user.email,
            phone: user.phone,
            role: user.role,
          },
        },
        "Login successful"
      )
    );
  });

  // ─── Get Current User Profile ───
  fastify.get(
    "/api/v1/auth/me",
    { preHandler: [fastify.authenticate] },
    async (request, reply) => {
      const user = await db.query.users.findFirst({
        where: eq(cloudSchema.users.id, request.user.id),
      });

      if (!user) {
        return reply.status(404).send(error("User not found"));
      }

      return reply.send(
        success({
          id: user.id,
          organizationId: user.organizationId,
          outletId: user.outletId,
          name: user.name,
          email: user.email,
          phone: user.phone,
          role: user.role,
          isActive: user.isActive,
          createdAt: user.createdAt,
          updatedAt: user.updatedAt,
        })
      );
    }
  );
}
