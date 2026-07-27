/**
 * Gusto Cloud Database Schema — PostgreSQL (Drizzle ORM)
 *
 * Multi-tenant schema with Row-Level Security (RLS) on organization_id.
 * Hierarchy: Organization → Franchise → Outlet → (Orders, Employees, Tables, etc.)
 */

import {
  pgTable,
  uuid,
  varchar,
  text,
  boolean,
  integer,
  decimal,
  timestamp,
  pgEnum,
  index,
} from "drizzle-orm/pg-core";
import { relations } from "drizzle-orm";

// ─── Enums ───

export const userRoleEnum = pgEnum("user_role", [
  "SUPER_ADMIN",
  "OWNER",
  "MANAGER",
  "CASHIER",
  "WAITER",
  "CHEF",
]);

export const orderStatusEnum = pgEnum("order_status", [
  "DRAFT",
  "PLACED",
  "IN_PROGRESS",
  "READY",
  "SERVED",
  "COMPLETED",
  "CANCELLED",
]);

export const paymentModeEnum = pgEnum("payment_mode", [
  "CASH",
  "CARD",
  "UPI",
  "ONLINE",
  "SPLIT",
]);

export const tableStatusEnum = pgEnum("table_status", [
  "AVAILABLE",
  "OCCUPIED",
  "RESERVED",
  "CLEANING",
]);

export const kotStatusEnum = pgEnum("kot_status", [
  "PENDING",
  "IN_PROGRESS",
  "READY",
  "SERVED",
]);

export const gstRateEnum = pgEnum("gst_rate", ["0", "5", "12", "18", "28"]);

// ─── Tenant Hierarchy ───

export const organizations = pgTable("organizations", {
  id: uuid("id").primaryKey().defaultRandom(),
  name: varchar("name", { length: 255 }).notNull(),
  slug: varchar("slug", { length: 100 }).notNull().unique(),
  gstNumber: varchar("gst_number", { length: 20 }),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

export const franchises = pgTable(
  "franchises",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    name: varchar("name", { length: 255 }).notNull(),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at").defaultNow().notNull(),
  },
  (table) => [index("franchises_org_idx").on(table.organizationId)]
);

export const outlets = pgTable(
  "outlets",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    franchiseId: uuid("franchise_id")
      .notNull()
      .references(() => franchises.id, { onDelete: "cascade" }),
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    name: varchar("name", { length: 255 }).notNull(),
    address: text("address"),
    phone: varchar("phone", { length: 20 }),
    gstNumber: varchar("gst_number", { length: 20 }),
    isActive: boolean("is_active").default(true).notNull(),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at").defaultNow().notNull(),
  },
  (table) => [
    index("outlets_franchise_idx").on(table.franchiseId),
    index("outlets_org_idx").on(table.organizationId),
  ]
);

// ─── Users / Employees ───

export const users = pgTable(
  "users",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    outletId: uuid("outlet_id").references(() => outlets.id, {
      onDelete: "set null",
    }),
    name: varchar("name", { length: 255 }).notNull(),
    email: varchar("email", { length: 255 }).unique(),
    phone: varchar("phone", { length: 20 }),
    passwordHash: text("password_hash"),
    pin: varchar("pin", { length: 4 }),
    role: userRoleEnum("role").notNull(),
    isActive: boolean("is_active").default(true).notNull(),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at").defaultNow().notNull(),
  },
  (table) => [
    index("users_org_idx").on(table.organizationId),
    index("users_outlet_idx").on(table.outletId),
  ]
);

// ─── Menu ───

export const menuCategories = pgTable(
  "menu_categories",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    outletId: uuid("outlet_id")
      .notNull()
      .references(() => outlets.id, { onDelete: "cascade" }),
    name: varchar("name", { length: 255 }).notNull(),
    sortOrder: integer("sort_order").default(0).notNull(),
    isActive: boolean("is_active").default(true).notNull(),
  },
  (table) => [index("menu_categories_outlet_idx").on(table.outletId)]
);

