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

export const orderModeEnum = pgEnum("order_mode", [
  "DINE_IN",
  "TAKEAWAY",
  "DELIVERY",
  "ONLINE",
]);

export const paymentModeEnum = pgEnum("payment_mode", [
  "CASH",
  "CARD",
  "UPI",
  "ONLINE",
  "SPLIT",
  "OTHER",
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
  timezone: varchar("timezone", { length: 100 }).default("Asia/Kolkata"),
  currency: varchar("currency", { length: 10 }).default("INR"),
  notificationSettings: text("notification_settings"),
  billingSettings: text("billing_settings"),
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
    variants: text("variants"), // JSON: [{ name: string, price: number }]
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

export const tableReservations = pgTable(
  "table_reservations",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    outletId: uuid("outlet_id")
      .notNull()
      .references(() => outlets.id, { onDelete: "cascade" }),
    tableId: uuid("table_id")
      .notNull()
      .references(() => diningTables.id, { onDelete: "cascade" }),
    customerName: varchar("customer_name", { length: 255 }),
    reservationTime: timestamp("reservation_time").notNull(),
    durationMins: integer("duration_mins").default(60).notNull(),
    status: varchar("status", { length: 50 }).default("ACTIVE").notNull(),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at").defaultNow().notNull(),
  },
  (table) => [
    index("table_reservations_outlet_idx").on(table.outletId),
    index("table_reservations_table_idx").on(table.tableId),
  ]
);
// ─── Orders ───

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
    discountType: varchar("discount_type", { length: 20 }), // PERCENTAGE or FLAT
    discountValue: decimal("discount_value", { precision: 10, scale: 2 }),
    discountLabel: varchar("discount_label", { length: 100 }),
    taxAmount: decimal("tax_amount", { precision: 10, scale: 2 })
      .default("0")
      .notNull(),
    totalAmount: decimal("total_amount", { precision: 10, scale: 2 })
      .default("0")
      .notNull(),
    paymentMode: paymentModeEnum("payment_mode"),
    paymentSubMethod: varchar("payment_sub_method", { length: 50 }),
    paymentSplits: text("payment_splits"), // JSON array
    customerId: uuid("customer_id"),
    customerName: varchar("customer_name", { length: 255 }),
    customerPhone: varchar("customer_phone", { length: 20 }),
    waiterId: uuid("waiter_id").references(() => users.id, {
      onDelete: "set null",
    }),
    waiterName: varchar("waiter_name", { length: 255 }),
    cashierId: uuid("cashier_id").references(() => users.id, {
      onDelete: "set null",
    }),
    cashierName: varchar("cashier_name", { length: 255 }),
    tokenNumbers: text("token_numbers"), // JSON array of ints
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
    variantName: varchar("variant_name", { length: 255 }),
    quantity: integer("quantity").notNull(),
    unitPrice: decimal("unit_price", { precision: 10, scale: 2 }).notNull(),
    gstRate: gstRateEnum("gst_rate").notNull(),
    modifiers: text("modifiers"), // JSON array stored as text
    addOns: text("add_ons"), // JSON array
    notes: text("notes"),
    status: orderStatusEnum("status").default("PLACED").notNull(),
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
    receiptStatus: varchar("receipt_status", { length: 50 }).default("ORIGINAL").notNull(),
    subtotal: decimal("subtotal", { precision: 10, scale: 2 }).notNull(),
    discountAmount: decimal("discount_amount", { precision: 10, scale: 2 })
      .default("0")
      .notNull(),
    cgstRate: decimal("cgst_rate", { precision: 5, scale: 2 }).default("2.5").notNull(),
    cgstAmount: decimal("cgst_amount", { precision: 10, scale: 2 })
      .default("0")
      .notNull(),
    sgstRate: decimal("sgst_rate", { precision: 5, scale: 2 }).default("2.5").notNull(),
    sgstAmount: decimal("sgst_amount", { precision: 10, scale: 2 })
      .default("0")
      .notNull(),
    totalQuantity: integer("total_quantity").default(0).notNull(),
    totalAmount: decimal("total_amount", { precision: 10, scale: 2 }).notNull(),
    paymentMode: paymentModeEnum("payment_mode").notNull(),
    paymentSubMethod: varchar("payment_sub_method", { length: 50 }),
    paymentSplits: text("payment_splits"), // JSON array
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

// ─── Integration Configs ───

export const integrationProviderEnum = pgEnum("integration_provider", [
  "ZOMATO",
  "SWIGGY",
  "RAZORPAY",
]);

export const integrationConfigs = pgTable(
  "integration_configs",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    outletId: uuid("outlet_id")
      .notNull()
      .references(() => outlets.id, { onDelete: "cascade" }),
    provider: integrationProviderEnum("provider").notNull(),
    apiKey: text("api_key"),
    apiSecret: text("api_secret"),
    webhookSecret: text("webhook_secret"),
    restaurantId: varchar("restaurant_id", { length: 100 }),
    isActive: boolean("is_active").default(false).notNull(),
    config: text("config"), // JSON for provider-specific settings
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at").defaultNow().notNull(),
  },
  (table) => [
    index("integration_configs_org_idx").on(table.organizationId),
    index("integration_configs_outlet_idx").on(table.outletId),
  ]
);

