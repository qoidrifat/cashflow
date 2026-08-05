# adr — Documentation Index

> **Status:** Active · **Owner:** Core Engineering · **Last Updated:** 2026-08-05

## Overview

Architecture Decision Records — keputusan arsitektur penting yang didokumentasikan (Better Auth, Turso, SSE, AI pipeline, monitoring, Discovery Engine, Gmail Sync, Pages, CI runtime, observability, fraud detection).

## Documents

| Document | Description |
|---|---|
| [ADR-001-better-auth.md](ADR-001-better-auth.md) | Autentikasi & sesi via Better Auth (cookie session, bukan JWT). |
| [ADR-002-turso.md](ADR-002-turso.md) | Database Turso (libSQL) sebagai sumber kebenaran utama. |
| [ADR-003-sse.md](ADR-003-sse.md) | Realtime via Server-Sent Events (bukan WebSocket/polling). |
| [ADR-004-ai-pipeline.md](ADR-004-ai-pipeline.md) | Pipeline AI Gemini/Vertex: prompt → retry → fallback → parser. |
| [ADR-005-monitoring.md](ADR-005-monitoring.md) | Monitoring in-database + alert scheduler + channel notifikasi. |
| [ADR-006-discovery-engine.md](ADR-006-discovery-engine.md) | Google Discovery Engine untuk AI Search (grounded answers). |
| [ADR-007-gmail-sync.md](ADR-007-gmail-sync.md) | Gmail Sync pipeline (review → approve/reject/duplicate). |
| [ADR-008-github-pages-deployment.md](ADR-008-github-pages-deployment.md) | Deploy frontend ke GitHub Pages + `.nojekyll` (fix Jekyll). |
| [ADR-009-github-actions-node24.md](ADR-009-github-actions-node24.md) | Migrasi runtime GitHub Actions ke Node 24 (actions v5/v6). |
| [ADR-010-observability.md](ADR-010-observability.md) | Request-ID + pino structured logs + HTTP metrics + jalur OTel. |
| [ADR-011-fraud-detection.md](ADR-011-fraud-detection.md) | Arsitektur fraud detection berlapis (rules → AI scoring → ML). |
| [INDEX.md](INDEX.md) | Indeks folder ini. |

## Related

- [Documentation Map](../DOCUMENTATION_MAP.md) — peta lengkap seluruh dokumentasi.
- [Meta documentation](../meta/INDEX.md) — sistem dokumentasi & konvensi.
- [Root README](../../README.md) — entry point repository.
