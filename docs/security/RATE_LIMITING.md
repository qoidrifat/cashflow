# Rate Limiting — express-rate-limit = Single Source of Truth

> **Keputusan arsitektur (audit P1-2)** · Status: **Diterapkan** · Tanggal: 2026-08-09
> Versi: `express-rate-limit` **7.5.1** (server/package.json) · `better-auth` **1.6.25** · Sumber kode: `server/index.js:184-241` (4 limiter) + `server/lib/auth.js` (rateLimit better-auth)

## 1. Keputusan

**`express-rate-limit` adalah SATU-SATUNYA source of truth untuk rate limiting di CashFlow.**

- Semua pembatasan rate (auth, AI, receipt, umum) dilakukan lewat 4 limiter `express-rate-limit` di `server/index.js`.
- Limiter **bawaan better-auth di-DISABLE eksplisit** — `rateLimit: { enabled: false }` di `server/lib/auth.js`, di-pin dan di-lock oleh `tests/unit/authConfig.test.ts` + `tests/unit/authRateLimitConfig.test.ts` (lihat [BETTER_AUTH_CONFIG_CONTRACT.md](BETTER_AUTH_CONFIG_CONTRACT.md)).
- Frontend (`src/config/api.ts` error handling) dan seluruh E2E contract mengandalkan **format 429 express-rate-limit** — ini kontrak publik yang tidak boleh berubah.

## 2. Kenapa dua lapis limiter berbahaya

Better Auth 1.6.25 punya **rate limiter bawaan dengan default AKTIF di produksi**:
`enabled: isProduction` (create-context.mjs:171, **100 req / 10s / IP**, storage **memory**, window 10 detik). Jika dibiarkan, limiter ini **menumpuk DI ATAS express-rate-limit** — dan setiap lapis membawa masalahnya sendiri:

| Masalah | Lapis better-auth (bawaan) | Dampak |
|---|---|---|
| **Format 429 berbeda** | Handler bawaan better-auth (bukan `{ ok:false, code:'RATE_LIMITED', message }`) | Klien/E2E tidak mengenali 429 → UX rusak, contract test gagal, error handling frontend salah cabang |
| **Dua budget terpisah** | 100 req/10s/**per-IP** (window 10 detik) vs express-rate-limit 120/15m (auth POST) | Perilaku tidak terduga: IP diblokir di 10 detik sementara per-user masih punya budget — sulit di-debug |
| **Storage memory tanpa batas** | Counter per-IP di memori proses | Pertumbuhan memori di produksi beban tinggi (tanpa eviction tegas) |
| **Keying berbeda** | Per-IP selalu; express-rate-limit per-user setelah auth (`u:<id>`) | Dua interpretasi "siapa yang bersalah" — audit & alert membingungkan |

**Kesimpulan:** satu limiter = satu kontrak 429 = satu keying = satu tempat debugging. Keputusan ini juga mencegah "double punishment" (user dihukum dua limiter sekaligus dengan dua budget).

## 3. Keluarga limiter (`server/index.js`)

| Limiter | Mount | Default | Skip | Key |
|---|---|---|---|---|
| `generalLimiter` | semua route setelah auth (index.js:310) | `RATE_LIMIT_GENERAL_MAX` **5000**/15m | `/api/health` · `/api/ready` | per-user / IP |
| `authLimiter` | `/api/auth` (index.js:301, SEBELUM auth) | `RATE_LIMIT_AUTH_MAX` **120**/15m | **GET** (session-read dipanggil SPA tiap page-load) + `/api/health` | **IP** (belum ada user di route auth) |
| `aiLimiter` | `/api/gemini` + `/api/agent-search` (index.js:311-312) | `RATE_LIMIT_AI_MAX` **120**/15m | — | per-user / IP |
| `receiptLimiter` | `/api/ai/extract-receipt-image` (index.js:313) | `RATE_LIMIT_RECEIPT_MAX` **30**/15m | — | per-user / IP |

Semua: `windowMs` **15 menit** (tidak di-env-kan), `standardHeaders: 'draft-7'`, `legacyHeaders: false`, message `{ ok:false, code:'RATE_LIMITED', message }`.

## 4. Env override (`server/index.js:184-241`)