export const menuItems = pgTable(
  "menu_items",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    categoryId: uuid("category_id")
      .notNull()
      .references(() => menuCategories.id, { onDelete: "cascade" }),
    outletId: uuid("outlet_id")
      .notNull()
      .references(() => outlets.id, { onDelete: "cascade" }),
    name: varchar("name", { length: 255 }).notNull(),
    description: text("description"),
    price: decimal("price", { precision: 10, scale: 2 }).notNull(),
    gstRate: gstRateEnum("gst_rate").notNull().default("5"),
    isVeg: boolean("is_veg").default(true).notNull(),
    isAvailable: boolean("is_available").default(true).notNull(),
    sortOrder: integer("sort_order").default(0).notNull(),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at").defaultNow().notNull(),
  },
  (table) => [
    index("menu_items_category_idx").on(table.categoryId),
    index("menu_items_outlet_idx").on(table.outletId),
  ]
);

// ─── Dining Tables ───

export const diningTables = pgTable(
  "dining_tables",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    outletId: uuid("outlet_id")
      .notNull()
      .references(() => outlets.id, { onDelete: "cascade" }),
    name: varchar("name", { length: 50 }).notNull(),
    capacity: integer("capacity").notNull(),
    status: tableStatusEnum("status").default("AVAILABLE").notNull(),
    section: varchar("section", { length: 100 }),
    sortOrder: integer("sort_order").default(0).notNull(),
  },
  (table) => [index("dining_tables_outlet_idx").on(table.outletId)]
);

// ─── Orders ───

export const orderModeEnum = pgEnum("order_mode", [
  "DINE_IN",
  "TAKEAWAY",
  "DELIVERY",
  "QUICK_BILL",
]);

export const orders = pgTable(
  "orders",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    outletId: uuid("outlet_id")
      .notNull()
      .references(() => outlets.id, { onDelete: "cascade" }),
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    tableId: uuid("table_id").references(() => diningTables.id, {
      onDelete: "set null",
    }),
    orderNumber: varchar("order_number", { length: 30 }).notNull(),
    orderMode: orderModeEnum("order_mode").default("DINE_IN").notNull(),
    status: orderStatusEnum("status").default("DRAFT").notNull(),
    subtotal: decimal("subtotal", { precision: 10, scale: 2 })
      .default("0")
      .notNull(),
    discountAmount: decimal("discount_amount", { precision: 10, scale: 2 })
      .default("0")
      .notNull(),
    discountType: varchar("discount_type", { length: 20 }),
    discountValue: decimal("discount_value", { precision: 10, scale: 2 }),
    taxAmount: decimal("tax_amount", { precision: 10, scale: 2 })
      .default("0")
      .notNull(),
    totalAmount: decimal("total_amount", { precision: 10, scale: 2 })
      .default("0")
      .notNull(),
    paymentMode: paymentModeEnum("payment_mode"),
    customerId: uuid("customer_id"),
    customerName: varchar("customer_name", { length: 255 }),
    customerPhone: varchar("customer_phone", { length: 20 }),
    waiterId: uuid("waiter_id").references(() => users.id, {
      onDelete: "set null",
    }),
    waiterName: varchar("waiter_name", { length: 255 }),
    paxCount: integer("pax_count").default(1).notNull(),
    notes: text("notes"),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at").defaultNow().notNull(),
  },
  (table) => [
    index("orders_outlet_idx").on(table.outletId),
    index("orders_org_idx").on(table.organizationId),
    index("orders_created_idx").on(table.createdAt),
  ]
);

export const orderItems = pgTable(
  "order_items",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    orderId: uuid("order_id")
      .notNull()
      .references(() => orders.id, { onDelete: "cascade" }),
    menuItemId: uuid("menu_item_id")
      .notNull()
      .references(() => menuItems.id),
    menuItemName: varchar("menu_item_name", { length: 255 }).notNull(),
    quantity: integer("quantity").notNull(),
    unitPrice: decimal("unit_price", { precision: 10, scale: 2 }).notNull(),
    gstRate: gstRateEnum("gst_rate").notNull(),
    modifiers: text("modifiers"), // JSON array stored as text
    notes: text("notes"),
    status: orderStatusEnum("status").default("PLACED").notNull(),
    kotId: uuid("kot_id"),
  },
  (table) => [index("order_items_order_idx").on(table.orderId)]
);

// ─── KOTs ───

