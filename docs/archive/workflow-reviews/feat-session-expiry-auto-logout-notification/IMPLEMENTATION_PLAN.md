# CF-056 — Implementation Plan

## Current State
- Auth: Supabase Auth (session + refresh) via `useAuthStore` + `authService`.
- Gmail: Google OAuth `provider_token` cached in `authService`.
- Error mentah Google 401 tampil ke user; tidak ada auto-logout terpusat.
- Tidak ada HTTP interceptor; service `fetch` langsung.

## Target State
- Util/state terpusat `triggerSessionExpired()` (idempoten, flag global).
- Detektor `isSessionExpiredError()` — positive-match untuk sinyal auth saja.
- `SessionExpiredDialog`: modal non-dismissable, countdown 5→0, tombol
  "Keluar sekarang", a11y (`role="alertdialog"`, `aria-live`).
- Setelah countdown 0 / klik → `signOut` Supabase + clear token lokal +
  redirect `/login?reason=session_expired`.
- Pemetaan sinyal expired di: Supabase auth listener, Gmail 401, admin metrics
  401, agent search 401.
- Banner kontekstual di halaman login.

## Required Changes
1. **`src/store/useSessionExpiryStore.ts`** (baru) — zustand store + non-hook
   `triggerSessionExpired()` / `isSessionExpiring()`. Flag idempoten.
2. **`src/lib/sessionErrors.ts`** (baru) — `isSessionExpiredError(input, status?)`.
   Match 401 + pola pesan auth; TIDAK match 403/500/timeout/network.
3. **`src/components/SessionExpiredDialog.tsx`** (baru) — pop-up + countdown +
   logout sequence (guarded), cleanup timer.
4. **`src/services/authService.ts`** — `manualSignOut`/`hadSession` flag; di
   listener, `SIGNED_OUT` tak terduga → `triggerSessionExpired()`; `signOutUser()`
   set `manualSignOut`.
5. **`src/services/gmailService.ts`** — 401/invalid-credentials → 
   `triggerSessionExpired()` + throw pesan ramah (bukan mentah).
6. **`src/services/adminMetrics.ts`** & 
   **`src/features/ai-search/services/agentSearchClient.ts`** — deteksi 401 di
   error path → `triggerSessionExpired()`.
7. **`src/app/App.tsx`** — mount `<SessionExpiredDialog />` (global).
8. **`src/features/auth/LoginPage.tsx`** + **`PublicLandingPage.tsx`** — banner
   `?reason=session_expired`.

## Anti-Duplicate / Idempotency
- Flag `isExpiring` di store → pop-up & logout SEKALI.
- `loggingOut` ref di dialog → cegah logout ganda (timer vs tombol).
- `manualSignOut` → cegah listener memicu pop-up saat logout disengaja.

## Risks & Mitigation
- Race banyak 401 → mitigasi flag global.
- AuthGuard redirect saat sesi jadi invalid → mitigasi
  `setLogoutAnimationActive(true)` selama countdown + overlay portal z-[100].
- Timer leak → mitigasi `clearInterval` di cleanup.
- Jangan logout untuk error non-auth → detektor positive-match (401 saja).

## Rollback
- Hapus mount `<SessionExpiredDialog />` di App (fitur non-aktif), atau revert
  8 file. Tidak ada migrasi DB.

## Testing Strategy
- `npm run lint` (= `tsc --noEmit`), `npm run build` (= `tsc --noEmit && vite build`).
- Tidak ada `test` script (N/A).
- Manual trace: paksa 401 / expire token → pop-up → countdown → logout → /login.
