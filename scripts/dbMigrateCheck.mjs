#!/usr/bin/env node
/**
 * dbMigrateCheck.mjs — Schema Drift Guard (P0.4).
 *
 *   npm run db:migrate:check
 *
 * DUA mode:
 *   1. TURSO_DATABASE_URL ter-set → verifikasi DB LIVE (read-only):
 *      - schema_migrations konsisten (checksum drift)
 *      - kontrak schema terpenuhi (tabel/kolom/index kritis, definisi aktual)
 *   2. Tanpa kredensial (CI quality job) → verifikasi LOKAL:
 *      - buat DB libsql TEMPORER, apply seluruh migration, verifikasi kontrak
 *      - memastikan migration runner menghasilkan schema yang diharapkan
 *      - TIDAK perlu secret apa pun
 *
 * Plus pemeriksaan statis: turso-schema.sql vs 0001_baseline.sql sinkron.
 *
 * Exit code: 0 = PASS; 1 = FAIL (missing table/column/index, checksum mismatch,
 * baseline drift, migration invalid).
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createClient } from '@libsql/client';
import { getMigrationStatus, loadMigrationFiles, MigrationError } from '../server/lib/migrationRunner.js';
import { verifySchemaContract, assertBaselineSynced, REQUIRED_INDEXES } from '../server/lib/schemaContract.js';

function loadEnv() {
  for (const p of ['server/.env', '.env.local']) {
    const abs = path.resolve(process.cwd(), p);
    if (!fs.existsSync(abs)) continue;
    for (const line of fs.readFileSync(abs, 'utf8').split(/\r?\n/)) {
      const t = line.trim();
      if (t && !t.startsWith('#') && t.includes('=')) {
        const i = t.indexOf('=');
        const k = t.slice(0, i).trim();
        const v = t.slice(i + 1).trim().replace(/^["']|["']$/g, '');
        if (k && !process.env[k]) process.env[k] = v;
      }
    }
  }
}

function printReport(report) {
  console.log('Schema Verification Report');
  console.log('--------------------------');
  console.log('Tables:');
  for (const t of report.tables) console.log(`  ${t.ok ? '✓' : '✗'} ${t.name}`);
  console.log('');
  console.log('Columns:');
  for (const c of report.columns) console.log(`  ${c.ok ? '✓' : '✗'} ${c.table}.${c.column}`);
  console.log('');
  console.log('Indexes:');
  for (const i of report.indexes) {
    console.log(`  ${i.ok ? '✓' : '✗'} ${i.name}${i.detail ? `  (${i.detail})` : ''}`);
  }
  console.log('');
  console.log(`Result: ${report.pass ? 'PASS' : 'FAIL'}`);
}

async function verifyLive(url, authToken) {
  const client = createClient({ url, authToken: authToken || undefined });
  try {
    // 1. Migration state + checksum.
    const status = await getMigrationStatus(client);
    console.log(`Migration   : latest ${status.latest || '—'} (${status.applied.length} applied, ${status.pending.length} pending)`);
    if (status.mismatches.length > 0) {
      console.log('Checksum    : ✗ MISMATCH');
      for (const m of status.mismatches) console.log(`  ✗ ${m.version}: stored ${m.storedChecksum.slice(0, 12)}… ≠ current ${m.currentChecksum.slice(0, 12)}…`);
      printReport({ pass: false, tables: [], columns: [], indexes: [] });
      return false;
    }
    if (status.pending.length > 0) {
      // Tidak fatal, tapi catat — deployment sebaiknya menjalankan db:migrate.
      console.log(`Checksum    : ✓ consistent (⚠ ${status.pending.length} migration pending — jalankan npm run db:migrate)`);
    } else {
      console.log('Checksum    : ✓ consistent');
    }
    console.log('');

    // 2. Kontrak schema (tabel/kolom/index aktual).
    const report = await verifySchemaContract(client);
    printReport(report);
    return report.pass;
  } finally {
    client.close();
  }
}

async function verifyLocal() {
  // Validasi statis file migration dulu (duplicate/order/checksum file).
  loadMigrationFiles(); // throws bila invalid
  assertBaselineSynced(); // throws bila turso-schema.sql vs baseline drift
  console.log('Static      : ✓ migration files valid + baseline sync (turso-schema.sql ↔ 0001_baseline.sql)');

  // Temp DB lokal → apply semua migration → verifikasi kontrak.
  // Windows: path harus forward-slash (libsql file: URL gagal dgn backslash).
  const rawTmp = path.join(os.tmpdir(), `cashflow-schema-check-${process.pid}-${Date.now()}.db`);
  const tmpPath = rawTmp.replace(/\\/g, '/');
  const client = createClient({ url: `file:${tmpPath}` });
  try {
    const { applyMigrations } = await import('../server/lib/migrationRunner.js');
    const result = await applyMigrations(client, { onProgress: (m) => console.log(`  ${m}`) });
    console.log('');
    console.log(`Migration   : ${result.applied.length} applied (fresh temp DB) → kontrak di bawah`);
    console.log('');
    const report = await verifySchemaContract(client);
    printReport(report);
    return report.pass;
  } finally {
    client.close();
    // Bersihkan temp DB (+ wal/shm bila ada).
    for (const suffix of ['', '-wal', '-shm']) {
      try { fs.unlinkSync(tmpPath + suffix); } catch { /* noop */ }
    }
  }
}

async function main() {
  loadEnv();
  const url = process.env.TURSO_DATABASE_URL;
  console.log('Schema Drift Guard — CashFlow');
  console.log('-------------------------------');

  let pass;
  if (url) {
    console.log(`Mode        : LIVE (${url.startsWith('file:') ? 'local file' : 'remote Turso'})`);
    console.log('');
    pass = await verifyLive(url, process.env.TURSO_AUTH_TOKEN);
  } else {
    console.log('Mode        : LOCAL (temp DB — tanpa kredensial Turso)');
    console.log('');
    pass = await verifyLocal();
  }
  console.log('');
  console.log(pass ? '✅ Schema drift guard: PASS' : '❌ Schema drift guard: FAIL');
  process.exit(pass ? 0 : 1);
}

main().catch((err) => {
  if (err instanceof MigrationError) {
    console.error(`[db:migrate:check] ❌ ${err.code}: ${err.message}`);
  } else {
    console.error('[db:migrate:check] ❌ Gagal:', err?.message || err);
  }
  process.exit(1);
});
