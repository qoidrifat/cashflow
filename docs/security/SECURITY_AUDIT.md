# Security Audit — CashFlow

> Audit READ-ONLY · Tanggal: 1 Agustus 2026 · Fokus: secrets, auth cookies, Better Auth, Supabase, Gmail OAuth, service accounts, logging, token exposure.

## 1. Secrets Management

| Item | Status | Evidence |
|---|---|---|
| `server/.env` di-gitignore | ✅ Aman | `.gitignore` L12 `server/.env`; file ada lokal (`-rw-r--r-- server/.env`) tapi tidak ter-track |
| Service account JSON di-gitignore | ✅ Aman | `.gitignore` L13 `server/*.json`, L16 `server/*service-account*.json`, L17 `google-agent-search-service-account.json`, L18 `*.service-account.json` — file `cashflow-service-account.json` & `google-agent-search-service-account.json` ada di disk tapi ter-exclude |
| Root `.env` / `.env.local` | ✅ Aman | `.env.example` berisi template kosong; `.gitignore` menutup pola env |
| Turso credentials | ✅ Aman | `TURSO_DATABASE_URL`/`TURSO_AUTH_TOKEN` dibaca dari env; tidak ada hardcode |
| **BETTER_AUTH_SECRET fallback** | ⚠️ **Risiko** | `server/lib/auth.js` L31: fallback `'cashflow-dev-secret-change-in-production'`. Di produksi WAJIB set `BETTER_AUTH_SECRET`/`AUTH_SECRET`; fallback dev berarti cookie signature bisa ditebak. Severity: High jika produksi lupa override, Medium jika hanya dev |
| Google OAuth client secrets | ✅ Aman | `GOOGLE_CLIENT_ID`/`GOOGLE_CLIENT_SECRET` dari env (auth.js L43–44), default `''` |
| ADMIN_EMAILS | ✅ Aman | Dibaca dari env (`server/index.js` `resolveAdmin`) |

**Temuan kunci**: `.gitignore` menangani service accounts & .env dengan benar — temuan positif. Namun karena repo **belum pernah commit** (`git status`: "No commits yet", branch `gh-pages`), seluruh file saat ini untracked — risiko terbawa ke commit pertama bila .gitignore tidak dihormati. Rekomendasi: sebelum commit pertama, jalankan `git add .` lalu audit staging (`git status` / `git diff --cached --name-only`) untuk memastikan tidak ada `*.json` service account / `.env` yang ikut.

## 2. Authentication & Cookies (Better Auth)

| Item | Status | Evidence |
|---|---|---|
| Cookie `better-auth.session_token` | ✅ httpOnly, sameSite Lax | `auth.js` `advanced.defaultCookieAttributes { sameSite: 'lax', secure: false }` + E2E `authContext.ts` mereplikasi persis |
| `useSecureCookies` | ⚠️ `false` | `auth.js` L67 — benar untuk dev HTTP lokal (5180/5181), **WAJIB** menjadi `true` di produksi HTTPS |
| Session expiry | ✅ Cookie cache 5 menit + flow session-expired terpusat | `auth.js` cookieCache; `useSessionExpiryStore` per `.kiro/specs/auth.md` |
| Trusted origins | ✅ Scoped | localhost + better-auth.com + ngrok/loca.lt wildcard — wildcard `*.ngrok-free.app`/`*.loca.lt` adalah risiko CSRF/abuse kecil di produksi |

**Temuan**: konfigurasi auth sehat untuk dev. Sebelum deploy produksi: `useSecureCookies: true`, `secure: true`, hapus wildcard ngrok/loca.lt dari trustedOrigins, dan pastikan `BETTER_AUTH_SECRET` produksi berbeda dari fallback dev.

## 3. Gmail OAuth & Token Exposure

- Google OAuth scope `gmail.readonly` (auth.js) — prinsip least-privilege untuk scan email. ✅
- `provider_token` Gmail di-cache dari session (per `.kiro/specs/auth.md`); endpoint `/api/gmail/token` dilindungi `requireAuth`. ✅
- Token tidak pernah dikirim ke client bundle (semua AI/scan di server-side, `server/.env` GEMINI — lihat `.env.example`: "API key hanya di server"). ✅

