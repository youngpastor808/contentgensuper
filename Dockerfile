# ---- Build stage ----
FROM node:22-bookworm-slim AS builder
WORKDIR /app
ENV CI=true \
    DOCKER_BUILD=true

# Copy package files AND the scripts folder needed for postinstall
COPY package.json package-lock.json* ./
COPY scripts/ ./scripts/

# Now npm install can successfully run scripts/postinstall.js
RUN npm install

# Copy the rest of the application
COPY . .
RUN npm run build

# ---- Runtime stage ----
FROM node:22-bookworm-slim AS runtime
WORKDIR /app

RUN apt-get update && apt-get install -y --no-install-recommends \
    chromium \
    ffmpeg \
    fonts-liberation \
    fonts-noto-color-emoji \
    ca-certificates \
    && rm -rf /var/lib/apt/lists/*

ENV PUPPETEER_EXECUTABLE_PATH=/usr/bin/chromium \
    PUPPETEER_SKIP_DOWNLOAD=true \
    NODE_ENV=production \
    CI=true \
    DOCKER_BUILD=true \
    PORT=8080

COPY package.json package-lock.json* ./
COPY scripts/ ./scripts/
RUN npm install --omit=dev

COPY --from=builder /app/dist ./dist
COPY --from=builder /app/public ./public
COPY --from=builder /app/remotion ./remotion
# Ensure Firebase config is present for firebaseAdmin.ts
COPY firebase-applet-config.json* ./

EXPOSE 8080 3000
CMD ["node", "--max-http-header-size=65536", "dist/server.js"]
