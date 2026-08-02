#!/usr/bin/env node
/**
 * CashFlow — Restore Turso (runbook restore dari backup JSON).
 *
 * Memulihkan SEMUA tabel (22) dari file backups/cashflow-backup-<ts>.json ke
 * target Turso (biasanya DB baru / DB uji). Skema dibuat otomatis dari
 * turso-schema.sql bila target masih kosong (fresh DB).
 *
 * SAFETY GUARD (wajib):
 *   - RESTORE_TURSO=1  — konfirmasi eksplisit (pola BACKUP_TURSO / SEED_E2E).
 *   - Target DB yang SUDAH ADA DATA-nya ditolak kecuali --force.
 *   - Bila target URL sama dengan URL sumber backup (source), ditolak kecuali
 *     --force (mencegah restore menimpa DB produksi yang jadi sumbernya).
 *
 * USAGE:
 *   RESTORE_TURSO=1 node scripts/restoreTurso.mjs --file backups/cashflow-backup-<ts>.json
 *   RESTORE_TURSO=1 TURSO_DATABASE_URL='file:backups/test-restore.db' node scripts/restoreTurso.mjs --file backups/cashflow-backup-<ts>.json
 *   RESTORE_TURSO=1 node scripts/restoreTurso.mjs --file backups/cashflow-backup-<ts>.json --force   # target tidak kosong (hapus dulu)
 *
 * RINCIAN:
 *   - Urutan INSERT mengikuti urutan CREATE TABLE di turso-schema.sql (parent
 *     sebelum child → aman untuk FOREIGN KEY bila pragma foreign_keys ON).
 *   - Generated column (contoh: ai_usage_metrics.total_tokens) otomatis di-skip
 *     dari kolom INSERT (deteksi via PRAGMA table_info.hidden).
 *   - Statement INSERT seed dari turso-schema.sql (alert_rules) di-skip saat
 *     create schema — data seed sudah ada di dalam backup.
 *   - Verifikasi akhir: SELECT COUNT(*) per tabel vs count di backup → PASS/FAIL.
 */
import fs from 'node:fs';
import path from 'node:path';
import { createClient } from '@libsql/client';

if (process.env.RESTORE_TURSO !== '1') {
  console.error('[restore] Safety: set RESTORE_TURSO=1 untuk konfirmasi restore. Abort.');
  process.exit(1);
}

// --- CLI args ---
const args = process.argv.slice(2);
function argValue(flag) {
  const i = args.indexOf(flag);
  return i >= 0 && args[i + 1] ? args[i + 1] : null;
}
const backupFile = argValue('--file');
const force = args.includes('--force');
if (!backupFile) {
  console.error('[restore] Usage: --file <backup.json> [--force]');
  process.exit(1);
}
if (!fs.existsSync(backupFile)) {
  console.error(`[restore] Backup tidak ditemukan: ${backupFile}`);
  process.exit(1);
}

