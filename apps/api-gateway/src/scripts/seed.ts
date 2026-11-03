/**
 * Gusto API Gateway — Seed Script
 *
 * Populates the dev database with demo data for testing.
 * Updated to reflect authentic Gusto menu from menu.md.
 * Run: pnpm --filter @gusto/api-gateway seed
 */

import { db } from "../db/index.js";
import * as cloudSchema from "@gusto/db-schema/cloud";
import { hashPassword } from "../utils/password.js";
import { eq, or } from "drizzle-orm";
import { STANDARD_MENU_CATEGORIES, STANDARD_MENU_ITEMS } from "../data/standard-menu.js";

async function seed() {
  console.log("🌱 Seeding database...\n");

  // ─── Clean up existing demo data ───
  console.log("Cleaning up previous demo data if present...");
  await db
    .delete(cloudSchema.organizations)
    .where(
      or(
        eq(cloudSchema.organizations.id, "00000000-0000-0000-0000-000000000001"),
        eq(cloudSchema.organizations.slug, "gusto-demo")
      )
    );
  await db
    .delete(cloudSchema.users)
    .where(
      or(
        eq(cloudSchema.users.email, "admin@gusto.dev"),
        eq(cloudSchema.users.email, "manager@gusto.dev"),
        eq(cloudSchema.users.email, "cashier@gusto.dev")
      )
    );

  // ─── Organization ───
  console.log("Creating organization...");
  const orgResults = await db
    .insert(cloudSchema.organizations)
    .values({
      id: "00000000-0000-0000-0000-000000000001",
      name: "Gusto Demo Restaurant",
      slug: "gusto-demo",
      gstNumber: "27AADCG1234A1Z5",
    })
    .returning();
  const org = orgResults[0]!;
  console.log(`  ✅ Organization: ${org.name} (${org.id})`);

  // ─── Franchise ───
  console.log("Creating franchise...");
  const franchiseResults = await db
    .insert(cloudSchema.franchises)
    .values({
      id: "00000000-0000-0000-0000-000000000002",
      organizationId: org.id,
      name: "Mumbai Central",
    })
    .returning();
  const franchise = franchiseResults[0]!;
  console.log(`  ✅ Franchise: ${franchise.name} (${franchise.id})`);

  // ─── Outlet ───
  console.log("Creating outlet...");
  const outletResults = await db
    .insert(cloudSchema.outlets)
    .values({
      id: "00000000-0000-0000-0000-000000000003",
      franchiseId: franchise.id,
      organizationId: org.id,
      name: "Gusto - Andheri West",
      address: "Shop 12, Versova Road, Andheri West, Mumbai 400058",
      phone: "+91 22 2634 5678",
      gstNumber: "27AADCG1234A1Z5",
    })
    .returning();
  const outlet = outletResults[0]!;
  console.log(`  ✅ Outlet: ${outlet.name} (${outlet.id})`);

  // ─── Users ───
  console.log("Creating users...");
  const ownerPasswordHash = await hashPassword("admin123");
  const staffPasswordHash = await hashPassword("staff123");

  const ownerResults = await db
    .insert(cloudSchema.users)
    .values({
      organizationId: org.id,
      name: "Dave Bijal",
      email: "admin@gusto.dev",
      phone: "+91 98765 43210",
      passwordHash: ownerPasswordHash,
      role: "OWNER",
    })
    .returning();
  const owner = ownerResults[0]!;
  console.log(`  ✅ Owner: ${owner.name} (${owner.email})`);

  const managerResults = await db
    .insert(cloudSchema.users)
    .values({
      organizationId: org.id,
      outletId: outlet.id,
      name: "Priya Sharma",
      email: "manager@gusto.dev",
      phone: "+91 98765 43211",
      passwordHash: staffPasswordHash,
      role: "MANAGER",
    })
    .returning();
  const manager = managerResults[0]!;
  console.log(`  ✅ Manager: ${manager.name} (${manager.email})`);

  const cashierResults = await db
    .insert(cloudSchema.users)
    .values({
      organizationId: org.id,
      outletId: outlet.id,
      name: "Rahul Kumar",
      email: "cashier@gusto.dev",
      passwordHash: staffPasswordHash,
      pin: "1234",
      role: "CASHIER",
    })
    .returning();
  const cashier = cashierResults[0]!;
  console.log(`  ✅ Cashier: ${cashier.name} (${cashier.email})`);

  const waiterResults = await db
    .insert(cloudSchema.users)
    .values({
      organizationId: org.id,
      outletId: outlet.id,
      name: "Vikram Singh",
      pin: "5678",
      role: "WAITER",
    })
    .returning();
  const waiter = waiterResults[0]!;
  console.log(`  ✅ Waiter: ${waiter.name}`);

  const chefResults = await db
    .insert(cloudSchema.users)
    .values({
      organizationId: org.id,
      outletId: outlet.id,
      name: "Meera Nair",
      pin: "9012",
      role: "CHEF",
    })
    .returning();
  const chef = chefResults[0]!;
  console.log(`  ✅ Chef: ${chef.name}`);

  // ─── Menu Categories ───
  console.log("Creating menu categories...");
  const categoryData = STANDARD_MENU_CATEGORIES;

  const categories = await db
    .insert(cloudSchema.menuCategories)
    .values(
      categoryData.map((c) => ({
        outletId: outlet.id,
        name: c.name,
        sortOrder: c.sortOrder,
      }))
    )
    .returning();
  console.log(`  ✅ Created ${categories.length} categories`);

  // Build a category name → ID map
  const catMap = new Map<string, string>();
  for (const cat of categories) {
    catMap.set(cat.name, cat.id);
  }

  // ─── Menu Items ───
  console.log("Creating menu items...");

  const menuItemsData = STANDARD_MENU_ITEMS;

  const menuItemValues = menuItemsData.map((item, idx) => {
    const categoryId = catMap.get(item.categoryName);
    if (!categoryId) {
      throw new Error(`Category not found: ${item.categoryName}`);
    }
    return {
      categoryId,
      outletId: outlet.id,
      name: item.name,
      description: item.description,
      variants: item.variants,
      price: item.price,
      gstRate: item.gstRate,
      isVeg: item.isVeg,
      sortOrder: idx + 1,
    };
  });

  const menuItems = await db
    .insert(cloudSchema.menuItems)
    .values(menuItemValues)
    .returning();
  console.log(`  ✅ Created ${menuItems.length} menu items`);

  // ─── Dining Tables ───
  console.log("Creating dining tables...");
  const tablesData = [
    { name: "T1", capacity: 2, section: "Indoor" },
    { name: "T2", capacity: 2, section: "Indoor" },
    { name: "T3", capacity: 4, section: "Indoor" },
    { name: "T4", capacity: 4, section: "Indoor" },
    { name: "T5", capacity: 6, section: "Indoor" },
    { name: "T6", capacity: 6, section: "Indoor" },
    { name: "T7", capacity: 8, section: "Indoor" },
    { name: "T8", capacity: 4, section: "Outdoor" },
    { name: "T9", capacity: 4, section: "Outdoor" },
    { name: "T10", capacity: 6, section: "Outdoor" },
  ];

  const tables = await db
    .insert(cloudSchema.diningTables)
    .values(
      tablesData.map((t, idx) => ({
        outletId: outlet.id,
        name: t.name,
        capacity: t.capacity,
        section: t.section,
        sortOrder: idx + 1,
      }))
    )
    .returning();
  console.log(`  ✅ Created ${tables.length} dining tables`);

  // ─── Sample Customers ───
  console.log("Creating sample customers...");
  const customersData = [
    { name: "Ananya Gupta", phone: "+91 98765 11111", email: "ananya@example.com" },
    { name: "Rohan Mehta", phone: "+91 98765 22222" },
    { name: "Sneha Iyer", phone: "+91 98765 33333", email: "sneha@example.com" },
  ];

  const customersCreated = await db
    .insert(cloudSchema.customers)
    .values(
      customersData.map((c) => ({
        organizationId: org.id,
        name: c.name,
        phone: c.phone,
        email: c.email,
      }))
    )
    .returning();
  console.log(`  ✅ Created ${customersCreated.length} customers`);

  // ─── Summary ───
  console.log(`
╔══════════════════════════════════════════════╗
║       🌱 Seed Complete!                     ║
╠══════════════════════════════════════════════╣
║  Organization: Gusto Demo Restaurant         ║
║  Franchise:    Mumbai Central                ║
║  Outlet:       Gusto - Andheri West          ║
║  Users:        5 (Owner, Manager,            ║
║                   Cashier, Waiter, Chef)      ║
║  Categories:   ${categories.length}                             ║
║  Menu Items:   ${menuItems.length}                            ║
║  Tables:       ${tables.length}                            ║
║  Customers:    ${customersCreated.length}                             ║
╠══════════════════════════════════════════════╣
║  Login:  admin@gusto.dev / admin123          ║
╚══════════════════════════════════════════════╝
  `);

  process.exit(0);
}

seed().catch((err) => {
  console.error("❌ Seed failed:", err);
  process.exit(1);
});