// ─── Online Orders (Zomato / Aggregator) ───

export const onlineOrderStatusEnum = pgEnum("online_order_status", [
  "RECEIVED",
  "ACCEPTED",
  "PREPARING",
  "READY_FOR_PICKUP",
  "PICKED_UP",
  "DELIVERED",
  "CANCELLED",
  "REJECTED",
]);

export const aggregatorMenuMappings = pgTable(
  "aggregator_menu_mappings",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    outletId: uuid("outlet_id")
      .notNull()
      .references(() => outlets.id, { onDelete: "cascade" }),
    provider: integrationProviderEnum("provider").notNull(),
    aggregatorItemId: varchar("aggregator_item_id", { length: 255 }).notNull(),
    posMenuItemId: uuid("pos_menu_item_id").references(() => menuItems.id, {
      onDelete: "set null",
    }),
    mappedAt: timestamp("mapped_at"),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at").defaultNow().notNull(),
  },
  (table) => [
    index("agg_mapping_org_idx").on(table.organizationId),
    index("agg_mapping_outlet_idx").on(table.outletId),
    index("agg_mapping_provider_item_idx").on(table.provider, table.aggregatorItemId),
  ]
);

export const onlineOrders = pgTable(
  "online_orders",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    outletId: uuid("outlet_id")
      .notNull()
      .references(() => outlets.id, { onDelete: "cascade" }),
    orderId: uuid("order_id").references(() => orders.id, {
      onDelete: "set null",
    }),
    provider: integrationProviderEnum("provider").notNull(),
    externalOrderId: varchar("external_order_id", { length: 100 }).notNull(),
    status: onlineOrderStatusEnum("status").default("RECEIVED").notNull(),
    customerName: varchar("customer_name", { length: 255 }),
    customerPhone: varchar("customer_phone", { length: 20 }),
    deliveryAddress: text("delivery_address"),
    itemsPayload: text("items_payload").notNull(), // JSON from aggregator
    subtotal: decimal("subtotal", { precision: 10, scale: 2 })
      .default("0")
      .notNull(),
    totalAmount: decimal("total_amount", { precision: 10, scale: 2 })
      .default("0")
      .notNull(),
    commissionAmount: decimal("commission_amount", { precision: 10, scale: 2 })
      .default("0")
      .notNull(),
    rawWebhookPayload: text("raw_webhook_payload"), // Full raw JSON for debugging
    receivedAt: timestamp("received_at").defaultNow().notNull(),
    acceptedAt: timestamp("accepted_at"),
    deliveredAt: timestamp("delivered_at"),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at").defaultNow().notNull(),
  },
  (table) => [
    index("online_orders_org_idx").on(table.organizationId),
    index("online_orders_outlet_idx").on(table.outletId),
    index("online_orders_external_idx").on(table.externalOrderId),
  ]
);

