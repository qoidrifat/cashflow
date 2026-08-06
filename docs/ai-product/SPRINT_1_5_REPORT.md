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
| P8 Conversation | **belum** (roadmap — butuh session state; lihat §10) | ⏳ |
| P9 AI Dashboard | `AiHubPage` `/ai` (insight, health, sim, scenario, timeline, memory) | ✅ |
| P10 Trust | `AiTrustMeta` (source/model/waktu proses/fallback) di Advisor + AI Hub | ✅ |

## 3. File Baru / Diubah

**Baru:**
- `src/lib/explainability.ts`, `src/lib/simulationEngine.ts`, `src/lib/financialHealthEngine.ts`
- `src/services/aiProductService.ts`
- `src/features/ai-product/{types.ts, AiHubPage.tsx}` + `components/{AiConfidenceBadge,AiFeedbackButtons,AiTrustMeta}.tsx`
- `server/routes/aiProductRoutes.js`
- `tests/unit/{explainability,simulationEngine,financialHealthEngine,aiProductRoutesValidation}.test.ts`
- `docs/ai-product/*` (9 dokumen)

**Diubah:**
- `turso-schema.sql` (+3 tabel, +4 index)
- `server/index.js` (registrasi route)
- `src/app/router.tsx` (route `/ai`), `src/config/navigation.ts` (AI Hub)
- `src/features/advisor/AdvisorPage.tsx` (feedback + trust meta)

## 4. Database & API

- **DB**: `ai_feedback` · `ai_memory` (UNIQUE user+category+key) · `ai_timeline` (payload JSON ≤8KB). Semua user-scoped FK `users(id) ON DELETE CASCADE`. Idempoten via `CREATE TABLE IF NOT EXISTS`.
- **API** (semua `requireAuth`, validasi P1-2 → 400 `VALIDATION_ERROR`):
  - `POST/GET /api/ai-product/feedback`
  - `GET/POST/PUT/DELETE /api/ai-product/memory`
  - `GET/POST /api/ai-product/timeline`

## 5. Test

| Suite | Hasil |
|---|---|
| explainability | 9 test |
| simulationEngine | 14 test (determinisme, tiap tipe adjustment, batas) |
| financialHealthEngine | 14 test (komponen, kategori, determinisme, guard) |
| aiProductRoutesValidation | 11 test (skema, enum, error 400) |
| **Total unit suite** | **560 passed + 5 skipped** (sebelumnya 512) |
| typecheck / lint | 0 error |

## 6. Benchmark

- Engine simulation & health **100% deterministik** — unit test menjamin input sama → output sama.
- Tidak menambah panggilan Gemini (simulation/health bebas AI). Feedback/memory/timeline = write ringan ke Turso.

## 7. Regression

- Semua test existing tetap hijau (560 = 512 + 48 baru).
- Tidak ada perubahan pada fraud/insight/advisor/search logic — hanya additive UI & API baru.
- AdvisorPage: hanya penambahan `AiTrustMeta` + `AiFeedbackButtons` (tidak mengubah logika report).

## 8. Performance & Security

- **Performance**: engine murni O(n) aritmetika; AI Hub lazy-loaded; selector store konsisten dengan baseline performa React.
- **Security**: user-scoped SQL (`WHERE user_id = ?`); enum ketat; mass-assignment di-block (`validateBody`); tidak ada secret baru; tidak ada PII di memory.

## 9. Risk & Technical Debt

| Item | Mitigasi |
|---|---|
| P8 Conversation belum dibuat | Roadmap Sprint berikutnya (butuh design session-state + koneksi chart/transaksi) |
| Feedback belum dipakai untuk evaluasi | Pipeline siap (query per feature/rating); integrasi ke benchmark = roadmap |
| Memory belum di-injeksi ke prompt | API + UI siap; injeksi ke advisor/insight prompt = roadmap |
| Timeline logging manual | Otomatisasi saat generate report = roadmap |
| Debt score pakai balance wallet credit sebagai nominal utang | Didokumentasikan di FINANCIAL_SCORE.md |

## 10. Recommendation Sprint Berikutnya

1. **P8 Natural Conversation** — modalitas terbesar UX berikutnya; siapkan session ringan + jawaban kaya (ringkasan → grafik → kategori → transaksi → aksi).
2. **Integrasi feedback ke benchmark** — dataset evaluasi `ai_feedback` dipakai memprioritaskan perbaikan prompt.
3. **AI Memory → prompt personalisasi** — injeksi preferensi ke advisor/insight prompt dengan sistem "AI ingat: ...".
4. **Timeline auto-logging** — catat otomatis saat advisor/insight/health di-generate.

## 11. Screenshot Checklist (manual QA)

- [ ] `/ai` render di light & dark mode
- [ ] Health Score card: 8 subscore + kategori + trend
- [ ] Simulasi: preset adjustment → tabel berubah; slider bulan berfungsi
- [ ] Skenario: simpan 2+ → side-by-side + badge dampak
- [ ] Timeline: catat insight → muncul di list → feedback berfungsi
- [ ] Memory: tambah/edit/hapus preferensi → persist setelah reload
- [ ] AdvisorPage: trust meta + feedback tampil, tidak mengganggu layout
