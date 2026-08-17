# P10.1 — Closed Beta Instrumentation & Product Validation Readiness Audit

> **Audit** · Tanggal: 2026-08-07 · Branch: `gh-pages` · Target: cohort 10–30 user, 2–4 minggu
> Metode: **AUDIT → EVIDENCE → MINIMAL FIX → TEST → DOCUMENT**. Verifikasi dokumentasi terhadap source code aktual; implementasi aktual adalah prioritas. Tidak ada AI feature baru, tidak ada RAG/embedding/cache semantics baru, tidak ada perubahan schema.

---

## 1. Executive Summary

CashFlow P9 telah PASS secara teknis. Audit P10.1 memverifikasi bahwa **seluruh instrumentasi closed-beta benar-benar dapat menghasilkan data valid, user-scoped, privacy-safe, dan analisable**.

Hasil: **BETA READY WITH CONDITIONS**.

- **Event inventory** (server-side, `system_metrics` + `ai_usage_metrics`): 25+ event terverifikasi di source code — konsisten, user-scoped, non-PII, timestamp otomatis.
- **2 gap instrumentation nyata ditemukan & diperbaiki minimal** (additive, dengan regression test):
  1. **Retention signal kanonik tidak ada** → ditambahkan `user_active` (1 baris/user/hari UTC, dedupe) di `httpMetricsMiddleware` → D1/D7/D14/D28 kini terukur dari sinyal aktivitas (bukan page refresh).
  2. **Memory usage tidak terobservasi** → ditambahkan `ai_memory_used` (advisor & monthly-report) → `memory_utilization_rate` terukur.
- **Gap lain terdokumentasi & DEFERRED** (butuh keputusan produk, bukan fix teknis): `ai_hub_view` (exposure frontend), `recommendation_shown`/`recommendation_opened` (CTR eksplisit), retention dashboard admin.
- Verifikasi: **711 unit test pass (5 skipped) saat audit · typecheck 0 error · lint 0 error** (suite kini **759 + 5 skipped**, P10.2i — lihat §14).

## 2. Current Product Validation Readiness

| Dimensi | Status | Bukti |
|---|---|---|
| TECHNICAL | ✅ | unit 711 ✓ · typecheck ✓ · lint ✓ · build ✓ · E2E ✓ · benchmark ✓ |
| ANALYTICS | ✅ (2 gap ditutup) | event inventory lengkap; retention & memory utilization kini terukur |
| PRIVACY | ✅ | `sanitizeMetadata` (SENSITIVE regex) di kedua writer; event non-PII |
| USER EXPERIENCE | ✅ | feedback/timeline/memory/conversation + trust meta terpasang |
| OBSERVABILITY | ✅ | admin monitoring: usage/cost/health/cache/alerts/feedback-summary/agent-search-engagement |

## 3. Event Inventory (verifikasi source code)

Sumber: `recordSystemMetric` / `recordAIUsage` call sites (ripgrep) + route files.

### system_metrics (counter/dedupe events)

| Event | Producer | Payload/metadata (non-PII) | User-scoped |
|---|---|---|---|
| `http_2xx/3xx/4xx/5xx_total`, `http_latency_ms` | observabilityMiddleware | route, method, requestId | ✅ (user_id bila auth) |
| `user_active` **← FIX P10.1** | observabilityMiddleware | `{ day: YYYY-MM-DD }` | ✅ |
| retention D1/D7/D14/D28 **← FIX P10.2b** | `lib/retentionMetrics.js` + `GET /api/admin/metrics/retention` + panel admin | cohort = `user.createdAt` (UTC) × `user_active` | ✅ |
| `fraud_flag_count` | fraudDetectionService | `{ rules[], severity }` | ✅ |
| `ai_cache_hit` / `ai_cache_miss` / `ai_single_flight_join` | vertexContext | label + metricMeta | ✅ |
| `agent_search_count` / `_empty` / `_latency` / `_error` / `_click` / `_suggestion_used` | agentSearchRoutes (+ track endpoint) | tab, query-length | ✅ (count dgn user; click tanpa user_id) |
| `timeline_view` / `timeline_event_open` | aiProductRoutes | feature/eventType | ✅ |
| `timeline_status_update` | aiProductRoutes | `{ from, to }` | ✅ |
| `ai_conversation_started` / `_completed` / `_failed` | conversationRoutes | `{ periodDays }` / `{ periodDays, source, fallback }` | ✅ |
| `gmail_sync_success` / `gmail_sync_failed` | geminiRoutes | `{ code }` (failed) | ✅ |
| `ai_memory_used` **← FIX P10.1** | geminiRoutes | `{ context, used }` | ✅ |

### ai_usage_metrics (AI quality/cost)

`recordAIUsage` di `runVertexPipeline` (chokepoint) untuk semua feature (`gmail_sync`, `ocr_receipt`, `insight_generator`, `agent_search`, `fraud_detection`, `financial_advisor`, `conversation`): prompt/completion tokens, estimated cost USD/IDR, execution_time_ms, status (success/error/timeout/rate_limited), model, user_id, metadata sanitized.

### Verdict per kriteria §3 (event name)

1. **Konsisten** ✅ — snake_case, prefix feature (agent_search_*, timeline_*, ai_conversation_*).
2. **Terdokumentasi** ✅ — PRODUCT_METRICS.md (sebelumnya §1-6; kini + §5 Retention & §5b Memory Utilization).
3. **Payload schema** ✅ **FIXED (P10.2f)** — registri lengkap di `docs/ai-product/EVENT_REGISTRY.md`: kolom metadata + tipe + contoh per event (`system_metrics` & `ai_usage_metrics`), producer, aturan sanitasi, kontrak pembaruan. Diverifikasi terhadap source code.
4. **User-scoped** ✅ — user_id internal di hampir semua event; `agent_search_click` tanpa user_id (analytics klien) — volume kecil, dokumentasikan.
5-6. **Tidak ada secret / PII** ✅ — sanitizeMetadata + hanya id/angka/boolean.
7. **Tidak ada full transaction content** ✅ — tidak ada body/narasi di metadata.
8. **Timestamp** ✅ — `created_at` otomatis di `system_metrics`.
9. **Analisable** ✅ — GROUP BY metric_name/feature/day; dedupe user_active via `{day}`.

## 4. Metric Definitions (canonical)

