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
  variants: text("variants"), // JSON: [{ name: string, price: number }]
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

export const tableReservations = sqliteTable("table_reservations", {
  id: text("id").primaryKey(),
  outletId: text("outlet_id").notNull(),
  tableId: text("table_id")
    .notNull()
    .references(() => diningTables.id),
  customerName: text("customer_name"),
  reservationTime: text("reservation_time").notNull(), // ISO Date
  durationMins: integer("duration_mins").default(60).notNull(),
  status: text("status").default("ACTIVE").notNull(), // ACTIVE, COMPLETED, CANCELLED
  createdAt: text("created_at").notNull(),
  updatedAt: text("updated_at").notNull(),
});

// ─── Orders (created locally, synced to cloud) ───

export const orders = sqliteTable("orders", {
  id: text("id").primaryKey(),
  outletId: text("outlet_id").notNull(),
  organizationId: text("organization_id").notNull(),
  tableId: text("table_id"),
  orderNumber: text("order_number").notNull(),
  orderMode: text("order_mode").default("DINE_IN").notNull(), // DINE_IN, TAKEAWAY, DELIVERY, ONLINE
  previousOrderMode: text("previous_order_mode"), // tracks mode changes for audit
  status: text("status").default("DRAFT").notNull(), // DRAFT, PLACED, IN_PROGRESS, READY, COMPLETED, CANCELLED, MERGED
  subtotal: real("subtotal").default(0).notNull(),
  discountAmount: real("discount_amount").default(0).notNull(),
  discountType: text("discount_type"), // PERCENTAGE or FLAT
  discountValue: real("discount_value"), // the raw value (e.g. 10 for 10%)
  discountLabel: text("discount_label"), // e.g. "Happy Hour", "10% Off"
  taxAmount: real("tax_amount").default(0).notNull(),
  totalAmount: real("total_amount").default(0).notNull(),
  paymentMode: text("payment_mode"),
  paymentSubMethod: text("payment_sub_method"), // e.g. PHONEPE, GPAY
  paymentSplits: text("payment_splits"), // JSON array of split entries
  tipAmount: real("tip_amount").default(0).notNull(),
  customerId: text("customer_id"),
  customerName: text("customer_name"),
  customerPhone: text("customer_phone"),
  waiterId: text("waiter_id"),
  waiterName: text("waiter_name"),
  cashierId: text("cashier_id"),
  cashierName: text("cashier_name"),
  tokenNumbers: text("token_numbers"), // JSON array of ints e.g. "[21,24]"
  paxCount: integer("pax_count").default(1).notNull(),
  notes: text("notes"),
  // Complimentary order fields
  isComplimentary: integer("is_complimentary", { mode: "boolean" }).default(false).notNull(),
  complimentaryReason: text("complimentary_reason"),
  complimentaryApprovedBy: text("complimentary_approved_by"),
  // Merge tracking
  mergedIntoOrderId: text("merged_into_order_id"), // if this order was merged into another
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
  variantName: text("variant_name"), // e.g. "(Large [12 Inch] Serves 2)"
  quantity: integer("quantity").notNull(),
  unitPrice: real("unit_price").notNull(),
  gstRate: text("gst_rate").notNull(),
  modifiers: text("modifiers"), // JSON array stored as text
  notes: text("notes"),
  addOns: text("add_ons"), // JSON array: [{name, quantity, unitPrice, amount}]
  status: text("status").default("PLACED").notNull(), // PLACED, VOIDED
  kotId: text("kot_id"), // which KOT this item was sent on
  // Void / NCR fields
  voidedAt: text("voided_at"),
  voidReason: text("void_reason"),
  voidApprovedBy: text("void_approved_by"),
  isNcr: integer("is_ncr", { mode: "boolean" }).default(false).notNull(), // Non-Chargeable Revenue
  // Item-level discount fields
  itemDiscountType: text("item_discount_type"), // PERCENTAGE | FLAT
  itemDiscountValue: real("item_discount_value"),
  itemDiscountReason: text("item_discount_reason"), // e.g. "Late delivery"
});

// ─── KOTs ───

