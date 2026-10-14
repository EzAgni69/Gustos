/**
 * Gusto API Gateway — Stock Transaction Routes
 *
 * GET    /api/v1/stock/transactions  — List stock transactions
 */

import type { FastifyInstance } from "fastify";
import { eq, and, count, desc } from "drizzle-orm";
import { listStockTransactionsQuerySchema } from "@gusto/api-contracts";
import * as cloudSchema from "@gusto/db-schema/cloud";
import { db } from "../db/index.js";
import { getOrganizationId, requireMinRole } from "../middleware/auth.js";
import { success, paginated, error } from "../utils/response.js";

export async function stockRoutes(fastify: FastifyInstance) {
  fastify.addHook("preHandler", fastify.authenticate);

  // ─── List Stock Transactions ───
  fastify.get("/api/v1/stock/transactions", { preHandler: [requireMinRole("MANAGER")] }, async (request, reply) => {
    const orgId = getOrganizationId(request);
    const query = listStockTransactionsQuerySchema.parse(request.query);

    const conditions = [eq(cloudSchema.stockTransactions.organizationId, orgId)];

    if (query.inventoryItemId) {
      conditions.push(eq(cloudSchema.stockTransactions.inventoryItemId, query.inventoryItemId));
    }
    
    if (query.type) {
      conditions.push(eq(cloudSchema.stockTransactions.type, query.type));
    }

    const where = and(...conditions);

    const [transactions, totalResult] = await Promise.all([
      db.query.stockTransactions.findMany({
        where,
        limit: query.limit,
        offset: (query.page - 1) * query.limit,
        orderBy: [desc(cloudSchema.stockTransactions.createdAt)],
      }),
      db.select({ count: count() }).from(cloudSchema.stockTransactions).where(where),
    ]);

    // Format decimal fields
    const formattedTransactions = transactions.map(t => ({
      ...t,
      quantityChange: Number(t.quantityChange),
      balanceAfter: Number(t.balanceAfter),
    }));

    // Enrich inventory items
    const inventoryItemIds = Array.from(new Set(transactions.map(t => t.inventoryItemId)));
    const inventoryMap = new Map();
    
    if (inventoryItemIds.length > 0) {
      const inventoryItems = await db.query.inventoryItems.findMany({
        where: and(
          eq(cloudSchema.inventoryItems.organizationId, orgId)
        ),
        columns: { id: true, name: true }
      });
      for (const item of inventoryItems) {
        inventoryMap.set(item.id, item.name);
      }
    }

    for (const t of formattedTransactions) {
      (t as any).inventoryItemName = inventoryMap.get(t.inventoryItemId) || "Unknown";
    }

    const total = totalResult[0]?.count ?? 0;
    return reply.send(paginated(formattedTransactions, total, query.page, query.limit));
  });
}
