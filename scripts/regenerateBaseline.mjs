#!/usr/bin/env node
/**
 * regenerateBaseline.mjs — regenerate server/migrations/0001_baseline.sql dari
 * turso-schema.sql (schema kanonik boot-time).
 *
 * KENAPA ADA DUA FILE? (lihat docs/database/MIGRATIONS.md)
 *   - turso-schema.sql        : schema idempoten yang di-apply boot-time oleh
 *                               initTursoSchema (server/lib/turso.js). Tetap
 *                               ada untuk backward-compat & DB lama yang masih
 *                               butuh ALTER kolom legacy.
 *   - 0001_baseline.sql       : BASELINE migration (versioned). FRESH DB
 *                               dibangun DARI SINI (via npm run db:migrate).
 *
 * ATURAN KONVERSI (agar baseline aman dieksekusi di DB fresh MAUPUN existing):
 *   1. CREATE TABLE/INDEX IF NOT EXISTS + seed INSERT OR IGNORE dipertahankan
 *      (idempoten).
 *   2. ALTER TABLE ADD COLUMN one-off legacy DIHAPUS — efeknya sudah ada di
 *      statement CREATE TABLE (kolom ikut definisi tabel).
 *   3. PENGECUALIAN: kolom yang HANYA ada via ALTER (tidak ada di CREATE
 *      TABLE-nya — saat ini hanya transactions.idempotency_key) DI-INJECT ke
 *      definisi CREATE TABLE. Alasan: fresh DB perlu kolom itu SEBELUM index
 *      partial dibuat; existing DB tidak peduli (CREATE IF NOT EXISTS no-op).
 *
 * Regenerasi (saat schema berubah): npm run db:migrate:baseline
 * Drift guard (tests/unit/schemaContract.test.ts) memastikan kedua file TIDAK
 * menyimpang (tabel/kolom CREATE TABLE harus identik).
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const SRC = path.join(ROOT, 'turso-schema.sql');
const DST = path.join(ROOT, 'server', 'migrations', '0001_baseline.sql');

const src = fs.readFileSync(SRC, 'utf8');

const header = `-- =============================================
-- CashFlow Database Migration — 0001_baseline
-- =============================================
-- BASELINE schema (dibuat 2026-08-09, regenerable via
-- scripts/regenerateBaseline.mjs dari turso-schema.sql).
--
-- Strategi baseline (bukan drop/recreate):
--   * FRESH DB  → file ini dieksekusi penuh (CREATE ... IF NOT EXISTS).
--   * DB EXISTING → statement adalah no-op idempoten; runner mencatat versi
--     sebagai applied (baseline existing schema).
--
-- TIDAK berisi ALTER TABLE ADD COLUMN one-off legacy (efeknya sudah ada di
-- statement CREATE TABLE; kolom yang hanya ada via ALTER — mis.
-- transactions.idempotency_key — di-inject ke definisi CREATE TABLE). DB lama
-- yang masih butuh ALTER mendapatkannya via initTursoSchema boot path. Semua
-- perubahan schema BARU = migration 0002+, bukan edit file ini.
-- =============================================

-- =============================================
-- Migration bookkeeping (dibuat runner bila belum ada)
-- =============================================
CREATE TABLE IF NOT EXISTS schema_migrations (
  version TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  checksum TEXT NOT NULL,
  applied_at TEXT NOT NULL
);

`;

// 1. Statement-level: strip komentar baris lalu split ';' (pola initTursoSchema).
const rawStmts = src
  .replace(/--.*$/gm, '')
  .split(';')
  .map((s) => s.trim())
  .filter((s) => s.length > 0);

// 2. Ambil definisi kolom CREATE TABLE (tabel → daftar kolom).
const createRe = /^CREATE\s+TABLE\s+(?:IF\s+NOT\s+EXISTS\s+)?(\w+)\s*\(([\s\S]*)\)$/;
const tableColumns = new Map();
for (const stmt of rawStmts) {
  const m = createRe.exec(stmt);
  if (!m) continue;
  const cols = [];
  for (const line of m[2].split('\n')) {
    const t = line.trim();
    const cm = /^([A-Za-z_]\w*)\s+/.exec(t);
    if (cm && !/^(PRIMARY|FOREIGN|UNIQUE|CHECK|CONSTRAINT)/i.test(t)) cols.push(cm[1]);
  }
  tableColumns.set(m[1], cols);
}

// 3. Untuk tiap ALTER ADD COLUMN: bila kolomnya TIDAK ada di CREATE TABLE,
//    simpan untuk di-inject; hapus statement ALTER dari baseline.
const inject = [];
const kept = [];
for (const stmt of rawStmts) {
  const alter = /^ALTER\s+TABLE\s+(\w+)\s+ADD\s+COLUMN\s+([A-Za-z_]\w*)\s+(.*)$/i.exec(stmt);
  if (!alter) {
    kept.push(stmt);
    continue;
  }
  const [, table, column, def] = alter;
  const cols = tableColumns.get(table) || [];
  if (!cols.includes(column)) {
    inject.push({ table, column, def: def.trim().replace(/;?$/, '') });
  }
  // ALTER lain (kolom sudah di CREATE TABLE) → dibuang.
}

// 4. Inject kolom yang hanya ada via ALTER ke statement CREATE TABLE-nya.
const finalStmts = [];
for (const stmt of kept) {
  const create = createRe.exec(stmt);
  if (!create) {
    finalStmts.push(stmt);
    continue;
  }
  const [, table, body] = create;
  const toInject = inject.filter((i) => i.table === table);
  if (toInject.length === 0) {
    finalStmts.push(stmt);
    continue;
  }
  // Sisipkan kolom sebelum paren penutup: "...\n)" → "...\n, col def\n)".
  const idx = body.lastIndexOf('\n)');
  let newBody;
  if (idx === -1) {
    newBody = `${body},\n  ${toInject.map((i) => `${i.column} ${i.def}`).join(',\n  ')}`;
  } else {
    newBody = `${body.slice(0, idx)},\n  ${toInject.map((i) => `${i.column} ${i.def}`).join(',\n  ')}${body.slice(idx)}`;
  }
  finalStmts.push(`CREATE TABLE IF NOT EXISTS ${table} (${newBody})`);
}

// 5. Gabungkan.
const body = finalStmts.join(';\n\n') + ';\n';
fs.writeFileSync(DST, header + body, 'utf8');

const createTables = (body.match(/CREATE TABLE IF NOT EXISTS \w+/g) || []).length;
const indexes = (body.match(/CREATE INDEX IF NOT EXISTS \w+/g) || []).length;
console.log(`[regenerateBaseline] ✅ ${DST}`);
console.log(`  CREATE TABLE IF NOT EXISTS : ${createTables}`);
console.log(`  CREATE INDEX IF NOT EXISTS : ${indexes}`);
console.log(`  ALTER dibuang              : ${rawStmts.filter((s) => /^ALTER\s+TABLE/i.test(s)).length}`);
console.log(`  Kolom di-inject ke CREATE  : ${inject.map((i) => `${i.table}.${i.column}`).join(', ') || '(tidak ada)'}`);
