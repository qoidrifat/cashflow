# Event Registry — Payload Schema (Single Source of Truth)

> **P10.2f** · Registri payload/metadata untuk seluruh event telemetry CashFlow.
> Menutup gap audit P10.1 §3 (kriteria 3: *payload schema*) — setiap event punya
> skema metadata terdokumentasi: nama kolom, tipe, contoh, dan producer.
>
> **Aturan**: Bila menambah/mengubah event `recordSystemMetric` / `recordAIUsage`,
> WAJIB update tabel di bawah. Dokumen ini diverifikasi terhadap source code
> (2026-08-07) — bukan deskripsi aspiratif.

---

## 1. Tabel penyimpanan

### `system_metrics` (event counter / gauge)

| Kolom | Tipe | Keterangan |
|---|---|---|
| `id` | TEXT PK | UUID |
| `metric_name` | TEXT | Nama event (snake_case, prefix feature) |
| `metric_value` | REAL | 1 (counter) atau nilai (latency, count, dst) |
| `feature` | TEXT | Domain fitur (`http`, `conversation`, `agent_search`, …) |
| `user_id` | TEXT | user internal (Better Auth `user.id`) — **null untuk anonim** |
| `metadata` | TEXT (JSON) | Payload non-PII — di-sanitize oleh writer (§3) |
| `created_at` | TEXT | `datetime('now')` — **UTC space-format** `'YYYY-MM-DD HH:MM:SS'` |

Index: `(metric_name, created_at DESC)` · `(feature, created_at DESC)`.

### `ai_usage_metrics` (kualitas/biaya AI)

| Kolom | Tipe | Keterangan |
|---|---|---|
| `id` / `user_id` | TEXT | UUID / user internal (null bila anonim) |
| `feature` | TEXT | `gmail_sync` · `ocr_receipt` · `insight_generator` · `agent_search` · `fraud_detection` · `financial_advisor` · `conversation` |
| `provider` | TEXT | `gemini_flash` / `vertex_search` / `vertex_ai` / dst |
| `model` | TEXT | nama model (nullable) |
| `prompt_tokens` / `completion_tokens` | INTEGER | token usage (`total_tokens` = generated column) |
| `estimated_cost_usd` / `estimated_cost_idr` | REAL | estimasi biaya |
| `execution_time_ms` | INTEGER | durasi (di-clamp `> 0` saat agregasi) |
| `status` | TEXT | `success` · `error` · `timeout` · `rate_limited` |
| `error_message` | TEXT | kode error ter-classify (bukan stack — di-redaksi) |
| `metadata` | TEXT (JSON) | payload tambahan (retries, tab, resultCount, …) |
| `created_at` | TEXT | UTC space-format |

---

## 2. Aturan writer (sanity — berlaku untuk KEDUA tabel)

- **Non-blocking**: kegagalan insert ditelan (`recordSystemMetric` / `recordAIUsage` tidak pernah melempar ke caller).
- **Sanitasi `metadata`** (`sanitizeMetadata`, metricsService):
  - Kunci yang cocok regex `/(token|secret|key|jwt|authorization|credential|base64|image|body|raw|password|email)/i` → **dibuang**.
  - String > 200 char → dipotong ke 200.
  - **Nested object/array dibuang** (`typeof v === 'object'` → skip, anti PII
    tidak sengaja); hanya primitives (string/number/boolean/null) yang disimpan.
- **Timestamp**: selalu dari DB (`datetime('now')`, UTC) — klien tidak bisa memalsukan.
- **User-scoping**: `user_id` = id internal; tidak pernah email/token. Anonim → `null` (bukan id palsu).

---

## 3. Registri event — `system_metrics`

> `metric_value` default 1 (counter) kecuali dinyatakan lain. `metadata` = objek
> JSON yang disimpan di kolom `metadata` (setelah sanitasi §2).

### HTTP & aktivitas (producer: `server/middleware/observabilityMiddleware.js`)

