# Cost Monitoring — AI Cost & Usage Dashboard

> **Status:** Implemented (Sprint 2) · **Owner:** Backend / Admin Monitoring
> **Last Updated:** 2026-08-05 · **Related:** [ADR-004 AI Pipeline](../adr/ADR-004-ai-pipeline.md), [ADR-005 Monitoring](../adr/ADR-005-monitoring.md), `server/config/metricsConfig.js`

## Ringkasan

Dashboard Cost Monitoring di `/admin/monitoring` memberikan observability biaya &
pemakaian AI per fitur — **tokens, requests, latency, cache-hit, dan biaya
estimasi** — dengan rentang waktu **harian (tile Hari Ini) / mingguan (7 hari) /
bulanan (30 hari) / kuartalan (90 hari)**. Data bersumber dari dua tabel yang
sudah ada: `ai_usage_metrics` dan `system_metrics` — **tanpa tabel baru**.

## Sumber Data

| Tabel | Dipakai untuk | Dicatat oleh |
|---|---|---|
| `ai_usage_metrics` | token (prompt/completion/total), biaya estimasi (USD+IDR), latency (`execution_time_ms`), status, error, per-call history | `recordAIUsage()` di `server/lib/vertexContext.js` (success & failure path `runVertexPipeline`) |
| `system_metrics` | cache-hit (`ai_cache_hit` / `ai_cache_miss`, **dengan kolom `feature` terisi**), engagement AI Search | `recordSystemMetric()` di `vertexContext.js` (cache lookup) |

> **Catatan:** pada cache **hit**, `recordAIUsage` TIDAK dipanggil (tidak ada token
> terpakai) — biaya dashboard hanya mencerminkan panggilan Vertex yang riil. Hit
> terlihat lewat metrik cache (per fitur + global LRU).

## Biaya = Estimasi, Bukan Billing

Pricing di `server/config/metricsConfig.js` (`AI_PRICING`) adalah **estimasi**
per juta token (gemini_flash input 0.075 / output 0.30 USD; `USD_TO_IDR` default
16000) — mudah disesuaikan, bukan tagihan Google Cloud yang aktual.

## Endpoint API (admin-only)

### `GET /api/admin/metrics/ai-usage?from&to&feature`
Response (Sprint 2 — `cacheByFeature` + `trendByFeature` ditambahkan, additive):

```jsonc
{
  "ok": true,
  "summary": {
    "costIdr": 0, "costUsd": 0, "tokens": 0, "calls": 0, "avgTimeMs": 0,
    "features": { "gmail_sync": { "costIdr": 0, "costUsd": 0, "tokens": 0,
      "calls": 0, "avgTimeMs": 0, "successRate": 1 } }
  },
  "trend": [{ "date": "2026-08-01", "costIdr": 0, "tokens": 0, "calls": 0 }],
  "trendByFeature": [{ "date": "2026-08-01", "feature": "gmail_sync",
    "costIdr": 0, "tokens": 0, "calls": 0 }],
  "cacheByFeature": [{ "feature": "gmail_sync", "hits": 10, "misses": 5, "hitRate": 0.667 }]
}
```

- `feature` query (whitelist `FEATURES`) memfilter `summary` **dan** `trend` —
  dasar grafik Tren Biaya fitur tunggal.
- `summary.features.*.avgTimeMs` — **latency rata-rata per fitur** (Sprint 2;
  sebelumnya hanya ada di agregat keseluruhan).
- `trendByFeature` — cost trend **per fitur** (satu baris per hari+fitur, SQL
  `GROUP BY day, feature`) untuk line chart multi-seri; frontend mem-pivot via
  `src/utils/costTrendPivot.ts` (murni, di-unit-test).
- `cacheByFeature` — cache-hit per fitur dari `system_metrics` (`hitRate` = 1.0
  bila belum ada aktivitas cache = sehat). Dikelompokkan via fungsi murni
  `aggregateCacheHitByFeature` (di-unit-test, tanpa DB).

### Pendukung (sudah ada)
- `GET /api/admin/metrics/summary` — tile `today` / `week` / `month` + `features`.
- `GET /api/admin/metrics/feature-health?from&to` — success rate / failure / avg.
- `GET /api/admin/metrics/feature/:feature/calls` — riwayat per-call (halaman detail).
- `GET /api/admin/metrics/cache` — statistik LRU global + `hitRate`.

## Frontend (MonitoringPage)

- **Period selector** `7 Hari / 30 Hari / 90 Hari` — memuati ulang
  `ai-usage`, `feature-health`, dan `agent-search-engagement` dengan rentang
  `from`/`to` dinamis (tile Hari Ini tetap dari `/summary`).
- **Tabel "Cost per Fitur"** — kolom: Fitur (calls · token) · **Latency** ·
  **Cache Hit** · Biaya · Sukses.
- **Tren Biaya** — line chart harian dengan **filter fitur** (dropdown):
  "Semua Fitur" = **line chart multi-seri** satu garis per fitur
  (`/trendByFeature` → pivot `pivotTrendByFeature`); pilih satu fitur = garis
  tunggal dari `/trend?feature=...` (backed `getCostTrend` + param `feature`).
- **AI Response Cache** — hit rate global LRU (`/cache`).
- `FEATURE_LABELS` mencakup 6 fitur: gmail_sync, agent_search, ocr_receipt,
  insight_generator, fraud_detection, financial_advisor.

## Guard & Contract

- Unit test `tests/unit/cacheHitByFeature.test.ts` — agregasi murni (grouping,
  divide-by-zero, urutan, fallback `unknown`).
- Unit test `tests/unit/costTrendPivot.test.ts` — pivot multi-seri (grouping,
  penjumlahan, zero-fill hari kosong, urutan tanggal, `activeTrendFeatures`).
- Contract test `adminAiUsageContract` (`e2e/contract/contract-check.spec.ts`) —
  drift `trendByFeature` / `cacheByFeature` / `summary` memblokir merge otomatis.
- Per-feature `avgTimeMs` bersifat **additive** — kontrak `/summary`
  (today/week/month) tidak berubah.

## Alur Implementasi

```mermaid
flowchart LR
  A[vertexContext.js] -->|recordAIUsage| B[(ai_usage_metrics)]
  A -->|recordSystemMetric ai_cache_hit/_miss| C[(system_metrics)]
  B --> D[metricsService.getAIUsageSummary / getCostTrend / getCostTrendByFeature]
  C --> E[metricsService.getCacheHitByFeature]
  D --> F[GET /api/admin/metrics/ai-usage]
  E --> F
  F --> G[MonitoringPage — Cost per Fitur + Tren (filter fitur & multi-seri)]
```
