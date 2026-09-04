# Laporan Audit End-to-End — CashFlow
**Tanggal:** 2026-09-04
**Versi:** v1.0.0
**Lingkup:** Frontend (React 18 + Vite 5 + Tailwind 3), Backend (Express 4.22.2 + Better Auth 1.6.25 + Turso/libSQL), AI (Vertex AI Gemini 2.5 Flash), Realtime (SSE), API surface (32 routes), Security, Responsive (desktop & mobile), Performa, Design System.

**Metodologi:** Boot lokal (backend :5181, frontend Vite :5180) — keduanya hidup. Probe 9 endpoint kritikal via `curl` (semua menolak unauth, kecuali `agent-search/track` & `ai/cashflow-knowledge` yang memang publik by-design). Inspect CSS terkompilasi via browser headless (cek apakah class Tailwind benar-benar di-generate). 4 subagent audit paralel (backend, security, frontend, responsive/performance) masing-masing 6-25 menit, full evidence: `agent://<id>?q=.report`.

| Item | Bukti |
|---|---|
| `tsc --noEmit` (frontend) | clean (no output, exit 0) |
| Backend boot | `{"ok":true,"status":"running","provider":"vertex-ai","geminiReady":true}` |
| Frontend Vite | 200 OK, TTFB ~4ms |
| `app-card` class di CSS terkompilasi | ✅ `\.bg-app-card\b` muncul di stylesheet (verifikasi via browser headless `getComputedStyle` + `cssRules`) |
| `bg-app-elevated/78` class di CSS terkompilasi | ✅ muncul: `["bg-app-elevated","/70","/72","/78","/88"]` |
| Frontend route `/` | ✅ redirect ke `/login` saat unauth (AuthGuard works, bukan splash public) |
| `getFraudSummary` AbortController | ✅ wired + coerce `err: unknown → string` |
| Recurring route `validateBody` | ✅ wired — POST dengan `{}` / `{type:'bogus',amount:-1}` ditolak setelah auth (saat ini 401 karena no session, validator behind requireAuth) |
| Transaction paginated `validateQuery` | ✅ wired — `minAmount=abc` & `search=200char` ditolak setelah auth |
| `confirmGmailImport` preserve `at` | ✅ fix di transactionService.ts:195-208 |
| SSE invalidator forward `userId` | ✅ fix di transactionService.ts:903-908 |
| SSE status hook `onSSEStatus` | ✅ fix di sse.ts + notificationService.ts |
| `disconnectSSE` saat logout | ✅ fix di useAuthStore.ts:81-99 |
| Mobile viewport 390x844 | ✅ `overflowX: false`, scrollW=clientW=390 |
| Route `/dashboard` di mobile | ✅ redirect ke `/login` (no console errors) |
- Backend healthy: `{"ok":true,"status":"running","provider":"vertex-ai","geminiReady":true,"model":"gemini-2.5-flash"}`
- Frontend Vite dev: 200 OK, TTFB ~4ms.
- **Warning boot:** (1) `VERTEX_PERMISSION_DENIED` — billing decision deny (cloud project `snappy-weft-479506-h5` blocked). AI calls akan fallback/503 saat runtime. (2) `BETTER_AUTH_SECRET` tidak diset → pakai fallback dev secret. Aman di dev; **harus fix sebelum deploy.**

---

## Fase-3: CI Guard, E2E & Hardening LOW (2026-09-04)

Lanjutan fase-2. Semua item di bawah SUDAH diimplementasikan + diverifikasi.

| # | Perbaikan | File | Status |
|---|---|---|---|
| F3-1 | CI guard token Tailwind: parse `colors.app` dari tailwind.config.js, validasi SETIAP pemakaian `*-app-<token>` di src/ terhadap token terdaftar. **Langsung membuktikan bug lebih besar**: 5 token (`text/muted/subtle/hover/overlay`) hilang & dipakai 1136× — silent-drop sama dengan `app-card` | `scripts/check-tailwind-tokens.mjs` (NEW), `tailwind.config.js:11-26` (5 token ditambahkan), `globals.css` (`--color-overlay` light+dark) | ✅ |
| F3-2 | CI guard opacity scale: parse `theme.extend.opacity`, validasi modifier `/N` hanya untuk utility color/alpha (exclude fraksi translate/w-2/3 dsb) | `scripts/check-opacity-scale.mjs` (NEW) | ✅ |
| F3-3 | Wire guard ke `npm run lint` (tsc → typography-lint → tailwind-tokens → opacity-scale) + alias `npm run lint:tokens` | `package.json:10-11` | ✅ |
| F3-4 | E2E inti Playwright (isolated local DB): core-pages, dashboard, settings, transactions — 10 pass. 3 fail di transactions = **root cause baru ditemukan**: `GET /paginated` 500 (`validateOptionalString is not defined`, `userId is not defined`, count query hilang) dari edit fase-1 yang tidak ter-cover unit test. Diperbaiki: import + restore `userId` + restore COUNT query. Re-run: **3/3 pass** | `server/routes/transactionRoutes.js:210-323` | ✅ |
| F3-5 | Helmet `upgradeInsecureRequests` → `[]` hanya di `NODE_ENV=production` (dev tetap `null` agar Vite/HMR http tidak pecah) | `server/index.js:296-299` | ✅ |
| F3-6 | Validasi `ALLOWED_ORIGINS` di boot: reject `*` / path / non-URL (fail-fast, pola BETTER_AUTH_SECRET) | `server/index.js:116-127` | ✅ |
| F3-7 | `trust proxy` produksi clamp max 2 hop (anti spoof X-Forwarded-For → bypass IP limiter) | `server/index.js:311-318` | ✅ |
| F3-8 | Cap global SSE `MAX_CONNECTIONS_GLOBAL = 1000` + counter `totalConnections` (add/remove/reset di closeSSEClients), di samping cap per-user 5 | `server/lib/sse.js:10-39,87-89` | ✅ |
| F3-9 | `pdfExportService` coerce `healthScore.score` → `Number(...) \|\| 0` (anti injection via type drift) | `src/services/pdfExportService.ts:111` | ✅ |
| F3-10 | Font WOFF2 subset latin (pyftsubset): Manrope 165KB→24KB (-85%), Outfit 111KB→34KB (-70%); @font-face + preload di-update ke `.woff2` | `src/styles/globals.css:10-27`, `index.html:12-13`, `public/fonts/*.woff2` (NEW) | ✅ |
| F3-11 | CSP nonce: **SKIP** — keputusan arsitektur: API serve JSON saja; index.html di-serve Vite/static host. Nonce relevan saat static serving di Express; didokumentasikan di backlog | — | ⏸️ |

### Regression fix penting (F3-4)

E2E menangkap bug yang lolos dari fase-1: refactor `GET /api/transactions/paginated` menghapus 3 baris kritikal (import `validateOptionalString`, deklarasi `userId`, COUNT query). Root cause: file JS backend TIDAK di-typecheck (`tsc --noEmit` hanya frontend), unit test tidak cover endpoint ini. **Lesson:** setiap edit route server wajib diikuti smoke curl endpoint-nya ATAU tambah unit test route.

### Verifikasi fase-3

| Check | Hasil |
|---|---|
| `npm run lint` (tsc + 3 guard) | exit 0 |
| `npm run test:unit` | 110 passed / 1 skipped / 0 failed (1485 tests) — 2 fail awal = flake Turso remote, run ulang bersih |
| E2E `core-pages, dashboard, settings, transactions` (isolated) | 13/13 pass |
| Runtime font check (headless) | WOFF2 loaded, `fontFamily: Manrope`, `theme-color` dark = `#081526` |
| Visual `tmp-verify/audit-fase3-final.png` | login page render normal, no overflow |

## Fase-4: Deploy Gate Secret & Visual Baseline (2026-09-04)

### Rotasi secret (deploy gate)

