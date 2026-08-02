/**
 * ⚠️ LEGACY — Supabase sudah di-decommission (2026-08-02).
 *
 * Script ini HANYA untuk migrasi data historis (jika project Supabase masih
 * hidup sementara sebelum dihapus manual). Server runtime tidak memakai Supabase
 * sebagai dependensi aktif — folder supabase/ (functions, migrations) dipertahankan
 * sebagai dormant. Kredensial SUPABASE_URL/SUPABASE_SERVICE_ROLE_KEY TIDAK lagi
 * tersedia di server/.env — isi manual via env bila ingin re-run.
 *
 * Migrasi Data Gmail Sync: Supabase PostgreSQL -> Turso (SQLite / libSQL)
 *
 * Kenapa script terpisah dari migrateSupabaseToTurso.js:
 * - Kolom Supabase (gmail_message_id, thread_id) tidak ada di tabel Turso.
 * - user_id di Supabase adalah UUID auth.users, sedangkan Turso memakai id
 *   Better Auth. Keduanya harus dipetakan lewat email.
 * - FK gmail_sync_logs.user_id -> users(id) (tabel legacy) mengharuskan seed
 *   baris users dengan id Better Auth.
 * - extracted_transaction_id FK -> transactions(id): di-null-kan bila transaksi
 *   target belum ada di Turso (tabel transactions masih kosong).
 *
 * Cara penggunaan:
 *   node scripts/migrateGmailSupabaseToTurso.mjs
 *   node scripts/migrateGmailSupabaseToTurso.mjs --skip-users-seed
 * (membaca kredensial dari env: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY,
 *  TURSO_DATABASE_URL, TURSO_AUTH_TOKEN — SUPABASE kini tidak ada di server/.env)
 *
 * Catatan: Script ini HANYA menyentuh 3 tabel Gmail (gmail_sync_logs,
 * gmail_sync_runs, gmail_sync_settings). Satu-satunya write di luar itu adalah
 * seed 1 baris ke tabel legacy `users` (wajib untuk memenuhi FK
 * gmail_sync_logs.user_id -> users(id)); lewati dengan --skip-users-seed bila
 * baris user sudah ada.
 */
import { createClient as createSupabaseClient } from '@supabase/supabase-js';
import { createClient as createTursoClient } from '@libsql/client';
import fs from 'node:fs';
import path from 'node:path';