| Event | metric_value | metadata | user_id | Contoh metadata |
|---|---|---|---|---|
| `http_2xx_total` · `http_3xx_total` · `http_4xx_total` · `http_5xx_total` | 1 | `{ route: string, method: string, requestId: string }` | bila auth | `{"route":"/api/ai-product/timeline","method":"GET","requestId":"req_..."}` |
| `http_latency_ms` | durasi ms | `{ route, method, requestId }` (sama) | bila auth | `{"route":"/api/transactions","method":"POST","requestId":"req_..."}` |
| `user_active` | 1 | `{ day: 'YYYY-MM-DD' }` (UTC) | **wajib** (anonim skip) | `{"day":"2026-08-07"}` |

Skip: SSE `/api/events` + semua `/health` (anti banjir polling). `user_active`
dedupe 1 baris/user/hari UTC (SELECT→INSERT, non-atomik → analitik pakai
`COUNT(DISTINCT user_id)`).

### AI cache (producer: `server/lib/vertexContext.js`)

| Event | metric_value | metadata | user_id | Contoh metadata |
|---|---|---|---|---|
| `ai_cache_hit` | 1 | `{ label, ...metricMeta }` | bila auth | `{"label":"gmail_sync:2026-08","kind":"exact"}` |
| `ai_cache_miss` | 1 | `{ label, ...metricMeta }` | bila auth | `{"label":"ocr_receipt:<hash>"}` |
| `ai_single_flight_join` | 1 | `{ label, ...metricMeta }` | bila auth | `{"label":"insight_generator:2026-08"}` |

`label` = kunci cache semantik (non-PII: feature + rentang/hash); `metricMeta`
= metadata konteks feature (primitives saja, kap 200 char).

### Fraud (producer: `server/services/fraudDetectionService.js`)

| Event | metric_value | metadata | user_id | Contoh metadata |
|---|---|---|---|---|
| `fraud_flag_count` | jumlah flag | `{ rules: string[], severity: string }` | wajib | `{"rules":["L2_ANOMALI_AMOUNT"],"severity":"high"}` |

### Memory usage (producer: `server/routes/geminiRoutes.js`)

| Event | metric_value | metadata | user_id | Contoh metadata |
|---|---|---|---|---|
| `ai_memory_used` | jumlah item memory | `{ context: string, used: boolean }` | wajib | `{"context":"advisor","used":true}` |

`context` = `advisor` | `monthly-report` (prompt mana yang memakai memory).

### Gmail sync (producer: `server/routes/geminiRoutes.js`)

| Event | metric_value | metadata | user_id | Contoh metadata |
|---|---|---|---|---|
| `gmail_sync_success` | 1 | `{}` | wajib | — |
| `gmail_sync_failed` | 1 | `{ code: string }` | wajib | `{"code":"VERTEX_QUOTA_EXCEEDED"}` |

### Conversation (producer: `server/routes/conversationRoutes.js`)

| Event | metric_value | metadata | user_id | Contoh metadata |
|---|---|---|---|---|
| `ai_conversation_started` | 1 | `{ periodDays: number }` | wajib | `{"periodDays":30}` |
| `ai_conversation_completed` | 1 | `{ periodDays: number, source: 'gemini'\|'rule-based', fallback: boolean }` | wajib | `{"periodDays":30,"source":"gemini","fallback":false}` |
| `ai_conversation_failed` | 1 | `{ periodDays: number }` | wajib | `{"periodDays":30}` |

### Timeline (producer: `server/routes/aiProductRoutes.js`)

| Event | metric_value | metadata | user_id | Contoh metadata |
|---|---|---|---|---|
| `timeline_view` | 1 | `{}` (feature = eventType/filter) | wajib | — |
| `timeline_event_open` | 1 | `{}` (feature = event_type) | wajib | — |
| `timeline_status_update` | 1 | `{ from: string, to: string }` | wajib | `{"from":"new","to":"viewed"}` |

`from`/`to` = status enum P9 (`new`/`viewed`/`completed`/`dismissed`).

### Agent Search (producer: `server/routes/agentSearchRoutes.js`)

| Event | metric_value | metadata | user_id | Contoh metadata |
|---|---|---|---|---|
| `agent_search_count` | 1 | `{ tab: string }` | wajib | `{"tab":"transactions"}` |
| `agent_search_empty` | 1 | `{ tab: string }` | wajib | `{"tab":"transactions"}` |
| `agent_search_latency` | durasi ms | `{}` | wajib | — |
| `agent_search_error` | 1 | `{}` | wajib | — |
| `agent_search_click` | 1 | `{ tab, query, resultId }` (query cap 200, resultId cap 120) | **nullable** (client) | `{"tab":"transactions","query":"tiket","resultId":"r1"}` |
| `agent_search_suggestion_used` | 1 | `{ tab, query }` (query cap 200) | **nullable** (client) | `{"tab":"transactions","query":"makanan terdekat"}` |

