/**
 * Gusto API Gateway — Auth Routes
 *
 * POST /api/v1/auth/register — Create org + owner (first-time setup)
 * POST /api/v1/auth/login    — Email + password login → JWT
 * GET  /api/v1/auth/me       — Get current user profile
 */

import type { FastifyInstance } from "fastify";
import { eq, sql } from "drizzle-orm";
import {
  registerRequestSchema,
  loginRequestSchema,
} from "@gusto/api-contracts";
import * as cloudSchema from "@gusto/db-schema/cloud";
import { db } from "../db/index.js";
import { hashPassword, verifyPassword } from "../utils/password.js";
import { success, error } from "../utils/response.js";
import { createRateLimiter } from "../utils/rate-limit.js";

// Brute-force protection for the unauthenticated endpoints
const loginIpLimiter = createRateLimiter({ name: "login-ip", max: 30, windowMs: 15 * 60_000 });
const loginAccountLimiter = createRateLimiter({ name: "login-account", max: 10, windowMs: 15 * 60_000 });
const registerLimiter = createRateLimiter({ name: "register", max: 5, windowMs: 60 * 60_000 });

// A real bcrypt hash to compare against when the account does not exist, so
// response time does not reveal which emails are registered.
const dummyHash = hashPassword("gusto-timing-equaliser");

export async function authRoutes(fastify: FastifyInstance) {
  // ─── Register (Create Organization + Owner) ───
  fastify.post("/api/v1/auth/register", { preHandler: [registerLimiter.byIp] }, async (request, reply) => {
    if (process.env.DISABLE_REGISTRATION === "true") {
      return reply.status(403).send(error("Self-service registration is disabled. Ask an administrator for an account."));
    }
    const parsed = registerRequestSchema.parse(request.body);
    const body = { ...parsed, email: parsed.email.trim().toLowerCase() };

    // Check if slug is already taken
    const existingOrg = await db.query.organizations.findFirst({
      where: eq(cloudSchema.organizations.slug, body.organizationSlug),
    });

    if (existingOrg) {
      return reply.status(409).send(error("Organization slug already taken"));
    }

    // Check if email is already taken
    const existingUser = await db.query.users.findFirst({
      where: sql`lower(${cloudSchema.users.email}) = ${body.email}`,
    });
    if (existingUser) {
      return reply.status(409).send(error("Email already registered"));
    }

    // Organization and its owner are created together or not at all
    const passwordHash = await hashPassword(body.password);
    const { org, user } = await db.transaction(async (tx) => {
      const [org] = await tx
        .insert(cloudSchema.organizations)
        .values({
          name: body.organizationName,
          slug: body.organizationSlug,
          gstNumber: body.gstNumber,
        })
        .returning();

      const [user] = await tx
        .insert(cloudSchema.users)
        .values({
          organizationId: org!.id,
          name: body.name,
          email: body.email,
          phone: body.phone,
          passwordHash,
          role: "OWNER",
        })
        .returning();

      return { org: org!, user: user! };
    });

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
  fastify.post("/api/v1/auth/login", { preHandler: [loginIpLimiter.byIp] }, async (request, reply) => {
    const parsed = loginRequestSchema.parse(request.body);
    const email = parsed.email.trim().toLowerCase();

    const accountKey = `${email}`;
    const wait = loginAccountLimiter.hit(accountKey);
    if (wait > 0) {
      return reply
        .header("Retry-After", String(wait))
        .status(429)
        .send(error(`Too many sign-in attempts for this account. Try again in ${Math.ceil(wait / 60)} minute(s).`));
    }

    // Find user by email (stored emails may predate lower-casing)
    const user = await db.query.users.findFirst({
      where: sql`lower(${cloudSchema.users.email}) = ${email}`,
    });

    // Verify password (against a dummy hash when there is no such account)
    const isValid = await verifyPassword(parsed.password, user?.passwordHash || (await dummyHash)).catch(() => false);
    if (!user || !user.passwordHash || !isValid) {
      return reply.status(401).send(error("Invalid email or password"));
    }
    loginAccountLimiter.reset(accountKey);

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