## 4. Supabase (Kompatibilitas)

> **Update (2026-08-04):** stub `src/config/supabase.ts` yang diaudit di bagian ini sudah **dihapus** — Supabase di-decommission penuh sejak 2026-08-02. Temuan di seksi ini adalah arsip historis; tidak ada kode Supabase tersisa di jalur aktif.

- **`src/config/supabase.ts` = stub penuh** — tidak ada koneksi riil, tidak ada key client bundle. `@supabase/supabase-js` masih di dependencies tapi tidak aktif di jalur utama.
- ⚠️ **`resolveAdmin()` di `server/index.js` berkomentar "Supabase JWT"** (L1545–1547) — komentar tidak sinkron dengan stack Better Auth; **verifikasi diperlukan** apakah admin metrics masih memvalidasi JWT Supabase atau sudah pakai session Better Auth. Ini satu-satunya titik yang berpotensi bergantung pada Supabase legacy di server.

## 5. Logging & Error Exposure

| Item | Status | Evidence |
|---|---|---|
| `logger` frontend | ✅ | `src/lib/logger.ts` (`import.meta.env.DEV` gating) |
| Server logs | ⚠️ Moderate | `console.log/warn/error` mentah di `server/index.js` & `server/lib/turso.js`; tidak ada redaction otomatis. `.dev-server*.log` untracked di root (bukan bagian repo) |
| Error ke client | ⚠️ Moderate | `api.ts` melempar `errorText` mentah dari server (`throw new Error(errorText || ...)`) — bisa membocorkan detail internal (SQL/stack) ke UI bila handler server mengembalikan pesan mentah |

## 6. E2E Session Minting (Lingkup Test)

- `mintSession.ts` menulis baris `session` ke Turso **produksi/dev DB yang sama** dengan server — sesi `userAgent='e2e-test'`, dibersihkan oleh `cleanupTestSessions()` (afterAll semua spec).
- ⚠️ **Risiko residu**: bila test terputus paksa (kill -9), sesi e2e bisa tersisa — minor, tidak berbahaya (token random 24-byte, 7 hari expiry).
- ⚠️ **Akses langsung DB dari test** via `TURSO_DATABASE_URL`/`TURSO_AUTH_TOKEN` di env — wajar untuk framework ini, tapi artinya siapa pun dengan akses test dapat menulis sesi. Roadmap CI: gunakan DB `file:` terisolasi (lihat `CI_PIPELINE.md`).

## 7. Skor Keamanan

| Area | Skor | Catatan |
|---|---|---|
| Secrets handling | 8.5/10 | .gitignore kuat; fallback secret & pre-first-commit perlu perhatian |
| Auth & cookies | 7.5/10 | Dev config benar; produksi butuh hardening (secure cookies, secret produksi, origin) |
| Gmail/OAuth | 8.5/10 | Least-privilege scope, server-side tokens |
| Supabase legacy | 7/10 | Stub aman; komentar `resolveAdmin` usang perlu verifikasi |
| Logging/exposure | 6.5/10 | Redaction & error-envelope belum ada |
| **Overall** | **7.6/10** | Tidak ada Critical issue terverifikasi; 2 area butuh hardening pra-produksi |

## 8. Prioritas (rekomendasi, TIDAK dieksekusi)

1. **High**: Pastikan `BETTER_AUTH_SECRET` produksi ≠ fallback dev; aktifkan secure cookies di produksi.
2. **High**: Sebelum commit pertama, audit staging — pastikan service accounts & .env tidak ter-track.
3. **Medium**: Verifikasi/ganti `resolveAdmin` — apakah masih butuh Supabase JWT atau migrasi ke Better Auth session.
4. **Medium**: Redact error sebelum dikirim ke client (envelope `{ error: { message } }`).
5. **Low**: Hapus wildcard trustedOrigins ngrok/loca.lt di produksi.
