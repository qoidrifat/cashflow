-- =============================================
-- CashFlow Database Migration — 0004
-- user_financial_settings — akun milik sendiri (transfer internal netral)
-- =============================================
-- Latar belakang: docs/financial/FINANCIAL_CALCULATION_INTEGRITY.md §10.12–§10.13.
-- Rekonsiliasi balance aktual (2026-08-11) menemukan: 72 dari 75 transfer
-- (Rp9.025.162 dari Rp9.312.162) mengarah ke merchant yang merupakan AKUN
-- MILIK USER SENDIRI (LINE Bank, Bank Jago, blu) — uang berpindah antar-akun
-- sendiri, bukan pengeluaran. Formula lama memperlakukan SEMUA transfer
-- sebagai expense (outflow) → balance tampak sangat negatif padahal kekayaan
-- bersih user tidak berubah.
--
-- Keputusan produk (user, 2026-08-11): "Transfer internal = netral" — transfer
-- ke akun milik sendiri TIDAK mengurangi saldo (Skr A: income tetap dihitung).
-- Daftar akun milik sendiri dikonfigurasi per user di tabel ini; formula
-- agregasi (computeFinancialSummary) mengecualikan transfer yang merchant-nya
-- ada di daftar ini dari komponen expense.
--
-- Semantik kolom:
--   own_accounts : JSON array string nama merchant akun milik user sendiri
--                  (mis. ["LINE Bank","blu","Bank Jago"]). DEFAULT '[]' =
--                  perilaku legacy (semua transfer = expense, backward-compat).
--
-- Referensi FK: `users(id)` (legacy identity) — KONSISTEN dengan seluruh tabel
-- bisnis lain (transactions.user_id, gmail_sync_settings.user_id, dst.).
--
-- ⚠️ Perubahan ini TIDAK mengubah data transaksi apa pun — hanya menyediakan
-- konfigurasi per-user. Migration idempoten (CREATE IF NOT EXISTS).
CREATE TABLE IF NOT EXISTS user_financial_settings (
  user_id TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  own_accounts TEXT NOT NULL DEFAULT '[]',
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
