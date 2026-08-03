# Contributing to CashFlow

> **Status:** Approved · **Version:** 1.0 · **Owner:** Qoid Rif'at · **Last Updated:** 2026-08-04
> **Related:** [README](README.md) · [LICENSE](LICENSE) · [CODE_OF_CONDUCT](CODE_OF_CONDUCT.md) · [SECURITY](SECURITY.md) · [Documentation Map](docs/DOCUMENTATION_MAP.md)

Thanks for your interest in contributing to **CashFlow** — an AI-native personal finance platform (React + Express + Better Auth + Turso + Google Vertex AI).

Please read our [Code of Conduct](CODE_OF_CONDUCT.md) first. By participating, you agree to uphold it.

---

## 1. Getting Started

### Prerequisites

- **Node.js ≥ 20** and **npm ≥ 9**
- A **Turso** database (free tier at <https://turso.tech>)
- A **Google Cloud** project with the **Gemini API** enabled and an **OAuth consent screen** (required for Google login + Gmail sync)
- *(Optional)* Discovery Engine + Cloud Storage for AI Search features

### Local setup

```bash
git clone https://github.com/qoidrifat/cashflow.git
cd cashflow
npm install                     # root (frontend + tooling)
cd server && npm install && cd ..   # server has its own package.json
```

Configure environment (never commit real values):

```bash
cp .env.example .env                # frontend flags (VITE_*)
cp server/.env.example server/.env  # backend secrets (TURSO, GEMINI, GOOGLE…)
```

Apply the database schema to your Turso database:

```bash
node scripts/applyTursoSchema.mjs   # idempotent — safe to re-run
```

Run the dev stack:

```bash
npm run dev:all     # Vite on :5180 + Express API on :5181
```

Open <http://localhost:5180> and sign in with Google.

---

## 2. Project Layout (short)

| Path | Responsibility |
|---|---|
| `src/` | React 18 SPA (features, services, stores, utils) |
| `server/` | Express 5 API (routes/, services/, middleware/, lib/) |
| `e2e/` | Playwright: specs, helpers (session minting), contract, visual, performance |
| `tests/` | Vitest unit tests (parsers, validators, mappers, helpers) |
| `scripts/` | Ops utilities: schema apply, E2E seed, Turso backup/restore, stability gate |
| `docs/` | Enterprise documentation system (indexed; see [DOCUMENTATION_MAP](docs/DOCUMENTATION_MAP.md)) |
| `turso-schema.sql` | Canonical database schema (22 tables) |

---

## 3. Development Workflow

1. **Fork** the repository and create a feature branch:
   ```
   fix/gmail-review-dedupe
   feat/export-csv
   docs/auth-hardening
   ```
2. Make small, focused commits using **Conventional Commits**:
   ```
   feat: <summary>
   fix: <summary>
   perf: <summary>
   docs: <summary>
   test: <summary>
   chore: <summary>
   refactor: <summary>
   ci: <summary>
   ```
3. Add or update tests for your change (see [Testing](#4-testing)).
4. Run the quality gate (see [Quality Gate](#5-quality-gate)).
5. Open a pull request using the [PR template](.github/PULL_REQUEST_TEMPLATE.md).

---

## 4. Testing

| Layer | Command | When |
|---|---|---|
| Unit | `npm run test:unit` | Always for helpers/logic changes |
| API contract | `npm run test:e2e:contract` | After any API/shape change (detects schema drift) |
| E2E | `npm run test:e2e` | For user-flow changes (needs Turso DB + env) |
| E2E typecheck | `npm run test:e2e:typecheck` | After touching `e2e/` specs or helpers |
| Visual regression | `npm run test:e2e:visual:check` | After UI changes — verify baselines |
| Regenerate baselines | `npm run test:e2e:visual` | Only when a UI change is intentional |
| Performance budget | `npm run test:e2e:perf` | For performance-sensitive changes |
| Stability gate | `npm run test:e2e:stability` | Full suite ×3 (fail only on 3× flaky) |

> **E2E note:** E2E specs authenticate via minted Better Auth sessions and run against a real Turso database (set `TURSO_DATABASE_URL` / `TURSO_AUTH_TOKEN`). Pinned dataset guards live in `e2e/helpers/fixtures.ts` — update numbers there, not inside specs.

---

## 5. Quality Gate

Run **all** of these before opening a PR — CI runs the same gates:

```bash
npm run lint
npm run typecheck
npm run build
npm run test:unit
npm run test:e2e
```

Also run if applicable:

```bash
npm run test:e2e:typecheck   # if you touched e2e/ specs or helpers (CI runs it)
npm run test:e2e:contract    # if you changed an API response shape
npm run test:e2e:visual:check  # if you changed UI — update baselines deliberately
```

---

## 6. Secret Hygiene (mandatory)

This project processes **financial data and Gmail content**. Never leak credentials:

- Never commit `.env`, `.env.local`, `server/*.env`, service-account JSONs, or database dumps — all are git-ignored.
- Before committing, scan what you staged:
  ```bash
  git add -n . | grep -iE '\.env$|service-account|\.pem$|\.key$|backups/'
  git diff --cached | grep -cE 'service_role|-----BEGIN|AIza[0-9A-Za-z_-]{20}'
  ```
- If your PR touches documentation, do **not** copy real keys, tokens, or PII (even in "redacted-looking" examples — use `<REDACTED>`).
- Report security issues privately — see [SECURITY.md](SECURITY.md).

---

## 7. Documentation

CashFlow maintains an indexed documentation system:

- Every docs folder has an `INDEX.md`; keep it updated when adding docs.
- Follow [docs/meta/DOCUMENTATION_STYLE_GUIDE.md](docs/meta/DOCUMENTATION_STYLE_GUIDE.md) (metadata headers, English for public docs, relative links).
- Record meaningful architectural decisions as ADRs in [docs/adr/](docs/adr/INDEX.md).
- When behavior changes, update affected docs — **never leave active docs referencing `docs/archive/`**.
- If you change UI, re-capture screenshots via the Playwright cookie-auth harness and update `docs/assets/screenshots/` (mask real data).

---

## 8. Pull Request Process

1. Fill out the [PR template](.github/PULL_REQUEST_TEMPLATE.md).
2. Keep PRs focused — one logical change per PR.
3. CI runs 4 jobs: **Lint·Typecheck·Build**, **E2E (stability gate ×3)**, **Visual Regression**, **Performance Budget**. All must pass (a flaky pass is acceptable per the stability-gate policy; a 3× failure is a real regression).
4. Maintainers review within a few days. Be responsive to feedback.

---

## 9. Getting Help

- **Issues:** use our [bug report](.github/ISSUE_TEMPLATE/bug_report.md) / [feature request](.github/ISSUE_TEMPLATE/feature_request.md) templates.
- **Discussions / maintainer:** [Qoid Rif'at (@qoidrifat)](https://github.com/qoidrifat)
- **Docs:** [Documentation Map](docs/DOCUMENTATION_MAP.md)

---

## License

By contributing, you agree that your contributions are licensed under the [MIT License](LICENSE).
