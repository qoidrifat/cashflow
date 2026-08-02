# [requirements.md](https://requirements.md)

# CashFlow Supabase Core Schema Fix Requirements

## 1. Overview

Dokumen ini mendefinisikan requirement untuk memperbaiki error database CashFlow setelah migrasi ke Supabase.

Error utama:

```txt
Gagal Memuat Data
Could not find the table 'public.transactions' in the schema cache
```

Kondisi saat ini:

* Supabase Google Auth sudah berhasil digunakan untuk login real.

* User berhasil masuk ke aplikasi.

* Error muncul saat halaman beranda/dashboard mencoba mengambil data transaksi.

* Error berasal dari Supabase/PostgREST karena table `public.transactions` tidak ditemukan dalam schema cache.

Tujuan utama perbaikan:

* Memastikan core database table CashFlow tersedia di Supabase project aktif.

* Memastikan table berada di schema `public`.

* Memastikan schema cache Supabase/PostgREST reload.

* Memastikan RLS aktif dan aman.

* Memastikan dashboard bisa load tanpa error.

* Memastikan query service layer sesuai dengan schema Supabase.

* Memastikan Gmail Sync dan Supabase Auth tidak rusak.

## 2. Scope

Perbaikan ini mencakup:

1. Verifikasi Supabase project aktif.

2. Verifikasi environment variable.

3. Verifikasi keberadaan table core:

   * `profiles`

   * `categories`

   * `transactions`

   * `budgets`

   * `gmail_sync_logs`

   * `notifications`

4. Pembuatan migration/schema jika table belum ada.

5. Pembuatan index performa.

6. Aktivasi Row Level Security.

7. Pembuatan RLS policies berbasis `auth.uid()`.

8. Reload schema cache.

9. Audit service layer Supabase.

10. Perbaikan dashboard error handling.

11. Build/lint validation.

12. Update dokumentasi migrasi.

## 3. Out of Scope

Hal berikut tidak termasuk dalam scope perbaikan ini:

1. Mengubah ulang UI besar-besaran.

2. Mengganti Supabase Auth yang sudah berhasil.

3. Mengganti Gmail Auth/Gmail Sync yang sudah berhasil.

4. Menghapus data user.

5. Drop table existing tanpa konfirmasi.

6. Disable RLS permanen.

7. Menambahkan fitur baru di luar perbaikan schema dan dashboard loading.

8. Mengubah Notification System spec yang sudah ada.

## 4. User Stories

### 4.1 Dashboard Loads Successfully

Sebagai user, saya ingin dashboard CashFlow berhasil memuat data setelah login, agar saya bisa melihat ringkasan keuangan tanpa error.

Acceptance Criteria:

* Setelah login Supabase Google Auth, user diarahkan ke dashboard.

* Dashboard tidak menampilkan error `public.transactions not found`.

* Jika belum ada transaksi, dashboard menampilkan empty state atau nilai 0.

* Tidak ada pop-up error schema cache.

* User bisa klik `Coba Lagi` dan data berhasil dimuat jika sebelumnya gagal karena transient issue.

### 4.2 Safe Database Schema

Sebagai developer, saya ingin semua core table CashFlow tersedia di Supabase, agar service layer aplikasi bisa berjalan stabil.

Acceptance Criteria:

* Table `public.transactions` tersedia.

* Table `public.categories` tersedia.

* Table `public.budgets` tersedia.

* Table `public.gmail_sync_logs` tersedia.

* Table `public.notifications` tersedia.

* Table `public.profiles` tersedia.

* Semua table berada di schema `public`.

### 4.3 Secure User-Owned Data

Sebagai user, saya ingin data keuangan saya hanya bisa diakses oleh akun saya sendiri.

Acceptance Criteria:

* RLS aktif pada semua table user-owned.

* Policy menggunakan `auth.uid()`.

* User hanya bisa select/insert/update/delete data miliknya sendiri.

* Tidak ada query global tanpa `user_id`.

* Tidak ada service role key di frontend.

### 4.4 Stable Migration History

Sebagai developer, saya ingin schema fix tercatat rapi dalam migration atau dokumentasi execution report.

Acceptance Criteria:

* Jika Supabase CLI tersedia, migration dibuat melalui command resmi.

* Jika MCP direct SQL digunakan, SQL yang dijalankan didokumentasikan.

* Execution report diperbarui.

* Tidak ada migration destruktif.

* Tidak ada table yang di-drop.

### 4.5 Service Layer Compatibility

Sebagai developer, saya ingin service layer sesuai dengan schema Supabase, agar tidak ada error column/table mismatch.

Acceptance Criteria:

* Query memakai table name yang benar.

* Query memakai column name snake_case sesuai database.

* Jika UI memakai camelCase, tersedia mapper.

* Dashboard memakai `transaction_date`, bukan `date`.

* Query memakai `user_id`, bukan `userId`.

* Insert/update memakai `user_id = session.user.id`.

## 5. Functional Requirements

### FR-01 — Verify Supabase Project

Sistem harus memverifikasi bahwa environment variable Supabase mengarah ke project yang benar.

Project ref target:

```txt
bwczweuomlwmgwgrsadt
```

Requirements:

* Cek `VITE_SUPABASE_URL` atau `NEXT_PUBLIC_SUPABASE_URL`.

* Cek anon key tersedia.

* Jangan print secret ke console.

* Jika `.env.local` salah, dokumentasikan manual step.

* Update `.env.example` jika diperlukan.

### FR-02 — Verify Core Tables

Sistem harus mengecek keberadaan table core di schema `public`.

Query verifikasi:

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

Expected result:

* Semua table core muncul.

* Jika ada table hilang, jalankan migration/schema fix.

### FR-03 — Create Missing Tables Safely

