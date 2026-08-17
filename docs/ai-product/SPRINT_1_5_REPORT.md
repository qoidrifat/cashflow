# Sprint 1.5 Report — AI Product Experience

> **Status: SELESAI** · 2026-08-07 · Commit utama `(lihat git log)`

## 1. Audit Hasil AI Saat Ini (Sebelum Sprint)

| Fitur | Kondisi Awal |
|---|---|
| Fraud L1+L2 | explainability kuat (aiReasons, aiConfidence, decision, badge "Keyakinan N%") |
| AI Insight | cashflowHealth + financialHealthScore + saving opportunities + risks |
| Financial Advisor | summary, 4 saran, dana darurat, action list, badge sumber |
| AI Search | explanation[], source, confidence_score |
| OCR | confidence label (Sangat yakin ≥ 0.88, dll) |
| Explainability | TIDAK terstandarisasi — confidence mentah tanpa interpretasi konsisten |
| Feedback | ❌ tidak ada |
| Timeline | ❌ tidak ada |
| Simulation / Scenario | ❌ tidak ada |
| Health Score | parsial (ProfessionalSuite: savingsRate/expenseRatio/budgetDiscipline/goalProgress) |
| AI Memory | ❌ tidak ada |
| AI Dashboard | ❌ tidak ada (insight terbenam di DashboardPage) |
| Trust meta | parsial (badge sumber, tanpa model/waktu proses/fallback) |

## 2. Gap → Implementasi (Peta Phase)

| Phase | Deliverable | Status |
|---|---|---|
| P1 Explainability | `src/lib/explainability.ts` + `AiConfidenceBadge` + model terpadu | ✅ |
| P2 Feedback | `ai_feedback` table + route + `AiFeedbackButtons` (6 rating) | ✅ |
| P3 Timeline | `ai_timeline` table + route + kartu timeline di AI Hub | ✅ |
| P4 Simulation | `simulationEngine.ts` (7 tipe adjustment) + panel simulasi | ✅ |
| P5 Scenario | perbandingan side-by-side + `scenarioImpactScore` | ✅ |
| P6 Health Score | `financialHealthEngine.ts` (8 subscore + kategori + trend) | ✅ |
| P7 Memory | `ai_memory` table + route CRUD + kartu memory | ✅ |
| P8 Conversation | `conversationAggregator.js` + `conversationRoutes.js` + `AiConversationPage` (`/ai/chat`) — jawaban kaya ringkasan→grafik→kategori→transaksi→insight→aksi, fallback deterministik, trust + feedback | ✅ |
| P9 AI Dashboard | `AiHubPage` `/ai` (insight, health, sim, scenario, timeline, memory) | ✅ |
| P10 Trust | `AiTrustMeta` (source/model/waktu proses/fallback) di Advisor + AI Hub | ✅ |
| P9-Timeline (longitudinal) | `event_type` + `status` (state machine) + pagination keyset + detail + producer otomatis (conversation/insight/advisor/feedback/memory) + halaman `/ai/timeline` + observability `timeline_*` | ✅ |

## 3. File Baru / Diubah

**Baru:**
- `src/lib/explainability.ts`, `src/lib/simulationEngine.ts`, `src/lib/financialHealthEngine.ts`
- `src/services/aiProductService.ts`, `src/services/conversationService.ts`
- `src/features/ai-product/{types.ts, AiHubPage.tsx}` + `components/{AiConfidenceBadge,AiFeedbackButtons,AiTrustMeta}.tsx`
- `src/features/ai-product/chat/{AiConversationPage,ConversationAnswer}.tsx` (P8)
- `server/routes/aiProductRoutes.js`, `server/routes/conversationRoutes.js`, `server/lib/conversationAggregator.js`, `server/lib/aiMemoryContext.js`, `server/lib/feedbackMetrics.js`, `scripts/feedbackPromptPriorities.mjs`, `scripts/benchmarkDiff.mjs`, `scripts/promptChangeEvaluate.mjs`
- `tests/benchmark/liveFeedbackSelection.ts` (seleksi kategori live dari feedback nyata) + `tests/unit/liveFeedbackSelection.test.ts`
- `server/lib/timelineEvents.js` (P9: event_type mapping, sanitize payload, state machine status, builder feedback/memory, insert helper)
- `src/lib/timelineGroup.ts` (P9: grouping Hari Ini/Kemarin/Minggu Ini/Sebelumnya — murni), `src/features/ai-product/timeline/{AiTimelinePage,eventMeta}.tsx|ts` (`/ai/timeline`)
- `tests/unit/{timelineEvents,timelineGroup,timelineApi}.test.ts` + `e2e/ai-timeline.spec.ts` (P9)
- `docs/ai-product/{P9_AI_TIMELINE_REPORT,CLOSED_BETA_READINESS,PRODUCT_METRICS}.md`
- `tests/unit/{explainability,simulationEngine,financialHealthEngine,aiProductRoutesValidation,conversationAggregator,aiMemoryContext,feedbackMetrics,benchmarkDiff}.test.ts`
- `docs/ai-product/*` (10 dokumen)

