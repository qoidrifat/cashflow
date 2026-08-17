# AI Product Architecture

> **Sprint 1.5 — AI Product Experience** · Status: **Diterapkan** · Tanggal: 2026-08-07
> Scope: explainability, feedback, timeline, simulation, scenario, financial health, memory, AI dashboard, trust, natural conversation (P8).

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
│  AiHubPage (/ai)  ·  AiConversationPage (/ai/chat)  ·      │
│  AiTimelinePage (/ai/timeline)  ·  AdvisorPage  ·  Fraud   │
│  AiConfidenceBadge · AiFeedbackButtons · AiTrustMeta      │
├────────────────────────────────────────────────────────────┤
│ Frontend libs (DETERMINISTIK — tanpa AI)                  │
│  explainability.ts     — interpretasi confidence + trust  │
│  simulationEngine.ts   — what-if projection N bulan       │
│  financialHealthEngine.ts — 8 subscore + kategori         │
│  timelineGroup.ts      — grouping tanggal (P9)            │
│  conversationService.ts — client POST /conversation       │
│  aiProductService.ts   — client feedback/memory/timeline  │
├────────────────────────────────────────────────────────────┤
│ Server (Express + Turso)                                  │
│  routes/aiProductRoutes.js — /api/ai-product/* (P9:       │
│    pagination keyset, GET /:id detail+feedback, PATCH     │
│    /:id/status state machine, wiring feedback/memory)     │
│  routes/conversationRoutes.js — POST /conversation (P8)   │
│  routes/geminiRoutes.js — recordTimeline (insight/advisor)│
│  lib/timelineEvents.js — normalisasi & state machine (P9) │
│  lib/conversationAggregator.js — agregasi deterministik   │
│  tabel: ai_feedback · ai_memory · ai_timeline (event_type,│
│         status)                                           │
│  validation.js (P1-2) — 400 VALIDATION_ERROR              │
└────────────────────────────────────────────────────────────┘
```

## 3. Alur Data

1. **Feedback** — user klik 👍/👎 di kartu AI → `POST /api/ai-product/feedback` → tabel `ai_feedback` → pipeline `feedback → evaluation dataset → future training` (retraining TIDAK diimplementasikan di sprint ini).
2. **Timeline (P9)** — entri dicatat OTOMATIS (conversation, insight, advisor, feedback tanpa itemId timeline, memory set/delete) via `lib/timelineEvents.js` (event_type + status state machine, fire-and-forget) → `ai_timeline` → halaman `/ai/timeline` (filter, grouping, detail + evidence + feedback terkait, aksi Selesai/Buang) → observability `system_metrics.timeline_*`.
3. **Memory** — preferensi user → upsert `ai_memory` (UNIQUE user+category+key) → **di-injeksi ke prompt advisor & monthly-report** via `lib/aiMemoryContext.js` (blok "AI ingat: ...", framing BUKAN instruksi, cap 12 item / 1200 char) — `loadUserMemory` di geminiRoutes (gagal aman → []).
4. **Simulation & Scenario** — murni client-side: `runSimulation(baseline, adjustments)` → tabel proyeksi; skenario dibandingkan side-by-side via `scenarioImpactScore`.
5. **Health Score** — `computeFinancialHealth(input)` dari metrics advisor (deterministik).
6. **Conversation (P8)** — `POST /api/ai-product/conversation`: query user + rentang periode → agregasi deterministik (agregator) → Gemini untuk narasi (fallback rule-based bila gagal) → jawaban kaya (ringkasan/grafik/kategori/transaksi/insight/aksi) + trust meta; dicatat ke `ai_timeline`. Detail: [AI_CONVERSATION](AI_CONVERSATION.md).

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
| `src/features/ai-product/chat/*` | AiConversationPage + ConversationAnswer (P8) |
| `src/features/ai-product/timeline/*` | AiTimelinePage + eventMeta (P9) · `src/lib/timelineGroup.ts` |
| `server/routes/aiProductRoutes.js` | API feedback/memory/timeline (P9) |
| `server/routes/conversationRoutes.js` | API conversation (P8) |
| `server/routes/geminiRoutes.js` | recordTimeline insight/advisor (P9) |
| `server/lib/timelineEvents.js` | normalisasi event + state machine status (P9) |
| `server/lib/conversationAggregator.js` | agregasi deterministik + prompt + fallback (P8) |
| `server/lib/aiMemoryContext.js` | formatter blok "AI ingat" untuk prompt advisor/insight |
| `turso-schema.sql` | 3 tabel AI + kolom P9 (event_type/status) |

Dokumen detail: [AI_EXPLAINABILITY](AI_EXPLAINABILITY.md) · [AI_FEEDBACK](AI_FEEDBACK.md) · [AI_TIMELINE](AI_TIMELINE.md) · [AI_MEMORY](AI_MEMORY.md) · [AI_SIMULATION](AI_SIMULATION.md) · [FINANCIAL_SCORE](FINANCIAL_SCORE.md) · [AI_DASHBOARD](AI_DASHBOARD.md) · [AI_CONVERSATION](AI_CONVERSATION.md) · [SPRINT_1_5_REPORT](SPRINT_1_5_REPORT.md)
