/**
 * Gusto API Gateway — Menu Routes
 *
 * Categories:
 *   GET    /api/v1/menu/categories     — List categories (outletId required)
 *   POST   /api/v1/menu/categories     — Create category
 *   PUT    /api/v1/menu/categories/:id — Update category
 *   DELETE /api/v1/menu/categories/:id — Delete category
 *
 * Items:
 *   GET    /api/v1/menu/items     — List items (outletId required, filters)
 *   POST   /api/v1/menu/items     — Create item
 *   GET    /api/v1/menu/items/:id — Get item
 *   PUT    /api/v1/menu/items/:id — Update item
 *   DELETE /api/v1/menu/items/:id — Delete item
 *
 * Standard menu:
 *   POST   /api/v1/menu/load-standard — Load / refresh the menu.md catalogue
 */

import type { FastifyInstance } from "fastify";
import { eq, and, count, ilike, inArray } from "drizzle-orm";
import {
  createMenuCategorySchema,
  updateMenuCategorySchema,
  createMenuItemSchema,
  updateMenuItemSchema,
  listMenuCategoriesQuerySchema,
  listMenuItemsQuerySchema,
} from "@gusto/api-contracts";
import * as cloudSchema from "@gusto/db-schema/cloud";
import { db } from "../db/index.js";
import { requireMinRole, getOrganizationId } from "../middleware/auth.js";
import { success, paginated, error } from "../utils/response.js";
import { publishSyncUpdate } from "../utils/sync-publisher.js";
import { STANDARD_MENU_CATEGORIES, STANDARD_MENU_ITEMS } from "../data/standard-menu.js";

