# Product Metrics (P9 §24) — Closed Beta Instrumentation

> Semua metrik di bawah DIBANGUN untuk cohort nyata (10–30 user, 2–4 minggu).
> Jangan mengklaim signifikansi statistik dengan sample kecil — dokumentasikan
> sample size & confidence limitations.

## 1. Timeline Engagement (P9 §24)

| Metric | Definisi | Sumber data |
|---|---|---|
| `timeline_open_rate` | Buka halaman /ai/timeline ÷ pengguna aktif | `system_metrics.timeline_view` |
| `event_open_rate` | Event dibuka (detail) ÷ event ditampilkan | `system_metrics.timeline_event_open` |
| `event_completion_rate` | Event → status `completed` ÷ event total | `ai_timeline.status` |
| `event_dismiss_rate` | Event → status `dismissed` ÷ event total | `ai_timeline.status` |

Instrumentasi sudah aktif (P9): `timeline_view` (GET list), `timeline_event_open` (GET detail),
`timeline_status_update` (PATCH, metadata `{from, to}`). Status transition di PATCH secara
otomatis menyediakan funnel `new → viewed → completed|dismissed`.

## 2. AI Recommendation Funnel

| Metric | Definisi | Sumber data |
|---|---|---|
| `recommendation_view_rate` | Rekomendasi dilihat ÷ dihasilkan | `ai_timeline` (event_type=recommendation, status viewed) |
| `recommendation_acceptance_rate` | Status `completed` ÷ status viewed | `ai_timeline.status` |
| `recommendation_completion_rate` | Status `completed` ÷ total rekomendasi | `ai_timeline.status` |
| `recommendation_negative_rate` | Feedback negatif ÷ feedback total | `ai_feedback.rating` |

### CTR rekomendasi (P10.2 — Closed Beta Instrumentation)

| Metric | Definisi | Sumber data |
|---|---|---|
| `recommendation_shown` | Rekomendasi dirender di UI (denominator CTR) — fire SEKALI per item (anti double-count di pagination/filter) | `system_metrics` via `POST /api/ai-product/track` |
| `recommendation_opened` | Rekomendasi dibuka user (numerator CTR) | `system_metrics` via `POST /api/ai-product/track` |

- **CTR** = `recommendation_opened` ÷ `recommendation_shown` (0..1).
- Agregasi murni: `server/lib/recommendationEngagement.js` (pure, 13 unit test).
- Endpoint admin: `GET /api/admin/metrics/recommendation-engagement` →
  `{ shown, opened, ctr, byFeature, byDay, byEventType }` (range clamp 90 hari).
  `byDay` = seri harian `{ date, shown, opened, ctr }` dari `created_at` (`toDayKey`
  UTC) — tren CTR per hari. `byEventType` = CTR per `eventType` (enum timeline
  kanonik) dari metadata event track — breakdown jenis rekomendasi (P10.2d).
- Instrumentasi frontend: `trackAiProductEvent` (`src/services/aiProductService.ts`) di AiHubPage
  (`ai_hub_view`) & AiTimelinePage (`recommendation_shown` saat list render, `recommendation_opened` saat detail dibuka).
- Non-PII: metadata hanya `{ feature, itemId }` — tanpa query/isi konten (whitelist event di server).
- **Scoping (definisi CTR)**: numerator & denominator sama-sama hanya event_type `recommendation`.
  `shown` dihitung per-item dirender di halaman `/ai/timeline` (fire sekali per item via `trackedIdsRef`;
  toggle filter = re-exposure → dihitung lagi) **DAN di kartu timeline AiHub** (5 entri terbaru lintas
  jenis, fire sekali per item via `trackedIdsRef` lokal kartu — P10.2e). Item yang dirender di kedua
  surface (kartu hub + halaman timeline) dihitung 2× `shown` — dua exposure context berbeda, disengaja
  (exposure per-surface). **Catatan metrik (P10.2e)**: kartu hub TIDAK punya aksi buka detail →
  `shown` dari hub bersifat *awareness-only* dan tidak bisa menjadi numerator `opened` (yang hanya
  berasal dari halaman `/ai/timeline`) — denominator hub melebihi numerator secara struktural;
  interpretasikan CTR sebagai rasio exposure-aware, bukan konversi klik murni.
