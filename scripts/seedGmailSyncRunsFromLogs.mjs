/**
 * seedGmailSyncRunsFromLogs.mjs
 *
 * Isi tabel Turso `gmail_sync_runs` dengan riwayat sinkronisasi yang DISINTESIS
 * dari data gmail_sync_logs (data asli berasal dari Supabase).
 *
 * LATAR BELAKANG: tabel `gmail_sync_runs` di Supabase ternyata KOSONG (0 baris),
 * dan tidak ada log yang memiliki sync_run_id. Namun 519 baris gmail_sync_logs
 * (yang termigrasi dari Supabase) membawa scanned_at + status, sehingga riwayat
 * scan bisa direkonstruksi dari data log itu sendiri.
 *
 * APA YANG DILAKUKAN:
 * 1. Group gmail_sync_logs per (user_id, tanggal scanned_at).
 * 2. Untuk tiap hari: hitung total + breakdown status (accepted, pending_review,
 *    skipped, rejected, duplicate, failed, retry_later, config_error).
 * 3. INSERT OR REPLACE satu baris gmail_sync_runs per hari (idempoten).
 *    - Kolom standar (total_emails, processed, accepted, rejected, skipped, failed)
 *      diisi dari agregasi.
 *    - Breakdown lengkap disimpan di `metadata` (JSON) agar UI bisa menampilkan
 *      Perlu Review / Duplikat / Coba Lagi Nanti / Config Error.
 * 4. Backfill `gmail_sync_logs.sync_run_id` ke run yang baru dibuat.
 *
 * Penggunaan:
 *   node scripts/seedGmailSyncRunsFromLogs.mjs
 */
import dotenv from 'dotenv';
import fs from 'node:fs';
import path from 'node:path';
import { createClient } from '@libsql/client';