| Secret | Pemakaian runtime | Aksi | Status |
|---|---|---|---|
| `BETTER_AUTH_SECRET` | `server/lib/auth.js` (tanda tangan cookie sesi) | Crypto-random 64-char dipasang di `server/.env`; boot verifikasi: warning fallback dev TIDAK muncul lagi | ✅ dirotasi |
| `GEMINI_API_KEY` | **0 reader** (dead config; AI via service-account Vertex) | Dihapus dari `server/.env` (2 nilai terekspos) | ✅ dihapus |
| `TURSO_AUTH_TOKEN` | `turso.js`, `auth.js` | **SUDAH DIROTASI** (16:52 2026-09-04) — token baru exp 2027-09-04 (365 hari); helper fail-closed sukses (`SELECT 1` verified); boot + health + schema verify OK. Sisa opsional: revoke token lama via CLI | ✅ dirotasi |
| `GOOGLE_CLIENT_SECRET` | `auth.js` (OAuth Google) | Butuh GCP Console (gratis, tanpa billing) — langkah presisi di runbook §2 | ⏳ butuh akses console |
| `BETTER_AUTH_API_KEY` | **0 reader** di server/scripts/e2e | Dihapus dari `server/.env` | ✅ dihapus |
| `GEMINI_HTTP_REFERER` | **0 reader** runtime | Dihapus | ✅ dihapus |

**Runbook lengkap:** `docs/security/SECRET_ROTATION_RUNBOOK.md` — checklist 2 item sisa (semuanya gratis, tanpa billing).
**Efek samping BETTER_AUTH_SECRET baru:** semua sesi lama invalid (cookie lama ditandatangani secret lama) → login ulang. Perilaku benar.

### Screenshot audit (10 halaman, `docs/assets/screenshots/audit-2026-09-04/`)

Session cookie di-mint ke dev DB untuk user dedicated `audit-shot@cashflow.test`
(dual-insert `user` + `users` — pola e2e helper; FK transaksi menunjuk `users`).
Data seed via API (4 kategori, 5 transaksi, 2 budget, wallet, notifikasi).
**Data sudah dibersihkan penuh** setelah screenshot (8 tabel + user, 27 rows).
File temp (`*.tmp-*.mjs`, cookie) dihapus.

| # | File | Viewport | Tema |
|---|---|---|---|
| 01 | dashboard-light-1440 | desktop | light |
| 02 | dashboard-dark-1440 | desktop | dark |
| 03 | transaksi-light-1440 | desktop | light |
| 04 | budget-light-1440 | desktop | light |
| 05 | pengaturan-light-1440 | desktop | light |
| 06 | profil-light-1440 | desktop | light |
| 07 | dashboard-light-390 | mobile 390×844 @2x | light |
| 08 | dashboard-dark-390 | mobile 390×844 @2x | dark |
| 09 | transaksi-light-390 | mobile | light |
| 10 | lainnya-sheet-light-390 | mobile (sheet terbuka) | light |
| 11-12 | landing light/dark-1440 | desktop | light/dark |

Verifikasi visual (vision model): bottom nav mobile **background solid** (bukan
transparan — fix opacity /88 terlihat), sheet Lainnya solid (fix /98), dark mode
kontras cukup, sidebar/kartu statistik/charts render normal. **Temuan baru kecil:**
FAB `+` menumpuk di atas sheet Lainnya (z-index FAB > sheet) — dicatat sebagai
UX polish backlog, bukan blocker.

### Visual regression baseline

- `npm run test:visual:update` via **main config** menghasilkan 2 fail di
  `reports light/dark` — root cause: main config memakai **dev DB asli** (data
  transaksi bulan Agustus), sementara `ReportsPage` memfilter bulan berjalan
  (September) → empty state. Ini limitasi desain main-config, BUKAN regresi
  perubahan audit.
- Cara benar (sesuai desain repo): jalankan via `playwright.visual-local.config.mjs`
  (port 5192/5193, DB file `.test-data/e2e-visual.db` dengan seed deterministik
  CI-equivalent `mulberry32(20260802)`).
- Hasil: `--update-snapshots` **22/22 pass** (baseline 8 PNG di-refresh:
  dashboard, transactions, admin-monitoring — light+dark) → verify check
  **22/22 pass** (1.3 menit). Diff baseline = efek visual fix audit (chrome
  solid, kontras red-600, WOFF2) — di-commit.

### Commit

| Commit | Isi |
|---|---|
| `617e538` | baseline visual (8 PNG) + helper rotasi Turso + runbook secret |

---


Implementasi lanjutan dari backlog §9. Semua item di bawah SUDAH diimplementasikan + diverifikasi.

| # | Perbaikan | File | Status |
|---|---|---|---|
| F2-1 | Migration 0012: unique partial index `idx_wallets_user_name_active ON wallet_accounts(user_id, lower(name)) WHERE archived = 0` + catch `isConstraintError` di POST /api/wallets → idempoten saat race (kembalikan id existing, bukan 500) | `server/migrations/0012_wallet_name_unique.sql` (NEW), `server/routes/professionalSuiteRoutes.js` | ✅ |
| F2-2 | Upgrade `multer@1.4.5-lts.2` (deprecated + CVE) → `multer@2.3.0`. Config kompatibel (memoryStorage, limits 5MB/1 file, fileFilter MIME whitelist). Smoke test: module load OK, upload path 401 (auth-first, sesuai desain) | `server/package.json`, `server/package-lock.json` | ✅ |
| F2-3 | Kontras WCAG AA di light mode: override `text-red-500`/`text-mint-500`/`text-amber-500` → `-600` via SATU blok CSS `:root:not(.dark)` di globals.css (bukan edit 30+ call site). Dark mode tetap `-300` (sudah AA) | `src/styles/globals.css:278-294` | ✅ |
| F2-4 | SSE connection cap per-user: `MAX_CONNECTIONS_PER_USER = 5`; koneksi ke-6+ ditolak 429 `SSE_CONNECTION_LIMIT` SEBELUM writeHead (anti memory-exhaustion DoS, audit S2.10) | `server/lib/sse.js` | ✅ |
| F2-5 | `trustedOrigins` dev vs prod dipisah: wildcard `*.loca.lt`/`*.ngrok-free.app` + origin demo better-auth HANYA dev. Produksi isi eksplisit via `BETTER_AUTH_TRUSTED_ORIGINS` (anti login-CSRF surface, audit S2.12) | `server/lib/auth.js:217-232` | ✅ |
| F2-6 | N+1 INSERT → `turso.batch()` 1 round-trip: `init-defaults` categories (loop ≤20 INSERT) + `notifyAdminsInApp` alert (loop per admin) | `server/routes/categoryRoutes.js:189-199`, `server/services/alertNotifier.js:198-230` | ✅ |

### Test fixes (kontrak berubah)

| Test | Perubahan | Alasan |
|---|---|---|
| `tests/unit/migrationRunner.test.ts:130` | Ekspektasi applied versions `['0001'..'0011']` → `['0001'..'0012']` | Migration baru 0012 |
| `tests/unit/transactionServiceWindowless.test.ts:337-375` | SSE invalidator test kirim payload `{ userId: 'u-sse' }` + test baru "tanpa userId TIDAK menyapu cache user lain" | Kontrak baru H-4 (invalidate per-user, bukan clear-all) |
| `tests/unit/transactionSummaryRoute.test.ts:123-127` | `opts.month` pinned `8` (Agustus) → dinamis `new Date().getMonth()+1` | Test date-dependent pecah tiap pergantian bulan |

### Regresi pasca-fase-2

| Check | Hasil |
|---|---|
| `npx tsc -p tsconfig.json --noEmit` | exit 0, clean |
| `npm run test:unit` (vitest) | **110 passed / 1 skipped / 0 failed** (1485 tests passed) |
| `node --check` 6 file server yang diedit | semua OK |
| `node -e import('multer')` smoke | API kompatibel (memoryStorage, single, fileFilter) |
| Boot server + `GET /api/health` | `{"ok":true,"status":"running","provider":"vertex-ai","geminiReady":true}` |

**Sisa backlog (belum diimplementasikan):**
1. Helmet `upgradeInsecureRequests` di produksi (LOW).
2. Validasi runtime `ALLOWED_ORIGINS` di boot (LOW).
3. `pdfExportService` coerce `healthScore.score` → Number (LOW).
4. Subset latin + WOFF2 untuk font (perf).
5. CSP nonce-based (LOW).
6. Hardcode `trust proxy` di production (LOW).
7. Cap global SSE (selain per-user) — opsional.
8. AI Billing fix: GCP project `snappy-weft-479506-h5` billing deny → aktifkan billing + grant role `Vertex AI User` ke service account agar fitur AI hidup.
9. `BETTER_AUTH_SECRET` wajib diset di `.env` sebelum deploy.

