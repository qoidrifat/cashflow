/**
 * schemaContract.js — kontrak schema (P0.4 Schema Drift Guard).
 *
 * SUMBER KEBENARAN TUNGGAL untuk "schema apa yang WAJIB ada di database".
 * Dipakai oleh:
 *   - scripts/dbMigrateCheck.mjs (CLI: verifikasi DB live ATAU temp lokal)
 *   - tests/unit/schemaContract.test.ts (CI tanpa kredensial Turso)
 *
 * Kontrak = tabel + kolom kritis + index kritis. Verifikasi memeriksa definisi
 * AKTUAL database (sqlite_master + PRAGMA), bukan sekadar nama — mis. index
 * partial unique idempotency_key diperiksa `unique` + `partial` + klausa WHERE.
 *
 * CATATAN: kontrak TIDAK mencakup tabel admin-only/global (alert_rules,
 * admin_metrics, admin_audit_log non-kritis dsb.) secara wajib — daftar di
 * bawah adalah tabel yang dibutuhkan aplikasi (Better Auth + bisnis + AI).
 * Tabel lain boleh ada; yang penting tidak ada yang HILANG.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
export const MIGRATIONS_DIR = path.resolve(__dirname, '..', 'migrations');
export const ROOT_DIR = path.resolve(__dirname, '..', '..');
export const TURSO_SCHEMA_PATH = path.join(ROOT_DIR, 'turso-schema.sql');

/** Tabel yang WAJIB ada (dipakai aplikasi runtime). */
export const REQUIRED_TABLES = [
  // Better Auth
  'user', 'session', 'account', 'verification',
  // Legacy identity
  'users', 'user_sessions', 'profiles',
  // Bisnis inti
  'categories', 'transactions', 'fraud_flags', 'budgets', 'recurring_transactions',
  'gmail_sync_logs', 'gmail_sync_settings', 'gmail_sync_runs',
  'wallet_accounts', 'saving_goals', 'subscriptions', 'notifications',
  // Konfigurasi finansial per-user (migration 0004): akun milik sendiri untuk
  // semantik transfer internal netral (FINANCIAL_CALCULATION_INTEGRITY §10.13)
  'user_financial_settings',
  // AI Product Experience
  'ai_feedback', 'ai_memory', 'ai_timeline',
  // Observability & governance
  'system_metrics', 'ai_usage_metrics', 'schema_migrations',
  // Admin security (audit trail)
  'admin_audit_log',
];

/** Kolom KRITIS per tabel (fail bila hilang). */
export const REQUIRED_COLUMNS = {
  user: ['id', 'email'],
  session: ['id', 'token', 'userId'],
  account: ['userId', 'providerId'],
  transactions: ['id', 'user_id', 'idempotency_key', 'transaction_date', 'amount', 'account_id', 'transfer_group_id', 'account_review_status', 'transfer_review_status'],
  categories: ['user_id'],
  budgets: ['user_id'],
  ai_feedback: ['user_id', 'rating'],
  ai_memory: ['user_id'],
  ai_timeline: ['user_id'],
  gmail_sync_logs: ['user_id'],
  notifications: ['user_id'],
  system_metrics: ['user_id', 'metric_name'],
  ai_usage_metrics: ['user_id'],
  schema_migrations: ['version', 'name', 'checksum', 'applied_at'],
  admin_audit_log: ['action', 'actor_user_id', 'created_at', 'result', 'request_id'],
  user_financial_settings: ['user_id', 'own_accounts'],
  // P2.5 account-based ledger (migration 0005): opening balance per akun.
  wallet_accounts: ['user_id', 'name', 'opening_balance', 'opening_balance_date', 'currency', 'real_balance', 'balance_anchor_status'],
  reconciliation_audit_log: ['user_id', 'action', 'created_at'],
};

/**
 * Index KRITIS. Untuk index partial unique, verifier memeriksa flag unique +
 * partial + klausa WHERE pada definisi (bukan sekadar keberadaan nama).
 * value: substring yang HARUS ada di definisi index (sqlite_master.sql).
 */
