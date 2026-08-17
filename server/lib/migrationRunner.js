/**
 * migrationRunner.js — versioned migration runner untuk Turso/libSQL (P0.1).
 *
 * LATAR BELAKANG: sebelumnya schema hanya di-apply idempoten saat boot
 * (initTursoSchema — turso-schema.sql, tanpa version tracking). Runner ini
 * adalah lapisan versioned DI ATAS-nya (bukan pengganti boot path; lihat
 * docs/database/MIGRATIONS.md). Seluruh perubahan schema BARU = migration
 * numbered di server/migrations/ (0002+, ...), bukan edit turso-schema.sql.
 *
 * PRINSIP (hardening, bukan rewrite):
 *   1. Baseline existing schema (0001_baseline.sql) — aman untuk DB fresh
 *      MAUPUN existing (CREATE ... IF NOT EXISTS / INSERT OR IGNORE).
 *   2. Pending-only: hanya migration yang belum tercatat di schema_migrations
 *      yang dieksekusi.
 *   3. ATOMIK per migration: [statement SQL migration..., INSERT
 *      schema_migrations] dijalankan dalam SATU batch (libsql batch =
 *      transaksi). Migration TIDAK pernah tercatat applied bila SQL-nya gagal
 *      (INSERT ikut rollback).
 *   4. Checksum drift: sha256 file dibandingkan dengan checksum tercatat.
 *      File applied yang BERUBAH → MIGRATION_CHECKSUM_MISMATCH (fail, JANGAN
 *      dijalankan ulang). Remediasi = migration BARU, bukan edit file applied.
 *   5. Fail-fast: error apa pun menghentikan runner; tidak ada statement yang
 *      diam-diam di-ignore (tidak seperti initTursoSchema yang idempoten-
 *      tolerant untuk legacy).
 *   6. Concurrency: batch atomik + PRIMARY KEY version di schema_migrations =
 *      mekanisme lock transaksional (proses kedua yang menerapkan versi sama
 *      gagal pada INSERT → batch rollback → tidak ada double-apply parsial).
 *      Tidak ada filesystem lock (bukan production guarantee).
 *
 * Pemanggil:
 *   - CLI: scripts/dbMigrate.mjs / dbMigrateStatus.mjs / dbMigrateCheck.mjs
 *   - Unit test: tests/unit/migrationRunner.test.ts (DB libsql lokal temp)
 */
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
export const MIGRATIONS_DIR = path.resolve(__dirname, '..', 'migrations');

/** Error khusus migration — carry `code` + `version` + detail untuk CLI. */
export class MigrationError extends Error {
  constructor(code, message, details = {}) {
    super(message);
    this.name = 'MigrationError';
    this.code = code;
    Object.assign(this, details);
  }
}

export const ERROR_CODES = {
  CONNECTIVITY: 'MIGRATION_CONNECTIVITY',
  CHECKSUM_MISMATCH: 'MIGRATION_CHECKSUM_MISMATCH',
  DUPLICATE_VERSION: 'MIGRATION_DUPLICATE_VERSION',
  INVALID_FILENAME: 'MIGRATION_INVALID_FILENAME',
  FAILED: 'MIGRATION_FAILED',
};

const VERSION_RE = /^(\d{4})_(.+\.sql)$/;

/** sha256 hex dari konten file (checksum migration). */
export function sha256Checksum(content) {
  return crypto.createHash('sha256').update(content, 'utf8').digest('hex');
}

/**
 * Baca + validasi semua file migration di MIGRATIONS_DIR.
 *
 * @param {string} [dir] — override directory (unit test).
 * @returns {Array<{ version: string, name: string, checksum: string, statements: string[] }>}
 *   terurut ASC oleh version numerik. Melempar MigrationError untuk:
 *   - nama file tidak sesuai format (INVALID_FILENAME)
 *   - versi duplikat (DUPLICATE_VERSION)
 */
