# CashFlow 💸

Aplikasi manajemen keuangan pribadi **fintech-grade** dengan AI: pencatatan transaksi,
budget, laporan, sinkronisasi Gmail otomatis (scan struk/e-ticket), Receipt OCR,
Agent Search (Vertex AI Discovery Engine), dan Insight Generator (Gemini).

> **Arsitektur saat ini**: Better Auth (Google OAuth) + **Turso (libSQL)**.
> Supabase telah **di-decommission penuh** (2026-08-02) — server, frontend, dan
> project cloud dihapus. Dokumentasi lama di `docs/supabase-migration/` adalah arsip sejarah.

---

## 🧱 Tech Stack

| Lapisan | Teknologi |
|---|---|
| Frontend | React 18 · TypeScript · Vite 5 · TailwindCSS · Zustand · React Router |
| Backend | Express 5 · Node.js |
| Database | **Turso** (libSQL) via `@libsql/client` |
| Auth | **Better Auth** (Google OAuth, session cookie httpOnly) |
| Realtime | **SSE** custom (`server/lib/sse.js`) — pengganti Supabase Realtime |
| AI | Gemini (`@google/genai`) · Vertex AI Agent Search (Discovery Engine) · OCR |
| Storage | Google Cloud Storage (agent search docs) + multer in-memory (receipt) |
| Email | Gmail API (OAuth 2.0, scope `gmail.readonly`) |
| Monitoring | Custom in-house: `ai_usage_metrics`, `system_metrics`, `alert_rules` di Turso |
| Testing | Playwright E2E (17 test / 6 spec, cookie-login) |

---

## 📁 Struktur Proyek

```
cashflow/
├── src/                    # Frontend React (Vite, port 5180)
│   ├── features/           # Halaman per fitur (transactions, gmail, budgets, dll)
│   ├── services/           # Klien API + cache localStorage per-user
│   ├── store/              # Zustand stores (auth, app, session expiry)
│   ├── lib/                # SSE, parser, util, theme
│   └── config/             # env, constants, navigation, categoryIcons
├── server/                 # Backend Express (port 5181)
│   ├── index.js            # Entry point + semua route
│   ├── lib/                # auth.js (Better Auth), sse.js, turso.js
│   ├── middleware/         # authMiddleware (req.user dari session cookie)
│   ├── routes/             # Route modules per domain
│   ├── services/           # agentSearchService, metricsService, dll
│   └── .env.example        # Template env server (salin ke server/.env)
├── e2e/                    # Playwright E2E (spec + helpers)
│   └── helpers/            # mintSession, authContext, pagination, errors, fixtures
├── docs/                   # Dokumentasi audit, E2E, review, arsitektur
├── turso-schema.sql        # Skema database Turso
└── supabase/               # ARSIP migrasi lama (Supabase decommissioned — jangan dipakai)
```

---

## 🚀 Setup Lokal

