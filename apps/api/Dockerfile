# Build context: monorepo root (.)
FROM node:24-alpine3.23 AS base
WORKDIR /app

FROM base AS builder
# Copy root workspace config
COPY package.json package-lock.json ./
COPY apps/api/package.json ./apps/api/
COPY packages/shared/package.json ./packages/shared/
RUN npm ci

# Build shared package first
COPY packages/shared/ ./packages/shared/
RUN npm run build --workspace=@notipo/shared

# Generate Prisma client
COPY apps/api/prisma.config.ts ./apps/api/
COPY apps/api/prisma ./apps/api/prisma
RUN npm run generate --workspace=@notipo/api

# Build API
COPY apps/api/tsconfig*.json ./apps/api/
COPY apps/api/src ./apps/api/src
RUN npm run build --workspace=@notipo/api

FROM base AS production
COPY package.json package-lock.json ./
COPY apps/api/package.json ./apps/api/
COPY packages/shared/package.json ./packages/shared/
RUN npm ci --omit=dev

# Copy built artifacts
COPY --from=builder /app/packages/shared/dist ./packages/shared/dist
COPY --from=builder /app/apps/api/dist ./apps/api/dist
COPY --from=builder /app/apps/api/node_modules/@prisma/client ./apps/api/node_modules/@prisma/client
COPY --from=builder /app/apps/api/node_modules/.prisma ./apps/api/node_modules/.prisma

# Copy runtime assets
COPY apps/api/public ./apps/api/public
COPY apps/api/prisma ./apps/api/prisma
COPY apps/api/prisma.config.ts ./apps/api/

WORKDIR /app/apps/api
EXPOSE 3000
CMD ["node", "dist/index.js"]