export async function menuRoutes(fastify: FastifyInstance) {
  fastify.addHook("preHandler", fastify.authenticate);

  // ═══════════ Categories ═══════════

  // ─── List Categories ───
  fastify.get("/api/v1/menu/categories", async (request, reply) => {
    const orgId = getOrganizationId(request);
    const query = listMenuCategoriesQuerySchema.parse(request.query);

    // Verify outlet belongs to this org
    const outlet = await db.query.outlets.findFirst({
      where: and(
        eq(cloudSchema.outlets.id, query.outletId),
        eq(cloudSchema.outlets.organizationId, orgId)
      ),
    });

    if (!outlet) {
      return reply.status(404).send(error("Outlet not found"));
    }

    const categories = await db.query.menuCategories.findMany({
      where: eq(cloudSchema.menuCategories.outletId, query.outletId),
      orderBy: (c, { asc }) => [asc(c.sortOrder), asc(c.name)],
    });

    return reply.send(success(categories));
  });

  // ─── Create Category ───
  fastify.post(
    "/api/v1/menu/categories",
    { preHandler: [requireMinRole("MANAGER")] },
    async (request, reply) => {
      const orgId = getOrganizationId(request);
      const body = createMenuCategorySchema.parse(request.body);

      // Verify outlet belongs to this org
      const outlet = await db.query.outlets.findFirst({
        where: and(
          eq(cloudSchema.outlets.id, body.outletId),
          eq(cloudSchema.outlets.organizationId, orgId)
        ),
      });

      if (!outlet) {
        return reply.status(400).send(error("Outlet not found in your organization"));
      }

      const results = await db
        .insert(cloudSchema.menuCategories)
        .values({
          outletId: body.outletId,
          name: body.name,
          sortOrder: body.sortOrder,
        })
        .returning();
      const category = results[0]!;

      await publishSyncUpdate(orgId, body.outletId, "MENU_UPDATED");

      return reply.status(201).send(success(category, "Category created"));
    }
  );

  // ─── Update Category ───
  fastify.put(
    "/api/v1/menu/categories/:id",
    { preHandler: [requireMinRole("MANAGER")] },
    async (request, reply) => {
      const { id } = request.params as { id: string };
      const orgId = getOrganizationId(request);
      const body = updateMenuCategorySchema.parse(request.body);

      // Verify category belongs to an outlet in this org
      const category = await db.query.menuCategories.findFirst({
        where: eq(cloudSchema.menuCategories.id, id),
      });

      if (!category) {
        return reply.status(404).send(error("Category not found"));
      }

      const outlet = await db.query.outlets.findFirst({
        where: and(
          eq(cloudSchema.outlets.id, category.outletId),
          eq(cloudSchema.outlets.organizationId, orgId)
        ),
      });

      if (!outlet) {
        return reply.status(403).send(error("Access denied"));
      }

      const results = await db
        .update(cloudSchema.menuCategories)
        .set(body)
        .where(eq(cloudSchema.menuCategories.id, id))
        .returning();
      const updated = results[0]!;

      await publishSyncUpdate(orgId, category.outletId, "MENU_UPDATED");

      return reply.send(success(updated, "Category updated"));
    }
  );

  // ─── Delete Category ───
  fastify.delete(
    "/api/v1/menu/categories/:id",
    { preHandler: [requireMinRole("MANAGER")] },
    async (request, reply) => {
      const { id } = request.params as { id: string };
      const orgId = getOrganizationId(request);

      const category = await db.query.menuCategories.findFirst({
        where: eq(cloudSchema.menuCategories.id, id),
      });

      if (!category) {
        return reply.status(404).send(error("Category not found"));
      }

      const outlet = await db.query.outlets.findFirst({
        where: and(
          eq(cloudSchema.outlets.id, category.outletId),
          eq(cloudSchema.outlets.organizationId, orgId)
        ),
      });

      if (!outlet) {
        return reply.status(403).send(error("Access denied"));
      }

      await db
        .delete(cloudSchema.menuCategories)
        .where(eq(cloudSchema.menuCategories.id, id));

      await publishSyncUpdate(orgId, category.outletId, "MENU_UPDATED");

      return reply.send(success(null, "Category deleted"));
    }
  );

  // ═══════════ Menu Items ═══════════

  // ─── List Items ───
  fastify.get("/api/v1/menu/items", async (request, reply) => {
    const orgId = getOrganizationId(request);
    const query = listMenuItemsQuerySchema.parse(request.query);

    // Verify outlet belongs to this org
    const outlet = await db.query.outlets.findFirst({
      where: and(
        eq(cloudSchema.outlets.id, query.outletId),
        eq(cloudSchema.outlets.organizationId, orgId)
      ),
    });

    if (!outlet) {
      return reply.status(404).send(error("Outlet not found"));
    }

    const conditions = [eq(cloudSchema.menuItems.outletId, query.outletId)];

    if (query.categoryId) {
      conditions.push(eq(cloudSchema.menuItems.categoryId, query.categoryId));
    }
    if (query.isVeg !== undefined) {
      conditions.push(eq(cloudSchema.menuItems.isVeg, query.isVeg));
    }
    if (query.isAvailable !== undefined) {
      conditions.push(eq(cloudSchema.menuItems.isAvailable, query.isAvailable));
    }
    if (query.search) {
      conditions.push(ilike(cloudSchema.menuItems.name, `%${query.search}%`));
    }

    const where = and(...conditions);

    const [items, totalResult] = await Promise.all([
      db.query.menuItems.findMany({
        where,
        limit: query.limit,
        offset: (query.page - 1) * query.limit,
        orderBy: (i, { asc }) => [asc(i.sortOrder), asc(i.name)],
      }),
      db.select({ count: count() }).from(cloudSchema.menuItems).where(where),
    ]);

    const total = totalResult[0]?.count ?? 0;
    return reply.send(paginated(items, total, query.page, query.limit));
  });

  // ─── Create Item ───
  fastify.post(
    "/api/v1/menu/items",
    { preHandler: [requireMinRole("MANAGER")] },
    async (request, reply) => {
      const orgId = getOrganizationId(request);
      const body = createMenuItemSchema.parse(request.body);

      // Verify outlet belongs to this org
      const outlet = await db.query.outlets.findFirst({
        where: and(
          eq(cloudSchema.outlets.id, body.outletId),
          eq(cloudSchema.outlets.organizationId, orgId)
        ),
      });

      if (!outlet) {
        return reply.status(400).send(error("Outlet not found in your organization"));
      }

      // Verify category belongs to this outlet
      const category = await db.query.menuCategories.findFirst({
        where: and(
          eq(cloudSchema.menuCategories.id, body.categoryId),
          eq(cloudSchema.menuCategories.outletId, body.outletId)
        ),
      });

      if (!category) {
        return reply.status(400).send(error("Category not found in this outlet"));
      }

      const results = await db
        .insert(cloudSchema.menuItems)
        .values({
          categoryId: body.categoryId,
          outletId: body.outletId,
          name: body.name,
          description: body.description,
          variants: body.variants,
          price: body.price.toString(),
          gstRate: body.gstRate,
          isVeg: body.isVeg,
          isAvailable: body.isAvailable,
          sortOrder: body.sortOrder,
        })
        .returning();
      const item = results[0]!;

      await publishSyncUpdate(orgId, body.outletId, "MENU_UPDATED");

      return reply.status(201).send(success(item, "Menu item created"));
    }
  );

  // ─── Get Item ───
  fastify.get("/api/v1/menu/items/:id", async (request, reply) => {
    const { id } = request.params as { id: string };
    const orgId = getOrganizationId(request);

    const item = await db.query.menuItems.findFirst({
      where: eq(cloudSchema.menuItems.id, id),
    });

    if (!item) {
      return reply.status(404).send(error("Menu item not found"));
    }

    // Verify outlet ownership
    const outlet = await db.query.outlets.findFirst({
      where: and(
        eq(cloudSchema.outlets.id, item.outletId),
        eq(cloudSchema.outlets.organizationId, orgId)
      ),
    });

    if (!outlet) {
      return reply.status(403).send(error("Access denied"));
    }

    return reply.send(success(item));
  });

  // ─── Update Item ───
  fastify.put(
    "/api/v1/menu/items/:id",
    { preHandler: [requireMinRole("MANAGER")] },
    async (request, reply) => {
      const { id } = request.params as { id: string };
      const orgId = getOrganizationId(request);
      const body = updateMenuItemSchema.parse(request.body);

      const item = await db.query.menuItems.findFirst({
        where: eq(cloudSchema.menuItems.id, id),
      });

      if (!item) {
        return reply.status(404).send(error("Menu item not found"));
      }

      const outlet = await db.query.outlets.findFirst({
        where: and(
          eq(cloudSchema.outlets.id, item.outletId),
          eq(cloudSchema.outlets.organizationId, orgId)
        ),
      });

      if (!outlet) {
        return reply.status(403).send(error("Access denied"));
      }

      // Build update data, converting price to string for decimal column
      const updateData: Record<string, unknown> = { updatedAt: new Date() };
      if (body.categoryId !== undefined) updateData.categoryId = body.categoryId;
      if (body.name !== undefined) updateData.name = body.name;
      if (body.description !== undefined) updateData.description = body.description;
      if (body.variants !== undefined) updateData.variants = body.variants;
      if (body.price !== undefined) updateData.price = body.price.toString();
      if (body.gstRate !== undefined) updateData.gstRate = body.gstRate;
      if (body.isVeg !== undefined) updateData.isVeg = body.isVeg;
      if (body.isAvailable !== undefined) updateData.isAvailable = body.isAvailable;
      if (body.sortOrder !== undefined) updateData.sortOrder = body.sortOrder;

      const results = await db
        .update(cloudSchema.menuItems)
        .set(updateData)
        .where(eq(cloudSchema.menuItems.id, id))
        .returning();
      const updated = results[0]!;

      await publishSyncUpdate(orgId, item.outletId, "MENU_UPDATED");

      return reply.send(success(updated, "Menu item updated"));
    }
  );

  // ─── Delete Item ───
  fastify.delete(
    "/api/v1/menu/items/:id",
    { preHandler: [requireMinRole("MANAGER")] },
    async (request, reply) => {
      const { id } = request.params as { id: string };
      const orgId = getOrganizationId(request);

      const item = await db.query.menuItems.findFirst({
        where: eq(cloudSchema.menuItems.id, id),
      });

      if (!item) {
        return reply.status(404).send(error("Menu item not found"));
      }

      const outlet = await db.query.outlets.findFirst({
        where: and(
          eq(cloudSchema.outlets.id, item.outletId),
          eq(cloudSchema.outlets.organizationId, orgId)
        ),
      });

      if (!outlet) {
        return reply.status(403).send(error("Access denied"));
      }

      await db
        .delete(cloudSchema.menuItems)
        .where(eq(cloudSchema.menuItems.id, id));

      await publishSyncUpdate(orgId, item.outletId, "MENU_UPDATED");

      return reply.send(success(null, "Menu item deleted"));
    }
  );

  // ═══════════ Standard Menu ═══════════

  // ─── Load Standard Menu (menu.md) ───
  // Idempotent: categories and items are matched by name and updated in place,
  // missing ones are created. With replace=true, items not on the standard menu
  // are removed — or, if they appear in past orders, marked unavailable so order
  // history stays intact.
  fastify.post(
    "/api/v1/menu/load-standard",
    { preHandler: [requireMinRole("MANAGER")] },
    async (request, reply) => {
      const { outletId, replace } = (request.body ?? {}) as { outletId?: string; replace?: boolean };
      const orgId = getOrganizationId(request);

      if (!outletId) {
        return reply.status(400).send(error("outletId is required"));
      }

      const outlet = await db.query.outlets.findFirst({
        where: and(eq(cloudSchema.outlets.id, outletId), eq(cloudSchema.outlets.organizationId, orgId)),
      });
      if (!outlet) {
        return reply.status(404).send(error("Outlet not found"));
      }

      const result = await db.transaction(async (tx) => {
        // 1. Categories
        const existingCats = await tx
          .select()
          .from(cloudSchema.menuCategories)
          .where(eq(cloudSchema.menuCategories.outletId, outletId));
        const catByName = new Map(existingCats.map((c) => [c.name.trim().toLowerCase(), c]));
        const catIdByName = new Map<string, string>();

        for (const cat of STANDARD_MENU_CATEGORIES) {
          const existing = catByName.get(cat.name.toLowerCase());
          if (existing) {
            await tx
              .update(cloudSchema.menuCategories)
              .set({ sortOrder: cat.sortOrder, isActive: true })
              .where(eq(cloudSchema.menuCategories.id, existing.id));
            catIdByName.set(cat.name, existing.id);
          } else {
            const [created] = await tx
              .insert(cloudSchema.menuCategories)
              .values({ outletId, name: cat.name, sortOrder: cat.sortOrder })
              .returning();
            catIdByName.set(cat.name, created!.id);
          }
        }

        // 2. Items
        const existingItems = await tx
          .select()
          .from(cloudSchema.menuItems)
          .where(eq(cloudSchema.menuItems.outletId, outletId));
        const itemByName = new Map(existingItems.map((i) => [i.name.trim().toLowerCase(), i]));
        const standardNames = new Set<string>();
        const now = new Date();
        let itemsInserted = 0;
        let itemsUpdated = 0;

        for (const [idx, item] of STANDARD_MENU_ITEMS.entries()) {
          const categoryId = catIdByName.get(item.categoryName);
          if (!categoryId) continue;
          const key = item.name.toLowerCase();
          standardNames.add(key);
          const values = {
            categoryId,
            name: item.name,
            description: item.description,
            variants: item.variants,
            price: item.price,
            gstRate: item.gstRate,
            isVeg: item.isVeg,
            sortOrder: idx + 1,
            updatedAt: now,
          };
          const existing = itemByName.get(key);
          if (existing) {
            await tx.update(cloudSchema.menuItems).set(values).where(eq(cloudSchema.menuItems.id, existing.id));
            itemsUpdated++;
          } else {
            await tx.insert(cloudSchema.menuItems).values({ ...values, outletId, isAvailable: true });
            itemsInserted++;
          }
        }

        // 3. Replace: drop items/categories that are not on the standard menu
        let itemsRemoved = 0;
        let itemsDeactivated = 0;
        if (replace) {
          const extras = existingItems.filter((i) => !standardNames.has(i.name.trim().toLowerCase()));
          if (extras.length > 0) {
            const ordered = await tx
              .selectDistinct({ menuItemId: cloudSchema.orderItems.menuItemId })
              .from(cloudSchema.orderItems)
              .where(inArray(cloudSchema.orderItems.menuItemId, extras.map((i) => i.id)));
            const orderedIds = new Set(ordered.map((o) => o.menuItemId));
            const deletable = extras.filter((i) => !orderedIds.has(i.id)).map((i) => i.id);
            const keep = extras.filter((i) => orderedIds.has(i.id)).map((i) => i.id);
            if (deletable.length > 0) {
              await tx.delete(cloudSchema.menuItems).where(inArray(cloudSchema.menuItems.id, deletable));
              itemsRemoved = deletable.length;
            }
            if (keep.length > 0) {
              await tx
                .update(cloudSchema.menuItems)
                .set({ isAvailable: false, updatedAt: now })
                .where(inArray(cloudSchema.menuItems.id, keep));
              itemsDeactivated = keep.length;
            }
          }

          // Remove non-standard categories that are now empty; deactivate the rest
          const standardCatIds = new Set(catIdByName.values());
          for (const cat of existingCats) {
            if (standardCatIds.has(cat.id)) continue;
            const [remaining] = await tx
              .select({ value: count() })
              .from(cloudSchema.menuItems)
              .where(eq(cloudSchema.menuItems.categoryId, cat.id));
            if (Number(remaining?.value ?? 0) === 0) {
              await tx.delete(cloudSchema.menuCategories).where(eq(cloudSchema.menuCategories.id, cat.id));
            } else {
              await tx
                .update(cloudSchema.menuCategories)
                .set({ isActive: false })
                .where(eq(cloudSchema.menuCategories.id, cat.id));
            }
          }
        }

        return {
          categoriesCount: STANDARD_MENU_CATEGORIES.length,
          itemsInserted,
          itemsUpdated,
          itemsRemoved,
          itemsDeactivated,
          totalItems: STANDARD_MENU_ITEMS.length,
        };
      });

      await publishSyncUpdate(orgId, outletId, "MENU_UPDATED");

      return reply.send(success(result, "Standard menu loaded"));
    }
  );
}