// ─── CRM: Feedbacks ───

export const feedbacks = pgTable(
  "feedbacks",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    customerId: uuid("customer_id").references(() => customers.id, {
      onDelete: "set null",
    }),
    orderId: uuid("order_id").references(() => orders.id, {
      onDelete: "set null",
    }),
    outletId: uuid("outlet_id").references(() => outlets.id, {
      onDelete: "set null",
    }),
    rating: integer("rating").notNull(), // 1-5
    comment: text("comment"),
    source: varchar("source", { length: 50 }).default("IN_APP").notNull(), // IN_APP, WHATSAPP, SMS
    createdAt: timestamp("created_at").defaultNow().notNull(),
  },
  (table) => [
    index("feedbacks_org_idx").on(table.organizationId),
    index("feedbacks_customer_idx").on(table.customerId),
  ]
);

// ─── CRM: Coupons ───

export const couponTypeEnum = pgEnum("coupon_type", [
  "PERCENTAGE",
  "FLAT",
]);

export const coupons = pgTable(
  "coupons",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    code: varchar("code", { length: 50 }).notNull(),
    description: text("description"),
    type: couponTypeEnum("type").notNull(),
    value: decimal("value", { precision: 10, scale: 2 }).notNull(),
    minOrderAmount: decimal("min_order_amount", { precision: 10, scale: 2 }),
    maxDiscountAmount: decimal("max_discount_amount", { precision: 10, scale: 2 }),
    usageLimit: integer("usage_limit"), // null = unlimited
    usedCount: integer("used_count").default(0).notNull(),
    outletIds: text("outlet_ids"), // JSON array of outlet IDs, null = all outlets
    validFrom: timestamp("valid_from").notNull(),
    validUntil: timestamp("valid_until").notNull(),
    isActive: boolean("is_active").default(true).notNull(),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at").defaultNow().notNull(),
  },
  (table) => [
    index("coupons_org_idx").on(table.organizationId),
    index("coupons_code_idx").on(table.code),
  ]
);

// ─── CRM: Loyalty Accounts ───

export const loyaltyTransactionTypeEnum = pgEnum("loyalty_transaction_type", [
  "EARN",
  "REDEEM",
  "ADJUST",
  "EXPIRE",
]);

export const loyaltyTransactions = pgTable(
  "loyalty_transactions",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    customerId: uuid("customer_id")
      .notNull()
      .references(() => customers.id, { onDelete: "cascade" }),
    orderId: uuid("order_id").references(() => orders.id, {
      onDelete: "set null",
    }),
    type: loyaltyTransactionTypeEnum("type").notNull(),
    points: integer("points").notNull(), // positive for earn, negative for redeem
    balanceAfter: integer("balance_after").notNull(),
    description: text("description"),
    createdAt: timestamp("created_at").defaultNow().notNull(),
  },
  (table) => [
    index("loyalty_tx_customer_idx").on(table.customerId),
    index("loyalty_tx_org_idx").on(table.organizationId),
  ]
);

// ─── HR: Shifts ───

export const shifts = pgTable(
  "shifts",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    outletId: uuid("outlet_id")
      .notNull()
      .references(() => outlets.id, { onDelete: "cascade" }),
    name: varchar("name", { length: 100 }).notNull(), // "Morning", "Evening", "Night"
    startTime: varchar("start_time", { length: 5 }).notNull(), // "09:00" (HH:mm)
    endTime: varchar("end_time", { length: 5 }).notNull(), // "17:00"
    isActive: boolean("is_active").default(true).notNull(),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at").defaultNow().notNull(),
  },
  (table) => [
    index("shifts_org_idx").on(table.organizationId),
    index("shifts_outlet_idx").on(table.outletId),
  ]
);

// ─── HR: Attendances ───

export const attendanceStatusEnum = pgEnum("attendance_status", [
  "PRESENT",
  "ABSENT",
  "HALF_DAY",
  "LEAVE",
]);

