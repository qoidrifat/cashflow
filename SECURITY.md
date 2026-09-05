# Security Policy

> **Status:** Approved · **Version:** 1.1 · **Owner:** Qoid Rif'at · **Last Updated:** 2026-09-04

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

## Residual Risks (Dokumentasi Transparansi)

Risiko berikut adalah **trade-off desain yang disengaja** — masing-masing
didokumentasikan bersama mitigasinya (audit end-to-end 2026-09-04,
lihat `file.md`). Tidak ada yang memblokir rilis; dipantau untuk iterasi.

### 1. Login-CSRF via OAuth state DB-only

- **Desain:** `server/lib/auth.js` — `account.skipStateCookieCheck: true`;
  state OAuth disimpan server-side (tabel `verification`), TIDAK di-cookie.
- **Kenapa:** cookie state lintas cookie-jar tidak pernah sampai ke callback
  (webview preview → Chrome eksternal — root cause bug Freebuff Preview).
- **Residual:** siapa pun yang menangkap URL callback (state + code) dapat
  menyelesaikan login → sesi terikat ke akun Google attacker.
- **Mitigasi aktif:** state single-use (row dihapus saat callback), expiry
  checked, replay ditolak, origin/CSRF check Better Auth tetap aktif.
- **Jangka panjang:** bind state ke fingerprint sesi (hash session ID / UA).

### 2. Password hash ikut dalam export data user

- **Desain:** `server/routes/privacyRoutes.js` — export
  `SELECT * FROM user` (portabilitas data; user meminta data miliknya).
- **Residual:** kolom `password` (hash) termasuk dalam file export.
- **Mitigasi aktif:** hanya user sendiri (requireAuth + userId match);
  file export di browser, tidak pernah lewat server pihak ketiga.
- **Catatan:** hash bukan plaintext; tetap disebut di sini agar pemegang
  file export menyadari isinya sensitif.

### 3. Gmail access token dikirim ke browser

- **Desain:** `GET /api/gmail/token` mengembalikan accessToken Gmail
  (`gmail.readonly`) ke SPA untuk fetch langsung ke Gmail API — server tidak
  mem-proxy tiap panggilan.
- **Residual:** satu XSS (atau dependency compromised) = token inbox bisa
  dicuri (valid ~1 jam; `refreshToken` TIDAK pernah dikirim).
- **Mitigasi aktif:** expiry check dengan skew 60s, XSS surface minim
  (0 `dangerouslySetInnerHTML`/`eval` di src), CSP helmet, pino redaction.
- **Jangka panjang:** proxy Gmail via server (token tak pernah keluar).

### 4. Wildcard tunneling origin (dev-only)

- **Desain:** `trustedOrigins` memuat `https://*.loca.lt` / `*.ngrok-free.app`
  HANYA non-produksi (fase-2 audit).
- **Residual di dev:** subdomain tunneling publik bisa menginisiasi OAuth
  flow. Produksi: daftar eksplisit via `BETTER_AUTH_TRUSTED_ORIGINS`.

## Riwayat Hardening

| Tanggal | Aksi | Sumber |
|---|---|---|
| 2026-09-04 | Rotasi `BETTER_AUTH_SECRET` + `TURSO_AUTH_TOKEN`; hapus dead-config `GEMINI_API_KEY` / `BETTER_AUTH_API_KEY`; multer 1.x→2.x; SSE connection cap; `trustedOrigins` dev-only; validasi `ALLOWED_ORIGINS` boot; wallet UNIQUE index; `upgradeInsecureRequests` produksi; trust-proxy clamp | `file.md` fase-2/4 |
| 2026-08 | Gitleaks CI gate; dependency audit tiered; schema drift guard; pin cookie flags Better Auth | `SECURITY.md` v1.0, CI |
