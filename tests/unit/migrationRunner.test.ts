/**
 * Unit test: server/lib/migrationRunner.js — migration runner Turso (P0.1).
 *
 * Menggunakan DB libsql LOKAL TEMPORER (bukan mock): runner diuji terhadap
 * engine SQLite/libsql nyata — fresh apply, idempotency, checksum drift,
 * duplicate version, ordering deterministik, failed migration tidak dicatat.
 *
 * TIDAK butuh kredensial Turso. Cleanup temp DB di afterEach.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createClient } from '@libsql/client';
import {
  applyMigrations,
  getMigrationStatus,
  loadMigrationFiles,
  sha256Checksum,
  splitStatements,
  MigrationError,
  MIGRATIONS_DIR,
} from '../../server/lib/migrationRunner.js';
import { verifySchemaContract, assertBaselineSynced } from '../../server/lib/schemaContract.js';

/** Bikin path file DB sementara (forward-slash agar libsql Windows ok). */
function tmpDbPath(tag: string): string {
  return path.join(os.tmpdir(), `cf-mig-${tag}-${process.pid}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}.db`).replace(/\\/g, '/');
}

function tmpMigrationsDir(tag: string): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), `cf-migdir-${tag}-`));
}

function writeMigration(dir: string, file: string, sql: string): void {
  fs.writeFileSync(path.join(dir, file), sql, 'utf8');
}

const clients: Array<ReturnType<typeof createClient>> = [];
const tmpPaths: string[] = [];
const tmpDirs: string[] = [];

function newClient(tag: string): ReturnType<typeof createClient> {
  const dbPath = tmpDbPath(tag);
  tmpPaths.push(dbPath);
  const client = createClient({ url: `file:${dbPath}` });
  clients.push(client);
  return client;
}

function cleanupAll(): void {
  for (const c of clients) { try { c.close(); } catch { /* noop */ } }
  clients.length = 0;
  for (const p of tmpPaths) { for (const s of ['', '-wal', '-shm']) { try { fs.unlinkSync(p + s); } catch { /* noop */ } } }
  tmpPaths.length = 0;
  for (const d of tmpDirs) { try { fs.rmSync(d, { recursive: true, force: true }); } catch { /* noop */ } }
  tmpDirs.length = 0;
}

beforeEach(() => {
  cleanupAll();
});

afterEach(() => {
  cleanupAll();
});

describe('loadMigrationFiles — validasi & sort', () => {
  it('membaca migration nyata (0001 + 0002), terurut ASC, checksum sha256', () => {
    const migrations = loadMigrationFiles();
    expect(migrations.length).toBeGreaterThanOrEqual(2);
    expect(migrations[0].version).toBe('0001');
    expect(migrations[1].version).toBe('0002');
    expect(migrations.every((m) => /^[0-9a-f]{64}$/.test(m.checksum))).toBe(true);
    expect(migrations[0].statements.length).toBeGreaterThan(10);
  });

  it('versi duplikat (0002_a + 0002_b) → MIGRATION_DUPLICATE_VERSION', () => {
    const dir = tmpMigrationsDir('dup');
    tmpDirs.push(dir);
    writeMigration(dir, '0001_first.sql', 'CREATE TABLE IF NOT EXISTS t1 (id TEXT PRIMARY KEY);');
    writeMigration(dir, '0002_a.sql', 'CREATE TABLE IF NOT EXISTS t2 (id TEXT PRIMARY KEY);');
    writeMigration(dir, '0002_b.sql', 'CREATE TABLE IF NOT EXISTS t3 (id TEXT PRIMARY KEY);');
    expect(() => loadMigrationFiles(dir)).toThrowError(MigrationError);
    try {
      loadMigrationFiles(dir);
      expect.unreachable();
    } catch (err) {
      expect((err as MigrationError).code).toBe('MIGRATION_DUPLICATE_VERSION');
    }
  });

  it('nama file tidak sesuai format → MIGRATION_INVALID_FILENAME', () => {
    const dir = tmpMigrationsDir('badname');
    tmpDirs.push(dir);
    writeMigration(dir, 'abc.sql', 'SELECT 1;');
    expect(() => loadMigrationFiles(dir)).toThrowError(MigrationError);
    try {
      loadMigrationFiles(dir);
      expect.unreachable();
    } catch (err) {
      expect((err as MigrationError).code).toBe('MIGRATION_INVALID_FILENAME');
    }
  });

  it('splitStatements memecah benar & strip komentar', () => {
    const stmts = splitStatements('-- komentar\nCREATE TABLE a (x TEXT);\nCREATE INDEX i ON a(x);');
    expect(stmts).toEqual(['CREATE TABLE a (x TEXT)', 'CREATE INDEX i ON a(x)']);
  });

  it('sha256Checksum deterministik', () => {
    expect(sha256Checksum('abc')).toBe(sha256Checksum('abc'));
    expect(sha256Checksum('abc')).not.toBe(sha256Checksum('abd'));
  });
});

