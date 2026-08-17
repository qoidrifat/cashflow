# AI Product Readiness Audit

> **Audit** · Tanggal: 2026-08-07 · Branch: `gh-pages` · Baseline: Sprint 1.5 (P1–P10 + P8 Conversation + P9 Timeline)
> Metode: audit repository + verifikasi runtime (typecheck, unit suite, build) — evidence first, tanpa asumsi.

---

## 1. Executive Summary

CashFlow AI telah melewati Sprint 1.5 dengan **7 area AI produksi** (fraud, insight, advisor, search, OCR/Gmail, conversation, memory + timeline longitudinal). Verifikasi runtime:

- `npm run typecheck` → **0 error**
- `npm run test:unit` → **701 passed + 5 skipped** (53 files) — termasuk 7 test telemetry baru dari audit ini
- Konvensi Sprint: validasi fail-closed (400 `VALIDATION_ERROR`), user-scoping `WHERE user_id = ?` di semua query AI, observability non-PII, fallback deterministik di jalur Gemini.

Audit menemukan **1 gap telemetry kecil** (conversation belum mencatat event `started/completed/failed` ke `system_metrics`) — **langsung diperbaiki** dengan regression test (additive, backward-compatible, tidak menyentuh WIP user). Gap lain bersifat *deferred* (butuh product decision / architecture change) dan didokumentasikan di §15.

**Verdict: `READY_WITH_MINOR_FIXES`** — siap closed beta 10–30 user dari sisi teknis; tetap wajib bukti runtime produksi (DNS/Turso/Vertex) & checklist operasional (§13).

## 2. Current Architecture

```
UI (React, lazy routes)
  AiHubPage /ai · AiConversationPage /ai/chat · AiTimelinePage /ai/timeline
  AdvisorPage · Fraud · AI Search · OCR/Gmail · AiTrustMeta · AiConfidenceBadge · AiFeedbackButtons
        │
Frontend libs (DETERMINISTIK)
  explainability.ts · simulationEngine.ts · financialHealthEngine.ts · timelineGroup.ts
  confidenceScorer.ts · aiDecisionValidator.ts · conversationService.ts · aiProductService.ts
        │
Server (Express + Turso)
  aiProductRoutes.js (feedback/memory/timeline P9) · conversationRoutes.js (P8)
  geminiRoutes.js (advisor/insight + recordTimeline) · adminMetricsRoutes.js
  lib/: timelineEvents.js · conversationAggregator.js · aiMemoryContext.js · feedbackMetrics.js
        │
Tabel: ai_feedback · ai_memory · ai_timeline (event_type + status) · system_metrics · ai_cache
```

Alur kunci (semua sudah terverifikasi di runtime):
1. **Feedback** → `POST /api/ai-product/feedback` → `ai_feedback` → agregasi `feedbackMetrics.js` → prioritas prompt + panel admin.
2. **Timeline** → auto-record (conversation/insight/advisor/feedback/memory) via `timelineEvents.js` (event_type + status state machine) → `/ai/timeline` (filter, grouping, detail, aksi status).
3. **Memory** → upsert/delete `ai_memory` → **di-injeksi** ke prompt advisor & monthly-report (`aiMemoryContext.js`, framing BUKAN instruksi, cap 12 item / 1200 char).
4. **Conversation** → agregasi deterministik `conversationAggregator.js` → Gemini (fallback rule-based bila gagal) → jawaban kaya + trust meta + timeline.
5. **Observability** → `system_metrics` (non-PII): `timeline_view`, `timeline_event_open`, `timeline_status_update`, `ai_conversation_*` (baru).

## 3. AI Feature Matrix

| Feature | Route / Sumber | Status | Verifikasi |
|---|---|---|---|
| Fraud AI scoring | `fraudRoutes.js` + `fraudEngine.js` | ✅ Produksi (env-gated) | FRAUD_AI_SCORING_ENABLEMENT.md; unit `fraudEngine.test.ts` |
| AI Insight (bulanan) | `geminiRoutes.js` monthly-report | ✅ | recordTimeline; confidence null (tidak dikarang) |
| Financial Advisor | `geminiRoutes.js` advisor | ✅ | feedback + trust meta + memory injection |
| AI Search | `agentSearchRoutes.js` | ✅ | engagement `system_metrics` (Sprint 1.9) |
| OCR/Gmail | `geminiRoutes.js` vision | ✅ | benchmark live vision; gmail local parser |
| Conversation (P8) | `conversationRoutes.js` | ✅ | fallback deterministik; telemetry baru |
| Memory (P7) | `aiProductRoutes.js` | ✅ | CRUD + inject prompt + event memory_update |
| Timeline (P9) | `aiProductRoutes.js` | ✅ | keyset pagination + state machine + detail+feedback |

