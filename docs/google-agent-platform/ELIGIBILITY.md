# ELIGIBILITY.md — Google Agent Platform / Credit Eligibility (P0.14)

> **Status:** BLOCKED — BILLING ELIGIBILITY UNPROVEN (verifikasi konsol user diperlukan)
> **Owner:** Core Engineering · **Last Updated:** 2026-08-14

Dokumen ini mencatat hasil investigasi eligibility **"Trial credit for GenAI
App Builder"** terhadap layanan Google yang relevan dengan CashFlow. Semua
klaim di bawah berbasis evidence (dokumentasi resmi Google + evidence repo).
Tidak ada nilai secret yang dicetak — hanya `PRESENT`/`SET` atau identifier
non-sensitif.

## 1. Credit identity

| Field | Nilai (aman) |
|---|---|
| Credit name | `Trial credit for GenAI App Builder` |
| Status | `Available` (user-reported, 2026-08-14) |
| Currency | `Rp` |
| Remaining | Rp 17.801.001 (user-reported — **BELUM diverifikasi via Billing Console**) |
| Original | Rp 17.801.001 (user-reported) |
| Type | `One-time` |
| Credit ID | `PRESENT` (tidak dicetak) |
| Scope | `Certain usage; see the terms of the promotion for details` |
| Valid | 2026-06-19 → 2027-06-19 |
| Application type | `Net pricing` |

> ⚠️ Scope "Certain usage; see the terms of the promotion for details" = **tidak
> dapat diverifikasi dari environment ini**. Verifikasi akhir hanya mungkin lewat
> Billing Console → Credits & promotions (term & SKU applicability). Sampai itu,
> eligibility per-SKU = `UNKNOWN`.

## 2. Branding mapping (sumber resmi)

Google telah beberapa kali mengganti nama produk yang sama (keluarga
"GenAI App Builder"):

| Branding lama | Branding saat ini |
|---|---|
| GenAI App Builder | Vertex AI Agent Builder |
| Vertex AI Search / Enterprise Search | **Agent Search** |
| Vertex AI Conversation | **Agent Conversation** |
| — | Gemini Enterprise Agent Platform (payung produk) |

Sumber resmi: [Agent Search overview — Google Cloud docs](https://docs.cloud.google.com/generative-ai-app-builder/docs) —
"*Note: Vertex AI Search is being renamed to Agent Search.*" Branding berubah
tidak otomatis mengubah billing scope credit — billing scope tetap harus
dibuktikan per SKU.

## 3. Daftar layanan yang dipertimbangkan (prioritas P0.14 §3)

| # | Layanan | Status eligibility credit | Evidence |
|---|---|---|---|
| A | **Agent Search** (Discovery Engine search, AI Mode/answers) | `UNKNOWN — kandidat kuat` | Nama credit = keluarga produk yang sama; repo CashFlow memakai credit ini untuk Agent Search (evidence repo §4); pricing resmi: Search standard ~$1.50/1k queries, Advanced Generative Answers $4.00/1k ([Agent Search pricing](https://cloud.google.com/generative-ai-app-builder/pricing)) |
| B | **Agent Conversation** (conversational answers) | `UNKNOWN` | SKU group `vertex-ai-search-and-conversation`; belum diverifikasi applicability credit |
| C | **Grounded Generation / AI Applications** | `UNKNOWN` | Dokumentasi terpisah; tidak ada evidence credit |
| D | **Agent Builder application components** | `UNKNOWN` | Komponen App Builder; perlu cek promotion terms |
| E | **Agent Engine / Agent Runtime** | `UNKNOWN` | TIDAK diasumsikan eligible — butuh bukti SKU & promotion terms |
| — | **Gemini API (AI Studio, `generativelanguage.googleapis.com`)** | `TIDAK TERBUKTI — jangan diasumsikan` | Credit bersifat spesifik ("App Builder"), BUKAN kredit general GCP/Gemini API (signal forum, lihat §5) |
| — | **Vertex AI Gemini (model generation)** | `UNKNOWN` | Token LLM di-`UNKNOWN` sampai billing export menunjukkan credit offset |
| — | **Cloud Storage** | `UNKNOWN — pisahkan billing` | Credit App Builder ≠ Cloud Storage billing; gunakan bucket minimal/sesuai kebutuhan |

## 4. Evidence repo (CashFlow sudah terintegrasi keluarga produk ini)

- `docs/google-cloud/GENAI_APP_BUILDER_CASHFLOW_SETUP.md` — panduan resmi repo
  menyatakan credit **"Trial Credit for GenAI App Builder"** dipakai untuk
  Agent Search / Vertex AI Search / Discovery Engine CashFlow (help center,
  knowledge base, transaction search, dll).
- `server/services/agentSearchService.js` — integrasi Discovery Engine berjalan
  (feature flag `AGENT_SEARCH_ENABLED=true` di `server/.env` lokal; credential
  service account `server/google-agent-search-service-account.json` ada,
  gitignored).
- `server/.env` (key names only): `AGENT_SEARCH_PROJECT_ID`, `AGENT_SEARCH_ENGINE_ID`,
  `AGENT_SEARCH_KNOWLEDGE_DATA_STORE_ID`, dll — `SET`.

Artinya: jika credit memang eligible untuk keluarga produk ini, jalur
Agent Search **sudah merupakan jalur billing yang benar** untuk membuktikannya
(SKU search Discovery Engine), bukan jalur Gemini API.

## 5. Signal sekunder (bukan source of truth)

- Forum Google AI Developers & Reddit r/googlecloud melaporkan credit
  "GenAI App Builder" **tidak** untuk general GCP services atau standard
  Gemini API (AI Studio), melainkan terkait Agent Builder / Search / RAG.
  Digunakan hanya sebagai **signal tambahan**, tidak pernah sebagai bukti.

## 6. Kesimpulan & gate

- `ELIGIBILITY_CONFIRMED = false` (belum ada bukti SKU-level dari Billing Console).
- **PAID TEST DIHENTIKAN** sampai user memverifikasi §7.
- Semua worklow berbayar (search live, sync data store, load test) dilarang.

## 7. Tindakan manual yang dibutuhkan (user, di Billing Console)

1. Buka **Billing → Credits & promotions** → pilih credit → lihat **promotion terms** & daftar eligible services.
2. Catat **SKU / SKU group** yang dicantumkan (mis. `vertex-ai-search-and-conversation`, `discovery-engine`).
3. Buka **Billing → Cost table / Billing export (BigQuery)** untuk melihat apakah usage Agent Search di-offset credit.
4. Update `ELIGIBILITY.md` + `BILLING_PROOF.md` sesuai temuan; baru aktifkan `GOOGLE_AGENT_PLATFORM_ENABLED=true`.

## 8. Referensi resmi

- Agent Search overview (branding note): https://docs.cloud.google.com/generative-ai-app-builder/docs
- Agent Search pricing: https://cloud.google.com/generative-ai-app-builder/pricing
- Gemini Enterprise Agent Platform: https://cloud.google.com/products/gemini-enterprise-agent-platform
- Gemini Enterprise Agent Platform pricing: https://cloud.google.com/products/gemini-enterprise-agent-platform/pricing