| Env | Default | Arti |
|---|---|---|
| `RATE_LIMIT_ENABLED` | aktif (`!== 'false'`) | `false` → semua limiter jadi no-op middleware (dev/CI only — **jangan di produksi**) |
| `RATE_LIMIT_GENERAL_MAX` | `5000` | limit umum / 15 mnt |
| `RATE_LIMIT_AUTH_MAX` | `120` | limit POST `/api/auth/*` / 15 mnt |
| `RATE_LIMIT_AI_MAX` | `120` | limit `/api/gemini` + `/api/agent-search` / 15 mnt |
| `RATE_LIMIT_RECEIPT_MAX` | `30` | limit `/api/ai/extract-receipt-image` / 15 mnt |

Catatan: variabel `RATE_LIMIT_*` **belum** ada di `server/.env.example` (drift D4, HIGH — item terbuka `IMPLEMENTATION_PRIORITY.md` P2-5). Dokumen ini menutup drift **U2** ("RATE_LIMIT_* code-comments only", lihat [DOCUMENTATION_DRIFT_REPORT.md](../audit/DOCUMENTATION_DRIFT_REPORT.md)) sebagai referensi runtime; penambahan ke template `.env.example` tetap item terbuka P2-5.

## 5. Urutan middleware & keying

```
requestId → cors → helmet → express.json → /api/auth (authLimiter + toNodeHandler)
  → authMiddleware (req.user) → httpMetrics → generalLimiter → aiLimiter / receiptLimiter → routes
```

- **Setelah auth**, `rateKeyGen` (index.js:194) memakai `req.user.id` → key `u:<userId>`; **sebelum auth / tanpa user** → `ip:<ip>`.
- **Konsekuensi:** request tidak ter-autentikasi dihitung per-IP; request ter-autentikasi per-user (anti-sharing abuse).
- **Urutan general → ai penting:** request `/api/gemini` melewati generalLimiter DULU (310) baru aiLimiter (311). Karena itu server uji 5182 memakai **`RATE_LIMIT_AI_MAX=8` < `RATE_LIMIT_GENERAL_MAX=20`** agar test dapat membedakan limiter mana yang 429 lewat asersi message (lihat §7).
- 429 dihitung sebagai metric (`httpMetricsMiddleware` dipasang sebelum limiter, ADR-010).

## 6. Format respons 429 (kontrak publik)

```json
{ "ok": false, "code": "RATE_LIMITED", "message": "Terlalu banyak ... Coba lagi nanti." }
```

Header: `Retry-After` + `ratelimit` (`limit=.., remaining=.., reset=..`) + `ratelimit-policy` — format **draft-7 gabungan** express-rate-limit (BUKAN `ratelimit-limit` draft-6).

## 7. Regression guards

| Guard | Cakupan | Keterangan |
|---|---|---|
| `tests/unit/authConfig.test.ts` + `authRateLimitConfig.test.ts` | rateLimit better-auth `{ enabled: false }` di semua env | Mencegah limiter bawaan muncul kembali via default `isProduction` |
| `scripts/verify-auth-prod-limiter.mjs` (`npm run verify:auth-prod`) | **Live produksi** (NODE_ENV=production, secret kuat): fail-fast secret · burst 120× get-session tanpa 429/header bawaan · 429 express kanonik tetap jalan · origin check 403 · HSTS + Secure cookie | Bukti runtime (bukan hanya config objek) bahwa disable bekerja di env produksi |
| `e2e/rate-limit.spec.ts` (server 5182, `AUTH_MAX=25`) | authLimiter POST `/api/auth/*` | 429 ≤ 26 request · body `RATE_LIMITED` · Retry-After + draft-7 · **GET session tetap 200** (skip GET) |
| `e2e/rate-limit-ai-general.spec.ts` (server 5182, `AI_MAX=8`, `GENERAL_MAX=20`, `RECEIPT_MAX=8`) | aiLimiter POST `/api/gemini/*` + generalLimiter GET `/api/transactions` + **receiptLimiter POST `/api/ai/extract-receipt-image`** | Asersi **message** membedakan limiter mana yang 429 · user fresh per-attempt · `/api/health` tetap 200 (skip general) |

Jalankan: `npm run test:e2e:ratelimit` (keluarga limiter: auth + AI + general + receipt). Kedua spec juga ikut auto-discovery suite penuh (`testDir: ./e2e`).

**Gap receiptLimiter — TERTUTUP (2026-08-09):** guard E2E ditambahkan ke `e2e/rate-limit-ai-general.spec.ts` — body `{}` tanpa image → 400 `MISSING_IMAGE` via validasi route (tetap dihitung limiter, tanpa multipart/Gemini), 429 `scan struk` ≤ `RECEIPT_MAX+1` dengan `RATE_LIMIT_RECEIPT_MAX=8` < `GENERAL_MAX=20` di webServer 5182 (kontras message).

