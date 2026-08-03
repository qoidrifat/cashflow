#!/usr/bin/env node
/**
 * Apply Turso schema (CI-safe) — P4.15 companion for seedE2eDataset.mjs.
 *
 * Masalah yang dipecahkan: DB Turso CI yang baru dibuat KOSONG — seed E2E
 * gagal dengan "no such table: user". Script ini mengeksekusi turso-schema.sql
 * (IDEMPOTEN: 22 CREATE TABLE IF NOT EXISTS + CREATE INDEX IF NOT EXISTS +
 * ALTER yang di-ignore bila kolom sudah ada) terhadap DB target sebelum seed.
 *
 * Aman dijalankan berulang & terhadap DB apa pun (dev/prod/CI): tidak ada
 * statement destruktif — schema apply tidak menyentuh data.
 *
 * Penggunaan:
 *   TURSO_DATABASE_URL=libsql://... TURSO_AUTH_TOKEN=... node scripts/applyTursoSchema.mjs
 *   (server/.env juga dibaca bila env tidak di-set — pola sama dengan seed)
 */
import fs from 'node:fs';
import path from 'node:path';
import { createClient } from '@libsql/client';
import { initTursoSchema } from '../server/lib/turso.js';

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

const url = process.env.TURSO_DATABASE_URL;
const authToken = process.env.TURSO_AUTH_TOKEN;

if (!url) {
  console.error('[applySchema] ⛔ TURSO_DATABASE_URL wajib di-set (env atau server/.env).');
  process.exit(1);
}

const client = createClient({ url, authToken: authToken || undefined });

try {
  await initTursoSchema(client);
  // Verifikasi tabel inti yang dibutuhkan seed benar-benar ada.
  const { rows } = await client.execute(
    "SELECT name FROM sqlite_master WHERE type='table' AND name IN ('user','session','transactions','gmail_sync_logs','gmail_sync_runs','categories') ORDER BY name"
  );
  const tables = rows.map((r) => r.name);
  const expected = ['user', 'session', 'transactions', 'gmail_sync_logs', 'gmail_sync_runs', 'categories'];
  const missing = expected.filter((t) => !tables.includes(t));
  if (missing.length > 0) {
    console.error(`[applySchema] ⛔ Tabel inti masih hilang setelah apply: ${missing.join(', ')}`);
    process.exit(1);
  }
  console.log(`[applySchema] ✅ Schema terverifikasi (${tables.length} tabel inti: ${tables.join(', ')}).`);
  client.close();
} catch (err) {
  console.error(`[applySchema] ❌ Gagal: ${err.message}`);
  client.close();
  process.exit(1);
}
