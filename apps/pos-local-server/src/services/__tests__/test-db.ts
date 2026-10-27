/**
 * Test Database Helper
 *
 * Creates an in-memory SQLite database for unit tests.
 * Uses Drizzle ORM with the same schema as production, but bootstrapped
 * via raw SQL (no migration runner needed) for fast test setup.
 */

import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import * as schema from "@gusto/db-schema/local";

/**
 * Create a fresh in-memory SQLite database with the full local schema.
 * Each call returns an independent DB instance — safe for parallel tests.
 */
export function createTestDb() {
  const sqlite = new Database(":memory:");
  sqlite.pragma("foreign_keys = ON");

  // Bootstrap schema with the minimal tables needed for KOT service tests
  sqlite.exec(`
    CREATE TABLE IF NOT EXISTS orders (
      id TEXT PRIMARY KEY NOT NULL,
      outlet_id TEXT NOT NULL,
      organization_id TEXT NOT NULL,
      table_id TEXT,
      order_number TEXT NOT NULL,
      order_mode TEXT NOT NULL DEFAULT 'DINE_IN',
      previous_order_mode TEXT,
      status TEXT NOT NULL DEFAULT 'DRAFT',
      subtotal REAL NOT NULL DEFAULT 0,
      discount_amount REAL NOT NULL DEFAULT 0,
      discount_type TEXT,
      discount_value REAL,
      discount_label TEXT,
      tax_amount REAL NOT NULL DEFAULT 0,
      total_amount REAL NOT NULL DEFAULT 0,
      payment_mode TEXT,
      payment_sub_method TEXT,
      payment_splits TEXT,
      tip_amount REAL NOT NULL DEFAULT 0,
      customer_id TEXT,
      customer_name TEXT,
      customer_phone TEXT,
      waiter_id TEXT,
      waiter_name TEXT,
      cashier_id TEXT,
      cashier_name TEXT,
      token_numbers TEXT,
      pax_count INTEGER NOT NULL DEFAULT 1,
      notes TEXT,
      is_complimentary INTEGER NOT NULL DEFAULT 0,
      complimentary_reason TEXT,
      complimentary_approved_by TEXT,
      merged_into_order_id TEXT,
      is_synced INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS order_items (
      id TEXT PRIMARY KEY NOT NULL,
      order_id TEXT NOT NULL,
      menu_item_id TEXT NOT NULL,
      menu_item_name TEXT NOT NULL,
      variant_name TEXT,
      quantity INTEGER NOT NULL,
      unit_price REAL NOT NULL,
      gst_rate TEXT NOT NULL,
      modifiers TEXT,
      notes TEXT,
      add_ons TEXT,
      status TEXT NOT NULL DEFAULT 'PLACED',
      kot_id TEXT,
      voided_at TEXT,
      void_reason TEXT,
      void_approved_by TEXT,
      is_ncr INTEGER NOT NULL DEFAULT 0,
      item_discount_type TEXT,
      item_discount_value REAL,
      item_discount_reason TEXT,
      FOREIGN KEY (order_id) REFERENCES orders(id)
    );

    CREATE TABLE IF NOT EXISTS dining_tables (
      id TEXT PRIMARY KEY NOT NULL,
      outlet_id TEXT NOT NULL,
      name TEXT NOT NULL,
      capacity INTEGER NOT NULL,
      status TEXT NOT NULL DEFAULT 'AVAILABLE',
      section TEXT,
      sort_order INTEGER NOT NULL DEFAULT 0,
      current_order_id TEXT
    );

    CREATE TABLE IF NOT EXISTS menu_categories (
      id TEXT PRIMARY KEY NOT NULL,
      outlet_id TEXT NOT NULL,
      name TEXT NOT NULL,
      sort_order INTEGER NOT NULL DEFAULT 0,
      is_active INTEGER NOT NULL DEFAULT 1
    );

    CREATE TABLE IF NOT EXISTS menu_items (
      id TEXT PRIMARY KEY NOT NULL,
      category_id TEXT NOT NULL,
      outlet_id TEXT NOT NULL,
      name TEXT NOT NULL,
      description TEXT,
      variants TEXT,
      price REAL NOT NULL,
      gst_rate TEXT NOT NULL DEFAULT '5',
      is_veg INTEGER NOT NULL DEFAULT 1,
      is_available INTEGER NOT NULL DEFAULT 1,
      sort_order INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      FOREIGN KEY (category_id) REFERENCES menu_categories(id)
    );

    CREATE TABLE IF NOT EXISTS kitchen_order_tickets (
      id TEXT PRIMARY KEY NOT NULL,
      order_id TEXT NOT NULL,
      kot_number TEXT NOT NULL,
      station TEXT,
      status TEXT NOT NULL DEFAULT 'PENDING',
      kot_type TEXT NOT NULL DEFAULT 'ORIGINAL',
      is_rush INTEGER NOT NULL DEFAULT 0,
      is_reprint INTEGER NOT NULL DEFAULT 0,
      cancelled_at TEXT,
      cancel_reason TEXT,
      cancel_approved_by TEXT,
      created_at TEXT NOT NULL,
      FOREIGN KEY (order_id) REFERENCES orders(id)
    );

    CREATE TABLE IF NOT EXISTS kot_items (
      id TEXT PRIMARY KEY NOT NULL,
      kot_id TEXT NOT NULL,
      order_item_id TEXT NOT NULL,
      menu_item_name TEXT NOT NULL,
      quantity INTEGER NOT NULL,
      modifiers TEXT,
      notes TEXT,
      FOREIGN KEY (kot_id) REFERENCES kitchen_order_tickets(id),
      FOREIGN KEY (order_item_id) REFERENCES order_items(id)
    );

    CREATE TABLE IF NOT EXISTS sequences (
      id TEXT PRIMARY KEY NOT NULL,
      current_value INTEGER NOT NULL DEFAULT 0,
      date_key TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS event_log (
      id TEXT PRIMARY KEY NOT NULL,
      order_id TEXT NOT NULL,
      event_type TEXT NOT NULL,
      payload TEXT NOT NULL,
      user_id TEXT,
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS sync_outbox (
      id TEXT PRIMARY KEY NOT NULL,
      event_type TEXT NOT NULL,
      payload TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'PENDING',
      retry_count INTEGER NOT NULL DEFAULT 0,
      last_error TEXT,
      created_at TEXT NOT NULL,
      synced_at TEXT
    );

    CREATE TABLE IF NOT EXISTS print_queue (
      id TEXT PRIMARY KEY NOT NULL,
      template_type TEXT NOT NULL,
      template_data TEXT NOT NULL,
      printer_target TEXT NOT NULL DEFAULT 'pos',
      status TEXT NOT NULL DEFAULT 'PENDING',
      retry_count INTEGER NOT NULL DEFAULT 0,
      max_retries INTEGER NOT NULL DEFAULT 3,
      error_message TEXT,
      created_at TEXT NOT NULL,
      completed_at TEXT
    );

    CREATE TABLE IF NOT EXISTS invoices (
      id TEXT PRIMARY KEY NOT NULL,
      order_id TEXT NOT NULL,
      invoice_number TEXT NOT NULL,
      receipt_status TEXT NOT NULL DEFAULT 'ORIGINAL',
      subtotal REAL NOT NULL,
      discount_amount REAL NOT NULL DEFAULT 0,
      cgst_rate REAL NOT NULL DEFAULT 2.5,
      cgst_amount REAL NOT NULL DEFAULT 0,
      sgst_rate REAL NOT NULL DEFAULT 2.5,
      sgst_amount REAL NOT NULL DEFAULT 0,
      total_quantity INTEGER NOT NULL DEFAULT 0,
      total_amount REAL NOT NULL,
      payment_mode TEXT NOT NULL,
      payment_sub_method TEXT,
      payment_splits TEXT,
      tip_amount REAL NOT NULL DEFAULT 0,
      tendered_amount REAL,
      change_due REAL,
      is_paid INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL,
      FOREIGN KEY (order_id) REFERENCES orders(id)
    );

    CREATE TABLE IF NOT EXISTS outlet_config (
      id TEXT PRIMARY KEY NOT NULL,
      outlet_id TEXT NOT NULL,
      outlet_name TEXT NOT NULL,
      address TEXT NOT NULL,
      phone TEXT,
      gst_number TEXT,
      fssai_license_no TEXT,
      greeting_message TEXT DEFAULT 'Thank you, visit again!',
      logo_image_path TEXT,
      default_gst_rate TEXT NOT NULL DEFAULT '5',
      currency_symbol TEXT NOT NULL DEFAULT '₹',
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS cashier_shifts (
      id TEXT PRIMARY KEY NOT NULL,
      cashier_id TEXT NOT NULL,
      cashier_name TEXT NOT NULL,
      opened_at TEXT NOT NULL,
      closed_at TEXT,
      opening_float REAL NOT NULL DEFAULT 0,
      closing_float REAL,
      status TEXT NOT NULL DEFAULT 'OPEN',
      notes TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
  `);

  return drizzle(sqlite, { schema });
}
