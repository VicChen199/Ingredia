# Build from the repository root: docker build -f apps/web/Dockerfile .
# The web server and the migration runner use the same image.
FROM node:24-bookworm-slim AS base
RUN apt-get update && apt-get install -y --no-install-recommends openssl \
 && rm -rf /var/lib/apt/lists/*
ENV NEXT_TELEMETRY_DISABLED=1
WORKDIR /app

FROM base AS build
RUN corepack enable && corepack prepare pnpm@11.17.0 --activate

# Fetch before copying source so code changes reuse downloaded dependencies.
COPY pnpm-lock.yaml pnpm-workspace.yaml ./
RUN pnpm fetch
COPY . .
RUN pnpm install --frozen-lockfile --offline
RUN pnpm prisma:generate
RUN pnpm --dir apps/web build

# Keep the generated Prisma client and the migrator at their build paths.
FROM base AS runtime
ENV NODE_ENV=production PORT=3000 HOSTNAME=0.0.0.0
COPY --from=build --chown=node:node /app ./
USER node
EXPOSE 3000
WORKDIR /app/apps/web
# Migrations run separately with /app/apps/migrate/node_modules/.bin/tsx
# /app/apps/migrate/src/index.ts; starting a replica only serves the app.
CMD ["./node_modules/.bin/next", "start"]
