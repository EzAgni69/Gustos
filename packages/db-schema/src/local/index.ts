/**
 * Gusto Local Database Schema — SQLite (Drizzle ORM)
 *
 * Mirrors the cloud schema structure for orders, menu, and tables.
 * This runs on the local POS machine for offline-first operation.
 */

import {
  sqliteTable,
  text,
  integer,
  real,
} from "drizzle-orm/sqlite-core";
import { relations } from "drizzle-orm";

// ─── Menu (synced from cloud) ───

export const menuCategories = sqliteTable("menu_categories", {
  id: text("id").primaryKey(),
  outletId: text("outlet_id").notNull(),
  name: text("name").notNull(),
  sortOrder: integer("sort_order").default(0).notNull(),
  isActive: integer("is_active", { mode: "boolean" }).default(true).notNull(),
});

export const menuItems = sqliteTable("menu_items", {
  id: text("id").primaryKey(),
  categoryId: text("category_id")
    .notNull()
    .references(() => menuCategories.id),
  outletId: text("outlet_id").notNull(),
  name: text("name").notNull(),
  description: text("description"),
  price: real("price").notNull(),
  gstRate: text("gst_rate").notNull().default("5"),
  isVeg: integer("is_veg", { mode: "boolean" }).default(true).notNull(),
  isAvailable: integer("is_available", { mode: "boolean" })
    .default(true)
    .notNull(),
  sortOrder: integer("sort_order").default(0).notNull(),
  createdAt: text("created_at").notNull(),
  updatedAt: text("updated_at").notNull(),
});

// ─── Dining Tables ───

export const diningTables = sqliteTable("dining_tables", {
  id: text("id").primaryKey(),
  outletId: text("outlet_id").notNull(),
  name: text("name").notNull(),
  capacity: integer("capacity").notNull(),
  status: text("status").default("AVAILABLE").notNull(),
  section: text("section"),
  sortOrder: integer("sort_order").default(0).notNull(),
  currentOrderId: text("current_order_id"),
});

// ─── Orders (created locally, synced to cloud) ───

export const orders = sqliteTable("orders", {
  id: text("id").primaryKey(),
  outletId: text("outlet_id").notNull(),
  organizationId: text("organization_id").notNull(),
  tableId: text("table_id"),
  orderNumber: text("order_number").notNull(),
  orderMode: text("order_mode").default("DINE_IN").notNull(), // DINE_IN, TAKEAWAY, DELIVERY, QUICK_BILL
  status: text("status").default("DRAFT").notNull(),
  subtotal: real("subtotal").default(0).notNull(),
  discountAmount: real("discount_amount").default(0).notNull(),
  discountType: text("discount_type"), // PERCENTAGE or FLAT
  discountValue: real("discount_value"), // the raw value (e.g. 10 for 10%)
  taxAmount: real("tax_amount").default(0).notNull(),
  totalAmount: real("total_amount").default(0).notNull(),
  paymentMode: text("payment_mode"),
  customerId: text("customer_id"),
  customerName: text("customer_name"),
  customerPhone: text("customer_phone"),
  waiterId: text("waiter_id"),
  waiterName: text("waiter_name"),
  paxCount: integer("pax_count").default(1).notNull(),
  notes: text("notes"),
  isSynced: integer("is_synced", { mode: "boolean" }).default(false).notNull(),
  createdAt: text("created_at").notNull(),
  updatedAt: text("updated_at").notNull(),
});

export const orderItems = sqliteTable("order_items", {
  id: text("id").primaryKey(),
  orderId: text("order_id")
    .notNull()
    .references(() => orders.id),
  menuItemId: text("menu_item_id").notNull(),
  menuItemName: text("menu_item_name").notNull(),
  quantity: integer("quantity").notNull(),
  unitPrice: real("unit_price").notNull(),
  gstRate: text("gst_rate").notNull(),
  modifiers: text("modifiers"), // JSON array stored as text
  notes: text("notes"),
  status: text("status").default("PLACED").notNull(),
  kotId: text("kot_id"), // which KOT this item was sent on
});

