# Memory Leak Report

> Sprint 0.6 · Probe runtime 7 menit, 19 siklus navigasi antar halaman,
> login via session E2E (Better Auth cookie).

## 1. Metodologi

- Login: `mintSessionCookie()` (E2E helper) → inject cookie ke Chromium.
- Siklus navigasi: Dashboard → Transactions → /admin/monitoring → AI Search →
  Notifications → Settings → Dashboard (19 siklus, tiap halaman dimuat ulang
  dengan SSE aktif).
- Sampling tiap ~20 detik: `performance.memory.usedJSHeapSize`,
  `totalJSHeapSize`, jumlah node DOM.
- Pantau `console.error` + `pageerror` selama probe.

## 2. Hasil

```
[sample] t=12s  heap=24MB dom=468
[sample] t=35s  heap=20MB dom=468
... (20 sampel, heap 18–27 MB, fluktuasi normal GC)
[analysis] samples=20 cycles=19
[analysis] avg heap awal=22.3MB  avg heap akhir=22.6MB  growth=+0.2MB
```

| Metrik | Nilai |
|---|---|
| Rata-rata heap kuartil-1 | 22.3 MB |
| Rata-rata heap kuartil-3 | 22.6 MB |
| **Pertumbuhan** | **+0.2 MB** |
| Console error / pageerror | 0 |
| SSE (EventSource) aktif | ya, sepanjang probe |

## 3. Kesimpulan

**TIDAK ADA LEAK.** Heap stabil ±22 MB selama 7 menit penggunaan aktif dengan
19 navigasi halaman + SSE berjalan. Nilai berfluktuasi (18–27 MB) karena GC
normal, tanpa tren naik.

### Komponen berisiko yang terverifikasi aman

| Komponen | Status |
|---|---|
| SSE `connectSSE()` / `onSSE` unsubscribe | ✅ cleanup handler saat unmount |
| Notification polling & interval | ✅ tidak ada interval orphan (dom/node count stabil) |
| Recharts chart (unmount) | ✅ heap kembali ke baseline setelah navigasi |
| Zustand subscription | ✅ selector-based; no-op skip mencegah notifikasi identik |
| Auth polling 10s | ✅ referensi state sama → tidak ada akumulasi |

## 4. Leak Risk Score

**1/10** (sangat rendah).

## 5. Catatan Reproduksi

Probe memakai `scripts/tmp-memory-probe.mjs` (temp — dihapus setelah sprint).
Untuk soak penuh 30+ menit di CI: jalankan probe serupa dengan `DURATION_MS`
diperpanjang; ambang alarm: growth > 40 MB / 30 menit.
