# Session Lifecycle — CashFlow (Better Auth + Turso)

> **Status:** Active · **Owner:** Core Engineering · **Last Updated:** 2026-08-09
> **Konteks:** Dokumen ini memadukan kontrak kode (`server/lib/auth.js`), perilaku
> framework (better-auth 1.6.25 source), dan **bukti verifikasi live** (script +
> hasil 2026-08-09) menjadi single source of truth untuk lifecycle sesi.

## 1. Ringkasan

Sesi CashFlow dikelola **Better Auth 1.6.25**, disimpan di tabel `session` Turso,
di-validasi server-side di tiap request (`authMiddleware`), dan dikirim ke browser
lewat cookie `better-auth.session_token` yang di-sign.

```
sign-in (Google OAuth)
   ↓  better-auth menulis baris session di Turso + set cookie signed
get-session  (GET /api/auth/get-session)  → 200 { session, user } | null
   ↓  authMiddleware memvalidasi cookie tiap request API
updateAge (1 hari) → rotasi token rolling (sesi aktif diperpanjang)
expiresIn (7 hari) → sesi tanpa aktivitas kedaluwarsa
sign-out (POST /api/auth/sign-out) → baris session DIHAPUS + cookie di-delete
   ↓  revokasi terlihat ≤ 5 menit (cookieCache.maxAge 300s)
```

## 2. Kontrak Cookie

### 2.1 `better-auth.session_token` (sesi)

Atribut ditetapkan Better Auth (`server/node_modules/better-auth/dist/cookies/index.mjs`
`createCookie` + `advanced.defaultCookieAttributes` di `server/lib/auth.js`):

| Atribut | Nilai | Sumber |
|---|---|---|
| Nama | `better-auth.session_token` | better-auth cookies |
| `httpOnly` | `true` | better-auth default — tidak bisa dibaca JS (anti-XSS token theft) |
| `sameSite` | `Lax` | `advanced.defaultCookieAttributes` — memblokir kirim cookie pada cross-site POST (lapisan CSRF pertama) |
| `path` | `/` | better-auth default |
| `secure` | `true` di produksi (`isProduction`), `false` di dev HTTP lokal | `advanced.useSecureCookies` + `defaultCookieAttributes.secure` |
| `maxAge` | `604800` (7 hari) | `session.expiresIn` |

Nilai cookie = **`<token>.<base64url(HMAC-SHA256(secret, token))>`** — token 24-byte
random disimpan di tabel `session`, signature divalidasi server dengan
`BETTER_AUTH_SECRET`. Cookie tanpa signature valid → ditolak (get-session `null`).

### 2.2 `better-auth.session_data` (cache validasi)

| Atribut | Nilai | Sumber |
|---|---|---|
| `maxAge` | `300` (5 menit) | `session.cookieCache.maxAge` |

Cookie kedua ini adalah **cache klien** untuk validasi sesi — dipakai client SDK
menghindari hit server tiap render. **Trade-off disengaja:** karena cache 5 menit,
efek **revokasi (logout/suspend) terlihat ≤ 5 menit** di sisi klien; di sisi server
revokasi seketika (baris `session` dihapus).

### 2.3 Prefiks `__Secure-` di produksi

Saat `useSecureCookies: true` (produksi), Better Auth menambahkan prefiks
`__Secure-` pada nama cookie → `__Secure-better-auth.session_token`. Prefiks ini
memaksa browser menolak cookie tanpa `secure` + HTTPS (defense-in-depth).

## 3. Kontrak Konfigurasi Sesi (`server/lib/auth.js`)

Nilai di-pin eksplisit (bukan default diam-diam) agar upgrade paket tidak menggeser
perilaku — komentar keputusan di kode merujuk `create-context.mjs:146-151`:

| Field | Nilai | Arti keputusan |
|---|---|---|
| `session.expiresIn` | `604800` (7 hari) | Masa berlaku sesi maksimal tanpa aktivitas |
| `session.updateAge` | `86400` (1 hari) | **Rotasi token 1 hari**: sesi yang aktif diperbarui rolling → memendekkan jendela token curian |
| `session.cookieCache` | `{ enabled: true, maxAge: 300 }` | Cache klien 5 menit — revokasi terlihat ≤ 5 mnt (kompromi kecepatan vs pembatalan cepat, dibuktikan E2E logout) |
| `advanced.useSecureCookies` | `isProduction` | Cookie hanya lewat HTTPS di produksi |
| `advanced.defaultCookieAttributes` | `{ sameSite: 'lax', secure: isProduction }` | CSRF layer-1 + secure flag |
| `advanced.storeStateStrategy` | `'cookie'` | State OAuth disimpan cookie (bukan DB) |

### Frontend flow (sinkron)

- `src/services/authService.ts` — `getCurrentUser()` = `authClient.getSession()`
  (poll 10 detik + on-focus); `signOutUser()` = `authClient.signOut()`.
- `src/store/useAuthStore.ts` — state `authUser/isAuthenticated`; listener
  `onAuthStateChanged`; `login()` / `logout()` (dengan animasi logout).
- `src/store/useSessionExpiryStore.ts` + `SessionExpiredDialog.tsx` — deteksi sesi
  kedaluwarsa terpusat (idempoten, auto-logout 1×).

## 4. CSRF — Origin Check (403)

Better Auth memvalidasi header `Origin` terhadap `trustedOrigins` pada **semua
request mutasi (bukan GET/OPTIONS/HEAD) yang membawa cookie**
(`server/node_modules/better-auth/dist/api/middlewares/origin-check.mjs` →
`validateOrigin`):

| Skenario request | Hasil |
|---|---|
| Origin header **hilang** / `"null"` + cookie ada | **403** `MISSING_OR_NULL_ORIGIN` |
| Origin **tidak ada di `trustedOrigins`** + cookie ada | **403** `INVALID_ORIGIN` |
| Origin di `trustedOrigins` | Lanjut (200) |
| GET / OPTIONS / HEAD | Tidak di-cek (safe methods) |

`trustedOrigins` (`server/lib/auth.js`): `localhost:5180/5181`,
`127.0.0.1:5180/5181`, `better-auth.com`, `dash.better-auth.com`,
`*.loca.lt`, `*.ngrok-free.app` + env `BETTER_AUTH_TRUSTED_ORIGINS`
(comma-separated untuk domain produksi).

Lapisan CSRF berlapis:
1. **`sameSite=Lax`** — browser tidak mengirim cookie pada cross-site POST.
2. **Origin check 403** — serangan yang tetap lolos (mis. form submit lama, atau
   Origin `null` dari sandbox) ditolak server.
3. **`formCsrfMiddleware`** — first-login: navigasi cross-site via
   `Sec-Fetch-Site: cross-site` diblokir (Fetch Metadata).

Catatan audit: wildcard `*.ngrok-free.app` / `*.loca.lt` adalah risiko CSRF/abuse
kecil di produksi — rekomendasi hapus sebelum publik (lihat SECURITY_AUDIT §8).

## 5. Lifecycle Lengkap (event-by-event)

