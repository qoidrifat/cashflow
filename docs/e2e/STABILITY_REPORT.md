# Stability Report — CashFlow E2E

> Quality gate: suite E2E dijalankan 3× berurutan → **0 flaky failures** (kriteria sukses enterprise).
> Tanggal: 3 Agustus 2026 · Branch: `gh-pages` · Playwright (Chromium) · workers: 1

## Hasil Final (2026-08-03 — setelah gate SSE + coverage review lengkap, 38 test / 13 spec)

| Run | Hasil | Waktu | Flaky/Failed |
|---|---|---|---|
| 1 | **38 passed** | 2.8m | 0 |
| 2 | **38 passed** | 2.7m | 0 |
| 3 | **38 passed** | 2.8m | 0 |

**Verdict: ✅ 0 flaky dalam 3× run berurutan — kriteria stabilitas terpenuhi.**

Rincian per spec (38 test): contract-check 9 (API contract) · notifications-realtime 4 (approve/reject/duplicate/amount-missing) · transactions 3 · gmail-sync 3 · core-pages 3 (budgets/reports/notifications) · agent-search-auth 3 · admin-metrics-auth 3 · admin-cache 3 · dashboard 2 · gmail-review-approve 1 · gmail-review-reject 1 · gmail-review-duplicate 1 · gmail-review-amount-missing 1 · rate-limit 1.

### Stabilisasi SSE (gate deterministik — apa yang berubah sejak baseline 17 test)

1. **`waitRealtimeConnected`** (kini di `e2e/helpers/realtime.ts`) — gate SSE deterministik: tunggu ikon WifiOff hilang (`realtimeConnected === true`) SEBELUM aksi approve/reject/duplicate/amount-missing di `notifications-realtime.spec.ts`. SSE lambat connect tidak lagi membuat push terlewat → menuitem tidak muncul → flake. Audit (2026-08-03) mengonfirmasi **hanya spec SSE-push-UI yang butuh gate ini** — spec review yang meng-assert state server via `expect.poll` API tidak (sudah deterministik bawaan).
2. **Coverage realtime diperluas ke 4/4 hasil review** (approve → success, reject → info, duplicate → warning, amount-missing → error) — tiap test punya `pageErrors.expectClean()`.
3. Refactor helper (d0d12aa) + relokasi `realtime.ts` (3f5168f) tidak mengubah perilaku — hanya pemusatan logika.

> Baseline sebelumnya (2026-08-02): 17 test / 6 spec — 17/17 × 3 (1.0m/57.5s/59.9s) 0 flaky. Era 8 test: 8/8 × 3 (43.1/41.7/42.6s) 0 flaky; pasca-audit 14 test: 14/14 × 3. Angka di atas adalah **baseline terbaru** (38 test) setelah gate SSE + 4 spec review + notifikasi realtime + rate-limit + admin-cache.

---

## Riwayat Flake Terbaru (2026-08-02) — fix `authMiddleware` (P0)

### Gejala

Setelah spec `admin-metrics-auth.spec.ts` ditambahkan, full suite menunjukkan **4 flaky**:
admin-metrics-auth test (c) "dengan cookie admin → 200" · agent-search-auth test 3 · gmail-sync test 1 & 2. Error-context: `Expected: 200, Received: 401` pada `/api/admin/metrics/alerts` — **cookie admin valid, 5 endpoint sebelumnya lolos, endpoint terakhir 401**.

### Root cause

`server/middleware/authMiddleware.js` menelan **SEMUA error** `auth.api.getSession` di try/catch kosong → `req.user = null` → resolveAdmin/requireAuth melempar **401 transient** saat blip koneksi Turso (DB error disamarkan sebagai "belum login").

### Fix

Pisahkan dua kondisi:
- **(a)** `getSession()` mengembalikan `null` (cookie tidak ada/tidak valid) → `req.user = null` → 401 **benar**.
- **(b)** `getSession()` **throw** (error DB) → retry sekali (150ms); bila masih gagal → `next(error)` → Express error handler → **500 jujur** (bukan 401 palsu).

Diverifikasi: `node --check` OK · health 200 · admin/agent-search tanpa cookie = 401 · sync-docs publik = 200 (anon tetap aman) · **3× run 14/14 — 0 flaky** (saat itu; kini 17/17 setelah P1).

---

## Hasil Final (era awal — setelah perbaikan race, 8 test)

| Run | Hasil | Waktu | Flaky/Failed |
|---|---|---|---|
| 1 | **8 passed** | 43.1s | 0 |
| 2 | **8 passed** | 41.7s | 0 |
| 3 | **8 passed** | 42.6s | 0 |