Jika table core belum ada, sistem harus membuat table dengan SQL aman.

Rules:

* Gunakan `create table if not exists`.

* Jangan gunakan `drop table`.

* Jangan hapus data existing.

* Tambahkan foreign key yang aman.

* Gunakan `gen_random_uuid()`.

* Pastikan `transactions` dibuat sebelum `gmail_sync_logs` foreign key ke transactions.

### FR-04 — Add Performance Indexes

Sistem harus membuat index untuk query utama.

Minimum indexes:

* `transactions (user_id, transaction_date desc)`

* `transactions (user_id, type, transaction_date desc)`

* `transactions (user_id, category_id, transaction_date desc)`

* `budgets (user_id, year, month)`

* `categories (user_id, type)`

* `gmail_sync_logs (user_id, scanned_at desc)`

* `gmail_sync_logs (user_id, final_status)`

* `notifications (user_id, read, created_at desc)`

* `notifications (user_id, created_at desc)`

### FR-05 — Enable RLS

Sistem harus mengaktifkan RLS untuk semua table user-owned.

Tables:

* `profiles`

* `categories`

* `transactions`

* `budgets`

* `gmail_sync_logs`

* `notifications`

### FR-06 — Create RLS Policies

Sistem harus membuat policy untuk user-owned data.

Policy pattern:

```sql
using (user_id = auth.uid())
with check (user_id = auth.uid())
```

Policy harus berlaku untuk:

* SELECT

* INSERT

* UPDATE

* DELETE

Boleh memakai `for all` jika sesuai.

### FR-07 — Reload Schema Cache

Setelah table, index, dan policy dibuat, sistem harus menjalankan:

```sql
notify pgrst, 'reload schema';
```

Acceptance:

* Error `Could not find the table 'public.transactions' in the schema cache` hilang setelah refresh/retry.

### FR-08 — Fix Service Layer Mismatch

Sistem harus audit dan memperbaiki mismatch antara UI model dan database columns.

Mappings:

* `userId` ↔ `user_id`

* `createdAt` ↔ `created_at`

* `updatedAt` ↔ `updated_at`

* `date` ↔ `transaction_date`

* `categoryId` ↔ `category_id`

* `categoryName` ↔ `category_name`

* `gmailMessageId` ↔ `gmail_message_id`

* `confidenceScore` ↔ `confidence_score`

* `paymentMethod` ↔ `payment_method`

Jika perlu, buat mapper:

* row to app model

* app input to database row

### FR-09 — Dashboard Empty State

Jika user belum punya transaksi, dashboard tidak boleh error.

Expected:

* Saldo total: 0

* Pemasukan bulan ini: 0

* Pengeluaran bulan ini: 0

* Recent transactions: empty state

* Tidak ada toast error

### FR-10 — Documentation Update

Sistem harus update dokumentasi:

* `SUPABASE_MIGRATION_EXECUTION_REPORT.md`

* `SUPABASE_DATABASE_SCHEMA.md`

* `SUPABASE_MIGRATION_TUTORIAL.md`

* `SUPABASE_MIGRATION_CHECKLIST.md`

Tambahkan section:

* root cause

* SQL/migration yang dijalankan

* schema cache reload

* RLS status

* dashboard validation

* build/lint result

## 6. Non-Functional Requirements

### NFR-01 — Security

* Jangan expose service role key di frontend.

* Jangan disable RLS permanen.

* Jangan simpan full email body Gmail.

* Jangan query tanpa `user_id`.

* Jangan commit `.env.local`.

### NFR-02 — Performance

* Dashboard load target maksimal 2-3 detik.

* Recent transactions harus memakai limit.

* Reports harus memakai date range.

* Dashboard tidak boleh fetch seluruh transaksi user.

### NFR-03 — Reliability

* Jika table kosong, UI tetap berjalan.

* Jika query gagal, error message harus jelas.

* Jika schema cache stale, ada retry/reload strategy.

* Build harus berhasil setelah fix.

### NFR-04 — Maintainability

* Migration harus rapi.

* Schema harus terdokumentasi.

* Service layer harus punya mapper jika UI pakai camelCase.

* Jangan hardcode project ref di business logic.

## 7. Error States

| Error                  | Expected Handling                              |
| ---------------------- | ---------------------------------------------- |
| Table not found        | Jalankan schema verification dan migration fix |
| Schema cache stale     | Jalankan `notify pgrst, 'reload schema'`       |
| Permission denied      | Cek RLS policy                                 |
| Column not found       | Cek mapper dan service layer                   |
| Empty data             | Tampilkan empty state, bukan error             |
| Wrong Supabase project | Perbaiki env dan dokumentasikan manual step    |
| Network error          | Tampilkan retry state                          |
| Missing user session   | Redirect ke login                              |

## 8. Acceptance Criteria Summary

| ID    | Criteria                                                   |
| ----- | ---------------------------------------------------------- |
| AC-01 | `public.transactions` tersedia di Supabase                 |
| AC-02 | Semua core table CashFlow tersedia                         |
| AC-03 | Schema cache berhasil reload                               |
| AC-04 | RLS aktif pada semua table user-owned                      |
| AC-05 | Policy berbasis `auth.uid()` tersedia                      |
| AC-06 | Dashboard load tanpa schema cache error                    |
| AC-07 | Dashboard menampilkan nilai 0/empty state jika data kosong |
| AC-08 | Transaksi manual bisa dibuat                               |
| AC-09 | Data transaksi tetap muncul setelah refresh                |
| AC-10 | Build berhasil                                             |
| AC-11 | Supabase Auth tetap berjalan                               |
| AC-12 | Gmail Sync tidak rusak                                     |
| AC-13 | Dokumentasi execution report diperbarui                    |
