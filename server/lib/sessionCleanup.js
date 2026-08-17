/**
 * sessionCleanup.js — pembersihan sesi kedaluwarsa di Turso.
 *
 * Sesi Better Auth disimpan di tabel `session` dengan kolom `expiresAt`.
 * PENTING (ditemukan 2026-08-09, verifikasi DB live): schema menyatakan
 * `expiresAt INTEGER NOT NULL`, tapi adapter libSQL MENULIS **ISO 8601 TEXT**
 * (`2026-08-15T04:09:42.589Z`) — bukan unix ms. Baris sesi yang kedaluwarsa
 * TIDAK pernah dihapus oleh better-auth sendiri (hanya sign-out / rotasi yang
 * menghapus) → akumulasi sampah tanpa batas di tabel `session`.
 *
 * Query hapus HARUS menangani kedua bentuk penyimpanan (defensif terhadap
 * skenario migrasi / penulisan numerik):
 *   - text (bentuk nyata):   julianday(expiresAt) < julianday('now')
 *     (julianday mem-parse ISO 8601; bandingkan sebagai waktu, bukan string)
 *   - integer (ms):          expiresAt < unixepoch() * 1000
 * Hanya baris dengan `expiresAt` yang bisa di-parse yang dihapus — baris
 * korup/tipe lain dilewati (tidak menghapus data valid).
 *
 * Pemanggil:
 *   - Scheduler harian di server/index.js (pola alert scheduler, interval
 *     default 24 jam, env SESSION_CLEANUP_ENABLED / SESSION_CLEANUP_INTERVAL_MS).
 *   - Script manual: scripts/cleanupExpiredSessions.mjs (ops/CLI).
 *   - Unit test: tests/unit/sessionCleanup.test.ts (mock @libsql/client).
 */
import { getTurso } from './turso.js';
import { logger } from './logger.js';

/** SQL hapus — expired dalam bentuk text (ISO) ATAU integer (ms). */
export const CLEANUP_SQL = `
DELETE FROM session
WHERE (typeof(expiresAt) = 'text' AND julianday(expiresAt) < julianday('now'))
   OR (typeof(expiresAt) = 'integer' AND expiresAt < (unixepoch() * 1000))
`;

/**
 * Hapus SEMUA sesi kedaluwarsa dari Turso.
 *
 * @param {import('@libsql/client').Client} [client] — override client (unit test).
 *   Default: getTurso().
 * @returns {Promise<{ deleted: number }>} — jumlah baris sesi yang dihapus.
 * @throws — error DB diteruskan ke caller (scheduler menangkap & log warn;
 *   script manual menangkap & exit non-zero). TIDAK pernah menelan error.
 */
export async function cleanupExpiredSessions(client) {
  const turso = client || getTurso();
  if (!turso) {
    logger.warn({}, 'Session cleanup: Turso client tidak tersedia — dilewati');
    return { deleted: 0 };
  }

  const result = await turso.execute({ sql: CLEANUP_SQL, args: [] });
  // rowsAffected selalu tersedia pada hasil execute @libsql/client (dibuktikan
  // live). Fallback rows.length TIDAK dipakai untuk DELETE (rows kosong → 0
  // menyesatkan); bila rowsAffected undefined, laporkan -1 (unknown) agar
  // jumlah yang salah tidak di-log sebagai fakta.
  const deleted =
    result?.rowsAffected !== undefined
      ? Number(result.rowsAffected)
      : -1;
  logger.info({ deleted }, 'Session cleanup: sesi kedaluwarsa dihapus');
  return { deleted };
}
