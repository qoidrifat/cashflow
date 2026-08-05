# Documentation Review

> **Status:** Approved · **Version:** 1.0 · **Owner:** Qoid Rif'at
> **Last Updated:** 2026-08-04 · **Related:** [DIRECTORY_STRUCTURE](DIRECTORY_STRUCTURE.md), [QUALITY_REVIEW](QUALITY_REVIEW.md)
> **Audience:** Maintainers, documentation contributors

---

## 1. Summary

Documentation is the **strongest asset** of this repository: **192 `.md` files** (157 real + 35 `INDEX.md`) across 17 active folders + `docs/archive/` (63 real docs). A documentation-modernization pass (`b08659f`) already delivered governance (`docs/meta/`), ADRs (`docs/adr/`), a navigation hub (`DOCUMENTATION_MAP.md`), and a clean archive policy.

This review focuses on **release-blocking issues** and **consistency drift** for public publication.

---

## 2. Live Counts (verified 2026-08-04)

| Folder | Real docs | Notes |
|---|---|---|
| `docs/adr/` | 7 | ADR-001..007 |
| `docs/ai-pipeline/` | 2 | Early AI audits (historical ref) |
| `docs/architecture/` | 6 | System audit, code quality, gap analysis, compliance matrix |
| `docs/e2e/` | 10 | Strategy, coverage, stability, CI pipeline |
| `docs/enterprise/` | 12 | Modernization audit + roadmap |
| `docs/gmail-sync/` | 18 | Feature checklists (historical ref) |
| `docs/google-cloud/` | 2 | GCP / Agent Builder setup |
| `docs/meta/` | 7 | Documentation system governance |
| `docs/mobile/` | 3 | Historical UI checklists |
| `docs/performance/` | 1 | Performance audit |
| `docs/security/` | 1 | Security audit |
| `docs/system/` | 4 | Architecture, audit report, feature matrix, screenshot index |
| `docs/transactions/` | 4 | Historical checklists |
| `docs/ui/` | 3 | Historical UI checklists |
| `docs/repository/` | 12 | Repository curation & GitHub prep (this task) |
| `docs/archive/` | 63 | workflow-reviews 43 · feature-docs 13 · root 6 (+ `ARCHIVE.md` policy) |
| `docs/` root | 1 | `DOCUMENTATION_MAP.md` (hub canonical; `notification-database-schema.md` → archive 2026-08-05) |

---

## 3. Findings

### 3.1 🔴 Duplicate/live counts drift in `DOCUMENTATION_MAP.md` (existing doc)

The Map (last updated 2026-08-04) contains stale figures vs. ground truth:

| Claim in Map | Verified actual | Impact |
|---|---|---|
| "every folder has `INDEX.md` (19)" | 35 INDEX files | Low — cosmetic |
| header total "146 + 34 = 180" | 157 + 35 = 192 | Low — cosmetic |
| `docs/architecture/` row "7" | 6 real docs | Low |
| archive "63" (62 docs + `ARCHIVE.md`) | **Correct** (63 real + 17 INDEX = 80) | None — map accurate |

**Recommendation:** refresh the Map counts in the same pass as this curation task.

### 3.2 Language consistency

- Public docs (`README`, `docs/system/`, `docs/e2e/`, `docs/enterprise/`, `docs/meta/`, new `docs/repository/`): **English** ✅.
- Historical/feature folders (`docs/gmail-sync/`, `docs/transactions/`, `docs/mobile/`, `docs/ui/`, archived docs): **Indonesian** — acceptable per `docs/meta/DOCUMENTATION_STYLE_GUIDE.md` §5 (internal/historical), but **not mixed within a single new document** (compliant).
- **Recommendation:** no action needed; optionally add language tags to historical folders' INDEX files.

### 3.3 Supabase/Firebase references in active docs

- `docs/system/` + `docs/meta/` are clean (verified in cleanup commit `55d11d2`).
- `.kiro/specs/auth.md` and `.kiro/specs/monitoring.md` still describe the **Supabase-era** architecture — but `.kiro/` is internal (see [LEGACY_REPORT](LEGACY_REPORT.md)); mark superseded if `.kiro/` is kept.

### 3.4 Outdated screenshots

- `docs/assets/screenshots/` (21 PNG) captured **2026-08-03** against the current UI — current, but they contain **real dev data** (transaction amounts, email subjects). See PII note in [SECURITY_REPOSITORY_REVIEW](SECURITY_REPOSITORY_REVIEW.md) §3.3.

### 3.5 Broken links & structural quality (from the modernization pass)

- 0 broken links across 461 links / 193 files (custom checker, verified 2026-08-04).
- Every docs folder has `INDEX.md`; Mermaid fences balanced; `.gitattributes` enforces LF.

---

## 4. Recommendations

1. Refresh `DOCUMENTATION_MAP.md` counts (Section 3.1) — can be bundled with this curation commit.
2. Mark `.kiro` Supabase-era specs as superseded or exclude `.kiro` from the public repo.
3. Before public publish: re-capture `docs/assets/screenshots/` with **masked/seed data** (PII).
4. No doc merges needed — the 2026-08-04 structure is already the target IA.

---

## References

- [DIRECTORY_STRUCTURE.md](DIRECTORY_STRUCTURE.md)
- [docs/meta/DOCUMENTATION_STYLE_GUIDE.md](../meta/DOCUMENTATION_STYLE_GUIDE.md)
- [docs/DOCUMENTATION_MAP.md](../DOCUMENTATION_MAP.md)
