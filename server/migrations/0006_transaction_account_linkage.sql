-- =============================================
-- CashFlow Database Migration — 0006
-- transactions: account linkage (P2.5 account-based ledger)
-- =============================================
-- Latar belakang: docs/financial/FINANCIAL_CALCULATION_INTEGRITY.md (P2.5).
-- Current Balance butuh atribusi transaksi ke akun. Kolom ini ADDITIVE dan
-- OPTIONAL:
--   transactions.account_id → wallet_accounts.id (tidak ada FK enforced —
--     libSQL lokal tidak enforce FK by default; legacy rows harus tetap aman
--     dengan NULL).
--   Legacy transaction TANPA linkage → account_id = NULL → status
--     "unclassified" (currentBalance.status = "partial"), BUKAN di-assign
--     otomatis ke akun (anti fabricasi; klasifikasi butuh konfirmasi user).
--
-- Index (user_id, account_id) untuk agregasi per-akun yang user-scoped dan
-- windowless.
--
-- Aman: ALTER ADD COLUMN additive; NULL untuk semua baris legacy; tanpa
-- UPDATE data; tanpa DROP. Index baru via CREATE INDEX IF NOT EXISTS.
ALTER TABLE transactions
  ADD COLUMN account_id TEXT;

CREATE INDEX IF NOT EXISTS idx_transactions_user_account
  ON transactions(user_id, account_id);
