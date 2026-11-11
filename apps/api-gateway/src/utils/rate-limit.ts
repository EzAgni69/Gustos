/**
 * Gusto API Gateway — Small in-memory rate limiter
 *
 * Fixed-window counters keyed by caller (IP, or IP + account). Used on the
 * unauthenticated endpoints that are worth attacking: login, registration and
 * the aggregator webhook. State is per process, which is adequate for a single
 * gateway instance; put a shared limiter at the edge when scaling out.
 */

import type { FastifyReply, FastifyRequest } from "fastify";

interface Bucket {
  count: number;
  resetAt: number;
}

export function createRateLimiter(options: { name: string; max: number; windowMs: number }) {
  const buckets = new Map<string, Bucket>();

  function sweep(now: number) {
    if (buckets.size < 10_000) return;
    for (const [key, bucket] of buckets) {
      if (bucket.resetAt <= now) buckets.delete(key);
    }
  }

  /** Count one hit. Returns seconds to wait when the limit is exceeded, else 0. */
  function hit(key: string): number {
    const now = Date.now();
    let bucket = buckets.get(key);
    if (!bucket || bucket.resetAt <= now) {
      bucket = { count: 0, resetAt: now + options.windowMs };
      buckets.set(key, bucket);
      sweep(now);
    }
    bucket.count++;
    return bucket.count > options.max ? Math.ceil((bucket.resetAt - now) / 1000) : 0;
  }

  /** Forget a key (e.g. after a successful login). */
  function reset(key: string): void {
    buckets.delete(key);
  }

  /** Fastify preHandler limiting by client IP. */
  async function byIp(request: FastifyRequest, reply: FastifyReply) {
    const wait = hit(`${options.name}:${request.ip}`);
    if (wait > 0) {
      return reply
        .header("Retry-After", String(wait))
        .status(429)
        .send({ success: false, message: `Too many requests. Try again in ${wait} seconds.` });
    }
  }

  return { hit, reset, byIp };
}
