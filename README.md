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
pnpm clean        # Clean all build artifacts
```