export const REQUIRED_INDEXES = {
  // Idempotensi create transaksi (2026-08-09): unique PARTIAL per user.
  idx_transactions_user_idempotency: {
    table: 'transactions',
    unique: true,
    partial: true,
    definitionContains: 'WHERE idempotency_key IS NOT NULL',
  },
  // Hardening TOCTOU final (2026-08-11, migration 0003): unique PARTIAL per
  // (user_id, gmail_message_id) — enforced, bukan advisory (pre-SELECT §10.8
  // punya window race). HANYA jalan setelah duplikat dibersihkan
  // (scripts/verifyGmailUniqueIndex.mjs sebagai pre-flight).
  //
  // definitionContains LENGKAP (IS NOT NULL AND != ''): klausa partial yang
  // hanya 'WHERE gmail_message_id IS NOT NULL' (tanpa eksklusi '' kosong)
  // TETAP lolos cek unique+partial → guard ini WAJIB menyertakan bagian
  // `!= ''` agar drift definisi terdeteksi. SQLite menyimpan operator `!=`
  // verbatim di sqlite_master.sql, jadi substring ini aman (bukan `<>`).
  idx_transactions_gmail_msg_unique: {
    table: 'transactions',
    unique: true,
    partial: true,
    definitionContains: 'WHERE gmail_message_id IS NOT NULL AND gmail_message_id != ', // +'' (char literal)
  },
  // Query utama user-scoped.
  idx_transactions_user_date: { table: 'transactions' },
  idx_ai_timeline_user_created: { table: 'ai_timeline' },
  idx_system_metrics_name_created: { table: 'system_metrics' },
  idx_admin_audit_created: { table: 'admin_audit_log' },
};

/**
 * Parse CREATE TABLE dari SQL file → { tableName: [columnNames] }.
 * Dipakai drift test statis (turso-schema.sql vs 0001_baseline.sql) dan
 * verifier (cari definisi aktual).
 */
export function parseCreateTables(sqlContent) {
  const tables = {};
  // CREATE TABLE IF NOT EXISTS name ( ... ) — blok paren bisa multi-baris.
  const re = /CREATE\s+TABLE\s+(?:IF\s+NOT\s+EXISTS\s+)?(\w+)\s*\(([\s\S]*?)\)\s*;/g;
  let match;
  while ((match = re.exec(sqlContent)) !== null) {
    const name = match[1];
    const body = match[2];
    const columns = [];
    for (const line of body.split('\n')) {
      const trimmed = line.trim();
      if (!trimmed) continue;
      // Baris kolom = nama di awal, bukan constraint (PRIMARY KEY, FOREIGN KEY, UNIQUE, CHECK).
      const colMatch = /^([A-Za-z_]\w*)\s+/.exec(trimmed);
      if (colMatch && !/^(PRIMARY|FOREIGN|UNIQUE|CHECK|CONSTRAINT)/i.test(trimmed)) {
        columns.push(colMatch[1]);
      }
    }
    tables[name] = columns;
  }
  return tables;
}

/**
 * Verifikasi kontrak terhadap client nyata (DB live atau temp lokal).
 *
 * @param {import('@libsql/client').Client} client
 * @returns {Promise<{
 *   pass: boolean,
 *   tables: Array<{ name: string, ok: boolean }>,
 *   columns: Array<{ table: string, column: string, ok: boolean }>,
 *   indexes: Array<{ name: string, ok: boolean, detail?: string }>,
 *   missingTables: string[], missingColumns: string[], missingIndexes: string[],
 * }>}
 */
export async function verifySchemaContract(client) {
  const tableResult = await client.execute({
    sql: `SELECT name FROM sqlite_master WHERE type='table'`,
    args: [],
  });
  const existingTables = new Set((tableResult.rows || []).map((r) => String(r.name)));

  const tables = REQUIRED_TABLES.map((name) => ({ name, ok: existingTables.has(name) }));
  const missingTables = tables.filter((t) => !t.ok).map((t) => t.name);

  // Kolom: PRAGMA table_info per tabel yang ada (periksa hanya bila tabel ada).
  const columns = [];
  const missingColumns = [];
  for (const [table, cols] of Object.entries(REQUIRED_COLUMNS)) {
    if (!existingTables.has(table)) continue; // hilang tabel sudah dilaporkan
    const info = await client.execute({ sql: `PRAGMA table_info(${quoteIdent(table)})`, args: [] });
    const present = new Set((info.rows || []).map((r) => String(r.name)));
    for (const col of cols) {
      const ok = present.has(col);
      columns.push({ table, column: col, ok });
      if (!ok) missingColumns.push(`${table}.${col}`);
    }
  }

  // Index: sqlite_master + PRAGMA index_list (unique/partial) + definisi.
  const indexDefs = new Map();
  const indexMeta = new Map();
  const idxResult = await client.execute({
    sql: `SELECT name, tbl_name, sql FROM sqlite_master WHERE type='index'`,
    args: [],
  });
  for (const r of idxResult.rows || []) {
    indexDefs.set(String(r.name), String(r.sql || ''));
    indexMeta.set(String(r.name), { table: String(r.tbl_name), sql: String(r.sql || '') });
  }
  const indexes = [];
  const missingIndexes = [];
  for (const [name, spec] of Object.entries(REQUIRED_INDEXES)) {
    const def = indexDefs.get(name);
    if (!def) {
      indexes.push({ name, ok: false, detail: 'index tidak ditemukan' });
      missingIndexes.push(name);
      continue;
    }
    const meta = indexMeta.get(name);
    let detail = '';
    let ok = true;
    if (spec.table && meta.table !== spec.table) {
      ok = false;
      detail = `tabel ${meta.table} ≠ ${spec.table}`;
    }
    if (ok && spec.unique !== undefined) {
      // unique: parse dari definisi ("CREATE UNIQUE INDEX ...").
      const isUnique = /CREATE\s+UNIQUE\s+INDEX/i.test(def);
      if (isUnique !== spec.unique) {
        ok = false;
        detail = `unique=${isUnique} ≠ ${spec.unique}`;
      }
    }
    if (ok && spec.partial !== undefined) {
      const hasWhere = /WHERE\s+/i.test(def);
      if (hasWhere !== spec.partial) {
        ok = false;
        detail = `partial=${hasWhere} ≠ ${spec.partial}`;
      }
    }
    if (ok && spec.definitionContains && !def.includes(spec.definitionContains)) {
      ok = false;
      detail = `definisi tidak memuat "${spec.definitionContains}"`;
    }
    indexes.push({ name, ok, detail: detail || undefined });
    if (!ok) missingIndexes.push(name);
  }

  return {
    pass: missingTables.length === 0 && missingColumns.length === 0 && missingIndexes.length === 0,
    tables,
    columns,
    indexes,
    missingTables,
    missingColumns,
    missingIndexes,
  };
}