**Diubah:**
- `turso-schema.sql` (+3 tabel, +4 index; P9: `ai_timeline` + kolom `event_type` & `status` idempotent)
- `server/index.js` (registrasi route conversation)
- `server/routes/aiProductRoutes.js` (`AI_FEATURES` + `conversation`; P9: pagination keyset `{items,hasMore}`, GET `/:id` detail+feedback, PATCH `/:id/status` state machine, wiring event feedback/memory, observability `timeline_*`)
- `server/routes/geminiRoutes.js` (P9: recordTimeline fire-and-forget untuk monthly-report & advisor) · `server/routes/conversationRoutes.js` (P9: memakai `insertTimelineEvent` → event_type `conversation`)
- `src/services/aiProductService.ts` (P9: `listTimeline` paginated, `getTimelineEvent`, `updateTimelineStatus`)
- `src/app/router.tsx` (route `/ai` + `/ai/chat`), `src/config/navigation.ts` (AI Hub + AI Chat)
- `src/features/advisor/AdvisorPage.tsx` (feedback + trust meta)
- `src/features/ai-product/AiHubPage.tsx` (CTA "Tanya AI" → `/ai/chat`)
- `server/lib/vertexContext.js` (buildAdvisorPrompt & buildMonthlyReportPrompt terima `memory` → section "AI ingat")
- `server/routes/geminiRoutes.js` (loadUserMemory → injeksi ke route advisor & monthly-report)
- `server/routes/adminMetricsRoutes.js` (GET /api/admin/metrics/feedback-summary), `src/services/adminMetrics.ts`, `src/types/metrics.ts`, `src/pages/admin/MonitoringPage.tsx` (panel "Prioritas Perbaikan Prompt")

## 4. Database & API

- **DB**: `ai_feedback` · `ai_memory` (UNIQUE user+category+key) · `ai_timeline` (payload JSON ≤8KB; **P9**: `event_type` insight/recommendation/conversation/feedback/memory_update/risk/other + `status` new/viewed/completed/dismissed state machine). Semua user-scoped FK `users(id) ON DELETE CASCADE`. Idempoten via `CREATE TABLE IF NOT EXISTS` + ALTER idempotent.
- **API** (semua `requireAuth`, validasi P1-2 → 400 `VALIDATION_ERROR`):
  - `POST/GET /api/ai-product/feedback` (P9: feedback tanpa itemId timeline → event `feedback` otomatis)
  - `GET/POST/PUT/DELETE /api/ai-product/memory` (P9: upsert/delete → event `memory_update` otomatis)
  - `GET/POST /api/ai-product/timeline` + `GET /:id` + `PATCH /:id/status` (P9)
  - `POST /api/ai-product/conversation` (P8) — `{ query ≤200, periodDays 7|30|90 }` → stats + chart.daily + categories + topTransactions + narrative + trust; Gemini dengan fallback deterministik

## 5. Test

| Suite | Hasil |
|---|---|
| explainability | 9 test |
| simulationEngine | 14 test (determinisme, tiap tipe adjustment, batas) |
| financialHealthEngine | 14 test (komponen, kategori, determinisme, guard) |
| aiProductRoutesValidation | 11 test (skema, enum, error 400) |
| conversationAggregator (P8) | 23 test (date range, agregasi deterministik, fallback, sanitasi narrative, schema route) |
| aiMemoryContext (memory → prompt) | 19 test (format "AI ingat", sanitasi, cap item/char, framing BUKAN instruksi, injeksi ke advisor & monthly-report) |
| feedbackMetrics (feedback → prioritas prompt) | 14 test (agregasi per feature/rating, ranking, action plan, sinkron enum rating) |
| adminFeedbackSummary (endpoint admin) | 5 test (401/403 gate, 200 agregasi, 500 error) |
| benchmarkDiff (alur before/after) | 12 test (unchanged/improved/regressed, cost membaik, latency default informational + strict mode, sinyal campur, kategori hilang/baru) |
| liveFeedbackSelection (seleksi live dari feedback) | 13 test (file hilang/corrupt → null, topPriority skor>0 → kategori terpilih, skor 0 → full run, fallback firstMappedFeature, mapping lengkap) |
| timelineEvents (P9 lib) | 17 test (eventType mapping, sanitize payload, normalize cap/confidence guard, state machine status, builder feedback/memory, insert helper) |
| timelineGroup (P9 grouping) | 8 test (hari ini/kemarin/minggu ini/sebelumnya, ISO & space-format, tanpa tanggal) |
| timelineApi (P9 routes) | 14 test (gate requireAuth, user scoping, pagination keyset/hasMore/clamp, detail+feedback, 404 antar-user, state machine 400/200, wiring feedback/memory) |
| **Total unit suite** | **743 passed + 5 skipped** (sebelumnya 694) |
| typecheck / lint / build | 0 error · 0 error · OK (9.9s, entry 103 kB, recharts chunk dinamis) |

