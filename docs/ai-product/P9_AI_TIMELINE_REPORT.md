# P9 — AI Timeline & Longitudinal Financial Intelligence: Laporan

> **Sprint 1.5 — P9** · Tanggal: 2026-08-07 (update 2026-08-09: §14 evidence observability live) · Status: **Diterapkan**

## 1. Current State (sebelum P9)

AI CashFlow sudah memiliki fondasi Product Experience: explainability (`AiTrustMeta`,
`AiConfidenceBadge`), feedback loop (`ai_feedback`), AI Memory (`ai_memory`, di-injeksi ke
advisor/insight), Natural Conversation (P8), simulation & financial health (deterministik),
Cost Monitoring, dan AI Benchmark. Runtime HEALTHY (DNS/Turso recovery selesai).

## 2. Existing Timeline Capability (audit §6 super prompt)

Sebelum P9 sudah ada (ditemukan via audit — TIDAK dibangun ulang):

| Capability | Ada | Detail |
|---|---|---|
| Tabel `ai_timeline` | ✅ | id, user_id, feature, title, body, confidence, payload, created_at + index |
| API dasar | ✅ | GET (limit 50, feature filter) & POST `/api/ai-product/timeline` (validasi ketat) |
| Producer conversation | ✅ | `conversationRoutes.recordTimeline` (fire-and-forget) |
| UI dasar | ✅ | `TimelineSection` di AiHubPage (list + manual add + feedback) |
| Client service | ✅ | `listTimeline` / `addTimelineEntry` di `aiProductService.ts` |
| Komponen reuse | ✅ | AiTrustMeta · AiFeedbackButtons · AiConfidenceBadge · explainability lib |

## 3. Missing Capability → Gap → Implementasi (minimal, P9 §30)

| Gap | Implementasi | File |
|---|---|---|
| Event model (INSIGHT/RECOMMENDATION/CONVERSATION/FEEDBACK/MEMORY_UPDATE) | Kolom `event_type` + mapping deterministik feature→type (server-side) | `turso-schema.sql`, `server/lib/timelineEvents.js` |
| Status + transisi | Kolom `status` + state machine `canTransition` (new→viewed→completed/dismissed, final) | `timelineEvents.js`, PATCH `/timeline/:id/status` |
| Pagination (P9 §18: default 20, cursor) | Keyset `(created_at, id)` + `hasMore` + `before` | GET `/timeline` |
| Detail view + evidence | GET `/timeline/:id` + feedback join (item_id) | GET `/timeline/:id` |
| Feedback connection (P9 §13) | Feedback dgn itemId timeline → korelasi via item_id (no duplikat); tanpa itemId → event `feedback` | POST `/feedback` |
| Memory connection (P9 §14) | Event `memory_update` (set/delete) — aksi user, bukan feedback→memory otomatis | POST/DELETE `/memory` |
| Producer insight & advisor | `recordTimeline` fire-and-forget di monthly-report & advisor (body=summary, confidence null) | `geminiRoutes.js` |
| Halaman `/ai/timeline` | Filter chips + grouping (Hari Ini/Kemarin/Minggu Ini/Sebelumnya) + detail + aksi status + feedback + muat lebih | `AiTimelinePage.tsx`, `timelineGroup.ts`, `eventMeta.ts` |
| Observability (P9 §23) | `timeline_view` · `timeline_event_open` · `timeline_status_update` | routes (system_metrics) |
| Client service | `listTimeline` paginated, `getTimelineEvent`, `updateTimelineStatus` | `aiProductService.ts` |

## 4. Database Changes

- `ai_timeline` + 2 kolom (idempotent ALTER untuk DB lama): `event_type TEXT NOT NULL DEFAULT 'other'`, `status TEXT NOT NULL DEFAULT 'new'`.
- Tidak ada tabel baru. Tidak ada perubahan schema lain.

## 5. API Changes

- GET `/timeline`: `{ items, hasMore }` (breaking — caller `AiHubPage` diperbarui), query baru `eventType`, `before`, limit clamp 1-100 default 20.
- GET `/timeline/:id` (baru) — detail + feedback terkait.
- PATCH `/timeline/:id/status` (baru) — state machine.
- POST `/feedback` & `/memory`, DELETE `/memory/:id` — side-effect timeline (fire-and-forget).

## 6. Frontend Changes

- **Baru**: `AiTimelinePage.tsx`, `timelineGroup.ts`, `eventMeta.ts`.
- **Diubah**: `aiProductService.ts`, `router.tsx` (`ai/timeline` lazy), `navigation.ts` (nav), `AiHubPage.tsx` (TimelineSection → 5 entri + link "Lihat semua").

