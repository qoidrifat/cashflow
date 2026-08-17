-- =============================================
-- CashFlow Database Migration — 0005
-- wallet_accounts: opening balance (P2.5 account-based ledger)
-- =============================================
-- Latar belakang: docs/financial/FINANCIAL_CALCULATION_INTEGRITY.md (P2.5).
-- "Total Saldo" selama ini = Lifetime Net Cash Flow (dengan heuristik Skr A/B),
-- BUKAN Current Balance. Current Balance membutuhkan konsep opening balance
-- per akun. Migration ini menambahkan kolom secara ADDITIVE pada tabel
-- wallet_accounts (registry akun canonical — yang sudah punya CRUD /api/wallets
-- dan dipakai Professional Suite).
--
-- Semantik:
--   opening_balance      : saldo akun pada opening_balance_date (NULL =
--                          belum dikonfigurasi → currentBalance.status =
--                          "unknown"/"partial"; JANGAN diasumsikan 0).
--                          REAL nullable — saldo awal NEGATIF sah (credit
--                          card). CHECK `balance >= 0` existing hanya mengikat
--                          kolom `balance` (snapshot denormalized), TIDAK
--                          menyentuh kolom baru ini.
--   opening_balance_date : tanggal saldo awal; ledger menghitung pergerakan
--                          HANYA untuk transaksi dengan transaction_date >=
--                          opening_balance_date (semantik: saldo awal =
--                          balance pada START of day tanggal tsb, transaksi
--                          tanggal sama MASUK pergerakan — konsisten, lihat
--                          financialLedger.js).
--   currency             : ISO 4217; default 'IDR'. Murni metadata display.
--
-- Aman: ALTER ADD COLUMN (SQLite) = additive, legacy rows tetap terbaca
-- (kolom baru NULL/'IDR'), tanpa DROP/UPDATE data. Idempoten via ALTER
-- didukung runner? TIDAK — ALTER bukan idempoten, karena itu migration
-- terpisah bernomor (runner hanya menjalankan sekali; checksum mencegah
-- edit ulang). Boot path turso-schema.sql TIDAK diedit (kebijakan: semua
-- perubahan schema baru = migration numbered).
ALTER TABLE wallet_accounts
  ADD COLUMN opening_balance REAL;

ALTER TABLE wallet_accounts
  ADD COLUMN opening_balance_date TEXT;

ALTER TABLE wallet_accounts
  ADD COLUMN currency TEXT NOT NULL DEFAULT 'IDR';
