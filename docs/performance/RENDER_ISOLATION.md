# Render Isolation

> Sprint 0.6 — Bukti runtime: 1 toggle theme hanya me-render konsumen theme.

## 1. Masalah Sebelumnya (Root Cause)

Polling sesi Better Auth (`onAuthStateChanged`, interval 10 detik) memanggil
`set()` dengan **nilai identik** — tetapi Zustand tetap membuat **objek state
baru**, sehingga komponen yang subscribe seluruh store (`useAuthStore()` tanpa
selector) ikut re-render → cascade ke seluruh tree → halaman `/admin/monitoring`
terlihat "auto refresh" setiap 10 detik.

## 2. Evidence Sebelum Fix (Runtime Capture, 35s, /admin/monitoring)

```
04:04:08.084  [RENDER] App #8 → AuthGuard #8 → Sidebar #12 → MonitoringPage #10
04:04:18.091  [RENDER] App #10 (10006ms) → MonitoringPage #12 (10005ms)  ← persis 10.0s
04:04:28.397  [RENDER] App #12 (10305ms) → MonitoringPage #14
04:04:38.394  [RENDER] App #14 (9996ms)  → MonitoringPage #16
```

| Komponen | Sebelum | Sesudah | Delta |
|---|---|---|---|
| App | 15 | 5 | −67% |
| MonitoringPage | 17 | 9 | −47% (tanpa interval 10s) |
| Sidebar | 19 | 9 | −53% |
| Header / NotificationBell | 15 | 11 | −27% |

## 3. Evidence Sesudah Fix (Toggle Theme = Mutasi Legitimate)

Skenario: login admin → buka `/admin/monitoring` → toggle theme 2×.

| Komponen | Sebelum (1 toggle) | Sesudah (1 toggle) |
|---|---|---|
| App | +4 | +1 (konsumen theme — sah) |
| AppLayout | +4 | **0** |
| Sidebar | +4 | **0** |
| Header | +4 | +1 (ikon theme — sah) |
| NotificationBell | +4 | **0** |
| MonitoringPage | +4 | **0** |

**Hasil**: 20 render terbuang per toggle → **0 render terbuang**. Layout &
halaman terisolasi penuh dari mutasi yang tidak relevan.

## 4. Mekanisme Isolasi

```ts
// 1 slice — primitif/objek tunggal: pilih field spesifik
const authUser = useAuthStore((s) => s.authUser);

// multi-slice — WAJIB useShallow (tanpa ini selector object baru tiap render)
const { isAuthenticated, isLoading } = useAuthStore(
  useShallow((s) => ({ isAuthenticated: s.isAuthenticated, isLoading: s.isLoading }))
);

// aksi store — pilih fungsi langsung (referensi stabil)
const { addToast } = useAppStore((s) => ({ addToast: s.addToast }));
```

No-op skip di store (anti polling-cascade):

```ts
set((state) => {
  if (state.authUser === user && state.isAuthenticated === !!user && ...) {
    return state; // referensi sama → Zustand melewatkan notifikasi (Object.is)
  }
  return { authUser: user, isAuthenticated: !!user, isLoading: false, error: null };
});
```

## 5. Regression Guard

`tests/unit/storeSubscriptionGuard.test.ts` — static scan `src/`:

- 0 full subscription `useAuthStore()` / `useAppStore()` / `useSessionExpiryStore()`
- object selector tanpa `useShallow` = gagal

Jika guard ini lulus, render isolation tidak bisa mundur tanpa disadari.
