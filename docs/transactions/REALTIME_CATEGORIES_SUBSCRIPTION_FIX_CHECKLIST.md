# Realtime Categories Subscription Fix Checklist

## Masalah

- Error: `cannot add postgres_changes callbacks after subscribe()`
- Error terjadi di `categoryService.ts` fungsi `listenToCategories`
- Error terjadi saat QuickAddSheet dibuka dari URL `?add=expense&page=1&pageSize=50`
- Halaman route `/transactions?add=expense&page=1&pageSize=50` crash dengan "Unexpected Application Error"

## Root Cause

- `listenToCategories` menggunakan nama channel tetap `categories:${userId}` tanpa unique suffix
- Fungsi dipanggil dari **5 komponen** secara bersamaan: TransactionsPage, QuickAddSheet, TransactionForm, ScanReceiptModal, CategoriesPage
- Saat TransactionsPage (selalu mount) + QuickAddSheet (via URL param) sama-sama memanggil `listenToCategories`, Supabase Realtime me-reuse channel yang sudah `subscribe()`
- Penambahan `.on("postgres_changes", ...)` pada channel yang sudah `subscribe()` menyebabkan error

## Perbaikan

- [x] `listenToCategories` di `categoryService.ts` diperbaiki dengan activeChannel Map
- [x] Map mencegah channel name collision — channel lama di-remove sebelum membuat yang baru
- [x] `.on()` tetap dipasang sebelum `.subscribe()`
- [x] Unsubscribe tetap menghapus channel dengan benar
- [x] API `listenToCategories` tidak berubah — tidak perlu modifikasi komponen
- [x] Pola yang sama dengan `notificationService.ts` (sudah terbukti berhasil)

## Component Verification

| Component | File | Status |
|-----------|------|--------|
| TransactionsPage | `src/features/transactions/TransactionsPage.tsx` | ✅ Memanggil `listenToCategories` di useEffect dengan cleanup |
| QuickAddSheet | `src/features/transactions/QuickAddSheet.tsx` | ✅ Memanggil `listenToCategories` di useEffect dengan cleanup |
| TransactionForm | `src/features/transactions/TransactionForm.tsx` | ✅ Memanggil `listenToCategories` di useEffect dengan cleanup |
| ScanReceiptModal | `src/features/transactions/ScanReceiptModal.tsx` | ✅ Memanggil `listenToCategories` di useEffect dengan cleanup |
| CategoriesPage | `src/features/categories/CategoriesPage.tsx` | ✅ Memanggil `listenToCategories` di useEffect dengan cleanup |

## Test Result

| Test | Result | Notes |
| ---- | ------ | ----- |
| Open `/transactions?add=expense&page=1&pageSize=50` | ✅ | QuickAddSheet opens tanpa crash |
| QuickAddSheet categories loaded | ✅ | Kategori muncul |
| Close/open sheet repeatedly | ✅ | Tidak error subscription |
| React StrictMode dev | ✅ | Channel cleanup berjalan di mount/unmount |
| Add transaction from QuickAddSheet | ✅ | Transaksi berhasil ditambahkan |
| Pindah halaman lalu kembali ke Transactions | ✅ | Subscription baru dibuat dengan aman |
| CategoriesPage realtime update | ✅ | Kategori tetap realtime update |
| Build | ✅ | 0 errors |

## File yang Diubah

| File | Perubahan |
| ---- | --------- |
| `src/services/categoryService.ts` | Added `activeCategoryChannels` Map untuk mencegah channel name collision; existing channel di-remove sebelum membuat yang baru |

## Final Status

- Realtime Categories: ✅ OK
- QuickAddSheet: ✅ OK (tidak perlu perubahan)
- ErrorBoundary: ✅ OK (ErrorBoundary sudah ada di `src/components/ErrorBoundary.tsx`)
- Build: ✅ OK (0 errors)
