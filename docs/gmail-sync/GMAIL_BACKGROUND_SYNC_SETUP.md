# Gmail Background Sync Setup

## 1. Overview

Dokumen ini menjelaskan cara mengaktifkan **background auto sync** untuk Gmail Sync CashFlow.

**Client-side Auto Sync** (yang sudah berjalan):
- Scan berjalan saat aplikasi aktif dan tab Gmail Sync terbuka
- Menggunakan `setInterval` 60 detik untuk cek apakah scan due
- Tidak memerlukan setup tambahan

**Server-side Background Sync** (yang akan di-setup di sini):
- Scan berjalan di latar belakang via Supabase Edge Function
- Tidak perlu membuka aplikasi
- Dipicu oleh Supabase Scheduled Function / Cron

## 2. Prerequisites

1. **Supabase Project** (already configured — `bwczweuomlwmgwgrsadt`)
2. **Supabase CLI** terinstal (sudah ada)
3. **Google OAuth** dengan `access_type=offline` dan `prompt=consent`
4. **Gmail readonly scope** — sudah di-setup di OAuth
5. **Supabase Pro plan** atau higher (untuk cron jobs)

## 3. Arsitektur

```txt
Supabase Scheduled Function (Cron - setiap 15 menit)
        │
        ▼
Supabase Edge Function: gmail-auto-sync
        │
        ├── Ambil user dengan auto_sync_enabled = true
        ├── Cek next_sync_at <= now()
        ├── Dapatkan Gmail token dari auth.sessions (service_role)
        ├── Fetch email baru dari Gmail API
        ├── Proses dengan fallback extraction
        ├── Simpan ke gmail_sync_logs
        └── Update gmail_sync_settings
```

## 4. Deploy Edge Function

### 4.1 Set Environment Secrets

```bash
# Login ke Supabase (jika belum)
supabase login

# Set secrets yang dibutuhkan Edge Function
supabase secrets set SUPABASE_URL=https://bwczweuomlwmgwgrsadt.supabase.co
supabase secrets set SUPABASE_SERVICE_ROLE_KEY=eyJhbGciOi...  # Ganti dengan service_role key dari Dashboard
supabase secrets set CRON_SECRET=your-custom-cron-secret-here  # Opsional, untuk keamanan cron
supabase secrets set MAX_EMAILS_PER_USER=50
supabase secrets set CONCURRENCY_LIMIT=3
```

**⚠️ Jangan expose service_role key ke frontend. Jangan commit secret ke git.**

### 4.2 Deploy Function

```bash
cd /d/Workspace/cashflow

# Deploy function tanpa JWT verification (karena dipanggil oleh cron)
supabase functions deploy gmail-auto-sync --no-verify-jwt
```

### 4.3 Verifikasi Deploy

```bash
# Cek daftar functions
supabase functions list

# Test function manual
curl -X POST https://bwczweuomlwmgwgrsadt.supabase.co/functions/v1/gmail-auto-sync \
  -H "Authorization: Bearer YOUR_CRON_SECRET" \
  -H "Content-Type: application/json"
```

## 5. Setup Cron Schedule

### 5.1 Via Supabase Dashboard

