/**
 * Gusto POS Local Server — Local SQLite Seed Script
 *
 * Seeds the local SQLite database with menu, tables, and users.
 * Can fetch from cloud API or use embedded data.
 *
 * Usage: pnpm --filter @gusto/pos-local-server seed
 */

import { v4 as uuid } from "uuid";
import * as schema from "@gusto/db-schema/local";
import { db, sqlite } from "../db/index.js";
import { initializeDatabase } from "../db/index.js";

// ─── Initialize Database ───
try {
  initializeDatabase();
} catch {
  // Already initialized, continue
}

console.log("🌱 Seeding local SQLite database...\n");

// ─── Seed Local Users (PIN-based auth) ───
const users = [
  { id: uuid(), name: "Arjun Patel (Owner)", pin: "1234", role: "OWNER", isActive: true },
  { id: uuid(), name: "Meera Singh (Manager)", pin: "5678", role: "MANAGER", isActive: true },
  { id: uuid(), name: "Raj Kumar (Cashier)", pin: "1111", role: "CASHIER", isActive: true },
  { id: uuid(), name: "Capt. Rahul", pin: "2222", role: "WAITER", isActive: true },
  { id: uuid(), name: "Capt. Sneha", pin: "3333", role: "WAITER", isActive: true },
  { id: uuid(), name: "Chef Vikram", pin: "4444", role: "CHEF", isActive: true },
];

for (const user of users) {
  db.insert(schema.localUsers).values(user).onConflictDoNothing().run();
}
console.log(`✅ ${users.length} local users seeded`);

// ─── Seed Menu Categories ───
const outletId = "local-outlet";
const categories = [
  { id: "cat-1", outletId, name: "Quick Bites & Starters", sortOrder: 1, isActive: true },
  { id: "cat-2", outletId, name: "Main Course (Gravies)", sortOrder: 2, isActive: true },
  { id: "cat-3", outletId, name: "Indian Breads", sortOrder: 3, isActive: true },
  { id: "cat-4", outletId, name: "Rice & Biryani", sortOrder: 4, isActive: true },
  { id: "cat-5", outletId, name: "Beverages & Shakes", sortOrder: 5, isActive: true },
  { id: "cat-6", outletId, name: "Desserts & Ice Cream", sortOrder: 6, isActive: true },
];

for (const cat of categories) {
  db.insert(schema.menuCategories).values(cat).onConflictDoNothing().run();
}
console.log(`✅ ${categories.length} menu categories seeded`);

