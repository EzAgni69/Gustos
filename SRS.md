# Gusto ERP — Software Requirements Specification

> **Version:** 1.0  
> **Last Updated:** 2026-07-14  
> **Status:** Draft  
> **Comparable Product:** Petpooja

---

## 1. System Overview & Context

### 1.1 Purpose

Gusto is an **enterprise-grade, multi-tenant Restaurant ERP** system designed to manage the full operational lifecycle of a restaurant chain — from billing and kitchen operations to inventory, CRM, HR, and multi-outlet management.

### 1.2 Core Architecture Principle

**Local-First, Cloud-Synced.**

The restaurant must operate **100% locally** if the internet goes down, syncing data to the cloud when connectivity returns. The local POS is the single source of truth at the outlet level; the cloud is the single source of truth at the organization level.

### 1.3 Development Paradigm

**100% TypeScript Ecosystem.**

Do **not** duplicate business logic. Share validation schemas, tax math, local/cloud API logic, and type definitions across all platforms using a unified monorepo workspace.

---

## 2. Tech Stack

| Layer | Technology |
|---|---|
| **Monorepo** | Turborepo + pnpm workspaces |
| **Desktop POS (Local Server)** | Node.js + Express (TypeScript). Packaged via Electron for easy installation on restaurant machines. |
| **Desktop POS (Frontend)** | React + Vite (TypeScript) |
| **Cloud API Gateway** | Node.js + Fastify (TypeScript) |
| **Sync Workers** | Node.js + BullMQ (Redis-backed job queue) |
| **Cloud Database** | PostgreSQL 16 + Drizzle ORM. Row-Level Security (RLS) for multi-tenant isolation. |
| **Local Database** | SQLite (via `better-sqlite3` + Drizzle ORM on the local POS) |
| **Web Admin Dashboard** | Next.js 15 (App Router) + Tailwind CSS v4 + shadcn/ui |
| **Mobile Apps (Captain & Customer)** | React Native (Expo SDK 53) |
| **Kitchen Display System (KDS)** | React + Vite web app (optimized for Android TV with mouse input) |
| **Real-time Communication** | Socket.IO (LAN WebSocket hub on POS; cloud-to-POS relay) |
| **Shared Packages** | Zod (validation), TypeScript types, core math utilities, ESC/POS printing logic |
| **Authentication** | JWT (cloud) + API Key (LAN devices ↔ local POS) |
| **Containerization** | Docker + Docker Compose (cloud services) |

---

## 3. Monorepo Directory Structure

```
gusto/
├── apps/
│   ├── pos-local-server/     # Node.js/Express — Local offline DB, Print engine, LAN WebSocket hub
│   ├── pos-ui/               # React/Vite — Billing counter frontend, connects to local server
│   ├── kds-tv/               # React/Vite — Mouse-optimized UI for kitchen (Android TV)
│   ├── app-captain/          # React Native Expo — Waiter mobile app
│   ├── web-admin/            # Next.js — Cloud ERP dashboard
│   ├── api-gateway/          # Node.js/Fastify — Main Cloud API (REST + tRPC)
│   └── sync-worker/          # Node.js/BullMQ — Background queue for offline sync & webhooks
│
├── packages/
│   ├── core-logic/           # Shared TS logic — Tax math, cart totals, discount engine
│   ├── api-contracts/        # Zod schemas, TypeScript types, API request/response contracts
│   ├── db-schema/            # Drizzle schema definitions for PostgreSQL (cloud) & SQLite (local)
│   ├── ui-web/               # Shared React components (Tailwind + shadcn/ui)
│   └── printer/              # ESC/POS thermal printer commands & receipt templates
│
├── tooling/
│   ├── eslint-config/        # Shared ESLint configuration
│   └── tsconfig/             # Shared TypeScript configurations
│
├── turbo.json
├── pnpm-workspace.yaml
├── package.json
├── .env.example
├── docker-compose.yml        # PostgreSQL, Redis, API Gateway, Sync Worker
└── README.md
```

