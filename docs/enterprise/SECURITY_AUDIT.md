# CashFlow — Security Review

> Audit READ-ONLY · 2 Agustus 2026 · Evidence-based · Sumber: `server/lib/auth.js`, `server/middleware/authMiddleware.js`, `server/lib/vertexContext.js`, `server/services/agentSearchService.js`, `server/services/metricsService.js`, `server/config/metricsConfig.js`, `src/config/env.ts`, `.gitignore`, `.env.example`.

---

## 1. Matriks Keamanan

| Area | Status | Detail & Bukti |
|---|---|---|
| **Authentication** | ✅ Strong | Better Auth + Google OAuth; session cookie httpOnly `better-auth.session_token`; `authMiddleware` set `req.user`; retry+500 jujur (bukan 401 palsu) |
| **Authorization** | ✅ Layered | `requireAuth` 401; `resolveAdmin` (ADMIN_EMAILS) 401/403; `resolveAgentSearchUser` user-scope; E2E guard terverifikasi |
| **Session** | ✅ | Tabel `session` Turso; `cookieCache` 5m; `storeStateStrategy: cookie`; SessionExpiredDialog auto-logout |
| **Cookies** | ✅ | httpOnly, sameSite Lax, secure otomatis di produksi (`useSecureCookies`); fail-fast secret |
| **CSRF** | ✅/⚠️ | sameSite=Lax memblokir cross-site POST umum; Better Auth state strategy cookie; tanpa CSRF token eksplisit (Lax cukup untuk SPA+OAuth) |
| **XSS** | ✅/⚠️ | React escaping default; tanpa CSP header (helmet absent) — ini gap header-level |
| **Injection (SQL)** | ✅ | Semua query Turso memakai prepared statements (`client.execute({ sql, args })`) — 0 string concat user input pada SQL |
| **Secrets** | ✅/⚠️ | `.gitignore` ketat + audit staging 0 secret; fail-fast; ⚠️ `AGENT_SEARCH_USER_HASH_SALT` fallback dev; ⚠️ `VITE_TURSO_AUTH_TOKEN` deklarasi client |
| **Logging PII** | ✅ | `sanitizeMetadata` (drop token/secret/base64/body/raw/email key), `sanitizeErrorMessage` (redact JWT/API key/path/cap 400); konsol agent-search diagnostics pakai hash |
| **PII / Financial Data** | ✅ | Agent Search: userId di-hash sebelum kirim ke Google (`hashUserId`); re-filter fail-closed; sanitize payload; Gmail body tidak disimpan penuh (extracted_note saja) |
| **Prompt Injection** | ⚠️ | `cleanText` batasi panjang; `ignoreAdversarialQuery` di `:answer`; **tanpa guard server-side** untuk instruksi adversarial dalam isi email sebelum masuk `buildExtractionPrompt` |
| **Model Abuse** | ⚠️ | Rate limit AI tidak ada (bisa boros quota); cost dimonitor tapi tanpa alert channel |
| **Gmail Tokens** | ✅ | Access/refresh token di tabel `account` (Better Auth); scope minimal `gmail.readonly`; tidak di-log |
| **Agent Search** | ✅ | Hash per-user + filter server-side + defense-in-depth; skip docs mengandung secret; GCS `no-store` |
| **Cloud Storage** | ✅/⚠️ | `cacheControl: no-store`; tanpa signed URL (internal bucket); IAM role tidak terdokumentasi |

---

## 2. Temuan Detail

### 🔴 High
**H-1 — Rate limiting tidak ada.** `express-rate-limit`/helmet 0 di deps. Semua endpoint (auth, AI gemini, agent-search, gmail sync) terbuka untuk abuse → biaya Vertex/quota exhaustion, brute-force state endpoint (Better Auth cookie store), DoS via receipt upload (multer in-memory 10mb). **Fix**: `express-rate-limit` per-route (auth stricter) + payload cap.

**H-2 — `AGENT_SEARCH_USER_HASH_SALT` fallback dev.** `hashUserId()` memakai `'cashflow-dev-agent-search-salt-change-in-production'` bila env kosong. Di produksi tanpa set env: (a) hash dapat direkonstruksi oleh siapa pun yang tahu pola; (b) bila salt di-set setelah data ter-upload, semua hash berubah → user-scope filter mengembalikan hasil kosong (privasi aman, fungsi rusak). **Fix**: fail-fast warning + dokumentasi + re-sync setelah set.

