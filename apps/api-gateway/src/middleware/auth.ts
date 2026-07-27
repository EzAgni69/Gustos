/**
 * Gusto API Gateway — Auth Middleware
 *
 * Pre-handler hooks for:
 * - JWT authentication
 * - Role-based access control
 * - Tenant (organization) scoping
 */

import type { FastifyRequest, FastifyReply } from "fastify";
import type { UserRole } from "@gusto/api-contracts";

// Role hierarchy for permission checks (higher index = more privilege)
const ROLE_HIERARCHY: UserRole[] = [
  "CHEF",
  "WAITER",
  "CASHIER",
  "MANAGER",
  "OWNER",
  "SUPER_ADMIN",
];

/**
 * Creates a preHandler that checks if the authenticated user has
 * at least one of the required roles.
 */
export function requireRole(...roles: UserRole[]) {
  return async function (request: FastifyRequest, reply: FastifyReply) {
    const user = request.user;
    if (!user) {
      return reply.status(401).send({
        success: false,
        message: "Unauthorized: Authentication required",
      });
    }

    if (!roles.includes(user.role)) {
      return reply.status(403).send({
        success: false,
        message: `Forbidden: Requires one of [${roles.join(", ")}] role`,
      });
    }
  };
}

/**
 * Creates a preHandler that checks if the authenticated user has
 * at least the minimum required role level in the hierarchy.
 */
export function requireMinRole(minRole: UserRole) {
  return async function (request: FastifyRequest, reply: FastifyReply) {
    const user = request.user;
    if (!user) {
      return reply.status(401).send({
        success: false,
        message: "Unauthorized: Authentication required",
      });
    }

    const userLevel = ROLE_HIERARCHY.indexOf(user.role);
    const requiredLevel = ROLE_HIERARCHY.indexOf(minRole);

    if (userLevel < requiredLevel) {
      return reply.status(403).send({
        success: false,
        message: `Forbidden: Requires at least ${minRole} role`,
      });
    }
  };
}

/**
 * Extracts the organization ID from the authenticated user's JWT.
 * Used for application-level multi-tenant isolation — every query
 * MUST be filtered by this organizationId.
 */
export function getOrganizationId(request: FastifyRequest): string {
  return request.user.organizationId;
}
