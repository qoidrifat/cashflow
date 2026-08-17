-- =============================================
-- CashFlow Database Migration — 0008
-- P2.6: real-world balance verification + reconciliation audit
-- =============================================
-- Latar belakang: docs/financial/FINANCIAL_CALCULATION_INTEGRITY.md (P2.6).
-- Setelah onboarding rekening (opening balance + account linkage), user perlu
-- memverifikasi saldo dengan angka bank/e-wallet NYATA dan setiap klasifikasi
-- akun harus AUDITABLE. Semua perubahan ADDITIVE (tanpa DROP/DELETE/UPDATE
-- data existing):
--
-- 1) wallet_accounts.real_balance            : saldo aktual menurut bank/
--    e-wallet (input user — TIDAK pernah ditebak sistem). NULL = belum
--    diverifikasi. Bisa negatif (credit/overdraft).
--    real_balance_date                       : tanggal saldo aktual diambil.
--    real_balance_verified_at                : timestamp verifikasi (status
--    VERIFIED/MISMATCH diturunkan dari diff system vs actual, bukan kolom).
--
-- 2) transactions.account_review_status      : 'pending' (belum ditinjau) |
--    'confirmed' (klasifikasi akun diterima user) | 'rejected' (ditolak —
--    saran tidak muncul ulang). DEFAULT 'pending' → semua legacy = perlu
--    tinjauan; kolom hanya berubah lewat aksi user (tidak pernah auto).
--
-- 3) reconciliation_audit_log (tabel baru)   : jejak audit klasifikasi
--    finansial per-user (actor=userId dari sesi, TIDAK ada token/secret/
--    body Gmail). action: account_assigned | account_reassigned |
--    transfer_paired | balance_verified | balance_mismatch.
ALTER TABLE wallet_accounts
  ADD COLUMN real_balance REAL;

ALTER TABLE wallet_accounts
  ADD COLUMN real_balance_date TEXT;

ALTER TABLE wallet_accounts
  ADD COLUMN real_balance_verified_at TEXT;

ALTER TABLE transactions
  ADD COLUMN account_review_status TEXT NOT NULL DEFAULT 'pending';

CREATE TABLE IF NOT EXISTS reconciliation_audit_log (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  action TEXT NOT NULL,
  transaction_id TEXT,
  old_account_id TEXT,
  new_account_id TEXT,
  old_transfer_group_id TEXT,
  new_transfer_group_id TEXT,
  reason TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_recon_audit_user_created
  ON reconciliation_audit_log(user_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_recon_audit_tx
  ON reconciliation_audit_log(user_id, transaction_id);
