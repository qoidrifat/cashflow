# ARCHITECTURE.md — CashFlow AI Knowledge Assistant (P0.14)

> **Status:** Active (safe scaffold; flag OFF) · **Owner:** Core Engineering · **Last Updated:** 2026-08-14

## 1. Posisi dalam arsitektur AI CashFlow

Google Agent Platform (Agent Search / Discovery Engine) adalah **CAPABILITY
TAMBAHAN** — bukan pengganti AI provider existing:

```text
Existing (runtime server)                 Baru (P0.14)
─────────────────────                     ─────────────────────
Gemini (vertexContext.js)                 Google Agent Platform
  ├─ email extraction                       └─ CashFlow AI Knowledge
  ├─ receipt OCR                                Assistant (READ-ONLY)
  └─ monthly report / advisor                     │
Agent Search (Discovery Engine)                    ▼
  └─ search 3 data store (help/           knowledge base CashFlow
     tx/gmail/receipts)                   (docs non-sensitif)
```

Di luar runtime app, harness pengembangan memakai Claude Code +
DeepSeek V4 Flash 0731 via 9inference.cloud (`bypassPermissions`) — **tidak
disentuh oleh P0.14**.

## 2. Data flow (target setelah eligibility proven)

```text
CashFlow Frontend
   │  (TIDAK ada kredensial Google di browser)
   ▼
POST /api/ai/cashflow-knowledge        ← backend server-side ONLY
   │
   ▼
server/routes/knowledgeRoutes.js       ← validasi query (min 2 / max 500)
   │
   ▼
server/lib/googleAgentPlatform/knowledgeAssistant.js  ← adapter (P0.14)
   │  flag GOOGLE_AGENT_PLATFORM_ENABLED=false (default)
   │  timeout · sanitasi · klasifikasi error · usage receipt
   ▼
server/services/agentSearchService.js  ← answerAgentSearch (tab='help')
   │  Discovery Engine REST (server-side credential SA)
   ▼
CashFlow Knowledge Base (docs non-sensitif, type knowledge_base)
   ▼
Grounded answer + sources (title/section saja)
```

- **Query hanya ke knowledge base** (`tab: 'help'` → `type: ANY("knowledge_base")`).
- **userId TIDAK diteruskan ke Google** — dipakai hanya untuk metrics observability.
- **Sumber jawaban wajib grounded**: answer + source references; bila tidak ada
  jawaban → "Informasi tersebut belum tersedia dalam knowledge base CashFlow."
  (anti-hallucination).

## 3. Komponen kode

| Komponen | Path | Tanggung jawab |
|---|---|---|
| Adapter | `server/lib/googleAgentPlatform/knowledgeAssistant.js` | Config + query + fallback + usage receipt; DI (`deps.answerAgentSearch`) agar unit-test murni |
| Barrel | `server/lib/googleAgentPlatform/index.js` | Re-export |
| Route | `server/routes/knowledgeRoutes.js` | `GET /api/ai/cashflow-knowledge/config`, `POST /api/ai/cashflow-knowledge`, metrics |
| Wiring | `server/index.js` | `registerKnowledgeRoutes(app)` (auth global `req.user`) |
| Env | `server/.env.example` + `.env.example` (root) | `GOOGLE_AGENT_PLATFORM_ENABLED=false` (server) + `VITE_GOOGLE_AGENT_PLATFORM_ENABLED=false` (UI nav) + overrides opsional |
| **UI page** | `src/features/ai-knowledge/KnowledgeAssistantPage.tsx` | Grounded Q&A + sources + state non-aktif (gate config server) |
| **UI client** | `src/features/ai-knowledge/services/knowledgeClient.ts` | Typed client; non-2xx dipetakan ke response struktural (tanpa throw) |
| **UI routing/nav** | `src/app/router.tsx` · `Sidebar.tsx` · `BottomNav.tsx` · `navigation.ts` · `config/env.ts` | Route `/suite/ai-knowledge`; nav hanya tampil bila `env.aiKnowledge.enabled` |
| Unit test (server) | `tests/unit/googleAgentPlatform.test.ts` | 13 kasus (success/empty/error/timeout/malformed/security/semantic) |
| Unit test (UI) | `tests/unit/aiKnowledgePage.test.tsx` | 9 kasus (gating config, answer+sources, noInfo, unavailable, loading) |
| E2E | `e2e/knowledge-assistant.spec.ts` | Kontrak flag-OFF: API 503 NOT_CONFIGURED + halaman state non-aktif (auth) |
| Knowledge manifest | `docs/cashflow-ai/README.md` | Topik → file sumber nyata |