| Metric | Formula | Status |
|---|---|---|
| Conversation Completion | `ai_conversation_completed` ÷ `ai_conversation_started` | ✅ terukur (fix P10.0) |
| Conversation Fallback Rate | completed `source=rule-based` ÷ completed | ✅ terukur |
| Feedback Positive / Negative Rate | ratings `ai_feedback` ÷ total | ✅ (admin feedback-summary) |
| Memory Utilization | `ai_memory_used` (used) ÷ advisor+insight calls | ✅ **baru (fix P10.1)** |
| Recommendation Acceptance | `timeline_status_update` to=completed ÷ viewed | ✅ (state machine) |
| Timeline Engagement | `timeline_view` ÷ eligible users | ✅ |
| Retention D1/D7/D14/D28 | cohort aktif hari-N ÷ cohort (guard ≥ 10 user) | ✅ **baru (P10.1 signal + P10.2b dashboard)** · E2E panel + fix createdAt TEXT-ISO (P10.2k) |
| **CTR rekomendasi** | opened ÷ shown | ✅ **FIXED (P10.2/P10.2c)** — event `recommendation_shown`/`recommendation_opened` (track endpoint) + agregator + panel admin (byDay) |
| **Feedback Rate (feedback ÷ AI views)** | `ai_feedback` ÷ `ai_result_shown` | ✅ **FIXED (P10.2i)** — denominator didefinisikan = event `ai_result_shown` (kartu hasil AI feedback-capable ditampilkan; bukan page view/timeline_view) + agregator murni `lib/feedbackRate.js` + endpoint admin + panel + wiring seluruh surface feedback-capable |

Aturan dipatuhi: **tidak ada metrik yang diklaim tanpa numerator & denominator tersedia**.

## 5. Funnel Coverage

```
AI exposure        → ❌ ai_hub_view (deferred — butuh keputusan frontend telemetry)
AI opened          → ✅ ai_usage_metrics per feature (calls) — proxy exposure server-side
AI viewed          → ✅ timeline_view / timeline_event_open
AI feedback        → ✅ ai_feedback (6 rating) + feedback event timeline
AI action          → ⚠️ status timeline completed/dismissed (proxy) — bukan click eksplisit
AI completion      → ✅ conversation completed / status completed
```

- `recommendation_shown` → ✅ **FIXED (P10.2)** — fire sekali per item di `/ai/timeline` (trackedIdsRef).
- `recommendation_opened` → ✅ **FIXED (P10.2)** — saat detail recommendation dibuka (numerator = denominator scope).
- Verdict: **VALID** — CTR = opened ÷ shown kini terukur (P10.2) dan divisualisasikan per hari & per feature (P10.2c).

## 6. Retention Coverage

- **Sebelum**: tidak ada sinyal aktivitas kanonik (hanya `http_*` per-request; login event tidak diekspos).
- **Sesudah (FIX)**: `user_active` di `httpMetricsMiddleware` — 1 baris/user/hari UTC, dedupe SELECT→INSERT, skip health/SSE, non-blocking, metadata `{day}` saja. Timezone: UTC konsisten dengan `datetime('now')` DB.
- Signal dipilih: **request API terautentikasi** (aktivitas nyata aplikasi — bukan page refresh; halaman SPA memanggil API sehingga aktivitas tetap terwakili).
- Query contoh (admin):
  `SELECT COUNT(DISTINCT user_id) FROM system_metrics WHERE metric_name='user_active' AND created_at >= ?`
- Regression test: `tests/unit/observabilityMiddleware.test.ts` (5 test: record, dedupe, skip health, anonim tidak direkam, non-blocking).

## 7. Timeline Coverage (P9) — **PASS**

Diverifikasi di `aiProductRoutes.js` + `lib/timelineEvents.js`:
- event_type enum (insight/recommendation/conversation/feedback/memory_update/risk/other) dihitung server-side.
- status state machine `new→viewed→completed|dismissed` (`canTransition`), transisi invalid → 400.
- Keyset pagination `(created_at, id)` + `hasMore`; limit clamp [1,100].
- Detail `GET /:id` + feedback terkait (join `item_id`); **user lain → 404** (tested).
- Producer otomatis: conversation, insight, advisor, feedback, memory (fire-and-forget).
- Observability: `timeline_view`, `timeline_event_open`, `timeline_status_update`.
- Test: `timelineApi.test.ts` (14) + `timelineEvents.test.ts` (17) + `timelineGroup.test.ts` (8).

## 8. Memory Coverage

- **CRUD**: user-scoped (`WHERE user_id = ?`), enum kategori/source, sanitized (cap 80/300 char), event `memory_update` (set/delete) → timeline.
- **Prompt injection**: `aiMemoryContext.js` — framing "BUKAN instruksi", cap 12 item / 1200 char, sanitasi control char.
- **Usage observability**: **FIX P10.1** `ai_memory_used` (metricValue = jumlah item; metadata `{ context, used }`) di advisor & monthly-report → `memory_utilization_rate`.
- **Tidak bocor**: metadata hanya context+used (tanpa isi memory); query memory user-scoped (tested).
- Test: `memoryUsageObservability.test.ts` (4) + `aiMemoryContext.test.ts` (19).

## 9. Feedback Coverage

Pipeline diverifikasi end-to-end:
- **UI** (`AiFeedbackButtons.tsx`) → **API** (`POST /api/ai-product/feedback`, 6 rating) → **DB** (`ai_feedback`) → **analytics** (admin `feedback-summary`) → **priority engine** (`feedbackMetrics.js`) → **benchmark** (kategori ke-7 + live selection topPriority).
- **Enum konsisten** di seluruh lapisan: frontend, `FEEDBACK_RATINGS` (route), `aiProductRoutesValidation.test.ts` (sinkron enum), benchmark, docs.
- Feedback tanpa `itemId` timeline → event `feedback` otomatis (korelasi, tanpa duplikat).
- **Gap**: tidak ada `system_metrics.feedback_submitted` — tidak perlu: `ai_feedback` adalah canonical source; dokumentasikan saja (hindari duplikasi).

## 10. Data Quality (audit — tanpa penghapusan data)

| Check | Status |
|---|---|
| Duplicate event | ⚠️ `user_active` didedupe (fix); `http_*` sengaja 1 baris/request; `timeline_view` 1 baris/request — dedupe via GROUP BY di query |
| Missing user_id | ✅ anonim → null (bukan fake id) |
| Impossible/future timestamp | ✅ `created_at` dari DB (`datetime('now')`) |
| Invalid event_type/status | ✅ enum fail-closed (validasi 400) |
| Orphan feedback / timeline | ⚠️ feedback bebas itemId (valid); timeline event tanpa feedback valid |
| Impossible state transition | ✅ `canTransition` menolak |
| Negative duration | ✅ `execution_time_ms` di-clamp `> 0` saat agregasi |

## 11. Privacy / Security Review

- **Writer-level guard**: `sanitizeMetadata` (SENSITIVE regex: token/secret/key/jwt/authorization/credential/base64/image/body/raw/password/email) di `recordSystemMetric` & `recordAIUsage`; nilai string > 200 char di-cap; nested object dibuang.
- **Error messages**: `sanitizeErrorMessage` redaksi JWT/token/path/stack sebelum admin view.
- **Tidak ada** password/token/service account/full Gmail body/full transaction di telemetry. Metadata baru (`day`, `context`, `used`) = hanya boolean/angka/tanggal.
- **Log**: pino redaction otomatis (cookie, authorization, token/secret/password).
- **User-scoping**: seluruh query telemetry & data AI `WHERE user_id = ?`; admin-only endpoints via `resolveAdmin`.