export function loadMigrationFiles(dir = MIGRATIONS_DIR) {
  if (!fs.existsSync(dir)) {
    throw new MigrationError(ERROR_CODES.INVALID_FILENAME, `Direktori migration tidak ditemukan: ${dir}`);
  }
  const files = fs.readdirSync(dir).filter((f) => f.endsWith('.sql'));
  if (files.length === 0) {
    throw new MigrationError(ERROR_CODES.INVALID_FILENAME, `Tidak ada file *.sql di ${dir}`);
  }

  const migrations = files.map((file) => {
    const match = VERSION_RE.exec(file);
    if (!match) {
      throw new MigrationError(
        ERROR_CODES.INVALID_FILENAME,
        `Nama file migration tidak valid: "${file}" (format: 0001_nama.sql)`,
        { file },
      );
    }
    const version = match[1];
    const content = fs.readFileSync(path.join(dir, file), 'utf8');
    return {
      version,
      name: match[2],
      file,
      checksum: sha256Checksum(content),
      statements: splitStatements(content),
    };
  });

  // Duplikat versi → fail (bukan urut diam-diam).
  const seen = new Map();
  for (const m of migrations) {
    if (seen.has(m.version)) {
      throw new MigrationError(
        ERROR_CODES.DUPLICATE_VERSION,
        `Versi migration duplikat: ${m.version} (${seen.get(m.version)} dan ${m.file}). ` +
          'Gunakan nomor versi unik per migration.',
        { version: m.version, files: [seen.get(m.version), m.file] },
      );
    }
    seen.set(m.version, m.file);
  }

  // Sort deterministik ASC (pola naming 0001/0002/... — sort numerik, bukan lexicographic).
  migrations.sort((a, b) => Number(a.version) - Number(b.version));
  return migrations;
}

/**
 * Pecah file SQL menjadi statement (pola yang sama dengan initTursoSchema:
 * strip komentar baris lalu split ';'). Aman untuk schema ini (tidak ada
 * semicolon di dalam string literal).
 */
export function splitStatements(sqlContent) {
  return sqlContent
    .replace(/--.*$/gm, '')
    .split(';')
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
}

export const SCHEMA_MIGRATIONS_SQL = `
CREATE TABLE IF NOT EXISTS schema_migrations (
  version TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  checksum TEXT NOT NULL,
  applied_at TEXT NOT NULL
);
`;

export const RECORD_MIGRATION_SQL = `
INSERT INTO schema_migrations (version, name, checksum, applied_at)
VALUES (?, ?, ?, datetime('now'))
`;

/** Query applied migrations (ASC) — dipakai runner & status command. */
export const LIST_APPLIED_SQL = 'SELECT version, name, checksum, applied_at FROM schema_migrations ORDER BY version ASC';

/**
 * Verifikasi koneksi + buat tabel schema_migrations bila belum ada.
 *
 * @param {import('@libsql/client').Client} client
 */
export async function ensureMigrationTable(client) {
  await client.execute({ sql: SCHEMA_MIGRATIONS_SQL, args: [] });
}

/**
 * Terapkan SEMUA migration pending terhadap client (ATOMIK per migration).
 *
 * @param {import('@libsql/client').Client} client
 * @param {{ migrationsDir?: string, onProgress?: (msg: string) => void }} [options]
 * @returns {Promise<{
 *   applied: Array<{ version: string, name: string }>,
 *   pending: Array<{ version: string, name: string }>,
 *   upToDate: boolean,
 * }>}
 * @throws MigrationError — CHECKSUM_MISMATCH / FAILED (berhenti di sini).
 */
