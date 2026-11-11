# 🍽️ Gusto ERP

> Enterprise-grade, multi-tenant Restaurant ERP system. Local-first, cloud-synced.

## Architecture

```
Local Restaurant Network                          Cloud
┌─────────────────────────────┐     ┌──────────────────────────┐
│  📱 Captain App (Expo)      │     │  🌐 Web Admin (Next.js)  │
│  📺 KDS TV (React/Vite)     │     │  ⚡ API Gateway (Fastify) │
│         ↕ Socket.IO         │     │  ⚙️  Sync Worker (BullMQ) │
│  🖥️  POS Server (Express)   │────▶│  🐘 PostgreSQL + Redis   │
│  💾 SQLite (offline-first)  │sync │                          │
└─────────────────────────────┘     └──────────────────────────┘
```

## Quick Start

```bash
# 1. Install dependencies
pnpm install

# 2. Start infrastructure (PostgreSQL + Redis)
docker compose up -d

# 3. Copy environment variables
cp .env.example .env

# 4. Start all services in development
pnpm dev
```

## Workspace Structure

| App/Package | Description | Port |
|---|---|---|
| `apps/pos-local-server` | Local POS Express + SQLite + Socket.IO | 8080 |
| `apps/pos-ui` | Billing counter React frontend | 5173 |
| `apps/kds-tv` | Kitchen Display (Android TV) | 5174 |
| `apps/app-captain` | Waiter mobile app (Expo) | 8081 |
| `apps/web-admin` | Cloud ERP dashboard (Next.js) | 3000 |
| `apps/api-gateway` | Cloud REST API (Fastify) | 3001 |
| `apps/sync-worker` | Background job processor (BullMQ) | — |
| `packages/api-contracts` | Zod schemas & TypeScript types | — |
| `packages/core-logic` | Tax math, cart calculations | — |
| `packages/db-schema` | Drizzle ORM schemas (PG + SQLite) | — |
| `packages/ui-web` | Shared React components | — |
| `packages/printer` | ESC/POS receipt templates | — |

## Tech Stack

- **Monorepo:** Turborepo + pnpm
- **Backend:** Express (local), Fastify (cloud), BullMQ (workers)
- **Frontend:** React + Vite, Next.js 15, React Native Expo
- **Database:** PostgreSQL 16 (cloud) + SQLite (local), Drizzle ORM
- **Real-time:** Socket.IO
- **Styling:** Tailwind CSS v4 + shadcn/ui

## Scripts

```bash
pnpm dev          # Start all services
pnpm build        # Build all packages and apps
pnpm typecheck    # TypeScript check across all workspaces
pnpm lint         # Lint all workspaces
pnpm test         # Run all test suites
pnpm clean        # Clean all build artifacts
```

## Production Checklist

**Cloud (API gateway + sync worker)**

| Setting | Why |
|---|---|
| `NODE_ENV=production` | Turns on the strict checks below (the Dockerfiles set it). |
| `JWT_SECRET` (≥ 32 random chars) | The gateway refuses to start in production with a weak or default secret. |
| `POS_API_KEY` or `POS_OUTLET_API_KEYS` | Authenticates outlet POS servers. In production, sync is refused without one. Per-outlet keys confine a leaked key to its own outlet. |
| `CORS_ORIGIN` | The web-admin origin(s) allowed to call the API. |
| `DISABLE_REGISTRATION=true` | Close public sign-up once your organization exists. |
| `pnpm --filter @gusto/db-schema db:migrate` | Run before every deploy. Migrations are idempotent, so they are safe on databases previously updated with `db:push`. |

`GET /health` on the gateway reports database and Redis status (503 when the database is down).

**Outlet (POS local server)**

- Set the same `POS_API_KEY` as the cloud, plus `ORGANIZATION_ID`, `OUTLET_ID` and `API_GATEWAY_URL`.
- Staff sign in by choosing their name and entering their PIN; devices then hold a signed session token.
  POS UI and Captain app builds made before session tokens must be updated — or set
  `POS_ALLOW_LEGACY_AUTH=true` temporarily while rolling the new builds out.
- The kitchen display (KDS / Expo) needs no sign-in; it can only read tickets and change their cooking status.
- Configure printers with `POS_BILL_PRINTER_*`, `CAPTAIN_BILL_PRINTER_*` and `KITCHEN_PRINTER_*` (see `.env.example`).
- The outlet keeps billing with no internet. Sales queue locally and upload in order when the link returns;
  the ERP's **Outlets → Edge Sync Monitor** shows each outlet's connection and backlog.

## Database Migration Strategy (CI/CD)

For consistent and safe database schemas across environments:
- **Local Development:** `pnpm db:push` pushes schema changes straight to local SQLite/Postgres for rapid prototyping.
- **Every schema change needs a migration:** run `pnpm --filter @gusto/db-schema db:generate:cloud` (and `db:generate:local`) and commit the generated files. CI fails if the schema and the migrations have drifted apart.
- **Production Deployments:** run `pnpm --filter @gusto/db-schema db:migrate` against the production PostgreSQL instance before the new application versions boot. The local SQLite database migrates itself when the POS server starts.