## 12. Missing Instrumentation

| Gap | Severity | Status |
|---|---|---|
| Retention signal kanonik | P2 | ✅ **FIXED** (`user_active`) |
| Memory usage observability | P2 | ✅ **FIXED** (`ai_memory_used`) |
| `ai_hub_view` / feature exposure frontend | P2 | ✅ **FIXED (P10.2)** — event `ai_hub_view` via track endpoint (AiHubPage mount) |
| `recommendation_shown` / `recommendation_opened` (CTR) | P2 | ✅ **FIXED (P10.2)** — `POST /api/ai-product/track` + agregator + admin endpoint + wiring frontend |
| Feedback rate denominator (AI result views) | P3 | ✅ **FIXED (P10.2i)** — denominator = `ai_result_shown` (tampilan kartu AI feedback-capable) → Feedback Rate terukur di panel admin |
| Retention dashboard admin | P3 | ⏳ DEFERRED — lapor setelah cohort ≥ 10 (hindari dashboard kosong) |

## 13. Minimal Fixes Performed

1. **`server/middleware/observabilityMiddleware.js`** — `recordUserActive(userId)` + wiring di `httpMetricsMiddleware` (fire-and-forget, dedupe per user/hari UTC, skip health/SSE).
2. **`server/services/metricsService.js`** — export `getMetricsClient` (dipakai dedupe check).
3. **`server/routes/geminiRoutes.js`** — `recordMemoryUsageObservability` di advisor & monthly-report → `ai_memory_used`.
4. **`tests/unit/observabilityMiddleware.test.ts`** (baru, 5 test) — retention signal.
5. **`tests/unit/memoryUsageObservability.test.ts`** (baru, 4 test) — memory usage observability.
6. **`docs/ai-product/PRODUCT_METRICS.md`** — §5 Retention (user_active) & §5b Memory Utilization.

Semua additive, backward-compatible, tanpa perubahan schema/tabel, tanpa menghapus telemetry existing.

## 14. Tests

- **Full unit suite: 786 passed + 5 skipped** (62 files) — 711 (P10.1) → 725 (P10.2) → 737 (P10.2c) → 743 (P10.2d) → 743 (P10.2e) → 743 (P10.2f/g/h, docs+e2e) → 759 (P10.2i) → 760 (P10.2k) → **786 (P10.3, +26 `terminal.test.ts`)**.
- **typecheck**: 0 error · **lint**: 0 error.
- Regression baru: `observabilityMiddleware.test.ts` (5) + `memoryUsageObservability.test.ts` (4)
  + `trackEventRoutes.test.ts` (11) + `recommendationEngagement.test.ts` (13) + `retentionMetrics.test.ts` (9)
  + `feedbackRate.test.ts` (10, baru) + `feedbackRateApi.test.ts` (5, baru)
  + `retentionMetrics.test.ts` +1 (P10.2k — kasus eksak 10/6/4/2 = 1.0/0.6/0.4/0.2).
- E2E baru (P10.2k): `admin-monitoring-retention.spec.ts` (3 test) — suite e2e 65 → **68 test** (`--grep-invert '@visual|@perf' --list`).
- E2E baru (verifikasi runtime §18): `admin-monitoring-feedback-rate.spec.ts` (3 test — auth gate 401, shape endpoint + per-feature eksak, render panel light/dark) — suite e2e 68 → **71 test**. `admin-monitoring-chart.spec.ts` di-fix: scoping `.recharts-line`/legend ke card "Tren Biaya" (sebelumnya global — collides dengan line chart panel Rekomendasi AI).

## 15. Beta Readiness Verdict

> ## BETA READY WITH CONDITIONS
>
> **READY** karena: 711 unit test hijau, event inventory lengkap & user-scoped, privacy guard aktif, retention & memory utilization kini terukur, admin monitoring mencakup usage/cost/health/cache/alerts/feedback.
>
> **CONDITIONS**:
> 1. Sebelum/goal beta: tetapkan definisi produk untuk CTR (`recommendation_shown`/`opened`) & "AI result views" (feedback rate) — P10.2 kecil, butuh keputusan bukan kode besar.
> 2. Ops: error alerting channel & support channel (dari audit P10.0 G7) + verifikasi runtime produksi (DNS/Turso/Vertex/OAuth).
> 3. Dashboard retention admin setelah cohort ≥ 10 user (hindari angka kosong).
> 4. Synthetic/demo data: jangan campur dengan cohort beta (label jelas; seed E2E terpisah).

## 16. Remaining Risks

| Risiko | Level | Mitigasi |
|---|---|---|
| Frontend exposure tidak terukur (ai_hub_view) | Medium | Proxy via `ai_usage_metrics` + timeline events; keputusan telemetry klien P10.2 |
| CTR/acceptance di-proxy status (bukan click) | Medium | Definisikan acceptance semantics bersama produk; jangan klaim CTR sebelum event nyata |
| Retention timezone (UTC) vs waktu lokal user | Low | Konsisten UTC; dokumentasikan |
| Volume system_metrics (http_* 2 baris/request) | Low | Skip health/SSE; window 90 hari; agregasi SQL |

## 17. Recommended P10.2

1. ✅ **DONE (P10.2) — Frontend telemetry minimal**: `POST /api/ai-product/track`
   (whitelist `ai_hub_view` | `recommendation_shown` | `recommendation_opened`, requireAuth,
   non-PII metadata `{feature, itemId}`) + agregator murni `lib/recommendationEngagement.js`
   (CTR = opened ÷ shown) + endpoint admin `GET /api/admin/metrics/recommendation-engagement`
   + wiring frontend `trackAiProductEvent` di AiHubPage (hub view) & AiTimelinePage
   (shown sekali per item via `trackedIdsRef`, opened saat detail dibuka).
   → **CTR & exposure kini terukur**. Regression test: trackEventRoutes (7) + recommendationEngagement (7).
2. ✅ **DONE (P10.2b) — Retention dashboard admin**: `lib/retentionMetrics.js` (pure,
   9 unit test) + `getRetentionMetrics` + `GET /api/admin/metrics/retention`
   (admin-only, clamp 90 hari) + panel "Retensi Pengguna" di `/admin/monitoring`
   (ringkasan D1/D7/D14/D28 + tabel per cohort-day; guard ≥ 10 user → empty
   state alih-alih angka kosong).
3. ✅ **DONE (P10.2c) — Panel "Rekomendasi AI" admin**: `aggregateRecommendationByDay`
   (pure, `lib/recommendationEngagement.js` — seri harian `{date, shown, opened, ctr}`
   dari `created_at`, toDayKey UTC) + `getRecommendationEngagement` kini mengembalikan
   `byDay` + `GET /api/admin/metrics/recommendation-engagement` (sama endpoint P10.2)
   + panel di `/admin/monitoring` (ringkasan shown/opened/CTR, line chart CTR per hari,
   breakdown per feature — pola kartu FeedbackPriorityPanel, additive).
   Regression test: `recommendationEngagement.test.ts` +3 (byDay) = 10.