## 4. Feature flag

```env
GOOGLE_AGENT_PLATFORM_ENABLED=false   # DEFAULT — jangan diubah (server)
VITE_GOOGLE_AGENT_PLATFORM_ENABLED=false  # DEFAULT — jangan diubah (UI nav)
```

Keduanya hanya di-set `true` setelah: eligibility verified + credentials verified +
test project verified + **billing proof sukses** (`BILLING_PROOF.md` status
`VERIFIED`). Overrides opsional (fallback ke `AGENT_SEARCH_*`):
`GOOGLE_AGENT_PLATFORM_PROJECT_ID`, `GOOGLE_AGENT_PLATFORM_LOCATION`,
`GOOGLE_AGENT_PLATFORM_DATA_STORE_ID`, `GOOGLE_AGENT_PLATFORM_TIMEOUT_MS`.

Gating berlapis:
- **Runtime (sumber kebenaran)** — `GET /api/ai/cashflow-knowledge/config` →
  `enabled`. Bila false, halaman menampilkan state "Fitur AI Knowledge belum
  diaktifkan" (input pertanyaan tidak dirender; deep-link tetap aman).
- **Build-time (nav)** — `VITE_GOOGLE_AGENT_PLATFORM_ENABLED` menyembunyikan
  item nav AI Knowledge di Sidebar/BottomNav. Route selalu terdaftar agar
  state non-aktif dapat diuji E2E tanpa mengubah config.

## 5. Security boundary

- **Credential hanya server-side**: service account `server/google-agent-search-service-account.json`
  (gitignored). Tidak ada `VITE_GOOGLE_*` / `NEXT_PUBLIC_GOOGLE_*` untuk credential.
- **Public config tanpa secret**: `enabled`, `service`, `skuLabel`,
  `projectConfigured`, `dataStoreConfigured` — tidak ada project id/kunci/path.
- **Source tidak pernah mengekspos** `path` internal repo / `user_id_hash`.
- **Fallback**: bila Google tidak tersedia → `503 "AI knowledge service
  temporarily unavailable"` — CashFlow tidak pernah crash.
- **Rate limit**: route berada di belakang `generalLimiter` global (express-rate-limit).

## 6. IAM (target, least privilege — rekomendasi, bukan perubahan)

| Principal | Role minimum | Resource | Tujuan |
|---|---|---|---|
| `cashflow-agent-search-sa` | Discovery Engine Admin (atau lebih sempit: `discoveryengine.dataStores.*` + servingConfigs get/search) | Project | Search + import data store |
| `cashflow-agent-search-sa` | Storage Object Admin (bucket knowledge saja) | Bucket docs/data | Upload JSONL sync |
| Runtime user | Tidak ada (server-side SA) | — | — |

Jangan memberi Owner/Editor/Billing Admin ke runtime SA tanpa kebutuhan terbukti.
Lihat `docs/google-cloud/GENAI_APP_BUILDER_CASHFLOW_SETUP.md` §4 untuk setup dev.

## 7. Privacy audit (apa yang meninggalkan CashFlow?)

| Pertanyaan | Jawaban |
|---|---|
| Data apa yang keluar? | Query user (teks bebas, max 500 char) + dokumentasi knowledge yang sudah di-upload (non-sensitif) |
| Mengapa? | Retrieval grounded untuk menjawab pertanyaan produk |
| Ke mana? | Google Cloud project (Agent Search / Discovery Engine) |
| Untuk tujuan apa? | Menghasilkan grounded answer + source reference |
| Yang TIDAK pernah keluar | Transaction rows, wallet identifiers, Gmail body, PII, token, kredensial |

## 8. Regresi AI existing — garant

P0.14 tidak mengubah: `vertexContext.js` (Gemini), `agentSearchService.js`
(Agent Search existing), provider abstraction, `AGENT_SEARCH_*` config, dan
harness (DeepSeek/9inference/bypassPermissions). Perubahan hanya **menambah**
file baru + 1 baris registrasi route di `server/index.js` + env example.
