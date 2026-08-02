# Stability Report — CashFlow E2E

> Quality gate: suite E2E dijalankan 3× berurutan → **0 flaky failures** (kriteria sukses enterprise).
> Tanggal: 1 Agustus 2026 · Branch: `gh-pages` · Playwright (Chromium) · workers: 1

## Hasil Final (setelah semua perbaikan)

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
