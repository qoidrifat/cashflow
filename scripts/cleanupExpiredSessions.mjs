/**
 * cleanupExpiredSessions.mjs — hapus sesi kedaluwarsa dari Turso (manual ops).
 *
 * Memakai fungsi yang SAMA dengan scheduler harian server
 * (server/lib/sessionCleanup.js → cleanupExpiredSessions) — satu sumber
 * kebenaran untuk query hapus. Berguna untuk: audit / dry-run / maintenance
 * tanpa menunggu interval harian server.
 *
 * Menjalankan:
 *   npm run cleanup:sessions            # hapus sesi kedaluwarsa, tampilkan jumlah
 *   node scripts/cleanupExpiredSessions.mjs
 *
 * Prasyarat: TURSO_DATABASE_URL (+ TURSO_AUTH_TOKEN bila perlu) di server/.env
 * atau env proses. Exit code: 0 = sukses; 1 = client Turso tidak tersedia / error.
 */
import fs from 'node:fs';
import path from 'node:path';
import { createClient } from '@libsql/client';
import { cleanupExpiredSessions, CLEANUP_SQL } from '../server/lib/sessionCleanup.js';

function loadEnv() {
  for (const p of ['server/.env', '.env.local']) {
    if (!fs.existsSync(p)) continue;
    for (const line of fs.readFileSync(p, 'utf8').split(/\r?\n/)) {
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
  if (!process.env.TURSO_DATABASE_URL) {
    console.error('[cleanup] TURSO_DATABASE_URL tidak ditemukan (cek server/.env)');
    process.exit(1);
  }
  const client = createClient({
    url: process.env.TURSO_DATABASE_URL,
    authToken: process.env.TURSO_AUTH_TOKEN || undefined,
  });
  try {
    console.log('[cleanup] Menjalankan query:');
    console.log(CLEANUP_SQL.trim().split('\n').map((l) => `  ${l}`).join('\n'));
    const { deleted } = await cleanupExpiredSessions(client);
    console.log(`[cleanup] SELESAI — ${deleted} sesi kedaluwarsa dihapus.`);
  } finally {
    client.close();
  }
}

main().catch((e) => {
  console.error('[cleanup] GAGAL:', e?.message || e);
  process.exit(1);
});
