# README Improvement Report

**Project:** CashFlow
**Date:** 2026-08-04
**Subject:** Rewrite of `README.md` to match the implemented architecture.

The README was the single highest-visibility document with the most drift. It was rewritten in place while preserving project branding and tone.

---

## Before / After Section Matrix

| Section | Before | After |
|---|---|---|
| Stack overview | Claimed Express 5 | Corrected to Express 4.22.2 |
| Environment variables | Listed `GEMINI_API_KEY` as required | Env table without `GEMINI_API_KEY`; documents Vertex AI service-account path |
| Architecture diagram | GCS mislabeled as general storage | GCS label corrected (JSONL staging for Discovery Engine) |
| Folder structure | Outdated layout | Corrected to current repo structure |
| Realtime | No dedicated coverage | New dedicated **SSE section** (`GET /api/events`, 12 event types) |
| Changelog link | Undefined `[1.0.0]` reference | Fixed |
| Tooling claim | Overstated ESLint coverage | ESLint claim corrected |

---

## Branding Preserved

The rewrite intentionally kept the following unchanged to preserve identity and voice:

| Element | Status |
|---|---|
| Project name & tagline | ✅ Preserved |
| Logo / badge block | ✅ Preserved |
| Overall section ordering | ✅ Preserved |
| Writing tone & terminology | ✅ Preserved |
| Existing screenshots & links (valid ones) | ✅ Preserved |

---

## Fixes Applied

| # | Fix | Type |
|---|---|---|
| 1 | Express 5 → Express 4.22.2 | Architecture correction |
| 2 | Removed `GEMINI_API_KEY` from env table | Config correction |
| 3 | Corrected GCS diagram label | Diagram correction |
| 4 | Corrected folder structure | Structure correction |
| 5 | Added dedicated SSE section | New content |
| 6 | Fixed undefined `[1.0.0]` reference link | Link fix |
| 7 | Corrected ESLint claim | Tooling correction |

---

## Validation Checklist

| Check | Result |
|---|---|
| Express version claim matches `package.json` (4.22.2) | ✅ |
| Env table free of `GEMINI_API_KEY` | ✅ |
| Diagram GCS label matches implementation | ✅ |
| Folder structure matches repository layout | ✅ |
| SSE section present and accurate (12 event types) | ✅ |
| All internal links resolve | ✅ |
| Branding elements intact | ✅ |

---

## Result

The README now accurately reflects the shipped architecture (React 18 + TS + Vite 5 / Express 4 / Better Auth / Turso / SSE / Vertex AI via service account / Discovery Engine) and serves as a trustworthy entry point. It embeds the canonical architecture diagram rather than diverging from it (see [DUPLICATE_DOCUMENTATION_REPORT.md](./DUPLICATE_DOCUMENTATION_REPORT.md), Cluster 2).

See also [DOCUMENTATION_DRIFT.md](./DOCUMENTATION_DRIFT.md) for the full drift register.