4. ✅ **DONE (P10.2d) — CTR per event type**: `POST /api/ai-product/track` menerima
   `eventType` opsional (enum timeline kanonik — 400 fail-closed bila tidak valid),
   disimpan di metadata (non-PII). Agregator baru `aggregateRecommendationByEventType`
   (pure — `{eventType, shown, opened, ctr}` per tipe, urut total desc) → endpoint
   `recommendation-engagement` kini mengembalikan `byEventType`; panel menampilkan
   section "Per Event Type" (shown/opened + badge CTR). Klien timeline mengirim
   `it.event_type` pada shown & opened. Regression test: trackEventRoutes +3,
   recommendationEngagement +3 (byEventType) = 13.
5. ✅ **DONE (P10.2e) — Tutup undercount denominator hub**: kartu timeline AI Hub
   (`/ai`, TimelineSection) memuat 5 entri terbaru lintas jenis AI (bukan hanya
   insight) dan kini fire `recommendation_shown` SEKALI per item rekomendasi
   (`trackedIdsRef` lokal — anti double-count saat reload/+Catat insight).
   Item yang dirender di kedua surface (hub + halaman timeline) dihitung 2× —
   exposure per-surface, disengaja. `AiFeedbackButtons` per entri memakai
   `feature` asli. Scoping note di PRODUCT_METRICS §2 diperbarui.
6. ✅ **DONE (P10.2f) — Event payload schema registry**: `docs/ai-product/EVENT_REGISTRY.md`
   — single source of truth kolom metadata (nama + tipe + contoh) untuk seluruh
   event `system_metrics` & `ai_usage_metrics`, producer per event, aturan
   sanitasi writer, skema tabel, kontrak pembaruan wajib. Menutup gap §3 kriteria 3.
7. ✅ **DONE (P10.2g) — E2E panel "Rekomendasi AI"**: `e2e/admin-monitoring-recommendation.spec.ts`
   (pola admin-monitoring-chart.spec.ts) — 3 test: (a) auth gate 401 tanpa cookie;
   (b) shape endpoint `recommendation-engagement` (shown/opened/ctr + byFeature/
   byDay/byEventType) dengan seed deterministik 8 baris `e2e-reco-*` (6 shown
   advisor+insight, 2 opened, hari ini & kemarin UTC); (c) render panel: stat
   ringkasan + % CTR + line chart per hari (byDay) + breakdown per feature &
   per event type, tanpa pageerror. Fixture dibersihkan di afterAll.
   `npm run test:e2e:recommendation-panel`.
   **Verifikasi stabilitas (P10.2g)**: e2e-stability-gate (E2E_CMD = spec
   recommendation + monitoring-chart) lulus attempt 1/3; 3× run berturut-turut
   (4/4 test tiap run, 17.4-18.3s) TANPA flake — panel rekomendasi stabil.
   **Dark-mode pass (P10.2g)**: test render kini menjalankan assertion panel
   (heading, stat, line chart scoped, breakdown) di light DAN dark
   (setTheme + reload + waitForTheme) — pola admin-monitoring-chart.spec.ts.
   **Konsistensi numerik (P10.2g)**: assertion deterministik ditambahkan —
   (a) API: `ctr === round(opened/shown, 3)` (kontrak agregator, berlaku untuk
   dataset apa pun → kebal baris spec lain); (b) panel: nilai `%` yang dirender
   harus ≈ `round(ctr API × 100)` (±1, toleransi pembulatan; poll sampai render
   chart selesai). Bukan nilai mutlak — hanya konsistensi API↔UI.
8. ✅ **DONE (P10.2h) — CI regression coverage panel Rekomendasi AI (verified)**:
   `e2e/admin-monitoring-recommendation.spec.ts` otomatis masuk job `e2e` CI
   (`.github/workflows/e2e.yml`) via auto-discovery Playwright (`testDir:
   './e2e'` + `npm run test:e2e` = `--grep-invert "@visual|@perf"`). Verifikasi
   `playwright test --list`: spec terdaftar (3 test) & suite kini **68 test**
   (docs sebelumnya 50 — dikoreksi; 65→68 saat P10.2k). Job e2e menjalankan full suite via
   `e2e-stability-gate.sh` (3×, fail only on 3×) di setiap push/PR ke main &
   gh-pages → **panel rekomendasi ter-regresi di setiap push**.
   **Step per-spec awalnya TIDAK ditambahkan** (keputusan berbasis evidence):
   pola existing workflow = full suite — tidak ada step `test:e2e:monitoring-chart`;
   step redundan menggandakan eksekusi tiap push tanpa coverage tambahan.
   **Keputusan ini DIREVISI di P10.2j**: step `test:e2e:recommendation-panel`
   DITAMBAHKAN sebagai sinyal kegagalan eksplisit atas permintaan produk
   (redundan dengan full suite, disengaja — lihat item 10). Count suite
   dikoreksi di `docs/ci/CI_ARCHITECTURE.md` & `docs/ci/TESTING_STRATEGY.md`.
9. ✅ **DONE (P10.2i) — Feedback Rate (feedback ÷ AI result views)**: denominator
   "AI result views" didefinisikan = event `ai_result_shown` (whitelist
   `POST /api/ai-product/track`, non-PII `{feature, itemId}`) — kartu hasil AI
   feedback-capable ditampilkan, BUKAN page view / BUKAN `timeline_view`.
   Agregator murni `server/lib/feedbackRate.js` (`aggregateFeedbackRate` —
   global + per feature, guard views=0 → rate 0, pembulatan 3 desimal) +
   `getFeedbackRate` (metricsService) + `GET /api/admin/metrics/feedback-rate`
   (admin-only) + panel "Feedback Rate" di `/admin/monitoring` (ringkasan
   feedback/views/rate + breakdown per feature). Wiring frontend fire
   `ai_result_shown` di SEMUA surface feedback-capable (sekali per kartu,
   anti double-count via `trackedIdsRef`): halaman `/ai/timeline` & kartu
   timeline AI Hub (semua event), hub insight/health/simulation (sekali per
   muat), AdvisorPage (per report), jawaban Chat (per jawaban). Scoping
   konsisten: numerator & denominator sama-sama dari kartu feedback-capable.
   Regression test: `tests/unit/feedbackRate.test.ts` (10, agregasi) +
   `tests/unit/feedbackRateApi.test.ts` (5, gate 401/403 + shape + 500) +
   `trackEventRoutes.test.ts` +1 (ai_result_shown whitelist).