export const kitchenOrderTickets = pgTable(
  "kitchen_order_tickets",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    orderId: uuid("order_id")
      .notNull()
      .references(() => orders.id, { onDelete: "cascade" }),
    kotNumber: varchar("kot_number", { length: 20 }).notNull(),
    station: varchar("station", { length: 100 }),
    status: kotStatusEnum("status").default("PENDING").notNull(),
    createdAt: timestamp("created_at").defaultNow().notNull(),
  },
  (table) => [index("kots_order_idx").on(table.orderId)]
);

export const kotItems = pgTable(
  "kot_items",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    kotId: uuid("kot_id")
      .notNull()
      .references(() => kitchenOrderTickets.id, { onDelete: "cascade" }),
    orderItemId: uuid("order_item_id")
      .notNull()
      .references(() => orderItems.id, { onDelete: "cascade" }),
    menuItemName: varchar("menu_item_name", { length: 255 }).notNull(),
    quantity: integer("quantity").notNull(),
    modifiers: text("modifiers"),
    notes: text("notes"),
  },
  (table) => [index("kot_items_kot_idx").on(table.kotId)]
);

// ─── Sequences (daily order/KOT/invoice number tracking) ───

export const sequences = pgTable("sequences", {
  id: varchar("id", { length: 50 }).primaryKey(), // e.g. "order-20260715-outletId"
  currentValue: integer("current_value").default(0).notNull(),
  dateKey: varchar("date_key", { length: 8 }).notNull(), // YYYYMMDD
});

// ─── Invoices & Payments ───

export const invoices = pgTable(
  "invoices",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    orderId: uuid("order_id")
      .notNull()
      .references(() => orders.id, { onDelete: "cascade" }),
    outletId: uuid("outlet_id")
      .notNull()
      .references(() => outlets.id, { onDelete: "cascade" }),
    invoiceNumber: varchar("invoice_number", { length: 30 }).notNull(),
    subtotal: decimal("subtotal", { precision: 10, scale: 2 }).notNull(),
    discountAmount: decimal("discount_amount", { precision: 10, scale: 2 })
      .default("0")
      .notNull(),
    cgstAmount: decimal("cgst_amount", { precision: 10, scale: 2 })
      .default("0")
      .notNull(),
    sgstAmount: decimal("sgst_amount", { precision: 10, scale: 2 })
      .default("0")
      .notNull(),
    totalAmount: decimal("total_amount", { precision: 10, scale: 2 }).notNull(),
    paymentMode: paymentModeEnum("payment_mode").notNull(),
    isPaid: boolean("is_paid").default(false).notNull(),
    createdAt: timestamp("created_at").defaultNow().notNull(),
  },
  (table) => [
    index("invoices_order_idx").on(table.orderId),
    index("invoices_outlet_idx").on(table.outletId),
  ]
);

// ─── Customers ───

export const customers = pgTable(
  "customers",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    name: varchar("name", { length: 255 }).notNull(),
    phone: varchar("phone", { length: 20 }).notNull(),
    email: varchar("email", { length: 255 }),
    notes: text("notes"),
    loyaltyPoints: integer("loyalty_points").default(0).notNull(),
    totalVisits: integer("total_visits").default(0).notNull(),
    totalSpend: decimal("total_spend", { precision: 12, scale: 2 })
      .default("0")
      .notNull(),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at").defaultNow().notNull(),
  },
  (table) => [
    index("customers_org_idx").on(table.organizationId),
    index("customers_phone_idx").on(table.phone),
  ]
);

// ─── Inventory ───

export const inventoryItems = pgTable(
  "inventory_items",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    name: varchar("name", { length: 255 }).notNull(),
    unit: varchar("unit", { length: 50 }).notNull(), // kg, g, L, ml, pcs
    currentStock: decimal("current_stock", { precision: 10, scale: 3 })
      .default("0")
      .notNull(),
    minimumStock: decimal("minimum_stock", { precision: 10, scale: 3 })
      .default("0")
      .notNull(),
    costPerUnit: decimal("cost_per_unit", { precision: 10, scale: 2 })
      .default("0")
      .notNull(),
    expiryDate: timestamp("expiry_date"),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at").defaultNow().notNull(),
  },
  (table) => [index("inventory_org_idx").on(table.organizationId)]
);