**Verdict: ✅ 0 flaky dalam 3× run berurutan — kriteria stabilitas terpenuhi.**

Rincian per spec (8 test): dashboard 2 · gmail-sync 3 · transactions 3.

---

## Riwayat Investigasi Flake (bukti → akar masalah → fix)

### 1. Flake terdeteksi di batch awal

```
RUN 1: 8 passed (39.7s)
RUN 2: 1 flaky   (58.9s)   ← gmail-sync "filter status"
RUN 3: 1 flaky   (59.3s)   ← gmail-sync "filter status"
```

- Isolasi spec gmail **4× lulus penuh** (19s/run) → flake hanya muncul di konteks suite penuh.
- Korelasi beban: run lambat terjadi saat basher lain (build/lint) berjalan paralel → **hypothesis: response race di aplikasi, bukan test**.

### 2. Bukti error-context (kunci)

```
Expected: 25, Received: 519
Call Log: Timeout 20000ms exceeded while waiting on the predicate
```

Artinya: `waitForResponse` **berhasil** mencocokkan response `status=needs_review` (total 25 benar), tapi **DOM counter tetap 519** selama 20s → ada request lain yang menimpa state setelahnya.

### 3. Root cause — race condition nyata di aplikasi

`src/features/gmail/GmailSyncPage.tsx` — `loadPaginatedResults` **tanpa proteksi stale-response**:

1. Mount → request `status=null` (semua, lambat) in-flight
2. User/test klik "Perlu Review" → request `status=needs_review` (cepat) selesai → DOM tampil 25
3. Request mount yang lambat selesai **terakhir** → menimpa `paginatedLogs` kembali ke **519**

Ini **bug yang terlihat user** (klik filter tapi list kembali ke semua), bukan sekadar flake test.

### 4. Fix aplikasi (AUTO FIX POLICY: race condition)

- `const paginatedRequestIdRef = useRef(0)` di dekat state pagination
- Setiap panggilan `loadPaginatedResults` → `requestId = ++paginatedRequestIdRef.current`
- Setelah `await`: **early-return bila `requestId !== paginatedRequestIdRef.current`** sebelum menulis `setPaginatedLogs` / `setLogsCurrentPage` / `setEmails` / error / loading
- Hasil: hanya request **terbaru** yang boleh commit state

Uji edge-case oleh code reviewer (dua sesi review):

| Skenario | Hasil |
|---|---|
| Terbaru settle duluan, stale resolve belakangan | ✅ stale tidak commit, loading benar |
| Stale resolve duluan, terbaru settle | ✅ hanya terbaru commit |
| Klik filter cepat 3× | ✅ hanya request ke-3 commit |
| Loading flag | ✅ hanya request terbaru yang clear loading (edge "newest hangs" = failure jaringan asli, acceptable) |
| Varian in-flight counter | ❌ ditolak review — tidak memperbaiki edge & menambah regresi stale-hang → **di-revert** |

### 5. Hardening test (AUTO FIX POLICY: flaky waits, timeout misuse)

- `e2e/helpers/errors.ts` (baru) — `collectPageErrors(page)` → dedup boilerplate `page.on('pageerror')` di 8 test
- `e2e/gmail-sync.spec.ts` — `clickFilterAndWaitResponse()`: **wait berbasis response API** (deterministik) dengan pencocokan URL presisi via `new URL(resp.url()).searchParams` (wajib `/api/gmail/logs`, status 200, `includeSummary=1`, lalu **exact match** `status` param / `null` untuk "Semua") — menggantikan substring-match yang bisa salah tangkap request mount stale
- `playwright.config.ts` — `expect.timeout` 15s→20s (headroom poll saat beban CI), `actionTimeout: 15_000`, `navigationTimeout: 30_000`, reporter `html` (`playwright-report/`, `open: never`), `forbidOnly: !!process.env.CI`, `video: 'retain-on-failure'`

## Rekomendasi menjaga stabilitas

1. **Jangan jalankan 2 instance Playwright paralel** (berbagi server/DB Turso) — workflow CI sudah mengunci via `concurrency` + `workers: 1`
2. **Trace & video aktif** (`retain-on-failure`) — bukti visual bila flake muncul di CI
3. Angka pinned (519 email / 284 transaksi) adalah **regression guard** — update bila data bertambah secara intentional
4. Saat suite bertambah, pertimbangkan stability gate 3× otomatis di CI (lihat `CI_PIPELINE.md` roadmap)
