FROM node:22-alpine AS base
RUN corepack enable && corepack prepare pnpm@9.15.9 --activate
WORKDIR /app

FROM base AS deps
COPY package.json pnpm-workspace.yaml ./
COPY apps/api/package.json apps/api/
COPY packages/shared/package.json packages/shared/
RUN pnpm install --filter @teep/api... --filter @teep/shared...

FROM deps AS build
COPY packages/shared packages/shared
COPY apps/api apps/api
RUN pnpm --filter @teep/shared build
RUN pnpm --filter @teep/api db:generate
RUN pnpm --filter @teep/api build

FROM base AS runner
WORKDIR /app
ENV NODE_ENV=production
# Chromium para PDF (Puppeteer) — Alpine
RUN apk add --no-cache \
    chromium \
    nss \
    freetype \
    harfbuzz \
    ca-certificates \
    ttf-freefont \
    font-noto
ENV PUPPETEER_EXECUTABLE_PATH=/usr/bin/chromium
ENV PUPPETEER_SKIP_CHROMIUM_DOWNLOAD=1
COPY --from=build /app /app
WORKDIR /app/apps/api
# SEED_ON_START=1 só no primeiro boot (admin/tipos). Em produção deixe 0 (F11).
CMD ["sh", "-c", "pnpm db:migrate && if [ \"${SEED_ON_START:-0}\" = \"1\" ]; then pnpm db:seed; fi && node dist/index.js"]
