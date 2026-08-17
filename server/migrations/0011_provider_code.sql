-- P0.11 — Account Onboarding & Provider Catalog
-- Additive: tambahkan kolom provider_code pada wallet_accounts (link ke
-- provider catalog). Tidak menghapus kolom/baris, tidak mengubah balance/
-- anchor/transaksi. Aman & reversible (DROP COLUMN bila diperlukan).
--
-- Backfill: kaitkan baris existing yang NAMA-nya cocok dengan provider katalog
-- (LINE Bank = line_bank). Key = name (bukan institution — di data dev ini
-- institution kosong). Guard: hanya baris provider_code IS NULL.
ALTER TABLE wallet_accounts ADD COLUMN provider_code TEXT;

UPDATE wallet_accounts
   SET provider_code = 'line_bank'
 WHERE provider_code IS NULL
   AND LOWER(TRIM(name)) = 'line bank';