export const recipes = pgTable("recipes", {
  id: uuid("id").primaryKey().defaultRandom(),
  menuItemId: uuid("menu_item_id")
    .notNull()
    .references(() => menuItems.id, { onDelete: "cascade" }),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

export const recipeIngredients = pgTable(
  "recipe_ingredients",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    recipeId: uuid("recipe_id")
      .notNull()
      .references(() => recipes.id, { onDelete: "cascade" }),
    inventoryItemId: uuid("inventory_item_id")
      .notNull()
      .references(() => inventoryItems.id, { onDelete: "cascade" }),
    quantity: decimal("quantity", { precision: 10, scale: 3 }).notNull(),
    unit: varchar("unit", { length: 50 }).notNull(),
  },
  (table) => [index("recipe_ingredients_recipe_idx").on(table.recipeId)]
);

// ─── Sync Queue ───

export const syncQueue = pgTable(
  "sync_queue",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    outletId: uuid("outlet_id")
      .notNull()
      .references(() => outlets.id, { onDelete: "cascade" }),
    eventType: varchar("event_type", { length: 100 }).notNull(),
    payload: text("payload").notNull(), // JSON
    localTimestamp: timestamp("local_timestamp").notNull(),
    syncedAt: timestamp("synced_at"),
    status: varchar("status", { length: 20 }).default("PENDING").notNull(),
    retryCount: integer("retry_count").default(0).notNull(),
    createdAt: timestamp("created_at").defaultNow().notNull(),
  },
  (table) => [
    index("sync_queue_outlet_idx").on(table.outletId),
    index("sync_queue_status_idx").on(table.status),
  ]
);

// ─── Audit Log ───

export const auditLogs = pgTable(
  "audit_logs",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    userId: uuid("user_id"),
    action: varchar("action", { length: 100 }).notNull(),
    entityType: varchar("entity_type", { length: 100 }).notNull(),
    entityId: uuid("entity_id"),
    oldValue: text("old_value"), // JSON
    newValue: text("new_value"), // JSON
    createdAt: timestamp("created_at").defaultNow().notNull(),
  },
  (table) => [
    index("audit_org_idx").on(table.organizationId),
    index("audit_created_idx").on(table.createdAt),
  ]
);

// ─── Relations ───

export const organizationsRelations = relations(organizations, ({ many }) => ({
  franchises: many(franchises),
  outlets: many(outlets),
  users: many(users),
  customers: many(customers),
}));

export const franchisesRelations = relations(franchises, ({ one, many }) => ({
  organization: one(organizations, {
    fields: [franchises.organizationId],
    references: [organizations.id],
  }),
  outlets: many(outlets),
}));

export const outletsRelations = relations(outlets, ({ one, many }) => ({
  franchise: one(franchises, {
    fields: [outlets.franchiseId],
    references: [franchises.id],
  }),
  organization: one(organizations, {
    fields: [outlets.organizationId],
    references: [organizations.id],
  }),
  orders: many(orders),
  diningTables: many(diningTables),
  menuCategories: many(menuCategories),
  users: many(users),
}));

export const ordersRelations = relations(orders, ({ one, many }) => ({
  outlet: one(outlets, {
    fields: [orders.outletId],
    references: [outlets.id],
  }),
  table: one(diningTables, {
    fields: [orders.tableId],
    references: [diningTables.id],
  }),
  waiter: one(users, {
    fields: [orders.waiterId],
    references: [users.id],
  }),
  items: many(orderItems),
  kots: many(kitchenOrderTickets),
  invoice: one(invoices, {
    fields: [orders.id],
    references: [invoices.orderId],
  }),
}));

export const orderItemsRelations = relations(orderItems, ({ one }) => ({
  order: one(orders, {
    fields: [orderItems.orderId],
    references: [orders.id],
  }),
}));

export const kitchenOrderTicketsRelations = relations(
  kitchenOrderTickets,
  ({ one, many }) => ({
    order: one(orders, {
      fields: [kitchenOrderTickets.orderId],
      references: [orders.id],
    }),
    items: many(kotItems),
  })
);

export const kotItemsRelations = relations(kotItems, ({ one }) => ({
  kot: one(kitchenOrderTickets, {
    fields: [kotItems.kotId],
    references: [kitchenOrderTickets.id],
  }),
  orderItem: one(orderItems, {
    fields: [kotItems.orderItemId],
    references: [orderItems.id],
  }),
}));

export const invoicesRelations = relations(invoices, ({ one }) => ({
  order: one(orders, {
    fields: [invoices.orderId],
    references: [orders.id],
  }),
}));
