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

// Shape of the JWT payload we sign & verify
export interface JWTPayload {
  id: string;
  organizationId: string;
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

export const authPlugin = fp(async function (fastify: FastifyInstance) {
  const secret = process.env.JWT_SECRET;
  if (!secret || secret === "change-me-in-production") {
    fastify.log.warn(
      "⚠️  JWT_SECRET is not set or using default. Set a strong secret in production!"
    );
  }

  await fastify.register(fjwt, {
    secret: secret || "gusto-dev-secret-key",
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
      } catch (err) {
        reply.status(401).send({
          success: false,
          message: "Unauthorized: Invalid or expired token",
        });
      }
    }
  );
});
