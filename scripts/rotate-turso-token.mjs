#!/usr/bin/env node
/**
 * rotate-turso-token.mjs — bantu rotasi TURSO_AUTH_TOKEN (deploy gate audit).
 *
 * TOKEN BARU TIDAK bisa dibuat otomatis di sini: pembuatan token butuh akun
 * Turso (dashboard/CLI login). Script ini mengambil nilai token BARU dari
 * argumen/clipboard, memvalidasi formatnya, MENGUJINYA langsung ke DB
 * (SELECT 1), lalu menukar nilai lama di server/.env secara atomik.
 *
 * Langkah rotasi lengkap:
 *   1. Buka https://app.turso.tech → login → pilih database "cashflow-ryukinoir"
 *   2. Tab "Tokens"? Tidak ada UI token per-DB di dashboard — gunakan CLI:
 *      npm i -g @turso/turso   (sekali)
 *      turso auth login        (buka browser)
 *      turso db tokens create cashflow-ryukinoir --expiration 90d
 *      → salin token baru (eyJ... / format JWT EdDSA)
 *      (Alternatif tanpa CLI: Turso Platform API POST /v1/databases/{db}/tokens
 *       dengan Platform API token dari dashboard → Account → API Tokens.)
 *   3. Jalankan:  node scripts/rotate-turso-token.mjs <TOKEN_BARU>
 *   4. Script menguji token ke DB dulu; hanya bila SELECT 1 sukses, nilai di
 *      server/.env diganti. Token lama TIDAK dihapus otomatis — revoke manual:
 *      turso db tokens invalidate cashflow-ryukinoir  (bila didukung versi CLI)
 *      ATAU buat token expiration pendek sejak awal (90d) supaya mati sendiri.
 *
 * Exit code: 0 = sukses swap; 1 = gagal (token invalid / format salah).
 * server/.env TIDAK pernah di-commit (gitignored) — aman.
 */
import fs from 'node:fs';
import path from 'node:path';
import { createClient } from '@libsql/client';

const newToken = process.argv[2];
if (!newToken || newToken.length < 40) {
  console.error('[rotate] ⛔ Pemakaian: node scripts/rotate-turso-token.mjs <TOKEN_BARU>');
  console.error('          Token JWT Turso biasanya >200 char (mulai "ey"). Diterima:',
    newToken ? `${newToken.length} char` : '(kosong)');
  process.exit(1);
}
if (!newToken.startsWith('ey')) {
  console.error('[rotate] ⛔ Token tidak seperti JWT Turso (harus mulai "ey"). Cek ulang salinannya.');
  process.exit(1);
}

const ENV_PATH = path.resolve(process.cwd(), 'server', '.env');
if (!fs.existsSync(ENV_PATH)) {
  console.error('[rotate] ⛔ server/.env tidak ditemukan. Jalankan dari root repo.');
  process.exit(1);
}
const envText = fs.readFileSync(ENV_PATH, 'utf8');
const oldMatch = envText.match(/^TURSO_AUTH_TOKEN=(.+)$/m);
const oldToken = oldMatch ? oldMatch[1].trim() : '';
if (!oldMatch) {
  console.error('[rotate] ⛔ TURSO_AUTH_TOKEN tidak ada di server/.env — struktur env tidak sesuai.');
  process.exit(1);
}
if (oldToken === newToken) {
  console.log('[rotate] Token baru = token lama. Tidak ada yang diubah.');
  process.exit(0);
}

const urlMatch = envText.match(/^TURSO_DATABASE_URL=(.+)$/m);
if (!urlMatch) {
  console.error('[rotate] ⛔ TURSO_DATABASE_URL tidak ada di server/.env.');
  process.exit(1);
}
const dbUrl = urlMatch[1].trim();

// ── Uji token BARU dulu (fail-closed) ──
console.log('[rotate] Menguji token baru ke', dbUrl, '...');
try {
  const client = createClient({ url: dbUrl, authToken: newToken });
  await client.execute('SELECT 1');
  console.log('[rotate] ✓ Token BARU valid (SELECT 1 sukses).');
} catch (err) {
  console.error('[rotate] ⛔ Token BARU GAGAL terhubung:', err.message);
  console.error('        Tidak ada perubahan ditulis. Cek: token benar utk database ini? belum expired?');
  process.exit(1);
}

// ── Swap atomik (write temp + rename) ──
const updated = envText.replace(
  /^(TURSO_AUTH_TOKEN=).+$/m,
  `$1${newToken}`,
);
const tmp = `${ENV_PATH}.tmp`;
fs.writeFileSync(tmp, updated, 'utf8');
fs.renameSync(tmp, ENV_PATH);
console.log('[rotate] ✓ server/.env diperbarui (token lama diganti).');
console.log('[rotate] LANGKAH TERAKHIR (manual): revoke token lama di Turso agar tidak bisa dipakai lagi —');
console.log('          turso db tokens list cashflow-ryukinoir && turso db tokens invalidate <name>');
console.log('          atau biarkan expired sendiri bila dibuat dengan --expiration.');
