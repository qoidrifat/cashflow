/**
 * Unit test: server/lib/sessionCleanup.js — hapus sesi kedaluwarsa.
 *
 * Tanpa DB nyata: @libsql/client di-mock (client palsu) — pola yang sama dengan
 * tursoBootRetry.test.ts (harus menunjuk SALINAN server/node_modules karena ada
 * DUA salinan @libsql/client di repo ini; kalau mock root, createClient asli
 * tetap terpanggil).
 *
 * Yang di-lock:
 *   1. SQL hapus menangani DUA bentuk penyimpanan expiresAt:
 *      - text ISO 8601 (bentuk NYATA — adapter libSQL menulis
 *        '2026-08-15T04:09:42.589Z', diverifikasi DB live 2026-08-09): diparse
 *        via julianday() lalu dibandingkan dengan julianday('now').
 *      - integer ms: expiresAt < unixepoch() * 1000.
 *   2. Hanya baris yang expiresAt-nya bisa di-parse yang dihapus (typeof guard).
 *   3. Return { deleted } dari rowsAffected; client null → { deleted: 0 } + warn.
 *   4. Error DB DITERUSKAN (scheduler/script yang menangkap) — tidak ditelan.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

vi.mock('../../server/node_modules/@libsql/client', () => ({ createClient: vi.fn() }));
vi.mock('../../server/lib/logger.js', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

import { logger } from '../../server/lib/logger.js';
import { cleanupExpiredSessions, CLEANUP_SQL } from '../../server/lib/sessionCleanup.js';

const makeFakeClient = (result) => ({
  execute: vi.fn(async () => result),
});

describe('sessionCleanup — query hapus sesi kedaluwarsa', () => {
  beforeEach(() => {
    vi.mocked(logger.info).mockClear();
    vi.mocked(logger.warn).mockClear();
  });
  afterEach(() => {
    vi.clearAllMocks();
  });

  it('SQL berisi typeof guard untuk text (ISO) DAN integer (ms) — dua bentuk penyimpanan expiresAt', () => {
    // Bentuk nyata (libSQL adapter menulis ISO text; schema bilang INTEGER).
    expect(CLEANUP_SQL).toContain("typeof(expiresAt) = 'text'");
    expect(CLEANUP_SQL).toContain('julianday(expiresAt) < julianday(\'now\')');
    // Bentuk defensif (integer ms — schema asli / penulisan numerik).
    expect(CLEANUP_SQL).toContain("typeof(expiresAt) = 'integer'");
    expect(CLEANUP_SQL).toContain('expiresAt < (unixepoch() * 1000)');
    // Target tabel session, bukan tabel lain.
    expect(CLEANUP_SQL).toContain('DELETE FROM session');
    expect(CLEANUP_SQL).not.toContain('DELETE FROM user');
  });

  it('cleanupExpiredSessions: jalankan query TANPA args + return { deleted } dari rowsAffected', async () => {
    const client = makeFakeClient({ rows: [], rowsAffected: 7 });
    const result = await cleanupExpiredSessions(client);

    expect(client.execute).toHaveBeenCalledTimes(1);
    expect(client.execute).toHaveBeenCalledWith({ sql: CLEANUP_SQL, args: [] });
    expect(result).toEqual({ deleted: 7 });
    expect(logger.info).toHaveBeenCalledWith({ deleted: 7 }, expect.stringContaining('kedaluwarsa'));
  });

  it('rowsAffected tidak tersedia → deleted = -1 (unknown, bukan 0 menyesatkan)', async () => {
    // DELETE result punya rows KOSONG — fallback rows.length akan melaporkan 0
    // palsu; perilaku benar: tandai unknown (-1) agar tidak di-log sebagai fakta.
    const client = makeFakeClient({ rows: [] }); // tanpa rowsAffected
    const result = await cleanupExpiredSessions(client);
    expect(result).toEqual({ deleted: -1 });
  });

  it('client null (TURSO_DATABASE_URL belum di-set) → { deleted: 0 } + logger.warn, tanpa throw', async () => {
    const result = await cleanupExpiredSessions(null);
    expect(result).toEqual({ deleted: 0 });
    expect(logger.warn).toHaveBeenCalledWith(
      expect.anything(),
      expect.stringContaining('Turso client tidak tersedia'),
    );
  });

  it('error DB DITERUSKAN ke caller (tidak ditelan) — scheduler/script yang menangkap', async () => {
    const client = {
      execute: vi.fn(async () => { throw new Error('network error: ECONNRESET'); }),
    };
    await expect(cleanupExpiredSessions(client)).rejects.toThrow('ECONNRESET');
    // Tidak ada logger.warn penyembunyi error — caller memutuskan.
    expect(logger.warn).not.toHaveBeenCalled();
  });
});
