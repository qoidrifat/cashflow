# google-agent-platform — Documentation Index

> **Status:** Active (P0.14/P0.15 artifact) · **Owner:** Core Engineering · **Last Updated:** 2026-08-14

## Overview

Dokumentasi P0.14/P0.15 — **Google Agent Platform Eligibility + Billing Proof** untuk
CashFlow AI Knowledge Assistant (capability TAMBAHAN, read-only, feature-flagged).

## Documents

| Document | Description |
|---|---|
| [ELIGIBILITY.md](ELIGIBILITY.md) | Investigasi credit "Trial credit for GenAI App Builder", tabel eligibility per SKU, evidence, gate |
| [ARCHITECTURE.md](ARCHITECTURE.md) | Arsitektur adapter/route/flag, data flow, security boundary, IAM, privacy audit |
| [BILLING_PROOF.md](BILLING_PROOF.md) | Baseline, workload plan minimal, billing proof matrix, prosedur verifikasi, status |
| [P015_BILLING_PROOF.md](P015_BILLING_PROOF.md) | **P0.15 Controlled Billing Proof** — run rep-side + gate decision, status `BLOCKED — ELIGIBILITY UNPROVEN` |

## Status ringkas

- Repo-side preparation: ✅ selesai (adapter, route, unit test, E2E, docs) — **flag OFF**.
- Billing eligibility: **BLOCKED — ELIGIBILITY UNPROVEN** (butuh verifikasi Billing Console — lihat `P015_BILLING_PROOF.md` §35).
- Paid workload: **belum dijalankan** (0 query; gate P0.15 belum lolos).

## Related

- [Knowledge base manifest](../cashflow-ai/README.md) — topik → file sumber nyata.
- [GenAI App Builder setup](../google-cloud/GENAI_APP_BUILDER_CASHFLOW_SETUP.md) — setup Agent Search existing.
- [Documentation Map](../DOCUMENTATION_MAP.md) — peta lengkap seluruh dokumentasi.
