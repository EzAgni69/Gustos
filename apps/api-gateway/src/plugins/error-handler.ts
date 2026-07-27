/**
 * Gusto API Gateway — Global Error Handler Plugin
 *
 * Catches Zod validation errors, database errors, and generic errors,
 * returning standardized JSON error responses.
 */

import type { FastifyInstance, FastifyError } from "fastify";
import { ZodError } from "zod";
import fp from "fastify-plugin";

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

    // PostgreSQL unique constraint violation → 409
    if (
      "code" in error &&
      (error as unknown as Record<string, unknown>).code === "23505"
    ) {
      return reply.status(409).send({
        success: false,
        message: "A record with this value already exists",
      });
    }

    // PostgreSQL foreign key violation → 400
    if (
      "code" in error &&
      (error as unknown as Record<string, unknown>).code === "23503"
    ) {
      return reply.status(400).send({
        success: false,
        message: "Referenced record does not exist",
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
