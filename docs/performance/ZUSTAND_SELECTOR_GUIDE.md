# Zustand Selector Guide

> Referensi cepat selector store CashFlow — versi ringkas dari STATE_SUBSCRIPTION_GUIDE.

## Store yang Ada

| Store | Isi Utama | Catatan |
|---|---|---|
| `useAuthStore` | authUser, isAuthenticated, isLoading, error, login, logout | Polling 10s → pakai no-op skip |
| `useAppStore` | addToast, addNotification, gmailSyncEnabled, theme | Mutasi frequent |
| `useSessionExpiryStore` | dialog session expiry | Sparse |

## Anti-Pattern (DILARANG)

1. `useAuthStore()` — full subscription.
2. Selector object tanpa `useShallow`:
   ```ts
   useAuthStore((s) => ({ a: s.a })) // ❌ new object setiap render → loop?
   ```
   `useSyncExternalStore` menangani ini dengan equalityFn — tetapi tanpa
   `useShallow`, hasilnya dibandingkan dengan Object.is → **selalu re-render**.
3. Selector memanggil fungsi non-stabil / inline array — hasil baru tiap render.

## Pola yang Disetujui

```ts
// single
const authUser = useAuthStore((s) => s.authUser);

// multi (stabil)
const { isAuthenticated, logout } = useAuthStore(
  useShallow((s) => ({ isAuthenticated: s.isAuthenticated, logout: s.logout }))
);
```

## Mengapa useShallow diperlukan

`useSyncExternalStore` memanggil selector pada setiap render dan membandingkan
hasil dengan `equalityFn` (default `Object.is`). Object baru → dianggap berubah
→ render tak berujung/boros. `useShallow` membungkus selector dengan perbandingan
shallow per-field sehingga object dengan nilai sama dianggap sama.

## Guard Test

`tests/unit/storeSubscriptionGuard.test.ts` men-scan `src/` dan gagal bila:
- ditemukan `useAuthStore()`, `useAppStore()`, `useSessionExpiryStore()` (full)
- ditemukan object-literal selector tanpa `useShallow`

Ini memastikan standar tidak bisa dilanggar tanpa disadari.
