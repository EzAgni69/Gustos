FROM node:20-alpine AS base

FROM base AS builder
RUN apk update && apk add --no-cache libc6-compat
WORKDIR /app
RUN corepack enable pnpm
RUN pnpm i -g turbo
COPY . .
RUN turbo prune --scope=@gusto/pos-local-server --docker

FROM base AS installer
RUN apk update && apk add --no-cache libc6-compat python3 make g++
WORKDIR /app
RUN corepack enable pnpm

COPY .gitignore .gitignore
COPY --from=builder /app/out/json/ .
COPY --from=builder /app/out/pnpm-lock.yaml ./pnpm-lock.yaml
RUN pnpm install --frozen-lockfile

COPY --from=builder /app/out/full/ .
COPY turbo.json turbo.json
RUN pnpm turbo run build --filter=@gusto/pos-local-server...

FROM base AS runner
WORKDIR /app
RUN corepack enable pnpm

ENV PORT=8080
ENV NODE_ENV=production

COPY --from=installer /app .

EXPOSE 8080

CMD ["node", "apps/pos-local-server/dist/index.js"]
