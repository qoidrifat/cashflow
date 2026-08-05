# ADR-008: GitHub Pages Deployment for the Frontend

> **Status:** Accepted · **Date:** 2026-08 · **Owner:** Core Engineering · **Related:** [ADR-009](ADR-009-github-actions-node24.md)

## Context

CashFlow's frontend is a static Vite/React SPA, while its API server (Express + Better Auth + Vertex AI) runs separately. The repository lives on the `gh-pages` branch and the team wanted a zero-infrastructure, HTTPS-by-default hosting path for the SPA that does not require a VPS. GitHub's built-in "Pages build and deployment" workflow failed on every push: it ran a Jekyll build that crashed with a Liquid syntax error because several markdown files contain `{{ ... }}` template placeholders (JavaScript template literals in docs).

## Decision

Deploy the SPA to **GitHub Pages** with Jekyll processing disabled:

- Add an empty `.nojekyll` marker at the repository root — bypasses Jekyll, publishes raw static files.
- Keep the built-in Pages workflow (`actions/deploy-pages` + `actions/upload-pages-artifact`) triggered per push.
- Branch strategy: `gh-pages` is the release branch; CI (e2e.yml) runs quality gates on it; Pages publishes its `dist`/public assets.
- The API server is **not** part of Pages — it remains a separately deployed Node process (see ADR-009 consequences and `docs/deployment/PRODUCTION_READINESS.md`).

## Alternatives Considered

| Option | Reason rejected |
|---|---|
| Vercel / Netlify | Great DX, but external account + vendor config for a static asset |
| Nginx on a VPS | Overkill for the SPA; server already runs the API on its own host |
| GitHub Pages with Jekyll | Broken out of the box (Liquid syntax error in docs with `{{ }}`) |

## Consequences

**Positive:** Zero-infrastructure HTTPS hosting; free; deploys on every push; `.nojekyll` unblocked the Pages pipeline permanently (run `30977074398` green).
**Negative:** SPA and API live on different origins → CORS + `BETTER_AUTH_TRUSTED_ORIGINS` + `ALLOWED_ORIGINS` must list the Pages domain in production; any secret-bearing content must never be committed to Pages (static exposure).
