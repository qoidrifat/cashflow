# Directory Structure — Current vs Recommended

> **Status:** Approved · **Version:** 1.0 · **Owner:** Qoid Rif'at
> **Last Updated:** 2026-08-04 · **Related:** [REPOSITORY_AUDIT](REPOSITORY_AUDIT.md), [DOCUMENTATION_REVIEW](DOCUMENTATION_REVIEW.md)
> **Audience:** Maintainers

---

## 1. Current Structure (verified)

```text
cashflow/
├─ src/                      # React frontend
├─ server/                   # Express API (index.js + routes/ services/ middleware/ lib/)
├─ e2e/                      # Playwright (specs/, helpers/, contract/, performance/, visual/ + baselines)
├─ tests/                    # Vitest unit tests
├─ scripts/                  # Ops utilities (11 files)
├─ public/                   # fonts/, logo/, (+1 debug PNG — see Clutter Report)
├─ docs/                     # 192 .md — already restructured (meta, adr, archive, system, enterprise…)
├─ .github/workflows/        # e2e.yml
├─ .agents/  .kiro/          # AI-agent scaffolding (40 + 19 files — see Legacy Report)
├─ *.config.ts/js            # root configs
├─ *.md                      # README, agent.md, task-list.md
├─ .gitignore  .gitattributes  .env.example
└─ turso-schema.sql
```

**Verdict:** the directory structure is already professional. The only structural debts are `.agents/`/`.kiro/`/`task-list.md` placement and the `public/` debug PNG.

---

## 2. Recommended Structure

```text
cashflow/
├─ src/            # unchanged
├─ server/         # unchanged
├─ e2e/            # unchanged
├─ tests/          # unchanged (Vitest)
├─ scripts/        # keep operational scripts; move verify-*.mjs → docs/archive/scripts/ or delete
├─ public/         # fonts/, logo/ — remove logout-debug-viewport.png
├─ docs/           # unchanged (already enterprise-grade IA)
├─ .github/        # + ISSUE_TEMPLATE/, PULL_REQUEST_TEMPLATE.md, dependabot.yml (see GITHUB_READINESS)
├─ AGENTS.md       # renamed from agent.md (optional)
└─ .gitignore      # + .agents/, .kiro/, task-list.md, public/logout-debug-viewport.png
```

### Changes & rationale

| # | Change | Status | Rationale |
|---|---|---|---|
| D1 | `gitignore .agents/` (and `skills-lock.json`) | ✅ done 2026-08-04 | Decommissioned-stack skill bundles; noise for contributors |
| D2 | `gitignore .kiro/` | ✅ done 2026-08-04 | Internal AI workflow; superseded specs |
| D3 | Move `task-list.md` → archive or gitignore | ✅ done 2026-08-04 (gitignored) | Personal to-do |
| D4 | Remove `public/logout-debug-viewport.png` from tracking | ✅ done 2026-08-04 | Debug leftover |
| D5 | Rename `agent.md` → `AGENTS.md` | ⏳ optional | Convention (`AGENTS.md` standard) |
| D6 | Add `.github/` templates + Dependabot | ✅ done 2026-08-04 | Open-source collaboration layer |
| D7 | Move superseded `scripts/verify-*.mjs` → `docs/archive/` | ⏳ pending | One-off tools superseded by E2E specs |

---

## 3. Docs Layout (target IA — already implemented)

Per `docs/meta/DOCUMENTATION_STRUCTURE.md` (Phase A, commit `b08659f`):

- `docs/architecture/` `security/` `performance/` — audits (split from old `docs/audit/`)
- `docs/system/` — current-state reference
- `docs/adr/` — decisions
- `docs/e2e/` — testing
- `docs/enterprise/` — roadmap
- `docs/meta/` — docs governance
- `docs/archive/` — history (never delete)
- `docs/assets/` — screenshots + diagrams

---

## References

- [REPOSITORY_AUDIT.md](REPOSITORY_AUDIT.md)
- [CLUTTER_REPORT.md](CLUTTER_REPORT.md)
- [LEGACY_REPORT.md](LEGACY_REPORT.md)
- [docs/meta/DOCUMENTATION_STRUCTURE.md](../meta/DOCUMENTATION_STRUCTURE.md)
