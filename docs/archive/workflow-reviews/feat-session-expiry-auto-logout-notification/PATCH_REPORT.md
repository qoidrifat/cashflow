# CF-056 — Patch Report

## Summary
Menambahkan deteksi sesi berakhir terpusat + pop-up "Sesi Anda telah berakhir"
dengan countdown 5 detik + auto-logout + redirect `/login?reason=session_expired`.
Error mentah Google (HTTP 401 "invalid authentication credentials") tidak lagi
ditampilkan ke user; dipetakan ke alur sesi berakhir.

## Files Created
| File | Type | Notes |
|------|------|-------|
| `src/store/useSessionExpiryStore.ts` | feature | State terpusat + `triggerSessionExpired()` (idempoten) |
| `src/lib/sessionErrors.ts` | feature | `isSessionExpiredError()` — positive-match sinyal auth |
| `src/components/SessionExpiredDialog.tsx` | feature | Pop-up non-dismissable + countdown 5→0 + auto-logout |
| `docs/feat-session-expiry-auto-logout-notification/*.md` | docs | FLOW / RCA / PLAN / PATCH |

## Files Modified
| File | Type | Change |
|------|------|--------|
| `src/services/authService.ts` | feature | `manualSignOut`/`hadSession`; listener `SIGNED_OUT` tak terduga → `triggerSessionExpired()`; `signOutUser()` set flag |
| `src/services/gmailService.ts` | bugfix | 401/invalid-credentials → trigger + pesan ramah (bukan mentah) |
| `src/services/adminMetrics.ts` | feature | deteksi 401 di `getJson` → trigger |
| `src/features/ai-search/services/agentSearchClient.ts` | feature | deteksi 401 di `parseResponse` → trigger |
| `src/app/App.tsx` | feature | mount `<SessionExpiredDialog />` global |
| `src/features/auth/LoginPage.tsx` | feature | baca `?reason=session_expired` → notice |
| `src/features/auth/components/PublicLandingPage.tsx` | feature | prop `notice` + banner kontekstual |

## Validation Results
| Check | Command | Status | Notes |
|-------|---------|--------|-------|
| lint | `npm run lint` (`tsc --noEmit`) | ✅ PASS | 0 errors |
| type-check | `npx tsc -p tsconfig.json --noEmit` | ✅ PASS | 0 errors |
| build | `npx vite build` | ✅ PASS | built ~28.7s; `sessionErrors` chunk emitted |
| test | — | N/A | tidak ada `test` script di package.json |
| diagnostics | getDiagnostics (10 file) | ✅ PASS | No diagnostics |

## Manual Trace (expected)
1. Token/sesi expired → aksi (Sync Gmail) → 401.
2. Pop-up "Sesi Anda telah berakhir" muncul + countdown 5→0. ✅
3. Setelah 5 detik → auto-logout → `/login?reason=session_expired`. ✅
4. Tombol "Keluar sekarang" → logout segera. ✅
5. Error authError mentah TIDAK lagi tampil. ✅
6. State/cache auth lokal dibersihkan (gmail token + supabase signOut). ✅

## Edge Cases Handled
- Banyak 401 bersamaan → satu pop-up, satu logout (flag `isExpiring`).
- Error non-auth (500/timeout/network) → TIDAK memicu logout (detektor positive-match).
- Logout manual (ProfileDropdown) → TIDAK memunculkan pop-up (`manualSignOut`).
- Unmount saat countdown → `clearInterval` (tanpa error timer).
- 403 admin (non-admin) / 403 Gmail (permission) → TIDAK memicu logout.

## Security / Privacy
- Tidak menampilkan/log token, refresh token, atau detail OAuth ke user.
- Pesan ke user hanya teks ramah generik.
- Logout membersihkan provider token (sessionStorage) + Supabase session lokal.
- Tidak menghapus data user di server (logout ≠ delete account); tidak ubah skema DB.

## Risk Level: LOW
## Backward Compatible: YES
Fitur additive; alur login/logout existing tidak berubah selain penambahan
deteksi otomatis. Bisa dinonaktifkan dengan melepas mount dialog.