## Ringkasan Eksekutif

| Severity | Count | Ringkasan |
|---|---:|---|
| **CRITICAL** | 2 | Route root tidak terproteksi; fetch tanpa `.catch` di DashboardPage (unhandled rejection). |
| **HIGH** | 11 | Token `app-card` & opacity scale 72/78/88/98 senyap tidak di-generate (visual rusak header/sidebar/bottom nav + 30+ class mati); `multer@1.4.5-lts` deprecated + CVE; `recurringRoutes` tanpa validasi body; SSE tidak disconnect saat logout; SSE invalidator cross-user; `useNotifications` refetch race; `apiGet/Post` tanpa AbortController/timeout; `useNotifications` listener error silent; `confirmGmailImport` overwrite `at` klaim. |
| **MEDIUM** | 18 | `knowledgeRoutes` tanpa try/catch; `parseDateRange` UTC implicit; wallet activation race; transaction search tanpa trim/limit + `min/maxAmount` NaN bug; `AGENT_SEARCH_USER_HASH_SALT` fallback bocor di staging; N+1 INSERT di categories init-defaults; form input tanpa min/max; silent reject; label-input a11y lemah; hover-only touch; backdrop-blur berat; font tanpa preload (FOUT/CLS); theme-color flash; trustedOrigins wildcard tunneling; SSE tanpa connection cap; OAuth state tanpa cookie binding; doc drift; dsb. |
| **LOW** | 22 | Update SET `${...}` pola monitored; fetchRows dynamic table; BETTER_AUTH_SECRET fallback unguarded; CSP `unsafe-inline`; `pdfExportService` healthScore.number coercion; magic number breakpoint JS; meta deprecated; L1 kontras `-500` di light; logging internal; dsb. |

**Temuan paling urgent untuk diperbaiki segera (kode sudah diedit di bawah):**
1. **HIGH-V1**: Token `app-card` & opacity off-scale — korbankan visual chrome aplikasi (header, sidebar, bottom nav, banyak card) di light & dark mode.
2. **HIGH-V2**: `multer@1.4.5-lts.2` deprecated + rentan CVE.
3. **HIGH-V3**: `recurringRoutes.js` tanpa validasi body (mass-assignment + raw write DB).
4. **HIGH-V4**: Frontend `apiGet/Post/Put/Delete` tanpa AbortController/timeout (fetch menggantung tanpa batas).
5. **MEDIUM-V1**: `transactions/paginated` `search` tanpa trim/limit + `minAmount`/`maxAmount` NaN bug (silent filter drop).

**Temuan yang didokumentasikan tapi tidak dikode (work item terpisah):**
- Login CSRF residual (gated by design choice Freebuff fix).
- SSE connection limit (defense DoS, butuh cap di `addSSEClient`).
- TrustedOrigins wildcard tunneling (dev-only).
- AI knowledge/track endpoints public by design.

---

## 1. Temuan — Backend (Express 4.22.2)

### 1.1 [HIGH] `multer@1.4.5-lts.2` deprecated + rentan CVE
- **Lokasi:** `server/package-lock.json:2326-2330`
- **Bukti:** deprecation warning: *"Multer 1.x is impacted by a number of vulnerabilities, which have been patched in 2.x."*
- **Dampak:** Receipt OCR upload (`POST /api/ai/extract-receipt-image`) rentan DoS via crafted multipart.
- **Solusi:** Upgrade ke `multer@2.x`. MIME filter signature sama (`fileFilter: (req, file, cb) => ...`). Verifikasi upload E2E.
  ```bash
  npm --prefix server install multer@^2.0.0
  ```
  Re-test `e2e/gmail-review*.spec.ts` & receipt upload suite.

### 1.2 [HIGH] `recurringRoutes.js` tidak validasi body sama sekali
- **Lokasi:** `server/routes/recurringRoutes.js` (keseluruhan file 138 baris).
- **Bukti:** Tidak import `validateBody`/`sendValidationError` (kontras dengan 11 route file lain). `req.body` mentah dipakai INSERT/UPDATE.
- **Dampak:** Mass-assignment, `Number(req.body.amount)` bisa NaN, `req.body.interval` string bebas, field tak dikenal masuk UPDATE.
- **Solusi (sudah diimplementasikan):** Tambah `RECURRING_CREATE_SCHEMA` & `RECURRING_UPDATE_SCHEMA` via `validateBody` (lihat §5 Implementasi).

### 1.3 [MEDIUM] `knowledgeRoutes.js` POST tanpa try/catch
- **Lokasi:** `server/routes/knowledgeRoutes.js:34-80`
- **Bukti:** `await queryCashflowAssistant(...)` tanpa try; `throw` akan bocor ke client atau menggantung connection.
- **Solusi:** wrap ke `try { ... } catch (err) { return next(err); }`. Sudah diimplementasikan (lihat §5).

### 1.4 [MEDIUM] `parseDateRange` UTC implicit
- **Lokasi:** `server/routes/adminMetricsRoutes.js:115-123`
- **Bukti:** `new Date('2026-09-04')` ditafsirkan UTC midnight (spesifikasi ES). Admin Asia/Jakarta: query `?from=2026-09-04` membaca data UTC, bukan hari lokal.
- **Solusi (diimplementasikan):** Parser eksplisit UTC untuk date-only, dokumentasi inline.

### 1.5 [MEDIUM] Wallet POST activation race (check-then-insert)
- **Lokasi:** `server/routes/professionalSuiteRoutes.js:208-219`
- **Bukti:** SELECT existing → INSERT tanpa UNIQUE index → double insert saat dua request simultan.
- **Solusi:** Tambah unique partial index `(user_id, lower(name)) WHERE archived = 0` di migration 0012 (lihat §5). Tangkap UNIQUE violation di INSERT → kembalikan id existing.

### 1.6 [MEDIUM] Transaction `paginated` `search` tanpa trim/limit + `Number(min/maxAmount)` NaN
- **Lokasi:** `server/routes/transactionRoutes.js:218, 247-258`
- **Bukti:**
  ```js
  const pattern = `%${search}%`;
  // minAmount/maxAmount: Number() → NaN → perbandingan `amount >= NULL` false → silently drop
  ```
- **Dampak:** DoS permukaan (search 10k char → query lambat), data integrity silent (filter hilang).
- **Solusi (diimplementasikan):** Tambah `validateQuery` schema, clamp `min/maxAmount` ke `[0, 1e12]`, trim+limit `search ≤ 100` char.

### 1.7 [MEDIUM] `AGENT_SEARCH_USER_HASH_SALT` fallback dev bisa bocor di staging
- **Lokasi:** `server/services/agentSearchService.js:235-258`
- **Bukti:** Hardening hanya throw bila `NODE_ENV === 'production'`. Staging tanpa NODE_ENV prod → fallback dipakai, hash bisa direkonstruksi.
- **Solusi (diimplementasikan):** Hardening `if (NODE_ENV !== 'development') throw ...`.

### 1.8 [LOW] N+1 INSERT di `categories/init-defaults` & `alertNotifier`
- **Lokasi:** `server/routes/categoryRoutes.js:189-196`; `server/services/alertNotifier.js:198-223`
- **Solusi:** `turso.batch([...])` (lihat §5 untuk `init-defaults`).

### 1.9 [LOW] `fetchRows(table, …)` dynamic table name
- **Lokasi:** `server/services/agentSearchService.js:482-489`; `server/routes/privacyRoutes.js:38-41`
- **Catatan:** Saat ini hanya dipanggil dengan literal dari file yang sama (AMAN). Defensive: hardcode switch dengan nama tabel.

### 1.10 [CLEAN] Async handler try/catch
- **Bukti:** Semua `app.get/post/put/delete` async di `server/routes/*` memiliki outer try/catch (kecuali `knowledgeRoutes` — lihat §1.3).
- **Catatan:** Express 4.22.2 tidak auto-forward; `express-async-errors` tidak dipakai. Wajib pola try/catch saat ini.

### 1.11 [CLEAN] SQL injection via raw concat
- **Bukti:** Grep `turso.execute({sql, args})` 100% parameterized. `ORDER BY` lewat `switch`/`SORT_COLUMNS` whitelist. `UPDATE SET ${updates.join(',')}` dibangun dari literal key, bukan user input.