function loadEnv() {
  const envPath = path.resolve(process.cwd(), 'server', '.env');
  if (fs.existsSync(envPath)) {
    const lines = fs.readFileSync(envPath, 'utf8').split(/\r?\n/);
    for (const line of lines) {
      const trimmed = line.trim();
      if (trimmed && !trimmed.startsWith('#') && trimmed.includes('=')) {
        const idx = trimmed.indexOf('=');
        const key = trimmed.slice(0, idx).trim();
        const value = trimmed.slice(idx + 1).trim().replace(/^["']|["']$/g, '');
        if (key && !process.env[key]) process.env[key] = value;
      }
    }
  }
}

loadEnv();

const supabaseUrl = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.VITE_SUPABASE_ANON_KEY;
const tursoUrl = process.env.TURSO_DATABASE_URL || 'file:cashflow.db';
const tursoToken = process.env.TURSO_AUTH_TOKEN;

if (!supabaseUrl || !supabaseKey) {
  console.error('❌ Error: SUPABASE_URL atau SUPABASE_SERVICE_ROLE_KEY belum diset.');
  process.exit(1);
}

const supabase = createSupabaseClient(supabaseUrl, supabaseKey);
const turso = createTursoClient({ url: tursoUrl, authToken: tursoToken });

const SKIP_USERS_SEED = process.argv.includes('--skip-users-seed');
const PAGE_SIZE = 500;

async function fetchAllSupabaseRows(tableName, select = '*') {
  const rows = [];
  let from = 0;
  for (;;) {
    const { data, error } = await supabase
      .from(tableName)
      .select(select)
      .range(from, from + PAGE_SIZE - 1);
    if (error) throw new Error(`Gagal baca ${tableName}: ${error.message}`);
    if (!data || data.length === 0) break;
    rows.push(...data);
    if (data.length < PAGE_SIZE) break;
    from += PAGE_SIZE;
  }
  return rows;
}

function toSqlValue(val) {
  if (typeof val === 'object' && val !== null) return JSON.stringify(val);
  if (typeof val === 'boolean') return val ? 1 : 0;
  return val;
}

async function userMapping() {
  // user_id unik di data Supabase
  const logs = await fetchAllSupabaseRows('gmail_sync_logs', 'user_id');
  const supabaseUserIds = [...new Set(logs.map((r) => r.user_id))];
  console.log('Supabase user_id unik:', JSON.stringify(supabaseUserIds));

  const map = {};
  for (const supabaseUserId of supabaseUserIds) {
    const { data: au } = await supabase.auth.admin.getUserById(supabaseUserId);
    const email = au?.user?.email;
    if (!email) {
      console.warn(`⚠️ Tidak dapat email untuk Supabase user ${supabaseUserId}`);
      continue;
    }
    const res = await turso.execute({
      sql: `SELECT id FROM user WHERE email = ? LIMIT 1`,
      args: [email],
    });
    if (res.rows.length === 0) {
      console.warn(`⚠️ Tidak ada user Better Auth dengan email ${email} — dilewati.`);
      continue;
    }
    map[supabaseUserId] = res.rows[0].id;
    console.log(`  user map: ${supabaseUserId} (${email}) -> ${res.rows[0].id}`);
  }
  return map;
}

async function ensureLegacyUsersRow(userId, email, name) {
  // FK gmail_sync_logs.user_id -> users(id). Tabel users adalah tabel legacy
  // (terpisah dari tabel `user` milik Better Auth) dan saat ini kosong.
  await turso.execute({
    sql: `INSERT OR IGNORE INTO users (id, email, name, display_name, photo_url, avatar_url, google_id, created_at, updated_at)
          VALUES (?, ?, ?, ?, '', '', ?, datetime('now'), datetime('now'))`,
    args: [userId, email, name, name, null],
  }).catch((e) => console.warn('  users seed note:', e.message.slice(0, 80)));
}

async function migrateGmailSyncLogs(userMap) {
  const rows = await fetchAllSupabaseRows('gmail_sync_logs');
  console.log(`📦 gmail_sync_logs: ${rows.length} baris dari Supabase.`);

  let success = 0;
  let skipped = 0;
  for (const row of rows) {
    const userId = userMap[row.user_id];
    if (!userId) { skipped++; continue; }

    // extracted_transaction_id hanya dipertahankan bila transaksi ada di Turso
    let extractedTransactionId = null;
    if (row.extracted_transaction_id) {
      const tx = await turso.execute({
        sql: `SELECT id FROM transactions WHERE id = ? LIMIT 1`,
        args: [row.extracted_transaction_id],
      });
      if (tx.rows.length > 0) extractedTransactionId = row.extracted_transaction_id;
    }

    const values = [
      row.id,
      userId,
      row.message_id || row.gmail_message_id || '',
      row.subject ?? 'No Subject',
      row.sender ?? '',
      row.sender_domain ?? '',
      row.email_date ?? null,
      row.prefilter_status ?? null,
      toSqlValue(row.ai_called),
      toSqlValue(row.ai_parsed),
      row.final_status ?? null,
      row.error_message ?? null,
      extractedTransactionId,
      row.status ?? row.final_status ?? null,
      row.confidence_score ?? null,
      row.sync_run_id ?? null,
      row.error_code ?? null,
      toSqlValue(row.fallback_used),
      row.extracted_note ?? null,
      JSON.stringify(row.metadata ?? {}),
      row.scanned_at ?? new Date().toISOString(),
    ];

    try {
      await turso.execute({
        sql: `INSERT OR REPLACE INTO gmail_sync_logs
              (id, user_id, message_id, subject, sender, sender_domain, email_date, prefilter_status,
               ai_called, ai_parsed, final_status, error_message, extracted_transaction_id, status,
               confidence_score, sync_run_id, error_code, fallback_used, extracted_note, metadata, scanned_at)
              VALUES (${values.map(() => '?').join(', ')})`,
        args: values,
      });
      success++;
    } catch (err) {
      console.warn(`  ⚠️ Error baris ${row.id}:`, err.message);
      skipped++;
    }
  }
  console.log(`✅ gmail_sync_logs: ${success} berhasil, ${skipped} dilewati.`);
}

async function migrateGmailSyncSettings(userMap) {
  const rows = await fetchAllSupabaseRows('gmail_sync_settings');
  console.log(`📦 gmail_sync_settings: ${rows.length} baris dari Supabase.`);
  for (const row of rows) {
    const userId = userMap[row.user_id];
    if (!userId) { console.warn('  skip (user tidak terpetakan)'); continue; }
    await turso.execute({
      sql: `INSERT OR REPLACE INTO gmail_sync_settings
            (user_id, auto_sync_enabled, sync_interval_minutes, max_emails_per_sync, auto_approve_threshold,
             last_sync_at, created_at, updated_at)
            VALUES (?, ?, ?, 25, 0.88, ?, ?, ?)`,
      args: [
        userId,
        toSqlValue(row.auto_sync_enabled),
        row.sync_interval_minutes ?? 60,
        row.last_synced_at ?? row.updated_at ?? new Date().toISOString(),
        row.created_at ?? new Date().toISOString(),
        row.updated_at ?? new Date().toISOString(),
      ],
    }).catch((e) => console.warn('  settings err:', e.message.slice(0, 100)));
  }
  console.log('✅ gmail_sync_settings selesai.');
}

async function migrateGmailSyncRuns(userMap) {
  const rows = await fetchAllSupabaseRows('gmail_sync_runs');
  console.log(`📦 gmail_sync_runs: ${rows.length} baris dari Supabase.`);
  if (rows.length === 0) { console.log('ℹ️ gmail_sync_runs kosong — dilewati.'); return; }
  // Tabel Turso gmail_sync_runs beda struktur (tanpa sync_type/detail counters);
  // migrasi minimal: id + user_id + status + started_at + completed_at.
  let success = 0;
  for (const row of rows) {
    const userId = userMap[row.user_id];
    if (!userId) continue;
    try {
      await turso.execute({
        sql: `INSERT OR REPLACE INTO gmail_sync_runs
              (id, user_id, status, started_at, completed_at, total_emails, processed,
               accepted, rejected, skipped, failed, error_message, metadata)
              VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        args: [
          row.id,
          userId,
          row.status ?? 'completed',
          row.started_at ?? row.created_at ?? new Date().toISOString(),
          row.finished_at ?? row.completed_at ?? row.started_at ?? new Date().toISOString(),
          row.total_found ?? row.total_emails ?? 0,
          row.total_processed ?? row.processed ?? 0,
          row.pending_review_count ?? row.accepted ?? 0,
          row.rejected_count ?? row.rejected ?? 0,
          row.skipped_count ?? row.skipped ?? 0,
          row.failed_count ?? row.failed ?? 0,
          row.error_message ?? null,
          JSON.stringify(row.metadata ?? {}),
        ],
      });
      success++;
    } catch (err) {
      console.warn(`  ⚠️ Error run ${row.id}:`, err.message);
    }
  }
  console.log(`✅ gmail_sync_runs: ${success} berhasil.`);
}

async function verify() {
  const res = await turso.execute({
    sql: `SELECT COUNT(*) AS cnt FROM gmail_sync_logs`,
    args: [],
  });
  console.log('📊 Total gmail_sync_logs di Turso:', res.rows[0].cnt);
  const byStatus = await turso.execute({
    sql: `SELECT status, COUNT(*) AS cnt FROM gmail_sync_logs GROUP BY status ORDER BY cnt DESC`,
    args: [],
  });
  console.log('📊 Distribusi status:', JSON.stringify(byStatus.rows));
  const byUser = await turso.execute({
    sql: `SELECT user_id, COUNT(*) AS cnt FROM gmail_sync_logs GROUP BY user_id`,
    args: [],
  });
  console.log('📊 Per user:', JSON.stringify(byUser.rows));
  const settings = await turso.execute({
    sql: `SELECT user_id, auto_sync_enabled, sync_interval_minutes FROM gmail_sync_settings`,
    args: [],
  });
  console.log('📊 Settings:', JSON.stringify(settings.rows));
}

async function run() {
  console.log('🚀 Migrasi Gmail Sync: Supabase -> Turso');
  console.log(`   Source: ${supabaseUrl}`);
  console.log(`   Target: ${tursoUrl}`);
  console.log('----------------------------------------------------');

  const userMap = await userMapping();
  if (Object.keys(userMap).length === 0) {
    console.error('❌ Tidak ada mapping user — batal.');
    process.exit(1);
  }
  if (SKIP_USERS_SEED) {
    console.log('ℹ️ --skip-users-seed: seed tabel users dilewati (asumsikan baris user sudah ada).');
    // Pre-check FK: kalau baris users belum ada, seluruh insert akan gagal FK — abort dini
    for (const userId of Object.values(userMap)) {
      const chk = await turso.execute({
        sql: `SELECT 1 FROM users WHERE id = ? LIMIT 1`,
        args: [userId],
      });
      if (chk.rows.length === 0) {
        console.error(`❌ Baris users(${userId}) TIDAK ada di Turso — dengan --skip-users-seed semua insert akan gagal FK. Jalankan tanpa flag ini (atau seed users dulu). ABORT.`);
        process.exit(1);
      }
    }
  } else {
    // Map user -> email/name agar seed tabel users tidak hardcoded
    const userInfo = {};
    for (const supabaseUserId of Object.keys(userMap)) {
      const { data: au } = await supabase.auth.admin.getUserById(supabaseUserId);
      userInfo[supabaseUserId] = {
        email: au?.user?.email || '',
        name: au?.user?.user_metadata?.full_name || au?.user?.email?.split('@')[0] || 'User',
      };
    }
    for (const supabaseUserId of Object.keys(userMap)) {
      const info = userInfo[supabaseUserId];
      await ensureLegacyUsersRow(userMap[supabaseUserId], info.email, info.name);
    }
  }

  await migrateGmailSyncLogs(userMap);
  await migrateGmailSyncSettings(userMap);
  await migrateGmailSyncRuns(userMap);
  await verify();
  console.log('----------------------------------------------------');
  console.log('🎉 Migrasi Gmail Sync selesai!');
}

run().catch((err) => {
  console.error('❌ Fatal Error saat migrasi:', err);
  process.exit(1);
});
