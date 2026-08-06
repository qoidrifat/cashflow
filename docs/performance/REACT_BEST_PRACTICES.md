# React Best Practices

> Standar pengembangan komponen React di CashFlow — Sprint 0.6.

## 1. State Management (Zustand)

- **Selalu selector-based.** Dilarang `useAuthStore()`, `useAppStore()` tanpa
  selector — guard test `storeSubscriptionGuard.test.ts` akan gagal.
- **Multi-field wajib `useShallow`** dari `zustand/react/shallow`.
- Aksi (fungsi) dipilih langsung — referensi stabil, tidak re-render.
- **Jangan mutate state di luar store.** Semua perubahan via action store.

## 2. Memoization

Gunakan hanya bila ada bukti/alasannya:

| Teknik | Kapan dipakai | Kapan TIDAK dipakai |
|---|---|---|
| `React.memo` | Child tanpa props (NotificationBell, ProfileDropdown), item list (TransactionItem) | Child yang selalu berubah |
| `useMemo` | Perhitungan mahal / object untuk props memo child | Hanya "biar terlihat optimal" — tolak |
| `useCallback` | Callback menjadi props child memo | Callback tidak pernah jadi props |

Aturan: **jika optimasi menambah kompleksitas tanpa manfaat terukur, jangan
implementasikan** — dokumentasikan alasannya.

## 3. Code Splitting

- Halaman baru: daftarkan via `React.lazy(() => import(...))` di
  `src/app/router.tsx` + bungkus route dengan `Suspense` (pola sudah ada).
- Jangan static-import recharts/framer-motion di entry kecuali wajib.
- Guard test memastikan entry tidak static-import vendor-charts.

## 4. Effects & Cleanup

- Setiap `useEffect` yang subscribe/membuka koneksi (SSE, polling, interval,
  observer) WAJIB mengembalikan cleanup.
- Hindari dependency array berlebihan — hanya yang benar-benar dipakai.
- Jangan polling auth/session di komponen; pakai `useAuthStore` yang sudah
  handle (no-op skip mencegah cascade).

## 5. Anti-Pattern (dilarang)

```tsx
// ❌ full subscription
const { authUser } = useAuthStore();

// ❌ object selector tanpa useShallow
const { a, b } = useAuthStore((s) => ({ a: s.a, b: s.b }));

// ❌ inline arrow tanpa stabilisasi untuk props memo child (bila child memo)
<TransactionItem onClick={() => setSelected(t)} />

// ❌ useEffect tanpa cleanup untuk interval/subscribe
useEffect(() => { setInterval(...); }, []); // interval orphan!

// ❌ static import halaman besar di entry
import GmailSyncPage from './GmailSyncPage'; // pakai lazy()
```

## 6. Performance Checklist (sebelum merge)

- [ ] `npm run typecheck` hijau
- [ ] `npm run lint` hijau
- [ ] `npx vitest run` hijau (termasuk guard)
- [ ] Tidak ada console.log / debugger
- [ ] Tidak ada full subscription baru
- [ ] Tidak ada artefak investigasi (renderTracker, debug import)
- [ ] Bila UI berubah: `npx playwright test` subset + visual check

## 7. Referensi

- `docs/performance/RENDER_ISOLATION.md` — bukti before/after
- `docs/performance/STATE_SUBSCRIPTION_GUIDE.md` — panduan subscription
- `docs/performance/PERFORMANCE_BASELINE.md` — angka baseline terukur
