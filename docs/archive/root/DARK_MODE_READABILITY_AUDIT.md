# Audit Keterbacaan Dark Mode CashFlow

Tanggal audit: 19 Juni 2026

## Tujuan

Memastikan teks, widget, input, modal, navigasi, chart, dan status interaktif tetap terbaca ketika aplikasi beralih ke dark-mode. Fokus perbaikan diarahkan ke tampilan profesional, modern, minimalis, elegan, dan ringan untuk pengguna Gen Z tanpa mengubah alur bisnis aplikasi.

## Temuan Utama

1. Beberapa teks sekunder memakai `dark:text-gray-400` atau `dark:text-gray-500`, sehingga terlalu redup di atas permukaan navy gelap.
2. Banyak surface lama memakai `dark:bg-navy-800` atau `dark:bg-navy-900` yang menyatu dengan background global.
3. Divider dan border memakai warna navy gelap sehingga pemisahan antar item sulit terlihat.
4. Toggle nonaktif, filter chip, button outline, dan icon action belum memiliki kontras hover yang konsisten.
5. Tooltip chart masih memakai permukaan putih, terasa kontras berlebihan dan kurang menyatu di dark-mode.
6. Form input/select pada Profile, Settings, Categories, dan Transaction masih berisiko terlihat datar di dark-mode.
7. Login, loading auth, not-found, dan area kecil Gmail Sync masih memakai token dark lama sehingga pengalaman awal belum konsisten.
8. Theme switching belum memiliki bootstrap awal sebelum React render, sehingga berisiko flash light-mode sebelum dark-mode aktif.
9. Mode `system` belum ikut berubah ketika preferensi OS berubah saat aplikasi sedang terbuka.
10. Beberapa komponen memakai warna hardcoded per file, sehingga dark-mode sulit dijaga konsisten.

## Perbaikan Yang Dilakukan

1. Global dark-mode dibuat lebih nyaman dengan surface transparan, border `white-alpha`, dan scrollbar dark yang valid.
2. Layout utama diperbaiki: Header, Sidebar, BottomNav, Card, Modal, Toast, Skeleton, EmptyState, StatCard, dan TransactionItem.
3. Halaman utama diperbaiki: Dashboard, Transactions, Gmail Sync, Reports, Budgets, Profile, Settings, Categories, Privacy, Login, AuthGuard, dan NotFound.
4. Teks heading menggunakan `dark:text-slate-50`; teks pendukung menggunakan `dark:text-slate-300` atau `dark:text-slate-400`.
5. Border, divider, ring, dan hover state dipindahkan ke `white/[alpha]` agar tetap terlihat tanpa terasa kasar.
6. Tooltip chart dibuat dark glass agar konsisten dengan UI.
7. Toggle dan segmented controls mendapat off-state yang lebih jelas.
8. Class Tailwind opacity non-standar seperti `white/8`, `white/12`, dan `white/18` dibersihkan ke format arbitrary opacity yang valid.
9. Theme system dipusatkan di `src/lib/theme.ts` untuk `getStoredTheme`, `resolveTheme`, dan `applyTheme`.
10. `index.html` diberi bootstrap theme awal agar class `dark` aktif sebelum React mount.
11. `App.tsx` menjaga mode `system` tetap sinkron dengan perubahan OS preference.
12. Tailwind diberi token semantik `app-bg`, `app-surface`, `app-elevated`, `app-border`, `app-text`, `app-muted`, `app-subtle`, dan `app-hover`.
13. Global CSS diberi utility `app-surface`, `app-elevated`, `app-field`, `app-icon-button`, `app-overlay`, dan chart CSS variables.

## Area Yang Disisir

- `src/styles/globals.css`
- `src/lib/theme.ts`
- `tailwind.config.js`
- `index.html`
- `src/app/App.tsx`
- `src/components/layout/*`
- `src/components/ui/*`
- `src/features/auth/*`
- `src/features/dashboard/DashboardPage.tsx`
- `src/features/transactions/*`
- `src/features/gmail/GmailSyncPage.tsx`
- `src/features/reports/ReportsPage.tsx`
- `src/features/budgets/BudgetsPage.tsx`
- `src/features/profile/ProfilePage.tsx`
- `src/features/settings/SettingsPage.tsx`
- `src/features/categories/CategoriesPage.tsx`
- `src/features/privacy/PrivacyPage.tsx`
- `src/pages/NotFoundPage.tsx`

## Verifikasi

Perintah yang dijalankan:

```bash
npm run lint
npm run build
```

Hasil:

- TypeScript berhasil.
- Vite production build berhasil.
- Tidak ada error Tailwind/class invalid setelah auto-fix.
- Server lokal merespons HTTP 200 di `http://127.0.0.1:5180`.
- Tersisa warning ukuran chunk Vite di atas 500 kB. Ini bukan error dark-mode, tetapi bisa dioptimalkan terpisah dengan code splitting.

## Catatan Lanjutan

Jika ingin kualitas visual dinaikkan lagi, tahap berikutnya adalah QA visual via browser untuk membandingkan screenshot mobile dan desktop pada mode terang dan gelap.