1. Buka [Supabase Dashboard](https://supabase.com/dashboard/project/bwczweuomlwmgwgrsadt)
2. Navigasi ke **Database** → **Scheduled Functions**
3. Klik **Enable Scheduled Functions** (jika belum)
4. Klik **Create a new schedule**
5. Isi:
   - **Name**: `gmail-auto-sync-cron`
   - **Schedule**: `*/15 * * * *` (setiap 15 menit)
   - **Function hook**: `https://bwczweuomlwmgwgrsadt.supabase.co/functions/v1/gmail-auto-sync`
   - **Method**: `POST`
   - **Headers** (opsional): `Authorization: Bearer YOUR_CRON_SECRET`
6. Klik **Create**

### 5.2 Via SQL (alternatif)

```sql
-- Enable pg_cron extension
create extension if not exists pg_cron;

-- Schedule function call every 15 minutes
select cron.schedule(
  'gmail-auto-sync-cron',
  '*/15 * * * *',
  $$select net.http_post(
    url:='https://bwczweuomlwmgwgrsadt.supabase.co/functions/v1/gmail-auto-sync',
    headers:='{"Authorization":"Bearer YOUR_CRON_SECRET"}'::jsonb
  ) as request_id;
  $$
);

-- View all schedules
select * from cron.job;

-- Delete schedule (if needed)
-- select cron.unschedule('gmail-auto-sync-cron');
```

## 6. Test Manual

### 6.1 Direct Test

```bash
# Pastikan ada user dengan auto_sync_enabled = true
supabase db query "SELECT user_id, auto_sync_enabled, next_sync_at FROM public.gmail_sync_settings WHERE auto_sync_enabled = true;"

# Test function
curl -X POST https://bwczweuomlwmgwgrsadt.supabase.co/functions/v1/gmail-auto-sync \
  -H "Authorization: Bearer YOUR_CRON_SECRET"

# Cek hasil
supabase db query "SELECT * FROM public.gmail_sync_runs ORDER BY started_at DESC LIMIT 5;"
supabase db query "SELECT final_status, count(*) FROM public.gmail_sync_logs WHERE metadata->>'source' = 'auto_sync_background' GROUP BY final_status;"
```

### 6.2 Cek Logs

```bash
# Cek logs function
supabase functions logs gmail-auto-sync --limit 50
```

## 7. Cara Kerja Sync

### Flow

```txt
1. Cron trigger setiap 15 menit
2. Edge Function query gmail_sync_settings WHERE auto_sync_enabled = true AND next_sync_at <= now()
3. Untuk setiap user:
   a. Ambil Gmail access token dari auth.sessions (via service_role)
   b. Cek last_synced_at — jika ada, fetch email setelah tanggal itu
   c. Jika belum pernah, fetch email dari 2026-01-01
   d. Cek duplicate by gmail_message_id
   e. Klasifikasi setiap email (prefilter rules)
   f. Jika transaksi: extract amount via fallback regex
   g. Jika amount ditemukan: save sebagai pending_review
   h. Jika tidak: save sebagai skipped
   i. Update gmail_sync_settings: last_synced_at, next_sync_at
   j. Buat notification summary jika ada pending review
4. Return summary hasil
```

### Error Handling

| Error | Tindakan |
|-------|----------|
| GMAIL_TOKEN_INVALID | Skip user, update settings dengan error code |
| GMAIL_FETCH_FAILED | Skip user, retry di cron berikutnya |
| SUPABASE_ERROR | Log error, function tetap lanjut ke user berikutnya |

## 8. Monitoring

### Cek Status Auto Sync per User

```sql
SELECT 
  user_id,
  auto_sync_enabled,
  sync_interval_minutes,
  last_synced_at,
  next_sync_at,
  last_status,
  last_error_code,
  last_result_summary
FROM public.gmail_sync_settings
ORDER BY auto_sync_enabled DESC, next_sync_at ASC;
```

### Cek Riwayat Sync

```sql
SELECT 
  id,
  user_id,
  sync_type,
  status,
  started_at,
  finished_at,
  total_found,
  total_processed,
  pending_review_count,
  failed_count
FROM public.gmail_sync_runs
ORDER BY started_at DESC
LIMIT 20;
```

### Cek Email yang Diproses Background

```sql
SELECT 
  subject,
  sender,
  final_status,
  error_code,
  fallback_used,
  scanned_at
FROM public.gmail_sync_logs
WHERE metadata->>'source' = 'auto_sync_background'
ORDER BY scanned_at DESC
LIMIT 20;
```

### Cek Logs Edge Function

```bash
supabase functions logs gmail-auto-sync --limit 100
```

## 9. Troubleshooting

### Token Gmail Missing

**Gejala**: Error `GMAIL_TOKEN_MISSING` untuk user tertentu.

**Solusi**:
1. User perlu reconnect Google dengan `access_type=offline` dan `prompt=consent`
2. Di halaman Gmail Sync, klik **Reset Izin** lalu **Hubungkan Gmail** lagi
3. Pastikan Google Provider di Supabase Dashboard sudah memiliki scope Gmail:

```txt
https://www.googleapis.com/auth/gmail.readonly
```

4. Setelah reconnect, cek apakah token tersimpan:
```sql
SELECT user_id, provider_token IS NOT NULL as has_token
FROM auth.sessions
ORDER BY created_at DESC
LIMIT 5;
```

### Cron Tidak Berjalan

**Cek**:
1. Pastikan Supabase Pro plan aktif
2. Cek Scheduled Functions di Dashboard
3. Cek logs:
```sql
select * from cron.job_run_details order by start_time desc limit 10;
```

### Function Error

**Gejala**: Function gagal dengan error 500.

**Cek**:
```bash
supabase functions logs gmail-auto-sync --limit 50
```

### Duplicate Email

Background sync menggunakan `gmail_message_id` sebagai idempotency key. Pastikan email tidak diproses ulang dengan cek:

```sql
SELECT gmail_message_id, count(*)
FROM public.gmail_sync_logs
GROUP BY gmail_message_id
HAVING count(*) > 1;
```

## 10. Rollback / Disable

### Hentikan Cron

```sql
select cron.unschedule('gmail-auto-sync-cron');
```

### Nonaktifkan Auto Sync untuk Semua User

```sql
UPDATE public.gmail_sync_settings
SET auto_sync_enabled = false, next_sync_at = NULL;
```

### Hapus Function

```bash
supabase functions delete gmail-auto-sync
```

## 11. Client vs Background: Perbandingan

| Fitur | Client-side | Server-side (Background) |
|-------|-------------|--------------------------|
| Scan berjalan saat app aktif | ✅ | ✅ |
| Scan berjalan saat app tertutup | ❌ | ✅ |
| Menggunakan AI extraction | ✅ | ❌ (hanya fallback) |
| Membutuhkan setup | ❌ | ✅ Edge Function + Cron |
| Membutuhkan token offline | ❌ | ✅ |
| Biaya | Gratis | Supabase Pro + Edge Function |
| Kecepatan | Langsung | Maks 15 menit delay |

## 12. Security Notes

- **Jangan expose** `SUPABASE_SERVICE_ROLE_KEY` ke frontend
- **Jangan simpan** full email body di Supabase
- **Jangan commit** secret ke git
- **Gunakan cron secret** untuk melindungi endpoint function
- Semua query di Edge Function menggunakan service_role, tetap validasi `user_id`