| Tahap | Apa yang terjadi | Bukti |
|---|---|---|
| **Sign-in** | Google OAuth → Better Auth tulis `session` (token random, `expiresAt` +7d) → set cookie signed | ADR-001 |
| **Validasi tiap request** | `authMiddleware` → `getSession({ headers })` → cookie di-sign & row ada → `req.user` di-set; row hilang/signature salah → `req.user = null` (route terproteksi 401) | `server/middleware/authMiddleware.js` |
| **Rotasi token** | Sesi aktif > `updateAge` (1 hari) → token baru (rolling) — memperpendek jendela token curian | kontrak §3 |
| **Kedaluwarsa** | Sesi tanpa aktivitas > 7 hari → `expiresAt` lewat → get-session `null` → `SessionExpiredDialog` auto-logout | `useSessionExpiryStore.ts` |
| **Sign-out** | `POST /api/auth/sign-out` → `deleteSession(token)` dari Turso → `deleteSessionCookie` (maxAge 0) → `{ success: true }` | `sign-out.mjs` + §6 |
| **Revokasi** | Baris `session` hilang → request berikutnya dengan cookie lama → get-session `null` (server-side seketika); efek terlihat klien ≤ 5 mnt (cache) | §6 langkah 6-7 |
| **Logout paksa / suspend (admin)** | `POST /api/admin/users/:id/suspend` — hapus SEMUA sesi user (`DELETE FROM session WHERE userId = ?`, bukan per token) + tulis `admin_audit_log` dalam satu batch atomik | §5.2 |
| **Cleanup kedaluwarsa (harian, 2026-08-09)** | Scheduler server hapus `session WHERE expiresAt < now` tiap 24 jam — better-auth TIDAK pernah menghapus baris kedaluwarsa sendiri (hanya sign-out/rotasi) → tanpa ini tabel `session` tumbuh tanpa batas | §5.1 |

### 5.1 Cleanup otomatis sesi kedaluwarsa

Pola **identik alert scheduler** (`server/index.js` — `startSessionCleanupScheduler`):

| Aspek | Nilai |
|---|---|
| Fungsi | `cleanupExpiredSessions()` di `server/lib/sessionCleanup.js` — SATU sumber kebenaran query hapus |
| Query | `DELETE FROM session WHERE (typeof(expiresAt)='text' AND julianday(expiresAt) < julianday('now')) OR (typeof(expiresAt)='integer' AND expiresAt < (unixepoch()*1000))` |
| Format `expiresAt` | **text ISO 8601** (`'2026-08-15T04:09:42.589Z'`) — bukti DB live 2026-08-09 (schema bilang INTEGER, adapter libSQL menulis text). Query menangani KEDUA bentuk (defensif) via `typeof()` guard; hanya baris yang bisa di-parse yang dihapus |
| Interval | `SESSION_CLEANUP_INTERVAL_MS` default **86_400_000 (24 jam)** |
| Run pertama | **langsung saat boot** (server baru/redeploy tidak menunggu 24 jam) — nilai beda dari alert scheduler |
| Env matikan | `SESSION_CLEANUP_ENABLED=false` |
| Nonaktif otomatis | PORT 5182 (rate-limit spec) & 5183 (webhook spec) — tanpa side-effect E2E |
| Timer | `setInterval(...).unref()` — tidak menahan shutdown; `clearInterval` di graceful shutdown |
| deleted count | `rowsAffected` (dibuktikan tersedia); bila tidak ada → `-1` (unknown, bukan 0 palsu) |
| CLI manual | `npm run cleanup:sessions` (`scripts/cleanupExpiredSessions.mjs`) — audit/dry-run/maintenance tanpa menunggu interval |
| Error handling | Error DB **diteruskan** ke caller (scheduler menangkap → `logger.warn`; script → exit 1) — tidak pernah ditelan |
| Unit test | `tests/unit/sessionCleanup.test.ts` (5) — query dua bentuk, return `{deleted}`, client null → 0, error rethrow |

Bukti live 2026-08-09: dry-run menemukan 3/8 sesi kedaluwarsa (semua browser Chrome user qoidrifat23, `expiresAt` 2026-08-08) → `npm run cleanup:sessions` menghapus 3 → tersisa 5 valid, 0 expired.

> **Roadmap:** tabel `verification` punya pola yang sama (`expiresAt` + better-auth tidak membersihkan sendiri) — kandidat cleanup serupa bila tumbuh.

### 5.2 Logout paksa / suspend user (endpoint admin)

**`POST /api/admin/users/:id/suspend`** (admin-only, `ADMIN_EMAILS`) — revoke **SEMUA** sesi
target user sekaligus (tidak seperti sign-out per sesi) + **audit trail** permanen.
Efektivitas identik dengan sign-out: baris `session` hilang → request berikutnya
membawa cookie lama → get-session `null` (server-side seketika; klien ≤ 5 mnt via
`cookieCache`).