- **Panel admin**: `/admin/monitoring` → kartu "Rekomendasi AI" (pola FeedbackPriorityPanel
  additive) — ringkasan shown/opened/CTR, grafik line CTR per hari (byDay, tooltip
  `n shown · m opened`), breakdown per feature (mini bar + rate) + **per event type**
  (shown/opened + badge CTR per `eventType`, P10.2d).
- `eventType` (opsional, enum timeline kanonik) diterima di `POST /api/ai-product/track`
  — klien mengirim `it.event_type`; non-PII; event tak dikenal → 400 fail-closed.
- Kartu timeline AiHub (`/ai`) kini memuat 5 entri terbaru lintas jenis (bukan hanya insight) —
  rekomendasi yang tampil ikut dihitung `shown` (P10.2e). `AiFeedbackButtons` per entri memakai
  `feature` asli entri (bukan hardcoded insight).
- Regression test: `tests/unit/trackEventRoutes.test.ts` (10) + `tests/unit/recommendationEngagement.test.ts` (13).

## 3. Feedback Rates

| Metric | Definisi |
|---|---|
| `helpful_rate` | `helpful` ÷ total feedback |
| `not_helpful_rate` | `not_helpful` ÷ total |
| `mismatched_rate` | `mismatched` ÷ total |
| `irrelevant_rate` | `irrelevant` ÷ total |

Sumber: `ai_feedback` (sudah ada + admin summary endpoint `GET /api/admin/metrics/feedback-summary`).

### Feedback Rate (P10.2i — feedback ÷ AI result views)

| Metric | Definisi | Sumber data |
|---|---|---|
| `feedback_rate` | Total `ai_feedback` (numerator) ÷ total `ai_result_shown` (denominator) | `ai_feedback` ÷ `system_metrics.ai_result_shown` |

- **Denominator "AI result views" = event `ai_result_shown`** (whitelist `POST
  /api/ai-product/track`, non-PII `{ feature, itemId }`): kartu hasil AI yang
  feedback-capable (me-render `AiFeedbackButtons`) ditampilkan — **bukan page
  view, bukan `timeline_view`** (yang = GET list, bukan tampilan kartu).
- **Surface yang fire `ai_result_shown`** (sekali per kartu, anti double-count
  via `trackedIdsRef`): halaman `/ai/timeline` & kartu timeline AI Hub (SEMUA
  event — feedback tersedia per entri), kartu hub insight/health/simulation
  (sekali per muat data), AdvisorPage (per report baru), jawaban Chat
  (per jawaban).
- **Scoping konsisten**: numerator & denominator SAMA-SAMA dari surface
  feedback-capable → rate per feature = feedback[feature] ÷ views[feature].
- **Scoping — cross-surface (P10.2i)**: item yang dirender di kartu timeline
  AI Hub (5 entri) DAN halaman `/ai/timeline` dihitung 2× `ai_result_shown`
  (dua exposure context berbeda — per-surface, disengaja; pola sama dengan
  scoping `recommendation_shown` di §2). `feedback` dihitung per submit
  (bukan per item unik) sehingga rasio tetap konsisten secara per-surface.
- **Scoping — dual-fire rekomendasi (P10.2i)**: entri `recommendation` memicu
  DUA event track (fire-and-forget, non-blocking): `ai_result_shown`
  (denominator feedback rate — semua event) + `recommendation_shown`
  (denominator CTR — hanya recommendation). Metriknya independen; tidak ada
  metrik yang dihitung dua kali.
- **Agregasi murni**: `server/lib/feedbackRate.js` (pure, 10 unit test) —
  rate 0..1 3 desimal; views = 0 → rate 0 (tanpa divide-by-zero).
- **Endpoint admin**: `GET /api/admin/metrics/feedback-rate` (admin-only, range
  clamp 90 hari) → `{ feedback, views, rate, byFeature }`.
- **Panel admin**: `/admin/monitoring` → kartu "Feedback Rate" — ringkasan
  feedback / tampilan kartu / rate + breakdown per feature (mini bar + badge %).
- Regression test: `tests/unit/feedbackRate.test.ts` (10) +
  `tests/unit/feedbackRateApi.test.ts` (5) + `tests/unit/trackEventRoutes.test.ts` (11).

## 4. Conversation Telemetry

| Metric | Definisi | Sumber data |
|---|---|---|
| `ai_conversation_started` | Pertanyaan valid diterima (setelah validasi 400 — 400 bukan percakapan) | `system_metrics` (metadata `periodDays`) |
| `ai_conversation_completed` | Jawaban berhasil dikirim (metadata `source` = `gemini` \| `rule-based`, `fallback` bool) | `system_metrics` |
| `ai_conversation_failed` | Error 500 saat proses (Gemini + fallback pun gagal) | `system_metrics` |

