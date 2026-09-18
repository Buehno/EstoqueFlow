# ─── build ──────────────────────────────────────────────────────────────────
FROM node:20-slim AS build
WORKDIR /app
RUN apt-get update -y && apt-get install -y --no-install-recommends openssl ca-certificates \
 && rm -rf /var/lib/apt/lists/*
COPY package*.json ./
COPY apps/api/package.json apps/api/
COPY apps/web/package.json apps/web/
COPY prisma ./prisma
RUN npm install --include=dev --no-audit --no-fund
COPY . .
RUN npx prisma generate && npm run build \
 && test -f apps/api/dist/server.js && test -f apps/web/dist/index.html

# ─── runtime ────────────────────────────────────────────────────────────────
FROM node:20-slim
WORKDIR /app
ENV NODE_ENV=production NPM_CONFIG_UPDATE_NOTIFIER=false
RUN apt-get update -y && apt-get install -y --no-install-recommends openssl ca-certificates \
 && rm -rf /var/lib/apt/lists/*
COPY --from=build /app ./
RUN chmod +x scripts/entrypoint.sh
EXPOSE 8080
CMD ["sh","scripts/entrypoint.sh"]