export async function applyMigrations(client, { migrationsDir, onProgress } = {}) {
  const log = onProgress || (() => {});

  // 1. Verify connectivity.
  try {
    await client.execute({ sql: 'SELECT 1 AS ok', args: [] });
  } catch (err) {
    throw new MigrationError(
      ERROR_CODES.CONNECTIVITY,
      `Tidak dapat terhubung ke database: ${err?.message || String(err)}`,
      { reason: err?.message || String(err) },
    );
  }

  // 2. Buat tabel bookkeeping bila belum ada.
  await ensureMigrationTable(client);

  // 3. Baca + validasi file migration.
  const migrations = loadMigrationFiles(migrationsDir);

  // 4. Bandingkan dengan applied.
  const appliedResult = await client.execute({ sql: LIST_APPLIED_SQL, args: [] });
  const appliedByVersion = new Map(
    (appliedResult.rows || []).map((r) => [String(r.version), { checksum: String(r.checksum), name: String(r.name) }]),
  );

  // 5. Deteksi checksum drift pada migration yang SUDAH applied.
  for (const m of migrations) {
    const applied = appliedByVersion.get(m.version);
    if (applied && applied.checksum !== m.checksum) {
      throw new MigrationError(
        ERROR_CODES.CHECKSUM_MISMATCH,
        `Checksum migration ${m.version} (${m.file}) BERUBAH setelah di-apply. ` +
          'JANGAN mengedit migration yang sudah applied — buat migration baru ' +
          '(0003+, dst) untuk perubahan berikutnya.',
        {
          version: m.version,
          storedChecksum: applied.checksum,
          currentChecksum: m.checksum,
        },
      );
    }
  }

  // 6. Terapkan pending (urut ASC), ATOMIK per migration.
  const applied = [];
  const pending = [];
  for (const m of migrations) {
    if (appliedByVersion.has(m.version)) continue;
    pending.push({ version: m.version, name: m.name });

    const recordStmt = { sql: RECORD_MIGRATION_SQL, args: [m.version, m.name, m.checksum] };
    try {
      await client.batch([...m.statements.map((sql) => ({ sql, args: [] })), recordStmt]);
    } catch (err) {
      throw new MigrationError(
        ERROR_CODES.FAILED,
        `Migration ${m.version} GAGAL — tidak dicatat sebagai applied: ${err?.message || String(err)}`,
        { version: m.version, reason: err?.message || String(err) },
      );
    }
    applied.push({ version: m.version, name: m.name });
    log(`✓ ${m.version} ${m.name}`);
  }

  return { applied, pending, upToDate: applied.length === 0 };
}

/**
 * Status migration (command db:migrate:status) — tanpa menulis apa pun.
 *
 * @returns {Promise<{
 *   applied: Array<{ version: string, name: string, checksum: string, applied_at: string }>,
 *   pending: Array<{ version: string, name: string }>,
 *   checksumConsistent: boolean,
 *   mismatches: Array<{ version: string, storedChecksum: string, currentChecksum: string }>,
 *   latest: string | null,
 * }>}
 */
export async function getMigrationStatus(client, { migrationsDir } = {}) {
  await client.execute({ sql: 'SELECT 1 AS ok', args: [] });
  await ensureMigrationTable(client);

  const migrations = loadMigrationFiles(migrationsDir);
  const appliedResult = await client.execute({ sql: LIST_APPLIED_SQL, args: [] });
  const applied = (appliedResult.rows || []).map((r) => ({
    version: String(r.version),
    name: String(r.name),
    checksum: String(r.checksum),
    applied_at: String(r.applied_at || ''),
  }));

  const appliedByVersion = new Map(applied.map((a) => [a.version, a]));
  const pending = [];
  const mismatches = [];
  for (const m of migrations) {
    const rec = appliedByVersion.get(m.version);
    if (!rec) {
      pending.push({ version: m.version, name: m.name });
    } else if (rec.checksum !== m.checksum) {
      mismatches.push({ version: m.version, storedChecksum: rec.checksum, currentChecksum: m.checksum });
    }
  }

  const latest = migrations.length > 0 ? migrations[migrations.length - 1].version : null;
  return { applied, pending, checksumConsistent: mismatches.length === 0, mismatches, latest };
}
