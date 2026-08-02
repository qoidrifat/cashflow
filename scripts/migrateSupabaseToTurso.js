/**
 * Script Migrasi Data: Supabase PostgreSQL -> Turso (SQLite / libSQL)
 *
 * Versi ini menangani perbedaan skema secara GENERIK:
 * - Kolom dibatasi lewat interseksi antara baris Supabase dan PRAGMA
 *   table_info tabel target Turso (kolom Supabase yang tidak ada di Turso,
 *   mis. profiles.id, categories.updated_at, transactions.currency,
 *   gmail_sync_logs.gmail_message_id/thread_id, otomatis di-drop).
 * - user_id Supabase (UUID auth.users) dipetakan ke id Better Auth lewat email.
 * - FK gmail_sync_logs.user_id -> users(id) (tabel legacy) — seed baris users
 *   (bisa dilewati dengan --skip-users-seed).
 * - FK extracted_transaction_id -> transactions(id) di-null-kan bila transaksi
 *   target belum ada di Turso.
 * - Fetch ber-pagination (PAGE_SIZE 500) — tidak kena batas PostgREST 1000.
 *
 * Cara penggunaan:
 *   node scripts/migrateSupabaseToTurso.js
 *   node scripts/migrateSupabaseToTurso.js --skip-users-seed
 *   node scripts/migrateSupabaseToTurso.js --only transactions,categories
 * (membaca kredensial dari server/.env: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY,
 *  TURSO_DATABASE_URL, TURSO_AUTH_TOKEN)
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
const ONLY_FLAG = process.argv.find((a) => a.startsWith('--only='));
const ONLY_TABLES = ONLY_FLAG ? ONLY_FLAG.split('=')[1].split(',').map((s) => s.trim()).filter(Boolean) : null;
const PAGE_SIZE = 500;

const TABLES_TO_MIGRATE = [
  'profiles',
  'categories',
  'transactions',
  'budgets',
  'recurring_transactions',
  'gmail_sync_logs',
  'gmail_sync_settings',
  'gmail_sync_runs',
  'wallet_accounts',
  'saving_goals',
  'subscriptions',
  'notifications',
];

// Amankan flag --only: tolak nama tabel yang tidak dikenal (anti SQL injection)
if (ONLY_TABLES) {
  const invalid = ONLY_TABLES.filter((t) => !TABLES_TO_MIGRATE.includes(t));
  if (invalid.length > 0) {
    console.error(`❌ --only berisi tabel tidak dikenal: ${invalid.join(', ')}`);
    console.error(`   Tabel valid: ${TABLES_TO_MIGRATE.join(', ')}`);
    process.exit(1);
  }
}

// Alias kolom: nama kolom Supabase -> nama kolom Turso bila berbeda
// (interseksi generik tidak bisa tahu pemetaan ini, jadi dideklarasikan eksplisit).
const COLUMN_ALIASES = {
  gmail_sync_settings: {
    last_synced_at: 'last_sync_at',
  },
};

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

/** Ambil daftar kolom tabel target di Turso (untuk interseksi kolom). */
async function getTursoColumns(tableName) {
  const res = await turso.execute({
    sql: `PRAGMA table_info(${tableName})`,
    args: [],
  });
  return res.rows.map((r) => r.name);
}

/** Ambil daftar FK tabel target (untuk men-null-kan referensi yang belum ada). */
async function getTursoForeignKeys(tableName) {
  const res = await turso.execute({
    sql: `PRAGMA foreign_key_list(${tableName})`,
    args: [],
  });
  return res.rows.map((r) => ({ column: r.from, refTable: r.table, refColumn: r.to }));
}