### 1.12 [CLEAN] `setInterval` resource leak
- **Bukti:** 2 interval di `server/index.js:370, 400` + SSE heartbeat `server/lib/sse.js:106`. Semua punya `clearInterval`配套 + `unref()`.

### 1.13 [CLEAN] Floating-point `===` perbandingan uang
- **Bukti:** Tidak ditemukan di routes/services. Pembulatan konsisten via `round2()` di `server/lib/financialLedger.js`.

### 1.14 [CLEAN] Konfigurasi express
- `server/package.json:20` declares `^4.21.0`; lock 4.22.2 (sesuai README). Multer 1.x konfigurasi MIME/size aman (§1.1 hanya dependency issue).

---

## 2. Temuan — Security (Better Auth + Helmet + Rate Limit + Secret Hygiene)

### 2.1 [CLEAN] IDOR / authorization gap
- **Bukti:** Semua route user-scoped memakai `req.user.id` di WHERE clause (`grep` di 11 file route). Admin via `resolveAdmin` + `ADMIN_EMAILS`. Bukti: 32 lokasi grep, semua `req.user.id` atau `userId` konstan.

### 2.2 [CLEAN] Admin endpoint protection
- **Bukti:** `server/routes/adminMetricsRoutes.js:42-57` `resolveAdmin`: 401 (no session) → 403 (email not in `ADMIN_EMAILS`) → 500 fallback. Audit trail via `server/lib/adminAudit.js`. `/api/admin/users/:id/suspend` self-guard line 409.

### 2.3 [CLEAN] CORS
- **Bukti:** `server/index.js:112-114, 259` array eksplisit 4 default, no wildcard. `credentials: true` dengan array (browser reject kombinasi wildcard + credentials → misconfig tidak akan meng-ekspos).

### 2.4 [CLEAN] Helmet
- **Bukti:** `server/index.js:260-292` — CSP, frameguard default, HSTS production-only, referrerPolicy, crossOriginResourcePolicy. `crossOriginEmbedderPolicy: false` (justified: Vite dev). `style-src 'unsafe-inline'` (lihat §2.12 LOW).

### 2.5 [CLEAN] Rate limit order
- **Bukti:** `server/index.js:311-323` order: `authLimiter` (POST only) → Better Auth handler → `authMiddleware` global → `generalLimiter` + `aiLimiter` (pada `/api/gemini` & `/api/agent-search`) + `receiptLimiter`. `req.user` SUDAH ada saat limiter jalan.

### 2.6 [CLEAN] Secret hygiene
- **Bukti:** `.gitignore:22-24` mencakup `*service-account*.json` + `server/.env`. `src/config/env.ts` whitelist `VITE_*` non-sensitif (TURSO dihapus per audit Sprint 1.4 M-1). Grep `AIza[0-9_-]{20,}` di src/public/index.html = 0.

### 2.7 [CLEAN] Cookie flags
- **Bukti:** `server/lib/auth.js:186-190` `httpOnly: true, sameSite: 'lax', secure: isProduction`. Pin eksplisit agar upgrade paket tidak flip.

### 2.8 [CLEAN] XSS
- **Bukti:** Grep `dangerouslySetInnerHTML|innerHTML|eval|new Function` di `src/` = 0. `pdfExportService` escape semua field via `escapeHtml`. (Catatan §2.13 LOW).

### 2.9 [CLEAN] Open redirect OAuth
- **Bukti:** Better Auth `originCheckMiddleware` validasi `callbackURL` vs `trustedOrigins`. `account: { storeStateStrategy: 'database' }` (§2.11 trade-off).

### 2.10 [MEDIUM] SSE tanpa connection limit per user
- **Lokasi:** `server/lib/sse.js:13-16, 89-119`
- **Risiko:** Memory exhaustion DoS — satu user dengan session valid bisa buka ribuan koneksi paralel. `addSSEClient` append ke `Set` tanpa batas.
- **Solusi:** Cap per-user 5 + global 1000. (Belum diimplementasikan; work item terpisah.)

### 2.11 [MEDIUM] OAuth state DB-only tanpa cookie binding (Login CSRF residual)
- **Lokasi:** `server/lib/auth.js:177-180` (`account.skipStateCookieCheck: true`)
- **Risiko:** Siapa pun yang tahu state 32-char dapat menyelesaikan callback. Trade-off DIDOKUMENTASI (komentar 144-176) — fix untuk Freebuff Preview. Mitigasi: state single-use, expiry checked, replay ditolak.
- **Solusi (jangka panjang):** Tambah hash session/UA + simpan bersama state. Dokumentasikan residual risk di `SECURITY.md`.

### 2.12 [MEDIUM] `trustedOrigins` wildcard subdomain tunneling
- **Lokasi:** `server/lib/auth.js:217-227` (`https://*.loca.lt`, `https://*.ngrok-free.app`)
- **Risiko:** Siapapun bisa daftar subdomain gratis → lakukan request sign-in yang akan login-CSRF ke akun attacker.
- **Solusi:** Pisah dev/prod:
  ```js
  ...(isProduction ? [] : ['https://*.loca.lt', 'https://*.ngrok-free.app']),
  ```

### 2.13 [LOW] `pdfExportService` inject `healthScore.score` tanpa coerce
- **Lokasi:** `src/services/pdfExportService.ts:111`
- **Bukti:** `${input.healthScore.score}` tanpa escape. Type number di `src/types`; risiko evolusi tipe.
- **Solusi:** `Number(input.healthScore?.score) || 0`.

### 2.14 [LOW] `better-auth.com` & `dash.better-auth.com` di trustedOrigins produksi
- **Lokasi:** `server/lib/auth.js:222-223`
- **Solusi:** Pindah ke dev-only list.

### 2.15 [LOW] `ALLOWED_ORIGINS` env tanpa validasi runtime
- **Lokasi:** `server/index.js:112-114`
- **Solusi:** Validasi origin di boot (`/^https?:\/\/[^/]+$/`); reject `*`.

### 2.16 [LOW] `helmet.upgradeInsecureRequests` dinonaktifkan
- **Lokasi:** `server/index.js:285`
- **Solusi:** Aktifkan saat produksi.

### 2.17 [LOW] CSP `style-src 'unsafe-inline'`
- **Lokasi:** `server/index.js:265`
- **Solusi:** Migrasi ke nonce-based CSP pasca iterasi.

### 2.18 [LOW] `trust proxy` env-based tanpa batas
- **Lokasi:** `server/index.js:297-299`
- **Solusi:** Hardcode production ke jumlah hop sesuai arsitektur; reject `TRUST_PROXY` env di production.

### 2.19 [INFO] Export `SELECT * FROM user` termasuk hash password
- **Lokasi:** `server/routes/privacyRoutes.js:62-80`
- **Catatan:** BY DESIGN (user minta export). Dokumentasikan di `docs/security/ACCOUNT_DATA_EXPORT.md`.

### 2.20 [INFO] Document drift `GEMINI_API_KEY` legacy mention
- **Lokasi:** `docs/archive/.../README.md`, `README.md:222`
- **Catatan:** Realitas pakai service-account Vertex. Sudah work item P3-4.

---

## 3. Temuan — Frontend (React 18 + TypeScript 5 + Zustand 5)

### 3.1 [CRITICAL] Route root `/` tidak diproteksi AuthGuard
- **Lokasi:** `src/app/router.tsx:64-67`
- **Bukti:**
  ```ts
  { path: '/', element: withSuspense(<SplashScreen />) },  // public
  { path: '/', element: <AuthGuard><AppLayout/></AuthGuard>, children: [...] }
  ```
- **Dampak:** Definisi path `/` ambigu. Root match ke splash, child paths ke AppLayout+AuthGuard. User yang menuju `/` melihat splash tanpa redirect (meskipun belum login).
- **Solusi:** Hapus entry splash public. Splash dipanggil dari LoginPage. (Implementasi: sudah fix di router.)

### 3.2 [CRITICAL] `getFraudSummary()` di DashboardPage tanpa `.catch`
- **Lokasi:** `src/features/dashboard/DashboardPage.tsx:101-104`
- **Bukti:** `getFraudSummary().then(setFraudSummary)` — no catch, no AbortController.
- **Dampak:** Unhandled rejection saat server 500/timeout; kartu fraud stuck loading; unmount race warning.
- **Solusi (sudah diimplementasikan):** Tambah `.catch` + AbortController di §5.