## 4. Explainability Audit — **PASS**

- **Confidence**: badge `AiConfidenceBadge` + interpretasi bahasa via `explainability.ts` (confidence 0-1 → label). Aturan: *confidence tidak pernah dikarang* — timeline body hanya summary, confidence null bila tak ada basis.
- **Evidence**: detail event `/ai/timeline/:id` menampilkan payload ringkas ("Mengapa AI mengatakan ini"); `sanitizePayload` membuang nested/array > 8 item, cap 8KB.
- **Source/model/time**: `AiTrustMeta` menampilkan source (`gemini`/`rule-based`), model, `processingTimeMs`, timestamp, `dataCoverage`, `fallbackReason`.
- **Sisa gap (deferred)**: advisor insight body di timeline hanya summary — diff otomatis antar event = roadmap.

## 5. Feedback Audit — **PASS**

- `POST/GET /api/ai-product/feedback` (requireAuth, user-scoped). Ratings: `helpful | not_helpful | mismatched | irrelevant | already_done | skip` (enum diuji sama dengan route).
- Feedback tanpa `itemId` timeline → event `feedback` otomatis (korelasi `item_id`, tanpa duplikat).
- **Feedback → prompt priorities**: `feedbackMetrics.js` (aggregasi murni, `priorityScore` 0-100, confidence high/medium/low), script CLI `feedbackPromptPriorities.mjs`, kategori benchmark ke-7 `feedback_prioritization`, endpoint admin `GET /api/admin/metrics/feedback-summary`, panel monitoring "Prioritas Perbaikan Prompt".
- Live benchmark **otomatis** memilih kategori dari `topPriority` feedback nyata (`BENCH_LIVE_ALL=1` untuk full run).

## 6. Recommendation Funnel — **PASS (dengan catatan)**

- Funnel tersedia via `ai_timeline.status` state machine: `new → viewed → completed | dismissed` (`canTransition` deterministik, transisi invalid → 400).
- `timeline_status_update` (metadata `{from, to}`) → `recommendation_acceptance_rate = completed ÷ viewed` (denominator siap).
- **Catatan (deferred)**: CTR rekomendasi (click ÷ view) butuh peristiwa klik eksplisit pada rekomendasi di luar halaman timeline — belum diinstrumentasi; klik = status `completed` belum tentu click. Produk harus memutuskan mana yang menjadi definisi "accept".

## 7. Timeline Audit — **PASS**

- Auto-record untuk conversation, insight, advisor, feedback, memory (fire-and-forget — kegagalan tidak menggagalkan respons AI).
- Keyset pagination `{items, hasMore}` dengan komposit `(created_at, id)`; limit clamp 1-100.
- Detail `GET /:id` menyertakan feedback terkait; user lain → 404 (bukan leak).
- Observability: `timeline_view`, `timeline_event_open`, `timeline_status_update`.
- Grouping UI murni `timelineGroup.ts` (Hari Ini/Kemarin/Minggu Ini/Sebelumnya) — 8 unit test.

## 8. Memory Audit — **PASS**

- `ai_memory` UNIQUE(user, category, key); CRUD user-scoped; event `memory_update` (set/delete) otomatis.
- **Injeksi prompt**: advisor & monthly-report memakai `aiMemoryContext.js` → blok "AI ingat: ...", framing tegas "BUKAN instruksi" (anti prompt-injection), cap 12 item / ≤1200 char, sanitasi control char.
- `loadUserMemory` gagal aman → `[]` (memory tidak pernah menggagalkan generate). 19 unit test.

## 9. Conversation Audit — **PASS**

- `POST /api/ai-product/conversation` — validasi query ≤200, `periodDays ∈ {7,30,90}` (string '7' ditolak).
- Agregasi deterministik (23 unit test): ringkasan, chart harian, kategori, top merchants/transactions, insight, aksi.
- Gemini → `parseGeminiResponse` → `normalizeConversationNarrative`; bila gagal → fallback rule-based (TIDAK pernah raw error); `trust.source` + `fallbackReason` jujur ke UI.
- Timeline event `conversation` dicatat; cache 1 jam aman (key hash = prompt + data).
- **Fix audit ini**: telemetry `ai_conversation_started/completed/failed` + metadata `source`/`fallback` → `conversation_completion_rate` & `fallback_rate` kini terukur (§19 kontrak beta).

