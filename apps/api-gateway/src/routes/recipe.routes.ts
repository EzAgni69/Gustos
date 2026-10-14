/**
 * Gusto API Gateway — Recipe Routes
 *
 * GET    /api/v1/recipes     — List recipes with ingredients
 * POST   /api/v1/recipes     — Create/Update a recipe (upsert)
 * DELETE /api/v1/recipes/:id — Delete a recipe
 */

import type { FastifyInstance } from "fastify";
import { eq, and, inArray } from "drizzle-orm";
import { createRecipeSchema } from "@gusto/api-contracts";
import * as cloudSchema from "@gusto/db-schema/cloud";
import { db } from "../db/index.js";
import { getOrganizationId, requireMinRole } from "../middleware/auth.js";
import { success, error } from "../utils/response.js";

export async function recipeRoutes(fastify: FastifyInstance) {
  fastify.addHook("preHandler", fastify.authenticate);

  // ─── List Recipes ───
  fastify.get("/api/v1/recipes", { preHandler: [requireMinRole("MANAGER")] }, async (request, reply) => {
    const orgId = getOrganizationId(request);

    // Get all outlets for org
    const outlets = await db.query.outlets.findMany({
      where: eq(cloudSchema.outlets.organizationId, orgId),
      columns: { id: true }
    });
    const outletIds = outlets.map(o => o.id);

    if (outletIds.length === 0) {
      return reply.send(success([]));
    }

    // Get all menuItems for outlets
    const menuItems = await db.query.menuItems.findMany({
      where: inArray(cloudSchema.menuItems.outletId, outletIds),
      columns: { id: true, name: true }
    });
    
    const menuItemMap = new Map(menuItems.map(m => [m.id, m.name]));
    const menuItemIds = Array.from(menuItemMap.keys());

    if (menuItemIds.length === 0) {
      return reply.send(success([]));
    }

    // Fetch all recipes for these menu items
    const recipes = await db.query.recipes.findMany({
      where: inArray(cloudSchema.recipes.menuItemId, menuItemIds),
      with: {
        ingredients: true,
      },
    });

    const inventoryItems = await db.query.inventoryItems.findMany({
      where: eq(cloudSchema.inventoryItems.organizationId, orgId),
      columns: { id: true, name: true }
    });
    
    const inventoryMap = new Map(inventoryItems.map(i => [i.id, i.name]));

    const formattedRecipes = recipes.map(r => {
      return {
        id: r.id,
        menuItemId: r.menuItemId,
        menuItemName: menuItemMap.get(r.menuItemId) || "Unknown",
        createdAt: r.createdAt,
        ingredients: r.ingredients.map(ing => ({
          id: ing.id,
          recipeId: ing.recipeId,
          inventoryItemId: ing.inventoryItemId,
          inventoryItemName: inventoryMap.get(ing.inventoryItemId) || "Unknown",
          quantity: Number(ing.quantity),
          unit: ing.unit,
        }))
      };
    });

    return reply.send(success(formattedRecipes));
  });

  // ─── Create or Update Recipe ───
  fastify.post("/api/v1/recipes", { preHandler: [requireMinRole("MANAGER")] }, async (request, reply) => {
    const orgId = getOrganizationId(request);
    const body = createRecipeSchema.parse(request.body);

    // Verify menuItem belongs to org
    const menuItem = await db.query.menuItems.findFirst({
      where: eq(cloudSchema.menuItems.id, body.menuItemId),
    });

    if (!menuItem) {
      return reply.status(404).send(error("Menu item not found"));
    }

    const outlet = await db.query.outlets.findFirst({
      where: and(
        eq(cloudSchema.outlets.id, menuItem.outletId),
        eq(cloudSchema.outlets.organizationId, orgId)
      )
    });

    if (!outlet) {
      return reply.status(403).send(error("Unauthorized"));
    }

    await db.transaction(async (tx) => {
      const existing = await tx.query.recipes.findFirst({
        where: eq(cloudSchema.recipes.menuItemId, body.menuItemId),
      });

      let recipeId = "";

      if (existing) {
        recipeId = existing.id;
        await tx.delete(cloudSchema.recipeIngredients)
          .where(eq(cloudSchema.recipeIngredients.recipeId, recipeId));
      } else {
        const newRecipe = await tx.insert(cloudSchema.recipes).values({
          menuItemId: body.menuItemId,
        }).returning();
        recipeId = newRecipe[0]!.id;
      }

      if (body.ingredients.length > 0) {
        await tx.insert(cloudSchema.recipeIngredients).values(
          body.ingredients.map(ing => ({
            recipeId,
            inventoryItemId: ing.inventoryItemId,
            quantity: String(ing.quantity),
            unit: ing.unit,
          }))
        );
      }
    });

    return reply.status(201).send(success(null, "Recipe saved successfully"));
  });

  // ─── Delete Recipe ───
  fastify.delete("/api/v1/recipes/:id", { preHandler: [requireMinRole("MANAGER")] }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const orgId = getOrganizationId(request);

    // Verify ownership via menuItem -> outlet -> org
    const existing = await db.query.recipes.findFirst({
      where: eq(cloudSchema.recipes.id, id),
    });

    if (!existing) {
      return reply.status(404).send(error("Recipe not found"));
    }

    const menuItem = await db.query.menuItems.findFirst({
      where: eq(cloudSchema.menuItems.id, existing.menuItemId),
    });

    if (!menuItem) {
      return reply.status(404).send(error("Recipe is orphaned"));
    }

    const outlet = await db.query.outlets.findFirst({
      where: and(
        eq(cloudSchema.outlets.id, menuItem.outletId),
        eq(cloudSchema.outlets.organizationId, orgId)
      )
    });

    if (!outlet) {
       return reply.status(403).send(error("Unauthorized"));
    }

    await db.delete(cloudSchema.recipes).where(eq(cloudSchema.recipes.id, id));

    return reply.send(success(null, "Recipe deleted"));
  });
}
