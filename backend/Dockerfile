# Akipoly game server. Build + run: docker compose up -d --build
# Node is pinned to an exact version; bump both FROM lines on purpose.

# ---- build: compile TypeScript ------------------------------------------
FROM node:22.23.1-alpine AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY tsconfig.json ./
COPY src ./src
COPY migrations ./migrations
COPY scripts ./scripts
RUN npm run build

# ---- runtime: production deps + compiled output only --------------------
FROM node:22.23.1-alpine
ENV NODE_ENV=production \
    PORT=8081
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev && npm cache clean --force
COPY --from=build /app/dist ./dist
COPY migrations ./migrations

USER node
EXPOSE 8081

HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||8081)+'/ready').then(r=>process.exit(r.ok?0:1),()=>process.exit(1))"

# Apply pending migrations (already-applied ones are skipped), then serve.
CMD ["sh", "-c", "node dist/db/migrate.js && exec node --enable-source-maps dist/index.js"]