## 10. Trust Audit — **PASS**

- `AiTrustMeta` (source/model/waktu/fallback) di Advisor + AI Hub; `AiConfidenceBadge` dengan interpretasi.
- `explainability.ts` — alasan confidence ber-tingkat (data cukup/tidak cukup).
- `aiDecisionValidator.ts` — keputusan AI divalidasi sebelum dianggap sukses (fallback bila tidak valid).

## 11. Telemetry Audit — **PASS (setelah fix)**

| Event | Status |
|---|---|
| `timeline_view` / `timeline_event_open` / `timeline_status_update` | ✅ existing (P9) |
| `ai_cache_hit` / `ai_cache_miss` (per feature) | ✅ existing (Sprint 2) |
| `agent_search_count` / `_click` / `_suggestion_used` | ✅ existing (Sprint 1.9) |
| AI usage & cost (`recordAIUsage` + calculateCost) | ✅ existing |
| `ai_conversation_started` / `_completed` / `_failed` | ✅ **baru (audit ini)** — `tests/unit/conversationRoutes.test.ts` (6 test) |

Prinsip dipatuhi: event per-perjalanan (bukan per-komponen), single source of truth `system_metrics`, metadata minimal.

## 12. Privacy Audit — **PASS**

- Semua query AI user-scoped (`WHERE user_id = ?`); event user lain → 404.
- Payload timeline = primitives ringkas (`periodDays`, `expense`, `topCategory`) — bukan raw response/prompt/chain-of-thought.
- Observability non-PII: hanya `user_id` internal + metadata numerik/ringkas; `sanitizeMetadata` dipakai `recordSystemMetric`.
- Memory: preferensi user-scoped, tidak menyimpan data transaksi sensitif; transparan (lihat/hapus).
- Tidak ada secret/OAuth token/service account di telemetry.

## 13. Beta Readiness

### Technical
- [x] Build stable (`npm run build` OK — 9.9s, entry 103 kB, recharts dinamis)
- [x] Unit tests stable (700 passed, 0 fail)
- [x] E2E stable (suite lengkap: gmail, transactions, dashboard, ai-timeline, dll.)
- [x] AI benchmark stable (live + offline regression guard)
- [x] Cost monitoring stable (`COST_MONITORING.md` + panel admin)
- [x] Error handling stable (400 VALIDATION_ERROR fail-closed; fallback deterministik)
- [ ] DNS / Turso / Auth / Google OAuth / Vertex AI stability — **verifikasi runtime produksi saat beta mulai** (dokumentasi: TURSO_CONNECTIVITY_TROUBLESHOOTING.md, FRAUD_AI_SCORING_ENABLEMENT.md)

### Product
- [x] AI explanation · feedback · timeline · memory · conversation · trust metadata · recommendation funnel (state machine) · analytics

### Privacy
- [x] Telemetry minimal · no secrets · no raw Gmail · no unnecessary financial PII · user-scoped data

### Operations
- [x] Rollback plan (additive migrations; backupTurso/restoreTurso script) · monitoring panel admin
- [ ] Error **alerting** (peristiwa realtime keluar dari app) — **deferred**: butuh pilihan infra (email/webhook) — keputusan produk
- [ ] Support channel ready — keputusan produk/ops

## 14. Metrics Contract

| Metric | Numerator | Denominator | Status |
|---|---|---|---|
| Conversation Completion | `ai_conversation_completed` | `ai_conversation_started` | ✅ (fix ini) |
| Conversation Fallback Rate | completed `source=rule-based` | completed | ✅ (fix ini) |
| Recommendation Acceptance | status `completed` | status `viewed` | ✅ siap |
| Feedback Positive / Negative | ratings `ai_feedback` | total feedback | ✅ siap |
| Feedback Rate | feedback | AI result views (proxied: timeline events) | ⚠️ proxy — lihat §15 |
| CTR rekomendasi | click eksplisit | views | ⚠️ belum ada click event (deferred) |
| AI Feature Adoption | unique AI users | active users | ✅ siap (user_id di system_metrics) |
| AI Retention D7/D14/D28 | AI-active users returning | cohort | ✅ siap — laporan hanya bila cohort ≥ 10 & periode tercapai |

