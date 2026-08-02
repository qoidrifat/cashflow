# E2E Helper Review — CashFlow

> Phase 2 · Deep review: `mintSession.ts`, `authContext.ts`, `pagination.ts`, `errors.ts`
> Date: 2026-08-01

## 1. `mintSession.ts` — Session Minting

### Evaluasi

| Aspek | Status | Detail |
|---|---|---|
| Duplicated logic | ✅ | Satu-satunya tempat minting sesi; tidak ada duplikasi |
| Race conditions | ⚠️ | **Peringatan**: `SELECT id FROM user LIMIT 1` — bila DB punya >1 user, test memakai user pertama (deterministik selama data stabil). Tidak ada race antar test karena `workers:1` |
| Retry handling | ✅ | Token acak `randomBytes(24)` per mint → tidak ada bentrok id |
| Cookie lifetime | ✅ | `expiresAt = now + 7 hari` — cukup untuk suite; dihapus via cleanup |
| Session cleanup | ✅ | `cleanupTestSessions()` hapus `WHERE userAgent='e2e-test'` di `afterAll` |
| Test determinism | ✅ | Signature cocok dengan `server/lib/auth.js` (HMAC-SHA256, secret fallback chain) |
| Browser isolation | ✅ | Sesi per-spec; `beforeAll` mint baru |

### Temuan

- **Tidak ada issue blocking.** 
- **Minor**: `loadEnv()` mem-parse `server/.env` manual (bukan `dotenv`) — sengaja agar helper
  jalan tanpa dependensi runtime; bila env dibutuhkan dari CI secret, test harus set
  `TURSO_DATABASE_URL`/`TURSO_AUTH_TOKEN`/`BETTER_AUTH_SECRET` sebagai env proses (lihat CI_PIPELINE).
- **Saran (optional)**: tambah `cleanupTestSessions()` di `beforeAll` juga (self-healing bila
  run sebelumnya crash sebelum `afterAll`).

## 2. `authContext.ts` — Cookie + Onboarding

### Evaluasi

| Aspek | Status | Detail |
|---|---|---|
| Duplicated logic | ✅ | Semua spec pakai `setupAuthContext` |
| Race conditions | ✅ | `addInitScript` + `addCookies` berurutan `await`; keduanya selesai sebelum `goto` |
| Retry handling | ✅ | `localStorage.setItem` dibungkus try/catch (jika origin menolak) |
| Flaky risks | ✅ | Menekan modal onboarding (root cause click-blocking yang ditemukan di sesi pertama) |
| Browser isolation | ✅ | Per-context; tiap test dapat context fresh |

### Temuan

- **Benar & stabil.** Key `cashflow-onboarding-done` divalidasi terhadap `src/config/constants.ts`.

## 3. `pagination.ts` — List Counter Helpers

### Evaluasi

| Aspek | Status | Detail |
|---|---|---|
| Duplicated logic | ✅ | Keyword-based — satu regex factory `counterRegexFor(keyword)` |
| Polling strategy | ✅ | `expect.poll` default 20s (config) — cukup untuk beban CI |
| Flaky risks | ✅ | `getListCountText` catch → sentinel `-1` → retry; skeleton/loading gap ter-handle |
| Race conditions | ✅ | Poll sampai nilai stabil (tidak ada assert pada nilai transien) |
| Timeout strategy | ✅ | Mengikuti `expect.timeout: 20_000` di config |

### Temuan

- **Satu real improvement dari Phase 8**: `waitListTotal`/`waitListRange` sekarang dipakai
  bersama 2 spec (transaksi + email) — tidak ada duplikasi regex.

## 4. `errors.ts` — PageError Collector (BARU di Phase 8)

### Evaluasi

| Aspek | Status | Detail |
|---|---|---|
| Duplicated logic | ✅ | Menghapus 8× boilerplate `page.on('pageerror')` + `expect(...).toEqual([])` |
| API | ✅ | `collectPageErrors(page)` → `{ all(), expectClean() }`; `expectClean()` dipakai di akhir tiap test |
| Retry handling | ✅ | Listener didaftarkan **sebelum** navigasi (best practice Playwright) |

### Temuan

- **Penerapan konsisten** di ketiga spec (8 test). `all()` disediakan untuk debugging.
- **Catatan minor**: `all()` belum dipakai di spec mana pun — disengaja sebagai API debugging;
  alternatif: hanya pertahankan `expectClean()` (lihat EXECUTION_REPORT untuk tradeoff).

## 5. Ringkasan Risiko Flaky

| Risiko | Level | Mitigasi |
|---|---|---|
| Overlap request mount vs filter (Gmail) | ~~High~~ → **Fixed** | RequestId guard di `GmailSyncPage` |
| Poll timeout di bawah beban CI | Medium | `expect.timeout 20s` + respons-based wait |
| Modal onboarding menghalangi klik | Fixed | `addInitScript` localStorage |
| `networkidle` hang (HMR WebSocket) | Fixed | `domcontentloaded` + assertion |
| Cookie tidak terbawa fixture `request` | Fixed | Header `Cookie` eksplisit |
| Dua instance Playwright paralel | **Jangan dilakukan** | Dokumentasikan: 1 runner sekaligus (DB/session bersama) |

## 6. Kesimpulan

Semua helper **production-grade**. Tidak ada duplikasi logic, tidak ada race yang tersisa
dalam helper; satu-satunya race yang ditemukan adalah di **kode aplikasi** (sudah diperbaiki,
lihat EXECUTION_REPORT). Helper siap untuk diekspansi ke halaman baru tanpa perubahan.
