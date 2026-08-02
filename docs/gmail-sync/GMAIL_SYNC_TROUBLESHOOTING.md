# `docs/gmail-sync/GMAIL_SYNC_TROUBLESHOOTING.md`

# Gmail Sync Troubleshooting Guide

## 1. Overview

Dokumen ini berisi panduan troubleshooting fitur Gmail Sync CashFlow.

Fitur Gmail Sync bertugas:

1. Membaca email transaksi dari Gmail.

2. Memfilter email non-transaksi.

3. Mengekstrak data transaksi dengan AI.

4. Menggunakan fallback parser jika AI gagal.

5. Menyimpan log hasil scan.

6. Mengirim transaksi valid ke pending review.

7. Memberikan notifikasi hasil sync.

## 2. Status Gmail Sync

Status yang digunakan:

| Status                      | Arti                                                  | Action              |
| --------------------------- | ----------------------------------------------------- | ------------------- |
| `pending_review`            | Transaksi valid menunggu review user                  | User approve/reject |
| `approved`                  | Transaksi sudah disetujui                             | Tidak perlu retry   |
| `rejected`                  | Email jelas bukan transaksi                           | Tidak perlu retry   |
| `skipped`                   | Sender relevan tapi tidak ada nominal/bukti transaksi | Tidak perlu retry   |
| `failed`                    | Gagal teknis nyata                                    | Bisa retry          |
| `retry_later`               | Gagal sementara/rate limit/timeout                    | Bisa retry          |
| `duplicate`                 | Email/transaksi sudah pernah diproses                 | Tidak perlu retry   |
| `config_error`              | Ada masalah konfigurasi                               | Perbaiki config     |
| `gmail_permission_required` | Izin Gmail hilang/kurang                              | Reconnect Gmail     |

## 3. Masalah Umum

## 3.1 Banyak Email Gagal `Server error: 500`

### Gejala

* Banyak email masuk `Gagal Teknis`

* UI menampilkan `Server error: 500`

* Failed count sangat tinggi

### Kemungkinan Penyebab

| Penyebab                    | Cara Cek                   |
| --------------------------- | -------------------------- |
| Backend catch block generic | Cek API handler            |
| Gemini extractor error      | Cek server logs            |
| Supabase insert gagal       | Cek response Supabase      |
| RLS denied                  | Cek policies               |
| Table/column missing        | Cek schema                 |
| Gmail token missing         | Cek session provider token |
| JSON parser crash           | Cek raw AI response        |
| Batch processor crash       | Cek per-email try/catch    |

### Solusi

* Tambahkan structured error.

* Tambahkan per-email try/catch.

* Jalankan fallback parser.

* Ubah retryable error menjadi `retry_later`.

* Ubah config error menjadi `config_error`.

* Jangan jadikan semua kasus sebagai `failed`.

## 3.2 Notification “Beberapa email gagal diproses” Muncul Berulang

### Gejala

Notifikasi muncul beberapa kali:

```txt
171 email gagal diekstrak
174 email gagal diekstrak
```

### Penyebab

* Dedupe key tidak stabil.

* Failed count dipakai sebagai bagian dedupe key.

* Notification dibuat dengan `create`, bukan `upsert`.

* Unique index dedupe belum ada.

### Solusi

Gunakan dedupe key:

```ts
gmail-failed-summary-${userId}-${yyyyMMDD}
```

Pastikan ada index:

```sql
create unique index if not exists idx_notifications_user_dedupe_unique
on public.notifications (user_id, dedupe_key)
where dedupe_key is not null;
```

Gunakan:

* `upsertNotificationByDedupeKey`

* bukan `createNotification` langsung untuk Gmail failed summary.

## 3.3 Gmail Token Tidak Ada

### Gejala

* Gmail Sync gagal langsung

* Error permission/token

* User sudah login tapi Gmail tidak bisa dibaca

### Penyebab

* Google OAuth scope belum mencakup Gmail.

* `provider_token` tidak tersedia.

* User belum consent Gmail scope.

* Token expired.

### Solusi

* Pastikan scope:

```txt
https://www.googleapis.com/auth/gmail.readonly
```

* Paksa consent ulang jika perlu:

```ts
queryParams: {
  access_type: "offline",
  prompt: "consent"
}
```

* Tampilkan tombol `Reset Izin` / `Reconnect Gmail`.

* Jangan lempar generic 500.

## 3.4 AI Menghasilkan JSON Invalid

### Gejala

* Email transaksi gagal diparse

* Error JSON parse

* AI response tidak valid

### Solusi

Tambahkan pipeline:

1. sanitize markdown

2. extract JSON object pertama

3. remove trailing comma

4. replace `undefined` dan `NaN` dengan `null`

5. parse ulang

6. validate schema

7. fallback regex parser

8. jika tidak ada nominal, `skipped`

## 3.5 Supabase Permission Denied

### Gejala

* Query insert/select gagal

* User sudah login

* Error RLS

### Cek RLS

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

### Cek Policy

```sql
select schemaname, tablename, policyname, cmd
from pg_policies
where schemaname = 'public'
and tablename in (
  'transactions',
  'gmail_sync_logs',
  'notifications'
)
order by tablename, policyname;
```

### Solusi

Policy harus menggunakan:

```sql
using (user_id = auth.uid())
with check (user_id = auth.uid())
```

## 4. Prefilter Rules

## 4.1 Keyword Non-Transaksi

Email dengan keyword berikut sebaiknya `rejected` atau `skipped`:

| Keyword                        | Status     |
| ------------------------------ | ---------- |
| promo                          | `rejected` |
| diskon                         | `rejected` |
| cashback hingga                | `rejected` |
| newsletter                     | `rejected` |
| buletin                        | `rejected` |
| rating your stay               | `skipped`  |
| waspada                        | `rejected` |
| tautan palsu                   | `rejected` |
| kartu telah aktif              | `skipped`  |
| request card berhasil          | `skipped`  |
| pesanan telah dikirim          | `skipped`  |
| sudahkah kamu menerima pesanan | `skipped`  |
| save up to                     | `rejected` |

## 4.2 Keyword Transaksi

Email dengan keyword berikut layak dikirim ke AI/fallback:

| Keyword             |
| ------------------- |
| berhasil            |
| bukti pembayaran    |
| pembayaran berhasil |
| transaksi berhasil  |
| transfer            |
| top up              |
| e-wallet            |
| pengembalian dana   |
| refund              |
| penarikan dana      |
| dikenakan biaya     |
| receipt             |
| e-receipt           |
| total               |
| nominal             |
| jumlah              |
| sebesar             |
| Rp                  |
| IDR                 |

## 5. Fallback Parser Guide

## 5.1 Amount Extraction

Pattern:

```ts
const amountPatterns = [
  /Rp\s?[\d.]+(?:,\d{2})?/i,
  /IDR\s?[\d.,]+/i,
  /(?:total|nominal|jumlah|sebesar)\s*Rp\s?[\d.]+/i
];
```

Normalize:

* `Rp150.000` → `150000`

* `Rp 1.250.000` → `1250000`

* `IDR 250,000` → `250000`

## 5.2 Transaction Type Inference

| Subject / Text                  | Type       |
| ------------------------------- | ---------- |
| `Pengembalian Dana Berhasil`    | `refund`   |
| `Info Transaksi Masuk`          | `income`   |
| `Kamu telah melakukan transfer` | `transfer` |
| `top up e-Wallet`               | `expense`  |
| `dikenakan biaya`               | `expense`  |
| `Bukti Pembayaran`              | `expense`  |
| `E-Receipt`                     | `expense`  |

## 5.3 Payment Method Inference

| Sender               | Payment Method |
| -------------------- | -------------- |
| `blubybcadigital.id` | `blu`          |
| `linebank.co.id`     | `LINE Bank`    |
| `jago.com`           | `Jago`         |
| `kai.id`             | `KAI`          |
| `tiket.com`          | `tiket.com`    |
| `grab.com`           | `Grab`         |
| `shopee.co.id`       | `Shopee`       |
| `tokopedia.com`      | `Tokopedia`    |
| `agoda.com`          | `Agoda`        |