## 7. Security Changes

- User-scoping dipertahankan & diverifikasi test (event user lain → 404).
- `event_type` dihitung server (klien tidak set). `status` divalidasi enum.
- Sanitasi payload (primitives ≤ 8KB); tidak menyimpan raw response/prompt.
- Observability tanpa PII (metadata hanya `{from, to}`).

## 8. Metrics (P9 §23-24)

`timeline_view` · `timeline_event_open` · `timeline_status_update` di `system_metrics`.
Produk metrics (open/acceptance/completion rate, retention D1/D7/D14/D28) didefinisikan di
`PRODUCT_METRICS.md` — dihitung dari cohort nyata closed beta, BUKAN dari data sintetis.

## 9. Tests

| Jenis | File | Coverage |
|---|---|---|
| Unit (lib) | `timelineEvents.test.ts` (17) | eventType mapping, sanitize payload, normalize (cap/confidence guard), state machine, builder feedback/memory, insert |
| Unit (lib) | `timelineGroup.test.ts` (9) | grouping hari ini/kemarin/minggu ini/sebelumnya, ISO & space-format (UTC), tanpa tanggal |
| Unit (API) | `timelineApi.test.ts` (15) | gate requireAuth, user scoping, pagination/hasMore/clamp/keyset (before+beforeId), detail+feedback, 404 antar-user, state machine 400/200, wiring feedback/memory |
| E2E | `ai-timeline.spec.ts` | seed via API → render → filter Percakapan → detail+evidence → feedback 👍 → feedback terkait di detail → status Selesai (P9 §20) |
| E2E (dogfood live, 2026-08-09) | `ai-dogfood.spec.ts` · `ai-detail-events.spec.ts` · `ai-status-machine.spec.ts` | verifikasi telemetry langsung di DB (`recommendation_shown/opened`, `ai_result_shown`, `timeline_*`, `ai_feedback`) — evidence & angka live di §14 |

## 10. Build & Regression

- Typecheck: **0 error** · Lint (tsc): **0 error** · E2E typecheck: **0 error** · Build: **OK**
- Unit suite: **694 passed + 5 skipped** (47 test P9 baru: timelineEvents 17 · timelineGroup 9 · timelineApi 15 + 6 lain)
- E2E `ai-timeline.spec.ts`: **PASS** (lokal, 15.8s) · route baru terverifikasi live (401 tanpa auth)
- No perubahan pada: Better Auth · Gmail Sync · SSE · AI provider · Cost Monitoring · benchmark.

## 11. Closed Beta Readiness

Lihat `CLOSED_BETA_READINESS.md`. P9 menyelesaikan blocker teknis terakhir (AI Timeline &
observability engagement). Sisa gate adalah **data nyata pengguna** — bukan teknis.

## 12. Remaining Technical Debt

- Insight/advisor body hanya `summary` (structure lengkap tersedia tapi tidak disimpan — trade-off penyimpanan ringkas).
- Diff otomatis antar event belum diimplementasikan (roadmap).
- Feedback → candidate memory (P9 §14) belum otomatis (aturan konservatif = roadmap).

## 13. Status Final (gate P9)

```
Infrastructure:      PASS (runtime sehat, schema ter-apply)
AI Timeline:         PASS (event model, status, pagination, detail, UI, producer)
AI Explainability:   PASS (confidence ber-interpretasi, evidence, trust meta)
AI Feedback:         PASS (terkait via item_id, tanpa duplikat, dataset evaluasi)
AI Memory:           PASS (events set/delete, tetap di-injeksi advisor/insight)
AI Trust:            PASS (AiTrustMeta/AiConfidenceBadge di detail)
Observability:       PASS (3 metric timeline di system_metrics)
Security:            PASS (user-scoped, no raw response, no PII)
Build:               PASS (typecheck/lint/build)
Tests:               PASS (45 unit P9 + E2E hijau)
Closed Beta Ready:   YES — secara TEKNIS (validasi produk menunggu cohort nyata)
```

**Catatan penting (P9 §26-27)**: "ready" di sini = *technical readiness*. Product validation
membutuhkan 10-30 user nyata selama 2-4 minggu; data sintetis (21 feedback, seed E2E) TIDAK
boleh dipakai sebagai evidence product-market.

## 14. Evidence Observability Live — Dogfood E2E (2026-08-09)