10. ✅ **DONE (P10.2j) — Step CI eksplisit panel Rekomendasi AI**: job `e2e`
    di `.github/workflows/e2e.yml` kini menjalankan `npm run test:e2e:recommendation-panel`
    (spec `admin-monitoring-recommendation.spec.ts`) sebagai step terpisah
    **SETELAH stability gate** — sinyal kegagalan eksplisit: regresi panel     terlihat sebagai step bernama di run, bukan terkubur di suite 68 test.
    **REDUNDAN dengan full suite** (auto-discovery di gate) — disengaja atas
    permintaan produk. Spec self-contained (seed `e2e-reco-*` dibersihkan di
    afterAll) → tidak mengubah state deterministik step lain. Komentar gate
    e2e.yml direvisi: step per-spec lain tetap tidak ada (primary gate = full
    suite).
11. ✅ **DONE (P10.2k) — E2E panel "Retensi Pengguna" + fix bug tipe createdAt**:
    `e2e/admin-monitoring-retention.spec.ts` (baru, 3 test — auth gate 401,
    shape endpoint + cohort seed EKSAK d1 1.0/d7 0.6/d14 0.4/d28 0.2, render
    panel light & dark + tabel cohort-day). Fixture `e2e-ret-*`: 1 cohort 10
    user (createdAt TEXT ISO — bentuk adapter Better Auth riil) + 22 baris
    `user_active` (D+1 10/10 · D+7 6/10 · D+14 4/10 · D+28 2/10), delete-first
    idempoten, dibersihkan di afterAll. Spec mengklik toggle "90 Hari" (panel
    default 7 hari tidak memuat cohort 40 hari lalu; reload dark me-reset
    periode → klik ulang).
    **BUG DITEMUKAN & DIPERBAIKI**: `getRetentionMetrics` membandingkan
    `createdAt` dengan bound epoch numerik mentah — adapter Better Auth
    menulis createdAt TEXT ISO, dan SQLite membandingkan INTEGER < TEXT selalu
    → user riil TERSARING dari bound (`createdAt <= ?` = false) → retention
    selalu kosong. Fix: normalisasi tipe di SQL via `CASE typeof(createdAt)`
    (strftime('%s') untuk TEXT, CAST untuk INTEGER). Diverifikasi: query lama
    0 baris, query baru 1 baris (user TEXT). E2E ini meng-guard fix (fixture
    memakai TEXT ISO). Regression: `retentionMetrics.test.ts` +1 (10) — kasus
    eksak 10/6/4/2 aktif; `npm run test:e2e:retention-panel`;
    e2e-stability-gate attempt 1/3 PASS. Suite e2e 65 → **68 test**.
12. **Alerting ops** (channel email/webhook) + support channel.

## 18. Audit Verifikasi Runtime (preview — UI ↔ API ↔ DB)

> 2026-08-08: seluruh 7 panel admin /admin/monitoring ter-verifikasi live
> (Rekomendasi AI · Feedback Rate · Retensi · AI Cost & Health · Prioritas
> Perbaikan Prompt · Alerts · stability gate trio). Sumber: snapshot preview
> (UI) + curl sesi admin minted (API) + query langsung ke Turso (DB).

> Audit runtime dilakukan pada preview live (user demo `demo@cashflow.test`,
> origin `localhost:5180`/API `5181`, DB Turso bersama). Prinsip verifikasi:
> **tiga lapisan direkonsiliasi** — nilai yang dirender di UI, respons API
> admin, dan baris mentah di Turso harus sama persis. Tidak ada mock/hardcode;
> seluruh evidence di bawah adalah pengukuran aktual, bukan asumsi.

### 18.1 Panel "Rekomendasi AI" — ✅ VALID (3 lapisan identik)

| Lapisan | Evidence |
|---|---|
| Raw Turso | 10 event `system_metrics`: `recommendation_shown` ×7 + `recommendation_opened` ×3; metadata `{feature, itemId, eventType}` terisi (advisor 7, insight 3) |
| API `recommendation-engagement` | `shown: 7, opened: 3, ctr: 0.429` (kontrak `round(opened/shown, 3)` = `round(3/7×1000)/1000`) |
| UI panel | Ringkasan "shown 7 · opened 3 · CTR 43%" (`Math.round(0.429×100)`), line chart per hari, breakdown per feature `advisor 7×` & `insight 3×` |

Catatan verifikasi: baris snapshot aksesibilitas "Advisor 7 × 2 / Insight 2 × 3"
adalah flattening dua baris — `1. advisor · 7×` dan `2. insight · 3×` — dan
konsisten persis dengan `aggregateRecommendationEngagement` (`count =
shown+opened` per feature, sort total desc). Bukan bug rendering.

### 18.2 Panel "Feedback Rate" — ✅ VALID (dengan scoping terdokumentasi)

| Lapisan | Evidence |
|---|---|
| Raw Turso | `ai_result_shown` ×19 (denominator) · `ai_feedback` ×28 raw |
| API `feedback-rate` | views 19 · feedback **27** · rate dihitung server |
| UI panel | Kartu render ringkasan feedback/views/rate + breakdown per feature |

**Scoping `ai_feedback` 28 vs 27 (dokumentasi penting)**: total baris mentah
`ai_feedback` = 28, tetapi numerator API = 27. Satu baris memiliki `feature`
di luar cakupan kartu AI feedback-capable (scoping numerator & denominator
sama-sama dari kartu feedback-capable — konsisten dengan desain P10.2i,
§4 & PRODUCT_METRICS §3). Ini BUKAN error: panel menghitung feedback pada
surface yang punya denominator `ai_result_shown`; baris dengan feature di
luar daftar surface sengaja tidak dimasukkan agar scoping tetap simetris.

### 18.3 Panel "Retensi Pengguna" — ✅ GUARD BEKERJA Jujur (bukan angka kosong)

| Lapisan | Evidence |
|---|---|
| Raw Turso | Total user nyata = 2 · tiap cohort size 1 |
| API `retention` | `cohortGuardActive: true` (guard cohort ≥ 10 user) |
| UI panel | Empty state "Belum cukup data" — TIDAK menampilkan angka menyesatkan |

Ini justru bukti guard P10.2b bekerja sebagaimana dirancang: dengan cohort
< 10 user, panel memilih empty-state honest alih-alih retention palsu
(0% / 100% dari 1 user). Tetap guard-active sampai cohort beta riil ≥ 10
user — batas yang disengaja, bukan gap.

### 18.4 Temuan terkait selama verifikasi runtime

