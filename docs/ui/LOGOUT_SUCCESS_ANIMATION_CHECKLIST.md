# Logout Success Animation Checklist

## Match Delete All Success Animation
- [x] Animasi Hapus Semua Data dianalisis
- [x] `SuccessCheckAnimation` existing digunakan ulang
- [x] Tidak ada duplikasi komponen animasi
- [x] Style logout disamakan dengan Hapus Semua Data
- [x] Timing animasi disamakan
- [x] Particle burst disamakan
- [x] Card/modal layout disamakan
- [x] Dark mode disamakan
- [x] Light mode disamakan
- [x] Mobile layout disamakan
- [x] Logout success muncul setelah signOut sukses
- [x] Logout gagal tidak menampilkan animasi sukses
- [x] Build berhasil

## Reference
- Source animasi: `src/components/ui/SuccessCheckAnimation.tsx`
- Source keyframes: `src/styles/globals.css`
- Referensi UI Hapus Semua Data: `Modal maxWidth="sm"` + success state di `src/features/profile/ProfilePage.tsx`
- Wrapper feedback konsisten: `src/components/ui/SuccessFeedbackOverlay.tsx`

## Behavior
- Klik logout menutup dropdown atau modal konfirmasi.
- Tombol logout masuk loading state dan disabled selama proses.
- `logout()` tetap memanggil `signOutUser()` dari `src/services/authService.ts`.
- Modal sukses baru terbuka setelah `logout()` resolve tanpa error.
- Jika `logout()` throw error, overlay sukses tidak dirender dan toast error muncul.
- Redirect ke `/login` ditunda 5000ms agar success logout terlihat lebih lama.
- Header tetap merender `ProfileDropdown` selama `logoutAnimationActive` agar modal success tidak unmount setelah `firebaseUser` menjadi null.
- `Modal` render via portal ke `document.body`, sehingga modal logout dari Header tidak terpotong oleh `backdrop-filter` header.

## Style Sync
- Icon size: `SuccessCheckAnimation size="lg"`
- Particle burst: `showParticles`
- Circle pop: keyframe `success-check-pop` 650ms
- Check draw: keyframe `success-check-draw` 520ms dengan delay 260ms
- Particle burst duration: 800ms dengan delay 250ms
- Easing: tetap memakai keyframes existing dari Hapus Semua Data
- Card/modal: `Modal maxWidth="sm"` yang sama dengan Hapus Semua Data
- Light mode: backdrop `app-overlay`, `app-elevated`, teks slate gelap
- Dark mode: backdrop `app-overlay`, `app-elevated`, teks terang
- Accessibility: `role="status"` dan `aria-live="polite"` berada pada content success

## Files Changed
| File | Perubahan |
| ---- | --------- |
| `src/components/ui/SuccessFeedbackOverlay.tsx` | NEW wrapper layout feedback sukses yang reuse `SuccessCheckAnimation` existing |
| `src/components/ui/Modal.tsx` | Modal sekarang memakai portal ke `document.body` agar fixed positioning sama di semua parent |
| `src/features/profile/ProfilePage.tsx` | Hapus Semua Data dan logout success memakai wrapper yang sama di dalam `Modal`; race AuthGuard logout diperbaiki; timing logout 5000ms |
| `src/components/layout/ProfileDropdown.tsx` | Logout success memakai `Modal` dan wrapper yang sama; flag AuthGuard aktif sebelum `signOut()` dan dimatikan lagi jika gagal |
| `src/components/layout/Header.tsx` | `ProfileDropdown` tetap mounted selama logout animation aktif |
| `src/store/useAuthStore.ts` | `logout()` eksplisit mempertahankan `logoutAnimationActive` sampai caller menutup animasi |
| `docs/ui/LOGOUT_SUCCESS_ANIMATION_CHECKLIST.md` | Checklist diperbarui sesuai implementasi aktual |

## Verification
| Check | Result |
| ----- | ------ |
| `npm run lint` | PASS |
| `npm run build` | PASS |
| Duplicate animation/keyframes | Tidak ada |
| Logout success after signOut | PASS by code path |
| Logout failure no success animation | PASS by code path |
| Recording | `public/logout-success-recording.webm` |
| Mobile evidence | `public/logout-debug-viewport.png` |
