-- =============================================
-- CashFlow Database Migration — 0003
-- Unique partial index (user_id, gmail_message_id) — hardening TOCTOU final
-- =============================================
-- Latar belakang: docs/financial/FINANCIAL_CALCULATION_INTEGRITY.md §10.8 —
-- pre-SELECT gmail_message_id server-side (POST /api/transactions) bersifat
-- ADVISORY: ada window race antar dua request identik (keduanya lolos
-- pre-SELECT sebelum INSERT pertama commit). Index unik ini membuat jaminan
-- ENFORCED: dua transaksi dengan (user_id, gmail_message_id) sama mustahil
-- ada, bahkan saat dua request TANPA Idempotency-Key berlomba (direct API /
-- importer batch masa depan). Melengkapi idx_transactions_user_idempotency
-- (0001) yang hanya menutup request BER-Idempotency-Key.
--
-- Partial: baris tanpa gmail_message_id (NULL / '') TIDAK ikut unik —
-- backward-compatible (transaksi non-gmail / baris lama tak terpengaruh).
-- Konsisten dengan semantik tool cleanup & pre-SELECT (gmail_message_id ''
-- dianggap absen).
--
-- ⚠️ PRASYARAT data BERSIH: migration runner fail-fast → CREATE UNIQUE INDEX
-- GAGAL bila masih ada >1 baris per (user_id, gmail_message_id) non-kosong.
-- Pre-flight ramah (read-only) sebelum menjalankan migration ini:
--   node -- scripts/verifyGmailUniqueIndex.mjs --check-only
-- Jika ada duplikat, bersihkan dulu (lihat §10.7):
--   GM_DUP_CLEANUP_EXECUTE=1 node -- scripts/gmailDuplicateCleanup.mjs --execute --yes
--
-- IF NOT EXISTS: aman untuk env yang index-nya sudah dibuat manual (mis. dev
-- DB 2026-08-11) ATAU DB fresh; TETAP gagal (fail-fast) pada data duplikat
-- (IF NOT EXISTS hanya meng-skip bila NAMA index sudah ada, bukan bila data
-- melanggar constraint).
--
-- ⚠️ GUARD fail-fast definisi: IF NOT EXISTS meng-skip bila index dengan NAMA
-- sama sudah ada — JIKA definisinya ternyata salah (mis. non-unique, atau
-- partial WHERE tanpa eksklusi '' kosong), migration ini akan tercatat
-- applied TANPA hardening yang benar. Guard di bawah memastikan definisi
-- AKTUAL memuat klausa yang disyaratkan sebelum CREATE berjalan; bila tidak,
-- RAISE-level error (998) menggagalkan migration (runner fail-fast → tidak
-- tercatat applied). Env yang sudah punya index benar: guard PASS (no-op).
-- Backstop tambahan: scripts/dbMigrateCheck.mjs (kontrak schema, termasuk
-- klausa WHERE lengkap) — lihat docs/database/MIGRATIONS.md.
--
-- NOTE: guard ini TIDAK pakai string literal kosong (''), karena
-- splitStatements migration runner memecah statement pada SEMUA ';' — dua
-- single-quote berurutan akan memecah SQL secara salah. char(39) dipakai
-- untuk membangun karakter petik tanpa semicolon.
SELECT CASE
  WHEN EXISTS (
    SELECT 1 FROM sqlite_master
    WHERE type='index' AND name='idx_transactions_gmail_msg_unique'
      AND (
        sql NOT LIKE 'CREATE UNIQUE INDEX%'
        OR sql NOT LIKE '%WHERE gmail_message_id IS NOT NULL AND gmail_message_id != ' || char(39) || char(39) || '%'
      )
  ) THEN 998 ELSE 1 END;

CREATE UNIQUE INDEX IF NOT EXISTS idx_transactions_gmail_msg_unique
  ON transactions(user_id, gmail_message_id)
  WHERE gmail_message_id IS NOT NULL AND gmail_message_id != '';