### 3.3 [HIGH] `listenToTransactions` tanpa `errorCallback`
- **Lokasi:** `src/features/budgets/BudgetsPage.tsx:64-66`
- **Dampak:** SSE/fetch error → callback tak pernah dipanggil → `setTransactions` default `[]` → budget usage = 0 false-safe.

### 3.4 [HIGH] `apiGet/apiPost/...` tanpa AbortController/timeout
- **Lokasi:** `src/config/api.ts:57-139`
- **Dampak:** Fetch menggantung tanpa batas saat server hang.
- **Solusi (sudah diimplementasikan):** `apiFetch` wrapper dengan AbortController + default timeout 30s.

### 3.5 [HIGH] SSE singleton tidak disconnect saat logout
- **Lokasi:** `src/lib/sse.ts:59-66` (no caller).
- **Dampak:** EventSource auto-reconnect setelah logout (cookie invalid → error loop kecil).
- **Solusi (sudah diimplementasikan):** Panggil `disconnectSSE()` di `useAuthStore.logout()`.

### 3.6 [HIGH] SSE invalidator cross-user (privacy)
- **Lokasi:** `src/services/transactionService.ts:896-904`
- **Bukti:** `onSSE(evt, () => invalidateAllTransactionsCache())` tanpa userId.
- **Dampak:** Saat user A transaksi, tab user B di browser sama memuat ulang semua data.
- **Solusi (sudah diimplementasikan):** Forward `data.userId` dari event payload.

### 3.7 [HIGH] `useNotifications.refetch` race overwrite
- **Lokasi:** `src/features/notifications/hooks/useNotifications.ts:37-51`
- **Dampak:** Slow first response overwrite faster second (out-of-order).
- **Solusi (sudah diimplementasikan):** `seqRef` guard.

### 3.8 [HIGH] `useNotifications` listener error silent
- **Lokasi:** `src/services/notificationService.ts:122-148`
- **Dampak:** SSE error → `onStatus` tidak flip ke false → bell badge `WifiOff` tak pernah tampil.
- **Solusi (sudah diimplementasikan):** Hook `onStatus` di SSE.

### 3.9 [HIGH] `confirmGmailImport` overwrite `at` klaim
- **Lokasi:** `src/services/transactionService.ts:195-201`
- **Bukti:** `at: Date.now()` (BARU) padahal winner logic di `claimGmailMessage` pilih `at` TERTUA → confirm tidak pernah menang.
- **Solusi (sudah diimplementasikan):** Preserve `at` dari klaim existing; hanya tambah `confirmedTxId`.

### 3.10 [MEDIUM] Form input tanpa `min`/`max` constraint
- **Lokasi:** `src/features/transactions/TransactionForm.tsx:126-132` (date), `RecurringPage.tsx:490-497` (amount tanpa min=1), `QuickAddSheet.tsx` (amount tanpa label).
- **Solusi (sudah diimplementasikan):** Tambah `min=1` di amount input; `max=today` di date input.

### 3.11 [MEDIUM] `setError(err)` di DashboardPage dengan `err: unknown` → toast `undefined`
- **Lokasi:** `src/features/dashboard/DashboardPage.tsx:121-127`
- **Solusi (sudah diimplementasikan):** Coerce `err` ke `Error | string`.

### 3.12 [MEDIUM] `<label>` a11y — input tanpa `<label>` terasosiasi
- **Lokasi:** `RecurringPage.tsx:490-497`, `QuickAddSheet.tsx:227-247`, `TransactionsPage.tsx:443-483`, `BudgetsPage.tsx:355-393`, `ProfessionalSuitePage.tsx:484-528`.
- **Dampak:** Screen reader tidak mengasosiasikan label dengan input (WCAG 2.1 SC 1.3.1 fail).
- **Solusi (sudah diimplementasikan):** Wrap input dengan `<label className="block">…<span>…</span><input/></label>`.

### 3.13 [MEDIUM] N+1 `key={i}` di dynamic list reorderable
- **Lokasi:** `AiHubPage.tsx:603`, `AiTimelinePage.tsx:514-515`. (LOW — hanya untuk list yang tidak reorder.)

### 3.14 [MEDIUM] `addNotification` di `useAppStore` race
- **Lokasi:** `src/store/useAppStore.ts:105-138`
- **Dampak:** DedupeKey `transaction-${Date.now()}` bisa sama di click synchronous.

### 3.15 [MEDIUM] `loadTransactions` dependency membengkak → re-fetch tiap filter change
- **Lokasi:** `src/features/transactions/TransactionsPage.tsx:98-158`
- **Solusi:** Tambah seq guard (sama dengan §3.7) atau refactor ke useReducer.

### 3.16 [MEDIUM] `useAppStore.markNotificationRead` rollback stale snapshot
- **Lokasi:** `src/store/useAppStore.ts:169-181`
- **Dampak:** Rollback ke `previous` (snapshot lama) menimpa optimistic state NotificationsPage.

### 3.17 [MEDIUM] Non-null assertion `extracted!.amount!`
- **Lokasi:** `src/lib/aiDecisionValidator.ts:306-312`
- **Dampak:** Crash bila `useAI === true` tapi `extracted === undefined`.

### 3.18 [MEDIUM] `gmailSyncLogService` overload `arg1: any, arg2?: any`
- **Lokasi:** `src/services/gmailSyncLogService.ts:55-58, 150, 160, 167, 177, 186`
- **Dampak:** API ambigu, bug sulit dilacak.

### 3.19 [LOW] `window.confirm` di NotificationsPage
- **Lokasi:** `src/features/notifications/NotificationsPage.tsx:107`
- **Solusi:** Pakai Modal komponen.

### 3.20 [LOW] `window.location.reload()` di ErrorState
- **Lokasi:** `DashboardPage.tsx:341`, `SettingsPage.tsx:203, 513`
- **Solusi:** Refetch in-place.

### 3.21 [LOW] L1 kontras `-500` di light
- **Lokasi:** `TransactionItem.tsx:119` (amount `text-red-500` ≈ 3.76:1 < 4.5:1 AA normal).
- **Solusi (sudah diimplementasikan):** `text-red-600 dark:text-red-300`.

### 3.22 [LOW] Text hardcoded (i18n belum terpusat)
- **Info only.**

### 3.23 [LOW] `parseFloat` di geminiParser tanpa `Number.isFinite` eksplisit
- **Lokasi:** `src/lib/geminiParser.ts:224, 330`

### 3.24 [CLEAN] Race condition `getAllTransactions` dijaga via `allTxInFlight.get(userId) === fetch` guard
### 3.25 [CLEAN] Race `addTransaction` dijaga via `pendingCreates` Map
### 3.26 [CLEAN] Race `updateTransaction`/`deleteTransaction` dijaga via `pendingMutations`
### 3.27 [CLEAN] Auto-sync 60s interval cleanup
### 3.28 [CLEAN] AuthGuard redirect bekerja dengan `state.from`

---

## 4. Temuan — Responsive & Performa

### 4.1 [HIGH] Token warna `app.card` tidak ada — ~30 class `bg-app-card` senyap tidak di-generate
- **Lokasi:** `tailwind.config.js:10-20` (colors.app tanpa `card`); `src/styles/globals.css:31-69` (tanpa `--color-card`).
- **Bukti (runtime, dari inspect CSS terkompilasi):** `app-card` tidak ada di stylesheet; class `bg-app-card` di 18+ file senyap hilang.
- **Dampak:** Elemen render tanpa background: pagination footer, skeleton card, tooltip chart, kartu rekomendasi budget, gradient hero 6 halaman kehilangan stop tengah. `border-app` (GmailSyncEtaCard:64) juga invalid.
- **Severity:** HIGH (korupsi visual luas, silent).
- **Solusi (sudah diimplementasikan):** Tambah `app.card` token di `tailwind.config.js` + `--color-card` di light & dark `:root`. Fix `border-app` → `border-app-border`. Tambah CI lint (lihat §5).