Pipeline observability diverifikasi LIVE lewat 3 spec dogfood yang men-drive alur nyata di
browser (user `demo@cashflow.test` = Dafa, `scripts/seedDemoData.mjs`) dan mengunci telemetry
langsung di DB (`system_metrics` + `ai_feedback`), bukan hanya UI:

| Spec | Alur dogfood | Yang di-lock | Status |
|---|---|---|---|
| `e2e/ai-dogfood.spec.ts` | AI Hub → timeline → detail → feedback 👍 | `ai_hub_view` · `recommendation_shown` (denominator CTR) · `recommendation_opened` (numerator CTR) · `ai_result_shown` (denominator Feedback Rate) · row `ai_feedback` (helpful) | ✅ PASS (`npm run test:e2e:ai-dogfood`) |
| `e2e/ai-detail-events.spec.ts` | Timeline → detail insight & conversation | `timeline_event_open` feature=event_type (insight/conversation) · `recommendation_opened` TIDAK menembak utk non-recommendation · status `new→viewed` + `timeline_status_update {from,to}` | ✅ PASS 2× (stabil) |
| `e2e/ai-status-machine.spec.ts` | Timeline → Selesai → invalid transisi | PATCH `:id/status` → `completed` di DB + UI · `timeline_status_update {new→completed}` · transisi `completed→dismissed` → **400** `VALIDATION_ERROR` + TIDAK ada metric · restore status demo | ✅ PASS 3× (stabil) |

### 14.1 Angka live (DB akun demo, 2026-08-09, setelah seluruh dogfood)

| Metric | Total | Keterangan |
|---|---|---|
| `ai_result_shown` | 214 | Denominator Feedback Rate — setiap kartu AI feedback-capable tampil |
| `recommendation_shown` | 34 | Denominator CTR (P10.2) — hanya event_type recommendation |
| `recommendation_opened` | 7 | Numerator CTR — buka detail rekomendasi (aksi user, tidak di-dedupe) |
| **CTR** | **7/34 ≈ 20.6%** | shown→opened |
| `timeline_view` | 51 | GET list timeline |
| `timeline_event_open` | 8 | GET detail (insight 2 + conversation 4 + lain) |
| `timeline_status_update` | 2 | PATCH status (keduanya `{from,to}` valid; transisi invalid TIDAK tercatat) |

**Feedback `ai_feedback` (Dafa):** helpful 5 · not_helpful 1 · mismatched 1 · irrelevant 1 ·
already_done 1 · skip 1. Rincian ini konsisten dengan panel admin "Feedback Rate" &
"Prioritas Perbaikan Prompt" (P10.2i/§7 AI_FEEDBACK).

**Distribusi `ai_timeline` (Dafa):** conversation 2 (completed) · insight 2 (new 1, viewed 1) ·
memory_update 1 (new) · recommendation 1 (completed) · risk 1 (dismissed) — semua state
machine transition tercatat sesuai P9 §12.

### 14.2 Bug nyata yang ditemukan dogfood → fix

Run pertama `ai-status-machine.spec.ts` **flaky**: tombol "Selesai" muncul lagi walau DB sudah
`completed`. Root cause: **race stale-response di `AiTimelinePage.load()`** — StrictMode dev
double-mount memicu 2× fetch `all` + fetch filter; response lama yang tiba belakangan menimpa
optimistic update status. Bukan dev-only (user ganti filter saat response in-flight di produksi
bisa melihat update-nya hilang).

**Fix:** guard `loadSeqRef` monotonic di `AiTimelinePage.tsx` — hanya response request terbaru
yang boleh menulis state (items/telemetry/error/loading); response basi dibuang. Optimistic
update Selesai menang karena klik tidak memanggil `load()`. Regression test ditambahkan di
`tests/unit/aiShownTelemetryDedup.test.tsx` (8 test — response basi tidak menimpa list & tidak
fire telemetry untuk item basi). Unit suite: **899 passed** · typecheck 0 · build OK.

### 14.3 Reproducibility

```bash
npm run test:e2e:ai-dogfood          # alur hub→timeline→detail→feedback
npm run test:e2e:ai-detail-events    # detail insight & conversation → timeline_event_open
npm run test:e2e:ai-status-machine   # Selesai (new→completed) + invalid 400
```

Ketiga spec self-sufficient (mint sesi Better Auth langsung ke Turso — tanpa Google OAuth),
menggunakan event DEMO (`demo-tl-*`) dan me-restore status + membersihkan `system_metrics` baru
di `afterAll` (dataset demo utuh — tidak ada mutasi permanen). Layak dijalankan di CI sebagai
regression guard observability (rekomendasi: job smoke bersama `e2e/contract/*`).
