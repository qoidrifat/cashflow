# E2E Architecture Review — CashFlow

> Phase 1 · Principal QA Architecture Review
> Date: 2026-08-01 · Reviewer: QA Architect

## 1. Executive Summary

CashFlow memiliki fondasi E2E yang **kuat dan terverifikasi**: 8 test di 3 halaman kritis
(Dashboard, Transaksi, Gmail Sync) dengan **0 flaky** setelah perbaikan race-condition pada
aplikasi. Arsitektur memakai Playwright 1.61 + Better Auth session-minting langsung ke Turso
— menghindari ketergantungan pada Google OAuth manual di test.

**Production Readiness: 8.2/10** (naik dari 7.5 setelah Phase 8 auto-fixes).

## 2. Arsitektur Saat Ini

```
┌─────────────────────────────────────────────────────────────────┐
│ Playwright Test Runner (workers:1, retries:1, timeout 60s)      │
├─────────────────────────────────────────────────────────────────┤
│ e2e/specs:                                                       │
│   dashboard.spec.ts   (2 test)  /dashboard                      │
│   transactions.spec.ts (3 test) /transactions                   │
│   gmail-sync.spec.ts  (3 test)  /gmail-sync                     │
├─────────────────────────────────────────────────────────────────┤
│ e2e/helpers:                                                     │
│   mintSession.ts   → mint Better Auth session cookie ke Turso    │
│   authContext.ts   → onboarding suppress + cookie inject         │
│   pagination.ts    → keyword-based list counter helpers          │
│   errors.ts        → collectPageErrors (dedup boilerplate)       │
├─────────────────────────────────────────────────────────────────┤
│ Config: playwright.config.ts · tsconfig.e2e.json                │
│ webServer: [Vite :5180, Express API :5181] reuseExistingServer   │
└─────────────────────────────────────────────────────────────────┘
```

**Alur autentikasi (anti-OAuth):**
1. `mintSessionCookie()` menulis baris sesi valid ke tabel `session` Turso
   (`userAgent='e2e-test'`, token acak 32-char + HMAC-SHA256 signature).
2. `setupAuthContext()` inject cookie `better-auth.session_token` (httpOnly, sameSite Lax)
   + set `localStorage['cashflow-onboarding-done']=true` (tekan modal walkthrough).
3. Test navigasi → AuthGuard membaca sesi dari cookie → halaman render.

## 3. Strengths

| Area | Detail |
|---|---|
| **No OAuth dependency** | Session di-mint langsung ke DB — deterministik, cepat, bisa jalan di CI tanpa browser Google |
| **Ground-truth API assertions** | Tiap test fetch API dulu (`request.get` dengan cookie eksplisit), lalu bandingkan dengan UI — tidak ada hardcode snapshot yang mudah basi (kecuali pinned total yang didokumentasikan) |
| **Anti-flaky polling** | `expect.poll` menggantikan `waitForTimeout`; respons-based wait (`waitForResponse`) untuk transisi filter |
| **Helper dedup** | 4 helper bersama + 0 duplikasi boilerplate (pageerror collector) |
| **WebServer reuse** | `reuseExistingServer: true` — pakai server dev yang sudah jalan, hemat resource |
| **Determinism** | `workers: 1` + sesi DB bersama → tidak ada race antar worker |
| **Race-condition fix** | RequestId guard di `GmailSyncPage.loadPaginatedResults` — stale response tidak menimpa state |

## 4. Weaknesses

| Area | Detail | Severity |
|---|---|---|
| **Pinned dataset** | `expect(api.total).toBe(284/519)` dkk — regression guard tapi perlu update manual saat data berubah intentional | Low |
| **Dev-server dependency** | Test butuh Vite+API hidup; `webServer` auto-start menambah waktu cold start | Low |
| **Localhost-bound** | Cookie domain `localhost`, cookie path `/`, baseURL hardcode `http://localhost:5180` | Medium (CI perlu env) |
| **Cakupan terbatas** | Hanya 3 dari 14+ halaman — lihat E2E_COVERAGE_REPORT.md | High |

## 5. Technical Debt

1. **Helper keyword string** — `pagination.ts` menerima `keyword` literal (`'transaksi'`/`'email'`);
   jika label UI berubah, test perlu update 2 konstanta per spec (sudah diisolasi, dampak kecil).
2. **`getStatCardValue` memakai `following-sibling` xpath** — tergantung urutan DOM StatCard;
   cukup stabil karena komponen internal, tapi rapuh terhadap refactor markup.
3. **Pinned totals tersebar** — 284/519/86/131 di beberapa test; idealnya satu `fixtures/constants.ts`.
4. **Belum ada global setup/teardown** — cleanup sesi via `afterAll` per spec (bekerja, tapi duplikat).

## 6. Scalability

- **Test runner**: `workers: 1` aman untuk DB bersama; naikkan ke >1 memerlukan isolasi DB
  per worker (prefix user/session) atau Turso instance terpisah.
- **Halaman baru**: pola helper sudah generik (keyword-based) → tinggal buat spec baru.
- **Dataset besar**: pagination diuji (6 halaman); `LOGS_PAGE_SIZE=100` & `pageSize=50` —
  perlu benchmark di 10k+ baris (lihat PERFORMANCE_TEST_PLAN.md).
- **CI**: `workers: 1` + `webServer` → satu runner cukup; matrix (3 OS × 2 browser) akan
  menambah biaya, disarankan browser single (chromium) + smoke job.

## 7. Maintainability

- **Konvensi konsisten**: header docblock per spec, komentar Indonesia, helper ber-tipe eksplisit.
- **Satu sumber kebenaran**: helper bersama → perubahan 1 tempat berdampak semua spec.
- **Typecheck terpisah** (`tsconfig.e2e.json` + `npm run test:e2e:typecheck`) — e2e tidak
  mencemari typecheck aplikasi.
- **Dokumentasi**: setiap spec punya instruksi menjalankan; helper ber-JSDoc.

## 8. Rekomendasi Prioritas

1. **(Now)** CI pipeline GitHub Actions — lihat CI_PIPELINE.md ✅ sudah dibuat
2. **(Next)** Ekstensi coverage ke Budgets/Categories/Auth — lihat E2E_COVERAGE_REPORT.md
3. **(Next)** API contract testing — lihat API_CONTRACT_STRATEGY.md
4. **(Later)** Visual regression + performance budget — lihat plan masing-masing

---
*Dokumen ini disusun berdasarkan state kode & hasil gate terbaru (lint/build/typecheck/e2e 3× pass).*
