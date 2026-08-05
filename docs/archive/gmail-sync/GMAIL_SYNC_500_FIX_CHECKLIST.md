# `docs/gmail-sync/GMAIL_SYNC_500_FIX_CHECKLIST.md`

> ⚠️ **STATUS: ARSIP HISTORIS (SUPERSEDED)** — Dokumen ini ditulis pada era Supabase/Firebase (sebelum 2026-08-02) dan TIDAK mencerminkan arsitektur aktif. Arsitektur saat ini: Express 4 + Better Auth + Turso (libSQL) + SSE + Vertex AI. Lihat [ADR-001..007](../adr/INDEX.md) untuk keputusan arsitektur terkini; desain Gmail sync saat ini ada di [ADR-007](../adr/ADR-007-gmail-sync.md).

# Gmail Sync Server Error 500 Fix Checklist

## 1. Ringkasan Masalah

Pada halaman Gmail Sync CashFlow, sistem berhasil terhubung ke Gmail dan Gemini AI, tetapi banyak email gagal diproses dengan status teknis.

Kondisi yang terdeteksi:

| Item                | Nilai               |
| ------------------- | ------------------- |
| Total email terbaca | 200                 |
| Menunggu            | 0                   |
| Disetujui           | 0                   |
| Ditolak/Skip        | 29                  |
| Gagal Teknis        | 171+                |
| Error utama         | `Server error: 500` |

Contoh sender yang banyak gagal:

| Sender    | Contoh Subject                        |
| --------- | ------------------------------------- |
| blu       | `Transaksimu Pakai blu Berhasil`      |
| blu       | `Info Transaksi Masuk ke blu Kamu 💸` |
| LINE Bank | `[LINEBANK] Informasi Transaksi`      |
| LINE Bank | `[LINE Bank] Informasi Transaksi`     |
| Jago      | `Kamu telah melakukan transfer💸`     |
| KAI       | `Bukti Pembayaran Transaksi PT. KAI`  |
| tiket.com | `Bukti Pembayaran`                    |
| Grab      | `Your Grab E-Receipt`                 |
| Shopee    | `Pembayaranmu Berhasil Dikonfirmasi`  |

## 2. Dugaan Root Cause

Error `Server error: 500` kemungkinan terjadi pada salah satu bagian berikut:

| Area                 | Dugaan Masalah                                           |
| -------------------- | -------------------------------------------------------- |
| Backend API          | Catch block masih generic dan langsung return 500        |
| Gemini Extractor     | Error AI extraction tidak diklasifikasi dengan benar     |
| JSON Parser          | Response AI invalid menyebabkan server crash             |
| Fallback Parser      | Belum aktif atau belum menangani sender umum             |
| Supabase Insert      | Mismatch field snake_case/camelCase                      |
| Supabase RLS         | Insert/update gagal karena policy                        |
| Gmail Token          | Provider token hilang/expired                            |
| Batch Processor      | Satu email error membuat item lain ikut failed           |
| Notification Service | Error insert notification ikut membuat Gmail Sync failed |

## 3. Root Cause Analysis Checklist

* [ ] Endpoint Gmail Sync penyebab 500 ditemukan
* [ ] Endpoint AI extraction diperiksa
* [ ] Server logs diperiksa
* [ ] Browser Network response diperiksa
* [ ] Supabase error detail diperiksa
* [ ] Gemini error detail diperiksa
* [ ] Gmail provider token diperiksa
* [ ] Request payload diperiksa
* [ ] Response payload diperiksa
* [ ] RLS/policy diperiksa
* [ ] Database schema diperiksa
* [ ] Mapper field diperiksa
* [ ] Batch processor diperiksa
* [ ] Retry Failed handler diperiksa
* [ ] Notification insert/update diperiksa

## 4. Perbaikan Backend

Checklist perbaikan backend:

* [ ] Generic `Server error: 500` diganti dengan structured error
* [ ] Error classifier ditambahkan
* [ ] Per-email `try/catch` diterapkan
* [ ] Batch tidak crash total saat satu email error
* [ ] Retryable error menjadi `retry_later`
* [ ] Config error menjadi `config_error`
* [ ] Missing Gmail token menjadi `gmail_permission_required`
* [ ] AI JSON invalid dicoba repair sebelum failed
* [ ] Fallback parser dijalankan sebelum status `failed`
* [ ] Duplicate email menjadi `duplicate`
* [ ] Non-transaksi menjadi `skipped` atau `rejected`
* [ ] Response frontend tidak menampilkan stack trace production
* [ ] Server logs tetap menyimpan detail teknis aman

## 5. Error Classification

Gunakan mapping status berikut:

| Error / Kondisi                    | Status Final                           | Retryable  |
| ---------------------------------- | -------------------------------------- | ---------- |
| Gemini rate limit                  | `retry_later`                          | Ya         |
| Gemini timeout                     | `retry_later`                          | Ya         |
| Gemini invalid JSON + repair gagal | fallback dulu, lalu `skipped`/`failed` | Tergantung |
| Gmail token missing                | `gmail_permission_required`            | Tidak      |
| Gmail permission invalid           | `gmail_permission_required`            | Tidak      |
| Supabase table missing             | `config_error`                         | Tidak      |
| Supabase RLS denied                | `config_error`                         | Tidak      |
| Duplicate gmail message id         | `duplicate`                            | Tidak      |
| Email promo/newsletter             | `rejected`                             | Tidak      |
| Sender terpercaya tanpa nominal    | `skipped`                              | Tidak      |
| Nominal ditemukan via fallback     | `pending_review`                       | Tidak      |
| Unknown server bug                 | `failed`                               | Ya         |

## 6. Format Response Error Baru

Endpoint tidak boleh hanya mengembalikan:

```json
{
  "message": "Server error: 500"
}
```

Gunakan format:

```json
{
  "success": false,
  "finalStatus": "retry_later",
  "errorCode": "GEMINI_RATE_LIMITED",
  "userMessage": "AI sedang sibuk. Email ini bisa dicoba ulang nanti.",
  "technicalMessage": "Only available in development",
  "retryable": true,
  "source": "gemini_extractor"
}
```

## 7. Perbaikan Supabase

Checklist Supabase:

* [ ] Table `transactions` tersedia
* [ ] Table `gmail_sync_logs` tersedia
* [ ] Table `notifications` tersedia
* [ ] RLS aktif pada semua table user-owned
* [ ] Policy `user_id = auth.uid()` aktif
* [ ] Index `gmail_message_id` tersedia
* [ ] Schema cache reload dilakukan
* [ ] Query insert/update memakai `user_id`
* [ ] Tidak ada service role di frontend
* [ ] Tidak ada full Gmail body disimpan di Supabase production

Query verifikasi table:

```sql
select table_schema, table_name
from information_schema.tables
where table_schema = 'public'
and table_name in (
  'transactions',
  'gmail_sync_logs',
  'notifications'
)
order by table_name;
```

Query verifikasi RLS:

```sql
select schemaname, tablename, rowsecurity
from pg_tables
where schemaname = 'public'
and tablename in (
  'transactions',
  'gmail_sync_logs',
  'notifications'
)
order by tablename;
```

Reload schema cache:

```sql
notify pgrst, 'reload schema';
```

## 8. Perbaikan Gmail Auth

Checklist Gmail Auth:

* [ ] Supabase session tersedia
* [ ] `session.user.id` tersedia
* [ ] `session.provider_token` tersedia
* [ ] Gmail readonly scope aktif
* [ ] Missing token tidak menjadi 500
* [ ] Token expired ditangani dengan reconnect flow
* [ ] Token tidak dicetak ke console
* [ ] Token tidak disimpan manual di localStorage
* [ ] Reset Izin tetap berjalan

## 9. Perbaikan AI Extraction

Checklist AI Extraction:

* [ ] Gemini health check berhasil
* [ ] Endpoint AI extraction tidak generic 500
* [ ] Prompt JSON-only diperketat
* [ ] JSON parser diperkuat
* [ ] JSON repair diterapkan
* [ ] AI invalid JSON tidak langsung failed
* [ ] Fallback parser berjalan untuk sender umum
* [ ] AI rate limit menjadi `retry_later`
* [ ] AI timeout menjadi `retry_later`

## 10. Perbaikan Fallback Parser

Fallback parser wajib mendukung:

| Provider  | Subject / Pola                         |
| --------- | -------------------------------------- |
| blu       | `Transaksimu Pakai blu Berhasil`       |
| blu       | `Info Transaksi Masuk ke blu Kamu`     |
| blu       | `Pengembalian Dana Berhasil`           |
| LINE Bank | `[LINEBANK] Informasi Transaksi`       |
| Jago      | `Kamu telah melakukan transfer`        |
| Jago      | `Kamu telah melakukan top up e-Wallet` |
| Jago      | `Uang telah dikembalikan`              |
| KAI       | `Bukti Pembayaran Transaksi`           |
| tiket.com | `Bukti Pembayaran`                     |
| Grab      | `Your Grab E-Receipt`                  |
| Shopee    | `Pembayaranmu Berhasil Dikonfirmasi`   |
| Tokopedia | `Pesanan Anda telah diantar`           |

Pattern nominal:

```ts
/Rp\s?[\d.]+(?:,\d{2})?/i
/IDR\s?[\d.,]+/i
/(?:total|nominal|jumlah|sebesar)\s*Rp\s?[\d.]+/i
```

Jika nominal ditemukan:

| Field              | Value            |
| ------------------ | ---------------- |
| `finalStatus`      | `pending_review` |
| `source`           | `fallback`       |
| `aiParsed`         | `false`          |
| `fallbackUsed`     | `true`           |
| `confidence_score` | `0.60 - 0.75`    |

Jika nominal tidak ditemukan:

| Field         | Value                               |
| ------------- | ----------------------------------- |
| `finalStatus` | `skipped`                           |
| `reason`      | `Tidak ditemukan nominal transaksi` |

## 11. Perbaikan Batch Processing

Checklist batch:

* [ ] Proses email per item dengan try/catch lokal
* [ ] Satu email error tidak menghentikan batch
* [ ] Concurrency maksimal 2-3
* [ ] Delay 500-1000ms antar batch jika memanggil AI
* [ ] Retry maksimal 2 kali untuk retryable error
* [ ] Exponential backoff 3s dan 8s
* [ ] Progress batch tampil di UI
* [ ] Counter status update dengan benar
* [ ] Batch summary tidak membuat notifikasi duplicate

## 12. Perbaikan Retry Failed

Checklist Retry Failed:

* [ ] Hanya mengambil status `failed`
* [ ] Mengambil `retry_later`
* [ ] Tidak mengambil `skipped`
* [ ] Tidak mengambil `rejected`
* [ ] Tidak mengambil `approved`
* [ ] Tidak mengambil `duplicate`
* [ ] Tidak mengambil `pending_review`
* [ ] Menggunakan `gmail_message_id` sebagai idempotency key
* [ ] Tidak membuat transaksi duplikat
* [ ] Mengupdate status item setelah retry
* [ ] Mengupdate notification summary via dedupe

## 13. Perbaikan UI Gmail Sync

Checklist UI:

* [ ] Status `failed` tampil jelas
* [ ] Status `retry_later` tampil jelas
* [ ] Status `config_error` tampil jelas
* [ ] Status `gmail_permission_required` tampil jelas
* [ ] Error `Server error: 500` diganti userMessage lebih jelas
* [ ] Debug detail hanya development
* [ ] Token/secret tidak tampil di UI
* [ ] Full email body tidak tampil di production
* [ ] Tombol Retry Failed bekerja
* [ ] Counter status akurat
* [ ] Mobile layout tetap rapi

## 14. Validasi Bertahap

Lakukan test bertahap:

* [ ] Test 5 email failed
* [ ] Test 20 email failed
* [ ] Test seluruh failed email
* [ ] Test Retry Failed
* [ ] Test sender blu
* [ ] Test sender LINE Bank
* [ ] Test sender Jago
* [ ] Test sender KAI
* [ ] Test sender tiket.com
* [ ] Test sender Grab
* [ ] Test sender Shopee
* [ ] Test non-transaksi promo
* [ ] Test duplicate email
* [ ] Test missing Gmail token
* [ ] Test Gemini health
* [ ] Test Supabase insert log
* [ ] Test Supabase pending review

## 15. Build & Lint

* [ ] `npm install` berhasil
* [ ] `npm run build` berhasil
* [ ] `npm run lint` berhasil atau error terdokumentasi
* [ ] Tidak ada console error fatal
* [ ] Tidak ada TypeScript error fatal
* [ ] Tidak ada dependency missing

## 16. File yang Diubah

| File | Perubahan |
| ---- | --------- |
|      |           |
|      |           |
|      |           |

## 17. Error yang Ditemukan dan Solusi

| Error             | Root Cause | Solusi | Status |
| ----------------- | ---------- | ------ | ------ |
| Server error: 500 |            |        |        |
|                   |            |        |        |

## 18. Hasil Akhir

| Metrik           | Sebelum | Sesudah |
| ---------------- | ------- | ------- |
| Total email      | 200     |         |
| Failed           | 171+    |         |
| Retry Later      | -       |         |
| Pending Review   | 0       |         |
| Skipped/Rejected | 29      |         |
| Duplicate        | -       |         |
| Config Error     | -       |         |

## 19. Final Status

| Area                | Status     |
| ------------------- | ---------- |
| Gmail Sync          | Belum / OK |
| Server 500 fixed    | Belum / OK |
| Retry Failed        | Belum / OK |
| Fallback Parser     | Belum / OK |
| Supabase Logs       | Belum / OK |
| Gemini Extractor    | Belum / OK |
| Notification Dedupe | Belum / OK |
| Build               | Belum / OK |
