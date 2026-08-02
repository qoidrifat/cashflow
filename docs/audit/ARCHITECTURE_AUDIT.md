# Architecture Audit — CashFlow

> Audit READ-ONLY · Tanggal: 1 Agustus 2026 · Semua temuan berbasis source code.

## 1. Frontend Architecture

### Stack & Struktur
- **React 18 + TypeScript + Vite 5** — `package.json` (react 18.3.1, vite 5.3.1, typescript 5.2.2).
- **State**: Zustand stores — `src/store/useAuthStore.ts`, `useAppStore.ts`, `useSessionExpiryStore.ts` (per `.kiro/specs/auth.md`).
- **Routing**: `react-router-dom` 7 — `src/app/router.tsx` (lazy routes per `App.tsx` import `RouterProvider`).
- **Organisasi**: `src/features/` (16 modul: ai-search, auth, budgets, categories, dashboard, gmail, landing, notifications, privacy, professional, profile, reports, settings, splash, transactions), `src/services/` (19 service), `src/config/` (api, env, supabase, theme, constants), `src/lib/` (utils, logger, parsers AI).

### Temuan
- ✅ **Layering bersih**: pages/features → services → config/api. Service memusatkan akses API (`apiGet/apiPost/apiPut/apiDelete` di `src/config/api.ts`, semua `credentials: 'include'`).
- ✅ **Compatibility stub**: `src/config/supabase.ts` adalah stub penuh (tidak pernah memanggil `createClient`) — migrasi ke Turso + Better Auth sudah tuntas; referensi `firebaseUser` di store hanyalah penamaan legacy (mis. `App.tsx`).
- ⚠️ **Penamaan legacy membingungkan**: `firebaseUser`, `setFirebaseReady`, `supabaseMappers.ts` — label Firebase/Supabase tersisa padahal stack aktual Better Auth + Turso. Tidak fatal (stub), tapi menurunkan keterbacaan & berisiko salah interpretasi bagi developer baru.
- ⚠️ **RouterProvider + global dialog**: `App.tsx` merender `RouterProvider` + `SessionExpiredDialog` — pola OK.

## 2. Backend Architecture

### Stack & Struktur
- **Express (server) + Turso/libSQL** (`server/lib/turso.js`, singleton dengan auto-init schema dari `turso-schema.sql`) + **Better Auth** (`server/lib/auth.js`).
- ⚠️ **Versi Express split**: `server/package.json` mendeklarasikan `express ^4.21.0` dan `server/node_modules` ada (server resolve dep dari `server/node_modules` dulu) → runtime server = **Express 4**. Root `package.json` punya `express ^5.2.1` (tidak dipakai server). Perbedaan API Express 4 vs 5 signifikan — konsolidasi versi direkomendasikan (lihat GAP_ANALYSIS.md).
- **Route modules** (`server/routes/`): budgets, categories, gmail, notifications, professionalSuite, recurring, transactions.
- **Inline handlers**: AI, agent-search, admin metrics, health, SSE live di `server/index.js` (bukan di routes/).
- **Middleware**: `authMiddleware` (attach `req.user`/`req.session`, tidak memblokir) + `requireAuth` (401).

### Temuan
- ✅ **Pembagian route per domain** rapi; semua route bisnis dilindungi `requireAuth`.
- ⚠️ **Inkonsistensi struktur**: ~20 endpoint AI/admin/search/health didefinisikan langsung di `server/index.js` (file ~1600+ baris), sedangkan route domain di `routes/*.js`. Ini menambah `index.js` jadi monolit — sulit di-test unit dan rawan konflik merge.
- ⚠️ **`resolveAdmin()`** (`server/index.js` L1545+) masih berkomentar "Resolve admin user from Supabase JWT" padahal stack auth sekarang Better Auth — **komentar usang**; verifikasi implementasi aktual diperlukan (lihat SECURITY_AUDIT.md).
- ✅ **SSE**: `server/lib/sse.js` terpisah — pola baik.

## 3. Authentication Architecture

