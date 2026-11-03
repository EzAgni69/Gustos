/**
 * Gusto API Gateway — Global Error Handler Plugin
 *
 * Catches Zod validation errors, database errors, and generic errors,
 * returning standardized JSON error responses.
 */

import type { FastifyInstance, FastifyError } from "fastify";
import { ZodError } from "zod";
import fp from "fastify-plugin";

function extractPgCode(err: unknown): string | null {
  let current: unknown = err;
  for (let depth = 0; current && typeof current === "object" && depth < 4; depth++) {
    const code = (current as { code?: unknown }).code;
    if (typeof code === "string" && /^[0-9A-Z]{5}$/.test(code)) return code;
    current = (current as { cause?: unknown }).cause;
  }
  return null;
}

export const errorHandlerPlugin = fp(async function (fastify: FastifyInstance) {
  fastify.setErrorHandler((error: FastifyError | Error, request, reply) => {
    // Zod validation errors → 400
    if (error instanceof ZodError) {
      const fieldErrors = error.errors.map((e) => ({
        field: e.path.join("."),
        message: e.message,
      }));

      return reply.status(400).send({
        success: false,
        message: "Validation failed",
        errors: fieldErrors,
      });
    }

    // Fastify validation errors (schema validation) → 400
    if ("validation" in error && error.validation) {
      return reply.status(400).send({
        success: false,
        message: "Validation failed",
        errors: error.validation,
      });
    }

    // PostgreSQL errors. Drizzle wraps driver errors, so the SQLSTATE code may
    // live on error.cause rather than on the error itself.
    const pgCode = extractPgCode(error);

    // Unique constraint violation → 409
    if (pgCode === "23505") {
      return reply.status(409).send({
        success: false,
        message: "A record with this value already exists",
      });
    }

    // Foreign key violation
    if (pgCode === "23503") {
      if (request.method === "DELETE") {
        return reply.status(409).send({
          success: false,
          message:
            "This record can't be deleted because it is used by existing orders or other records. Deactivate it instead.",
        });
      }
      return reply.status(400).send({
        success: false,
        message: "Referenced record does not exist",
      });
    }

    // Invalid input syntax (e.g. a non-UUID id in the URL) → 400
    if (pgCode === "22P02") {
      return reply.status(400).send({
        success: false,
        message: "Invalid identifier or value",
      });
    }

    // Known HTTP errors from Fastify
    if ("statusCode" in error && typeof error.statusCode === "number") {
      return reply.status(error.statusCode).send({
        success: false,
        message: error.message,
      });
    }

    // Unknown errors → 500
    request.log.error(error, "Unhandled error");
    return reply.status(500).send({
      success: false,
      message: "Internal server error",
    });
  });

  // Handle 404 not found routes
  fastify.setNotFoundHandler((_request, reply) => {
    reply.status(404).send({
      success: false,
      message: "Route not found",
    });
  });
});