// --- Load server/.env (hanya isi yang belum ada — env CLI menang) ---
function loadEnv() {
  const envPath = path.resolve(process.cwd(), 'server', '.env');
  if (!fs.existsSync(envPath)) return;
  for (const line of fs.readFileSync(envPath, 'utf8').split(/\r?\n/)) {
    const t = line.trim();
    if (!t || t.startsWith('#') || !t.includes('=')) continue;
    const i = t.indexOf('=');
    const k = t.slice(0, i).trim();
    const v = t.slice(i + 1).trim().replace(/^["']|["']$/g, '');
    if (k && !process.env[k]) process.env[k] = v;
  }
}
loadEnv();

const url = process.env.TURSO_DATABASE_URL;
const authToken = process.env.TURSO_AUTH_TOKEN;
if (!url) {
  console.error('[restore] TURSO_DATABASE_URL belum diisi (target DB). Abort.');
  process.exit(1);
}

// --- Baca backup ---
const dump = JSON.parse(fs.readFileSync(backupFile, 'utf8'));
if (!dump.tables || typeof dump.tables !== 'object') {
  console.error('[restore] Format backup tidak valid: { tables: { nama: [rows] } }');
  process.exit(1);
}
console.log(`[restore] Backup  : ${backupFile}`);
console.log(`[restore] Export  : ${dump.exportedAt} | ${dump.tableCount} tabel`);
console.log(`[restore] Target  : ${url}`);

if (!force && dump.source && url === dump.source) {
  console.error(
    '[restore] ABORT: target sama dengan sumber backup (produksi). ' +
      'Restore ke DB terpisah; tambahkan --force hanya jika yakin menimpa sumber.',
  );
  db.close();
  process.exit(1);
}

const db = createClient({ url, authToken: authToken || undefined });

async function listTables() {
  const { rows } = await db.execute({
    sql: `SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' ORDER BY name`,
    args: [],
  });
  return rows.map((r) => String(r.name));
}

/** Daftar kolom non-generated dari PRAGMA table_info. */
async function insertableColumns(table) {
  const { rows } = await db.execute({ sql: `PRAGMA table_info(${table})`, args: [] });
  const cols = [];
  for (const r of rows) {
    const hidden = r.hidden === undefined ? 0 : Number(r.hidden);
    if (hidden >= 2) continue; // generated (virtual/stored) — tidak bisa di-INSERT
    cols.push(String(r.name));
  }
  return cols;
}

/** Split turso-schema.sql jadi statements; skip komentar & INSERT seed.
 * Penting: buang baris komentar PER-BARIS dulu (bukan per-chunk) — chunk
 * pertama file dimulai dengan blok komentar sebelum CREATE TABLE user,
 * dan beberapa tabel (ai_usage_metrics, alert_rules) juga didahului komentar.
 */
function schemaStatements(schemaPath) {
  if (!fs.existsSync(schemaPath)) {
    throw new Error(`Schema tidak ditemukan: ${schemaPath} (jalankan dari project root)`);
  }
  const withoutComments = fs
    .readFileSync(schemaPath, 'utf8')
    .split(/\r?\n/)
    .filter((l) => !l.trim().startsWith('--'))
    .join('\n');
  return withoutComments
    .split(';')
    .map((s) => s.trim())
    .filter((s) => s)
    .filter((s) => !/^INSERT\b/i.test(s)); // seed data ada di backup
}

async function createSchema(schemaPath) {
  const statements = schemaStatements(schemaPath);
  console.log(`[restore] Buat skema dari ${schemaPath} (${statements.length} statements, seed di-skip)`);
  for (const stmt of statements) {
    await db.execute(stmt);
  }
}

/** Urutan insert: urutan CREATE TABLE di skema (parent-first); sisanya alfabetis. */
function schemaOrder(schemaPath, backupTables) {
  let order = [];
  if (fs.existsSync(schemaPath)) {
    const re = /CREATE TABLE IF NOT EXISTS\s+(\w+)/g;
    const sql = fs.readFileSync(schemaPath, 'utf8');
    let m;
    while ((m = re.exec(sql))) order.push(m[1]);
  }
  for (const t of backupTables) {
    if (!order.includes(t)) order.push(t);
  }
  return order.filter((t) => backupTables.includes(t));
}

async function main() {
  const backupTables = Object.keys(dump.tables);
  const existing = await listTables();

  if (existing.length > 0 && !force) {
    console.error(
      `[restore] ABORT: target sudah punya ${existing.length} tabel (${existing.slice(0, 8).join(', ')}...). ` +
        'Gunakan DB kosong atau --force untuk menimpa.',
    );
    db.close();
    process.exit(1);
  }

  const schemaPath = path.resolve(process.cwd(), 'turso-schema.sql');
  if (existing.length === 0) {
    await createSchema(schemaPath);
  } else if (force) {
    // Hapus data lama FK-safe (children dulu = urutan terbalik dari skema)
    const order = schemaOrder(schemaPath, existing);
    console.log(`[restore] --force: hapus data lama ${existing.length} tabel (FK-safe order)`);
    for (const t of [...order].reverse()) {
      const { rowsAffected } = await db.execute({ sql: `DELETE FROM ${t}`, args: [] });
      if (rowsAffected > 0) console.log(`[restore]   clear ${t}: ${rowsAffected} rows`);
    }
  }

  const order = schemaOrder(schemaPath, backupTables);
  const colCache = new Map();

  await db.execute('BEGIN');
  try {
    for (const table of order) {
      const rows = dump.tables[table] || [];
      if (rows.length === 0) continue;
      let cols = colCache.get(table);
      if (!cols) {
        cols = await insertableColumns(table);
        colCache.set(table, cols);
      }
      const placeholders = cols.map(() => '?').join(', ');
      const insertSql = `INSERT INTO ${table} (${cols.join(', ')}) VALUES (${placeholders})`;

      let n = 0;
      for (let i = 0; i < rows.length; i++) {
        const row = rows[i];
        const vals = cols.map((c) => (row[c] === undefined ? null : row[c]));
        await db.execute({ sql: insertSql, args: vals }); // all-or-nothing: error → ROLLBACK
        n++;
      }
      console.log(`[restore]   ${table.padEnd(28)} ${String(n).padStart(6)} / ${rows.length}`);
    }
    await db.execute('COMMIT');
  } catch (e) {
    await db.execute('ROLLBACK');
    console.error(`[restore] ❌ ROLLBACK (all-or-nothing): ${e.message}`);
    db.close();
    process.exit(1);
  }

  // --- Verifikasi ---
  let totalOk = 0;
  let totalExpected = 0;
  console.log('\n[restore] Verifikasi COUNT(*) vs backup:');
  for (const table of order) {
    const expected = dump.counts[table] ?? (dump.tables[table] || []).length;
    const { rows } = await db.execute({ sql: `SELECT COUNT(*) AS c FROM ${table}`, args: [] });
    const got = Number(rows[0]?.c) || 0;
    totalExpected += expected;
    totalOk += got;
    const mark = got === expected ? '✅' : '❌';
    if (got !== expected) console.log(`  ${mark} ${table.padEnd(28)} ${String(got).padStart(6)} / ${expected}`);
  }
  console.log(`\n[restore] ${totalOk === totalExpected ? '✅ RESTORE OK' : '❌ MISMATCH'} — ${totalOk} / ${totalExpected} rows (${order.length} tabel).`);
  db.close();
  process.exit(totalOk === totalExpected ? 0 : 1);
}

main().catch((err) => {
  console.error('[restore] Gagal:', err.message);
  try {
    db.close();
  } catch {
    // ignore
  }
  process.exit(1);
});