### Prasyarat
- Node.js ≥ 18
- Akun [Turso](https://turso.tech) (database libSQL)
- Google Cloud project dengan **Gmail API** + OAuth Client (untuk login & sync Gmail)
- Gemini API key ([aistudio.google.com](https://aistudio.google.com/apikey))

### 1. Install dependencies

```bash
npm install
cd server && npm install && cd ..
```

### 2. Siapkan env

**Frontend** — salin `.env.example` → `.env.local` (root):
```bash
cp .env.example .env.local
```

**Backend** — salin template server:
```bash
cp server/.env.example server/.env
# lalu isi: TURSO_DATABASE_URL, TURSO_AUTH_TOKEN, GEMINI_API_KEY,
#           GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET, dst.
```

> ⚠️ **Jangan commit** `server/.env`, `.env.local`, atau service-account JSON
> (sudah di-`.gitignore`).

### 3. Siapkan database Turso

```bash
# Buat database di Turso (atau pakai yang sudah ada), lalu set env:
#   TURSO_DATABASE_URL=libsql://<db>.turso.io
#   TURSO_AUTH_TOKEN=<token>
# Jalankan skema:
turso db shell <db> < turso-schema.sql
```

### 4. Jalankan dev server

```bash
npm run dev:all        # Frontend (5180) + Backend (5181) sekaligus
# atau terpisah:
npm run dev            # Frontend saja → http://localhost:5180
npm run dev:server     # Backend saja  → http://localhost:5181
```

Buka **http://localhost:5180** → login via Google → mulai mencatat transaksi.

---

## 🧪 Testing E2E (Playwright)

Suite E2E memakai **cookie-login** (sesi Better Auth di-mint langsung ke Turso —
tanpa Google OAuth manual). Web server otomatis di-start oleh Playwright config.

```bash
npm run test:e2e                     # Semua spec (17 test / 6 spec)
npm run test:e2e:gmail               # Gmail Sync
npm run test:e2e:transactions        # Transactions
npm run test:e2e:dashboard           # Dashboard
npm run test:e2e:core-pages          # Smoke Budgets/Reports/Notifications
npm run test:e2e:agent-search        # Auth gate /api/agent-search/*
npm run test:e2e:admin               # Auth gate /api/admin/metrics/*
npm run test:e2e:typecheck           # Typecheck kode E2E saja
```

### Quality gates

```bash
npm run typecheck        # tsc --noEmit (frontend)
npm run lint             # alias tsc --noEmit
npm run build            # typecheck + vite build
npx tsc -p tsconfig.e2e.json --noEmit   # typecheck E2E
npm run test:e2e         # jalankan 3× berurutan → wajib 0 flaky
```

---

## 🔐 Arsitektur Auth (Better Auth + Turso)

- **Login**: Google OAuth via Better Auth (`server/lib/auth.js`) → session disimpan
  di tabel `session` (Turso) → cookie `better-auth.session_token` (httpOnly, sameSite Lax).
- **Guard server**: `server/middleware/authMiddleware.js` memvalidasi cookie →
  `req.user` tersedia di semua route. Error DB `getSession` → retry sekali + 500 jujur
  (bukan 401 palsu).
- **Guard frontend**: `AuthGuard` redirect ke `/login` bila tidak terautentikasi.
- **Admin gate**: `resolveAdmin` — email di `ADMIN_EMAILS` (env) → 6 endpoint `/api/admin/metrics/*`.
- **Session expiry**: deteksi terpusat → `SessionExpiredDialog` countdown 5s → auto-logout.
- **Hardening produksi** (wajib): set `BETTER_AUTH_SECRET` kuat (server **fail-fast**
  saat boot bila masih fallback dev di `NODE_ENV=production`); `useSecureCookies` otomatis
  `true` di produksi; perluas `BETTER_AUTH_TRUSTED_ORIGINS` bila domain produksi.

```
┌──────────────┐   HTTPS    ┌───────────────────────────────────┐
│  React SPA   │ ─────────► │  Express 5 API (server/index.js)   │
│  (Vite 5180) │            │  ├ /api/auth/* → Better Auth        │
└──────┬───────┘            │  ├ authMiddleware → req.user         │
       │ SSE (EventSource)  │  └ /api/* routes → ownership user    │
       └──────────────────► └───────┬──────────────┬──────────────┘
                                    │              │
                         ┌──────────▼───┐   ┌──────▼────────────┐
                         │ Turso (libSQL)│   │ Google Cloud      │
                         │ 22 tabel      │   │ · Gemini AI       │
                         │ (bisnis+gmail │   │ · Vertex Agent    │
                         │  +monitoring) │   │ · GCS · Gmail API │
                         └──────────────┘   └───────────────────┘
```

---

## 📊 Monitoring Admin

- Halaman: `/admin/monitoring` (login sebagai admin — email di `ADMIN_EMAILS`).
- Data: `ai_usage_metrics`, `system_metrics`, `alert_rules` (Turso) via `metricsService.js`.
- Endpoint: `/api/admin/metrics/{summary,ai-usage,system,feature-health,feature/:f/calls,alerts}`.
- Guard E2E: `e2e/admin-metrics-auth.spec.ts` (401 tanpa cookie / 403 non-admin / 200 admin).

---

## 🤝 Kontribusi

1. Ikuti pola E2E yang ada (`e2e/` + helpers) untuk fitur baru.
2. Jangan commit secret (`.env*`, service-account JSON, `*.db`).
3. Jalankan quality gates + full E2E 3× (0 flaky) sebelum merge.
4. Dokumen audit: `docs/audit/` (compliance matrix, audit report, gap analysis).
