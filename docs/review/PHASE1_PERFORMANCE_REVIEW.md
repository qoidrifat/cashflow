# PHASE 1 — Performance Review

> Audit: 2026-08-04 · Fokus: notification query/pagination, Gemini extraction, Gmail Sync, browser render, payload, memory.
> Metode: inspeksi kode + hasil E2E/unit + bundle build riil.

---

## 1. Ringkasan

| Area | Hasil | Verdict |
|---|---|---|
| Notification query (GET) | 1 query terindeks (`user_id`, `created_at DESC, id DESC`), LIMIT ≤ 100 | ✅ |
| Pagination notifikasi | offset-based, fetch `PAGE_SIZE+1` untuk deteksi hasMore | ✅ |
| Gemini extraction | frontend hanya 1 request + max 2 retry (non-401); server handle cache/retry | ✅ |
| Gmail Sync | limit clamp 1..100; summary dihitung 1 query terpisah | ✅ |
| Browser render | 20 item/page, dropdown 15, memoized | ✅ |
| Payload | ≤100 baris notifikasi ≈ puluhan KB; email AI truncate 8.000 chars | ✅ |
| Memory | tidak ada leak baru; cleanup interval/event listener benar | ✅ |
| **Overall** | — | **8.5/10** |

---

## 2. Notification Query

### SQL path (`GET /api/notifications`)
```sql
SELECT * FROM notifications
WHERE user_id = ? [AND type = ?] [AND read = 0]
ORDER BY created_at DESC, id DESC
LIMIT ? OFFSET ?
```
- Semua kondisi di WHERE parameterized + filter sebelum LIMIT/OFFSET → **tanpa over-fetch**.
- ORDER BY komposit (created_at, id) stabil — pagination deterministik.
- Clamp `limit ≤ 100` — mencegah payload raksasa (anti abuse).
- Tidak ada N+1: 1 query per halaman.

### 10.000 notifikasi (skenario worst-case)
- Halaman 100 baris → OFFSET besar tetap O(1) query di SQLite/libSQL (index `user_id`).
- Catatan inherent offset-pagination: OFFSET tinggi sedikit lebih mahal dari keyset; acceptable untuk skala ini. Keyset cursor = rekomendasi jangka panjang (Low).

### Pengukuran E2E
- `notifications-pagination.spec.ts`: seed 25 + filter 24 → halaman 1..N + API no-overlap — **PASS dalam < total suite 3.8m** (bukan bottleneck).

---

## 3. Gemini Extraction (FIX 1)

### Jalur request
1. Frontend kompak email: strip HTML tag/style/script, normalize whitespace, truncate **6.000 chars** (`MAX_AI_EMAIL_TEXT_CHARS`) → payload kecil.
2. Server truncate ulang ke **8.000 chars** untuk prompt.
3. Frontend retry: hanya NETWORK/MODEL_UNAVAILABLE/EMPTY/UNKNOWN (max 2, backoff 3s→7.5s). **401/429/config tidak membuang budget**.
4. Server: LRU cache 7 hari (email sama tidak di-scan ulang) + single-flight dedup (anti thundering herd) + retry eksponensial (Sprint 3).

### Verdict
- Tidak ada request duplikat nyata: cache + single-flight menutup pengulangan sync.
- `checkGeminiHealth` tidak ikut retry loop (1 request ringan).
- Browser: proses batch AI di halaman Gmail memakai baris status — tidak ada freeze (E2E pass).

---

## 4. Gmail Sync

- `GET /api/gmail/logs`: limit default 2000, clamp ≤ 5000; sort column **whitelist**; summary = 1 query terpisah hanya saat `includeSummary=1`.
- `POST /api/gmail/logs`: upsert `ON CONFLICT(user_id, message_id)` — tanpa duplikat baris.
- `GET /api/gmail/runs`: limit clamp 1..100 (default 20).
- **Tidak ada perubahan performa regresif** pada Phase-1 (hanya penambahan validation layer yang murni CPU, diuji unit 0ms-8ms).

---

## 5. Browser Render & Memory

| Aspek | Bukti | Verdict |
|---|---|---|
| NotificationsPage | render 20 item; `useMemo` untuk unreadCount | ✅ |
| Dropdown bell | `slice(0, 15)` + sort memoized | ✅ |
| App.tsx | fetch 100 + SSE subscribe; cleanup unsubscribe/removeEventListener | ✅ |
| Realtime | 1 EventSource shared (`onSSE`); reconnect state `realtimeConnected` | ✅ |
| Recurring processor | `processedUid` ref mencegah double-run; timer dibersihkan | ✅ |

### Build riil (2026-08-04)
```
dist/assets/GmailSyncPage-*.js     157.92 kB │ gzip:  43.09 kB
dist/assets/vendor-react-*.js      330.76 kB │ gzip: 101.32 kB
dist/assets/vendor-charts-*.js     384.76 kB │ gzip: 112.28 kB
✓ built in 54.46s
```
- **Tidak ada chunk firebase/supabase** (Sprint 4 verified).
- Budget CI perf (v2: page load 3000ms / API p95 1800ms / requests 60) — job `performance` hijau di run CI terakhir.

---

## 6. Temuan & Rekomendasi

| # | Severity | Temuan | Rekomendasi |
|---|---|---|---|
| P-1 | Low | Offset pagination untuk dataset sangat besar | Pertimbangkan keyset cursor (`created_at, id < last`) untuk >50k baris |
| P-2 | Info | `fetchUnreadNotificationCount` mengambil 100 baris utuh padahal hanya butuh count | Opsional: endpoint `GET /api/notifications/count?unreadOnly=1` (Low) |
| P-3 | Info | Email truncate 6.000 → server 8.000 (server lebih longgar) | Harmonisasi konstanta agar konsisten (Low) |

**Tidak ada regresi performa pada Phase-1.** Semua batasan (limit, clamp, truncate, cache) aktif.
