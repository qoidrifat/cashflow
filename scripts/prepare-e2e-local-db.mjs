#!/usr/bin/env node
/**
 * Siapkan DB libSQL LOKAL (file:) untuk E2E terisolasi (P1.7).
 *
 * Masalah yang dipecahkan: run E2E lokal selama ini memakai DB Turso DEV yang
 * SAMA dengan data user riil — data drift antar run (dan antar dev) membuat
 * spec ber-pin (PINNED di e2e/helpers/fixtures.ts) flaky, dan pengembangan lokal
 * bisa menyentuh data dev. Config `playwright.e2e-local.config.mjs` menjalankan
 * script ini SEBELUM server API boot, menghasilkan database FRESH per run:
 *
 *   .test-data/e2e-local.db   (delete-first — self-healing dari run yang mati)
 *
 * Pipeline:
 *   1. Guard: TURSO_DATABASE_URL WAJIB `file:` (script ini TIDAK PERNAH boleh
 *      menyentuh DB remote/production).
 *   2. Hapus file DB lama (idempoten — tidak ada PK violation pada run ulang).
 *   3. Schema: initTursoSchema (turso-schema.sql, idempoten) + migrationRunner
 *      (schema_migrations versioned — pola produksi yang sama).
 *   4. Seed DETERMINISTIK: buildSeedStatements (dari seedE2eDataset.mjs —
 *      dataset 284 tx / 519 gmail logs yang sama dengan CI) + user seed admin.
 *   5. Verifikasi count vs SEED_DATASET → exit non-zero bila mismatch.
 *
 * Penggunaan (dipanggil oleh config Playwright; bukan manual):
 *   TURSO_DATABASE_URL=file:<abs> node scripts/prepare-e2e-local-db.mjs
 */
import fs from 'node:fs';
import path from 'node:path';
import { createClient } from '@libsql/client';
import { initTursoSchema } from '../server/lib/turso.js';
import { applyMigrations } from '../server/lib/migrationRunner.js';
import { mulberry32, buildSeedStatements, SEED_DATASET, chunkArray } from './seedE2eDataset.mjs';

const url = process.env.TURSO_DATABASE_URL;
if (!url || !url.startsWith('file:')) {
  console.error('[prepareE2eDb] ⛔ TURSO_DATABASE_URL wajib file: URL (DB E2E lokal terisolasi). Diterima:', url || '(kosong)');
  process.exit(1);
}

// Path file DB dari URL `file:` (bisa relatif — normalisasi ke absolut).
const dbPath = url.startsWith('file://')
  ? url.slice('file://'.length)
  : url.slice('file:'.length);
const absPath = path.resolve(dbPath.replace(/\\/g, '/'));
const DB_URL = `file:${absPath.replace(/\\/g, '/')}`;

// ── DELETE-FIRST (self-heal): run yang mati di tengah tidak boleh meninggalkan
// state parsial yang membuat run berikutnya PK violation. DB ini HANYA milik
// test runner (di .test-data/, gitignored) — aman dihapus.
if (fs.existsSync(absPath)) {
  fs.rmSync(absPath, { force: true });
}
fs.mkdirSync(path.dirname(absPath), { recursive: true });

const client = createClient({ url: DB_URL, authToken: 'local-e2e' });
const ADMIN_EMAIL = (process.env.ADMIN_EMAILS || '')
  .split(',')[0]?.trim().toLowerCase() || 'e2e-seed-admin@cashflow.test';