- **Bug dedupe `recommendation_shown` ditemukan & diperbaiki**: StrictMode dev
double-mount memanggil `load()` dua kali → event `recommendation_shown`
ter-inflasi 2× per item (denominator CTR membengkak) padahal `ai_result_shown`
sudah di-dedupe. Fix minimal: pindahkan fire `recommendation_shown` ke dalam
guard `trackedIdsRef` di `AiHubPage.tsx` (TimelineSection) &
`AiTimelinePage.tsx` — diverifikasi ulang: 1 event per item. Detail:
lih. §3 (event inventory) & §4 (definisi CTR) — denominator harus akurat
agar CTR terukur benar.
- **E2E regression baru**: `e2e/admin-monitoring-feedback-rate.spec.ts`
(3 test — auth gate 401, shape endpoint + per-feature eksak, render panel
light/dark) + `e2e/helpers/mintSession.ts` (+`seedFeedbackRateFixtures` /
`cleanupFeedbackRateFixtures`, prefiks `e2e-fr-`) + `package.json`
(`test:e2e:feedback-rate-panel`).
- **Fix scoping chart spec**: `e2e/admin-monitoring-chart.spec.ts` menghitung
`.recharts-line` global — halaman kini punya 2 line chart (Tren Biaya +
Rekomendasi AI yang punya data) → filter fitur tunggal menghitung 2 garis.
Scope ke card "Tren Biaya" (pola panel spec lain).

### 18.5 Panel "AI Cost & Health" (usage summary vs `ai_usage_metrics`) — ✅ VALID (3 lapisan)

| Lapisan | Nilai | Sumber |
|---|---|---|
| UI `/admin/monitoring` | "Ringkasan per Fitur (7 Hari)": Gmail Sync Rp 310 · Insight Generator Rp 266 · advisor Rp 220 · OCR Rp 71 · Financial Advisor Rp 42; Top Token: Gmail Sync 105.4k · Insight 62.2k · OCR 16.2k; Cost per Fitur: Agent Search 1049 calls/350ms · Insight 99/11128ms · Gmail 80/4630ms · Fraud 21/9125ms · Advisor 11/18035ms — semua render dari payload API yang sama | snapshot preview live |
| API `/api/admin/metrics/ai-usage` | `summary.calls = 1268` · `tokens = 208124` · `costIdr = 925.94` · `avgTimeMs = 2444` · per-feature breakdown (agent_search 1049 calls, insight_generator 99, gmail_sync 80, fraud_detection 21, …) | response live (sesi admin minted) |
| DB `ai_usage_metrics` | **1268 rows** — identik dengan `summary.calls` | `SELECT COUNT(*)` langsung ke Turso |
| Konsistensi cost | `ai_cost_daily` alert (323.27) = `SUM(estimated_cost_idr)` 24h terakhir (323.27) — panel Cost & panel Alerts memakai komputasi yang sama | cross-check antar endpoint |

Kesimpulan: 3 lapisan identik — denominator & agregasi usage/cost cocok persis
dengan baris mentah; per-feature breakdown konsisten dengan agregator
`getAIUsageSummary` (tipe `AIUsageSummary` di `src/types/metrics.ts`). Tidak ada
PII di payload (feature + agregat numerik saja).

### 18.6 Panel "Prioritas Perbaikan Prompt" (feedback-summary vs `ai_feedback`) — ✅ VALID (3 lapisan)

| Lapisan | Nilai | Sumber |
|---|---|---|
| UI `/admin/monitoring` | Header "28 feedback · 7 feature · negatif 43%" + ranking: Natural Conversation 100/100 (mismatched) · AI Search 67/100 (not_helpful) · Financial Advisor 50/100 · Gmail Sync 50/100 · OCR Receipt 50/100 (irrelevant) · AI Insight 25/100 · Fraud L2 0/100 — plus prompt builder & file sumber per feature + arah perbaikan | snapshot preview live |
| API `/api/admin/metrics/feedback-summary` | `totalFeedback = 28` · `overallNegativeRate = 0.429` · `featuresWithFeedback = 7` · ranking per feature (conversation score 100, search 67, …) + action plan + `FEATURE_PROMPT_MAP` | response live |
| DB `ai_feedback` | **28 rows** · **7 distinct feature** — identik | `SELECT COUNT(*)` / `COUNT(DISTINCT feature)` ke Turso |
| Enum sinkron | `helpful/not_helpful/mismatched/irrelevant/already_done/skip` — konsisten dengan `FEEDBACK_RATINGS` (unit test sinkronisasi enum) | §10 |

Kesimpulan: 3 lapisan identik — agregasi murni `feedbackMetrics.js` membaca
seluruh `ai_feedback` tanpa filter tersembunyi; ranking deterministik
(priorityScore 0-100, confidence high/medium/low) — numerator feedback akurat
(28 = 28).

### 18.7 Panel "Alerts" — ✅ VALID (live evaluation dari `alert_rules`, 3 lapisan)

| Lapisan | Nilai | Sumber |
|---|---|---|
| UI `/admin/monitoring` | 7 kartu alert semua `OK`: `ai_cost_daily 323.27 > 50000 (1440m)` · `gmail_sync_failures 0 > 10 (10m)` · `agent_search_error_rate 0 > 0.1` · `ocr_failure_rate 0 > 0.2` · `cache_hit_rate 1 < 0.5` · `fraud_flags 0 > 10` · `ai_cost_monthly 925.94 > 100000 (43200m)` | snapshot preview live |
| API `/api/admin/metrics/alerts` | **7 alerts** semuanya `status: "ok"` — nilai & threshold identik dengan UI | response live |
| DB `alert_rules` | **7 rules · 7 active (`is_active=1`)** — identik dengan jumlah alerts | `SELECT COUNT(*)` ke Turso |
| Komputasi | `ai_cost_daily.currentValue 323.27` = `SUM(estimated_cost_idr)` 24h (323.27) — evaluasi live terhadap data nyata, bukan mock | cross-check §18.5 |

Kesimpulan: 3 lapisan identik — setiap rule dievaluasi terhadap metrik nyata;
semua status `ok` (bukan kosong/undefined); tidak ada secret di payload (name +
metricName + currentValue + threshold saja).

### 18.8 Stability gate 3× — panel admin trio (2026-08-08)

Trio spec (7 test: chart 1 · recommendation 3 · feedback-rate 3) dijalankan
melalui gate resmi — gate lulus di attempt pertama (exit-on-success), jadi
**3 run = 3 invokasi gate terpisah**, masing-masing 7/7:

```bash
E2E_CMD="npx playwright test e2e/admin-monitoring-chart.spec.ts \
  e2e/admin-monitoring-recommendation.spec.ts \
  e2e/admin-monitoring-feedback-rate.spec.ts" \
  SEED_CMD="true" bash scripts/e2e-stability-gate.sh
```

Hasil **verifikasi ulang (re-run 2026-08-08, sesi kedua)** — 3 invokasi gate
baru, semuanya lulus di attempt 1/3, 0 flaky:

| Run (invokasi gate) | Attempt 1 | Waktu | Flaky/Failed |
|---|---|---|---|
| 1 | **7 passed** | 41.3s | 0 |
| 2 | **7 passed** | 41.8s | 0 |
| 3 | **7 passed** | 37.7s | 0 |

