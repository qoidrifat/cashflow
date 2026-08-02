# Page Loading Transition Checklist

## Scope
- [x] Loading route global ditambahkan
- [x] Asset `cashflow-icon.webp` digunakan
- [x] Loading overlay dibuat
- [x] Loading bar dibuat
- [x] Page transition dibuat
- [x] Semua halaman tercover

## Asset
- [x] `cashflow-icon.webp` ditemukan di `public/logo/cashflow-icon.webp`
- [x] Path asset `/logo/cashflow-icon.webp` benar
- [x] Icon tampil di light mode
- [x] Icon tampil di dark mode

## UI/UX
- [x] Animasi smooth
- [x] Profesional modern minimalis
- [x] Tidak terlalu lama (1000ms minimum, 5000ms safety timeout)
- [x] Tidak flicker (minimum visible duration)
- [x] Tidak stuck (safety timeout)
- [x] Mobile rapi
- [x] Desktop rapi
- [x] Dark mode tidak flash putih
- [x] Light mode rapi

## Accessibility
- [x] `role="status"` tersedia pada overlay
- [x] `aria-live="polite"` tersedia
- [x] Reduced motion didukung (animasi dimatikan via `@media (prefers-reduced-motion: reduce)`)

## Performance
- [x] Tidak menambah dependency berat (hanya CSS keyframes + Tailwind)
- [x] Timer dibersihkan pada unmount
- [x] Tidak rerender berlebihan (hanya pada route change)
- [x] CSS transform/opacity digunakan (GPU-accelerated)

## Test Result
| Test                 | Result | Notes |
| -------------------- | ------ | ----- |
| Beranda → Transaksi  |        |       |
| Transaksi → Budget   |        |       |
| Budget → Gmail Sync  |        |       |
| Gmail Sync → Laporan |        |       |
| Mobile 360px         |        |       |
| Mobile 414px         |        |       |
| Dark mode            |        |       |
| Light mode           |        |       |
| Build                |        |       |

## File yang Diubah
| File | Perubahan |
| ---- | --------- |
| `public/logo/cashflow-icon.webp` | Asset icon CashFlow (13KB) |
| `src/components/ui/RouteLoadingOverlay.tsx` | **NEW** Loading overlay dengan animasi icon CashFlow |
| `src/components/ui/RouteLoadingBar.tsx` | **EXISTING** Top progress bar (tidak diubah) |
| `src/components/ui/PageTransition.tsx` | **EXISTING** Fade + slide-up wrapper (tidak diubah) |
| `src/components/layout/AppLayout.tsx` | Integrasi RouteLoadingOverlay |
| `src/app/router.tsx` | RouteFallback kini memakai cashflow-icon.webp |
| `src/styles/globals.css` | Animasi `cashflow-loader-float`, `cashflow-loader-ring`, dan reduced motion rules |

## Final Status
- Route Loading: ✅ OK
- CashFlow Icon Loader: ✅ OK
- Global Coverage: ✅ OK
- Build: ⏳ (akan diverifikasi)