export const attendances = pgTable(
  "attendances",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    outletId: uuid("outlet_id")
      .notNull()
      .references(() => outlets.id, { onDelete: "cascade" }),
    shiftId: uuid("shift_id").references(() => shifts.id, {
      onDelete: "set null",
    }),
    date: varchar("date", { length: 10 }).notNull(), // YYYY-MM-DD
    status: attendanceStatusEnum("status").default("PRESENT").notNull(),
    clockIn: timestamp("clock_in"),
    clockOut: timestamp("clock_out"),
    hoursWorked: decimal("hours_worked", { precision: 5, scale: 2 }),
    overtimeHours: decimal("overtime_hours", { precision: 5, scale: 2 }).default(
      "0"
    ),
    notes: text("notes"),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at").defaultNow().notNull(),
  },
  (table) => [
    index("attendances_user_idx").on(table.userId),
    index("attendances_outlet_idx").on(table.outletId),
    index("attendances_date_idx").on(table.date),
  ]
);

// ─── HR: Payrolls ───

export const payrollStatusEnum = pgEnum("payroll_status", [
  "DRAFT",
  "CALCULATED",
  "APPROVED",
  "PAID",
]);

export const payrolls = pgTable(
  "payrolls",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    outletId: uuid("outlet_id")
      .notNull()
      .references(() => outlets.id, { onDelete: "cascade" }),
    month: varchar("month", { length: 7 }).notNull(), // "2026-07"
    baseSalary: decimal("base_salary", { precision: 10, scale: 2 }).notNull(),
    daysWorked: integer("days_worked").default(0).notNull(),
    totalDays: integer("total_days").notNull(), // working days in month
    overtimeHours: decimal("overtime_hours", { precision: 5, scale: 2 }).default(
      "0"
    ),
    overtimeRate: decimal("overtime_rate", { precision: 10, scale: 2 }).default(
      "0"
    ),
    deductions: decimal("deductions", { precision: 10, scale: 2 }).default("0"),
    bonus: decimal("bonus", { precision: 10, scale: 2 }).default("0"),
    netSalary: decimal("net_salary", { precision: 10, scale: 2 }).notNull(),
    status: payrollStatusEnum("status").default("DRAFT").notNull(),
    paidAt: timestamp("paid_at"),
    notes: text("notes"),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at").defaultNow().notNull(),
  },
  (table) => [
    index("payrolls_user_idx").on(table.userId),
    index("payrolls_org_idx").on(table.organizationId),
    index("payrolls_month_idx").on(table.month),
  ]
);

// ─── Stock Transactions (Inventory Audit Trail) ───

export const stockTransactionTypeEnum = pgEnum("stock_transaction_type", [
  "ORDER_DEDUCTION",
  "MANUAL_ADD",
  "MANUAL_REMOVE",
  "PURCHASE_ORDER",
  "ADJUSTMENT",
]);

export const stockTransactions = pgTable(
  "stock_transactions",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    inventoryItemId: uuid("inventory_item_id")
      .notNull()
      .references(() => inventoryItems.id, { onDelete: "cascade" }),
    orderId: uuid("order_id").references(() => orders.id, {
      onDelete: "set null",
    }),
    type: stockTransactionTypeEnum("type").notNull(),
    quantityChange: decimal("quantity_change", { precision: 10, scale: 3 }).notNull(), // negative for deductions
    balanceAfter: decimal("balance_after", { precision: 10, scale: 3 }).notNull(),
    notes: text("notes"),
    createdAt: timestamp("created_at").defaultNow().notNull(),
  },
  (table) => [
    index("stock_tx_org_idx").on(table.organizationId),
    index("stock_tx_item_idx").on(table.inventoryItemId),
    index("stock_tx_order_idx").on(table.orderId),
    index("stock_tx_created_idx").on(table.createdAt),
  ]
);

// ─── Relations ───

export const organizationsRelations = relations(organizations, ({ many }) => ({
  franchises: many(franchises),
  outlets: many(outlets),
  users: many(users),
  customers: many(customers),
  integrationConfigs: many(integrationConfigs),
  coupons: many(coupons),
  stockTransactions: many(stockTransactions),
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
  tableReservations: many(tableReservations),
  menuCategories: many(menuCategories),
  users: many(users),
  integrationConfigs: many(integrationConfigs),
  onlineOrders: many(onlineOrders),
  shifts: many(shifts),
  attendances: many(attendances),
}));

