# Better Auth Config Contract

> **Audit P1-2 (lanjutan)** · Status: **Diterapkan** · Tanggal: 2026-08-09
> Versi target: `better-auth` **1.6.25** · Referensi default: `node_modules/better-auth/dist/context/create-context.mjs` · `cookies/index.mjs`

Audit ini memeriksa seluruh opsi better-auth yang punya **default aktif di produksi** dan men-pin-nya eksplisit agar upgrade paket tidak menggeser perilaku keamanan/kontrak secara diam-diam. Pola: nilai default ditulis eksplisit + dikunci dengan test config (`tests/unit/authConfig.test.ts`, harness mock `betterAuth()` menangkap options).

## 1. Daftar setting eksplisit (source of truth = `server/lib/auth.js`)

| Opsi | Nilai di-pin | Default 1.6.25 | Alasan pin | Test |
|---|---|---|---|---|
| `session.expiresIn` | `604800` (7 hari) | `3600*24*7` (create-context.mjs:147) | Masa berlaku sesi maksimal — kontrak lifecycle | `authConfig.test.ts` |
| `session.updateAge` | `86400` (1 hari) | `1440*60` (:146) | Rotasi token rolling; sesi tidak aktif > 7 hari kedaluwarsa | `authConfig.test.ts` |
| `session.freshAge` | `86400` (24 jam) | `3600*24` (:148) | Durasi sesi dianggap "fresh" (`session.isFresh` turun setelahnya — dasar keputusan re-auth klien) | `authConfig.test.ts` |
| `session.cookieCache` | `{ enabled: true, maxAge: 300 }` | `maxAge: 300` (:151) | Cache validasi sesi sisi klien; revokasi (logout/suspend) terlihat ≤ 5 mnt | `authConfig.test.ts` |
| `rateLimit` | `{ enabled: false }` | `enabled: isProduction` (:171 — **AKTIF di produksi**) | Limiter bawaan (100 req/10s/IP, memory) menumpuk DI ATAS express-rate-limit dengan format 429 berbeda. **express-rate-limit = single source of truth** — keputusan + keluarga limiter + env override: [RATE_LIMITING.md](RATE_LIMITING.md) | `authConfig.test.ts` + `authRateLimitConfig.test.ts` |
| `basePath` | `'/api/auth'` | `options.basePath \|\| '/api/auth'` (:86) | Mount handler di `server/index.js` — pin agar perubahan mount tidak menggeser path auth | `authConfig.test.ts` |
| `advanced.cookiePrefix` | `'better-auth'` | `options.advanced?.cookiePrefix \|\| "better-auth"` (cookies/index.mjs:26) | Nama cookie `better-auth.session_token` **hard-coded** di `e2e/helpers/authContext.ts`, `mintSession.ts`, dan 6+ script verifikasi. **PENTING**: better-auth 1.6.25 membaca prefix HANYA dari `advanced.cookiePrefix` — opsi top-level `cookiePrefix` TIDAK dikonsumsi runtime (diverifikasi 2026-08-09; pin top-level = no-op) | `authConfig.test.ts` |
| `advanced.useSecureCookies` | `isProduction` | `isProduction` | Cookie `__Secure-` hanya di HTTPS produksi | `authConfig.test.ts` |
| `advanced.storeStateStrategy` | `'cookie'` | `'cookie'` | State OAuth disimpan di cookie (bukan DB) | `authConfig.test.ts` |
| `advanced.defaultCookieAttributes` | `{ httpOnly: true, sameSite: 'lax', secure: isProduction }` | `httpOnly` default true · `sameSite: 'lax'` | HttpOnly+SameSite=Lax — kontrak cookie `SESSION_LIFECYCLE.md`; `httpOnly` di-pin agar flip default upstream tidak membuat cookie sesi terbaca JS | `authConfig.test.ts` |
| `advanced.disableOriginCheck` | `false` | `isTest() ? true : false` (:210) | Origin check **AKTIF** di semua env — default prod sudah aktif, eksplisit mencegah auto-skip test env bocor ke konfigurasi. Catatan: E2E server berjalan TANPA `NODE_ENV=test` → `isTest()` sudah false → pin ini **no-op runtime** untuk suite E2E sekarang (diverifikasi 11/11 + lifecycle 7/7); pin hanya mengubah perilaku bila server di-boot dengan `NODE_ENV=test` | `authConfig.test.ts` |
| `advanced.disableCSRFCheck` | `false` | `!!options.advanced?.disableCSRFCheck` (:209) | CSRF check AKTIF — lapisan kedua di atas Origin check 403 middleware (`SESSION_LIFECYCLE.md` §5) | `authConfig.test.ts` |
| `advanced.crossSubDomainCookies` | `{ enabled: false }` | nonaktif (`!!…?.enabled` cookies/index.mjs:22) | Cookie **tidak** dibagikan ke parent domain — penting karena `trustedOrigins` memuat wildcard (ngrok/loca.lt) | `authConfig.test.ts` |
| `trustedOrigins` | daftar eksplisit + `BETTER_AUTH_TRUSTED_ORIGINS` | derived dari baseURL | Daftar origin frontend/API dev + wildcard tunnel | (existing) |