/** Petakan user_id Supabase (UUID) -> id Better Auth lewat email. */
async function userMapping() {
  // kumpulkan user_id unik dari semua tabel yang akan dimigrasi
  const tables = ONLY_TABLES || TABLES_TO_MIGRATE;
  const userIds = new Set();
  for (const table of tables) {
    try {
      const rows = await fetchAllSupabaseRows(table, 'user_id');
      for (const r of rows) if (r.user_id) userIds.add(r.user_id);
    } catch {
      // tabel mungkin tidak punya kolom user_id — lewati
    }
  }
  console.log('Supabase user_id unik:', JSON.stringify([...userIds]));

  const map = {};
  for (const supabaseUserId of userIds) {
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
  await turso.execute({
    sql: `INSERT OR IGNORE INTO users (id, email, name, display_name, photo_url, avatar_url, google_id, created_at, updated_at)
          VALUES (?, ?, ?, ?, '', '', ?, datetime('now'), datetime('now'))`,
    args: [userId, email, name, name, null],
  }).catch((e) => console.warn('  users seed note:', e.message.slice(0, 80)));
}

async function migrateTable(tableName, userMap) {
  console.log(`📦 Memulai migrasi tabel "${tableName}"...`);
  const rows = await fetchAllSupabaseRows(tableName);
  if (rows.length === 0) {
    console.log(`ℹ️ Tabel "${tableName}" kosong.`);
    return;
  }

  const tursoColumns = await getTursoColumns(tableName);
  const foreignKeys = await getTursoForeignKeys(tableName);

  let successCount = 0;
  for (const row of rows) {
    // 1) Terapkan alias kolom SEBELUM interseksi — kolom sumber alias (mis. last_synced_at)
    //    tidak ada di Turso, sehingga akan ter-drop oleh filter kolom bila diproses sesudahnya.
    let keys = Object.keys(row);
    const aliases = COLUMN_ALIASES[tableName] || {};
    for (const [src, target] of Object.entries(aliases)) {
      if (row[src] !== undefined && tursoColumns.includes(target) && !keys.includes(target)) {
        row[target] = row[src];
        keys.push(target);
      }
    }

    // 2) Interseksi kolom: hanya kolom yang ada di Turso
    keys = keys.filter((k) => tursoColumns.includes(k));

    // 2) Remap user_id Supabase -> Better Auth
    if (keys.includes('user_id')) {
      const mapped = userMap[row.user_id];
      if (!mapped) {
        console.warn(`  ⚠️ user_id ${row.user_id} tidak terpetakan — baris dilewati.`);
        continue;
      }
      row.user_id = mapped;
    }

    // 3) Null-kan FK yang referensinya belum ada di Turso (mis. transactions)
    for (const fk of foreignKeys) {
      if (fk.refTable === 'users') continue; // sudah dijamin lewat seed
      const idx = keys.indexOf(fk.column);
      if (idx === -1) continue;
      const val = row[fk.column];
      if (val === null || val === undefined) continue;
      const check = await turso.execute({
        sql: `SELECT 1 FROM ${fk.refTable} WHERE ${fk.refColumn} = ? LIMIT 1`,
        args: [val],
      });
      if (check.rows.length === 0) row[fk.column] = null;
    }

    const placeholders = keys.map(() => '?').join(', ');
    const values = keys.map((k) => toSqlValue(row[k]));

    try {
      await turso.execute({
        sql: `INSERT OR REPLACE INTO ${tableName} (${keys.join(', ')}) VALUES (${placeholders})`,
        args: values,
      });
      successCount++;
    } catch (err) {
      console.warn(`  ⚠️ Error pada baris ID ${row.id || row.user_id}:`, err.message);
    }
  }
  console.log(`✅ Selesai migrasi "${tableName}": ${successCount}/${rows.length} baris berhasil.`);
}

async function verify() {
  const tables = ONLY_TABLES || TABLES_TO_MIGRATE;
  for (const table of tables) {
    try {
      const res = await turso.execute({
        sql: `SELECT COUNT(*) AS cnt FROM ${table}`,
        args: [],
      });
      console.log(`📊 ${table}: ${res.rows[0].cnt}`);
    } catch {
      console.log(`📊 ${table}: (tidak ada)`);
    }
  }
  const tx = await turso.execute({
    sql: `SELECT COUNT(*) AS cnt, COUNT(DISTINCT user_id) AS users FROM transactions`,
    args: [],
  });
  console.log('📊 transactions detail:', JSON.stringify(tx.rows));
}

async function run() {
  console.log('🚀 Memulai Script Migrasi Data Supabase -> Turso');
  console.log(`   Source Supabase: ${supabaseUrl}`);
  console.log(`   Target Turso:    ${tursoUrl}`);
  if (ONLY_TABLES) console.log(`   Hanya tabel:     ${ONLY_TABLES.join(', ')}`);
  console.log('----------------------------------------------------');

  const tables = ONLY_TABLES || TABLES_TO_MIGRATE;

  const userMap = await userMapping();
  if (Object.keys(userMap).length === 0) {
    console.error('❌ Tidak ada mapping user — batal.');
    process.exit(1);
  }

  if (SKIP_USERS_SEED) {
    console.log('ℹ️ --skip-users-seed: seed tabel users dilewati (asumsikan baris user sudah ada).');
    for (const userId of Object.values(userMap)) {
      const chk = await turso.execute({
        sql: `SELECT 1 FROM users WHERE id = ? LIMIT 1`,
        args: [userId],
      });
      if (chk.rows.length === 0) {
        console.error(`❌ Baris users(${userId}) TIDAK ada di Turso — semua insert akan gagal FK. Jalankan tanpa flag ini. ABORT.`);
        process.exit(1);
      }
    }
  } else {
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

  for (const table of tables) {
    await migrateTable(table, userMap);
  }

  console.log('----------------------------------------------------');
  await verify();
  console.log('🎉 Migrasi data selesai!');
}

run().catch((err) => {
  console.error('❌ Fatal Error saat migrasi:', err);
  process.exit(1);
});