function quoteIdent(name) {
  return `"${String(name).replace(/"/g, '""')}"`;
}

/**
 * Drift test statis: bandingkan CREATE TABLE antara turso-schema.sql (boot
 * path) dan 0001_baseline.sql (migration baseline) — tabel & kolom harus
 * identik. Melempar dengan detail bila menyimpang.
 */
/**
 * Perbedaan INTENTIONAL antara turso-schema.sql dan 0001_baseline.sql
 * (dihasilkan scripts/regenerateBaseline.mjs):
 *   - schema_migrations: tabel bookkeeping runner — hanya ada di baseline.
 *   - transactions.idempotency_key: kolom yang di turso-schema.sql HANYA ada
 *     via ALTER (bukan di CREATE TABLE) → di-inject baseline ke CREATE TABLE
 *     agar fresh DB mendapatkannya sebelum index partial dibuat.
 * Drift guard mengabaikan dua ini; divergensi LAIN tetap gagal.
 */
export const BASELINE_ONLY_TABLES = ['schema_migrations'];
export const BASELINE_INJECTED_COLUMNS = { transactions: ['idempotency_key'] };

export function assertBaselineSynced() {
  const tursoSql = fs.readFileSync(TURSO_SCHEMA_PATH, 'utf8');
  const baselinePath = path.join(MIGRATIONS_DIR, '0001_baseline.sql');
  if (!fs.existsSync(baselinePath)) {
    throw new Error('0001_baseline.sql tidak ditemukan — jalankan scripts/regenerateBaseline.mjs');
  }
  const baselineSql = fs.readFileSync(baselinePath, 'utf8');

  const tursoTables = parseCreateTables(tursoSql);
  const baselineTables = parseCreateTables(baselineSql);

  const diffs = [];
  const allNames = new Set([...Object.keys(tursoTables), ...Object.keys(baselineTables)]);
  for (const name of allNames) {
    const a = tursoTables[name];
    const b = baselineTables[name];
    if (!a) {
      if (BASELINE_ONLY_TABLES.includes(name)) continue; // intentional (schema_migrations)
      diffs.push(`Tabel ${name} hanya ada di baseline (hapus dari baseline — bukan tabel turso-schema.sql)`);
      continue;
    }
    if (!b) {
      diffs.push(`Tabel ${name} ada di turso-schema.sql tapi TIDAK di baseline — jalankan scripts/regenerateBaseline.mjs`);
      continue;
    }
    const injected = BASELINE_INJECTED_COLUMNS[name] || [];
    const missingInBaseline = a.filter((c) => !b.includes(c));
    const missingInTurso = b.filter((c) => !a.includes(c) && !injected.includes(c));
    if (missingInBaseline.length) {
      diffs.push(`Tabel ${name}: kolom ${missingInBaseline.join(', ')} hilang di baseline`);
    }
    if (missingInTurso.length) {
      diffs.push(`Tabel ${name}: kolom ${missingInTurso.join(', ')} ada di baseline tapi tidak di turso-schema.sql`);
    }
  }

  if (diffs.length > 0) {
    throw new Error(
      `DRIFT: turso-schema.sql dan 0001_baseline.sql tidak sinkron.\n` +
        `Jalankan "npm run db:migrate:baseline" lalu review diff-nya.\n${diffs.join('\n')}`,
    );
  }
  return { tables: allNames.size };
}