describe('applyMigrations — siklus hidup pada DB nyata', () => {
  it('FRESH DB: apply semua migration → kontrak schema PASS + version tercatat', async () => {
    const client = newClient('fresh');
    const result = await applyMigrations(client);
    expect(result.applied.length).toBeGreaterThanOrEqual(2);
    expect(result.upToDate).toBe(false);

    const status = await getMigrationStatus(client);
    // P2.5 (0005-0007): opening balance akun + linkage transaksi + transfer group.
    // P2.6 (0008): reconciliation fields (real balance, review status, audit log).
    // P2.7 (0009): balance anchor verification status (persisted outcome).
    // P2.8 (0010): transfer candidate review status (reject persist).
    // P0.11 (0011): wallet_accounts.provider_code (link ke provider catalog).
    expect(status.applied.map((a) => a.version)).toEqual(['0001', '0002', '0003', '0004', '0005', '0006', '0007', '0008', '0009', '0010', '0011']);
    expect(status.pending).toEqual([]);
    expect(status.checksumConsistent).toBe(true);

    const contract = await verifySchemaContract(client);
    expect(contract.pass, JSON.stringify({ tables: contract.missingTables, columns: contract.missingColumns, indexes: contract.missingIndexes })).toBe(true);
    // Hardening TOCTOU final (0003): index unik gmail terpasang & benar (unique partial).
    const gmailIdx = contract.indexes.find((i) => i.name === 'idx_transactions_gmail_msg_unique');
    expect(gmailIdx?.ok, JSON.stringify(gmailIdx)).toBe(true);
    // Konfigurasi finansial per-user (0004): tabel user_financial_settings ada.
    expect(contract.tables.some((t) => t.name === 'user_financial_settings' && t.ok)).toBe(true);
  });

  it('REPEAT: migrate lagi → no-op (upToDate, 0 applied)', async () => {
    const client = newClient('repeat');
    await applyMigrations(client);
    const second = await applyMigrations(client);
    expect(second.applied).toEqual([]);
    expect(second.upToDate).toBe(true);
    expect(second.pending).toEqual([]);
  });

  it('CHECKSUM DRIFT: file applied berubah → MIGRATION_CHECKSUM_MISMATCH (tidak dijalankan ulang)', async () => {
    const dir = tmpMigrationsDir('checksum');
    tmpDirs.push(dir);
    writeMigration(dir, '0001_first.sql', 'CREATE TABLE IF NOT EXISTS drift_t (id TEXT PRIMARY KEY);');
    const client = newClient('drift');
    await applyMigrations(client, { migrationsDir: dir });

    // Ubah file applied (menambahkan kolom) — drift terdeteksi.
    writeMigration(dir, '0001_first.sql', 'CREATE TABLE IF NOT EXISTS drift_t (id TEXT PRIMARY KEY, extra TEXT);');
    await expect(applyMigrations(client, { migrationsDir: dir })).rejects.toThrowError(MigrationError);
    try {
      await applyMigrations(client, { migrationsDir: dir });
      expect.unreachable();
    } catch (err) {
      const e = err as MigrationError;
      expect(e.code).toBe('MIGRATION_CHECKSUM_MISMATCH');
      expect(e.version).toBe('0001');
      expect(e.storedChecksum).toBeTruthy();
      expect(e.currentChecksum).toBeTruthy();
      expect(e.storedChecksum).not.toBe(e.currentChecksum);
    }
    // Baris belum tercatat ulang (versi tetap 1, checksum lama).
    const status = await getMigrationStatus(client, { migrationsDir: dir });
    expect(status.applied).toHaveLength(1);
    expect(status.mismatches).toHaveLength(1);
    expect(status.checksumConsistent).toBe(false);
  });

  it('ORDERING: sort deterministik 0002 sebelum 0001 di disk → tetap apply 0001 dulu', async () => {
    const dir = tmpMigrationsDir('order');
    tmpDirs.push(dir);
    // 0002 membuat tabel + menyisipkan baris; 0001 membuat tabel sumber.
    writeMigration(dir, '0002_second.sql', 'INSERT INTO ord_t (id) VALUES (\'from-0002\');');
    writeMigration(dir, '0001_first.sql', 'CREATE TABLE IF NOT EXISTS ord_t (id TEXT PRIMARY KEY);');
    const client = newClient('order');
    await applyMigrations(client, { migrationsDir: dir });
    const status = await getMigrationStatus(client, { migrationsDir: dir });
    expect(status.applied.map((a) => a.version)).toEqual(['0001', '0002']);
    const rows = await client.execute({ sql: 'SELECT id FROM ord_t', args: [] });
    expect(rows.rows.map((r) => String(r.id))).toEqual(['from-0002']);
  });

  it('FAILED MIGRATION: SQL gagal → MIGRATION_FAILED, TIDAK dicatat applied, statement sebelum tetap', async () => {
    const dir = tmpMigrationsDir('fail');
    tmpDirs.push(dir);
    writeMigration(dir, '0001_ok.sql', 'CREATE TABLE IF NOT EXISTS ok_t (id TEXT PRIMARY KEY);');
    writeMigration(dir, '0002_broken.sql', 'INSERT INTO table_yang_tidak_ada (id) VALUES (\'x\');');
    const client = newClient('fail');
    await expect(applyMigrations(client, { migrationsDir: dir })).rejects.toThrowError(MigrationError);
    try {
      await applyMigrations(client, { migrationsDir: dir });
      expect.unreachable();
    } catch (err) {
      expect((err as MigrationError).code).toBe('MIGRATION_FAILED');
      expect((err as MigrationError).version).toBe('0002');
    }
    // Hanya 0001 tercatat; 0002 TIDAK (walaupun file tetap ada di disk).
    const status = await getMigrationStatus(client, { migrationsDir: dir });
    expect(status.applied.map((a) => a.version)).toEqual(['0001']);
    expect(status.pending.map((p) => p.version)).toEqual(['0002']);
    // Tabel 0001 benar-benar ada (statement 0001 sukses — bukan dirollback).
    const tables = await client.execute({ sql: "SELECT name FROM sqlite_master WHERE type='table' AND name='ok_t'", args: [] });
    expect(tables.rows).toHaveLength(1);
  });

  it('schema_migrations mencatat checksum file yang benar', async () => {
    const dir = tmpMigrationsDir('record');
    tmpDirs.push(dir);
    writeMigration(dir, '0001_first.sql', 'CREATE TABLE IF NOT EXISTS rec_t (id TEXT PRIMARY KEY);');
    const client = newClient('record');
    await applyMigrations(client, { migrationsDir: dir });
    const rows = await client.execute({ sql: 'SELECT version, name, checksum, applied_at FROM schema_migrations', args: [] });
    expect(rows.rows).toHaveLength(1);
    const row = rows.rows[0];
    expect(String(row.version)).toBe('0001');
    expect(String(row.checksum)).toBe(sha256Checksum('CREATE TABLE IF NOT EXISTS rec_t (id TEXT PRIMARY KEY);'));
    expect(String(row.applied_at)).toBeTruthy();
  });
});

