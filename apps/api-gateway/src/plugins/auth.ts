/**
 * Gusto API Gateway — JWT Auth Plugin
 *
 * Registers @fastify/jwt and decorates the Fastify instance with
 * authentication helpers. Decoded JWT payload is typed.
 */

import type { FastifyInstance, FastifyRequest, FastifyReply } from "fastify";
import fjwt from "@fastify/jwt";
import fp from "fastify-plugin";
import type { UserRole } from "@gusto/api-contracts";
import { eq } from "drizzle-orm";
import * as cloudSchema from "@gusto/db-schema/cloud";
import { db } from "../db/index.js";
import { isProduction } from "../utils/env.js";

// Shape of the JWT payload we sign & verify
export interface JWTPayload {
  id: string;
  organizationId: string;
  outletId?: string | null;
  role: UserRole;
  email?: string;
}

// Extend Fastify's type system
declare module "fastify" {
  interface FastifyInstance {
    authenticate: (
      request: FastifyRequest,
      reply: FastifyReply
    ) => Promise<void>;
  }
}

declare module "@fastify/jwt" {
  interface FastifyJWT {
    payload: JWTPayload;
    user: JWTPayload;
  }
}

const DEV_FALLBACK_SECRET = "gusto-dev-secret-key";
const WEAK_SECRETS = new Set(["", "change-me-in-production", DEV_FALLBACK_SECRET, "secret", "changeme"]);

/**
 * Resolve the JWT signing secret. Production must provide a strong secret —
 * a guessable one lets anyone mint an OWNER token. Development falls back to
 * a fixed secret with a warning.
 */
export function resolveJwtSecret(): string {
  const secret = process.env.JWT_SECRET?.trim() ?? "";
  const weak = WEAK_SECRETS.has(secret) || secret.length < 32;

  if (!weak) return secret;
  if (isProduction()) {
    throw new Error(
      "JWT_SECRET is missing or too weak. Set a random secret of at least 32 characters " +
        "(e.g. `openssl rand -hex 32`) before starting the gateway in production."
    );
  }
  return secret || DEV_FALLBACK_SECRET;
}

// A deactivated / deleted user (or one whose role changed) must lose access
// without waiting for the token to expire. The lookup is cached briefly so it
// adds one cheap query per user every few seconds, not one per request.
const USER_CACHE_MS = 15_000;
const userCache = new Map<string, { expires: number; user: { isActive: boolean; role: UserRole; organizationId: string; outletId: string | null } | null }>();

/** Drop a cached user so a change (deactivate, role edit) applies immediately. */
export function invalidateUserCache(userId: string): void {
  userCache.delete(userId);
}

async function loadUser(userId: string) {
  const cached = userCache.get(userId);
  if (cached && cached.expires > Date.now()) return cached.user;

  const row = await db.query.users.findFirst({
    where: eq(cloudSchema.users.id, userId),
    columns: { isActive: true, role: true, organizationId: true, outletId: true },
  });
  const user = row
    ? { isActive: row.isActive, role: row.role as UserRole, organizationId: row.organizationId, outletId: row.outletId }
    : null;
  userCache.set(userId, { expires: Date.now() + USER_CACHE_MS, user });
  if (userCache.size > 5_000) {
    for (const [k, v] of userCache) if (v.expires < Date.now()) userCache.delete(k);
  }
  return user;
}

export const authPlugin = fp(async function (fastify: FastifyInstance) {
  const secret = resolveJwtSecret();
  if (WEAK_SECRETS.has(secret) || secret.length < 32) {
    fastify.log.warn("⚠️  Using a development JWT secret. Never deploy with this configuration.");
  }

  await fastify.register(fjwt, {
    secret,
    sign: {
      expiresIn: process.env.JWT_EXPIRY || "7d",
    },
  });

  // Decorate with an authenticate method for use as preHandler
  fastify.decorate(
    "authenticate",
    async function (request: FastifyRequest, reply: FastifyReply) {
      try {
        await request.jwtVerify();
      } catch {
        return reply.status(401).send({
          success: false,
          message: "Unauthorized: Invalid or expired token",
        });
      }

      const current = await loadUser(request.user.id);
      if (!current || !current.isActive || current.organizationId !== request.user.organizationId) {
        return reply.status(401).send({
          success: false,
          message: "Unauthorized: Account is no longer active",
        });
      }
      // Always act on the role / outlet stored in the database, not the token's copy
      request.user.role = current.role;
      request.user.outletId = current.outletId;
    }
  );
});
