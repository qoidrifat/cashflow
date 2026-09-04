-- P2.9 §41 hardening (audit 2026-09-04) — Wallet activation idempoten
-- Root cause: POST /api/wallets dengan activation=true melakukan
-- check-then-insert (SELECT existing → INSERT) yang TIDAK atomik. Dua request
-- simultan dengan nama sama bisa sama-sama lolos SELECT → double insert.
-- Solusi: unique partial index (user_id, lower(name)) untuk baris aktif
-- (archived = 0). Route menangkap UNIQUE violation → kembalikan id existing.
--
-- Aman: additive (CREATE INDEX IF NOT EXISTS). Tidak mengubah data.
-- Backfill guard: bila DB sudah punya duplikat (chance rendah karena route
-- selalu cek existing dulu), migration GAGAL — perlu dedupe manual dulu.
CREATE UNIQUE INDEX IF NOT EXISTS idx_wallets_user_name_active
  ON wallet_accounts(user_id, lower(name))
  WHERE archived = 0;