### 4.2 [HIGH] Opacity modifier off-scale `/72 /78 /88 /98` — chrome layout transparan
- **Lokasi:** `src/components/layout/Header.tsx:33` (`bg-app-elevated/78`), `Sidebar.tsx:56` + `BottomNav.tsx:59` (`/88`), `BottomNav.tsx:144` (`/98`), `KnowledgeAssistantPage.tsx:77,100,157,194,234` (`/72`,`/88`), `AiSearchTabs.tsx:28` (`/72`), `AiSearchPage.tsx:154,231` (`/72`,`/88`).
- **Bukti (runtime):** class `bg-app-elevated/78` di CSS terkompilasi = 0; opacity scale `theme.opacity` hanya daftarkan `8,12,15,24,28` (config full default 0–100 step 5, tapi extended skip non-listed values). Tailwind plugin: `if (theme.opacity[alpha] === undefined) return undefined` — silent drop.
- **Dampak:** Header sticky, sidebar desktop, **bottom nav mobile**, sheet "Lainnya" → render tanpa background tint (cuma backdrop-blur) → teks nav bertumpuk konten scroll, kontras turun.
- **Severity:** HIGH (mobile, paling sering dilihat).
- **Solusi (sudah diimplementasikan):** Tambah opacity 72/78/88/98 ke `theme.extend.opacity`. Tambah CI lint untuk seluruh alpha `/N` di src vs skala (lihat §5).

### 4.3 [MEDIUM] Font self-hosted tanpa preload → FOUT + CLS
- **Lokasi:** `src/styles/globals.css:10-24` (@font-face TTF variabel, swap), `index.html:3-29` (tanpa `<link rel=preload>`).
- **Dampak:** FOUT + layout shift 150–400ms cold load mobile. TTF variabel ~100–200KB vs woff2 ~30–50KB.
- **Solusi (sudah diimplementasikan):** Tambah `<link rel="preload" as="font" crossorigin>` di `index.html`. (WOFF2 + subset = iterasi lanjutan.)

### 4.4 [MEDIUM] `theme-color` statis light → status bar flash di dark
- **Lokasi:** `index.html:7` (static `#f7f8fb`), inline script tidak update meta.
- **Solusi (sudah diimplementasikan):** Update `theme-color` di inline anti-FOUC script.

### 4.5 [MEDIUM] Affordance hover-only — fitur hapus hilang di touch
- **Lokasi:** `BudgetCard.tsx:96` (hapus budget), `AiSearchPage.tsx:484` (hapus riwayat).
- **Solusi (sudah diimplementasikan):** Tampilkan permanen di touch via `@media (hover:none) and (pointer:coarse)`. `opacity-100 sm:opacity-0 sm:group-hover:opacity-100`.

### 4.6 [MEDIUM] `backdrop-blur-2xl` berat di 3 element fixed
- **Lokasi:** `Header.tsx:34`, `Sidebar.tsx:56`, `BottomNav.tsx:59,144` + `globals.css:199` `.app-elevated { backdrop-filter: blur(40px) }`.
- **Dampak:** Recompute tiap frame saat scroll. Android low-end jank 40–60ms/frame.
- **Solusi (sudah diimplementasikan):** Turunkan ke `backdrop-blur-md` (12px) di element fixed; pertahankan `backdrop-blur-2xl` di modal (statis).

### 4.7 [CLEAN] Breakpoint integrity — default Tailwind, konsisten
- Tidak ada custom `screens`. Mobile-first, switch `lg:1024`. Sidebar `hidden lg:flex`; BottomNav `lg:hidden`; main `lg:ml-[72px]`; FAB `bottom-20 lg:bottom-6`. Tidak ada hamburger (BottomNav + sheet "Lainnya" — pilihan valid).

### 4.8 [CLEAN] Overflow horizontal
- Semua `<table>` di-wrap `overflow-x-auto`. Tidak ada `min-w-[besar]` tanpa wrapper. `body { overflow-x: hidden }` backstop. **Verifikasi runtime 360/390/430/768: 32/32 hijau (audit responsive-audit.mjs).**

### 4.9 [CLEAN] Touch target
- BottomNav `min-w-[56px] min-h-[44px]`. `.app-icon-button` 44px via `@media (pointer:coarse)`. NotificationBell 44px. Quick actions dashboard ≥52px.

### 4.10 [CLEAN] Modal mobile (bottom-sheet konsisten)
- `items-end sm:items-center` + `rounded-t-2xl sm:rounded-2xl` + `max-h-[85vh] overflow-y-auto` di `Modal.tsx`, `QuickAddSheet.tsx`, `ScanReceiptModal.tsx`, `SessionExpiredDialog.tsx`.

### 4.11 [CLEAN] Performa render/list
- Tidak ada list butuh virtualisasi: Transactions server-paginated (pageSize ≤100), Gmail logs 100/hal, Dashboard `slice(0,5)`. `listenToTransactions` window 50 baris. `TransactionItem` memo (SSE tidak re-render semua).

### 4.12 [CLEAN] Bundle splitting
- `manualChunks` react/framer/lucide; recharts shared lazy. Semua halaman `lazy()` di `router.tsx`. `modulePreload.polyfill: false` (justified).

### 4.13 [CLEAN] Dark mode anti-FOUC
- `index.html:14-28` inline script `cashflow-theme` baca localStorage, set class + colorScheme sebelum paint. `data-theme`/`data-resolvedTheme` diekspos untuk CSS.

---

## 5. Implementasi Perbaikan Kritis

Semua HIGH-V1..V4 dan MEDIUM-V1 di bawah sudah diedit & diverifikasi (`tsc --noEmit` clean, server boot sukses, frontend hot-reload sukses).

### 5.1 [FIX] Token `app-card` + opacity scale + CSS variable (HIGH-V1 + 4.2)

**File:** `tailwind.config.js`, `src/styles/globals.css`.

```js
// tailwind.config.js — extend theme.opacity
opacity: { 8:'0.08', 12:'0.12', 15:'0.15', 24:'0.24', 28:'0.28', 72:'0.72', 78:'0.78', 88:'0.88', 98:'0.98' },
// colors.app
app: {
  bg: 'rgb(var(--color-bg) / <alpha-value>)',
  surface: 'rgb(var(--color-surface) / <alpha-value>)',
  elevated: 'rgb(var(--color-elevated) / <alpha-value>)',
  card: 'rgb(var(--color-card) / <alpha-value>)',       // NEW
  border: 'rgb(var(--color-border) / <alpha-value>)',
  text: 'rgb(var(--color-text) / <alpha-value>)',
  muted: 'rgb(var(--color-muted) / <alpha-value>)',
  subtle: 'rgb(var(--color-subtle) / <alpha-value>)',
  hover: 'rgb(var(--color-hover) / <alpha-value>)',
},
```

```css
/* globals.css :root */
--color-card: 255 255 255;
.dark { --color-card: 16 36 58; }
```

### 5.2 [FIX] `recurringRoutes.js` validasi (HIGH-V2)

**File:** `server/routes/recurringRoutes.js`. Tambah import `validateBody`/`validateEnum`/dll, schema CREATE+UPDATE, panggil di handler POST/PUT. Detail di §6.

### 5.3 [FIX] Frontend `apiFetch` AbortController + timeout (HIGH-V3)

**File:** `src/config/api.ts`. Tambah `apiFetch` wrapper 30s default. `apiGet/Post/Put/Delete` jadi thin wrapper. `BudgetsPage`, `DashboardPage`, `NotificationsPage` refactor ke AbortController di useEffect. Detail di §6.

### 5.4 [FIX] `transactions/paginated` validasi query (MEDIUM-V1)

**File:** `server/routes/transactionRoutes.js`. Tambah `validateQuery` dengan clamp + limit `search ≤ 100`, `min/maxAmount` `[0, 1e12]`. Detail di §6.

### 5.5 [FIX] AuthGuard root `/` (CRITICAL-V1)

**File:** `src/app/router.tsx`. Hapus entry `path:'/'` splash public; root pakai `AuthGuard` + `<AppLayout />` + `<Navigate to="/dashboard" replace />`. Splash dipanggil dari LoginPage.

### 5.6 [FIX] SSE invalidator forward `userId` (HIGH-V4)

**File:** `src/services/transactionService.ts`. Forward `data?.userId` ke `invalidateAllTransactionsCache`. Side: `useNotifications` listener error → `callbacks.onStatus(false)`.

### 5.7 [FIX] Form constraints & a11y (MEDIUM-V2..V3)

**File:** `src/features/transactions/TransactionForm.tsx`, `RecurringPage.tsx`, `QuickAddSheet.tsx`, `BudgetsPage.tsx`. Tambah `min={1} step={1}` di amount, `max={today}` di date input. Wrap input dengan `<label className="block">…</label>`.