**Stale server 5182 (dialami 2026-08-09):** run playwright yang terputus meninggalkan `node server/index.js` di port 5182 dengan **env lama** (`RATE_LIMIT_AI_MAX` belum di-set → default 120). `reuseExistingServer: true` memakai server stale itu → test gagal `first429At=-1`. **Fix lokal: kill proses node di port 5182 lalu re-run.** CI aman (VM fresh per run).

## 7b. Verifikasi live di produksi (`verify:auth-prod`)

Unit test hanya mengecek objek config — verifikasi ini membuktikan **perilaku runtime** dengan men-start server produksi ASLI (`NODE_ENV=production`, secret kuat 48 char, port 5199 sementara):

```bash
npm run verify:auth-prod   # node scripts/verify-auth-prod-limiter.mjs
```

14 assertions, semuanya harus ✓ (hasil 2026-08-09: **DISABLE EKSPLISIT TERBUKTI DI PRODUKSI ✅**):

| Langkah | Bukti |
|---|---|
| A | **Fail-fast secret**: boot prod dgn secret lemah (12 char) → exit 1 + pesan `[Auth] PRODUCTION: BETTER_AUTH_SECRET wajib…` |
| B | Boot prod dgn secret kuat → `/api/health` 200 |
| C | Mint sesi → `GET /api/auth/get-session` 200 + body berisi user (auth prod memvalidasi cookie) |
| D | **Burst 120× GET get-session** (<10s, IP sama — di atas limit bawaan 100/10s): SEMUA 200 · **tidak ada** header `x-retry-after` · **tidak ada** body `"Too many requests…"` → limiter bawaan benar-benar OFF di produksi |
| E | **Express tetap 429**: POST auth ke-7 → 429 `{ok:false,code:'RATE_LIMITED'}` + `Retry-After` + `ratelimit` (draft-7) · `x-retry-after` (ciri bawaan) tidak ada → express = satu-satunya lapis |
| E+ | **Origin/CSRF check AKTIF**: POST auth tanpa `Origin` → 403 (disableOriginCheck:false berlaku di produksi) |
| F | **Produksi sungguhan**: HSTS (helmet prod) + Set-Cookie `__Secure-better-auth.session_token` dengan `Secure; HttpOnly; SameSite=Lax` (useSecureCookies) |

Catatan teknis untuk re-run: (1) mint sesi harus memakai secret yang SAMA dengan server uji (cookie HMAC-signed; mismatch → get-session 200 body `{}`); (2) setelah langkah E exhaust budget (429 di POST ke-7), semua POST auth dari IP itu ikut 429 selama window 15 mnt — langkah F tidak boleh POST auth lagi; (3) POST auth butuh header `Origin` dari trustedOrigins.

## 8. Catatan operasional

1. **Reverse proxy:** bila server di belakang proxy/load balancer, set `advanced.ipAddress.trustedProxies` (better-auth) + `trustedProxies` Express agar deteksi IP benar — salah IP = salah keying rate limit & audit log (lihat [BETTER_AUTH_CONFIG_CONTRACT.md](BETTER_AUTH_CONFIG_CONTRACT.md) §3).
2. **Storage memory:** limiter better-auth di-disable jadi counter memory-nya tidak relevan. Bila suatu saat express-rate-limit diganti / limiter bawaan diaktifkan ulang: **wajib** `secondaryStorage` (Redis) di produksi, bukan memory.
3. **`RATE_LIMIT_ENABLED=false`** hanya untuk dev/CI. Di produksi semua limiter harus aktif.

## 9. Dokumen terkait

- [BETTER_AUTH_CONFIG_CONTRACT.md](BETTER_AUTH_CONFIG_CONTRACT.md) — pin opsi better-auth (termasuk `rateLimit: { enabled: false }`).
- [SESSION_LIFECYCLE.md](SESSION_LIFECYCLE.md) — kontrak cookie sesi & CSRF Origin 403.
- [PLAYWRIGHT_GUIDE.md](../ci/PLAYWRIGHT_GUIDE.md) — topologi webServer (5182) & pola anti-flaky.
- [PRODUCTION_READINESS.md](../deployment/PRODUCTION_READINESS.md) — ringkasan produksi (4 limiter, per-user key, env-tunable).
- [ADR-010-observability.md](../adr/ADR-010-observability.md) — urutan middleware & counting 429.
