# Security Policy

> **Status:** Approved · **Version:** 1.0 · **Owner:** Qoid Rif'at · **Last Updated:** 2026-08-04

## Supported Versions

| Version | Supported |
|---|---|
| 1.0.0 | ✅ |
| < 1.0.0 | ❌ |

## Reporting a Vulnerability

**Please do not open public issues for security vulnerabilities.** This project handles financial data, Gmail content, and PII — details must stay private until fixed.

Preferred channel:

1. **GitHub Security Advisories** — use the **Security** tab on the repository and select **Report a vulnerability** (private by default).
2. Alternatively, contact the maintainer directly on GitHub: [@qoidrifat](https://github.com/qoidrifat).

### What to include

- Description of the vulnerability and its impact.
- Affected version(s) and the component (auth, API, AI pipeline, Gmail sync, admin, etc.).
- Steps to reproduce or a minimal proof of concept.
- *(Optional)* Suggested fix.

### What NOT to include in public issues

- Real API keys, tokens, cookies, or credentials.
- Real transaction data, Gmail message bodies, or any PII — even redacted-looking fragments.

## Response Timeline

| Milestone | Target |
|---|---|
| Acknowledgment | Within 48 hours |
| Triage & severity assessment | Within 5 days |
| Fix for critical/high severity | As soon as possible; coordinated disclosure preferred |

We practice **coordinated disclosure**: after a fix is released, we will credit the reporter (if they consent).

## Security Scope

The following are explicitly in scope for security review:

- Authentication & session handling (Better Auth, cookies, CSRF).
- Authorization (admin gates, `ADMIN_EMAILS`, ownership checks).
- Secrets management (env files, service accounts, API keys).
- Data protection (PII, financial records, Gmail tokens — server-side only).
- AI safety (prompt injection resistance, quota abuse, model abuse).
- Infrastructure (rate limiting, helmet headers, graceful shutdown, backup integrity).

## Our Posture

- `server/.env`, `.env.local`, service-account JSONs, DB dumps, and screen recordings are git-ignored.
- CI uses GitHub secrets; a **Gitleaks secret-scan job** scans every push/PR against full git history and fails on new leaks (see [CONTRIBUTING.md](CONTRIBUTING.md)).
- If you discover a leaked credential, **rotate it immediately** and report it privately — do not attempt to redact-and-publish.