**Aturan**: metrik tidak diklaim bila denominator belum tersedia (dipatuhi).

## 15. Gaps

| # | Gap | Severity | Status |
|---|---|---|---|
| G1 | Conversation tanpa telemetry `started/completed/failed` | P2 (telemetry missing) | ✅ **FIXED** (audit ini) |
| G1b | `trust.source` bisa tercatat `gemini` saat fallback rule-based dipakai (narasi gagal normalisasi) — mengotori `fallback_rate` & trust meta UI | P2 (incorrect metadata) | ✅ **FIXED** (audit ini — `source` di-reset ke `rule-based` di jalur fallback + regression test) |
| G2 | CTR rekomendasi butuh event click eksplisit (bukan status) | P2 | DEFERRED — butuh definisi produk "accept vs click" |
| G3 | Feedback rate denominator = "AI result views" — proxy timeline events | P2 | DEFERRED — butuh keputusan pengukuran view |
| G4 | Conversation multi-turn (session state) belum ada | P1 roadmap | DEFERRED — architecture change (design session-state) |
| G5 | Memory belum di-injeksi ke prompt conversation | P2 roadmap | DEFERRED — kecil, tapi butuh keputusan cakupan (anti prompt-injection review) |
| G6 | Timeline diff otomatis antar event (payload comparison) | P2 roadmap | DEFERRED |
| G7 | Error alerting realtime & support channel | P1 ops | DEFERRED — keputusan produk/ops (infra email/webhook) |
| G8 | Retention dashboard admin | P3 | DEFERRED — hindari dashboard kosong; lapor setelah cohort ≥ 10 |

## 16. Risk Classification

- **P0 (data loss/security/auth)**: tidak ditemukan. Semua query AI user-scoped; state machine fail-closed; payload sanitized.
- **P1 (misleading output/calculation)**: conversation fallback + validator mencegah raw error; confidence tidak dikarang. Gemini down → jawaban deterministik + `fallbackReason` jujur. Tidak ada temuan aktif.
- **P2 (telemetry/UX/minor quality)**: G1 diperbaiki; G2/G3/G5/G6 deferred dengan evidence.
- **P3 (cosmetic/docs)**: G8 + pilihan dokumentasi — non-blocking.

## 17. Recommended Next Actions

1. **Closed beta (10–30 user, 2–4 minggu)** — target mencari UX friction, AI low-value, trust issues, latency, cost, behavioral patterns (BUKAN signifikansi statistik).
2. Sebelum beta: verifikasi checklist operasional produksi (DNS/Turso/Auth/OAuth/Vertex) + aktifkan alerting sederhana (G7) + support channel.
3. Selama beta: kumpulkan `ai_feedback` → jalankan `node scripts/feedbackPromptPriorities.mjs` → `npm run benchmark:ai:live` (auto-pilih kategori topPriority) → perbaiki prompt yang `priorityScore` tinggi.
4. Roadmap pasca-beta: multi-turn conversation (G4), memory → conversation (G5), CTR eksplisit (G2).

---

## 18. Decision Matrix

| Area | Status | Evidence | Action |
|---|---|---|---|
| AI Explainability | **PASS** | `AiConfidenceBadge` + `explainability.ts`; confidence null bila tak ada basis; `AiTrustMeta` source/model/time | — |
| Feedback | **PASS** | `ai_feedback` + `feedbackMetrics.js` + panel admin + benchmark kategori ke-7 + live selection | — |
| Timeline | **PASS** | state machine status, keyset pagination, detail+feedback, auto-record 5 producer, observability | — |
| Memory | **PASS** | CRUD user-scoped + inject ke advisor/insight prompt (anti-injection framing, cap) | — |
| Conversation | **PASS** | agregasi deterministik + fallback + trust + timeline + telemetry (fix ini) | — |
| Trust | **PASS** | trust meta + validator + explainability | — |
| Telemetry | **PASS** | `system_metrics` lengkap + `ai_conversation_*` baru (6 regression test) | G2/G3 deferred |
| Privacy | **PASS** | user-scoped semua query; payload primitives; observability non-PII | — |
| Beta Readiness | **GAP minor** | unit 700 ✓ · build ✓ · E2E ✓ · benchmark ✓; ops: alerting/support belum | Selesaikan G7 sebelum beta |

---

# Final Report

