#!/usr/bin/env node
/**
 * dbMigrate.mjs — jalankan migration Turso (P0.1).
 *
 *   npm run db:migrate
 *
 * Membaca server/.env + .env.local (pola script lain). Hanya migration
 * PENDING yang dijalankan; ATOMIK per migration (SQL + record dalam satu
 * batch). Checksum drift / versi duplikat / SQL gagal → exit 1, migration
 * yang gagal TIDAK dicatat applied.
 *
 * TIDAK pernah: drop/reset/truncate/hapus data. Aman dijalankan berulang.
 *
 * Exit code: 0 = sukses (atau sudah up-to-date); 1 = gagal.
 */
import fs from 'node:fs';
import path from 'node:path';
import { createClient } from '@libsql/client';
import { applyMigrations, getMigrationStatus, MigrationError } from '../server/lib/migrationRunner.js';

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

async function main() {
  loadEnv();
  const url = process.env.TURSO_DATABASE_URL;
  if (!url) {
    console.error('[db:migrate] ⛔ TURSO_DATABASE_URL wajib di-set (env atau server/.env).');
    process.exit(1);
  }

  const client = createClient({
    url,
    authToken: process.env.TURSO_AUTH_TOKEN || undefined,
  });

  const nodeEnv = process.env.NODE_ENV || 'development';
  console.log('CashFlow Database Migration');
  console.log('----------------------------');
  console.log(`Database    : Turso (${url.startsWith('file:') ? 'local file' : 'remote'})`);
  console.log(`Environment : ${nodeEnv}`);
  console.log('');

  try {
    // Status dulu untuk banner Current/Latest.
    const status = await getMigrationStatus(client);
    const latest = status.latest;
    const current = status.applied.length > 0 ? status.applied[status.applied.length - 1].version : '(belum ada)';
    console.log(`Current     : ${current}`);
    console.log(`Latest      : ${latest || '(tidak ada migration)'}`);
    console.log('');

    if (status.pending.length === 0 && status.applied.length === 0) {
      // DB fresh tanpa migration sama sekali — semua pending akan dijalankan.
    }
    if (status.mismatches.length > 0) {
      for (const m of status.mismatches) {
        console.log(`✗ checksum mismatch ${m.version} (stored ${m.storedChecksum.slice(0, 12)}… ≠ current ${m.currentChecksum.slice(0, 12)}…)`);
      }
      console.error('[db:migrate] ⛔ Checksum drift terdeteksi — JANGAN edit migration applied. Buat migration baru.');
      process.exit(1);
    }

    const { applied } = await applyMigrations(client, {
      onProgress: (msg) => console.log(msg),
    });

    if (applied.length === 0) {
      console.log('✓ Database schema already up to date.');
    } else {
      console.log('');
      console.log(`Migration complete (${applied.length} applied).`);
    }
  } catch (err) {
    if (err instanceof MigrationError) {
      console.error('');
      console.error('✗ Migration failed');
      console.error(`  Code    : ${err.code}`);
      if (err.version) console.error(`  Version : ${err.version}`);
      if (err.reason) console.error(`  Reason  : ${err.reason}`);
      if (err.storedChecksum && err.currentChecksum) {
        console.error(`  Stored  : ${err.storedChecksum}`);
        console.error(`  Current : ${err.currentChecksum}`);
      }
      console.error('  Status  : NOT APPLIED');
    } else {
      console.error('[db:migrate] ❌ Gagal:', err?.message || err);
    }
    process.exit(1);
  } finally {
    client.close();
  }
}

main();
