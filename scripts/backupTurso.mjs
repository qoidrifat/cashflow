#!/usr/bin/env node
/**
 * CashFlow — Backup Turso (Sprint 1.3 dari PRODUCTION_READINESS / INFRASTRUCTURE_AUDIT).
 *
 * Dump SEMUA tabel Turso (22 tabel: bisnis + gmail + monitoring) ke satu file JSON
 * ber-timestamp di ./backups/, lengkap dengan metadata & row count per tabel.
 *
 * PENJADWALAN (pilih salah satu):
 *   - Windows Task Scheduler:  schtasks /create /tn "CashFlowBackup" /tr "node D:\\Workspace\\cashflow\\scripts\\backupTurso.mjs" /sc daily /st 02:00
 *   - Linux cron:              0 2 * * * cd /path/cashflow && BACKUP_TURSO=1 node scripts/backupTurso.mjs
 *   - Cloud Scheduler → Cloud Run Job (produksi): jalankan script di image server.
 *
 * RESTORE (runbook ringkas — lihat docs/enterprise/PRODUCTION_READINESS.md):
 *   1. Buat DB Turso baru:  turso db create cashflow-restore
 *   2. Import: parse backups/cashflow-backup-<ts>.json (struktur { tables: { nama: [rows] } })
 *      → INSERT per tabel; atau gunakan tooling Turso (turso db shell <db>).
 *   3. Arahkan TURSO_DATABASE_URL ke DB restore, verifikasi SELECT COUNT(*) per tabel.
 *
 * RETENSI: file backup lebih lama dari BACKUP_RETENTION_DAYS (default 14) dihapus
 * otomatis di akhir run.
 *
 * SAFETY GUARD: memerlukan env BACKUP_TURSO=1 — mencegah eksekusi tidak sengaja
 * terhadap DB produksi dari mesin dev (pola sama SEED_E2E di seedE2eDataset.mjs).
 */
import fs from 'node:fs';
import path from 'node:path';
import { createClient } from '@libsql/client';

if (process.env.BACKUP_TURSO !== '1') {
  console.error('[backup] Safety: set BACKUP_TURSO=1 untuk konfirmasi backup. Abort.');
  process.exit(1);
}

// Load server/.env (pola sama dengan e2e/helpers/mintSession.ts)
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
  console.error('[backup] TURSO_DATABASE_URL belum diisi (server/.env). Abort.');
  process.exit(1);
}

const db = createClient({ url, authToken: authToken || undefined });

/** Ambil daftar tabel user (bukan sqlite_* internal). */
async function listTables() {
  const { rows } = await db.execute({
    sql: `SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' ORDER BY name`,
    args: [],
  });
  return rows.map((r) => String(r.name));
}

async function main() {
  const startedAt = new Date();
  const tables = await listTables();
  const dump = {
    app: 'cashflow',
    exportedAt: startedAt.toISOString(),
    source: url,
    tableCount: tables.length,
    tables: {},
    counts: {},
  };

  for (const table of tables) {
    const { rows } = await db.execute({ sql: `SELECT * FROM ${table}`, args: [] });
    dump.tables[table] = rows;
    dump.counts[table] = rows.length;
    console.log(`[backup] ${table.padEnd(28)} ${String(rows.length).padStart(6)} rows`);
  }

  const dir = path.resolve(process.cwd(), 'backups');
  fs.mkdirSync(dir, { recursive: true });
  const stamp = startedAt.toISOString().replace(/[:.]/g, '-');
  const file = path.join(dir, `cashflow-backup-${stamp}.json`);
  fs.writeFileSync(file, JSON.stringify(dump, null, 2));

  const totalRows = Object.values(dump.counts).reduce((a, b) => a + b, 0);
  const sizeMb = (fs.statSync(file).size / 1024 / 1024).toFixed(2);
  console.log(`[backup] ✅ ${tables.length} tabel, ${totalRows} rows → ${path.relative(process.cwd(), file)} (${sizeMb} MB)`);

  // Retensi: hapus backup lebih lama dari BACKUP_RETENTION_DAYS.
  const retentionDays = Number(process.env.BACKUP_RETENTION_DAYS) || 14;
  const cutoff = Date.now() - retentionDays * 86400_000;
  for (const f of fs.readdirSync(dir)) {
    if (!f.startsWith('cashflow-backup-')) continue;
    const full = path.join(dir, f);
    try {
      if (fs.statSync(full).mtimeMs < cutoff) {
        fs.unlinkSync(full);
        console.log(`[backup] 🧹 hapus backup lama: ${f} (${retentionDays} hari)`);
      }
    } catch {
      // ignore
    }
  }

  db.close();
  process.exit(0);
}

main().catch((err) => {
  console.error('[backup] Gagal:', err.message);
  try {
    db.close();
  } catch {
    // ignore
  }
  process.exit(1);
});
