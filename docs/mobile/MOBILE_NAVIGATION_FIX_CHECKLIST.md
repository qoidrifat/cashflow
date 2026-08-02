# Mobile Navigation Fix Checklist

## Masalah

- [x] Gmail Sync tidak terlihat di mobile
- [x] Kategori tidak terlihat di mobile
- [x] Pengaturan tidak terlihat di mobile
- [x] Profil tidak terlihat di mobile
- [x] Bottom nav/sidebar mobile terlalu terbatas

## Perbaikan

- [x] Navigasi mobile diaudit
- [x] Gmail Sync ditambahkan ke bottom nav (primary item ke-4)
- [x] Kategori dipindahkan ke profile dropdown
- [x] Profil dipindahkan ke avatar dropdown
- [x] Pengaturan dipindahkan ke avatar dropdown
- [x] Logout tersedia di avatar dropdown
- [x] Desktop sidebar tidak rusak
- [x] Active state diperbaiki (NavLink + window.location.pathname)

## Profile Dropdown

- [x] Klik avatar membuka menu
- [x] Klik luar menutup menu
- [x] Escape menutup menu
- [x] Profil tersedia
- [x] Pengaturan tersedia
- [x] Kategori tersedia
- [x] Logout tersedia
- [x] Dark mode rapi (bg-app-elevated backdrop-blur)
- [x] Light mode rapi
- [x] Touch target ≥ 44px
- [x] aria-label, role="menu", aria-expanded

## Mobile Test

| Width | Result | Notes |
| ----- | ------ | ----- |
| 360px | ✅ OK | 5 item bottom nav fit, sheet scrollable |
| 375px | ✅ OK | Layout rapi, tidak overflow |
| 390px | ✅ OK | Bottom nav proporsional |
| 414px | ✅ OK | Lebih lega |
| 768px | ✅ OK | Tablet landscape — bottom nav tetap muncul |
| Desktop 1024px+ | ✅ OK | Sidebar penuh, bottom nav hidden |

## Strategi Navigasi

**Opsi yang dipilih: Bottom Nav 5 Item + Menu Lainnya Sheet**

### Bottom Nav (5 item)
1. **Beranda** — `/dashboard`
2. **Transaksi** — `/transactions`
3. **Budget** — `/budgets`
4. **Gmail** — `/gmail-sync`
5. **Lainnya** — membuka bottom sheet

### Lainnya Sheet (4 item)
- Laporan — `/reports`
- Rutin — `/recurring`
- Suite — `/professional`
- **Kategori** — `/categories` ✅ (dipindahkan dari profile dropdown)

### Profile Dropdown (2 item + Logout)
- Profil — `/profile`
- Pengaturan — `/settings`
- Logout — signOut dari useAuthStore

## Move Kategori to Lainnya

### Changes
- [x] Kategori dipindahkan dari `profileMenuNav` ke `moreMenuNav`
- [x] Duplikat Kategori di `sidebarNav` dihapus (otomatis via `...moreMenuNav`)
- [x] Tombol Lainnya di bottom nav punya active state ketika user di `/categories`
- [x] Item Kategori di dalam Lainnya sheet punya active state (sudah ada sebelumnya)
- [x] Route tetap `/categories` — tidak berubah
- [x] Desktop sidebar tidak berubah (Kategori tetap tampil via `...moreMenuNav`)
- [x] Profile dropdown otomatis menyesuaikan (membaca dari `profileMenuNav` yang sudah diupdate)
- [x] Build 0 error, 0 warning

### Active State Flow
- User di `/categories` → Lainnya button menyala (primary-600/bg-primary-50) + indikator dot
- User di `/categories` → Kategori item di Lainnya sheet menyala (active styling)
- User pindah ke route lain → Lainnya button kembali normal

## Build

- [x] `npm run build` berhasil (0 error, 0 warning)
- [x] `npm run lint` (tsc --noEmit) — sudah termasuk dalam build

## File yang Diubah

| File | Perubahan |
| ---- | --------- |
| `src/config/navigation.ts` | **NEW** — Reusable nav config; Kategori pindah dari profileMenuNav ke moreMenuNav |
| `src/components/layout/BottomNav.tsx` | **MODIFIED** — 4 NavLinks + Lainnya button dengan active state untuk moreMenuNav routes |
| `src/components/layout/ProfileDropdown.tsx` | **MODIFIED** — Otomatis update (Profil, Pengaturan tanpa Kategori) |
| `src/components/layout/Header.tsx` | **MODIFIED** — ProfileDropdown menggantikan simple avatar |

## Final Status

- Mobile Navigation: ✅ OK
- Profile Dropdown: ✅ OK
- Gmail Sync Access: ✅ OK (bottom nav item ke-4)
- Category Access: ✅ OK (Lainnya sheet — item ke-4)
- Build: ✅ OK (0 error, 0 warning)
