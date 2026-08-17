-- =============================================
-- CashFlow Database Migration — 0007
-- transactions: transfer_group_id (P2.5 explicit transfer pairing)
-- =============================================
-- Latar belakang: docs/financial/FINANCIAL_CALCULATION_INTEGRITY.md (P2.5).
-- Transfer internal (Akun A → Akun B, milik user sendiri) TIDAK mengubah total
-- kekayaan kas internal: di account ledger A = -amount, B = +amount,
-- aggregate = 0. Pairing saat ini hanya lewat HEURISTIK Skr A/B (same
-- merchant/date/amount) yang merupakan legacy reconciliation — bukan
-- accounting truth.
--
-- transfer_group_id: string grup eksplisit yang memasangkan dua baris
-- transaksi (leg transfer keluar + leg transfer masuk). NULL = legacy
-- (pairing via heuristic tetap dipakai hanya untuk netCashFlow Mode B;
-- ledger account-based TIDAK menebak pasangan tanpa group id — transfer
-- tanpa group dianggap external outflow/inflow sesuai arah akunnya).
--
-- Dua baris dengan transfer_group_id SAMA:
--   - leg "out" (account_id = akun sumber, direction out)
--   - leg "in"  (account_id = akun tujuan, direction in)
-- Keduanya tetap baris transaksi normal (type 'transfer') sehingga riwayat
-- per-akun dan per-merchant tetap utuh; aggregate ledger menyatukan group.
--
-- Aman: ALTER ADD COLUMN additive; NULL untuk legacy; CREATE INDEX
-- IF NOT EXISTS untuk lookups user-scoped.
ALTER TABLE transactions
  ADD COLUMN transfer_group_id TEXT;

CREATE INDEX IF NOT EXISTS idx_transactions_user_transfer_group
  ON transactions(user_id, transfer_group_id);
