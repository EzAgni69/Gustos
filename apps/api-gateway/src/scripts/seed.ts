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
  const categoryData = [
    { name: "Starters", sortOrder: 1 },
    { name: "Salads", sortOrder: 2 },
    { name: "Bruschetta", sortOrder: 3 },
    { name: "Sandwiches", sortOrder: 4 },
    { name: "Calzones", sortOrder: 5 },
    { name: "Regular Pizzas", sortOrder: 6 },
    { name: "Premium Pizzas", sortOrder: 7 },
    { name: "Pastas", sortOrder: 8 },
    { name: "Desserts", sortOrder: 9 },
    { name: "Refreshments", sortOrder: 10 },
    { name: "Combos & Specials", sortOrder: 11 },
  ];

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

  type GSTRate = "0" | "5" | "12" | "18" | "28";
  interface SeedMenuItem {
    categoryName: string;
    name: string;
    description: string;
    variants: string | null;
    price: string;
    gstRate: GSTRate;
    isVeg: boolean;
  }

  const menuItemsData: SeedMenuItem[] = [
    {
      categoryName: "Starters",
      name: "Garlic Tasca",
      description: "Fresh Dough Hand Stretched Stuffed With Garlic Paste & Oregano.",
      variants: JSON.stringify([{"name": "8\"", "price": 500.0}, {"name": "12\"", "price": 650.0}]),
      price: "500.00",
      gstRate: "5",
      isVeg: true,
    },
    {
      categoryName: "Starters",
      name: "Cheese Garlic Tasca",
      description: "Fresh Dough Hand Stretched Stuffed With Garlic Paste, Oregano And Mozzarella.",
      variants: JSON.stringify([{"name": "8\"", "price": 600.0}, {"name": "12\"", "price": 750.0}]),
      price: "600.00",
      gstRate: "5",
      isVeg: true,
    },
    {
      categoryName: "Starters",
      name: "Pesto Garlic Tasca",
      description: "Fresh Dough Hand Stretched Stuffed With Our Signature Pine Nuts Pesto Sauce, Garlic Paste And Oregano",
      variants: JSON.stringify([{"name": "8\"", "price": 800.0}, {"name": "12\"", "price": 1100.0}]),
      price: "800.00",
      gstRate: "5",
      isVeg: true,
    },
    {
      categoryName: "Starters",
      name: "Pesto Cheese Garlic Tasca",
      description: "Fresh Dough Hand Stretched Stuffed With Our Signature Pine Nuts Pesto Sauce, Garlic Paste, Oregano And Mozzarella",
      variants: JSON.stringify([{"name": "8\"", "price": 850.0}, {"name": "12\"", "price": 1200.0}]),
      price: "850.00",
      gstRate: "5",
      isVeg: true,
    },
    {
      categoryName: "Starters",
      name: "Spiccio D'aglio",
      description: "Fresh Dough Hand Stretched Garnished With Garlic Paste, Oregano, Chilli Flakes And Mozzarella.",
      variants: JSON.stringify([{"name": "8\"", "price": 650.0}, {"name": "12\"", "price": 850.0}]),
      price: "650.00",
      gstRate: "5",
      isVeg: true,
    },
    {
      categoryName: "Salads",
      name: "Caprese Salade",
      description: "Slices Of Mozzarella Di Bufala And Fresh Tomatoes Garnished With Parmesan, Black Pepper Powder, Salt, 100% Italian Evo Oil And 100% Organic, Italian Basils",
      variants: null,
      price: "800.00",
      gstRate: "5",
      isVeg: true,
    },
    {
      categoryName: "Salads",
      name: "Insalata Di Verdure",
      description: "Onion, Olives, Italian Bell Peppers, Zuchini, Broccoli, Tomato, Parmesan, Extra Virgin Olive Oil.",
      variants: null,
      price: "750.00",
      gstRate: "5",
      isVeg: true,
    },
    {
      categoryName: "Bruschetta",
      name: "Garlic Butter",
      description: "Sour Dough Bread Slice With Garlic Butter Paste, Oregano And Mozzarella.",
      variants: null,
      price: "300.00",
      gstRate: "5",
      isVeg: true,
    },
    {
      categoryName: "Bruschetta",
      name: "Caprese",
      description: "Sour Dough Bread Slice With Garlic Butter Paste, Oregano, Tomato Cubes And Bocconcini.",
      variants: null,
      price: "450.00",
      gstRate: "5",
      isVeg: true,
    },
    {
      categoryName: "Bruschetta",
      name: "Funghi Formaggio",
      description: "Sour Dough Bread Slice With Oregano, Garlic Tossed Mushrooms And Mozzarella.",
      variants: null,
      price: "450.00",
      gstRate: "5",
      isVeg: true,
    },
    {
      categoryName: "Bruschetta",
      name: "Ricotta Piccante",
      description: "Sour Dough Bread Slice With Garlic Butter Paste, Oregano, Green Chillies And Ricotta Cheese.",
      variants: null,
      price: "500.00",
      gstRate: "5",
      isVeg: true,
    },
    {
      categoryName: "Bruschetta",
      name: "Ricotta E Pesto",
      description: "Sour Dough Bread Slice With Our Signature Pine Nuts Pesto, Garlic Butter Paste, Oregano And Ricotta Cheese.",
      variants: null,
      price: "700.00",
      gstRate: "5",
      isVeg: true,
    },
    {
      categoryName: "Bruschetta",
      name: "Funghi Garlic",
      description: "Sour Dough Bread Slice With Garlic Butter Paste, Oregano, Black Pepper Powder And Chopped Mushrooms And Ricotta Cheese.",
      variants: null,
      price: "500.00",
      gstRate: "5",
      isVeg: true,
    },
    {
      categoryName: "Sandwiches",
      name: "Margherita Panuozzo",
      description: "Fresh Basils, Oregano And Grana Padano Parmesan. (Base: Hand Stretched Dough, Marinara Sauce, Oregano, Mozzarella)",
      variants: JSON.stringify([{"name": "8\"", "price": 550.0}, {"name": "12\"", "price": 850.0}]),
      price: "550.00",
      gstRate: "5",
      isVeg: true,
    },
    {
      categoryName: "Sandwiches",
      name: "My Panuozzo",
      description: "Marinara Sauce, Oregano And Mozzarella With 3 Regular Veggies Of Your Choice.",
      variants: null,
      price: "900.00",
      gstRate: "5",
      isVeg: true,
    },
    {
      categoryName: "Sandwiches",
      name: "Rotolo Di Ricotta E Spinaci Piccante",
      description: "Inside Out Fresh Dough Rolled With Stuffings Of Green Chillies, Garlic Olive Oil And Ricotta Cheese, Spinach.",
      variants: JSON.stringify([{"name": "8\"", "price": 750.0}, {"name": "12\"", "price": 1000.0}]),
      price: "750.00",
      gstRate: "5",
      isVeg: true,
    },
    {
      categoryName: "Sandwiches",
      name: "Ventaglio",
      description: "Fresh Dough Bread Stuffed With Tomato, Arugula (Rocket Leaves), Black Olive, Parmesan, And Evo Oli. Serves Two Person.",
      variants: null,
      price: "1200.00",
      gstRate: "5",
      isVeg: true,
    },
    {
      categoryName: "Sandwiches",
      name: "Margherita Panzerotti",
      description: "Oregano, Marinara Sauce And Mozzarella.",
      variants: null,
      price: "700.00",
      gstRate: "5",
      isVeg: true,
    },
    {
      categoryName: "Sandwiches",
      name: "Pesto Panzerotti",
      description: "Our Signature Pine Nuts Pesto, Grana Padano, Parmesan And Mozzarella Di Bufala.",
      variants: null,
      price: "1400.00",
      gstRate: "5",
      isVeg: true,
    },
    {
      categoryName: "Sandwiches",
      name: "My Panzerotti",
      description: "Oregano And Your Choice Of Three Veggies.",
      variants: null,
      price: "900.00",
      gstRate: "5",
      isVeg: true,
    },
    {
      categoryName: "Calzones",
      name: "Margherita",
      description: "Fresh Basils And Oregano. (Base: Hand Stretched Dough, Marinara Sauce, Oregano, Mozzarella)",
      variants: null,
      price: "900.00",
      gstRate: "5",
      isVeg: true,
    },
    {
      categoryName: "Calzones",
      name: "Pesto",
      description: "Stuffed With Our Signature Pine Nut Pesto Sauce, Italian Basils, Grana Padano Parmesan And Extra Virgin Olive Oil, Mozzarella And Mozzarella Di Bufala",
      variants: null,
      price: "1800.00",
      gstRate: "5",
      isVeg: true,
    },
    {
      categoryName: "Calzones",
      name: "Tricolor",
      description: "Three Different Flavours In One Calzone With Our Signature Pine Nut Pesto Sauce, White Sauce And Marinara Sauce",
      variants: null,
      price: "1800.00",
      gstRate: "5",
      isVeg: true,
    },
    {
      categoryName: "Calzones",
      name: "My Calzone",
      description: "Make Your Own Calzone With Choice Of Three Ingredients In Veggies.",
      variants: null,
      price: "1100.00",
      gstRate: "5",
      isVeg: true,
    },
    {
      categoryName: "Regular Pizzas",
      name: "Margherita",
      description: "Fresh Basils, Oregano, Marinara Sauce And Mozzarella.",
      variants: JSON.stringify([{"name": "8\"", "price": 600.0}, {"name": "12\"", "price": 900.0}]),
      price: "600.00",
      gstRate: "5",
      isVeg: true,
    },
    {
      categoryName: "Regular Pizzas",
      name: "Vegetariana",
      description: "Capsicum, Sweet Corn, Onion And Red Paprika.",
      variants: JSON.stringify([{"name": "8\"", "price": 750.0}, {"name": "12\"", "price": 1000.0}]),
      price: "750.00",
      gstRate: "5",
      isVeg: true,
    },
    {
      categoryName: "Regular Pizzas",
      name: "Caprese Pizza",
      description: "Capers (Spanish Peppers), Oregano And Mushrooms",
      variants: JSON.stringify([{"name": "8\"", "price": 650.0}, {"name": "12\"", "price": 1000.0}]),
      price: "650.00",
      gstRate: "5",
      isVeg: true,
    },
    {
      categoryName: "Regular Pizzas",
      name: "Montanara",
      description: "Oregano, Mushrooms, Black Olives And Onions",
      variants: JSON.stringify([{"name": "8\"", "price": 650.0}, {"name": "12\"", "price": 1000.0}]),
      price: "650.00",
      gstRate: "5",
      isVeg: true,
    },
    {
      categoryName: "Regular Pizzas",
      name: "Quattro Staggioni",
      description: "Oregano, Capsicum, Jalapenos And Green Olives.",
      variants: JSON.stringify([{"name": "8\"", "price": 700.0}, {"name": "12\"", "price": 1050.0}]),
      price: "700.00",
      gstRate: "5",
      isVeg: true,
    },
    {
      categoryName: "Regular Pizzas",
      name: "Campagnola",
      description: "Capsicum, Sweet Corn, Jalapenos And Red Paprika.",
      variants: JSON.stringify([{"name": "8\"", "price": 650.0}, {"name": "12\"", "price": 1000.0}]),
      price: "650.00",
      gstRate: "5",
      isVeg: true,
    },
    {
      categoryName: "Regular Pizzas",
      name: "Ortolana",
      description: "Oregano, Capsicum, Black Olives And Mushrooms",
      variants: JSON.stringify([{"name": "8\"", "price": 650.0}, {"name": "12\"", "price": 1000.0}]),
      price: "650.00",
      gstRate: "5",
      isVeg: true,
    },
    {
      categoryName: "Regular Pizzas",
      name: "Dugliese",
      description: "Oregano, Capers (Spanish Peppers) And Onions.",
      variants: JSON.stringify([{"name": "8\"", "price": 600.0}, {"name": "12\"", "price": 950.0}]),
      price: "600.00",
      gstRate: "5",
      isVeg: true,
    },
    {
      categoryName: "Regular Pizzas",
      name: "Funghi Spinaci",
      description: "Fresh Spinach And Fresh Mushrooms.",
      variants: JSON.stringify([{"name": "8\"", "price": 650.0}, {"name": "12\"", "price": 1000.0}]),
      price: "650.00",
      gstRate: "5",
      isVeg: true,
    },
    {
      categoryName: "Regular Pizzas",
      name: "Farmfresh",
      description: "Capsicum, Fresh Mushrooms, Black Olives And Onion",
      variants: JSON.stringify([{"name": "8\"", "price": 750.0}, {"name": "12\"", "price": 1100.0}]),
      price: "750.00",
      gstRate: "5",
      isVeg: true,
    },
    {
      categoryName: "Regular Pizzas",
      name: "Exotica",
      description: "Capsicum, Green Olives, Cottage Cheese (Paneer) And Red Paprika.",
      variants: JSON.stringify([{"name": "8\"", "price": 700.0}, {"name": "12\"", "price": 1100.0}]),
      price: "700.00",
      gstRate: "5",
      isVeg: true,
    },
    {
      categoryName: "Regular Pizzas",
      name: "Indiana",
      description: "Oregano, Cottage Cheese (Paneer) And Olive Oil Garlic Paste.",
      variants: JSON.stringify([{"name": "8\"", "price": 650.0}, {"name": "12\"", "price": 1000.0}]),
      price: "650.00",
      gstRate: "5",
      isVeg: true,
    },
    {
      categoryName: "Regular Pizzas",
      name: "Thunderbird",
      description: "Oregano, Fresh Mushrooms, Black Olives And Green Chillies.",
      variants: JSON.stringify([{"name": "8\"", "price": 650.0}, {"name": "12\"", "price": 1000.0}]),
      price: "650.00",
      gstRate: "5",
      isVeg: true,
    },
    {
      categoryName: "Regular Pizzas",
      name: "Volcano",
      description: "Oregano, Baby Corn, Black Olives And Olive Oil Garlic Paste.",
      variants: JSON.stringify([{"name": "8\"", "price": 650.0}, {"name": "12\"", "price": 1000.0}]),
      price: "650.00",
      gstRate: "5",
      isVeg: true,
    },
    {
      categoryName: "Regular Pizzas",
      name: "Signorina",
      description: "Oregano, Capsicum, Black Olives, Baby Corn, Red Paprika And Red Chilli Flakes",
      variants: JSON.stringify([{"name": "8\"", "price": 700.0}, {"name": "12\"", "price": 1100.0}]),
      price: "700.00",
      gstRate: "5",
      isVeg: true,
    },
    {
      categoryName: "Regular Pizzas",
      name: "Fiocchi Di Latte",
      description: "Oregano, Cottage Cheese (Paneer), Green Chillies And Black Olives.",
      variants: JSON.stringify([{"name": "8\"", "price": 650.0}, {"name": "12\"", "price": 950.0}]),
      price: "650.00",
      gstRate: "5",
      isVeg: true,
    },
    {
      categoryName: "Regular Pizzas",
      name: "Pomodoro",
      description: "Fresh Tomato Slices, Oregano & Basils.",
      variants: JSON.stringify([{"name": "8\"", "price": 650.0}, {"name": "12\"", "price": 1000.0}]),
      price: "650.00",
      gstRate: "5",
      isVeg: true,
    },
    {
      categoryName: "Regular Pizzas",
      name: "Fattoria",
      description: "Spinach, Capsicum, Mushrooms, Green Olives, Baby Corn, Onion, Jalapenos And Green Chillies.",
      variants: JSON.stringify([{"name": "8\"", "price": 1200.0}, {"name": "12\"", "price": 1400.0}]),
      price: "1200.00",
      gstRate: "5",
      isVeg: true,
    },
    {
      categoryName: "Regular Pizzas",
      name: "Ricotta E Spinaci",
      description: "Fresh Spinach, Ricotta Cheese And Garlic Cloves",
      variants: JSON.stringify([{"name": "8\"", "price": 850.0}, {"name": "12\"", "price": 1150.0}]),
      price: "850.00",
      gstRate: "5",
      isVeg: true,
    },
    {
      categoryName: "Regular Pizzas",
      name: "Padana",
      description: "Oregano, Spinach, Sweet Corn And Black Pepper Powder.",
      variants: JSON.stringify([{"name": "8\"", "price": 700.0}, {"name": "12\"", "price": 1000.0}]),
      price: "700.00",
      gstRate: "5",
      isVeg: true,
    },
    {
      categoryName: "Regular Pizzas",
      name: "Formaggio Vulcanico",
      description: "Oregano, Mozzarella Ball In Mountain Shape And Marinara Sauce To Give Volcanic Eruption.",
      variants: JSON.stringify([{"name": "8\"", "price": 700.0}, {"name": "12\"", "price": 1000.0}]),
      price: "700.00",
      gstRate: "5",
      isVeg: true,
    },
    {
      categoryName: "Regular Pizzas",
      name: "Sopra Il Suolo",
      description: "Oregano, Baby Corn, Black Olives, Mushrooms, Jalapenos, Red Paprika And Red Chillie Flakes.",
      variants: JSON.stringify([{"name": "8\"", "price": 750.0}, {"name": "12\"", "price": 1100.0}]),
      price: "750.00",
      gstRate: "5",
      isVeg: true,
    },
    {
      categoryName: "Regular Pizzas",
      name: "Spinaci Piccante",
      description: "Oregano, Spinach, Green Chillies And Red Paprika.",
      variants: JSON.stringify([{"name": "8\"", "price": 700.0}, {"name": "12\"", "price": 1000.0}]),
      price: "700.00",
      gstRate: "5",
      isVeg: true,
    },
    {
      categoryName: "Regular Pizzas",
      name: "Verdure Tritate",
      description: "Oregano, Finely Chopped (Spinach, Baby Corn, Mushrooms, Jalapenos, Onion, Olives, Capsicum) And Green Chillies.",
      variants: JSON.stringify([{"name": "8\"", "price": 900.0}, {"name": "12\"", "price": 1200.0}]),
      price: "900.00",
      gstRate: "5",
      isVeg: true,
    },
    {
      categoryName: "Regular Pizzas",
      name: "Pizza Esotiche",
      description: "Oregano, Grana Padano Parmesan, Zucchini, Broccoli, Mushrooms And Capers.",
      variants: JSON.stringify([{"name": "8\"", "price": 1000.0}, {"name": "12\"", "price": 1300.0}]),
      price: "1000.00",
      gstRate: "5",
      isVeg: true,
    },
    {
      categoryName: "Regular Pizzas",
      name: "Pizza Francescana",
      description: "Grana Padano Parmesan And Mushrooms.",
      variants: JSON.stringify([{"name": "8\"", "price": 800.0}, {"name": "12\"", "price": 1100.0}]),
      price: "800.00",
      gstRate: "5",
      isVeg: true,
    },
    {
      categoryName: "Regular Pizzas",
      name: "Pizza Marinara",
      description: "Made Of Marinara Sauce, Oregano And Garlic Cloves Garnished With Fresh Italian Basil Leaves.",
      variants: JSON.stringify([{"name": "8\"", "price": 600.0}, {"name": "12\"", "price": 800.0}]),
      price: "600.00",
      gstRate: "5",
      isVeg: true,
    },
    {
      categoryName: "Regular Pizzas",
      name: "Pugliese",
      description: "Oregano, Mushrooms, Baby Corn, Onion, Black Olives And Red Paprika.",
      variants: JSON.stringify([{"name": "8\"", "price": 650.0}, {"name": "12\"", "price": 900.0}]),
      price: "650.00",
      gstRate: "5",
      isVeg: true,
    },
    {
      categoryName: "Regular Pizzas",
      name: "Mt. Vesuvio",
      description: "Double Layered Pizza Made Of Fresh Dough With Marinara Sauce, Ricotta Cheese, Mushrooms, Jalapenos, Green Olives And Mozzarella. Garnished With Marinara Sauce.",
      variants: JSON.stringify([{"name": "8\"", "price": 1050.0}, {"name": "12\"", "price": 1350.0}]),
      price: "1050.00",
      gstRate: "5",
      isVeg: true,
    },
    {
      categoryName: "Regular Pizzas",
      name: "Capperi E Funghi",
      description: "Mushrrom, Green Chillies, Baby Corn And Capers.",
      variants: JSON.stringify([{"name": "8\"", "price": 750.0}, {"name": "12\"", "price": 1100.0}]),
      price: "750.00",
      gstRate: "5",
      isVeg: true,
    },
    {
      categoryName: "Premium Pizzas",
      name: "Premium Margherita",
      description: "Fresh Basils, Oregano And Grana Padano Parmesan.",
      variants: JSON.stringify([{"name": "8\"", "price": 800.0}, {"name": "12\"", "price": 1100.0}]),
      price: "800.00",
      gstRate: "5",
      isVeg: true,
    },
    {
      categoryName: "Premium Pizzas",
      name: "Carbonara",
      description: "Ricotta Cheese & Grana Padano Parmesan Cheese.",
      variants: JSON.stringify([{"name": "8\"", "price": 900.0}, {"name": "12\"", "price": 1200.0}]),
      price: "900.00",
      gstRate: "5",
      isVeg: true,
    },
    {
      categoryName: "Premium Pizzas",
      name: "Valdostana",
      description: "Oregano And Cream Cheese.",
      variants: JSON.stringify([{"name": "8\"", "price": 900.0}, {"name": "12\"", "price": 1100.0}]),
      price: "900.00",
      gstRate: "5",
      isVeg: true,
    },
    {
      categoryName: "Premium Pizzas",
      name: "Quattro Formaggi",
      description: "Grana Padano Parmesan Cheese, White Cream Cheese, Ricotta Cheese Gorgonzola Cheese And Bocconcini Cheese.",
      variants: JSON.stringify([{"name": "8\"", "price": 1000.0}, {"name": "12\"", "price": 1200.0}]),
      price: "1000.00",
      gstRate: "5",
      isVeg: true,
    },
    {
      categoryName: "Premium Pizzas",
      name: "Gorgonzola",
      description: "Oregano, Gorgonzola Cheese And Black Olives",
      variants: JSON.stringify([{"name": "8\"", "price": 900.0}, {"name": "12\"", "price": 1200.0}]),
      price: "900.00",
      gstRate: "5",
      isVeg: true,
    },
    {
      categoryName: "Premium Pizzas",
      name: "Fontana",
      description: "Gorgonzola Cheese And Grana Padano Parmesan Cheese.",
      variants: JSON.stringify([{"name": "8\"", "price": 900.0}, {"name": "12\"", "price": 1200.0}]),
      price: "900.00",
      gstRate: "5",
      isVeg: true,
    },
    {
      categoryName: "Premium Pizzas",
      name: "Tirolese",
      description: "Oregano, Gorgonzola Cheese And Mushrooms",
      variants: JSON.stringify([{"name": "8\"", "price": 900.0}, {"name": "12\"", "price": 1200.0}]),
      price: "900.00",
      gstRate: "5",
      isVeg: true,
    },
    {
      categoryName: "Premium Pizzas",
      name: "Napoletana (Napoli)",
      description: "Oregano And Capers (Spanish Peppers).",
      variants: JSON.stringify([{"name": "8\"", "price": 900.0}, {"name": "12\"", "price": 1200.0}]),
      price: "900.00",
      gstRate: "5",
      isVeg: true,
    },
    {
      categoryName: "Premium Pizzas",
      name: "Pemari",
      description: "Mouth Watering Combination Of Marinara Sauce, Our Signature Pine Nut Pesto Sauce, Ricotta Cheese, Parmesan And Mozzarella Di Bufala.",
      variants: JSON.stringify([{"name": "8\"", "price": 1100.0}, {"name": "12\"", "price": 1400.0}]),
      price: "1100.00",
      gstRate: "5",
      isVeg: true,
    },
    {
      categoryName: "Premium Pizzas",
      name: "Panna Acida",
      description: "Made Of Fresh Tomato Slices / Sundried Tomatoes, Mushroom, Parmesan And Mozzarella Di Bufala, Garnished With Stracciatella Cheese.",
      variants: JSON.stringify([{"name": "8\"", "price": 1100.0}, {"name": "12\"", "price": 1500.0}]),
      price: "1100.00",
      gstRate: "5",
      isVeg: true,
    },
    {
      categoryName: "Premium Pizzas",
      name: "Pesto Pizza",
      description: "Made With Our Signature Pine Nuts Pesto, Parmesan And Mozzarella Di Bufala.",
      variants: JSON.stringify([{"name": "8\"", "price": 1300.0}, {"name": "12\"", "price": 1800.0}]),
      price: "1300.00",
      gstRate: "5",
      isVeg: true,
    },
    {
      categoryName: "Premium Pizzas",
      name: "Pesto Al Pomodoro Pizza",
      description: "Made With Our Signature Pine Nuts Pesto, Parmesan Fresh Tomato Slices And Bocconcini.",
      variants: JSON.stringify([{"name": "8\"", "price": 1300.0}, {"name": "12\"", "price": 1900.0}]),
      price: "1300.00",
      gstRate: "5",
      isVeg: true,
    },
    {
      categoryName: "Premium Pizzas",
      name: "Parmigiana",
      description: "Made Of Pre Baked Marinara Sauce, Parmesan, Aubergine, Mozzarella Di Bufala And Special Spices",
      variants: JSON.stringify([{"name": "8\"", "price": 1000.0}, {"name": "12\"", "price": 1300.0}]),
      price: "1000.00",
      gstRate: "5",
      isVeg: true,
    },
    {
      categoryName: "Premium Pizzas",
      name: "Braccio Di Ferro",
      description: "Hand Stretched Fresh Dough, San Marzano Marinara Sauce, Parmesan Cheese, Spinach, Ricotta Cheese And Mozzarella Di Bufala.",
      variants: JSON.stringify([{"name": "8\"", "price": 1050.0}, {"name": "12\"", "price": 1400.0}]),
      price: "1050.00",
      gstRate: "5",
      isVeg: true,
    },
    {
      categoryName: "Premium Pizzas",
      name: "Salsa Bianca",
      description: "Parmesan, Mozzarella, Broccoli/Arugula, Mushroom, Black Olive & Truffle Oil With Freshly Made White Sauce. (Making Time 25 Minutes)",
      variants: JSON.stringify([{"name": "8\"", "price": 1100.0}, {"name": "12\"", "price": 1500.0}]),
      price: "1100.00",
      gstRate: "5",
      isVeg: true,
    },
    {
      categoryName: "Pastas",
      name: "Ciotola Di Pasta Al Pomodoro",
      description: "Pasta Made Of Authentic Italian San Marzano Red Sauce, Oregano, Chilli Flakes, Garlic Olive Oil Paste.",
      variants: null,
      price: "700.00",
      gstRate: "5",
      isVeg: true,
    },
    {
      categoryName: "Pastas",
      name: "Ciotola Di Pasta Al Pesto",
      description: "Pasta Made Of Authentic Pine Nuts And Italian Basils, Oregano, Garlic Olive Paste",
      variants: null,
      price: "1150.00",
      gstRate: "5",
      isVeg: true,
    },
    {
      categoryName: "Pastas",
      name: "Ciotola Di Pasta Al Alfredo",
      description: "Pasta Made Of Authentic White Sauce Using Grana Padano Parmesan, Nutmeg Powder And Black Pepper Powder.",
      variants: null,
      price: "900.00",
      gstRate: "5",
      isVeg: true,
    },
    {
      categoryName: "Pastas",
      name: "Aglio E Olio",
      description: "Spaghetti Pasta Made Of 100% Extra Virgin Olive Oil, Garlic Paste, Garlic Cloves Garnished Using Grana Padano Parmesan. (Two options: Traditional or with Signature Pine Nut Pesto).",
      variants: null,
      price: "850.00",
      gstRate: "5",
      isVeg: true,
    },
    {
      categoryName: "Pastas",
      name: "Aglio E Olio Al Pesto",
      description: "Spaghetti Pasta Made Of 100% Extra Virgin Olive Oil, Garlic Paste, Garlic Cloves Garnished Using Grana Padano Parmesan. (Two options: Traditional or with Signature Pine Nut Pesto).",
      variants: null,
      price: "1100.00",
      gstRate: "5",
      isVeg: true,
    },
    {
      categoryName: "Pastas",
      name: "Pasta Penne A La Quattro Pomodorini",
      description: "Penne Pasta Cooked With Four Types Of Tomato Paste, Garlic, Peppers, Salt And Parmesan",
      variants: null,
      price: "800.00",
      gstRate: "5",
      isVeg: true,
    },
    {
      categoryName: "Pastas",
      name: "Ciotola Di Pasta Pemari",
      description: "Mouth Watering Combination Of Marinara Sauce, Our Signature Pine Nut Pesto Sauce, Ricotta Cheese, Parmesan And Mozzarella Di Bufala.",
      variants: null,
      price: "1200.00",
      gstRate: "5",
      isVeg: true,
    },
    {
      categoryName: "Pastas",
      name: "Cacio \u0415 \u0420\u0435\u0440e A La Tartufo",
      description: "Spaghetti Pasta Made Of 100% Extra Virgin Olive Oil, Garlic Paste, Garlic Cloves Garnished Using Grana Padano Parmesan. (Two options: Traditional or with Signature Pine Nut Pesto).",
      variants: null,
      price: "1000.00",
      gstRate: "5",
      isVeg: true,
    },
    {
      categoryName: "Desserts",
      name: "Lotus Biscoff Cheese Cake",
      description: "Eggless Cheese Cake Made With Lotus Biscoff.",
      variants: null,
      price: "400.00",
      gstRate: "5",
      isVeg: true,
    },
    {
      categoryName: "Desserts",
      name: "Tiramisu",
      description: "Eggless Tiramisu",
      variants: null,
      price: "400.00",
      gstRate: "5",
      isVeg: true,
    },
    {
      categoryName: "Refreshments",
      name: "Cold Drinks",
      description: "Coke/Diet-Coke/Coke-Zero/Thumbs-Up/Fanta/Sprite (Served With Glass, Lemon Slices, Ice Cubes And Straw) 330 ml Canister.",
      variants: null,
      price: "70.00",
      gstRate: "5",
      isVeg: true,
    },
    {
      categoryName: "Refreshments",
      name: "Pure Mint Mojito",
      description: "350ml",
      variants: null,
      price: "200.00",
      gstRate: "5",
      isVeg: true,
    },
    {
      categoryName: "Refreshments",
      name: "Pure Mint Mojito With Sprite",
      description: "350ml",
      variants: null,
      price: "200.00",
      gstRate: "5",
      isVeg: true,
    },
    {
      categoryName: "Refreshments",
      name: "Mojito",
      description: "With Fresh Orange Nectar And Mint Leaves In Sprite",
      variants: null,
      price: "250.00",
      gstRate: "5",
      isVeg: true,
    },
    {
      categoryName: "Refreshments",
      name: "Soul Cool",
      description: "\\-",
      variants: null,
      price: "250.00",
      gstRate: "5",
      isVeg: true,
    },
    {
      categoryName: "Refreshments",
      name: "Bottled Water",
      description: "750 ml",
      variants: null,
      price: "40.00",
      gstRate: "5",
      isVeg: true,
    },
    // ─── Combos & Half N Half Specials ───
    {
      categoryName: "Combos & Specials",
      name: "Regular Half N Half Pizza",
      description: "Your Choice Of 2 Regular Pizzas — Each Half Of The Pizza Is A Different Regular Flavour.",
      variants: JSON.stringify([{ name: "8\"", price: 1000.0 }, { name: "12\"", price: 1200.0 }]),
      price: "1000.00",
      gstRate: "5",
      isVeg: true,
    },
    {
      categoryName: "Combos & Specials",
      name: "Premium Half N Half Pizza",
      description: "Your Choice Of 2 Premium Pizzas — Each Half Of The Pizza Is A Different Premium Flavour.",
      variants: JSON.stringify([{ name: "8\"", price: 1200.0 }, { name: "12\"", price: 1800.0 }]),
      price: "1200.00",
      gstRate: "5",
      isVeg: true,
    },
    {
      categoryName: "Combos & Specials",
      name: "Cross Half N Half Pizza",
      description: "Your Choice Of 1 Regular & 1 Premium Pizza — Captain Will Confirm Pricing Based On Selection.",
      variants: JSON.stringify([{ name: "8\"", price: 1100.0 }, { name: "12\"", price: 1500.0 }]),
      price: "1100.00",
      gstRate: "5",
      isVeg: true,
    },
    {
      categoryName: "Combos & Specials",
      name: "Regular Pizza Combo",
      description: "Your Choice Of Regular Pizza + Cheese Garlic Tasca + Beverage.",
      variants: JSON.stringify([{ name: "8\"", price: 1300.0 }, { name: "12\"", price: 1650.0 }]),
      price: "1300.00",
      gstRate: "5",
      isVeg: true,
    },
    {
      categoryName: "Combos & Specials",
      name: "Premium Pizza Combo",
      description: "Your Choice Of Premium Pizza + Cheese Garlic Tasca + Beverage.",
      variants: JSON.stringify([{ name: "8\"", price: 1600.0 }, { name: "12\"", price: 1950.0 }]),
      price: "1600.00",
      gstRate: "5",
      isVeg: true,
    },
    {
      categoryName: "Combos & Specials",
      name: "Pesto Pizza Combo",
      description: "Pesto Cheese Garlic Tasca + Pesto Pizza + Beverage. Comes With Exotic Pine Nuts Pesto, Grana Padano Parmesan, Mozzarella Di Bufala.",
      variants: JSON.stringify([{ name: "8\"", price: 1700.0 }, { name: "12\"", price: 2400.0 }]),
      price: "1700.00",
      gstRate: "5",
      isVeg: true,
    },
  ];

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
