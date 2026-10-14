/**
 * Gusto API Gateway — POS Routes
 *
 * Provides backward compatibility endpoints for the POS / Captain Apps
 * to authenticate and obtain JWTs using PIN login.
 */

import type { FastifyInstance } from "fastify";
import { eq, and } from "drizzle-orm";
import * as cloudSchema from "@gusto/db-schema/cloud";
import { db } from "../db/index.js";
import { success, error } from "../utils/response.js";
import type { JWTPayload } from "../plugins/auth.js";

export async function posRoutes(fastify: FastifyInstance) {
  // ─── POS Users List (For MVP Development) ───
  // Note: In a true production environment, this should be scoped by a device token
  // to restrict which users an outlet can see. For MVP, we return all active users.
  fastify.get("/api/v1/pos/users", async (request, reply) => {
    const users = await db.query.users.findMany({
      where: eq(cloudSchema.users.isActive, true),
      orderBy: (u, { asc }) => [asc(u.name)],
    });
    return reply.send(
      success(
        users.map((u) => ({
          id: u.id,
          name: u.name,
          role: u.role,
        }))
      )
    );
  });

  // ─── POS PIN Login (For MVP Development) ───
  fastify.post("/api/v1/pos/pin-login", async (request, reply) => {
    const { pin } = request.body as { pin: string };
    
    if (!pin) {
      return reply.status(400).send(error("PIN is required"));
    }

    const user = await db.query.users.findFirst({
      where: and(
        eq(cloudSchema.users.pin, pin),
        eq(cloudSchema.users.isActive, true)
      ),
    });

    if (!user) {
      return reply.status(401).send(error("Invalid PIN"));
    }

    const token = fastify.jwt.sign({
      id: user.id,
      organizationId: user.organizationId,
      outletId: user.outletId,
      role: user.role,
      email: user.email ?? undefined,
    });

    return reply.send(
      success({
        token,
        id: user.id,
        name: user.name,
        role: user.role,
        outletId: user.outletId,
      })
    );
  });
}