function loadEnv() {
  const envPath = path.resolve(process.cwd(), 'server', '.env');
  if (!fs.existsSync(envPath)) return;
  for (const line of fs.readFileSync(envPath, 'utf8').split(/\r?\n/)) {
    const t = line.trim();
    if (t && !t.startsWith('#') && t.includes('=')) {
      const i = t.indexOf('=');
      const k = t.slice(0, i).trim();
      const v = t.slice(i + 1).trim().replace(/^["']|["']$/g, '');
      if (k && !process.env[k]) process.env[k] = v;
    }
  }
}
loadEnv();

const turso = createClient({
  url: process.env.TURSO_DATABASE_URL,
  authToken: process.env.TURSO_AUTH_TOKEN,
});

async function main() {
  console.log('🔍 Mengambil agregasi gmail_sync_logs per (user, hari scan)...');

  const rows = await turso.execute({
    sql: `SELECT user_id,
                 substr(scanned_at, 1, 10) AS day,
                 COUNT(*) AS total,
                 SUM(CASE WHEN status = 'auto_accepted' THEN 1 ELSE 0 END) AS accepted,
                 SUM(CASE WHEN status IN ('needs_review','pending_review','approved') THEN 1 ELSE 0 END) AS pending_review,
                 SUM(CASE WHEN status IN ('auto_skipped','skipped') THEN 1 ELSE 0 END) AS skipped,
                 SUM(CASE WHEN status IN ('auto_rejected','rejected') THEN 1 ELSE 0 END) AS rejected,
                 SUM(CASE WHEN status = 'duplicate' THEN 1 ELSE 0 END) AS duplicate,
                 SUM(CASE WHEN status = 'failed' THEN 1 ELSE 0 END) AS failed,
                 SUM(CASE WHEN status = 'retry_later' THEN 1 ELSE 0 END) AS retry_later,
                 SUM(CASE WHEN status IN ('config_error','paused_config_error') THEN 1 ELSE 0 END) AS config_error,
                 MIN(scanned_at) AS first_scanned,
                 MAX(scanned_at) AS last_scanned,
                 MIN(email_date) AS min_email_date,
                 MAX(email_date) AS max_email_date
          FROM gmail_sync_logs
          GROUP BY user_id, substr(scanned_at, 1, 10)
          ORDER BY day ASC`,
    args: [],
  });

  console.log(`📦 Ditemukan ${rows.rows.length} hari scan.`);
  if (rows.rows.length === 0) {
    console.log('ℹ️ Tidak ada log — tidak ada run yang dibuat.');
    return;
  }

  let created = 0;
  let backfilled = 0;

  for (const r of rows.rows) {
    const userId = r.user_id;
    const day = r.day;
    // Id deterministik agar INSERT OR REPLACE idempoten
    const runId = `hist-${userId.slice(0, 8)}-${day}`;

    const total = Number(r.total || 0);
    const accepted = Number(r.accepted || 0);
    const pendingReview = Number(r.pending_review || 0);
    const skipped = Number(r.skipped || 0);
    const rejected = Number(r.rejected || 0);
    const duplicate = Number(r.duplicate || 0);
    const failed = Number(r.failed || 0);
    const retryLater = Number(r.retry_later || 0);
    const configError = Number(r.config_error || 0);

    const metadata = {
      syncType: 'initial_history',
      dateFrom: r.min_email_date ? String(r.min_email_date).slice(0, 10) : day,
      dateTo: r.max_email_date ? String(r.max_email_date).slice(0, 10) : day,
      pendingReviewCount: pendingReview,
      duplicateCount: duplicate,
      retryLaterCount: retryLater,
      configErrorCount: configError,
      source: 'synthesized-from-gmail-sync-logs',
      migratedAt: new Date().toISOString(),
    };

    await turso.execute({
      sql: `INSERT OR REPLACE INTO gmail_sync_runs
            (id, user_id, status, started_at, completed_at,
             total_emails, processed, accepted, rejected, skipped, failed,
             error_message, metadata)
            VALUES (?, ?, 'completed', ?, ?, ?, ?, ?, ?, ?, ?, NULL, ?)`,
      args: [
        runId,
        userId,
        r.first_scanned ?? `${day}T00:00:00.000Z`,
        r.last_scanned ?? `${day}T23:59:59.999Z`,
        total,
        total,
        accepted,
        rejected,
        skipped,
        failed,
        JSON.stringify(metadata),
      ],
    });
    created++;

    // Backfill sync_run_id di log hari tersebut
    const bf = await turso.execute({
      sql: `UPDATE gmail_sync_logs SET sync_run_id = ? WHERE user_id = ? AND substr(scanned_at, 1, 10) = ?`,
      args: [runId, userId, day],
    });
    backfilled += Number(bf.rowsAffected || 0);

    console.log(
      `  ✅ ${day} [${userId.slice(0, 8)}…]: ${total} email ` +
        `(diterima ${accepted}, perlu review ${pendingReview}, dilewati ${skipped + rejected}, duplikat ${duplicate}, gagal ${failed}, retry ${retryLater}, config ${configError})`
    );
  }

  // Verifikasi
  const runs = await turso.execute({ sql: `SELECT * FROM gmail_sync_runs ORDER BY started_at`, args: [] });
  console.log(`\n📊 gmail_sync_runs di Turso: ${runs.rows.length} baris`);
  for (const run of runs.rows) {
    console.log(
      `  - ${run.id}: ${run.status}, total_emails=${run.total_emails}, processed=${run.processed}, ` +
        `accepted=${run.accepted}, rejected=${run.rejected}, skipped=${run.skipped}, failed=${run.failed}`
    );
  }
  const withRun = await turso.execute({
    sql: `SELECT COUNT(*) AS cnt FROM gmail_sync_logs WHERE sync_run_id IS NOT NULL`,
    args: [],
  });
  console.log(`🔗 Log dengan sync_run_id: ${withRun.rows[0].cnt}`);

  console.log('\n🎉 Seed gmail_sync_runs selesai!');
  turso.close();
}

main().catch((err) => {
  console.error('❌ Fatal Error:', err);
  process.exit(1);
});
