# CF-056 — Session Expiry → Auto-Logout: Flow Analysis

## Current (Broken) Flow

```
User Action: klik "Sync Gmail" (Google OAuth provider_token sudah expired)
        ↓
[Service] src/services/gmailService.ts → fetch ke Gmail API dengan Bearer token
        ↓
[External] Gmail API → HTTP 401 UNAUTHENTICATED
           "Request had invalid authentication credentials.
            Expected OAuth 2 access token..."
        ↓
[Handler] formatGoogleApiError() → "Akses Gmail ditolak oleh Google (authError)..."
        ↓
[Throw] error mentah di-throw ke GmailSyncPage
        ↓
[UI] User melihat pesan teknis mentah; aplikasi tetap "seolah login"
     padahal kredensial sudah tidak valid → UX buruk + risiko keamanan
```

### Failure Point
Tidak ada pemetaan terpusat dari sinyal "401 / invalid credentials / Supabase
SIGNED_OUT" ke sebuah alur "sesi berakhir". Setiap fitur menampilkan error
mentahnya sendiri, dan tidak ada auto-logout.

- ACTUAL:   error teknis mentah tampil, tidak ada logout, state lama tetap terbuka.
- EXPECTED: dipetakan ke `triggerSessionExpired()` → pop-up 5 detik → auto-logout.

## Target (Fixed) Flow

```
Trigger (salah satu):
  (a) Supabase auth listener: event SIGNED_OUT tak terduga (refresh gagal)
  (b) Gmail API: HTTP 401 / "invalid authentication credentials"
  (c) Backend API client (admin metrics / agent search): HTTP 401
        ↓
[Detector] src/lib/sessionErrors.ts → isSessionExpiredError() (hanya sinyal auth)
        ↓
[Store] src/store/useSessionExpiryStore.ts → triggerSessionExpired() (IDEMPOTEN)
        ↓ isExpiring = true (flag global anti-duplikat)
        ↓
[UI] src/components/SessionExpiredDialog.tsx (mounted di App, portal ke body)
     - role="alertdialog", non-dismissable, aria-live countdown
     - "Sesi Anda telah berakhir" + hitung mundur 5 → 0
     - setLogoutAnimationActive(true) agar AuthGuard tidak redirect dulu
        ↓
[Timer] 5 detik selesai  ATAU  klik "Keluar sekarang"
        ↓
[Logout] useAuthStore.logout() → signOutUser():
         - markManualSignOut (cegah listener memicu ulang)
         - clearGmailAccessToken() + hapus provider token sessionStorage
         - supabase.auth.signOut() (bersihkan session/token lokal)
        ↓
[Redirect] router.navigate('/login?reason=session_expired', { replace: true })
        ↓
[Login] LoginPage membaca ?reason=session_expired → banner
        "Sesi Anda telah berakhir, silakan masuk lagi."
```

## Detection Points (centralized)
| Sumber | File | Sinyal |
|--------|------|--------|
| Supabase session refresh gagal | `src/services/authService.ts` | event `SIGNED_OUT` (bukan logout manual) |
| Google OAuth token invalid | `src/services/gmailService.ts` | HTTP 401 / invalid credentials |
| Admin metrics API | `src/services/adminMetrics.ts` | HTTP 401 |
| Agent Search API | `src/features/ai-search/services/agentSearchClient.ts` | HTTP 401 |

## Anti-Duplicate & Cleanup
- `useSessionExpiryStore.trigger()` di-guard oleh flag `isExpiring` → pop-up dan
  logout hanya SEKALI meski banyak request gagal bersamaan.
- `SessionExpiredDialog` membersihkan `setInterval` saat unmount / mencapai 0,
  dan `loggingOut` ref mencegah logout ganda (timer vs tombol).
- Hanya 401/sinyal-auth yang memicu; HTTP 500 / timeout / network TIDAK memicu.