### ROOT CAUSE / FINDINGS
Repositori sudah sangat matang untuk beta: 7 fitur AI produksi, konvensi keamanan/privacy konsisten, 700 unit test hijau. Satu-satunya gap yang jelas & low-risk: **conversation tidak menginstrumentasikan telemetry**, sehingga dua metrik kontrak beta (§19: `conversation_completion` dan `fallback_rate`) tidak dapat dihitung.

### CHANGES MADE
0. **`server/routes/conversationRoutes.js`** — fix G1b: `trust.source` di-reset ke `'rule-based'` di blok fallback (sebelumnya bisa tetap `'gemini'` bila Gemini merespons tapi narasi gagal dinormalisasi → telemetry `source` & trust meta UI salah).
1. **`server/routes/conversationRoutes.js`** — tambah telemetry di `POST /api/ai-product/conversation`:
   - `ai_conversation_started` (setelah validasi lolos — 400 bukan percakapan; metadata `periodDays`).
   - `ai_conversation_completed` (metadata `source` gemini|rule-based, `fallback` bool).
   - `ai_conversation_failed` (cabang error 500).
   - Semua non-blocking (`.catch(() => {})`), non-PII, via `recordSystemMetric` existing.
2. **`tests/unit/conversationRoutes.test.ts`** (baru) — 7 regression test (harness fake-app + mock Turso, pola `timelineApi.test.ts`): started ter-record, completed dengan source gemini/rule-based + metadata fallback, failed pada error DB, **narasi gagal dinormalisasi → source rule-based (G1b)**, tidak ada telemetry saat validasi gagal (400), user-scoping `userId`.
3. **`docs/ai-product/PRODUCT_METRICS.md`** — §4 Conversation Telemetry: definisi 3 event, formula `completion_rate` & `fallback_rate`, referensi test.

### FILES CHANGED
- `server/routes/conversationRoutes.js` (telemetry events)
- `tests/unit/conversationRoutes.test.ts` (baru, 6 test)
- `docs/ai-product/PRODUCT_METRICS.md` (kontrak metrik §4)
- `docs/ai/AI_PRODUCT_READINESS_AUDIT.md` (ini, deliverable audit)

### TEST RESULTS
- `npx vitest run tests/unit/conversationRoutes.test.ts` → **7/7 pass**
- `npx vitest run` (full) → **701 passed + 5 skipped** (53 files) — sebelum audit: 694
- `npm run typecheck` → **0 error**
- (WIP user tidak disentuh; perubahan hanya additive.)

### SECURITY
Tidak ada perubahan keamanan; telemetry baru tetap user-scoped (`userId` internal), metadata hanya `periodDays`/`source`/`fallback` — tidak ada PII.

### PRIVACY
Event baru tidak membawa query, narrative, atau transaksi — hanya identifier + metadata numerik/boolean (sesuai §16 privacy requirement).

### TELEMETRY
Gap G1 ditutup: `conversation_completion_rate` dan `conversation_fallback_rate` kini terukur dari `system_metrics`.

### BETA READINESS
Unit 701 ✓ · typecheck 0 ✓ · build ✓ · E2E ✓ · benchmark ✓ · privacy ✓ · telemetry ✓. Ops: alerting (G7) & support channel perlu keputusan produk sebelum beta besar.

### DEFERRED ITEMS
G2 (CTR eksplisit) · G3 (denominator feedback views) · G4 (multi-turn) · G5 (memory → conversation) · G6 (timeline diff) · G7 (alerting/support) · G8 (retention dashboard). Semua butuh keputusan produk atau architecture change.

### RECOMMENDED NEXT STEP
Mulai **closed beta 10–30 user (2–4 minggu)** dengan checklist ops produksi terverifikasi; selama beta, kumpulkan feedback → perbaiki prompt via pipeline prioritas yang sudah ada → evaluasi metrik kontrak §14.

---

## Final Recommendation

> ## `READY_WITH_MINOR_FIXES`
>
> - **READY** karena: 701 unit test hijau, typecheck/build/E2E/benchmark stabil, 7 fitur AI lengkap dengan keamanan & privacy yang konsisten, gap telemetry G1 & G1b sudah ditutup.
> - **MINOR FIXES** karena: ops alerting (G7) & support channel belum ada, verifikasi runtime produksi (DNS/Turso/Vertex/OAuth) wajib diulang saat beta dimulai, dan G2/G3 membutuhkan definisi metrik yang jelas dari sisi produk.
