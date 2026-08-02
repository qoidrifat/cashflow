# CF-056 — Root Cause Analysis

## Executive Summary
CashFlow tidak punya penanganan terpusat untuk sesi/kredensial yang kedaluwarsa.
Saat Google OAuth `provider_token` atau Supabase session tidak lagi valid, error
mentah dari Google (HTTP 401 "invalid authentication credentials") ditampilkan apa
adanya ke user, tanpa notifikasi ramah, tanpa auto-logout, dan tanpa pembersihan
state. CF-056 menambahkan satu alur konsisten: deteksi terpusat → pop-up 5 detik →
auto-logout → redirect `/login?reason=session_expired`.

## Evidence Collected
- `src/services/gmailService.ts:147` — pada `status === 401 || 403` melempar
  `detail` mentah dari `formatGoogleApiError()`.
- `src/services/gmailService.ts:232` — `formatGoogleApiError()` menghasilkan
  "Akses Gmail ditolak oleh Google (authError). Detail: ...".
- `src/services/authService.ts` — `onAuthStateChange` sebelumnya mengabaikan
  event; `signOutUser()` tidak membedakan logout manual vs sesi mati.
- `src/store/useAuthStore.ts` — `logout()` ada, tapi tidak pernah dipicu otomatis
  oleh kondisi expired.
- Tidak ada HTTP interceptor terpusat; tiap service `fetch` langsung.

## Failure Chain
1. Token Google / Supabase session expired.
2. Request (mis. Sync Gmail) mengembalikan HTTP 401 UNAUTHENTICATED.
3. Tidak ada pemetaan terpusat 401 → alur sesi berakhir.
4. Error teknis mentah tampil ke user; tidak ada logout.
5. State aplikasi tetap "login" padahal kredensial mati (UX buruk + risiko).

## Root Cause (single sentence)
Tidak ada lapisan deteksi terpusat yang memetakan sinyal sesi/kredensial
kedaluwarsa (Supabase SIGNED_OUT / Google 401) menjadi satu alur logout, sehingga
error auth bocor mentah ke UI dan sesi mati dibiarkan terbuka.

## Why This Wasn't Caught Earlier
- Token biasanya masih valid selama pengembangan; expiry jarang terjadi.
- Setiap fitur menangani errornya sendiri; tidak ada kontrak auth terpusat.

## Impact
- Semua fitur yang butuh sesi valid (Gmail Sync, dashboard, admin, AI search).
- Keamanan: state/cache lama tetap dapat diakses dalam sesi tidak valid.
- UX: pesan teknis membingungkan.

## Confidence Score: 90%
Arsitektur auth & titik error sudah dipetakan dari kode nyata; type-check + build
lulus. Sisa 10% adalah verifikasi runtime expiry sebenarnya (butuh token nyata
yang kedaluwarsa).

## Risk Assessment: LOW
Perubahan additive dan client-side. Hanya 401/sinyal-auth yang memicu logout;
error transient tidak terpengaruh. Tidak ada perubahan skema DB / data server.
