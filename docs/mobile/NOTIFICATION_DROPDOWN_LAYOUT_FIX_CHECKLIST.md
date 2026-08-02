# Notification Dropdown Layout Fix Checklist

## Masalah
- [x] Dropdown Bell terpotong saat dibuka
- [x] Posisi dropdown tidak proporsional
- [x] Dropdown keluar viewport mobile
- [x] Dropdown tertutup parent overflow/z-index

## Analisis
- [x] Komponen Bell ditemukan — `src/features/notifications/components/NotificationBell.tsx`
- [x] Komponen Dropdown ditemukan — `src/features/notifications/components/NotificationDropdown.tsx`
- [x] Parent overflow diperiksa:
  - Header: `sticky top-0 z-20`, backdrop-blur creates stacking context, no `overflow-hidden`
  - Parent wrapper: `div ref={bellRef} className="relative"` — no overflow clipping
  - AppLayout: `min-h-screen bg-transparent` — no overflow hidden
- [x] Z-index diperiksa:
  - Header: `z-20`
  - Sidebar: `z-30`
  - BottomNav: `z-30`
  - Dropdown: `z-50` → ditingkatkan ke `z-[60]`
- [x] Mobile width diperiksa: `w-[360px] max-w-[calc(100vw-24px)]` → off-screen kiri pada 360px viewport
- [x] Desktop alignment diperiksa: `absolute right-0 top-full` — sudah benar

## Root Cause
1. **Mobile clipping**: Dropdown menggunakan `absolute right-0 top-full` di dalam parent `relative`. Width `w-[360px]` dengan `right-0` menyebabkan dropdown meluas ke kiri dari bell. Pada viewport 360px, bagian kiri dropdown keluar layar.
2. **Z-index**: Sidebar `z-30` > Header `z-20`. Dropdown di dalam header (`z-20` stacking context) bisa tertutup sidebar meskipun punya `z-50`.

## Perbaikan
- [x] Width responsive diperbaiki:
  - Mobile: `fixed left-3 right-3 top-16` (12px margin tiap sisi, viewport-relative)
  - Desktop: `sm:absolute sm:left-auto sm:right-0 sm:top-full sm:mt-2 sm:w-96`
- [x] Position mobile diperbaiki: `fixed` → keluar dari parent clipping context
- [x] Position desktop diperbaiki: tetap `absolute right-0` relatif ke bell
- [x] z-index diperbaiki: `z-[60]` (di atas sidebar `z-30`, header `z-20`, bottom nav `z-30`)
- [x] max-height dan scroll internal: `max-h-[calc(100vh-5rem)]` pada mobile + inner `max-h-[360px] overflow-y-auto`
- [x] Animation origin: `origin-top-right` untuk scale animation natural
- [x] click outside tetap bekerja (di NotificationBell.tsx)
- [x] Escape tetap bekerja (di NotificationBell.tsx)
- [x] dark/light mode rapi (menggunakan CSS variables `--color-*`)

## Validasi Mobile

| Width | Result | Notes |
| ----- | ------ | ----- |
| 360px | ✅ Aman | `fixed left-3 right-3` = lebar 336px, margin 12px tiap sisi |
| 375px | ✅ Aman | Lebar 351px, margin 12px tiap sisi |
| 390px | ✅ Aman | Lebar 366px, margin 12px tiap sisi |
| 414px | ✅ Aman | Lebar 390px, margin 12px tiap sisi |
| 768px | ✅ Aman | Beralih ke `sm:absolute sm:right-0 sm:w-96` (384px) |

## Build
- [x] `npm run build` berhasil — 0 error, 0 warning
- [x] `npx tsc --noEmit` — 0 error

## File yang Diubah

| File | Perubahan |
| ---- | --------- |
| `src/features/notifications/components/NotificationDropdown.tsx` | Mobile: `fixed left-3 right-3 top-16 max-h-[calc(100vh-5rem)]`; Desktop: `sm:absolute sm:right-0 sm:top-full sm:mt-2 sm:max-h-none sm:w-96`; z-index: `z-[60]`; animasi: `origin-top-right` |

## Final Status
- Dropdown notifikasi: ✅ OK
- Mobile layout: ✅ OK (360px–768px)
- Desktop layout: ✅ OK
- Build: ✅ OK