(Sesi pertama turn sebelumnya: 43.9s · 39.5s · 37.0s — juga 7/7 ×3, 0 flaky.)

Verdict: **0 flaky dalam 2× sesi × 3× run berurutan** — trio panel admin
stabil berulang (rendering, auth gate 401, kontrak numerik deterministik).
Stability gate adalah gate resmi CI (`scripts/e2e-stability-gate.sh`) —
kegagalan hanya dianggap regresi bila 3× berturut gagal; di sini tidak ada
satu pun attempt yang gagal di kedua sesi.

### 18.9 Evidence screenshots (light & dark) — 2026-08-09

Screenshot panel admin trio diambil live (preview, user `demo@cashflow.test`,
theme dipaksa via localStorage `cashflow-theme`, viewport 1440×900 @2×,
element screenshot per kartu panel). File: `docs/assets/screenshots/`.

| Panel | Light | Dark |
|---|---|---|
| Rekomendasi AI (shown/opened/CTR) | `admin-monitoring-recommendation.png` | `admin-monitoring-recommendation-dark.png` |
| Feedback Rate (feedback ÷ views) | `admin-monitoring-feedback-rate.png` | `admin-monitoring-feedback-rate-dark.png` |
| Retensi Pengguna (D1/D7/D14/D28) | `admin-monitoring-retention.png` | `admin-monitoring-retention-dark.png` |

**Regenerasi satu perintah (2026-08-09):** `scripts/capture-admin-panels.mjs`
(`npm run capture:admin`) — mint sesi admin otomatis + seed fixture
deterministik `e2e-*` (ai-cost · recommendation · feedback-rate · retention,
REUSE fungsi `e2e/helpers/mintSession.ts` yang diuji e2e) + Playwright headless
light/dark + cleanup otomatis (fixture & sesi dihapus di `finally`). Flag:
`--theme light|dark|both` · `--email` · `--out` · `--no-seed` · `--keep-data` ·
`--viewport WxH`. Periode panel otomatis di-toggle ke "90 Hari" SETELAH tiap
reload tema (cohort retention 40 hari lalu di luar window default 7 hari —
pola `admin-monitoring-retention.spec.ts:189`).

Catatan kejujuran evidence:
- **Rekomendasi AI & Feedback Rate** menampilkan data live nyata akun demo
  (20 shown / 5 opened / CTR 25% · 27 feedback / 129 views) — konsisten
  §18.1/§18.2.
- **Retensi** di-render dengan cohort deterministik seed `e2e-ret-*`
  (1 cohort 40 hari lalu, D1 1.0 · D7 0.6 · D14 0.4 · D28 0.2 — fixture E2E
  yang sama dengan `admin-monitoring-retention.spec.ts`) supaya tabel cohort
  terlihat; fixture dihapus segera setelah capture. Di produksi panel
  menampilkan empty state "Belum cukup data" sampai cohort riil ≥ 10 user
  (§18.3) — guard P10.2b, bukan angka kosong.

---

## Final Report

### Executive Summary
Instrumentasi closed-beta CashFlow **valid, user-scoped, privacy-safe**. Dua gap signifikan ditutup dengan fix minimal (retention signal + memory observability); sisanya keputusan produk → deferred. Verdict: **BETA READY WITH CONDITIONS**.

### Current Product Validation Readiness
Teknis ✓ (760 unit, typecheck, lint) · Analitik ✓ (event inventory + retention + memory) · Privasi ✓ · UX ✓ · Observability ✓.

### Event Coverage
25+ event server-side terverifikasi; inventory lengkap di §3.

### Metric Coverage
Seluruh metrik kontrak kini tersedia: CTR (P10.2/P10.2c) & Feedback Rate = feedback ÷ `ai_result_shown` (P10.2i).

### Funnel Coverage
VALID — exposure/opened/action terukur via track events `ai_hub_view` / `recommendation_shown` / `recommendation_opened` (P10.2, undercount hub ditutup P10.2e); CTR = opened ÷ shown terukur & divisualisasikan per hari/feature/eventType (P10.2c/P10.2d).

### Retention Coverage
FIXED — `user_active` (1 baris/user/hari UTC, dedupe, non-PII, tested).

### Timeline / Memory / Feedback Coverage
Timeline PASS (P9, 39 test terkait) · Memory PASS (+`ai_memory_used`) · Feedback PASS (enum konsisten, pipeline end-to-end).

### Data Quality
No data deleted; checks documented (§10); future timestamps & invalid state ditolak fail-closed.

### Privacy/Security
Guard aktif di kedua writer; metadata baru minimal; log redaction; user-scoped.

### Fixes Performed
`observabilityMiddleware.js` (user_active) · `metricsService.js` (export getMetricsClient) · `geminiRoutes.js` (ai_memory_used) · 2 file test baru (9 test) · `PRODUCT_METRICS.md` (§5, §5b).

### Tests
Unit suite kini **786 passed + 5 skipped** (760 @P10.2k → +26 `terminal.test.ts` P10.3) · typecheck 0 · lint 0 · e2e **71 test** (68 → +3 `admin-monitoring-feedback-rate.spec.ts`, verifikasi runtime §18).

### P10.2b Files Changed (retention dashboard)
`server/lib/retentionMetrics.js` (baru, pure) · `server/services/metricsService.js` (getRetentionMetrics) · `server/routes/adminMetricsRoutes.js` (GET /retention) · `src/types/metrics.ts` (RetentionMetrics/RetentionCohort/RetentionDayStat) · `src/services/adminMetrics.ts` (fetchRetentionMetrics) · `src/pages/admin/MonitoringPage.tsx` (RetentionPanel) · `tests/unit/retentionMetrics.test.ts` (baru, 9 test) · `docs/ai-product/PRODUCT_METRICS.md`.

### P10.2 Files Changed
`server/routes/aiProductRoutes.js` (POST /track + TRACK_EVENTS whitelist) · `server/lib/recommendationEngagement.js` (baru) · `server/services/metricsService.js` (getRecommendationEngagement) · `server/routes/adminMetricsRoutes.js` (GET recommendation-engagement) · `src/services/aiProductService.ts` (trackAiProductEvent) · `src/features/ai-product/AiHubPage.tsx` (ai_hub_view) · `src/features/ai-product/timeline/AiTimelinePage.tsx` (shown/opened, anti double-count) · `tests/unit/trackEventRoutes.test.ts` (baru) · `tests/unit/recommendationEngagement.test.ts` (baru) · `docs/ai-product/PRODUCT_METRICS.md`.

### P10.2c Files Changed (panel Rekomendasi AI)
`server/lib/recommendationEngagement.js` (+`aggregateRecommendationByDay`, pure) · `server/services/metricsService.js` (getRecommendationEngagement → `{ shown, opened, ctr, byFeature, byDay }`) · `src/types/metrics.ts` (+`RecommendationDayStat`, `RecommendationEngagement.byDay`) · `src/pages/admin/MonitoringPage.tsx` (+`RecommendationPanel`: ringkasan, line chart CTR harian, breakdown per feature) · `tests/unit/recommendationEngagement.test.ts` (+3 byDay) · `docs/ai-product/PRODUCT_METRICS.md` (§2).

