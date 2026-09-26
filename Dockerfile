# ==============================================================================
# Dockerfile untuk Next.js Web Server (Absensi SPPG / Manajemen Sekolah)
# Multi-stage build menggunakan Bun untuk performa cepat dan ukuran image kecil
# ==============================================================================

# Stage 1: Install Dependencies
FROM oven/bun:1.2-alpine AS deps
WORKDIR /app

COPY package.json bun.lock ./
RUN bun install --frozen-lockfile

# Stage 2: Build Application
FROM oven/bun:1.2-alpine AS builder
WORKDIR /app

COPY --from=deps /app/node_modules ./node_modules
COPY . .

# Set environment agar Next.js mem-build untuk target web (bukan export desktop)
ENV NODE_ENV=production
ENV SPPG_BUILD_TARGET=web
ENV NEXT_PUBLIC_SPPG_RUNTIME=web
ENV NEXT_TELEMETRY_DISABLED=1

RUN bun run build:web

# Stage 3: Production Runner
FROM oven/bun:1.2-alpine AS runner
WORKDIR /app

ENV NODE_ENV=production
ENV PORT=3000
ENV HOSTNAME="0.0.0.0"
ENV SPPG_BUILD_TARGET=web
ENV NEXT_PUBLIC_SPPG_RUNTIME=web
ENV NEXT_TELEMETRY_DISABLED=1

# Salin aset dan build output
COPY --from=builder /app/public ./public
COPY --from=builder /app/.next ./.next
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/package.json ./package.json
COPY --from=builder /app/next.config.ts ./next.config.ts

EXPOSE 3000

CMD ["bun", "x", "next", "start", "-p", "3000", "-H", "0.0.0.0"]