## 6. Retry Failed Guide

Retry Failed hanya boleh memproses:

* `failed`

* `retry_later`

Tidak boleh memproses:

* `approved`

* `pending_review`

* `skipped`

* `rejected`

* `duplicate`

Flow:

```txt
Get failed/retry_later items
  ↓
Process in small batches
  ↓
Try AI extraction
  ↓
If AI fails, try fallback parser
  ↓
If amount found, pending_review
  ↓
If no amount, skipped/rejected
  ↓
If temporary error, retry_later
  ↓
If duplicate, duplicate
  ↓
Update Gmail failed notification via dedupe key
```

## 7. Supabase Verification Queries

### Core Tables

```sql
select table_schema, table_name
from information_schema.tables
where table_schema = 'public'
and table_name in (
  'profiles',
  'categories',
  'transactions',
  'budgets',
  'gmail_sync_logs',
  'notifications'
)
order by table_name;
```

### Gmail Logs Columns

```sql
select column_name, data_type, is_nullable
from information_schema.columns
where table_schema = 'public'
and table_name = 'gmail_sync_logs'
order by ordinal_position;
```

### Transactions Columns

```sql
select column_name, data_type, is_nullable
from information_schema.columns
where table_schema = 'public'
and table_name = 'transactions'
order by ordinal_position;
```

### Notification Duplicates

```sql
select user_id, dedupe_key, count(*) as total
from public.notifications
where dedupe_key is not null
group by user_id, dedupe_key
having count(*) > 1
order by total desc;
```

## 8. Development Debug Checklist

Saat debugging Gmail Sync:

* [ ] Cek browser console
* [ ] Cek Network response
* [ ] Cek server logs
* [ ] Cek Gemini health endpoint
* [ ] Cek Supabase query error
* [ ] Cek Gmail token
* [ ] Cek batch item payload
* [ ] Cek raw AI response hanya di development
* [ ] Cek fallback parser result
* [ ] Cek final status mapping
* [ ] Cek notification dedupe

## 9. Production Safety Rules

Jangan lakukan:

* Jangan log Gmail token

* Jangan log service role key

* Jangan tampilkan full email body

* Jangan simpan full email body di Supabase

* Jangan disable RLS permanen

* Jangan drop table existing

* Jangan hapus data user

* Jangan retry semua email tanpa filter status

* Jangan membuat transaksi tanpa idempotency key

* Jangan membuat notification duplicate

Wajib:

* Semua query user scoped

* Semua insert memakai `user_id`

* Semua Gmail Sync log memakai `gmail_message_id`

* Semua retry pakai idempotency

* Semua notification summary pakai dedupe key

* Semua technical error punya error code

* Semua UI error punya userMessage yang jelas

## 10. Quick Fix Decision Tree

```txt
Email gagal?
  ↓
Apakah error token/permission?
  → gmail_permission_required

Apakah error config/schema/RLS?
  → config_error

Apakah error rate limit/timeout?
  → retry_later

Apakah duplicate gmail_message_id?
  → duplicate

Apakah AI JSON invalid?
  → repair JSON
      ↓
      gagal?
        → fallback parser
            ↓
            nominal ada?
              → pending_review
            nominal tidak ada?
              → skipped

Apakah email promo/newsletter?
  → rejected

Apakah sender terpercaya tapi tidak ada nominal?
  → skipped

Apakah benar-benar server bug?
  → failed
```

## 11. Final Validation Template

| Test                  | Result | Notes |
| --------------------- | ------ | ----- |
| Gmail connected       |        |       |
| Gemini health OK      |        |       |
| Scan 5 failed emails  |        |       |
| Scan 20 failed emails |        |       |
| Retry Failed          |        |       |
| blu fallback          |        |       |
| LINE Bank fallback    |        |       |
| Jago fallback         |        |       |
| KAI fallback          |        |       |
| tiket.com fallback    |        |       |
| Notification dedupe   |        |       |
| Supabase insert logs  |        |       |
| Build                 |        |       |
| Lint                  |        |       |