---

## 4. Module Specifications & Rules

### 4.A — Desktop POS (The Local Node Core)

**Responsibility:** The single source of truth for the local network at each outlet.

| Aspect | Detail |
|---|---|
| **Architecture** | Node.js Express server running locally on the billing computer (`localhost:8080`), serving `pos-ui` React frontend. |
| **Offline Capability** | Express reads/writes to a local SQLite database via Drizzle ORM. All billing operations work with zero internet. |
| **Local Networking** | Express spins up a Socket.IO hub on the LAN (e.g., `192.168.1.100:8080`) for the Captain App and KDS to connect. |
| **Event Sourcing (2-Day Edit Lock)** | Do **not** mutate old order rows directly. Implement an append-only event log (`Order_Created`, `Item_Added`, `Item_Removed`, `Discount_Applied`, `Payment_Received`). The system locks edits **48 hours** after the initial timestamp. |
| **Thermal Printing** | Use `node-thermal-printer` to send ESC/POS commands directly to USB or LAN thermal printers. Support KOT, bill receipt, and reprint of old orders. |
| **Billing Features** | Order taking, table management, KOT generation, split/merge bills, multiple payment modes (Cash, Card, UPI, Online), GST billing, receipt printing. |

### 4.B — Captain App (Waiter Mobile App)

| Aspect | Detail |
|---|---|
| **Network Constraint** | Must communicate **only** with the local `pos-local-server` via LAN (Wi-Fi). Do **not** connect directly to the cloud. |
| **Features** | Live table layout with status indicators, menu browsing, add items with modifiers (e.g., "Less spicy", "Extra cheese"), fire KOTs to kitchen, view order history for current shift. |
| **State Management** | Cache pending orders in local memory (Zustand + MMKV) to prevent data loss if the waiter walks into a Wi-Fi dead zone. Auto-sync when reconnected. |
| **Authentication** | PIN-based login against the local POS server. Each waiter has a unique PIN. |

### 4.C — KDS (Kitchen Display System — Android TV)

| Aspect | Detail |
|---|---|
| **UI/UX Constraints** | Designed for 32-inch+ Android TV controlled by USB Mouse — **not** a touchscreen. Buttons must be large (min 80px tap target). No swipe gestures. |
| **Data Stream** | Connects via WebSocket directly to the local `pos-local-server`. |
| **Features** | Display incoming KOTs in chronological order. Color-coded timers: 🟢 Green (< 10 min), 🟡 Yellow (> 10 min), 🔴 Red (> 15 min). "Mark Ready" click triggers a socket event back to the POS. Station-based filtering (Grill, Beverages, etc.). |
| **Audio Alerts** | Audible notification on new KOT arrival. Escalating alert when an order goes red. |

### 4.D — Web Admin & Cloud Database (The ERP)

| Aspect | Detail |
|---|---|
| **Multi-Tenant Security** | Enforce PostgreSQL Row-Level Security (RLS) on `organization_id` for all tables. Tenant hierarchy: Organization → Franchise → Outlet. |
| **Inventory (Recipe-Based)** | Deductions happen in the cloud async queue (sync-worker), **not** on the local POS. E.g., Selling 1 "Margherita Pizza" triggers a cloud worker to deduct 200g flour, 100g cheese based on the recipe tree. |
| **Reporting** | Sales reports, inventory reports, staff performance, outlet-wise comparisons, profitability analysis, food cost percentage. |
| **Integrations Dashboard** | Manage Zomato/Swiggy webhook configs, payment gateway settings, Tally accounting export. |

### 4.E — Integrations & Sync Worker