export const kitchenOrderTickets = sqliteTable("kitchen_order_tickets", {
  id: text("id").primaryKey(),
  orderId: text("order_id")
    .notNull()
    .references(() => orders.id),
  kotNumber: text("kot_number").notNull(),
  station: text("station"),
  status: text("status").default("PENDING").notNull(), // PENDING, IN_PROGRESS, READY, SERVED, CANCELLED
  kotType: text("kot_type").default("ORIGINAL").notNull(), // ORIGINAL, MODIFICATION, CANCELLATION
  isRush: integer("is_rush", { mode: "boolean" }).default(false).notNull(),
  isReprint: integer("is_reprint", { mode: "boolean" }).default(false).notNull(),
  cancelledAt: text("cancelled_at"),
  cancelReason: text("cancel_reason"),
  cancelApprovedBy: text("cancel_approved_by"),
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
  receiptStatus: text("receipt_status").default("ORIGINAL").notNull(),
  subtotal: real("subtotal").notNull(),
  discountAmount: real("discount_amount").default(0).notNull(),
  cgstRate: real("cgst_rate").default(2.5).notNull(),
  cgstAmount: real("cgst_amount").default(0).notNull(),
  sgstRate: real("sgst_rate").default(2.5).notNull(),
  sgstAmount: real("sgst_amount").default(0).notNull(),
  totalQuantity: integer("total_quantity").default(0).notNull(),
  totalAmount: real("total_amount").notNull(),
  paymentMode: text("payment_mode").notNull(),
  paymentSubMethod: text("payment_sub_method"),
  paymentSplits: text("payment_splits"), // JSON array of split entries
  tipAmount: real("tip_amount").default(0).notNull(),
  tenderedAmount: real("tendered_amount"), // Cash tendered by customer (for cash drawer reconciliation)
  changeDue: real("change_due"), // Change returned to customer
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
  lastError: text("last_error"),
  createdAt: text("created_at").notNull(),
  syncedAt: text("synced_at"),
});

// ─── Outlet Config (synced from cloud, used for receipts) ───

export const outletConfig = sqliteTable("outlet_config", {
  id: text("id").primaryKey(),
  outletId: text("outlet_id").notNull(),
  outletName: text("outlet_name").notNull(),
  address: text("address").notNull(),
  phone: text("phone"),
  gstNumber: text("gst_number"),
  fssaiLicenseNo: text("fssai_license_no"),
  greetingMessage: text("greeting_message").default("Thank you, visit again!"),
  logoImagePath: text("logo_image_path"),
  defaultGstRate: text("default_gst_rate").default("5").notNull(),
  currencySymbol: text("currency_symbol").default("₹").notNull(),
  updatedAt: text("updated_at").notNull(),
});

// ─── Local Users (PIN-based auth, synced from cloud) ───

export const localUsers = sqliteTable("local_users", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  pin: text("pin").notNull(),
  role: text("role").notNull(),
  isActive: integer("is_active", { mode: "boolean" }).default(true).notNull(),
});
// ─── Sync Metadata (tracks cloud pull timestamps) ───

export const syncMeta = sqliteTable("sync_meta", {
  id: text("id").primaryKey(), // e.g. "cloud-pull"
  lastSyncTimestamp: text("last_sync_timestamp").notNull(), // ISO string
  updatedAt: text("updated_at").notNull(),
});

// ─── Cashier Shifts (day-close / X-Z reports) ───

export const cashierShifts = sqliteTable("cashier_shifts", {
  id: text("id").primaryKey(),
  cashierId: text("cashier_id").notNull(),
  cashierName: text("cashier_name").notNull(),
  openedAt: text("opened_at").notNull(), // ISO string
  closedAt: text("closed_at"), // null if active

  openingFloat: real("opening_float").default(0).notNull(), // cash in drawer at start

  // Calculated at close:
  totalCashSales: real("total_cash_sales").default(0).notNull(),
  totalCardSales: real("total_card_sales").default(0).notNull(),
  totalUpiSales: real("total_upi_sales").default(0).notNull(),
  totalOnlineSales: real("total_online_sales").default(0).notNull(),
  totalSplitSales: real("total_split_sales").default(0).notNull(),
  totalOrders: integer("total_orders").default(0).notNull(),
  totalDiscounts: real("total_discounts").default(0).notNull(),
  totalTips: real("total_tips").default(0).notNull(),
  totalChangeDue: real("total_change_due").default(0).notNull(),

  expectedCashInDrawer: real("expected_cash_in_drawer").default(0).notNull(),
  actualCashInDrawer: real("actual_cash_in_drawer"), // cashier-entered count at close
  cashVariance: real("cash_variance"), // actual - expected

  notes: text("notes"),
  status: text("status").default("OPEN").notNull(), // OPEN | CLOSED
});

// ─── Print Queue (resilient print job queuing) ───

export const printQueue = sqliteTable("print_queue", {
  id: text("id").primaryKey(),
  templateType: text("template_type").notNull(), // BILL | KOT | SHIFT_REPORT
  templateData: text("template_data").notNull(), // JSON — the ReceiptLine[] serialized
  printerTarget: text("printer_target").default("pos").notNull(), // "pos" or "captain"
  status: text("status").default("PENDING").notNull(), // PENDING | PRINTING | COMPLETED | FAILED
  retryCount: integer("retry_count").default(0).notNull(),
  maxRetries: integer("max_retries").default(3).notNull(),
  errorMessage: text("error_message"),
  createdAt: text("created_at").notNull(),
  completedAt: text("completed_at"),
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

export const diningTablesRelations = relations(diningTables, ({ many }) => ({
  reservations: many(tableReservations),
}));

export const tableReservationsRelations = relations(tableReservations, ({ one }) => ({
  table: one(diningTables, {
    fields: [tableReservations.tableId],
    references: [diningTables.id],
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
