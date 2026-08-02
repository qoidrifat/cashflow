# Spec: Authentication & Session Handling

## Overview
CashFlow menggunakan **Supabase Auth** (Google OAuth) sebagai autentikasi utama.
Gmail Sync memakai **Google OAuth 2.0** `provider_token` yang di-cache dari
session Supabase. Dokumen ini mengikat kontrak untuk login, logout, dan
penanganan sesi berakhir.

## Auth Architecture
- State: `src/store/useAuthStore.ts` (zustand) — `firebaseUser`, `isAuthenticated`,
  `isLoading`, `logoutAnimationActive`, `login()`, `logout()`.
- Service: `src/services/authService.ts` — wrapper Supabase
  (`onAuthStateChanged`, `signInWithGoogle`, `signOutUser`, token Gmail).
- Guard: `src/features/auth/AuthGuard.tsx` — redirect ke `/login` bila tidak
  terautentikasi (kecuali saat `logoutAnimationActive`).
- Client Supabase: `src/config/supabase.ts` — `persistSession`,
  `autoRefreshToken`, `flowType: 'pkce'`.

## CF-056 — Session Expiry Contract

### Deteksi Terpusat
Sistem mendeteksi kondisi "sesi berakhir" dari sumber berikut dan memetakannya ke
SATU alur lewat `triggerSessionExpired()` (`src/store/useSessionExpiryStore.ts`):

| Sumber | Lokasi | Sinyal |
|--------|--------|--------|
| Supabase session refresh gagal | `services/authService.ts` | event `SIGNED_OUT` non-manual |
| Google OAuth token invalid | `services/gmailService.ts` | HTTP 401 / invalid credentials |
| Admin metrics API | `services/adminMetrics.ts` | HTTP 401 |
| Agent Search API | `features/ai-search/services/agentSearchClient.ts` | HTTP 401 |

Detektor: `src/lib/sessionErrors.ts` → `isSessionExpiredError(input, status?)`.
**Positive-match**: hanya HTTP 401 + pola pesan auth (invalid authentication
credentials, UNAUTHENTICATED, invalid_grant, jwt expired, refresh token, dst).
HTTP 403/500/timeout/network **TIDAK** memicu logout.

### Pop-up & Auto-Logout
- Komponen: `src/components/SessionExpiredDialog.tsx` (mounted global di `App.tsx`,
  portal ke `document.body`).
- Non-dismissable (`role="alertdialog"`, `aria-modal`, `aria-live` countdown).
- Judul: "Sesi Anda telah berakhir".
- Pesan: "Demi keamanan, Anda akan keluar secara otomatis dalam {n} detik."
- Countdown TEPAT 5 → 0 detik. Tombol "Keluar sekarang" mempercepat logout.
- Pada 0 / klik: `useAuthStore.logout()` → `signOutUser()`
  (clear Gmail provider token + `supabase.auth.signOut()`), lalu
  `router.navigate('/login?reason=session_expired', { replace: true })`.

### Idempotency & Cleanup
- Flag global `isExpiring` → pop-up & logout berjalan **SEKALI** meski banyak
  request gagal bersamaan.
- `loggingOut` ref → cegah logout ganda (timer vs tombol).
- `manualSignOut` flag → logout disengaja (ProfileDropdown) tidak memunculkan pop-up.
- `setInterval` dibersihkan saat unmount / mencapai 0 (hindari leak).

### Privacy / Security
- Tidak menampilkan/log token, refresh token, authorization header, atau detail
  OAuth ke user. Pesan ke user hanya teks ramah generik.
- Error mentah Google ("invalid authentication credentials") TIDAK ditampilkan;
  dipetakan ke alur sesi berakhir.
- Logout membersihkan session/token/cache auth lokal; **tidak** menghapus data
  user di server (logout ≠ delete account); tidak mengubah skema DB.

### Login Banner
- `/login?reason=session_expired` → `LoginPage` menampilkan banner:
  "Sesi Anda telah berakhir, silakan masuk lagi." (via prop `notice` di
  `PublicLandingPage`).

## Acceptance Criteria (CF-056)
- AC-01 Deteksi terpusat untuk Supabase session expired DAN Google 401. ✅
- AC-02 Pop-up ramah + countdown 5 detik terlihat. ✅
- AC-03 Auto-logout setelah 5 detik → signOut + clear lokal + redirect /login. ✅
- AC-04 Error mentah Google tidak lagi tampil; dipetakan ke alur ini. ✅
- AC-05 Non-dismissable; hanya "Keluar sekarang" (tidak ada "lanjut sesi mati"). ✅
- AC-06 State/cache auth lokal bersih setelah logout. ✅
- AC-07 Idempotent: pop-up & logout SEKALI. ✅

Docs: `docs/feat-session-expiry-auto-logout-notification/`.
