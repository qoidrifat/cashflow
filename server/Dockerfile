# CashFlow API Server — production image (P2 Production Readiness)
# Topologi deploy: frontend statis via GitHub Pages + API server ini (container /
# VM / Cloud Run). Gunakan env production via environment atau secrets — jangan
# commit server/.env ke image.
FROM node:24-alpine

ENV NODE_ENV=production

WORKDIR /app

# Install deps dulu (lapisan cache: package.json jarang berubah)
COPY --chown=node:node server/package.json server/package-lock.json ./
RUN npm ci --omit=dev

# Source server (index.js membaca server/.env — mount/volume bila perlu)
COPY --chown=node:node server/ ./

# Least privilege: jalankan sebagai user node (bukan root)
USER node

EXPOSE 5181

# Readiness probe: 200 hanya bila Turso terhubung (lihat /api/ready).
# Cloud Run: hapus HEALTHCHECK, pakai startupProbe ke /api/ready sebagai gantinya.
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD node -e "fetch('http://localhost:5181/api/ready').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

# Graceful shutdown (SIGTERM ditangani server/index.js — drain SSE + Turso)
CMD ["node", "index.js"]
