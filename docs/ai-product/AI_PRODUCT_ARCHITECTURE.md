# AI Product Architecture

> **Sprint 1.5 — AI Product Experience** · Status: **Diterapkan** · Tanggal: 2026-08-07
> Scope: explainability, feedback, timeline, simulation, scenario, financial health, memory, AI dashboard, trust.

## 1. Prinsip

Sprint ini mengubah AI CashFlow dari sekadar "benar" menjadi AI yang **dipercaya, dipahami, personal, dan membantu keputusan**. Batasan tegas:

- **Tidak menambah model AI** — Gemini tetap satu-satunya provider.
- **Tidak membuat RAG / Embedding / Multi-Model / Semantic Cache** (roadmap sprint berikutnya).
- **Simulation & health score = deterministik murni** (tanpa AI). AI hanya menjelaskan hasil, tidak menghitung.
- **Feedback tidak langsung mengubah AI** — menjadi dataset evaluasi.
- Semua perubahan **additive & backward-compatible** — tidak ada fitur stabil yang ditulis ulang.

## 2. Lapisan Arsitektur

```
┌────────────────────────────────────────────────────────────┐
│ UI (React)                                                 │
│  AiHubPage (/ai)  ·  AdvisorPage  ·  Dashboard  ·  Fraud  │
│  AiConfidenceBadge · AiFeedbackButtons · AiTrustMeta      │
├────────────────────────────────────────────────────────────┤
│ Frontend libs (DETERMINISTIK — tanpa AI)                  │
│  explainability.ts     — interpretasi confidence + trust  │
│  simulationEngine.ts   — what-if projection N bulan       │
│  financialHealthEngine.ts — 8 subscore + kategori         │
│  aiProductService.ts   — client API feedback/memory/timeline│
├────────────────────────────────────────────────────────────┤
│ Server (Express + Turso)                                  │
│  routes/aiProductRoutes.js — /api/ai-product/*            │
│  tabel: ai_feedback · ai_memory · ai_timeline             │
│  validation.js (P1-2) — 400 VALIDATION_ERROR              │
└────────────────────────────────────────────────────────────┘
```

## 3. Alur Data

1. **Feedback** — user klik 👍/👎 di kartu AI → `POST /api/ai-product/feedback` → tabel `ai_feedback` → pipeline `feedback → evaluation dataset → future training` (retraining TIDAK diimplementasikan di sprint ini).
2. **Timeline** — entri rekomendasi AI (title/body/confidence/payload) → `POST /api/ai-product/timeline` → `ai_timeline` → ditampilkan kronologis.
3. **Memory** — preferensi user → upsert `ai_memory` (UNIQUE user+category+key) → siap dipakai prompt personalisasi.
4. **Simulation & Scenario** — murni client-side: `runSimulation(baseline, adjustments)` → tabel proyeksi; skenario dibandingkan side-by-side via `scenarioImpactScore`.
5. **Health Score** — `computeFinancialHealth(input)` dari metrics advisor (deterministik).

## 4. Keamanan & Privasi

- Seluruh endpoint `/api/ai-product/*` memakai `requireAuth` (user-scoped — tidak ada data antar-user).
- Validasi body (P1-2): field tak dikenal dibuang, enum dibatasi, 400 `VALIDATION_ERROR` (bukan 401).
- `ai_memory` tidak menyimpan data sensitif transaksi — hanya preferensi.
- Feedback & timeline tidak mengekspos isi prompt/chain-of-thought.

## 5. Referensi Implementasi

| File | Peran |
|---|---|
| `src/lib/explainability.ts` | interpretConfidence, fallbackReason, format helpers |
| `src/lib/simulationEngine.ts` | runSimulation, scenarioImpactScore |
| `src/lib/financialHealthEngine.ts` | computeFinancialHealth, categoryForScore |
| `src/features/ai-product/*` | halaman & komponen |
| `server/routes/aiProductRoutes.js` | API feedback/memory/timeline |
| `turso-schema.sql` | 3 tabel baru |

Dokumen detail: [AI_EXPLAINABILITY](AI_EXPLAINABILITY.md) · [AI_FEEDBACK](AI_FEEDBACK.md) · [AI_TIMELINE](AI_TIMELINE.md) · [AI_MEMORY](AI_MEMORY.md) · [AI_SIMULATION](AI_SIMULATION.md) · [FINANCIAL_SCORE](FINANCIAL_SCORE.md) · [AI_DASHBOARD](AI_DASHBOARD.md) · [SPRINT_1_5_REPORT](SPRINT_1_5_REPORT.md)