describe('schemaContract — drift guard', () => {
  it('assertBaselineSynced: turso-schema.sql ↔ 0001_baseline.sql identik (tabel & kolom)', () => {
    expect(() => assertBaselineSynced()).not.toThrow();
  });

  it('kontrak gagal bila tabel hilang (missing table → FAIL)', async () => {
    const client = newClient('missing');
    await client.execute({ sql: 'CREATE TABLE IF NOT EXISTS user (id TEXT PRIMARY KEY);', args: [] });
    await client.execute({ sql: 'CREATE TABLE IF NOT EXISTS schema_migrations (version TEXT PRIMARY KEY, name TEXT, checksum TEXT, applied_at TEXT);', args: [] });
    const contract = await verifySchemaContract(client);
    expect(contract.pass).toBe(false);
    expect(contract.missingTables.length).toBeGreaterThan(0);
    expect(contract.missingTables).toContain('transactions');
  });

  it('kontrak mendeteksi index partial unique idempotency yang salah (non-unique)', async () => {
    const client = newClient('idxwrong');
    // Tabel tanpa kolom idempotency dan index NON-unique → kontrak harus FAIL.
    await client.execute({ sql: 'CREATE TABLE IF NOT EXISTS transactions (id TEXT PRIMARY KEY, user_id TEXT, idempotency_key TEXT, transaction_date TEXT, amount REAL);', args: [] });
    await client.execute({ sql: 'CREATE INDEX IF NOT EXISTS idx_transactions_user_idempotency ON transactions(user_id, idempotency_key) WHERE idempotency_key IS NOT NULL;', args: [] });
    // Index dibuat NON-unique → deteksi.
    const contract = await verifySchemaContract(client);
    expect(contract.pass).toBe(false);
    const idx = contract.indexes.find((i) => i.name === 'idx_transactions_user_idempotency');
    expect(idx?.ok).toBe(false);
  });

  it('kontrak mendeteksi index unik gmail yang HILANG (hardening TOCTOU final 0003 tidak terpasang)', async () => {
    const client = newClient('gmailidx');
    // Tabel transactions ADA tapi index unik gmail belum dibuat → kontrak FAIL.
    await client.execute({ sql: 'CREATE TABLE IF NOT EXISTS transactions (id TEXT PRIMARY KEY, user_id TEXT, gmail_message_id TEXT, transaction_date TEXT, amount REAL);', args: [] });
    const contract = await verifySchemaContract(client);
    expect(contract.pass).toBe(false);
    expect(contract.missingIndexes).toContain('idx_transactions_gmail_msg_unique');
  });

  it('kontrak mendeteksi index unik gmail yang salah (non-unique, partial tidak ada)', async () => {
    const client = newClient('gmailidxwrong');
    await client.execute({ sql: 'CREATE TABLE IF NOT EXISTS transactions (id TEXT PRIMARY KEY, user_id TEXT, gmail_message_id TEXT, transaction_date TEXT, amount REAL);', args: [] });
    // Index dibuat NON-unique & non-partial → deteksi.
    await client.execute({ sql: 'CREATE INDEX IF NOT EXISTS idx_transactions_gmail_msg_unique ON transactions(user_id, gmail_message_id);', args: [] });
    const contract = await verifySchemaContract(client);
    expect(contract.pass).toBe(false);
    const idx = contract.indexes.find((i) => i.name === 'idx_transactions_gmail_msg_unique');
    expect(idx?.ok).toBe(false);
  });

  it('kontrak mendeteksi definisi partial yang HANYA IS NOT NULL (tanpa eksklusi \'\' kosong) — drift klausa WHERE', async () => {
    const client = newClient('gmailidxpartial');
    await client.execute({ sql: 'CREATE TABLE IF NOT EXISTS transactions (id TEXT PRIMARY KEY, user_id TEXT, gmail_message_id TEXT, transaction_date TEXT, amount REAL);', args: [] });
    // UNIQUE + PARTIAL benar, TAPI klausa WHERE tidak mengecualikan '' kosong —
    // masih lolos cek unique+partial, harus ditangkap oleh definitionContains
    // yang menuntut "IS NOT NULL AND gmail_message_id != ''".
    await client.execute({
      sql: "CREATE UNIQUE INDEX IF NOT EXISTS idx_transactions_gmail_msg_unique ON transactions(user_id, gmail_message_id) WHERE gmail_message_id IS NOT NULL;",
      args: [],
    });
    const contract = await verifySchemaContract(client);
    expect(contract.pass).toBe(false);
    const idx = contract.indexes.find((i) => i.name === 'idx_transactions_gmail_msg_unique');
    expect(idx?.ok).toBe(false);
    expect(idx?.detail).toContain('tidak memuat');
  });
});
