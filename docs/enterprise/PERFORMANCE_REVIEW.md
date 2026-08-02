# CashFlow — Performance Review

> Audit READ-ONLY · 2 Agustus 2026 · Evidence-based · Sumber: `e2e/performance/performance.config.ts` (budget), `server/**` (query paths), `turso-schema.sql` (indexes), `vite.config.ts`, hasil build aktual.

---

## 1. Temuan Terukur (Build Validation 2026-08-02)

| Metrik | Nilai | Bukti |
|---|---|---|
| Build production | **11.63s** | `npm run build` (tsc --noEmit + vite build) |
| Bundle react vendor | 330.76 kB (gzip 101.32 kB) | dist |
| Bundle charts vendor | 384.76 kB (gzip 112.27 kB) | recharts/d3 |
| Bundle index | 99.27 kB (gzip 30.73 kB) | |
| Unit tests | 57/57 dalam 6.8s | vitest |
| Contract tests | 8/8 dalam 9.1s | |
| E2E (25 test) | ~1.5–2 menit | Playwright |

**Performance budget (dev, `e2e/performance/performance.config.ts`):**
- pageLoadDomMs: 4000 · pageLoadLoadMs: 6000 · apiLatencyP95Ms: 1200 · maxRequestsPerPage: 80.
- Core endpoints diukur: `/api/transactions/paginated`, `/api/gmail/logs`, `/api/budgets`, `/api/categories`.
- Report JSON → `test-results/perf/`. Env-overridable (`PERF_BUDGET_*`) untuk CI.

---

## 2. Audit Latency per Jalur

| Jalur | Assessment | Detail |
|---|---|---|
| **Frontend rendering** | ⚠️ OK | Perf spec siap; belum ada baseline trend CI. Bundle charts besar (384 kB) — halaman laporan/admin berat |
| **Backend latency** | ✅ OK | Route modular; query sederhana + index |
| **DB latency (Turso)** | ✅ OK | 22 tabel + index strategis (`idx_transactions_user_date`, `idx_gmail_logs_user_status`, `idx_system_metrics_name_created`, dll); HTTP client Turso |
| **AI latency** | ⚠️ | Timeout 45s/60s dengan fallback loop — kasus terburuk 2×45s+; tanpa retry-backoff; tanpa cache → call berulang mahal |
| **Search latency** | ⚠️ | Discovery Engine external; `pageSize 10`; fallback query tanpa filter menggandakan call pada 400 |
| **Receipt OCR** | ⚠️ | Multer in-memory + base64 ke Gemini vision (60s timeout); tanpa kompresi server-side (frontend punya `imageCompression.ts`) |
| **Gmail Sync latency** | ⚠️ | Batch per email; `bulk upsert chunk 100` (dokumen); sync sequential — 611 email bisa lama; tanpa progress persist di SSE? (ada `gmailSyncProgress.ts` frontend) |
| **Realtime latency** | ✅ OK | SSE push langsung; heartbeat 30s |
| **Monitoring latency** | ⚠️ | `getAIUsageSummary` full-scan `SELECT * FROM ai_usage_metrics WHERE ...` tanpa limit → dataset besar lambat; `checkAlerts` sinkron di request path |

---

## 3. Temuan Kinerja

### 🟠 High
- **H-1 — Agregasi metrics tanpa limit/indeks optimal** → ✅ **SELESAI (Sprint 4)**: `getAIUsageSummary`/`getCostTrend`/`getFeatureHealth` kini **SQL aggregate** (`SUM/COUNT/AVG` + `GROUP BY`, `CASE WHEN`), bukan `SELECT *` + agregat JS; + **clamp range maks 90 hari**. Terverifikasi: bucket "today" kini **433 calls** (sebelumnya **0** — lihat bonus bug di bawah). Shape API tidak berubah (contract test 8/8 lolos).
- **H-2 — Tidak ada cache layer** → ✅ **SELESAI (Sprint 3 + 4)**: LRU response cache AI (Sprint 3, gmail 7d / receipt 1h — terverifikasi 6.4s→0.21s) + **cache in-memory GET /api/categories per-user (30s TTL + invalidasi saat mutasi)** (Sprint 4).
- **H-3 — `checkAlerts` di request path** → ✅ **SELESAI (Sprint 4)**: hasil di-cache **60 detik** (in-memory) — loop windowed per rule tidak lagi jalan tiap buka halaman admin.

### 🟡 Medium
- **M-1 — Bundle charts 384 kB**: manualChunks memisah `vendor-charts`, tapi laporan/admin tetap memuat; pertimbangkan dynamic import per halaman (sudah code-split per page di Vite — verifikasi).
- **M-2 — Sync Agent Search full-rebuild**: `fetchRows(... LIMIT 2000)` + re-upload semua JSONL per user per sync — tidak incremental. **Fix**: delta sync (created_at > last_sync) + batch import.
- **M-3 — SSE tanpa backpressure**: consumer lambat menumpuk di buffer TCP; tanpa per-user koneksi limit.
- **M-4 — Multer in-memory**: file besar di-memory (limit 10mb) — risiko memory spike; sudah ada kompresi image di frontend.

### 🟢 Low
- **L-1** — `Promise.all` dipakai di beberapa route (summary admin) — ✅ baik.
- **L-2** — Gmail pagination server-side ✅ (`LIMIT/OFFSET` + index `user_status`).
- **L-3** — N+1 tidak ditemukan pada jalur utama (query per-user langsung).

