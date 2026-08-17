#!/usr/bin/env node
/**
 * dbMigrateStatus.mjs — status migration (P0.1, read-only).
 *
 *   npm run db:migrate:status
 *
 * Menampilkan Applied / Pending / Checksum consistency. TIDAK menulis apa pun
 * (kecuali membuat tabel schema_migrations bila belum ada — read-only-ish).
 *
 * Exit code: 0 = konsisten; 1 = checksum mismatch / error.
 */
import fs from 'node:fs';
import path from 'node:path';
import { createClient } from '@libsql/client';
import { getMigrationStatus, MigrationError } from '../server/lib/migrationRunner.js';

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
    console.error('[db:migrate:status] ⛔ TURSO_DATABASE_URL wajib di-set (env atau server/.env).');
    process.exit(1);
  }
  const client = createClient({ url, authToken: process.env.TURSO_AUTH_TOKEN || undefined });

  try {
    const status = await getMigrationStatus(client);
    console.log('Applied:');
    if (status.applied.length === 0) console.log('  (belum ada)');
    for (const a of status.applied) console.log(`  ✓ ${a.version}  ${a.name}`);
    console.log('');
    console.log('Pending:');
    if (status.pending.length === 0) console.log('  (tidak ada)');
    for (const p of status.pending) console.log(`  → ${p.version}  ${p.name}`);
    console.log('');
    console.log('Checksum:');
    if (status.checksumConsistent) {
      console.log('  ✓ consistent');
    } else {
      for (const m of status.mismatches) {
        console.log(`  ✗ checksum mismatch ${m.version} (stored ${m.storedChecksum.slice(0, 12)}… ≠ current ${m.currentChecksum.slice(0, 12)}…)`);
      }
      process.exitCode = 1;
    }
  } catch (err) {
    if (err instanceof MigrationError) {
      console.error(`[db:migrate:status] ❌ ${err.code}: ${err.message}`);
    } else {
      console.error('[db:migrate:status] ❌ Gagal:', err?.message || err);
    }
    process.exit(1);
  } finally {
    client.close();
  }
}

main();