## 2. Klasifikasi risiko

| Risiko jika TIDAK di-pin | Setting terkait | Dampak |
|---|---|---|
| **Tinggi — upgrade geser default** | `rateLimit.enabled`, `expiresIn`, `updateAge`, `freshAge`, `cookieCache.maxAge`, `basePath`, `advanced.cookiePrefix`, `defaultCookieAttributes.httpOnly` | Perilaku keamanan/kontrak berubah tanpa kode berubah; E2E & script patah (cookie name) atau dua lapis limiter 429 (rateLimit) |
| **Sedang — nonaktif tidak sengaja** | `disableOriginCheck`, `disableCSRFCheck` | Proteksi CSRF/origin mati diam-diam (mis. seseorang menyalin konfigurasi dev yang `disableOriginCheck: true`) |
| **Rendah — dokumentasi deployment** | `rateLimit.storage` (`'memory'`), `advanced.ipAddress.trustedProxies`, `crossSubDomainCookies` | Lihat §3 — bukan pin kode, tapi catatan operasional |

## 3. Deployment notes (tidak di-lock kode — keputusan infrastruktur)

1. **`rateLimit.storage` memory** — limiter better-auth di-disable, jadi storage memory (yang bisa tumbuh tanpa batas per IP) **tidak relevan**. Jika express-rate-limit suatu saat diganti/limiter better-auth diaktifkan ulang: **wajib** `secondaryStorage` (Redis) di produksi, bukan memory.
2. **`advanced.ipAddress.trustedProxies`** — bila server berjalan di belakang reverse proxy/load balancer tanpa mengonfigurasi `trustedProxies`, deteksi IP klien salah → express-rate-limit (keyed per-user/IP) dan audit log memakai IP proxy. Set `trustedProxies` sesuai topologi deploy (`docs/deployment/` runbook).
3. **Nama cookie produksi** — dengan `useSecureCookies: true`, cookie sesi menjadi `__Secure-better-auth.session_token` (bukan `better-auth.session_token`). Semua helper E2E/script memakai nama dev; di produksi verifikasi harus menyadari prefiks `__Secure-`.

## 4. Verifikasi

- Unit: `tests/unit/authConfig.test.ts` (kontrak sesi + basePath/cookiePrefix + advanced) dan `tests/unit/authRateLimitConfig.test.ts` (rateLimit disable) — keduanya menangkap options yang dikirim ke `betterAuth()` via mock.
- E2E lifecycle: `scripts/verify-session-lifecycle.mjs` + `docs/security/SESSION_LIFECYCLE.md` (cookie HttpOnly+SameSite=Lax, logout revoke ≤ 5 mnt, CSRF Origin 403).
- E2E rate limit (keluarga limiter, server 5182): `e2e/rate-limit.spec.ts` (auth) + `e2e/rate-limit-ai-general.spec.ts` (aiLimiter + generalLimiter) — kontrak 429 `{ ok:false, code:'RATE_LIMITED' }` + header draft-7 tetap (single source of truth express-rate-limit, lihat [RATE_LIMITING.md](RATE_LIMITING.md) §7).
- **Live produksi**: `npm run verify:auth-prod` (`scripts/verify-auth-prod-limiter.mjs`) — boot server NODE_ENV=production asli dan membuktikan runtime: fail-fast secret, burst 120× get-session tanpa 429/`x-retry-after` (limiter bawaan OFF), 429 express kanonik tetap jalan di POST ke-7, origin check 403 tanpa Origin, HSTS + `__Secure-` cookie. Hasil 2026-08-09: **DISABLE EKSPLISIT TERBUKTI DI PRODUKSI** (lihat [RATE_LIMITING.md](RATE_LIMITING.md) §7b).

## 5. Kontrak terkait

- [SESSION_LIFECYCLE.md](SESSION_LIFECYCLE.md) — lifecycle sesi & cookie contract.
- [SECURITY_AUDIT.md](SECURITY_AUDIT.md) — audit keamanan keseluruhan.
- [PHASE1_SECURITY_REVIEW.md](../review/PHASE1_SECURITY_REVIEW.md) — review keamanan Phase-1.
