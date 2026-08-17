# P9 — AI Timeline: Repository Audit

> **Sprint 1.5 — P9** · Audit dilakukan SEBELUM menulis kode (evidence-first).
> Hasil audit menentukan bahwa **`ai_timeline` sudah ada** — strategi = isi gap minimal,
> BUKAN build ulang (P9 §30: "Jangan membangun ulang bila sudah fully implemented").

## 1. Existing Timeline Infrastructure

| Komponen | Lokasi | Detail |
|---|---|---|
| Tabel `ai_timeline` | `turso-schema.sql` | id, user_id, feature, title, body, confidence, payload (≤8KB), created_at + index `(user_id, created_at DESC)` |
| API dasar | `server/routes/aiProductRoutes.js` | GET (feature filter, limit 1-200 default 50) & POST (validasi: feature enum, title ≤200, body ≤2000, confidence 0-1, payload objek ≤8KB) |
| Producer conversation | `server/routes/conversationRoutes.js` | `recordTimeline` fire-and-forget (P8) |
| UI dasar | `src/features/ai-product/AiHubPage.tsx` | `TimelineSection` (list per feature, manual add, badge confidence, feedback per entri) |
| Client | `src/services/aiProductService.ts` | `listTimeline(feature)` → array · `addTimelineEntry` |

## 2. Existing Database Tables (terkait)

- `ai_feedback` (user-scoped, item_id → korelasi feedback↔event) + index.
- `ai_memory` (user-scoped, UNIQUE user+category+key).
- `ai_usage_metrics` (cost/observability) · `system_metrics` (event counters — pola untuk observability timeline).

## 3. Existing APIs (terkait)

- `POST/GET /api/ai-product/feedback` · `GET/POST/PUT/DELETE /api/ai-product/memory`.
- `POST /api/ai-product/conversation` (mencatat timeline).
- `POST /api/gemini/monthly-report` & `/api/gemini/advisor` (penghasil insight/rekomendasi — belum mencatat timeline).
- Admin: `GET /api/admin/metrics/feedback-summary` (feedback metrics).

## 4. Existing UI Components (reuse)

- `AiTrustMeta` · `AiFeedbackButtons` (itemId) · `AiConfidenceBadge` (interpretasi) · `src/lib/explainability.ts`.
- Pola halaman: `Header` · `Card` · `EmptyState` · `ChartSkeleton` · `cn`/`formatCurrency`.

## 5. Existing Event Producers

| Producer | Mencatat timeline? |
|---|---|
| Conversation (P8) | ✅ |
| Insight (monthly-report) | ❌ |
| Advisor | ❌ |
| Feedback | ❌ (hanya ke `ai_feedback`) |
| Memory | ❌ (hanya ke `ai_memory`) |

## 6. Existing AI Memory

`ai_memory` + `loadUserMemory` (geminiRoutes) di-injeksi ke prompt advisor & monthly-report
(blok "AI ingat", framing BUKAN instruksi, cap 12 item/1200 char — `server/lib/aiMemoryContext.js`).

## 7. Existing Feedback

`ai_feedback` + pipeline: `feedback → evaluation dataset → future training` + CLI prioritas +
endpoint admin + benchmark feedback-driven (topPriority → kategori live).

## 8. Missing Capabilities (gap → diimplementasikan P9)

| # | Gap | Keputusan |
|---|---|---|
| 1 | `event_type` kanonik (INSIGHT/RECOMMENDATION/CONVERSATION/FEEDBACK/MEMORY_UPDATE/RISK) | Kolom baru + mapping deterministik (reuse tabel) |
| 2 | Status + transisi (new/viewed/completed/dismissed) | Kolom baru + state machine `canTransition` |
| 3 | Pagination (default 20, cursor, hasMore) | Keyset `(created_at, id)` + `before` |
| 4 | Detail event + feedback terkait | GET `/:id` + join `ai_feedback.item_id` |
| 5 | Producer insight & advisor | `recordTimeline` fire-and-forget di geminiRoutes |
| 6 | Feedback connection (no-duplicate) | itemId → timeline = korelasi; tanpa itemId → event `feedback` |
| 7 | Memory connection | Event `memory_update` (set/delete) — aksi user, bukan feedback→memory otomatis |
| 8 | Halaman `/ai/timeline` (filter, grouping, detail, aksi, feedback, muat lebih) | Halaman baru (TimelineSection existing terlalu sempit) |
| 9 | Observability `timeline_view/event_open/status_update` | `system_metrics` |

## 9. Minimal Implementation Plan (dieksekusi)

1. Schema: ALTER idempotent `event_type` + `status`.
2. `server/lib/timelineEvents.js` (murni): mapping, sanitize, state machine, builders, insert.
3. `aiProductRoutes.js`: pagination keyset, GET `/:id`, PATCH status, wiring feedback/memory.
4. `geminiRoutes.js`: recordTimeline insight/advisor. `conversationRoutes.js`: konsisten via lib.
5. Client: `listTimeline` paginated, `getTimelineEvent`, `updateTimelineStatus`.
6. UI: `timelineGroup.ts` (murni) + `eventMeta.ts` + `AiTimelinePage.tsx` + route/nav + link AI Hub.
7. Observability: 3 metric.
8. Test: lib murni ×2 + API harness + E2E.
9. Docs: AI_TIMELINE.md (rewrite) · P9_AI_TIMELINE_REPORT.md · CLOSED_BETA_READINESS.md · PRODUCT_METRICS.md · update SPRINT_1_5_REPORT.md & AI_PRODUCT_ARCHITECTURE.md.

## 10. Hasil

- **692 unit test passed + 5 skipped** · typecheck 0 · lint 0 · build OK · E2E `ai-timeline.spec.ts` PASS.
- Tidak ada tabel baru, tidak ada perubahan arsitektur, tidak ada rewrite fitur stabil.
- Detail implementasi: `P9_AI_TIMELINE_REPORT.md` · `AI_TIMELINE.md`.
