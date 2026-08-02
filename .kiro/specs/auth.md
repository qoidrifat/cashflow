# Spec: Authentication & Session Handling

> ⚠️ **SUPERSEDED (2026-08-02)** — Supabase telah di-decommission penuh.
> Auth saat ini: **Better Auth** (Google OAuth, session cookie httpOnly) + **Turso**
> (`server/lib/auth.js`, `server/middleware/authMiddleware.js`). Kontrak login/logout/
> session-expiry di bawah masih berlaku secara konsep, tapi semua referensi Supabase
> harus dibaca sebagai Better Auth. Dokumen otoritatif: `README.md` § Arsitektur Auth.

## Overview
CashFlow menggunakan **Better Auth** (Google OAuth) sebagai autentikasi utama.
Gmail Sync memakai **Google OAuth 2.0** `provider_token` yang di-cache dari
session Better Auth (scope `gmail.readonly`). Dokumen ini mengikat kontrak untuk
login, logout, dan penanganan sesi berakhir.

## Auth Architecture
- State: `src/store/useAuthStore.ts` (zustand) — `firebaseUser`, `isAuthenticated`,
  `isLoading`, `logoutAnimationActive`, `login()`, `logout()`.
- Service: `src/services/authService.ts` — wrapper Better Auth
  (`getCurrentAuthUser`, Google sign-in flow, signOut, token Gmail).
- Guard: `src/features/auth/AuthGuard.tsx` — redirect ke `/login` bila tidak
  terautentikasi (kecuali saat `logoutAnimationActive`).
- Server auth: `server/lib/auth.js` (Better Auth + Turso session) — cookie
  `better-auth.session_token` (httpOnly, sameSite Lax); `authMiddleware` → `req.user`.
- Gmail token: disimpan di `sessionStorage` (`GMAIL_PROVIDER_TOKEN_KEY`), bukan
  dari session server (Better Auth).

## CF-056 — Session Expiry Contract

### Deteksi Terpusat
Sistem mendeteksi kondisi "sesi berakhir" dari sumber berikut dan memetakannya ke
SATU alur lewat `triggerSessionExpired()` (`src/store/useSessionExpiryStore.ts`):

| Sumber | Lokasi | Sinyal |
|--------|--------|--------|
| Session Better Auth invalid/expired | `services/authService.ts` | event `SIGNED_OUT` non-manual |
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
  (clear Gmail provider token + logout Better Auth), lalu
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
- AC-01 Deteksi terpusat untuk Better Auth session expired DAN Google 401. ✅
- AC-02 Pop-up ramah + countdown 5 detik terlihat. ✅
- AC-03 Auto-logout setelah 5 detik → signOut + clear lokal + redirect /login. ✅
- AC-04 Error mentah Google tidak lagi tampil; dipetakan ke alur ini. ✅
- AC-05 Non-dismissable; hanya "Keluar sekarang" (tidak ada "lanjut sesi mati"). ✅
- AC-06 State/cache auth lokal bersih setelah logout. ✅
- AC-07 Idempotent: pop-up & logout SEKALI. ✅

Docs: `docs/feat-session-expiry-auto-logout-notification/`.