| Aspect | Detail |
|---|---|
| **Cloud Syncing** | The `sync-worker` handles inbound data dumps from offline POS machines coming back online. Resolves conflicts chronologically using local POS timestamps (last-write-wins with vector clock). |
| **Aggregators (Zomato/Swiggy)** | Expose webhook endpoints. On receiving an order, the cloud routes it via WebSocket down to the specific branch's `pos-local-server` to auto-print. |
| **Payment Gateways** | Razorpay/PayU integration for online payments. UPI deep-link generation for QR Scan & Pay. |
| **Accounting (Tally)** | Export daily sales summaries in Tally-compatible XML format. |
| **SMS/WhatsApp** | Transactional messages for order confirmation, feedback requests, promotional offers via MSG91 or Twilio. |

### 4.F — CRM Module

| Aspect | Detail |
|---|---|
| **Customer Profiles** | Auto-create from phone number at billing. Store name, phone, email, preferences, allergies. |
| **Purchase History** | Full order history per customer, linked across all outlets. |
| **Feedback** | Post-meal feedback collection via WhatsApp/SMS link. Rating + text review stored against order. |
| **Loyalty & Coupons** | Points-based loyalty program. Configurable earn/burn ratios per franchise. Coupon code engine with rules (min order, valid dates, outlet restrictions). |
| **Promotional Offers** | Targeted campaigns based on customer segments (frequency, avg spend, last visit). |

### 4.G — HR & Payroll Module

| Aspect | Detail |
|---|---|
| **Employee Management** | Role-based access (Owner, Manager, Cashier, Waiter, Chef). Employee profiles with documents. |
| **Attendance** | Clock-in/clock-out via Captain App or POS terminal. Biometric integration placeholder. |
| **Payroll** | Basic salary calculation with attendance deductions. Overtime rules. Monthly payslip generation. |
| **Shift Management** | Define shifts per outlet. Assign employees to shifts. Swap request workflow. |

### 4.H — Reservations & Self-Service

| Aspect | Detail |
|---|---|
| **Table Reservations** | Time-slot based booking via web widget or phone. Waitlist management. Auto-assign tables based on party size. |
| **QR Scan & Pay** | Generate unique QR per table. Customer scans → views bill → pays via UPI/card. Payment confirmation auto-updates POS. |
| **Self-Order Kiosk** | Web-based kiosk UI (future phase). Menu browsing, order placement, payment — all without waiter interaction. |

---

## 5. Data Model (Core Entities)

### 5.1 Tenant Hierarchy

```
Organization
  └── Franchise
        └── Outlet
              ├── Employee
              │     ├── Attendance
              │     └── Payroll
              ├── DiningTable
              │     └── Reservation
              └── Order
                    ├── OrderItem
                    │     └── OrderItemModifier
                    ├── KitchenOrderTicket
                    ├── Invoice
                    └── Payment
```

### 5.2 Menu & Inventory

```
MenuCategory
  └── MenuItem
        ├── MenuItemVariant
        └── Recipe
              └── RecipeIngredient
                    └── InventoryItem
                          ├── Stock (per outlet)
                          ├── StockTransfer
                          └── PurchaseOrder
                                └── PurchaseOrderItem
                                      └── Supplier
```

### 5.3 CRM & Online

```
Customer
  ├── Feedback
  ├── LoyaltyAccount
  └── Coupon

OnlineOrder (from Zomato/Swiggy/Website)
  ├── DeliveryOrder
  └── DeliveryPartner
```

### 5.4 System

```
AuditLog
SyncQueue
IntegrationConfig
Notification
```

---

## 6. Implementation Phases (Strict Order)

### Phase 1: Foundation & Cloud DB Setup
1. Initialize Turborepo monorepo with pnpm workspaces.
2. Setup shared tooling (`eslint-config`, `tsconfig`).
3. Setup `db-schema` package with Drizzle ORM — PostgreSQL schemas for the full tenant hierarchy (`organizations`, `franchises`, `outlets`, `employees`).
4. Implement Row-Level Security (RLS) policies on `organization_id`.
5. Create `api-contracts` package — Zod schemas for `Order`, `MenuItem`, `Invoice`, `Payment`.
6. Create `core-logic` package — Tax calculation (GST 5%/12%/18%/28%), cart total engine, discount application logic.
7. Setup Docker Compose for local dev (PostgreSQL + Redis).