### P10.2d Files Changed (CTR per event type)
`server/routes/aiProductRoutes.js` (+`eventType` di `TRACK_CREATE_SCHEMA` & metadata, validasi enum `EVENT_TYPES`) · `server/lib/recommendationEngagement.js` (+`aggregateRecommendationByEventType`, pure) · `server/services/metricsService.js` (getRecommendationEngagement → `{..., byEventType }`) · `src/types/metrics.ts` (+`RecommendationEventTypeStat`, `byEventType`) · `src/services/aiProductService.ts` (meta `eventType`) · `src/features/ai-product/timeline/AiTimelinePage.tsx` (kirim `it.event_type` pada shown/opened) · `src/pages/admin/MonitoringPage.tsx` (+section "Per Event Type") · `tests/unit/trackEventRoutes.test.ts` (+3) · `tests/unit/recommendationEngagement.test.ts` (+3) · `docs/ai-product/PRODUCT_METRICS.md` (§2).

### P10.2e Files Changed (tutup undercount hub)
`src/features/ai-product/AiHubPage.tsx` (TimelineSection: 5 entri terbaru lintas jenis + `recommendation_shown` per item via `trackedIdsRef`; feedback per-entri memakai feature asli) · `src/pages/admin/MonitoringPage.tsx` (footnote scoping + hub) · `docs/ai-product/PRODUCT_METRICS.md` (§2 scoping note) · `docs/product/P10_1_CLOSED_BETA_INSTRUMENTATION_AUDIT.md` (ini).

### P10.2f Files Changed (event registry)
`docs/ai-product/EVENT_REGISTRY.md` (baru — registri payload schema) · `docs/product/P10_1_CLOSED_BETA_INSTRUMENTATION_AUDIT.md` (§3 kriteria 3 di-mark FIXED; §17 +P10.2f).

### P10.2g Files Changed (E2E panel Rekomendasi AI)
`e2e/admin-monitoring-recommendation.spec.ts` (baru — 3 test: auth gate, shape endpoint, render panel) · `e2e/helpers/mintSession.ts` (+`seedRecommendationFixtures` / `cleanupRecommendationFixtures`, prefiks `e2e-reco-`) · `package.json` (+`test:e2e:recommendation-panel`) · `docs/product/P10_1_CLOSED_BETA_INSTRUMENTATION_AUDIT.md` (§17 +P10.2g).

### P10.2h Files Changed (CI coverage)
`.github/workflows/e2e.yml` (komentar gate: auto-discovery semua spec e2e/ + count 50→65) · `docs/ci/CI_ARCHITECTURE.md` (50→65 test) · `docs/ci/TESTING_STRATEGY.md` (50→65 test) · `docs/product/P10_1_CLOSED_BETA_INSTRUMENTATION_AUDIT.md` (§17 +P10.2h).

### P10.2i Files Changed (Feedback Rate)
`server/routes/aiProductRoutes.js` (+`ai_result_shown` di TRACK_EVENTS) · `server/lib/feedbackRate.js` (baru, pure — aggregateFeedbackRate) · `server/services/metricsService.js` (+getFeedbackRate) · `server/routes/adminMetricsRoutes.js` (GET /feedback-rate) · `src/services/aiProductService.ts` (+event union) · `src/features/ai-product/timeline/AiTimelinePage.tsx` (ai_result_shown per event) · `src/features/ai-product/AiHubPage.tsx` (hub insight/health/simulation + TimelineSection per entri) · `src/features/advisor/AdvisorPage.tsx` (per report) · `src/features/ai-product/chat/ConversationAnswer.tsx` (per jawaban) · `src/types/metrics.ts` (+FeedbackRateSummary) · `src/services/adminMetrics.ts` (+fetchFeedbackRate) · `src/pages/admin/MonitoringPage.tsx` (+FeedbackRatePanel) · `tests/unit/feedbackRate.test.ts` (baru, 10) · `tests/unit/feedbackRateApi.test.ts` (baru, 5) · `tests/unit/trackEventRoutes.test.ts` (+1) · `docs/ai-product/EVENT_REGISTRY.md` (+ai_result_shown) · `docs/ai-product/PRODUCT_METRICS.md` (§3 Feedback Rate) · `docs/product/P10_1_CLOSED_BETA_INSTRUMENTATION_AUDIT.md` (ini).

### P10.2j Files Changed (step CI eksplisit panel Rekomendasi AI)
`.github/workflows/e2e.yml` (komentar gate direvisi — primary gate tetap full suite — + step baru `npm run test:e2e:recommendation-panel` setelah stability gate) · `docs/product/P10_1_CLOSED_BETA_INSTRUMENTATION_AUDIT.md` (§17 +P10.2j; item 8 P10.2h direvisi — keputusan awal "tanpa step redundan" di-revisi atas permintaan produk).

### P10.2k Files Changed (E2E panel Retensi + fix createdAt)
`server/services/metricsService.js` (fix query cohort: CASE typeof normalization — TEXT ISO vs INTEGER epoch) · `e2e/admin-monitoring-retention.spec.ts` (baru — 3 test) · `e2e/helpers/mintSession.ts` (+`seedRetentionFixtures`/`cleanupRetentionFixtures`, prefiks `e2e-ret-`) · `package.json` (+`test:e2e:retention-panel`) · `tests/unit/retentionMetrics.test.ts` (+1, kasus eksak 10/6/4/2) · `docs/ai-product/PRODUCT_METRICS.md` (§5) · `docs/product/P10_1_CLOSED_BETA_INSTRUMENTATION_AUDIT.md` (§17 +P10.2k) · count suite e2e 65→68 di `docs/ci/*`, `docs/e2e/*`, `.github/workflows/e2e.yml`, `docs/audit/FEATURE_COMPLETION_MATRIX.md` (unit files 59→61).

### Remaining Gaps
alerting/support ops (ops channel email/webhook belum dikonfigurasi).

### Beta Readiness Verdict
**BETA READY WITH CONDITIONS** — 4 kondisi (§15).

### Recommended Next Step
P10.2l: (1) alerting/support channel ops; (2) retention dashboard riil setelah cohort ≥ 10 user; (3) feedback → candidate memory (P9 §14).

### Files Changed
`server/middleware/observabilityMiddleware.js` · `server/services/metricsService.js` · `server/routes/geminiRoutes.js` · `tests/unit/observabilityMiddleware.test.ts` (baru) · `tests/unit/memoryUsageObservability.test.ts` (baru) · `docs/ai-product/PRODUCT_METRICS.md` · `docs/product/P10_1_CLOSED_BETA_INSTRUMENTATION_AUDIT.md` (ini).