// ─── Seed Menu Items ───
const now = new Date().toISOString();
const items = [
  // Starters
  { id: "item-101", categoryId: "cat-1", outletId, name: "Paneer Tikka Dry", price: 260, gstRate: "5", isVeg: true, isAvailable: true, sortOrder: 1, createdAt: now, updatedAt: now },
  { id: "item-102", categoryId: "cat-1", outletId, name: "Crispy Corn Kernels", price: 210, gstRate: "5", isVeg: true, isAvailable: true, sortOrder: 2, createdAt: now, updatedAt: now },
  { id: "item-103", categoryId: "cat-1", outletId, name: "Pav Bhaji Butter", price: 180, gstRate: "5", isVeg: true, isAvailable: true, sortOrder: 3, createdAt: now, updatedAt: now },
  { id: "item-104", categoryId: "cat-1", outletId, name: "Chicken 65", price: 320, gstRate: "5", isVeg: false, isAvailable: true, sortOrder: 4, createdAt: now, updatedAt: now },
  { id: "item-105", categoryId: "cat-1", outletId, name: "Tandoori Chicken (Half)", price: 380, gstRate: "5", isVeg: false, isAvailable: true, sortOrder: 5, createdAt: now, updatedAt: now },

  // Main Course
  { id: "item-201", categoryId: "cat-2", outletId, name: "Paneer Butter Masala", price: 320, gstRate: "5", isVeg: true, isAvailable: true, sortOrder: 1, createdAt: now, updatedAt: now },
  { id: "item-202", categoryId: "cat-2", outletId, name: "Dal Makhani (Special)", price: 280, gstRate: "5", isVeg: true, isAvailable: true, sortOrder: 2, createdAt: now, updatedAt: now },
  { id: "item-203", categoryId: "cat-2", outletId, name: "Kadhai Paneer", price: 310, gstRate: "5", isVeg: true, isAvailable: true, sortOrder: 3, createdAt: now, updatedAt: now },
  { id: "item-204", categoryId: "cat-2", outletId, name: "Butter Chicken (Boneless)", price: 420, gstRate: "5", isVeg: false, isAvailable: true, sortOrder: 4, createdAt: now, updatedAt: now },
  { id: "item-205", categoryId: "cat-2", outletId, name: "Mutton Rogan Josh", price: 540, gstRate: "5", isVeg: false, isAvailable: true, sortOrder: 5, createdAt: now, updatedAt: now },

  // Breads
  { id: "item-301", categoryId: "cat-3", outletId, name: "Tandoori Roti (Plain)", price: 35, gstRate: "5", isVeg: true, isAvailable: true, sortOrder: 1, createdAt: now, updatedAt: now },
  { id: "item-302", categoryId: "cat-3", outletId, name: "Butter Roti", price: 45, gstRate: "5", isVeg: true, isAvailable: true, sortOrder: 2, createdAt: now, updatedAt: now },
  { id: "item-303", categoryId: "cat-3", outletId, name: "Butter Naan", price: 65, gstRate: "5", isVeg: true, isAvailable: true, sortOrder: 3, createdAt: now, updatedAt: now },
  { id: "item-304", categoryId: "cat-3", outletId, name: "Garlic Naan", price: 85, gstRate: "5", isVeg: true, isAvailable: true, sortOrder: 4, createdAt: now, updatedAt: now },
  { id: "item-305", categoryId: "cat-3", outletId, name: "Stuffed Kulcha (Paneer/Potato)", price: 110, gstRate: "5", isVeg: true, isAvailable: true, sortOrder: 5, createdAt: now, updatedAt: now },

  // Rice & Biryani
  { id: "item-401", categoryId: "cat-4", outletId, name: "Steamed Basmati Rice", price: 160, gstRate: "5", isVeg: true, isAvailable: true, sortOrder: 1, createdAt: now, updatedAt: now },
  { id: "item-402", categoryId: "cat-4", outletId, name: "Jeera Fried Rice", price: 190, gstRate: "5", isVeg: true, isAvailable: true, sortOrder: 2, createdAt: now, updatedAt: now },
  { id: "item-403", categoryId: "cat-4", outletId, name: "Vegetable Dum Biryani", price: 320, gstRate: "5", isVeg: true, isAvailable: true, sortOrder: 3, createdAt: now, updatedAt: now },
  { id: "item-404", categoryId: "cat-4", outletId, name: "Chicken Dum Biryani", price: 390, gstRate: "5", isVeg: false, isAvailable: true, sortOrder: 4, createdAt: now, updatedAt: now },
  { id: "item-405", categoryId: "cat-4", outletId, name: "Mutton Hyderabadi Biryani", price: 490, gstRate: "5", isVeg: false, isAvailable: true, sortOrder: 5, createdAt: now, updatedAt: now },

  // Beverages
  { id: "item-501", categoryId: "cat-5", outletId, name: "Fresh Lime Soda (Sweet/Salted)", price: 90, gstRate: "5", isVeg: true, isAvailable: true, sortOrder: 1, createdAt: now, updatedAt: now },
  { id: "item-502", categoryId: "cat-5", outletId, name: "Masala Chaas (Buttermilk)", price: 70, gstRate: "5", isVeg: true, isAvailable: true, sortOrder: 2, createdAt: now, updatedAt: now },
  { id: "item-503", categoryId: "cat-5", outletId, name: "Special Sweet Lassi", price: 120, gstRate: "5", isVeg: true, isAvailable: true, sortOrder: 3, createdAt: now, updatedAt: now },
  { id: "item-504", categoryId: "cat-5", outletId, name: "Cold Coffee with Ice Cream", price: 180, gstRate: "5", isVeg: true, isAvailable: true, sortOrder: 4, createdAt: now, updatedAt: now },

  // Desserts
  { id: "item-601", categoryId: "cat-6", outletId, name: "Gulab Jamun (2 Pcs Warm)", price: 110, gstRate: "5", isVeg: true, isAvailable: true, sortOrder: 1, createdAt: now, updatedAt: now },
  { id: "item-602", categoryId: "cat-6", outletId, name: "Moong Dal Halwa (Desi Ghee)", price: 160, gstRate: "5", isVeg: true, isAvailable: true, sortOrder: 2, createdAt: now, updatedAt: now },
  { id: "item-603", categoryId: "cat-6", outletId, name: "Rasmalai (2 Pcs Chilled)", price: 150, gstRate: "5", isVeg: true, isAvailable: true, sortOrder: 3, createdAt: now, updatedAt: now },
];