**Alur (server/routes/adminMetricsRoutes.js):**

```
resolveAdmin (401/403)
   → validasi :id (kosong / >191 char → 400 fail-closed)
   → guard self-suspend (target == admin → 400 — gunakan sign-out biasa)
   → SELECT id, email FROM user WHERE id = ?   (404 bila user tidak ada)
   → BATCH atomik (satu transaksi):
       [1] INSERT admin_audit_log (subquery COUNT(*) sesi pra-revoke di metadata)
       [2] DELETE FROM session WHERE userId = ?
   → 200 { ok, action:'user_suspend', user:{id,email}, deletedSessions }
```

**Keputusan desain:**

| Aspek | Keputusan | Alasan |
|---|---|---|
| Atomisitas | **Satu batch** (INSERT audit dulu, DELETE sesi kedua) | Audit tidak pernah hilang walau revoke berhasil; keduanya gagal bersama bila DB error — tidak ada "suspend tanpa jejak" |
| Count di audit | Subquery `COUNT(*) FROM session WHERE userId = ?2` dalam metadata `json_object` | Record audit memuat jumlah sesi yang di-revoke **sebelum** hapus (bukan null/palsu) |
| Audit table | `admin_audit_log` (baru, `turso-schema.sql`, idempoten) | Log keamanan **ber-PII** (actor/target email eksplisit, bisa dibaca tanpa join) — dipisah dari `system_metrics` (observability non-PII) |
| Guard self-suspend | 400 | Mencegah admin mengunci diri sendiri (revoke sesi sendiri = lockout admin tak sengaja); gunakan sign-out biasa |
| Anti-injection | Prepared statements (`?2`/`?6` numbered), id divalidasi panjang | Argumen tidak pernah di-interpolasi |
| `deletedSessions: 0` | Tetap 200 + audit tercatat | Aksi admin dicatat walau target tidak punya sesi aktif |

**Schema audit** (`admin_audit_log` — `CREATE TABLE IF NOT EXISTS`, diterapkan otomatis
saat boot via `initTursoSchema`, terverifikasi live 2026-08-09):

| Kolom | Isi |
|---|---|
| `id` | UUID (`crypto.randomUUID()`) |
| `action` | `'user_suspend'` (disiapkan untuk aksi admin lain) |
| `target_user_id` / `target_email` | User yang di-suspend |
| `actor_user_id` / `actor_email` | Admin yang mengeksekusi (`resolveAdmin`) |
| `metadata` | JSON `{ deletedSessions, sourceIp }` — jumlah sesi pra-revoke + IP admin |
| `created_at` | `datetime('now')` |

Index: `idx_admin_audit_created` (chronologis) · `idx_admin_audit_action_created`
(per aksi) · `idx_admin_audit_target` (per user).


## 6. Prosedur Verifikasi (Script + Bukti)

### 6.1 Script

`scripts/verify-session-lifecycle.mjs` — 7 langkah guard regresi, exit 0 = semua PASS:

```bash
node scripts/verify-session-lifecycle.mjs [--port 5181]
```

Prasyarat: API server aktif (`npm run dev` / `npm run dev:server` di `server/`),
user seed ada (minimal 1 baris tabel `user`). Script **mint sesi sendiri** via Turso
(pola e2e `mintSession.ts`), lalu menguji, dan **baris sesi-nya terhapus di langkah
6** — tidak meninggalkan residu.

### 6.2 Bukti — 2026-08-09 (server dev localhost:5181)

```
MINTED user=pJV0rIAI6uTYP8JJa8VAGnrr3DcQ3CCB email=qoidrifat23@gmail.com

STEP                          STATUS  DETAIL
----                          ------  ------
PASS  get-session(valid)           200  user=qoidrifat23@gmail.com
PASS  get-session(no-cookie)       200  null
PASS  sign-out(no-origin)          403  CSRF: missing/null Origin → 403
PASS  sign-out(evil-origin)        403  CSRF: untrusted Origin → 403
PASS  sign-out(trusted)            200  {"success":true}
PASS  session-row-deleted          DELETED
PASS  get-session(after-signout)   200  revoked

ALL 7 STEPS PASS — lifecycle sesi sesuai kontrak SESSION_LIFECYCLE.md
```

