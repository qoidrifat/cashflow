# State Subscription Guide

> Pedoman WAJIB saat memakai Zustand store di CashFlow.

## 1. Mengapa

Zustand v5 me-notifikasi subscriber setiap kali `set()` dipanggil — **bahkan
saat nilai identik** (kecuali referensi state dikembalikan sama). Subscribe
seluruh store berarti komponen Anda re-render pada **setiap mutasi store
tersebut**, termasuk yang tidak Anda butuhkan.

CashFlow memakai polling auth 10 detik + SSE + polling metrics — tanpa
isolasi, tree besar bisa re-render puluhan kali per menit.

## 2. Pola BENAR

```ts
// ✅ 1 field
const authUser = useAuthStore((s) => s.authUser);

// ✅ beberapa field → useShallow (import dari 'zustand/react/shallow')
const { isAuthenticated, isLoading } = useAuthStore(
  useShallow((s) => ({ isAuthenticated: s.isAuthenticated, isLoading: s.isLoading }))
);

// ✅ aksi store (fungsi) — pilih langsung, referensi stabil
const login = useAuthStore((s) => s.login);
const { addToast } = useAppStore((s) => ({ addToast: s.addToast }));
```

## 3. Pola SALAH (dilarang)

```ts
// ❌ subscribe seluruh store — re-render tiap mutasi
const store = useAuthStore();
const { authUser } = useAuthStore();
const auth = useAppStore();

// ❌ object selector tanpa useShallow — object baru tiap render
const { a, b } = useAuthStore((s) => ({ a: s.a, b: s.b }));
```

## 4. Kapan pakai apa

| Kebutuhan | Pola |
|---|---|
| 1 field primitif/objek | `useStore((s) => s.field)` |
| 2+ field | `useStore(useShallow((s) => ({ ... })))` |
| Fungsi aksi | `useStore((s) => s.action)` |
| Semua field (sangat jarang) | `useStore()` — perlu alasan tertulis |

## 5. useShallow vs useShallow + fungsi

Selector `useShallow((s) => ({...}))` membandingkan hasil secara **shallow
(Object.is per field)**. Fungsi dari store adalah referensi stabil (didefinisikan
sekali di `create`), jadi memilihnya aman dan tidak menyebabkan re-render.

## 6. Verifikasi

- `npx vitest run tests/unit/storeSubscriptionGuard.test.ts` — guard statis
- Profiling: `scripts/` capture — buka halaman, mutasi store, pastikan hanya
  konsumen field yang re-render.