- `conversation_completion_rate` = `ai_conversation_completed` ÷ `ai_conversation_started`.
- `conversation_fallback_rate` = completed dengan `source=rule-based` ÷ completed — sinyal keandalan AI
  (Gemini down/tidak tersedia → user tetap mendapat jawaban deterministik).
- Instrumentasi aktif di `POST /api/ai-product/conversation` (regression test: `tests/unit/conversationRoutes.test.ts`).

## 5. Retention

- D1 · D7 · D14 · D28 — dihitung dari sinyal aktivitas kanonik **`user_active`**
  (P10.1): satu baris per user per hari UTC di `system_metrics`, dicatat di
  `httpMetricsMiddleware` (skip health/SSE; dedupe via SELECT→INSERT).
- **Cohort**: tabel Better Auth `user.createdAt` (epoch sekon → hari UTC).
- **Komputasi murni**: `server/lib/retentionMetrics.js` — retention day-N =
  proporsi cohort yang AKTIF pada hari registrasi+N (via `user_active`).
  Guard: cohort < 10 user TIDAK dilaporkan; day-N dengan jendela belum
  tercapai → `null` (bukan 0 palsu); total cohort < 10 → `cohortGuardActive`
  (UI empty state — hindari dashboard kosong).
- **Endpoint admin**: `GET /api/admin/metrics/retention` (admin-only, range
  clamp 90 hari) → `{ totalCohortUsers, totalCohorts, cohortGuardActive,
  cohorts[], days[] }`.
- **Panel admin**: `/admin/monitoring` → kartu "Retensi Pengguna" — ringkasan
  mean D1/D7/D14/D28 + tabel per cohort-day (kolom "—" = window belum tercapai).
- HANYA dilaporkan bila cohort ≥ 10 user & periode pengamatan tercapai.
- **`createdAt` mixed-type (P10.2k fix)**: adapter Better Auth menyimpan
  `user.createdAt` sebagai TEXT ISO ("2026-08-01T08:09:57.508Z") sementara
  schema default-nya INTEGER unixepoch. Query cohort menormalkan tipe via
  `CASE typeof(createdAt)` (strftime untuk TEXT, CAST untuk INTEGER) — tanpa
  ini, bound `createdAt <= ?` (SQLite: INTEGER < TEXT selalu) mengecualikan
  user riil → retention selalu kosong (bug ditemukan E2E P10.2k).
- **E2E regression (P10.2k)**: `e2e/admin-monitoring-retention.spec.ts` — auth
  gate 401, shape + cohort seed eksak (d1 1.0/d7 0.6/d14 0.4/d28 0.2), render
  panel light & dark. Fixture memakai createdAt TEXT ISO (jalur produksi).
  `npm run test:e2e:retention-panel`.
- Regression test: `tests/unit/retentionMetrics.test.ts` (10) + `tests/unit/observabilityMiddleware.test.ts` (5).

## 5b. Memory Utilization

| Metric | Definisi | Sumber data |
|---|---|---|
| `ai_memory_used` | Panggilan advisor/monthly-report dengan memory di-injeksi (metricValue = jumlah item, metadata `{ context, used }`) | `system_metrics` |

- `memory_utilization_rate` = `ai_memory_used` (used=true) ÷ total panggilan
  advisor + insight (`ai_usage_metrics` feature `financial_advisor`/`insight_generator`).
- Instrumentasi aktif di `geminiRoutes.js` (advisor & monthly-report) —
  regression test: `tests/unit/memoryUsageObservability.test.ts`.
- Denominator "eligible" = seluruh panggilan advisor + insight (memory selalu
  dimuat; eligibility tidak dibatasi konten).

## 5c. Registry Payload Schema (P10.2f)

Skema metadata (nama kolom, tipe, contoh) per event telemetry — single source
of truth — ada di **[EVENT_REGISTRY](EVENT_REGISTRY.md)**: seluruh event
`system_metrics` & `ai_usage_metrics` + producer + aturan sanitasi + kontrak
pembaruan wajib. Update dokumen itu saat menambah/mengubah event.

## 6. Aturan Pelaporan

- Tuliskan: sample size · confidence limitations · data collection period · feature exposure · missing data.
- Data sintetis (seed dev / fixture E2E) TIDAK masuk perhitungan metrik produk.
