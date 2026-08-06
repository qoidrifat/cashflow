/**
 * Unit test: server/lib/turso.js — boot path getTurso() kini memakai
 * initTursoSchema(client, { retry: true }) (retry transien AKTIF saat boot
 * produksi, tidak lagi default no-retry yang menelan error senyap).
 *
 * Tanpa DB nyata: @libsql/client di-mock (client palsu), schema nyata
 * turso-schema.sql dibaca dari disk (idempoten). Bukti perilaku:
 *   1. Boot tidak memblokir: getTurso() mengembalikan client SINKRON
 *      (init berjalan fire-and-forget di background).
 *   2. Transient sekali saat cold start → statement di-retry (withRetry)
 *      → execute total = jumlah statement + 1 (bukti retry AKTIF di boot;
 *      bila retry:false, error ditelan senyap dan total = jumlah statement).
 *   3. Transient persisten → fail-fast (loop berhenti di statement pertama,
 *      attempts habis) + error sampai ke logger.error('Error initializing
 *      schema') — kegagalan boot TERLIHAT, bukan senyap — tanpa unhandled
 *      rejection (dijamin oleh .catch di getTurso).
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

// @libsql/client ada DUA salinan di repo ini: server/node_modules (dipakai
// server/lib/turso.js) dan node_modules root (diresolusi tests/unit). Mock
// harus menunjuk salinan yang SAMA dengan turso.js, kalau tidak createClient
// asli tetap terpanggil (terbukti: HttpClient asli kembali saat mock root).
vi.mock('../../server/node_modules/@libsql/client', () => ({ createClient: vi.fn() }));
vi.mock('../../server/lib/logger.js', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

import { createClient } from '../../server/node_modules/@libsql/client';
import { logger } from '../../server/lib/logger.js';
import { getTurso, closeTurso } from '../../server/lib/turso.js';

// Hitung statement dengan cara yang SAMA dengan implementasi (read-only).
const schemaStatements = (() => {
  const p = path.resolve(process.cwd(), 'turso-schema.sql');
  const sql = fs.readFileSync(p, 'utf8').replace(/--.*$/gm, '');
  return sql.split(';').map((s) => s.trim()).filter((s) => s.length > 0);
})();

async function waitFor(predicate, timeoutMs = 10000, intervalMs = 100) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    if (predicate()) return;
    await new Promise((r) => setTimeout(r, intervalMs));
  }
  throw new Error(`waitFor timeout (${timeoutMs}ms)`);
}

const makeFakeClient = (onExecute) => {
  const execute = vi.fn(onExecute ?? (() => ({ rows: [] })));
  return { execute, close: vi.fn() };
};

describe('getTurso boot — initTursoSchema retry aktif (produksi)', () => {
  beforeEach(() => {
    process.env.TURSO_DATABASE_URL = 'libsql://test.example.com';
    process.env.TURSO_AUTH_TOKEN = 'test-token';
    vi.mocked(createClient).mockClear();
    vi.mocked(logger.error).mockClear();
  });

  afterEach(() => {
    closeTurso();
    delete process.env.TURSO_DATABASE_URL;
    delete process.env.TURSO_AUTH_TOKEN;
  });

  it('transient sekali saat cold start → statement di-retry (bukti retry AKTIF di boot), boot tidak memblokir', async () => {
    let calls = 0;
    const client = makeFakeClient(() => {
      calls += 1;
      if (calls === 1) throw new Error('network error: ECONNRESET');
      return { rows: [] };
    });
    vi.mocked(createClient).mockReturnValue(client);

    // Boot TIDAK memblokir: client dikembalikan sinkron sebelum init selesai.
    const booted = getTurso();
    expect(booted).toBe(client);

    // Background init: statement pertama di-retry (2×) + sisanya 1× = +1.
    await waitFor(() => executeCalls(client) >= schemaStatements.length + 1);
    expect(client.execute).toHaveBeenCalledTimes(schemaStatements.length + 1);
    // Self-heal sukses → TIDAK ada false alarm di log error.
    expect(logger.error).not.toHaveBeenCalled();
  });

  it('transient persisten di boot → fail-fast (loop berhenti) + error TERLIHAT di log, tanpa unhandled rejection', async () => {
    const client = makeFakeClient(() => {
      throw new Error('fetch failed: connection reset');
    });
    vi.mocked(createClient).mockReturnValue(client);

    getTurso();

    // attempts default 4 → statement pertama habis di-retry, lalu loop
    // BERHENTI (fail-fast, bukan mencoba seluruh statement).
    // CATATAN: angka 4 = pinning sengaja terhadap default withRetry.attempts;
    // bila default diubah, test ini harus disinkronkan.
    await waitFor(() => executeCalls(client) >= 4);
    expect(client.execute).toHaveBeenCalledTimes(4);
    expect(schemaStatements.length).toBeGreaterThan(4); // fail-fast nyata
    // Kegagalan boot tersalur ke .catch → logger.error (bukan senyap).
    expect(logger.error).toHaveBeenCalledWith(
      expect.objectContaining({ err: expect.stringContaining('connection reset') }),
      'Error initializing schema',
    );
    // Test selesai tanpa unhandled rejection = .catch di getTurso menangani.
  }, 15000);
});

function executeCalls(client) {
  return client.execute.mock.calls.length;
}