- **Better Auth** (`server/lib/auth.js`): Google OAuth (scope `gmail.readonly`), database Turso via `LibsqlDialect`, plugin `dash()`, cookieCache 5 menit, trustedOrigins (localhost + better-auth + ngrok/loca.lt).
- **Session flow**: cookie `better-auth.session_token` (httpOnly, sameSite Lax, secure false di dev) → `authMiddleware` → `getSession` per request.
- **Frontend**: `useAuthStore.init()` + `authService` (wrapper). Guard: `AuthGuard` redirect ke `/login`.

### Temuan
- ✅ **Single source of truth** auth di server; E2E memanfaatkan cookie yang sama (`mintSession.ts` mereplikasi format cookie + HMAC signature persis — terbukti bekerja, seluruh 8 test login sukses).
- ⚠️ **Dev fallback secret**: `'cashflow-dev-secret-change-in-production'` di `auth.js` — aman hanya jika produksi selalu set `BETTER_AUTH_SECRET` (lihat SECURITY_AUDIT.md).
- ⚠️ **Dokumentasi auth usang**: `.kiro/specs/auth.md` mendeskripsikan arsitektur **Supabase Auth** (`supabase.auth.signInWithGoogle`, `onAuthStateChanged`) — **tidak sinkron** dengan implementasi Better Auth aktual (lihat DOCUMENTATION_CONSISTENCY.md).

## 4. Testing Architecture (E2E)

- **Playwright** (`playwright.config.ts`): workers 1 (sesi DB bersama), retries 1, expect 20s, 2 webServer auto-start + `reuseExistingServer`, reporter list+html, trace/video/screenshot retain-on-failure.
- **Helper layer**: `mintSession.ts` (sesi), `authContext.ts` (cookie+onboarding), `pagination.ts` (counter), `errors.ts` (pageerror).
- **3 spec / 8 test**: gmail-sync (3), transactions (3), dashboard (2).

### Temuan
- ✅ **Pola deterministik**: login tanpa Google OAuth manual (mint cookie), wait berbasis API response (`clickFilterAndWaitResponse`) + `expect.poll`, tidak ada `networkidle`.
- ✅ **Satu sumber kebenaran** pagination helper antar spec (refactor keyword-based, tanpa regex duplikat).
- ✅ **Fix race produksi nyata**: stale-response guard `paginatedRequestIdRef` di `GmailSyncPage.tsx` — terdeteksi via flaky E2E, bukan sekadar hardening test.
- ⚠️ **Cakupan terbatas**: 3/12+ halaman kritis (roadmap di `E2E_COVERAGE_REPORT.md`).

## 5. API Design

- **REST** (`/api/<domain>`), JSON, `requireAuth` pada semua route bisnis.
- **Pagination server-side**: `/api/transactions/paginated` (page/pageSize 1–100, offset) dan `/api/gmail/logs` (limit clamp 1–5000 + summary + filter status/syncRunId/search + sort).
- **Error handling**: try/catch per handler; `logger` di frontend; ErrorBoundary di `src/components/ErrorBoundary.tsx`.

### Temuan
- ✅ Pagination + filter + sort parameterized (bukan string concatenation yang rawan SQLi — pakai prepared statements via `@libsql/client`).
- ⚠️ **Konsistensi respons**: beberapa endpoint return `{ data, total }` (paginated), ada yang array mentah (`/api/transactions?limit=50`) — tidak ada envelope standar global. Minor, tapi bisa menyulitkan API contract testing (lihat API_CONTRACT_STRATEGY.md).

## 6. Maintainability — Skor

| Aspek | Nilai | Catatan |
|---|---|---|
| Modularity | 8/10 | routes/, services/, features/ rapi; index.js monolit menurunkan skor |
| Consistency | 6/10 | Naming legacy (firebase/supabase), komentar usang, envelope respons heterogen |
| Readability | 8/10 | Helper E2E terdokumentasi baik, komentar kontekstual |
| Testability | 7/10 | E2E kuat; unit test belum ada; handler inline sulit di-unit-test |
| Documentation | 6/10 | docs/e2e/ sangat baik; README hilang; .kiro/specs sebagian usang |
| **Overall** | **7.2/10** | Arsitektur sehat untuk skala saat ini; debt terkonsentrasi di naming legacy, monolit index.js, dan dokumentasi usang |