## 6. Benchmark

- Engine simulation & health **100% deterministik** — unit test menjamin input sama → output sama.
- Tidak menambah panggilan Gemini (simulation/health bebas AI). Feedback/memory/timeline = write ringan ke Turso.

## 7. Regression

- Semua test existing tetap hijau (743 = 694 + 49 baru — P10.1 +17 · P10.2 +32).
- Tidak ada perubahan pada fraud/insight/advisor/search logic — hanya additive UI & API baru.
- AdvisorPage: hanya penambahan `AiTrustMeta` + `AiFeedbackButtons` (tidak mengubah logika report).

## 8. Performance & Security

- **Performance**: engine murni O(n) aritmetika; AI Hub lazy-loaded; selector store konsisten dengan baseline performa React.
- **Security**: user-scoped SQL (`WHERE user_id = ?`); enum ketat; mass-assignment di-block (`validateBody`); tidak ada secret baru; tidak ada PII di memory.

## 9. Risk & Technical Debt

| Item | Mitigasi |
|---|---|
| Conversation multi-turn belum ada | Sesi ringan via `messages[]` client; injeksi riwayat ke prompt = roadmap |
| Feedback sudah jadi input evaluasi benchmark | `feedbackMetrics.js` + kategori benchmark + script CLI + endpoint admin + panel monitoring; live benchmark kini otomatis memilih kategori dari `topPriority` feedback nyata (BENCH_LIVE_ALL=1 untuk full run) |
| Memory sudah di-injeksi ke advisor/insight | Conversation (P8) belum memakai memory — injeksi ke prompt conversation = roadmap |
| ~~Timeline logging manual~~ | ✅ **P9**: auto-logging conversation/insight/advisor/feedback/memory + halaman `/ai/timeline` (filter, grouping, detail, status) |
| Insight/advisor timeline body = hanya summary | Trade-off penyimpanan ringkas (bukan raw response); diff otomatis antar event = roadmap |
| Debt score pakai balance wallet credit sebagai nominal utang | Didokumentasikan di FINANCIAL_SCORE.md |

## 10. Recommendation Sprint Berikutnya

1. **Conversation multi-turn** — pertanyaan lanjutan memakai konteks jawaban sebelumnya (riwayat `messages[]` di client, injeksi ke prompt).
2. **Prompt-engineering berbasis dataset + evaluasi before/after** ✅ selesai — alur: `feedbackPromptPriorities.mjs` (prioritas) → `promptChangeEvaluate.mjs --baseline` → ubah prompt → `--compare` → verdict diff (lihat `AI_BENCHMARK.md` §9).
3. **AI Memory → prompt conversation** — advisor & insight sudah memakai blok "AI ingat"; perluas ke prompt conversation (P8) agar jawaban chat makin personal.
4. **AI Timeline & longitudinal intelligence** ✅ selesai (P9) — event model + state machine status + pagination + detail + producer otomatis + halaman `/ai/timeline` + observability; next: diff otomatis antar event & feedback → candidate memory.

## 11. Screenshot Checklist (manual QA)

- [ ] `/ai` render di light & dark mode
- [ ] Health Score card: 8 subscore + kategori + trend
- [ ] Simulasi: preset adjustment → tabel berubah; slider bulan berfungsi
- [ ] Skenario: simpan 2+ → side-by-side + badge dampak
- [ ] Timeline: catat insight → muncul di list → feedback berfungsi
- [ ] Memory: tambah/edit/hapus preferensi → persist setelah reload
- [ ] AdvisorPage: trust meta + feedback tampil, tidak mengganggu layout
- [ ] `/ai/chat`: suggested query → skeleton → jawaban kaya (ringkasan, 3 tile angka, grafik, kategori, transaksi, insight, aksi) di light & dark
- [ ] `/ai/chat`: periode 7/30/90 mengubah data; tombol "Coba lagi" muncul saat error; feedback tersimpan
