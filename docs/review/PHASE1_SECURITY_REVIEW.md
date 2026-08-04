# PHASE 1 — Security Review

> Audit: 2026-08-04 · Fokus: auth, authorization, cookies, token exposure, CSRF, privilege escalation, replay, logging, secrets.
> Lingkup: perubahan Phase-1 (Gemini auth, Gmail token expiry, notifikasi) + state keamanan terkini.

---

## 1. Ringkasan

| Area | Status | Skor |
|---|---|---|
| Authentication (Better Auth) | ✅ Fail-fast secret produksi + secure cookies | 9.0/10 |
| Authorization (admin, agent-search, notifikasi) | ✅ `req.user` + `ADMIN_EMAILS` — Supabase JWT hilang | 9.0/10 |
| Session cookies | ✅ httpOnly, sameSite Lax, secure di produksi | 8.5/10 |
| Token exposure (Gmail) | ✅ `refreshToken` tidak pernah keluar server; fail-closed expiry | 9.5/10 |
| CSRF | ✅ cookie sameSite Lax + state strategy cookie | 8.0/10 |
| Privilege escalation | ✅ ownership check `WHERE user_id = ?` semua mutasi | 9.0/10 |
| Replay attack | ⚠️ Tidak ada nonce/anti-replay pada request individual (cookie sesi = lapisan standar) | 6.5/10 |
| Logging & secrets | ⚠️ Error mentah bisa bocor ke client di non-produksi (`detail`) | 7.0/10 |
| **Overall** | — | **8.5/10** |

---

## 2. Authentication (Better Auth) — `server/lib/auth.js`

### Verifikasi hardening produksi
| Item | Implementasi | Verdict |
|---|---|---|
| `BETTER_AUTH_SECRET` produksi | Fail-fast: `if (isProduction && usingFallbackSecret) throw` — server **menolak boot** dengan fallback dev di produksi | ✅ |
| `useSecureCookies` | `useSecureCookies: isProduction` (L97) + `defaultCookieAttributes.secure: isProduction` | ✅ |
| trustedOrigins | localhost + better-auth.com + **wildcard `*.loca.lt` / `*.ngrok-free.app`** + env `BETTER_AUTH_TRUSTED_ORIGINS` | ⚠️ wildcard tetap — risiko CSRF/abuse rendah di produksi |
| Secret dibaca saat getAuth | Bukan module top-level (dotenv belum load) — menghindari silent fallback | ✅ |
| Scope Google OAuth | `gmail.readonly` — least-privilege | ✅ |
| Cookie cache | 5 menit (`cookieCache.maxAge`) | ✅ |

### Temuan
- **Low**: wildcard `*.ngrok-free.app` / `*.loca.lt` di `trustedOrigins` — di produksi, ganti dengan origin eksplisit + `BETTER_AUTH_TRUSTED_ORIGINS`.

---

## 3. Authorization

### 3a. Admin metrics — `server/routes/adminMetricsRoutes.js`
- Auth: `req.user` dari `authMiddleware` (Better Auth session cookie) — **bukan** Supabase JWT.
- Admin check: `getAdminEmails()` (env `ADMIN_EMAILS`, case-insensitive) — email user harus ada di daftar.
- Tidak ada email → 401; bukan admin → 403. (E2E `admin-metrics-auth.spec.ts` mengunci 401/403/200.)

### 3b. Agent Search — `server/routes/agentSearchRoutes.js`
- `resolveAgentSearchUser(req, { required })`: tab user-scoped (`transactions/insight/gmail/receipts`) tanpa login → **401**; tab publik (`help`) boleh anonim.
- Urutan dipertahankan: **auth gate dulu**, validasi body setelahnya (diuji G4).

### 3c. Notifikasi — `server/routes/notificationRoutes.js`
- Semua mutasi (`POST/PUT/DELETE`) di-scope `WHERE user_id = ?` → **tidak ada privilege escalation** lintas user.
- `POST /api/notifications` side effect webhook Gmail review: **corroboration server-side** (`gmail_sync_logs` milik user + status kompatibel) — webhook/email diblokir untuk POST forjaan (P1-4 guard).

---

## 4. Token Exposure (Gmail OAuth)

### `GET /api/gmail/token`
- `SELECT accessToken, accessTokenExpiresAt FROM account WHERE userId = ? AND providerId = 'google'` — **`refreshToken` TIDAK di-select** (dibuktikan unit test: `expect(sql).not.toContain('refreshToken')`).
- Fail closed: expiry tidak bisa diparse / dalam skew 60s → `401 token_expired` — token umur tak diketahui tidak pernah dibagikan.
- Client cache in-memory saja (`authService.ts`); `sessionStorage` legacy di-purge.

### Privacy
- `sanitizeAgentSearchPayload` di service agent-search memfilter key sensitif (`token|refresh|secret|service_role|api_key|...`) dan string `data:image|-----BEGIN|ya29.|eyJ...` sebelum di-index — PII/financial data tidak ikut data store.

---

## 5. CSRF, Replay, Injection

| Vektor | Status | Bukti |
|---|---|---|
| CSRF | ✅ sameSite Lax + `storeStateStrategy: 'cookie'` | `auth.js` |
| XSS via actionHref | ✅ `validateActionHref` menolak `javascript:`/`data:` — hanya http(s) atau path relatif | `notificationRoutes.js` |
| Prototype pollution (metadata) | ✅ `sanitizeNotificationMetadata` strip `__proto__` (unit test G3 + metadata-guard) | `notificationGuard.js` |
| SQL injection | ✅ parameter binding + whitelist sort/type/enum | `gmailRoutes.js`, `notificationRoutes.js` |
| Replay | ⚠️ Tidak ada nonce per-request — mitigated oleh HTTPS + httpOnly cookie + short session | standar web |

---

## 6. Logging & Error Exposure

- `logger` frontend di-gate `import.meta.env.DEV`.
- Server: `logger.warn/error` terstruktur (pino-style) untuk auth retry, dedupe, forgery gmail_review.
- **Risiko sedang**: `sendGeminiError` / `sendAgentSearchError` mengirim `detail: error.message` saat **non-produksi** (untuk debugging) — bisa membocorkan detail internal ke UI dev. Di produksi `isProduction()` memfilter. ✅ dikontrol.
- `api.ts` melempar `errorText` mentah ke UI — konten dikontrol handler (validation messages human-readable), bukan stack mentah.

---

## 7. Temuan & Rekomendasi

| # | Severity | Temuan | Rekomendasi |
|---|---|---|---|
| S-1 | **Low** | Wildcard trustedOrigins ngrok/loca.lt | Hapus di produksi; gunakan env `BETTER_AUTH_TRUSTED_ORIGINS` |
| S-2 | **Low** | `detail` error dikirim ke client di non-produksi | Konfirmasi tidak pernah muncul di produksi (sudah di-gate `isProduction()`) |
| S-3 | **Low** | Tidak ada nonce anti-replay | Opsional: double-submit cookie untuk mutasi sensitif |
| S-4 | **Info** | `SECURITY_AUDIT.md` §4 stale (resolveAdmin Supabase) | **DIPERBARUI** dalam audit ini |

**Tidak ada temuan Critical/High.** Postur keamanan Phase-1 lebih kuat dari baseline audit sebelumnya (7.6/10 → 8.5/10).
