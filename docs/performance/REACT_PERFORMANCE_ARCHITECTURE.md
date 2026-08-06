# React Performance Architecture

> Sprint 0.6 — Production Baseline · Status: **Approved**
> Owner: Frontend Platform · Last Updated: 2026-08-06

## 1. Prinsip

CashFlow menerapkan **Evidence-First Engineering** untuk seluruh keputusan
performa. Tidak ada optimasi tanpa bukti runtime (React Profiler / capture
terukur) atau regression guard yang mencegah kemunduran.

Aturan kunci:

| Aturan | Keterangan |
|---|---|
| Minimal Fix | Ubah sesedikit mungkin, tidak pernah rewrite besar |
| No Over-Engineering | Optimasi tanpa manfaat nyata = ditolak & didokumentasikan |
| No Premature Optimization | Profiling dulu, optimasi kemudian |
| Backward Compatible | Perilaku aplikasi tidak berubah |
| Regression Guard | Setiap pola performa dilindungi test statis/runtime |

## 2. Arsitektur Render

```
App
├── AppLayout (selector-based, tidak ikut render saat store lain berubah)
│   ├── Header
│   │   ├── NotificationBell (memo)
│   │   └── ProfileDropdown (memo)
│   ├── Sidebar
│   └── <Outlet/> → halaman (semua lazy() via router)
└── Store subscription: SEMUA selector-based (useShallow untuk multi-slice)
```

### Pilar render isolation

1. **Selector-based subscription** — tidak ada satu pun `useAuthStore()` /
   `useAppStore()` tanpa selector (guard test memastikan 0).
2. **useShallow untuk multi-slice** — object selector memakai
   `useShallow` agar referensi hasil dibandingkan shallow (Object.is per field),
   bukan referensi object baru setiap render.
3. **Memo pada child tanpa props** — `NotificationBell` & `ProfileDropdown`
   dibungkus `memo()` sehingga parent (Header) re-render tidak menembus.
4. **No-op skip di store** — `useAuthStore.set()` mengembalikan referensi state
   yang sama saat nilai identik (polling auth 10s tidak lagi me-render tree).
5. **Lazy loading seluruh halaman** — `React.lazy` + `Suspense` di router;
   chunk per halaman terpisah dari entry.

## 3. Skor Arsitektur (hasil audit)

| Aspek | Skor /10 |
|---|---|
| React Architecture | 9.0 |
| React Performance | 9.0 |
| Render Isolation | 9.5 |
| Maintainability | 9.0 |
| Scalability | 8.5 |
| Production Readiness | 9.0 |

## 4. Bukti

- Build produksi: `npm run build` sukses (chunk entry 102 kB, vendor-react 334 kB).
- Unit: 471/471 · Typecheck ✓ · Lint ✓.
- Memory probe 7 menit: heap growth **0.2 MB** (no leak).
- Lighthouse: A11Y 100 · BEST 100 · SEO 100 (PERF 78-83 di preview lokal
  tanpa gzip — lihat LIGHTHOUSE_REPORT.md).

## 5. Developer Checklist

Sebelum commit komponen baru:

- [ ] Tidak ada `useAuthStore()` / `useAppStore()` tanpa selector
- [ ] Object selector memakai `useShallow`
- [ ] Aksi store (fungsi) dipilih langsung, bukan seluruh store
- [ ] Child statis tanpa props dibungkus `memo()`
- [ ] Tidak ada `console.log` / debugger / instrumentasi investigasi
- [ ] Jalankan `npm run typecheck` + `npm run lint` + `npx vitest run`