Catatan: event *click/suggestion_used* datang dari `/api/agent-search/track`
(klien) — `user_id` null bila tab publik tanpa login.

### AI Product Track (producer: `server/routes/aiProductRoutes.js`, endpoint `POST /api/ai-product/track`)

> Whitelist `TRACK_EVENTS`; `eventType` di-validasi enum timeline kanonik
> (`insight`·`recommendation`·`conversation`·`feedback`·`memory_update`·`risk`·`other`).

| Event | metric_value | metadata | user_id | Contoh metadata |
|---|---|---|---|---|
| `ai_hub_view` | 1 | `{ feature, itemId, eventType }` (semua nullable) | wajib | `{"feature":"insight","itemId":null,"eventType":null}` |
| `recommendation_shown` | 1 | `{ feature, itemId, eventType }` | wajib | `{"feature":"advisor","itemId":"evt-abc","eventType":"recommendation"}` |
| `recommendation_opened` | 1 | `{ feature, itemId, eventType }` | wajib | `{"feature":"timeline","itemId":"evt-abc","eventType":"recommendation"}` |
| `ai_result_shown` | 1 | `{ feature, itemId, eventType }` | wajib | `{"feature":"insight","itemId":"evt-abc","eventType":"recommendation"}` |

`itemId` = id timeline event (korelasi, non-PII); `eventType` = enum kanonik.
`ai_result_shown` (P10.2i) = denominator Feedback Rate — kartu hasil AI
feedback-capable ditampilkan (bukan page view). Producer frontend: AiTimelinePage
& TimelineSection hub (SEMUA event, sekali per item via `trackedIdsRef`), hub
insight/health/simulation (sekali per muat), AdvisorPage (per report), Chat answer
(per jawaban).

---

## 4. Registri event — `ai_usage_metrics` (metadata tambahan)

`metadata` pada tabel ini = primitives konteks feature:

| Feature | metadata yang mungkin | Contoh |
|---|---|---|
| `agent_search` | `{ tab, resultCount }` | `{"tab":"transactions","resultCount":12}` |
| `gmail_sync` / `ocr_receipt` / `insight_generator` / `financial_advisor` / `fraud_detection` | `metricMeta` konteks (nullable) + `{ retries }` pada error | `{"retries":1}` |

Kolom kanonik (tokens/cost/latency/status/error_message/model) selalu ada di
tabel — metadata hanya pelengkap.

---

## 5. Verifikasi & linkage

- **Regression test event**: `tests/unit/trackEventRoutes.test.ts` (11) — whitelist + metadata non-PII track.
- **Agregator murni**: `server/lib/recommendationEngagement.js` (13) · `server/lib/feedbackMetrics.js` (14) · `server/lib/agentSearchEngagement.js` · `server/lib/retentionMetrics.js` (9) · `server/lib/feedbackRate.js` (10).
- **Retention signal**: `tests/unit/observabilityMiddleware.test.ts` (5).
- **Definisi metrik**: lihat [PRODUCT_METRICS](PRODUCT_METRICS.md).
- **Audit P10.1**: [P10_1_CLOSED_BETA_INSTRUMENTATION_AUDIT](../product/P10_1_CLOSED_BETA_INSTRUMENTATION_AUDIT.md) §3.

---

## 6. Kontrak pembaruan (WAJIB saat menambah event)

1. Tambahkan baris di §3 (atau §4 untuk `ai_usage_metrics`) — event, metric_value, kolom metadata + tipe + contoh.
2. Pastikan metadata melewati `sanitizeMetadata` (tanpa kunci SENSITIVE, tanpa nested object, string ≤ 200).
3. `user_id` selalu id internal; anonim → `null`.
4. Tambahkan/update regression test bila ada validasi baru (whitelist/enum).
5. Update [PRODUCT_METRICS](PRODUCT_METRICS.md) bila metrik baru diperkenalkan.