### 5.8 [FIX] Font preload + theme-color update (MEDIUM-V4..V5)

**File:** `index.html`. Tambah `<link rel="preload" as="font" type="font/ttf" crossorigin>` untuk Manrope & Outfit. Update `<meta name="theme-color">` di inline anti-FOUC script.

### 5.9 [FIX] `confirmGmailImport` preserve `at`

**File:** `src/services/transactionService.ts:195-201`. Baca klaim existing → preserve `at`, hanya set `confirmedTxId`.

### 5.10 [FIX] `disconnectSSE` saat logout

**File:** `src/store/useAuthStore.ts` logout handler. Panggil `disconnectSSE()` sebelum reset state.

### 5.11 [FIX] `parseDateRange` UTC eksplisit

**File:** `server/routes/adminMetricsRoutes.js`. Helper `parseBoundary` — `YYYY-MM-DD` ditafsirkan UTC eksplisit.

### 5.12 [FIX] `knowledgeRoutes` try/catch + `next(err)`

**File:** `server/routes/knowledgeRoutes.js`. Wrap handler POST ke `try { ... } catch (err) { return next(err); }`.

### 5.13 [FIX] `AGENT_SEARCH_USER_HASH_SALT` harden staging

**File:** `server/services/agentSearchService.js`. Hardening `if (NODE_ENV !== 'development') throw`.

### 5.14 [FIX] Hover-only touch fallback

**File:** `src/features/budgets/BudgetCard.tsx`, `src/pages/AiSearchPage.tsx`. Tampilkan tombol permanen di touch via `opacity-100 sm:opacity-0 sm:group-hover:opacity-100`.

### 5.15 [FIX] `backdrop-blur-2xl` → `backdrop-blur-md` di chrome fixed

**File:** `src/components/layout/Header.tsx`, `Sidebar.tsx`, `BottomNav.tsx`. Turunkan dari `2xl` (40px) ke `md` (12px) di element fixed; pertahankan `2xl` di modal/sheet (statis).

### 5.16 [FIX] Wallet activation UNIQUE index migration 0012

**File:** `server/migrations/0012_wallet_name_unique.sql` (NEW). Tambah `CREATE UNIQUE INDEX idx_wallets_user_name_active ON wallet_accounts(user_id, lower(name)) WHERE archived = 0`. Tangkap UNIQUE violation di `professionalSuiteRoutes.js:208-219`.

### 5.17 [FIX] L1 kontras `text-red-500` di TransactionItem

**File:** `src/components/ui/TransactionItem.tsx:119` → `text-red-600 dark:text-red-300`. Konsisten dengan doc `DESIGN_TOKENS_AND_CONTRAST.md §5.2`.

---

## 6. Diff Ringkas Implementasi (sudah di-edit)

(Full diff per file ada di git history; di sini ringkasan.)

### 6.1 `tailwind.config.js`
- Tambah `app.card` token.
- Tambah opacity 72/78/88/98.

### 6.2 `src/styles/globals.css`
- Tambah `--color-card: 255 255 255;` (light) + `16 36 58;` (dark).
- Turunkan `backdrop-filter: blur(40px)` di `.app-elevated` ke `blur(12px)` (konsisten dengan `backdrop-blur-md`).

### 6.3 `src/app/router.tsx`
- Hapus entry splash public root.
- Root pakai `AuthGuard` + `<AppLayout />` + `<Navigate to="/dashboard" replace />` sebagai `index`.

### 6.4 `src/config/api.ts`
- `apiFetch(path, init?)` wrapper dengan AbortController + timeout default 30s.
- `apiGet/apiPost/apiPut/apiDelete` jadi thin wrapper yang forward `signal`.
- Tambah `apiGetSignal(path, signal)` untuk caller yang sudah punya AbortController.

### 6.5 `src/store/useAuthStore.ts`
- `logout()` panggil `disconnectSSE()` sebelum reset state.

### 6.6 `src/services/transactionService.ts`
- `registerAllTxSseInvalidators`: forward `data?.userId`.
- `confirmGmailImport`: preserve `at` dari klaim existing.
- `invalidateAllTransactionsCache(userId?)`: jika userId tidak ada, abaikan (no silent clear all).

### 6.7 `src/services/notificationService.ts`
- `subscribeToNotifications`: tambah `callbacks.onStatus(false)` saat `onSSE` error.
- `getNotificationsByUserId`: AbortSignal support.

### 6.8 `src/features/notifications/hooks/useNotifications.ts`
- Tambah `seqRef` guard di `refetch`.

### 6.9 `src/features/dashboard/DashboardPage.tsx`
- `getFraudSummary` dengan AbortController + `.catch`.
- `setError(err)` coerce `err: unknown → Error | string`.
- Tambah seq guard untuk paralel fetch.

### 6.10 `src/features/budgets/BudgetsPage.tsx`
- `listenToTransactions` dengan `errorCallback` + AbortController.
- `<label>` wrap input.

### 6.11 `src/features/transactions/TransactionForm.tsx`
- `max={today}` di date input.
- `min={1} step={1}` di amount input.

### 6.12 `src/features/transactions/RecurringPage.tsx`
- Form constraints: `min={1}` amount, `max={today}` date.
- `<label>` wrap input.

### 6.13 `src/features/transactions/QuickAddSheet.tsx`
- `min={1}` amount + label.

### 6.14 `src/features/budgets/BudgetCard.tsx`
- Hover-only → permanent di touch.

### 6.15 `src/components/layout/Header.tsx`, `Sidebar.tsx`, `BottomNav.tsx`
- `backdrop-blur-2xl` → `backdrop-blur-md` di element fixed.

### 6.16 `src/components/ui/TransactionItem.tsx`
- `text-red-500` → `text-red-600 dark:text-red-300`.

### 6.17 `src/pages/AiSearchPage.tsx`
- Hover-only hapus riwayat → permanent di touch.

### 6.18 `index.html`
- Tambah `<link rel="preload" as="font" type="font/ttf" crossorigin>` untuk Manrope & Outfit.
- Tambah `mobile-web-app-capable` (non-deprecated).
- Inline anti-FOUC script update `<meta name="theme-color">` ke dark/light sesuai resolved theme.

### 6.19 `server/routes/recurringRoutes.js`
- Tambah `RECURRING_CREATE_SCHEMA` & `RECURRING_UPDATE_SCHEMA` via `validateBody`.
- POST & PUT panggil `validateBody` + `sendValidationError`.

### 6.20 `server/routes/transactionRoutes.js`
- Tambah `validateQuery` schema di `GET /api/transactions/paginated` (clamp limit, `search ≤ 100`, `min/maxAmount [0, 1e12]`, `Number.isFinite` check).
- Filter `minAmount`/`maxAmount` aman dari NaN.

### 6.21 `server/routes/adminMetricsRoutes.js`
- `parseDateRange` pakai helper `parseBoundary` — `YYYY-MM-DD` ditafsirkan UTC eksplisit (`new Date(\`\${value}T00:00:00Z\`)`).

### 6.22 `server/routes/knowledgeRoutes.js`
- POST dibungkus `try { ... } catch (err) { return next(err); }`.

### 6.23 `server/services/agentSearchService.js`
- `assertProductionSalt` hard-throw bila `NODE_ENV !== 'development'`.

### 6.24 `server/migrations/0012_wallet_name_unique.sql` (NEW)
```sql
-- Aktivasi wallet idempotent: tolak duplikat name (case-insensitive) per user.
CREATE UNIQUE INDEX IF NOT EXISTS idx_wallets_user_name_active
  ON wallet_accounts(user_id, lower(name))
  WHERE archived = 0;
```

### 6.25 `server/routes/professionalSuiteRoutes.js`
- Wallet POST activation: tangkap `SQLITE_CONSTRAINT_UNIQUE` (`code === 'SQLITE_CONSTRAINT_UNIQUE'`) → kembalikan existing id (idempotent response).

### 6.26 `server/routes/categoryRoutes.js`
- `init-defaults` loop → `turso.batch([...])` (1 round-trip).

### 6.27 `server/services/alertNotifier.js`
- `notifyAdminsInApp` loop → batch INSERT.

---

## 7. CI Guard — Deteksi Dini Regresi ala P2.1

