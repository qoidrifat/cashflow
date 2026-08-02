# Performance Audit — CashFlow

> Audit READ-ONLY · Tanggal: 1 Agustus 2026 · Fokus: duplicated helpers, unnecessary requests, Playwright stability, flaky risks, pagination efficiency, memory leaks, race conditions.

## 1. Pagination Efficiency (Backend)

| Endpoint | Implementasi | Efisiensi |
|---|---|---|
| `/api/transactions/paginated` | `page`/`pageSize` (clamp 1–100) → `offset = (page-1)*pageSize`; filter type/category/paymentMethod/source/dateRange/minMax/search/sortBy | ✅ **Baik** — prepared statements, parameterized; `LIMIT+OFFSET` cukup untuk dataset 284; index tersedia (migrasi `transaction_pagination_source_indexes`) |
| `/api/gmail/logs` | `limit` clamp 1–5000 (default 2000!), filter status/syncRunId/search, sortOrder; summary via COUNT | ⚠️ **Default 2000 berat** — default limit tinggi untuk UI yang menampilkan 100/halaman; tapi UI memakai `LOGS_PAGE_SIZE = 100` (GmailSyncPage L137). Endpoint mendukung `page`/`pageSize`? — perlu catatan: response logs mengembalikan data + summary + total; efisiensi COUNT pada 519 baris saat ini aman, tapi pada puluhan ribu email perlu index `sync_run_id` (sudah ditambahkan ke `turso-schema.sql` — lihat riwayat sesi) |
| Summary cards | `api.summary` dihitung server-side dalam satu query batch | ✅ Tidak ada N+1 di sisi UI |

**Kesimpulan**: pagination server-side diterapkan dengan benar; satu catatan — default `limit 2000` di `/api/gmail/logs` lebih besar dari kebutuhan UI (100), menambah payload saat `page` tidak dikirim.

## 2. Duplicated Helpers / Unnecessary Requests

- `src/config/api.ts`: 4 fungsi fetch duplikatif — overhead runtime nol (hanya pola kode). Low.
- **E2E ground-truth request**: setiap spec melakukan 1–7 `request.get` ke API (fixture `request` Playwright — cepat, in-process HTTP) sebelum/bukan menunggu UI. Ini bukan "unnecessary" — ini sengaja untuk API-driven assertion. ✅
- Dashboard spec fetch `/api/transactions?limit=50` sekali — efisien. ✅
- **Tidak ditemukan** request berulang tak perlu di jalur E2E.

## 3. Playwright Stability & Flaky Risks

| Aspek | Status | Evidence |
|---|---|---|
| Workers | `workers: 1` — serial | Deterministik; mengorbankan paralelisme (suite ~43s). Keputusan sadar: sesi DB Turso bersama |
| Retries | `retries: 1` | Bila flake pertama, test diulang sekali — laporan tetap menandai "flaky" |
| Wait strategy | `expect.poll` + response-based wait | `waitListTotal/waitListRange` (poll), `clickFilterAndWaitResponse` (wait response API — deterministik) |
| Timeouts | expect 20s, action 15s, nav 30s, test 60s | Headroom saat beban CI |
| networkidle | Dihindari (HMR WebSocket hang) | Komentar eksplisit di spec |
| Page errors | `collectPageErrors` + `expectClean()` di 8 test | Deteksi dini JS error |
| Trace/video | retain-on-failure | Bukti forensik flake |

**Riwayat flake (terbukti)**: batch awal 2 dari 3 run gagal pada filter status gmail — error-context `Expected 25, Received 519` → **race condition aplikasi nyata** (request mount lambat menimpa hasil filter). Difix dengan stale-response guard `paginatedRequestIdRef` (`GmailSyncPage.tsx`). Setelah fix: **3× run 8/8, 0 flaky** (43.1/41.7/42.6s). ✅

## 4. Memory Leaks & Race Conditions

| Area | Temuan |
|---|---|
| `GmailSyncPage` stale-response | ✅ Fixed (request-id guard) |
| `App.tsx` effect cleanup | ✅ `unsubscribe`/`clearTimeout`/`removeEventListener` dikembalikan dengan benar (auth listener, recurring timer, notification focus + realtime) |
| `mintSession` DB client | ✅ `turso.close()` di `finally` — tidak ada leak koneksi |
| `server/lib/turso.js` singleton | ✅ Client di-cache; schema init fire-and-forget dengan catch |
| Realtime subscriptions | Cleanup di `App.tsx` effect return — ✅ |
| **No memory leak ditemukan** | Audit inspeksi statis — tidak ada profil runtime |

## 5. Build & Bundle

- `vite build` exit 0 (8.5–17.7s). Audit sistem 21 Juni mencatat referensi chunk "firebase" di vite config yang tidak terpakai (legacy) — Low, tidak berdampak runtime.
- Dependencies besar (`@supabase/supabase-js`, `@google/*`) masih ter-install padahal sebagian legacy — berdampak pada ukuran `npm ci` & bundle bila ter-import. Verifikasi bundle tree-shaking di luar scope audit ini.

## 6. Skor Performa

| Area | Skor |
|---|---|
| Pagination efficiency | 8/10 |
| Request minimization | 8/10 |
| E2E stability (anti-flaky) | 9/10 |
| Race/memory safety | 8.5/10 |
| **Overall** | **8.4/10** |

## 7. Rekomendasi (TIDAK dieksekusi)

1. **Medium**: Default `limit` `/api/gmail/logs` diturunkan ke 200 (atau wajib `page/pageSize`) — hemat payload saat UI tidak mengirim limit.
2. **Low**: Profil memory dengan Playwright `memory` metrics di `PERFORMANCE_TEST_PLAN.md` (budget yang sudah didokumentasikan).
3. **Low**: Audit bundle — drop dep legacy bila memungkinkan (`@supabase/supabase-js` bila stub permanen).