for (const item of items) {
  db.insert(schema.menuItems).values(item).onConflictDoNothing().run();
}
console.log(`✅ ${items.length} menu items seeded`);

// ─── Seed Dining Tables ───
const tables = [
  // AC Section (10 tables)
  { id: "table-ac-1", outletId, name: "T-01 (AC)", capacity: 2, status: "AVAILABLE", section: "AC Dining Hall", sortOrder: 1 },
  { id: "table-ac-2", outletId, name: "T-02 (AC)", capacity: 2, status: "AVAILABLE", section: "AC Dining Hall", sortOrder: 2 },
  { id: "table-ac-3", outletId, name: "T-03 (AC)", capacity: 4, status: "AVAILABLE", section: "AC Dining Hall", sortOrder: 3 },
  { id: "table-ac-4", outletId, name: "T-04 (AC)", capacity: 4, status: "AVAILABLE", section: "AC Dining Hall", sortOrder: 4 },
  { id: "table-ac-5", outletId, name: "T-05 (AC)", capacity: 4, status: "AVAILABLE", section: "AC Dining Hall", sortOrder: 5 },
  { id: "table-ac-6", outletId, name: "T-06 (AC)", capacity: 6, status: "AVAILABLE", section: "AC Dining Hall", sortOrder: 6 },
  { id: "table-ac-7", outletId, name: "T-07 (AC)", capacity: 6, status: "AVAILABLE", section: "AC Dining Hall", sortOrder: 7 },
  { id: "table-ac-8", outletId, name: "T-08 (AC)", capacity: 8, status: "AVAILABLE", section: "AC Dining Hall", sortOrder: 8 },
  { id: "table-ac-9", outletId, name: "T-09 (AC)", capacity: 8, status: "AVAILABLE", section: "AC Dining Hall", sortOrder: 9 },
  { id: "table-ac-10", outletId, name: "T-10 (AC)", capacity: 12, status: "AVAILABLE", section: "AC Dining Hall", sortOrder: 10 },

  // Garden Section (6 tables)
  { id: "table-gd-1", outletId, name: "G-01 (Garden)", capacity: 4, status: "AVAILABLE", section: "Open Garden Area", sortOrder: 11 },
  { id: "table-gd-2", outletId, name: "G-02 (Garden)", capacity: 4, status: "AVAILABLE", section: "Open Garden Area", sortOrder: 12 },
  { id: "table-gd-3", outletId, name: "G-03 (Garden)", capacity: 6, status: "AVAILABLE", section: "Open Garden Area", sortOrder: 13 },
  { id: "table-gd-4", outletId, name: "G-04 (Garden)", capacity: 6, status: "AVAILABLE", section: "Open Garden Area", sortOrder: 14 },
  { id: "table-gd-5", outletId, name: "G-05 (Garden)", capacity: 8, status: "AVAILABLE", section: "Open Garden Area", sortOrder: 15 },
  { id: "table-gd-6", outletId, name: "G-06 (Garden)", capacity: 10, status: "AVAILABLE", section: "Open Garden Area", sortOrder: 16 },

  // Bar & Lounge (4 tables)
  { id: "table-br-1", outletId, name: "B-01 (Bar)", capacity: 2, status: "AVAILABLE", section: "Bar & Lounge", sortOrder: 17 },
  { id: "table-br-2", outletId, name: "B-02 (Bar)", capacity: 4, status: "AVAILABLE", section: "Bar & Lounge", sortOrder: 18 },
  { id: "table-br-3", outletId, name: "B-03 (Bar)", capacity: 4, status: "AVAILABLE", section: "Bar & Lounge", sortOrder: 19 },
  { id: "table-br-4", outletId, name: "B-04 (Bar)", capacity: 6, status: "AVAILABLE", section: "Bar & Lounge", sortOrder: 20 },
];

for (const table of tables) {
  db.insert(schema.diningTables).values(table).onConflictDoNothing().run();
}
console.log(`✅ ${tables.length} dining tables seeded`);

console.log("\n🎉 Local database seeded successfully!\n");
console.log("Users:");
for (const user of users) {
  console.log(`  • ${user.name} — PIN: ${user.pin} (${user.role})`);
}
console.log("");

// Close database
sqlite.close();
process.exit(0);