// ─── KOTs ───

export const kitchenOrderTickets = sqliteTable("kitchen_order_tickets", {
  id: text("id").primaryKey(),
  orderId: text("order_id")
    .notNull()
    .references(() => orders.id),
  kotNumber: text("kot_number").notNull(),
  station: text("station"),
  status: text("status").default("PENDING").notNull(),
  createdAt: text("created_at").notNull(),
});

export const kotItems = sqliteTable("kot_items", {
  id: text("id").primaryKey(),
  kotId: text("kot_id")
    .notNull()
    .references(() => kitchenOrderTickets.id),
  orderItemId: text("order_item_id")
    .notNull()
    .references(() => orderItems.id),
  menuItemName: text("menu_item_name").notNull(),
  quantity: integer("quantity").notNull(),
  modifiers: text("modifiers"),
  notes: text("notes"),
});

// ─── Invoices ───

export const invoices = sqliteTable("invoices", {
  id: text("id").primaryKey(),
  orderId: text("order_id")
    .notNull()
    .references(() => orders.id),
  invoiceNumber: text("invoice_number").notNull(),
  subtotal: real("subtotal").notNull(),
  discountAmount: real("discount_amount").default(0).notNull(),
  cgstAmount: real("cgst_amount").default(0).notNull(),
  sgstAmount: real("sgst_amount").default(0).notNull(),
  totalAmount: real("total_amount").notNull(),
  paymentMode: text("payment_mode").notNull(),
  isPaid: integer("is_paid", { mode: "boolean" }).default(false).notNull(),
  createdAt: text("created_at").notNull(),
});

// ─── Sequences (daily order/KOT number tracking) ───

export const sequences = sqliteTable("sequences", {
  id: text("id").primaryKey(), // e.g. "order-20260715", "kot-20260715"
  currentValue: integer("current_value").default(0).notNull(),
  dateKey: text("date_key").notNull(), // YYYYMMDD
});

// ─── Event Log (append-only for 2-day edit lock) ───

export const eventLog = sqliteTable("event_log", {
  id: text("id").primaryKey(),
  orderId: text("order_id").notNull(),
  eventType: text("event_type").notNull(), // ORDER_CREATED, ITEM_ADDED, ITEM_REMOVED, etc.
  payload: text("payload").notNull(), // JSON
  userId: text("user_id"),
  createdAt: text("created_at").notNull(),
});

// ─── Sync Queue (outbound to cloud) ───

export const syncOutbox = sqliteTable("sync_outbox", {
  id: text("id").primaryKey(),
  eventType: text("event_type").notNull(),
  payload: text("payload").notNull(), // JSON
  status: text("status").default("PENDING").notNull(), // PENDING, SYNCING, SYNCED, FAILED
  retryCount: integer("retry_count").default(0).notNull(),
  createdAt: text("created_at").notNull(),
  syncedAt: text("synced_at"),
});

// ─── Local Users (PIN-based auth, synced from cloud) ───

export const localUsers = sqliteTable("local_users", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  pin: text("pin").notNull(),
  role: text("role").notNull(),
  isActive: integer("is_active", { mode: "boolean" }).default(true).notNull(),
});

// ─── Relations ───

export const menuCategoriesRelations = relations(menuCategories, ({ many }) => ({
  items: many(menuItems),
}));

export const menuItemsRelations = relations(menuItems, ({ one }) => ({
  category: one(menuCategories, {
    fields: [menuItems.categoryId],
    references: [menuCategories.id],
  }),
}));

export const ordersRelations = relations(orders, ({ many }) => ({
  items: many(orderItems),
  kots: many(kitchenOrderTickets),
  invoices: many(invoices),
  events: many(eventLog),
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

export const eventLogRelations = relations(eventLog, ({ one }) => ({
  order: one(orders, {
    fields: [eventLog.orderId],
    references: [orders.id],
  }),
}));
