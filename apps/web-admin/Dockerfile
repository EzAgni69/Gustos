FROM node:20-alpine AS base

FROM base AS builder
RUN apk update && apk add --no-cache libc6-compat
WORKDIR /app
RUN corepack enable pnpm
RUN pnpm i -g turbo
COPY . .
RUN turbo prune --scope=@gusto/web-admin --docker

FROM base AS installer
RUN apk update && apk add --no-cache libc6-compat
WORKDIR /app
RUN corepack enable pnpm

COPY .gitignore .gitignore
COPY --from=builder /app/out/json/ .
COPY --from=builder /app/out/pnpm-lock.yaml ./pnpm-lock.yaml
RUN pnpm install --frozen-lockfile

COPY --from=builder /app/out/full/ .
COPY turbo.json turbo.json
RUN pnpm turbo run build --filter=@gusto/web-admin...

FROM base AS runner
WORKDIR /app
RUN corepack enable pnpm

RUN addgroup --system --gid 1001 nodejs
RUN adduser --system --uid 1001 nextjs

# Automatically leverage output traces to reduce image size
COPY --from=installer --chown=nextjs:nodejs /app/apps/web-admin/.next/standalone ./
COPY --from=installer --chown=nextjs:nodejs /app/apps/web-admin/.next/static ./apps/web-admin/.next/static
COPY --from=installer --chown=nextjs:nodejs /app/apps/web-admin/public ./apps/web-admin/public

USER nextjs
ENV PORT 3000
ENV HOSTNAME 0.0.0.0

CMD ["node", "apps/web-admin/server.js"]