### Phase 2: Local POS Core & Sync
1. Initialize `pos-local-server` (Express + SQLite via Drizzle).
2. Initialize `pos-ui` (React + Vite).
3. Setup local SQLite schema mirroring cloud schema for orders/menu/tables.
4. Build core billing flow: Table selection → Add items → Apply discounts → Split/Merge → Checkout → Print receipt.
5. Build KOT generation and printing.
6. Implement background sync mechanism (Local SQLite → Cloud PostgreSQL) via `sync-worker` + BullMQ.

### Phase 3: The LAN Ecosystem
1. Build Socket.IO hub inside `pos-local-server` for LAN communication.
2. Build `app-captain` (React Native Expo) — connect to local POS IP, push orders, view table status.
3. Build `kds-tv` (React/Vite) — listen to WebSocket, display KOTs with timers, mark ready.

### Phase 4: Cloud ERP & Admin
1. Build `api-gateway` (Fastify) — RESTful API with JWT auth, RLS enforcement.
2. Build `web-admin` (Next.js) — Organization setup, menu management, outlet management, user/role management.
3. Build Inventory module — Recipe tree, ingredient deduction engine in sync-worker, stock tracking, low-stock alerts, purchase orders.
4. Build Reporting module — Sales, inventory, profitability, staff performance dashboards.

### Phase 5: CRM, Integrations & Advanced Modules
1. CRM — Customer profiles, feedback, loyalty, coupons.
2. Zomato/Swiggy webhook integration.
3. Payment gateway integration (Razorpay).
4. QR Scan & Pay flow.
5. Tally export.
6. SMS/WhatsApp notifications.

### Phase 6: HR & Self-Service (Future)
1. Attendance tracking.
2. Payroll calculation.
3. Table reservation system.
4. Self-order kiosk UI.

---

## 7. Edge Case Handling

| Scenario | Solution |
|---|---|
| **Concurrent Inventory** | If two waiters order the last item simultaneously, the local Node server handles the mutex lock and broadcasts a "Sold Out" socket event to all LAN devices. |
| **Schema Migrations** | Use expand-and-contract patterns. Old POS terminals might send v1 payloads while cloud is on v2. The API Gateway must gracefully handle version mismatches via versioned endpoints. |
| **Offline Sync Conflicts** | Last-write-wins based on local POS timestamps. Critical conflicts (e.g., double payment) flagged for manual review in admin dashboard. |
| **Network Partition (LAN)** | Captain App caches orders locally in MMKV. When LAN reconnects, queued orders are sent to POS with "delayed" flag. KDS shows these orders with a warning icon. |
| **Printer Failure** | POS queues print jobs. On printer reconnection, pending receipts/KOTs are auto-printed. Visual alert on POS UI when printer is offline. |
| **Power Outage Recovery** | SQLite WAL mode ensures crash-safe writes. On restart, POS recovers from the last committed transaction. Pending sync queue is preserved. |

---

## 8. Non-Functional Requirements

| Requirement | Target |
|---|---|
| **Local POS Response Time** | < 100ms for order operations (SQLite is fast) |
| **Cloud API Response Time** | < 500ms for 95th percentile |
| **Sync Latency** | < 5 seconds when online |
| **Concurrent Users per Outlet** | Support 20+ simultaneous LAN devices |
| **Data Retention** | 7 years (GST compliance) |
| **Uptime (Cloud)** | 99.9% |
| **Security** | All cloud APIs over HTTPS. LAN communication over WS with API key auth. Passwords hashed with bcrypt. PII encrypted at rest. |
| **Backup** | Automated daily PostgreSQL backups. Local SQLite backup on POS shutdown. |
