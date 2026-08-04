# PHASE 1 — Code Review

> Audit: 2026-08-04 · Fokus: naming, readability, maintainability, error handling, type safety, logging, dead code, duplication.

---

## 1. Ringkasan

| Dimensi | Nilai | Catatan |
|---|---|---|
| Naming | 8.5/10 | `parseAccessTokenExpiryMs`, `normalizeProxyErrorCode` deskriptif; beberapa komentar stale |
| Readability | 9.0/10 | Komentar WHY mendominasi (pola baik), alur retry mudah diikuti |
| Maintainability | 8.5/10 | Validation layer terpusat di `server/lib/validation.js` (baru, untracked) |
| Error handling | 9.0/10 | Fail-closed konsisten; retry hanya untuk retryable |
| Type safety | 9.0/10 | TS strict frontend; JSDoc di server ESM |
| Logging | 8.5/10 | Structured logger; dedupe/forgery tercatat |
| Dead code | 8.0/10 | `adoptNotificationDedupeKey` stub no-op (sisa) |
| **Overall** | **8.6/10** | — |

---

## 2. Review per file

### 2a. `src/services/geminiService.ts` (FIX 1)
- ✅ `normalizeProxyErrorCode`: alias table + fallback httpStatus — mapping lengkap & mudah diuji.
- ✅ `retryWithBackoff`: generic, exponential (3s × 2.5^n), hanya retryable.
- ✅ `compactTextForAi`: regex bersih (style/script/tag), truncate aman.
- ⚠️ Komentar header menyebut "retry untuk rate limited" tapi `RATE_LIMITED` tak ada di set frontend — **sinkronisasi komentar** (Low).
- ⚠️ `isConfigErrorCode` di-export & dipakai; `isGeminiConfigError` dipakai — dua helper serupa (satu via code, satu via object). Minor redundancy.

### 2b. `src/lib/geminiErrors.ts` (FIX 1)
- ✅ 19 error codes + metadata konsisten (`isConfigError/isRetryable/fallbackAllowed`).
- ✅ `classifyRawGeminiError` heuristik urut benar (disabled → referer → api key → permission → billing → credits → quota → rate → timeout → model → network → blocked → json).
- ✅ `UNAUTHORIZED`: non-retryable + fallbackAllowed — tepat untuk sesi kadaluarsa.

### 2c. `src/services/notificationService.ts` (FIX 4/5)
- ✅ `fetchNotifications` mengirim filter ke server (bukan client-side) — inti FIX 3.
- ✅ `notificationExistsByDedupeKey`: try/catch + warn + graceful false + komentar WHY.
- ⚠️ **Dead-ish code**: `adoptNotificationDedupeKey` stub no-op (`// no-op stub`) — tampaknya sisa API lama; tidak dipanggil di mana pun. Rekomendasi hapus atau implement (Low).

### 2d. `src/app/App.tsx`
- ✅ Refetch on focus + SSE subscribe + cleanup lengkap.
- ✅ `processedUid` ref mencegah double-run recurring.
- ✅ Error fetch → `logger.warn`, tidak crash app.

### 2e. `src/features/notifications/NotificationsPage.tsx` + `useNotifications.ts`
- ✅ Pagination `PAGE_SIZE+1` idiom benar (hasMore tanpa request ekstra).
- ✅ `useNotifications` menyediakan `filteredNotifications` client-side UNTUK dropdown (data sudah 100 di store) — tidak konflik dengan filter server (halaman `/notifications` pakai server filter).
- ⚠️ Duplikasi halus: `NotificationsPage` fetch sendiri vs `useNotifications` refetch — dua jalur fetch notifikasi. Acceptable (page punya pagination, hook untuk bell), tapi dokumentasikan.

### 2f. `server/routes/gmailRoutes.js` (FIX 2)
- ✅ `parseAccessTokenExpiryMs` di-export (testable) + urutan parse ISO→number.
- ✅ Fail-closed + skew 60s + komentar WHY lengkap.
- ✅ Validation schemas terpusat (`GMAIL_LOG_BODY_SCHEMA` dll) — konsisten.
- ⚠️ `sendGeminiError`/validation mix di POST logs — handler lama memakai `sendValidationError`; konsisten & diuji G3.

### 2g. `server/routes/notificationRoutes.js` (FIX 3)
- ✅ SQL parameterized + whitelist + clamp; komentar perubahan P1-2 jelas.
- ✅ Webhook side effect di-gate corroboration server-side (anti-forgery).
- ✅ `NOTIFICATION_TYPES`/`NOTIFICATION_PRIORITIES` di-export untuk unit test.
- ⚠️ `ALLOWED_TYPES` di GET diduplikasi dengan `NOTIFICATION_TYPES` (const) — bisa dipakai ulang (`NOTIFICATION_TYPES`) (Low).

### 2h. `server/lib/validation.js` (baru, P1-2)
- ✅ Murni (no DB/log), fail-closed, `error` selalu string, koersi konsisten.
- ✅ `validateBody` kumpulkan SEMUA error (bukan fail-fast) + strip field tak dikenal.
- ✅ JSDoc typing + kontrak `ValidationResult` dokumentasi lengkap.
- ⚠️ File ini **untracked** + `gmailRoutes.js`/`agentSearchRoutes.js` **modified uncommitted** — kerja P1-2 belum di-commit (tembus lihat §4).

### 2i. `playwright.config.ts` (FIX 6)
- ✅ 5 webServer entries dengan env eksplisit + komentar WHY per server.
- ✅ `workers: 1` (DB shared), retries 1, snapshotPathTemplate lintas-OS.
- ✅ `forbidOnly` di CI.

### 2j. `e2e/notifications-pagination.spec.ts` (FIX 8)
- ✅ Deterministik: RUN_ID, seed prefix unik, cleanup berurutan FK-safe.
- ✅ `ensureLegacyUserRow` + `cleanupLegacyTestUser` — helper jelas.
- ⚠️ `loadEnv()` diduplikasi di beberapa spec — sudah ada pola di `mintSession.ts` (reuse). (Low, duplikasi helper kecil.)

---

## 3. Temuan & Rekomendasi

| # | Severity | Temuan | Rekomendasi |
|---|---|---|---|
| C-1 | Low | `adoptNotificationDedupeKey` stub no-op | Hapus atau implement — cek panggilan (0 ditemukan) |
| C-2 | Low | `ALLOWED_TYPES` GET diduplikasi dengan `NOTIFICATION_TYPES` | Reuse const yang di-export |
| C-3 | Low | Komentar `geminiService.ts` "retry rate limited" vs set retryable | Sinkronkan komentar |
| C-4 | Low | `loadEnv()` diduplikasi antar spec e2e | Pindah ke helper shared (mintSession sudah punya) |
| C-5 | Info | Dua jalur fetch notifikasi (page vs hook) | Dokumentasikan pembagian tanggung jawab |
| C-6 | Info | `geminiErrors` `isConfigErrorCode` vs `isGeminiConfigError` | Konsolidasi salah satu |

**Tidak ada temuan High.** Kualitas kode Phase-1 solid; temuan bersifat polish.
