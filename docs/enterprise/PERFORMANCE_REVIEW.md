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
- **H-1 — Agregasi metrics tanpa limit/indeks optimal**: `getAIUsageSummary` mengambil SEMUA baris dalam range (`SELECT * ...`) lalu agregat di JS — pada data besar (bulan) = transfer besar + CPU. **Fix**: SQL aggregate (`SUM/COUNT/AVG` + `GROUP BY`) + pagination/index `idx_ai_usage_created`.
- **H-2 — Tidak ada cache layer**: call AI berulang (gmail sync re-scan log yang sama), query API berulang tanpa ETag/cache. **Fix**: LRU response cache + `Cache-Control` untuk endpoint statis (categories).
- **H-3 — `checkAlerts` di request path**: tiap admin buka `/api/admin/metrics/alerts` → loop query windowed. **Fix**: scheduler + hasil cache 60s.

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
| Monitoring path | 3.5 (agregat full-scan, alert sinkron) |
| **Performance** | **6.0 / 10** |

---

## 7. Rekomendasi

1. **P1**: SQL aggregate untuk `getAIUsageSummary`/`getCostTrend`/`getFeatureHealth` + batas range (max 90 hari).
2. **P1**: LRU cache AI (hash prompt+model, TTL per feature) — hemat biaya + latency.
3. **P1**: Jalankan `test:e2e:perf` di CI sebagai job non-blocking + simpan trend report artifact.
4. **P2**: Delta sync Agent Search; `checkAlerts` scheduler + cache.
5. **P2**: Dynamic import recharts hanya di halaman laporan/admin.
6. **P3**: SSE backpressure (drain check) + max koneksi per user.