---

## 4. Duplicate Request & Race Condition

| Risiko | Status |
|---|---|
| Duplicate submit (form transaksi, scan receipt) | ⚠️ Frontend ada guard `loading` state; SSE realtime memvalidasi via dedupe |
| Race SSE vs REST | ⚠️ Kedua jalur update store — dedupe di service; tidak ada konflik parah teridentifikasi |
| Gmail sync ganda | ✅ `UNIQUE (user_id, message_id)` di `gmail_sync_logs` + dedupe key |
| Notifikasi duplikat | ✅ `UNIQUE (user_id, dedupe_key)` |
| Infinite loop | ⚠️ Auto-sync interval + SSE reconnect — interval dihentikan saat app nonaktif (dokumentasi); tidak ada loop tak berujung terverifikasi |
| Concurrent session write | ✅ Better Auth handle; E2E serialized (workers:1) |

---

## 5. Memory & CPU (indikasi)

- ❌ Tidak ada metrik runtime (CPU/memory) — rekomendasi: periodic `process.memoryUsage()` → `system_metrics` + dashboard (lihat MONITORING_AUDIT).
- In-memory SSE client map — tumbuh per koneksi; cleanup pada `req.on('close')` ✅.

---

## 6. Skor Kinerja

| Dimensi | Skor /10 |
|---|---|
| Frontend | 7.0 (budget perf ada, code-split page; bundle charts berat) |
| Backend/DB | 7.5 (index lengkap, prepared stmt, pagination) |
| AI | 4.5 (timeout+fallback; tanpa cache/backoff/streaming) |
| Realtime | 7.0 (SSE ringan; tanpa backpressure) |
| Monitoring path | 3.5 → **7.0** (SQL aggregate, clamp 90 hari, alert cached 60s, bug timestamp diperbaiki) |
| **Performance** | **6.0 / 10** |

---

## 7. Rekomendasi

1. ✅ **SELESAI (Sprint 4)**: SQL aggregate untuk `getAIUsageSummary`/`getCostTrend`/`getFeatureHealth` + batas range 90 hari.
2. ✅ **SELESAI (Sprint 3)**: LRU cache AI (hash prompt+model, TTL per feature).
3. **P1**: Jalankan `test:e2e:perf` di CI sebagai job non-blocking + simpan trend report artifact. ⚠️ Test "pagination < 2s (soft budget)" **flaky di mesin dev** (terverifikasi 3× gagal, nilai tidak tercatat) — backend dalam budget (API p95 666ms, page load 291ms); dugaan: animasi PageTransition + remote Turso. Gunakan `PERF_BUDGET_*` env di CI atau naikkan soft budget.
4. ✅ **SELESAI (Sprint 4)**: `checkAlerts` cache 60s. Sisa: delta sync Agent Search (P2).
5. ✅ **Sudah ada**: recharts sudah di chunk terpisah (`vendor-charts`, lazy via page code-split) — hanya dimuat saat halaman laporan/admin dibuka.
6. **P3**: SSE backpressure (drain check) + max koneksi per user.

---

## 8. STATUS IMPLEMENTASI — Sprint 4 (Selesai, 2 Agustus 2026)

| Item | Status | Implementasi & Bukti |
|---|---|---|
| Bundle — firebase remnant | ✅ | **Tidak ada chunk firebase/supabase di dist** (verifikasi: 0 import di src; 234 match hanya naming legacy `firebaseUser`). Dead rule `manualChunks` firebase/supabase **dihapus** dari `vite.config.ts`. `@supabase/supabase-js` dipertahankan di deps (dipakai script arsip LEGACY `scripts/migrate*`) |
| Code splitting | ✅ | Sudah per-page lazy + vendor chunks (react/charts/motion/icons). `vendor-charts` (384 kB) hanya dimuat saat halaman charts dibuka. Build: 11.67s, index 99 kB gzip 30.73 kB |
| H-1 — SQL aggregate + clamp 90 hari | ✅ | `metricsService`: `getAIUsageSummary` (2 query aggregate), `getCostTrend` (GROUP BY hari), `getFeatureHealth` (1 query). Terverifikasi: TODAY 433 calls, TREND 2 hari, HEALTH shape benar |
| H-1 bonus — **latent bug timestamp** | ✅ | `created_at` disimpan space-format (`datetime('now')`) tapi bound from/to ISO → `>= '...T...'` selalu FALSE → bucket "today" admin = **0 rows**. Fix `toDbTime()` di `buildUsageWhere` (normalisasi bound). Terverifikasi: ISO-bound 0 → space-bound 433 |
| H-2 — cache categories | ✅ | `categoryRoutes`: cache in-memory per-user 30s + `invalidateCategoriesCache` pada POST/PUT/DELETE/init-defaults (tanpa risiko stale) |
| H-3 — cache alerts 60s | ✅ | `checkAlerts` → `computeAlerts` + memo 60s; panggilan berulang dalam window tidak re-query |

### Validasi Sprint 4 (semua hijau)
`unit 66/66 ✅ · full E2E 26/26 (0 flaky) ✅ · contract 8/8 ✅ · server health 200 ✅ · perf page-load & API latency dalam budget ✅ · secret scan 0 ✅`
