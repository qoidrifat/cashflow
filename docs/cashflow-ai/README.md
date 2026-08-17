# CashFlow AI Knowledge Base — Manifest (P0.14)

> **Status:** Active (P0.14 artifact) · **Owner:** Core Engineering · **Last Updated:** 2026-08-14

Dokumen ini adalah **manifest** sumber pengetahuan untuk **CashFlow AI Knowledge
Assistant** (P0.14) — knowledge retrieval yang grounded atas dokumentasi produk
CashFlow. **Tidak ada dokumentasi palsu di sini:** setiap topik dipetakan ke
file yang benar-benar ada di repository. Topik yang belum punya dokumen resmi
(wallet onboarding, provider capability, semantic verification — riwayat
P0.12/P0.13 tersimpan di `task-list.md` / `agent.md`) **tidak dibuat-buat**;
file kerja tetap menjadi sumbernya.

## Prinsip data (P0.14 §8, §24, §25)

Yang BOLEH masuk knowledge base:

- Dokumentasi produk / fitur / arsitektur non-sensitif
- Aturan keamanan & kepatuhan yang bersifat produk
- FAQ & panduan penggunaan

Yang TIDAK PERNAH masuk:

- Password, API key, OAuth token, private key
- Gmail full-body, baris transaksi finansial user, PII user
- Dump database produksi
- `server/*service-account*.json`, `server/*.env`, `.env.local`

## Manifest topik → file nyata

| Topik | File sumber (nyata di repo) | Keterangan |
|---|---|---|
| Gambaran produk & fitur | [`../../README.md`](../../README.md) | Fitur utama, arsitektur, skema data |
| Autentikasi & sesi (Better Auth) | [`../security/SESSION_LIFECYCLE.md`](../security/SESSION_LIFECYCLE.md) · [`../security/BETTER_AUTH_CONFIG_CONTRACT.md`](../security/BETTER_AUTH_CONFIG_CONTRACT.md) · [`../adr/ADR-001-better-auth.md`](../adr/ADR-001-better-auth.md) | Kontrak cookie, CSRF origin, config pin |
| OAuth Google (local troubleshooting) | [`../auth/GOOGLE_OAUTH_LOCALHOST_TROUBLESHOOTING.md`](../auth/GOOGLE_OAUTH_LOCALHOST_TROUBLESHOOTING.md) | Pola host/port konsisten, state handling |
| Model finansial & perhitungan | [`../financial/FINANCIAL_CALCULATION_INTEGRITY.md`](../financial/FINANCIAL_CALCULATION_INTEGRITY.md) | Definisi saldo/income/expense, invariant |
| Model data & migrasi | [`../database/MIGRATIONS.md`](../database/MIGRATIONS.md) · [`../../turso-schema.sql`](../../turso-schema.sql) | Versioned migrations, schema contract |
| Gmail sync & dedup | [`../gmail/GMAIL_DEDUPLICATION_CONTRACT.md`](../gmail/GMAIL_DEDUPLICATION_CONTRACT.md) | Kontrak deduplikasi, metadata aman |
| AI product (dashboard/memory/timeline/simulation) | [`../ai-product/AI_DASHBOARD.md`](../ai-product/AI_DASHBOARD.md) · [`../ai-product/AI_MEMORY.md`](../ai-product/AI_MEMORY.md) · [`../ai-product/AI_TIMELINE.md`](../ai-product/AI_TIMELINE.md) · [`../ai-product/AI_SIMULATION.md`](../ai-product/AI_SIMULATION.md) · [`../ai-product/AI_CONVERSATION.md`](../ai-product/AI_CONVERSATION.md) · [`../ai-product/AI_EXPLAINABILITY.md`](../ai-product/AI_EXPLAINABILITY.md) · [`../ai-product/FINANCIAL_SCORE.md`](../ai-product/FINANCIAL_SCORE.md) | Fitur AI berbahasa Indonesia |
| API contract (ai-product) | [`../api/ai-product-api.md`](../api/ai-product-api.md) | OpenAPI-style schema |
| Privasi: export & hapus akun | [`../security/ACCOUNT_DATA_EXPORT.md`](../security/ACCOUNT_DATA_EXPORT.md) · [`../security/ACCOUNT_DELETION.md`](../security/ACCOUNT_DELETION.md) | Format versioned, wipe atomik |
| Audit & kepatuhan admin | [`../security/ADMIN_AUDIT_TRAIL.md`](../security/ADMIN_AUDIT_TRAIL.md) · [`../security/SCHEMA_DRIFT_GUARD.md`](../security/SCHEMA_DRIFT_GUARD.md) | Trail audit, drift guard |
| Rate limiting | [`../security/RATE_LIMITING.md`](../security/RATE_LIMITING.md) | express-rate-limit = single source of truth |
| Setup Google Cloud / Agent Search | [`../google-cloud/GENAI_APP_BUILDER_CASHFLOW_SETUP.md`](../google-cloud/GENAI_APP_BUILDER_CASHFLOW_SETUP.md) · [`../google-cloud/GENAI_APP_BUILDER_IMPLEMENTATION_CHECKLIST.md`](../google-cloud/GENAI_APP_BUILDER_IMPLEMENTATION_CHECKLIST.md) | Data store, engine, IAM, privacy rules |
| Enterprise summary | [`../enterprise/EXECUTIVE_SUMMARY.md`](../enterprise/EXECUTIVE_SUMMARY.md) | Ringkasan eksekutif produk |
| Rilis & CI | [`../ci/RELEASE_PROCESS.md`](../ci/RELEASE_PROCESS.md) | Proses rilis |

> Catatan: daftar di atas adalah **kurasi untuk proof P0.14** (non-sensitif).
> Jalur sync produksi yang sudah ada (`POST /api/agent-search/sync-docs`)
> membaca seluruh `docs/` dan men-skip file yang terindikasi mengandung secret
> (pola `-----BEGIN PRIVATE KEY-----`, `service_role`, `refresh_token`,
> `client_secret`) — lihat `server/services/agentSearchService.js`.

## Status verifikasi

- ✅ Setiap file di tabel di atas terverifikasi ada di repo (2026-08-14).
- ⏳ Sync ke data store knowledge (Discovery Engine) & query live: **menunggu
  billing eligibility proven** (lihat `../google-agent-platform/BILLING_PROOF.md`).