### 🟠 Medium
**M-1 — `VITE_TURSO_*` dead config di client bundle.** `src/config/env.ts` mendeklarasikan `turso: { url, authToken }` dari `import.meta.env.VITE_TURSO_DATABASE_URL/AUTH_TOKEN`. Meski **0 consumer** saat ini, bila nilai di-set di `.env.local` → token DB masuk bundle browser (Vite statically replaces `import.meta.env.*`). **Fix**: hapus blok `turso` dari `env.ts` (atau rename non-VITE). Ini persis pola Supabase key yang pernah bocor.

**M-2 — Tidak ada security headers.** Tanpa helmet: tidak ada CSP, X-Frame-Options, X-Content-Type-Options, HSTS, Referrer-Policy. **Fix**: `helmet` + CSP untuk SPA.

**M-3 — No brute-force/abuse guard pada endpoint AI.** Receipt OCR + gemini extract bisa dipanggil tanpa rate limit per-user.

### 🟡 Low
- **L-1** — Envelope error heterogen: 401 dari `requireAuth` = `{ error }`, admin = `{ ok:false, code }`, AI = `{ success:false, ... }` — tidak membocorkan secret, tapi menyulitkan klien mem-parsing (sudah di-cover contract tests).
- **L-2** — `console.log` server bisa menampilkan detail error non-produksi saja (`!isProduction()` guard) — ✅ aman; tapi konsol agent-search diagnostics menulis hash prefix (PII-safe).
- **L-3** — CORS whitelist dev (`localhost:5180`) harus diperluas via `ALLOWED_ORIGINS` produksi — sudah didukung env.

---

## 3. Kekuatan yang Perlu Dipertahankan

1. **Prepared statements di semua query DB** — 0 SQL injection.
2. **Privacy pipeline Agent Search**: hash + sanitize + fail-closed re-filter + skip dokumen ber-secret.
3. **Metrics privacy**: metadata & error message di-sanitize sebelum persist; PII dilarang di log metrics.
4. **Fail-fast auth**: produksi tanpa secret = crash (bukan silent downgrade).
5. **authMiddleware membedakan** "belum login" (401) vs "error DB" (500 jujur) — tidak ada info bocor status.
6. **Gmail scope minimal** (`gmail.readonly`) + token tersimpan server-side saja.

---

## 4. Skor Keamanan

| Dimensi | Skor /10 | Keterangan |
|---|---|---|
| Auth & session | 9.0 | Better Auth + hardening penuh |
| Authorization | 8.5 | Layered guards + E2E verified |
| Data privacy (PII) | 8.5 | Hash + sanitize di semua jalur |
| Injection | 9.0 | Prepared statements 100% |
| Secrets management | 7.5 | Gitignore + fail-fast; minus salt fallback |
| Endpoint hardening | 3.0 | No rate-limit, no helmet |
| AI/model safety | 4.5 | Ignore adversarial; no prompt-injection guard, no abuse limit |
| **Security** | **7.2 / 10** | |

---

## 5. Rekomendasi Prioritas

1. **P0**: `express-rate-limit` (auth: ~10/min/IP; AI: ~30/min/user; receipt: ~5/min/user) + `helmet` dengan CSP SPA.
2. **P0**: Hapus blok `turso` dari `src/config/env.ts` (dead config) + verifikasi grep `VITE_TURSO` = 0.
3. **P1**: Set `AGENT_SEARCH_USER_HASH_SALT` produksi wajib (fail-fast) + dokumentasi re-sync.
4. **P1**: Server-side prompt-injection guard untuk input email/subject (strip instruction-style content bila bukan transaksi; max length + sanitize marker).
5. **P2**: Alert/abuse detection: pemicu per-user pada metrics (`system_metrics`) saat rate mendekati threshold.
6. **P2**: Audit `supabase/` arsip + `firestore.*` + docs legacy — hapus/arsip (lihat TECHNICAL_DEBT_REPORT).