export const diningTablesRelations = relations(diningTables, ({ many, one }) => ({
  outlet: one(outlets, {
    fields: [diningTables.outletId],
    references: [outlets.id],
  }),
  reservations: many(tableReservations),
}));

export const tableReservationsRelations = relations(tableReservations, ({ one }) => ({
  outlet: one(outlets, {
    fields: [tableReservations.outletId],
    references: [outlets.id],
  }),
  table: one(diningTables, {
    fields: [tableReservations.tableId],
    references: [diningTables.id],
  }),
}));


export const ordersRelations = relations(orders, ({ one, many }) => ({
  outlet: one(outlets, {
    fields: [orders.outletId],
    references: [outlets.id],
  }),
  items: many(orderItems),
  kots: many(kitchenOrderTickets),
  invoice: one(invoices, {
    fields: [orders.id],
    references: [invoices.orderId],
  }),
  feedbacks: many(feedbacks),
  loyaltyTransactions: many(loyaltyTransactions),
}));

export const orderItemsRelations = relations(orderItems, ({ one }) => ({
  order: one(orders, {
    fields: [orderItems.orderId],
    references: [orders.id],
  }),
  menuItem: one(menuItems, {
    fields: [orderItems.menuItemId],
    references: [menuItems.id],
  }),
}));

export const kitchenOrderTicketsRelations = relations(kitchenOrderTickets, ({ one }) => ({
  order: one(orders, {
    fields: [kitchenOrderTickets.orderId],
    references: [orders.id],
  }),
}));

export const invoicesRelations = relations(invoices, ({ one }) => ({
  order: one(orders, {
    fields: [invoices.orderId],
    references: [orders.id],
  }),
  outlet: one(outlets, {
    fields: [invoices.outletId],
    references: [outlets.id],
  }),
}));

export const menuCategoriesRelations = relations(menuCategories, ({ one, many }) => ({
  outlet: one(outlets, {
    fields: [menuCategories.outletId],
    references: [outlets.id],
  }),
  items: many(menuItems),
}));

export const menuItemsRelations = relations(menuItems, ({ one, many }) => ({
  category: one(menuCategories, {
    fields: [menuItems.categoryId],
    references: [menuCategories.id],
  }),
  outlet: one(outlets, {
    fields: [menuItems.outletId],
    references: [outlets.id],
  }),
  orderItems: many(orderItems),
  recipes: many(recipes),
}));

export const integrationConfigsRelations = relations(
  integrationConfigs,
  ({ one }) => ({
    organization: one(organizations, {
      fields: [integrationConfigs.organizationId],
      references: [organizations.id],
    }),
    outlet: one(outlets, {
      fields: [integrationConfigs.outletId],
      references: [outlets.id],
    }),
  })
);

export const onlineOrdersRelations = relations(onlineOrders, ({ one }) => ({
  organization: one(organizations, {
    fields: [onlineOrders.organizationId],
    references: [organizations.id],
  }),
  outlet: one(outlets, {
    fields: [onlineOrders.outletId],
    references: [outlets.id],
  }),
  order: one(orders, {
    fields: [onlineOrders.orderId],
    references: [orders.id],
  }),
}));

export const feedbacksRelations = relations(feedbacks, ({ one }) => ({
  organization: one(organizations, {
    fields: [feedbacks.organizationId],
    references: [organizations.id],
  }),
  customer: one(customers, {
    fields: [feedbacks.customerId],
    references: [customers.id],
  }),
  order: one(orders, {
    fields: [feedbacks.orderId],
    references: [orders.id],
  }),
  outlet: one(outlets, {
    fields: [feedbacks.outletId],
    references: [outlets.id],
  }),
}));

export const couponsRelations = relations(coupons, ({ one }) => ({
  organization: one(organizations, {
    fields: [coupons.organizationId],
    references: [organizations.id],
  }),
}));