Interpretasi bukti:

1. **get-session(valid) 200 + user** — cookie signed diterima; row `session` valid
   (signature HMAC + token cocok).
2. **get-session(no-cookie) 200 null** — tanpa cookie → null (bukan error).
3. **sign-out(no-origin) 403** — request mutasi bawa cookie tanpa Origin →
   **CSRF diblokir** (`MISSING_OR_NULL_ORIGIN`). Ini membuktikan origin check AKTIF.
4. **sign-out(evil-origin) 403** — Origin `http://evil.example.com` tidak di
   `trustedOrigins` → **403 `INVALID_ORIGIN`**.
5. **sign-out(trusted) 200 { success: true }** — Origin `http://localhost:5180`
   (trusted) → revoke diizinkan.
6. **session-row-deleted DELETED** — baris `session` di Turso benar-benar terhapus
   (bukan sekadar hapus cookie).
7. **get-session(after-signout) 200 null** — cookie lama sekarang tidak valid →
   **revokasi server-side seketika**.

> **Verifikasi UI (E2E):** flow session-expired dibuktikan
> `tests/unit/sessionExpiryHandler.test.ts` (401 di route terproteksi →
> `triggerSessionExpired`; `/api/auth/get-session` & `/api/auth/sign-out`
> dikecualikan — tidak pernah memicu dialog palsu) dan `useSessionExpiryStore`
> (idempoten, auto-logout 1×). Cookie `httpOnly + SameSite=Lax` juga direplikasi
> persis di `e2e/helpers/authContext.ts` (satu sumber kebenaran inject cookie test).

## 7. Regresi Guard

| Guard | Cakupan |
|---|---|
| `scripts/verify-session-lifecycle.mjs` | 7 langkah kontrak (validasi, CSRF 403, revoke, hapus row) |
| `tests/unit/adminSuspend.test.ts` (10) | POST suspend: gate 401/403, id 400, self-suspend 400, user 404 (batch tak dipanggil), 200 batch [INSERT audit count-subquery → DELETE], SQL konstanta di-assert, error Turso 500 |
| `tests/unit/sessionCleanup.test.ts` (5) | Query cleanup kedaluwarsa (text ISO + integer ms, `typeof` guard, return `{deleted}`, client null, error rethrow) |
| `tests/unit/authConfig.test.ts` (14) | Secret strength (7) + kontrak sesi eksplisit (4: expiresIn/updateAge/cookieCache) + rateLimit better-auth disabled (3) |
| `tests/unit/authRateLimitConfig.test.ts` (3) | rateLimit `{ enabled: false }` (express-rate-limit = single source of truth) |
| `tests/unit/tursoBootRetry.test.ts` (3) | Boot retry Turso (auth boot tidak gagal saat blip DB) |
| `e2e/rate-limit.spec.ts` | 429 contract `RATE_LIMITED` JSON + Retry-After + draft-7 header (express-rate-limit) |
| `e2e/contract/contract-check.spec.ts` | Contract shape API umum (termasuk auth headers) |

## 8. Referensi

- Kontrak konfigurasi: `server/lib/auth.js` (blok `session`, `advanced`, `trustedOrigins`)
- Middleware: `server/middleware/authMiddleware.js` (getSession + retry blip DB)
- Frontend: `src/services/authService.ts` · `src/store/useAuthStore.ts` ·
  `src/store/useSessionExpiryStore.ts` · `src/components/SessionExpiredDialog.tsx`
- Verifikasi: `scripts/verify-session-lifecycle.mjs`
- Keputusan arsitektur: [ADR-001](../adr/ADR-001-better-auth.md) ·
  audit: [SECURITY_AUDIT.md](SECURITY_AUDIT.md) ·
  review: [PHASE1_SECURITY_REVIEW](../review/PHASE1_SECURITY_REVIEW.md)
