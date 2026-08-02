# CashFlow — Monitoring Modernization Audit

> Audit READ-ONLY · 2 Agustus 2026 · Evidence-based · Sumber: `server/services/metricsService.js` (526 L), `server/config/metricsConfig.js`, `server/routes/adminMetricsRoutes.js`, `src/pages/admin/MonitoringPage.tsx`, `turso-schema.sql`, `src/services/adminMetrics.ts`.

---

## 1. Arsitektur Monitoring Saat Ini (CF-053, In-house)

```
Route AI (generateVertexContent, agentSearch, gmail sync)
   │  recordAIUsage / recordSystemMetric (NON-BLOCKING, fire-and-forget)
   ▼
Turso:
  ├─ ai_usage_metrics  (user_id, feature, provider, model, prompt/completion tokens,
  │                     estimated_cost_usd/idr, execution_time_ms, status, error_message, metadata)
  ├─ system_metrics    (metric_name, metric_value, feature, user_id, metadata)
  └─ alert_rules       (name, metric_name, condition gt/lt/eq, threshold, window_minutes, is_active, last_triggered_at)

Admin Dashboard (/admin/monitoring) ← /api/admin/metrics/* (resolveAdmin: ADMIN_EMAILS)
```

**Endpoint admin (6):** `summary`, `ai-usage` (summary+trend), `system`, `feature-health`, `feature/:f/calls` (paginated), `alerts`. Guard: cookie Better Auth + `ADMIN_EMAILS` (401 tanpa login, 403 non-admin — terverifikasi E2E `admin-metrics-auth.spec.ts`).

---

## 2. Cakupan Metrics — Matriks

| Metrik | Ada? | Sumber | Catatan |
|---|---|---|---|
| Feature metrics (4 fitur) | ✅ | `ai_usage_metrics.feature` (gmail_sync, agent_search, ocr_receipt, insight_generator) | FEATURES di metricsConfig |
| AI cost (USD/IDR) | ✅ | `estimated_cost_usd/idr` dari `AI_PRICING` + `USD_TO_IDR` | Estimasi, bukan billing |
| Token usage | ✅ | `prompt_tokens`, `completion_tokens`, `total_tokens` (generated) | Chokepoint tunggal |
| Latency per call | ✅ | `execution_time_ms` | avgTimeMs + p95 via items |
| Response time agregat | ⚠️ | avg saja (tanpa histogram p50/p95/p99 agregat) | items memungkinkan per-call |
| Queue time | ❌ | — | tidak ada queue (sync sync) |
| Per-user usage | ⚠️ | `user_id` disimpan + index `idx_ai_usage_user_created` | **tidak ada endpoint per-user** (privasi — by design) |
| Per-feature usage | ✅ | `features` di summary + feature-health | |
| Slow requests | ⚠️ | `execution_time_ms` bisa difilter manual | tidak ada threshold/track otomatis |
| Memory/CPU | ❌ | — | butuh APM/agent |
| Error rate | ✅ | status → successRate/failureCount; `computeRate` | error/timeout/rate_limited |
| 429 (rate limit) | ✅ | status `rate_limited` | hanya dari Vertex 429 |
| 5xx/4xx HTTP | ❌ | — | tidak ada middleware metrics HTTP |
| Retry count | ❌ | — | fallback model tercatat sebagai error? (2nd model success = success) |
| Prompt size | ⚠️ | bisa via metadata (sanitized) | tidak direkam default |
| Response size | ❌ | — | |
| Cache hit rate | ❌ | — | tidak ada cache layer |
| Realtime (SSE) health | ❌ | — | tidak ada metrik koneksi SSE (count/uptime/disconnect) |
| Gmail sync health | ✅ | system_metrics `gmail_sync_failed` + alert | |

---

## 3. Kekuatan