export const loyaltyTransactionsRelations = relations(
  loyaltyTransactions,
  ({ one }) => ({
    organization: one(organizations, {
      fields: [loyaltyTransactions.organizationId],
      references: [organizations.id],
    }),
    customer: one(customers, {
      fields: [loyaltyTransactions.customerId],
      references: [customers.id],
    }),
    order: one(orders, {
      fields: [loyaltyTransactions.orderId],
      references: [orders.id],
    }),
  })
);

export const customersRelations = relations(customers, ({ one, many }) => ({
  organization: one(organizations, {
    fields: [customers.organizationId],
    references: [organizations.id],
  }),
  feedbacks: many(feedbacks),
  loyaltyTransactions: many(loyaltyTransactions),
}));

export const shiftsRelations = relations(shifts, ({ one, many }) => ({
  organization: one(organizations, {
    fields: [shifts.organizationId],
    references: [organizations.id],
  }),
  outlet: one(outlets, {
    fields: [shifts.outletId],
    references: [outlets.id],
  }),
  attendances: many(attendances),
}));

export const attendancesRelations = relations(attendances, ({ one }) => ({
  organization: one(organizations, {
    fields: [attendances.organizationId],
    references: [organizations.id],
  }),
  user: one(users, {
    fields: [attendances.userId],
    references: [users.id],
  }),
  outlet: one(outlets, {
    fields: [attendances.outletId],
    references: [outlets.id],
  }),
  shift: one(shifts, {
    fields: [attendances.shiftId],
    references: [shifts.id],
  }),
}));

export const usersRelations = relations(users, ({ one, many }) => ({
  organization: one(organizations, {
    fields: [users.organizationId],
    references: [organizations.id],
  }),
  outlet: one(outlets, {
    fields: [users.outletId],
    references: [outlets.id],
  }),
  attendances: many(attendances),
  payrolls: many(payrolls),
}));

export const payrollsRelations = relations(payrolls, ({ one }) => ({
  organization: one(organizations, {
    fields: [payrolls.organizationId],
    references: [organizations.id],
  }),
  user: one(users, {
    fields: [payrolls.userId],
    references: [users.id],
  }),
  outlet: one(outlets, {
    fields: [payrolls.outletId],
    references: [outlets.id],
  }),
}));

export const stockTransactionsRelations = relations(stockTransactions, ({ one }) => ({
  organization: one(organizations, {
    fields: [stockTransactions.organizationId],
    references: [organizations.id],
  }),
  inventoryItem: one(inventoryItems, {
    fields: [stockTransactions.inventoryItemId],
    references: [inventoryItems.id],
  }),
  order: one(orders, {
    fields: [stockTransactions.orderId],
    references: [orders.id],
  }),
}));

export const recipesRelations = relations(recipes, ({ one, many }) => ({
  menuItem: one(menuItems, {
    fields: [recipes.menuItemId],
    references: [menuItems.id],
  }),
  ingredients: many(recipeIngredients),
}));

export const recipeIngredientsRelations = relations(recipeIngredients, ({ one }) => ({
  recipe: one(recipes, {
    fields: [recipeIngredients.recipeId],
    references: [recipes.id],
  }),
  inventoryItem: one(inventoryItems, {
    fields: [recipeIngredients.inventoryItemId],
    references: [inventoryItems.id],
  }),
}));

// ─── ERP / Accounting & Purchase Orders ───

export const vendors = pgTable(
  "vendors",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    name: varchar("name", { length: 255 }).notNull(),
    contactName: varchar("contact_name", { length: 255 }),
    phone: varchar("phone", { length: 20 }),
    email: varchar("email", { length: 255 }),
    address: text("address"),
    gstNumber: varchar("gst_number", { length: 20 }),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at").defaultNow().notNull(),
  },
  (table) => [index("vendors_org_idx").on(table.organizationId)]
);

export const purchaseOrderStatusEnum = pgEnum("purchase_order_status", [
  "DRAFT",
  "SENT",
  "PARTIAL",
  "FULFILLED",
  "CANCELLED",
]);