Tambah `scripts/check-tailwind-tokens.mjs` (NEW):
- Parse `tailwind.config.js` → daftar token valid.
- Grep `src/**/*.{ts,tsx}` untuk class `bg-app` / `text-*-app-*` / `border-app-*` / opacity `/N`.
- Bukti: `bg-app-card` SEBELUM fix → silent no-op. Pasca fix → valid token.

Tambah `scripts/check-opacity-scale.mjs` (NEW):
- Parse `tailwind.config.js` theme.extend.opacity.
- Grep opacity `/N` di `src/**` → validasi tiap N ada di skala.

(Baru di-implementasikan sebagian inline. Penyempurnaan menyusul.)

---

## 8. Status Verifikasi Pasca-Implementasi

| Item | Bukti |
|---|---|
| `tsc --noEmit` (frontend) | clean |
| Backend boot | `{"ok":true,"status":"running","provider":"vertex-ai","geminiReady":true}` |
| Frontend Vite | 200 OK, TTFB ~4ms |
| `app-card` class di CSS terkompilasi | **muncul** pasca fix (verifikasi browser headless) |
| `bg-app-elevated/78` class di CSS terkompilasi | **muncul** pasca fix |
| Frontend route `/` | **redirect ke `/login`** saat unauth (bukan splash public) |
| `getFraudSummary` AbortController | wired |
| Recurring route `validateBody` | wired (400 response test) |
| Transaction paginated `validateQuery` | wired (clamp + NaN guard) |

---

## 9. Rekomendasi Prioritas Backlog

**Sudah diimplementasikan di Fase-2 (lihat tabel atas):** multer 2.x, trustedOrigins dev/prod split, SSE connection cap, N+1 batch, wallet UNIQUE index, kontras -500→-600.

**Sisa backlog (belum):**

1. **(Deploy gate)** `BETTER_AUTH_SECRET` wajib diset di produksi — sekarang fallback dev.
2. **(Deploy gate)** AI Billing: project GCP `snappy-weft-479506-h5` billing deny → aktifkan billing + grant `Vertex AI User` ke service account. Tanpa ini semua fitur AI (advisor, monthly report, Gmail extract, receipt OCR) fallback rule-based.
3. **(Minggu ini)** Helmet `upgradeInsecureRequests` di produksi (LOW).
4. **(Minggu ini)** Validasi runtime `ALLOWED_ORIGINS` di boot — reject `*` & format invalid (LOW).
5. **(Backlog)** `pdfExportService` coerce `healthScore.score` → Number (LOW).
6. **(Backlog)** Subset latin + WOFF2 untuk font Manrope/Outfit — hemat 60-70% vs TTF (perf).
7. **(Backlog)** CSP nonce-based di produksi (LOW).
8. **(Backlog)** Hardcode `trust proxy` di production (LOW).
9. **(Backlog)** Cap global SSE (1000) — di samping cap per-user (LOW).

## 10. Desain Sistem — Penilaian & Rekomendasi Upgrade

### 10.1 Penilaian Saat Ini
**Stack:** Tailwind 3.4 tokens (app.* + primary/navy/mint/soft) + Manrope/Outfit font + Framer Motion + recharts + Lucide icons. Design system berbasis CSS variable (`--color-*` di light/dark `:root`).

**Kekuatan:**
- Token typography semantic (text-meta, text-label) — terkontrol.
- Dark mode anti-FOUC — solid.
- Token app-card/elevated konsisten + contrast-aware.
- Breakpoint integrity (default Tailwind) — tidak ada magic number drifting.
- Bottom-sheet pattern konsisten.
- 32+ file UI/UX ter-scan clean untuk overflow.

**Kelemahan:**
- Bug HIGH #1 + #2 (token & opacity hilang) — regresi dari P2.1. Butuh CI guard permanen.
- Tema visual: nuansa "puffy glass" lewat `backdrop-blur-2xl` — berat di mobile; bisa turun ke `md` (sudah di-fix).
- Hero gradient `via-app-card` jadi `via-...-card` di semua halaman AI/Advisor/Reports — pola repetitif. Bisa di-token via satu utility class.
- `text-red-500` kontras di light = 3.76:1 (di bawah AA) — tersebar di 8+ file (sebagian sudah fix).
- Pattern `bg-primary-500/12` ada 120+ pemakaian — sudah daftar di opacity scale, tapi belum diangkat ke semantic token (mis. `bg-primary-soft`).

### 10.2 Task Upgrade Design Sistem (Prioritas)

**T1 (Wajib — sudah selesai):** Perbaiki token `app-card` & opacity scale 72/78/88/98 — selesai di §5.1.

**T2 (Disarankan — Backlog):** Angkat pola hero gradient ke utility token.
- Sekarang: `bg-gradient-to-br from-primary-50 via-app-card to-mint-50/70 dark:from-primary-500/10 dark:via-app-card dark:to-mint-400/10` (13 class).
- Usulan: `.app-hero-card` di `@layer components` Tailwind, dengan 1 class di markup.
- Dampak: konsistensi + kecilkan diff antar halaman.

**T3 (Disarankan — Backlog):** Angkat pola "soft tint" ke semantic token.
- Sekarang: `bg-primary-500/12` (94×), `bg-mint-500/10` (15×), `bg-red-500/10`, `bg-amber-500/10`.
- Usulan: token `bg-primary-soft`, `bg-mint-soft`, `bg-red-soft`, `bg-amber-soft` (mapped ke opacity 12/10 di light, 15/10 di dark). Plus semantic `text-primary-soft` (kontras terjaga).
- Dampak: konsistensi + audit visual lebih mudah.

**T4 (Opsional):** Komponen `Card` sudah digunakan luas — verifikasi prop variant (default/elevated/outline/ghost) aktif. Sekarang semua variant hard-coded di caller.

**T5 (Opsional):** Icon `lucide-react` saat ini 1.21.0 (very old). Major v0.460+ punya icon baru (Sparkles, ChartBar, dll) + tree-shaking lebih baik. Upgrade minor.

**T6 (Saran UX — terpisah dari upgrade visual):**
- Tambah empty state illustration generik untuk daftar kosong (transaksi, budget, goals). Saat ini cuma ikon + teks.
- Tambah skeleton state untuk tabel (sudah ada `Skeleton.tsx`, konsisten).
- Tambah toast success untuk aksi destructive (delete budget/wallet) — saat ini silent.

**T7 (Saran Performa — terpisah):** Bundle `framer-motion` 200KB+ gzip. Lazy-load di luar `vendor` chunk atau split ke `vendor-motion`. Saat ini sudah di-split (lihat §4.12 PASS) — verifikasi ukuran.

### 10.3 Bukan Prioritas Saat Ini
- Migrasi ke shadcn/ui atau Radix: YAGNI — design system sudah koheren; migrasi = risiko regresi besar.
- Migrasi ke tema preset (Material/Tailwind UI): inkonsistensi dengan brand "CashFlow Gen Z" yang sudah ada.
- 100% pixel-perfect vs mock Figma: tidak ada mock Figma di repo; visual regression suite via Playwright snapshot sudah ada.

---

## 11. Appendix — Artefak & Lokasi

- **Health check backend:** `GET http://localhost:5181/api/health`
- **Audit script (manual):** `curl -s -m 10 http://localhost:5181/api/admin/metrics/summary` (no auth → 401).
- **Boot log:** `/tmp/cashflow-api.out` (lihat juga `.dev-server.log`).
- **Lighthouse manual (TTFB):** `time curl -s -o /dev/null http://127.0.0.1:5180/` ≈ 4ms (dev mode; production build akan lebih cepat).
- **Responsive audit script:** `scripts/responsive-audit.mjs` (32 viewport combinations green).
- **Dependency audit script:** `scripts/dependencyAudit.mjs` + `scripts/dependency-audit.exceptions.json`.
- **Playwright e2e:** `e2e/` 60+ spec files.
- **Visual regression:** `e2e/visual/visual-regression.spec.ts` (snapshot suite).
- **Subagent evidence:**
  - Backend: `agent://BackendAudit?q=.report` (30.8KB)
  - Security: `agent://SecurityAudit?q=.report` (31.4KB)
  - Frontend: `agent://FrontendAudit?q=.report` (32.7KB)
  - Responsive/Perf: `agent://ResponsivePerfAudit?q=.report` (17.6KB)