- **Non-blocking recording**: `.catch(() => {})` — metrics tidak pernah merusak fitur (prinsip utama di header service).
- **Privacy-first**: `sanitizeMetadata` (drop key sensitif + nested object + cap 200 char), `sanitizeErrorMessage` (redact JWT/key/path, cap 400), "Never logs PII/raw email body/base64/financial values".
- **Raw SQL Turso** dengan prepared statements (migrasi dari Supabase query builder yang tidak kompatibel).
- **Alert rules**: 5 seed default (ai_cost_daily, gmail_sync_failures, agent_search_error_rate, ocr_failure_rate, cache_hit_rate — deteksi degradasi LRU cache: hit rate < 50% dalam 60 menit), evaluasi windowed di `checkAlerts()`, idempotent seed.
- **Pagination** untuk riwayat per-feature (`getFeatureCalls`, limit pageSize ≤100).
- **E2E guard**: contract test admin summary + auth gate spec.

---

## 4. Gap & Rekomendasi

| # | Gap | Rekomendasi | Prioritas |
|---|---|---|---|
| 1 | **Tidak ada channel alerting** — `checkAlerts` hanya dirender di dashboard; tidak kirim notifikasi | Email/webhook (Gmail API atau webhook generic) bila alert triggered; simpan last_notified | **P1** |
| 2 | Tidak ada HTTP metrics (status code, latency per route) | Middleware metrics (res.on('finish') → system_metrics) | **P1** |
| 3 | Tidak ada CPU/memory/disk | `process.memoryUsage()`/`os.loadavg()` periodic → system_metrics; atau APM | **P2** |
| 4 | Tidak ada SLO/SLI/SLA formal | Definisikan SLI: availability (/api/health 99.9%), latency p95 (budget perf ada: 1200ms), error rate; SLO target; SLA internal | **P2** |
| 5 | Tidak ada distributed tracing | request-id global + trace span untuk AI call (parentId di metadata) | **P2** |
| 6 | Per-user usage tidak terlihat admin (by design) | Opsional: agregat anonim (hash userId) untuk abuse detection | **P3** |
| 7 | Alert evaluasi sinkron di request path | Scheduler terpisah (setInterval/Cloud Scheduler) untuk `checkAlerts` berkala | **P2** |
| 8 | SSE health tidak terpantau | System metric koneksi aktif per user (count/timestamp) | **P3** |
| 9 | Cost Agent Search = 0 (`perQueryUsd: 0`) | Set per kontrak riil / catat per query | **P2** |

---

## 5. SLO/SLI/SLA — Proposal (belum ada, perlu diadopsi)

| SLI | Definisi | Target (SLO) |
|---|---|---|
| Availability | `/api/health` 200 (success/attempts, window 30d) | 99.9% |
| AI latency | p95 `execution_time_ms` (ai_usage_metrics) | < 5s (OCR 60s timeout) |
| API latency | p95 budget perf (1200ms dev) | < 1200ms |
| AI error rate | failures/calls per feature | < 5% (alert: agent_search 10%, ocr 20%) |
| Freshness sync | max staleness gmail_sync | < 24h |

---

## 6. Skor Monitoring

| Dimensi | Skor /10 | Keterangan |
|---|---|---|
| Feature & AI metrics | 8.0 | Lengkap + cost + latency + status, non-blocking, privacy-first |
| Alert rules | 6.0 | Ada evaluasi + threshold, tapi tanpa channel pengiriman |
| Dashboard | 7.5 | MonitoringPage admin lengkap (summary/trend/feature-health/calls/alerts) |
| HTTP/infra metrics | 2.0 | Tidak ada 4xx/5xx, CPU, memory |
| Tracing | 1.5 | RequestId parsial (AI routes saja) |
| SLO/SLI | 1.0 | Belum didefinisikan |
| **Monitoring** | **4.5 / 10** | Fondasi metrics kuat; channel alert + infra + SLO belum ada |

---

## 7. Prioritas Eksekusi

1. **P1 — Alert channel**: kirim notifikasi (email via Gmail API atau webhook) saat `checkAlerts()` menemukan triggered rule; tambah `last_notified_at`.
2. **P1 — HTTP metrics middleware**: status code + duration per route → `system_metrics` (mis. `http_4xx_total`, `http_5xx_total`, `http_p95_ms`).
3. **P2 — Health dashboard**: buat halaman ringkas `/admin/monitoring` dengan status SLO (availability, latency p95, error rate) + SSE health.
4. **P2 — Scheduler alert**: jalankan `checkAlerts` berkala (setInterval 60s di server) — bukan hanya saat admin membuka halaman.
5. **P2 — SLO/SLI dokumen**: terapkan tabel di §5 ke dashboard.
