# Implementation Compliance Matrix — CashFlow E2E Modernization Audit

> Audit READ-ONLY · Tanggal: 1 Agustus 2026 · Status: **Complete / Partial / Missing / Unknown**
> Metode: verifikasi langsung terhadap source code + query DB read-only. Tidak ada file yang dimodifikasi (deliverable audit ditulis ke `docs/audit/`).

| # | Feature | Expected | Actual | Status | Evidence | Notes |
|---|---|---|---|---|---|---|
| 1a | `playwright.config.ts` | Exists, correct config | ✅ Exists | **Complete** | `playwright.config.ts` (root) | `testDir ./e2e`, `workers: 1`, `retries: 1`, `expect.timeout 20s`, reporter list+html, `forbidOnly` CI, screenshot/trace/video retain-on-failure, actionTimeout 15s, navigationTimeout 30s |
| 1b | `webServer` + ports | Auto-start Vite + API | ✅ 2 webServer entries | **Complete** | `playwright.config.ts` L37–49 | `npm run dev:server` → `http://localhost:5181/api/health`; `npm run dev` → `http://localhost:5180`; `reuseExistingServer: true` keduanya; timeout 60s |
| 1c | `tsconfig.e2e.json` | Typecheck terpisah e2e | ✅ Exists | **Complete** | `tsconfig.e2e.json` | `extends ./tsconfig.json`, `types: ["node"]`, include `playwright.config.ts` + `e2e/**/*.ts` |
| 1d | package.json scripts | 5 script e2e | ✅ 5/5 ada | **Complete** | `package.json` scripts | `test:e2e`, `test:e2e:gmail`, `test:e2e:transactions`, `test:e2e:dashboard`, `test:e2e:typecheck` — semua ada dan valid |
| 1e | Browsers | Chromium terinstal | ✅ | **Complete** | `node_modules/playwright`, run suite sukses | Suite berjalan headless Chromium (viewport 1440×900) |
| 2a | `e2e/helpers/mintSession.ts` | Mint sesi Better Auth ke Turso | ✅ Exists | **Complete** | `e2e/helpers/mintSession.ts` | Tulis baris `session` ke Turso (`userAgent='e2e-test'`), cookie `token.base64url(HMAC-SHA256(secret, token))` sesuai skema `server/lib/auth.js`; `cleanupTestSessions()` hapus sesi e2e |
| 2b | `e2e/helpers/authContext.ts` | Cookie login helper | ✅ Exists | **Complete** | `e2e/helpers/authContext.ts` | `suppressOnboarding` (localStorage `cashflow-onboarding-done` via addInitScript) + `injectSessionCookie` (httpOnly, sameSite Lax, domain localhost) + `setupAuthContext` |
| 2c | `e2e/helpers/pagination.ts` | Helper pagination bersama | ✅ Exists | **Complete** | `e2e/helpers/pagination.ts` | `counterRegexFor/getListCountText/listTotalFrom/listRangeFrom/waitListTotal/waitListRange` berbasis keyword `'transaksi'`/`'email'`; `expect.poll` anti-flaky |
| 2d | Helper tambahan | Dedup pageerror | ✅ Bonus | **Complete** | `e2e/helpers/errors.ts` | `collectPageErrors(page)` → `{ all(), expectClean() }` dipakai seluruh 8 test |
| 3a | gmail-sync summary | Cocok API ground truth | ✅ | **Complete** | `e2e/gmail-sync.spec.ts` test 1 | `/api/gmail/logs?includeSummary=1` → cards `Diterima/Perlu Review/Dilewati/Ditolak` = `api.summary.*`; total 519 |
| 3b | gmail-sync filter | List count = summary | ✅ | **Complete** | `e2e/gmail-sync.spec.ts` test 2 | `clickFilterAndWaitResponse` (wait response API + URL searchParams presisi) → Perlu Review `needs_review`, Diterima Otomatis `auto_accepted`, Semua `null` |
| 3c | gmail-sync pagination | Counter X-Y dari N benar | ✅ | **Complete** | `e2e/gmail-sync.spec.ts` test 3 | Halaman 1–6 (pageSize 100), `waitListRange`, indikator "Halaman X dari Y", tombol Berikutnya disabled di akhir |
| 4a | transaksi pagination | Counter benar | ✅ | **Complete** | `e2e/transactions.spec.ts` test 3 | Halaman 2–6 (pageSize 50, total 284), `waitListRange` + `pageApi.data.length` |
| 4b | transaksi filter | List count per tipe | ✅ | **Complete** | `e2e/transactions.spec.ts` test 2 | Pemasukan 86 / Pengeluaran 131 / Semua 284 via API |
| 4c | transaksi API consistency | Ground truth API | ✅ | **Complete** | `e2e/transactions.spec.ts` test 1 | `/api/transactions/paginated`; cookie eksplisit pada fixture `request` |
| 5a | dashboard balance | Total Saldo cocok API | ✅ | **Complete** | `e2e/dashboard.spec.ts` test 1 | Replikasi `calculateBalance()` dari `/api/transactions?limit=50`; banding strip non-digit (anti-locale-flaky) |
| 5b | dashboard stat cards | Tampil | ✅ | **Complete** | `e2e/dashboard.spec.ts` test 1 | Total Saldo, Pemasukan/Pengeluaran Bulan Ini, Sisa Budget |
| 5c | dashboard quick actions | Tampil | ✅ | **Complete** | `e2e/dashboard.spec.ts` test 2 | Pemasukan, Pengeluaran, Scan Gmail, Laporan |
| 5d | dashboard latest tx | Tampil | ✅ | **Complete** | `e2e/dashboard.spec.ts` test 2 | Transaksi Terbaru + Lihat Semua + min 1 item |
| 6a | Cookie auth helper | ✅ | **Complete** | `e2e/helpers/authContext.ts` | |
| 6b | Request cookie forwarding | ✅ | **Complete** | Semua spec `request.get(..., { headers: { Cookie: ... } })` | Fixture `request` context terpisah dari browser → cookie eksplisit |
| 6c | networkidle removal | ✅ | **Complete** | Spec: `waitForLoadState('domcontentloaded')` + komentar "bukan networkidle — bisa hang karena HMR" | |
| 6d | pageerror listener | ✅ | **Complete** | `e2e/helpers/errors.ts` + `pageErrors.expectClean()` di 8 test | |
| 6e | expect.poll | ✅ | **Complete** | `pagination.ts` `waitListTotal/waitListRange` | + `clickFilterAndWaitResponse` untuk filter gmail |
| 6f | Pagination helper extraction | ✅ | **Complete** | `pagination.ts` dipakai transactions + gmail | Satu sumber kebenaran |
| 7a | `npm run build` | Lulus | ✅ | **Complete** | Bukti sesi: exit 0 (17.75s; variasi 8.51–17.75s) | Tidak dieksekusi ulang di audit ini (mode read-only) |
| 7b | `npm run lint` | Lulus | ✅ | **Complete** | `npm run lint` = `tsc --noEmit` → exit 0 | |
| 7c | `npm run typecheck` | Script ada & lulus | ⚠️ **Partial** | `package.json` **tidak punya script `typecheck`**; yang ada `test:e2e:typecheck` (exit 0). `tsc --noEmit` exit 0 | Gap kecil: script `typecheck` alias tidak ada |
| 7d | `npm run test:e2e` | Lulus | ✅ | **Complete** | Bukti sesi: 8/8 passed, 3× berurutan (43.1/41.7/42.6s) — 0 flaky | |
| 7e | `tsc --noEmit` | Lulus | ✅ | **Complete** | exit 0 (src + e2e) | |
| 8a | Transactions dataset | 284 | ✅ 284 (query read-only: `transactions: 284`) | **Complete** | Pinned `expect(api.total).toBe(284)` + fetch API | **Hybrid**: total di-fetch dari API lalu di-assert ke nilai pinned — regression guard + API-driven |
| 8b | Gmail Logs dataset | 519 | ✅ 519 (query: `gmail_logs: 519`) | **Complete** | Pinned `expect(api.total).toBe(519)` | Hybrid, sama seperti 8a |
| 8c | Sync Runs dataset | 2 | ✅ 2 (query: `gmail_runs: 2`) | **Complete** | Tidak di-assert di spec manapun | Angka 2 terverifikasi di DB; belum ada assertion spec untuk runs |
| 9a | CI Pipeline (GitHub Actions) | Workflow E2E | ✅ **Complete** | `.github/workflows/e2e.yml` | quality (lint+typecheck+build) → e2e (server `npm ci`, playwright install, Turso secrets, concurrency global, artifacts report + test-results) |
| 9b | E2E coverage Budgets/Reports/Notifications/Realtime | Spec ada | ❌ **Missing** | Hanya 3 halaman (dashboard, transactions, gmail-sync) | Roadmap di `docs/e2e/E2E_COVERAGE_REPORT.md` — belum diimplementasi |
| 9c | Stability validation 3× | 0 flaky | ✅ **Complete** | Bukti sesi + `docs/e2e/STABILITY_REPORT.md` | Race condition di `GmailSyncPage.tsx` difix (`paginatedRequestIdRef`) |
| 9d | Dynamic assertions (hapus pinned) | API-driven penuh | ⚠️ **Partial** | Pinned 284/519/86/131 masih ada sebagai regression guard | Total tetap API-fetched; hanya nilai absolute yang dipin. Roadmap: lepas pinned |

---

## Ringkasan Status per Kategori

| Kategori | Complete | Partial | Missing | Unknown |
|---|---|---|---|---|
| 1. Playwright Infrastructure | 5 | 0 | 0 | 0 |
| 2. Shared Helpers | 4 | 0 | 0 | 0 |
| 3. Gmail Sync E2E | 3 | 0 | 0 | 0 |
| 4. Transactions E2E | 3 | 0 | 0 | 0 |
| 5. Dashboard E2E | 4 | 0 | 0 | 0 |
| 6. Infrastructure Improvements | 6 | 0 | 0 | 0 |
| 7. Validation Commands | 4 | 1 | 0 | 0 |
| 8. Dataset Verification | 3 | 0 | 0 | 0 |
| 9. Future Recommendations | 2 | 1 | 1 | 0 |
| **Total** | **34** | **2** | **1** | **0** |

**Implementasi inti (bagian 1–8): 32/33 Complete (97%)** — satu gap: script `typecheck` alias (7c).
**Rekomendasi lanjutan (bagian 9): 2/4 selesai** — CI ✅, Stability ✅; dynamic assertions parsial, coverage halaman lain belum.