export const purchaseOrders = pgTable(
  "purchase_orders",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    outletId: uuid("outlet_id")
      .notNull()
      .references(() => outlets.id, { onDelete: "cascade" }),
    vendorId: uuid("vendor_id")
      .notNull()
      .references(() => vendors.id, { onDelete: "restrict" }),
    poNumber: varchar("po_number", { length: 50 }).notNull(),
    status: purchaseOrderStatusEnum("status").default("DRAFT").notNull(),
    totalAmount: decimal("total_amount", { precision: 10, scale: 2 }).default("0").notNull(),
    expectedDeliveryDate: timestamp("expected_delivery_date"),
    notes: text("notes"),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at").defaultNow().notNull(),
  },
  (table) => [
    index("po_org_idx").on(table.organizationId),
    index("po_outlet_idx").on(table.outletId),
    index("po_vendor_idx").on(table.vendorId),
  ]
);

export const purchaseOrderItems = pgTable(
  "purchase_order_items",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    purchaseOrderId: uuid("purchase_order_id")
      .notNull()
      .references(() => purchaseOrders.id, { onDelete: "cascade" }),
    inventoryItemId: uuid("inventory_item_id")
      .notNull()
      .references(() => inventoryItems.id, { onDelete: "restrict" }),
    quantity: decimal("quantity", { precision: 10, scale: 3 }).notNull(),
    unitPrice: decimal("unit_price", { precision: 10, scale: 2 }).notNull(),
    totalPrice: decimal("total_price", { precision: 10, scale: 2 }).notNull(),
  },
  (table) => [index("po_items_po_idx").on(table.purchaseOrderId)]
);

export const goodsReceivedNotes = pgTable(
  "goods_received_notes",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    outletId: uuid("outlet_id")
      .notNull()
      .references(() => outlets.id, { onDelete: "cascade" }),
    purchaseOrderId: uuid("purchase_order_id")
      .references(() => purchaseOrders.id, { onDelete: "set null" }),
    grnNumber: varchar("grn_number", { length: 50 }).notNull(),
    receivedDate: timestamp("received_date").defaultNow().notNull(),
    notes: text("notes"),
    createdAt: timestamp("created_at").defaultNow().notNull(),
  },
  (table) => [
    index("grn_org_idx").on(table.organizationId),
    index("grn_outlet_idx").on(table.outletId),
  ]
);

export const grnItems = pgTable(
  "grn_items",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    grnId: uuid("grn_id")
      .notNull()
      .references(() => goodsReceivedNotes.id, { onDelete: "cascade" }),
    inventoryItemId: uuid("inventory_item_id")
      .notNull()
      .references(() => inventoryItems.id, { onDelete: "restrict" }),
    receivedQuantity: decimal("received_quantity", { precision: 10, scale: 3 }).notNull(),
    unitPrice: decimal("unit_price", { precision: 10, scale: 2 }).notNull(),
    totalPrice: decimal("total_price", { precision: 10, scale: 2 }).notNull(),
  },
  (table) => [index("grn_items_grn_idx").on(table.grnId)]
);

// ─── Compliance / Tax Engine ───

export const taxRules = pgTable(
  "tax_rules",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    name: varchar("name", { length: 100 }).notNull(), // e.g. "Standard GST 5%", "Liquor VAT 20%"
    type: varchar("type", { length: 50 }).notNull(), // "GST", "VAT", "SERVICE_CHARGE"
    percentage: decimal("percentage", { precision: 5, scale: 2 }).notNull(),
    isCgstSgstSplit: boolean("is_cgst_sgst_split").default(false).notNull(), // if true, split 50/50 automatically
    zone: varchar("zone", { length: 100 }), // optional state/zone rule
    isActive: boolean("is_active").default(true).notNull(),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at").defaultNow().notNull(),
  },
  (table) => [index("tax_rules_org_idx").on(table.organizationId)]
);

// ─── Role Permissions Matrix ───