async function main() {
  try {
    // ── WAL mode ──
    // SQLite lokal default = rollback journal: writer memegang lock EKSKLUSIF
    // → reader proses lain (client test) kena SQLITE_BUSY saat server menulis
    // (terbukti spec ai-conversation). WAL: reader tidak pernah diblokir
    // writer (persisten di file DB — semua koneksi ikut). Standar untuk DB
    // SQLite multi-proses; aman untuk DB test sekali-pakai.
    await client.execute('PRAGMA journal_mode=WAL');

    // ── Schema (idempoten) + migrasi versioned ──
    await initTursoSchema(client, { retry: true });
    const migrationResult = await applyMigrations(client);
    const migrationCount = migrationResult.applied.length;

    // ── User seed admin (singular `user` better-auth + plural `users` bisnis) ──
    const seedUserId = `e2e-local-${Date.now().toString(36)}`;
    await client.execute({
      sql: `INSERT INTO user (id, name, email, emailVerified) VALUES (?, ?, ?, 1) ON CONFLICT(id) DO NOTHING`,
      args: [seedUserId, 'E2E Seed Admin', ADMIN_EMAIL],
    });
    await client.execute({
      sql: `INSERT INTO users (id, email, name, display_name) VALUES (?, ?, ?, ?) ON CONFLICT(id) DO NOTHING`,
      args: [seedUserId, ADMIN_EMAIL, 'E2E Seed Admin', 'E2E Seed Admin'],
    });
    // Gmail auto-sync settings: seed DETERMINISTIK (auto_sync_enabled=1) supaya
    // gate a11y gmail-sync ("Interval" hanya dirender saat auto-sync aktif) lulus
    // pada DB FRESH — tanpa baris ini gate bergantung pada state sisa run lama.
    await client.execute({
      sql: `INSERT INTO gmail_sync_settings (user_id, auto_sync_enabled, sync_interval_minutes, max_emails_per_sync, auto_approve_threshold)
            VALUES (?, 1, 60, 25, 0.88) ON CONFLICT(user_id) DO UPDATE SET auto_sync_enabled = 1`,
      args: [seedUserId],
    });

    // ── Seed dataset deterministik (SAMA dengan CI: 284 tx / 519 logs) ──
    const rng = mulberry32(20260802);
    const nowMs = Date.now();
    const { stmts } = buildSeedStatements({ seedUserId, rng, nowMs });
    for (const chunk of chunkArray(stmts, 100)) {
      await client.batch(chunk);
    }

    // ── Demo user (Dafa) + timeline events — SAMA dengan scripts/seedDemoData.mjs
    // (TIMELINE array) sehingga spec demo (ai-detail-events demo-tl-0/2,
    // ai-status-machine demo-tl-4) jalan terhadap DB terisolasi. Id user STABIL
    // (prefiks e2e-demo-) karena event ai_timeline mereferensikannya; email
    // demo@cashflow.test TIDAK berawalan 'e2e-' sehingga cleanup test sesi/user
    // tidak pernah menyentuhnya. created_at = space-format UTC relatif now. ──
    const demoUserId = 'e2e-demo-dafa';
    const demoEmail = 'demo@cashflow.test';
    await client.execute({
      sql: `INSERT INTO user (id, name, email, emailVerified, createdAt, updatedAt, displayName)
            VALUES (?, ?, ?, 1, ?, ?, ?) ON CONFLICT(id) DO NOTHING`,
      args: [demoUserId, 'Dafa Preview', demoEmail, Math.floor(Date.now() / 1000) - 30 * 86400, Math.floor(Date.now() / 1000), 'Dafa Preview'],
    });
    await client.execute({
      sql: `INSERT INTO users (id, email, name, display_name) VALUES (?, ?, ?, ?) ON CONFLICT(id) DO NOTHING`,
      args: [demoUserId, demoEmail, 'Dafa Preview', 'Dafa Preview'],
    });
    // [daysAgo, feature, eventType, status, title, body, confidence, payload]
    const DEMO_TIMELINE = [
      [1, 'insight', 'insight', 'viewed', 'Pengeluaran makanan naik 27%', 'Belanja GoFood dan ShopeeFood meningkat vs minggu sebelumnya. Pertimbangkan batas harian.', 0.82, { periodDays: 7, expense: 1150000, topCategory: 'Makanan' }],
      [2, 'advisor', 'recommendation', 'completed', 'Kurangi belanja impulsif', 'Total belanja online 668rb minggu ini — tetapkan masa tunggu 24 jam sebelum checkout.', 0.71, { windowDays: 7, shoppingExpense: 668000 }],
      [3, 'conversation', 'conversation', 'completed', 'Kenapa uangku habis minggu ini?', 'Pertanyaan natural language dengan ringkasan ringkas + grafik.', null, { periodDays: 7 }],
      [5, 'memory', 'memory_update', 'new', 'Preferensi diperbarui', 'AI ingat: Metode pembayaran = Transfer e-wallet.', null, { category: 'payment_preference', key: 'Metode pembayaran', action: 'set' }],
      [6, 'insight', 'insight', 'new', 'Tagihan bulan ini lebih tinggi', 'Total tagihan 987rb — 22% di atas rata-rata 3 bulan terakhir.', 0.66, { periodDays: 30, bills: 987000 }],
      [7, 'fraud', 'risk', 'dismissed', 'Transaksi mencurigakan terdeteksi', 'Pola pembelian di jam tak biasa — sudah direview dan aman.', 0.9, { rule: 'unusual_hour' }],
    ];
    const spaceAgo = (daysAgo, hour) => {
      const d = new Date(Date.now() - daysAgo * 86_400_000);
      d.setUTCHours(hour, 0, 0, 0);
      return d.toISOString().slice(0, 19).replace('T', ' ');
    };
    for (const [i, entry] of DEMO_TIMELINE.entries()) {
      const [daysAgo, feature, eventType, status, title, body, confidence, payload] = entry;
      await client.execute({
        sql: `INSERT INTO ai_timeline (id, user_id, feature, event_type, status, title, body, confidence, payload, created_at)
              VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?) ON CONFLICT(id) DO NOTHING`,
        args: [`demo-tl-${i}`, demoUserId, feature, eventType, status, title, body, confidence, JSON.stringify(payload), spaceAgo(daysAgo, 9)],
      });
    }

    // ── Verifikasi count vs SEED_DATASET ──
    const count = async (table, col) => {
      const { rows } = await client.execute(
        `SELECT COUNT(*) AS c FROM ${table} WHERE ${col} = ?`,
        [seedUserId],
      );
      return Number(rows[0].c);
    };
    const tx = await count('transactions', 'user_id');
    const logs = await count('gmail_sync_logs', 'user_id');
    if (tx !== SEED_DATASET.T_TOTAL || logs !== SEED_DATASET.G_TOTAL) {
      console.error(
        `[prepareE2eDb] ⛔ Seed mismatch: transaksi ${tx} (harus ${SEED_DATASET.T_TOTAL}), gmail logs ${logs} (harus ${SEED_DATASET.G_TOTAL})`,
      );
      process.exit(1);
    }

    // ── Guard index unik gmail (2026-08-11) — initTursoSchema meng-ignore error
    // constraint, jadi pada DB yang masih punya (user_id, gmail_message_id)
    // duplikat, idx_transactions_gmail_msg_unique akan GAGAL dibuat DIAM-DIAM
    // (hardening TOCTOU final §10.8 absen tanpa gejala). Seed E2E saat ini tidak
    // memproduksi duplikat (gmail_message_id kosong) — guard ini memastikan
    // index benar-benar ada sebelum server API boot. ──
    const idxRows = await client.execute(`PRAGMA index_list('transactions')`);
    const hasUniqueGmailIndex = (idxRows.rows || []).some(
      (r) => r.name === 'idx_transactions_gmail_msg_unique' && Number(r.unique) === 1,
    );
    if (!hasUniqueGmailIndex) {
      console.error(
        '[prepareE2eDb] ⛔ idx_transactions_gmail_msg_unique TIDAK ada — seed/DB masih punya gmail_message_id duplikat? Jalankan gmailDuplicateCleanup.mjs dulu.',
      );
      process.exit(1);
    }

    console.log(`[prepareE2eDb] ✅ DB lokal E2E siap: ${DB_URL}`);
    console.log(`[prepareE2eDb]    schema+migrasi (${migrationCount} migration) · seed admin ${ADMIN_EMAIL}`);
    console.log(`[prepareE2eDb]    transaksi ${tx} (income ${SEED_DATASET.T_INCOME}/expense ${SEED_DATASET.T_EXPENSE}/other ${SEED_DATASET.T_OTHER}) · gmail logs ${logs}`);
  } finally {
    try { client.close(); } catch { /* one-shot script — exit deterministik */ }
  }
}

main().catch((err) => {
  console.error(`[prepareE2eDb] ❌ Gagal: ${err.message}`);
  process.exit(1);
});