export const rolePermissions = pgTable(
  "role_permissions",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    role: userRoleEnum("role").notNull(),
    permissions: text("permissions").notNull(), // JSON array of permission strings
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at").defaultNow().notNull(),
  },
  (table) => [
    index("role_permissions_org_idx").on(table.organizationId),
  ]
);

// ─── Sync Heartbeats ───

export const posHeartbeats = pgTable(
  "pos_heartbeats",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    outletId: uuid("outlet_id")
      .notNull()
      .references(() => outlets.id, { onDelete: "cascade" }),
    lastSeen: timestamp("last_seen").defaultNow().notNull(),
    latencyMs: integer("latency_ms").default(0).notNull(),
    status: varchar("status", { length: 20 }).default("ONLINE").notNull(), // ONLINE, OFFLINE, DEGRADED
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at").defaultNow().notNull(),
  },
  (table) => [index("heartbeats_outlet_idx").on(table.outletId)]
);

export const vendorsRelations = relations(vendors, ({ one, many }) => ({
  organization: one(organizations, {
    fields: [vendors.organizationId],
    references: [organizations.id],
  }),
  purchaseOrders: many(purchaseOrders),
}));

export const purchaseOrdersRelations = relations(purchaseOrders, ({ one, many }) => ({
  organization: one(organizations, {
    fields: [purchaseOrders.organizationId],
    references: [organizations.id],
  }),
  outlet: one(outlets, {
    fields: [purchaseOrders.outletId],
    references: [outlets.id],
  }),
  vendor: one(vendors, {
    fields: [purchaseOrders.vendorId],
    references: [vendors.id],
  }),
  items: many(purchaseOrderItems),
  grns: many(goodsReceivedNotes),
}));

export const purchaseOrderItemsRelations = relations(purchaseOrderItems, ({ one }) => ({
  purchaseOrder: one(purchaseOrders, {
    fields: [purchaseOrderItems.purchaseOrderId],
    references: [purchaseOrders.id],
  }),
  inventoryItem: one(inventoryItems, {
    fields: [purchaseOrderItems.inventoryItemId],
    references: [inventoryItems.id],
  }),
}));

export const goodsReceivedNotesRelations = relations(goodsReceivedNotes, ({ one, many }) => ({
  organization: one(organizations, {
    fields: [goodsReceivedNotes.organizationId],
    references: [organizations.id],
  }),
  outlet: one(outlets, {
    fields: [goodsReceivedNotes.outletId],
    references: [outlets.id],
  }),
  purchaseOrder: one(purchaseOrders, {
    fields: [goodsReceivedNotes.purchaseOrderId],
    references: [purchaseOrders.id],
  }),
  items: many(grnItems),
}));

export const grnItemsRelations = relations(grnItems, ({ one }) => ({
  grn: one(goodsReceivedNotes, {
    fields: [grnItems.grnId],
    references: [goodsReceivedNotes.id],
  }),
  inventoryItem: one(inventoryItems, {
    fields: [grnItems.inventoryItemId],
    references: [inventoryItems.id],
  }),
}));

export const taxRulesRelations = relations(taxRules, ({ one }) => ({
  organization: one(organizations, {
    fields: [taxRules.organizationId],
    references: [organizations.id],
  }),
}));

export const rolePermissionsRelations = relations(rolePermissions, ({ one }) => ({
  organization: one(organizations, {
    fields: [rolePermissions.organizationId],
    references: [organizations.id],
  }),
}));

export const posHeartbeatsRelations = relations(posHeartbeats, ({ one }) => ({
  outlet: one(outlets, {
    fields: [posHeartbeats.outletId],
    references: [outlets.id],
  }),
}));

export const aggregatorMenuMappingsRelations = relations(
  aggregatorMenuMappings,
  ({ one }) => ({
    organization: one(organizations, {
      fields: [aggregatorMenuMappings.organizationId],
      references: [organizations.id],
    }),
    outlet: one(outlets, {
      fields: [aggregatorMenuMappings.outletId],
      references: [outlets.id],
    }),
    menuItem: one(menuItems, {
      fields: [aggregatorMenuMappings.posMenuItemId],
      references: [menuItems.id],
    }),
  })
);
