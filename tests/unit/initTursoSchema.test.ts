/**
 * Unit test: server/lib/turso.js — initTursoSchema({ retry }) (Sprint 0.7
 * lanjutan: retry step 'Apply Turso schema' di CI).
 *
 * Menguji perbedaan perilaku retry TANPA DB nyata (client palsu di-inject —
 * initTursoSchema menerima client sebagai parameter; schema nyata
 * turso-schema.sql dibaca dari disk, idempoten):
 *   1. Default (retry:false) — error statement di-ignore (perilaku lama):
 *      semua statement tetap dieksekusi, tidak ada yang dilempar.
 *   2. retry:true + transient sekali → statement di-retry (withRetry),
 *      eksekusi dilanjutkan.
 *   3. retry:true + constraint → di-ignore TANPA retry (schema idempoten).
 *   4. retry:true + transient persisten → error di-RE-THROW (tidak
 *      disembunyikan — caller tahu apply gagal, bukan "sukses" palsu).
 */
import { describe, it, expect, vi } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { initTursoSchema } from '../../server/lib/turso.js';

// Hitung statement dengan cara yang SAMA dengan implementasi (read-only).
const schemaStatements = (() => {
  const p = path.resolve(process.cwd(), 'turso-schema.sql');
  const sql = fs.readFileSync(p, 'utf8').replace(/--.*$/gm, '');
  return sql.split(';').map((s) => s.trim()).filter((s) => s.length > 0);
})();

const makeFakeClient = (onExecute) => {
  const execute = vi.fn(onExecute ?? (() => ({ rows: [] })));
  return { execute };
};

describe('initTursoSchema — retry (Sprint 0.7 lanjutan)', () => {
  it('default retry:false → error statement di-ignore, eksekusi dilanjutkan (perilaku lama)', async () => {
    let calls = 0;
    const client = makeFakeClient(() => {
      calls += 1;
      if (calls === 1) throw new Error('table already exists');
      return { rows: [] };
    });
    await expect(initTursoSchema(client)).resolves.toBeUndefined();
    // statement gagal di-ignore, seluruh statement lain tetap dieksekusi
    expect(calls).toBe(schemaStatements.length);
  });

  it('retry:true + transient sekali → statement di-retry lalu lanjut', async () => {
    let calls = 0;
    const client = makeFakeClient(() => {
      calls += 1;
      if (calls === 1) throw new Error('network error: ECONNRESET');
      return { rows: [] };
    });
    await expect(initTursoSchema(client, { retry: true })).resolves.toBeUndefined();
    // statement pertama di-retry (2×) + seluruh statement lain 1× = total + 1
    expect(calls).toBe(schemaStatements.length + 1);
  });

  it('retry:true + constraint → di-ignore TANPA retry (schema idempoten)', async () => {
    const client = makeFakeClient(() => {
      throw new Error('UNIQUE constraint failed: sqlite_autoindex');
    });
    await expect(initTursoSchema(client, { retry: true })).resolves.toBeUndefined();
    // constraint = bug deterministik/idempoten → tidak ada attempt terbuang
    expect(client.execute).toHaveBeenCalledTimes(schemaStatements.length);
  });

  it('retry:true + non-transient non-constraint (mis. no such table) → di-ignore (perilaku lama dipertahankan)', async () => {
    const client = makeFakeClient(() => {
      throw new Error('no such table: legacy_foo');
    });
    await expect(initTursoSchema(client, { retry: true })).resolves.toBeUndefined();
    // TIDAK di-retry & TIDAK di-rethrow — statement schema yang error tanpa
    // dampak (non-transient, non-constraint) tidak boleh memecah CI
    expect(client.execute).toHaveBeenCalledTimes(schemaStatements.length);
  });

  it('retry:true + transient persisten → error di-RE-THROW (tidak disembunyikan)', async () => {
    const client = makeFakeClient(() => {
      throw new Error('fetch failed: connection reset');
    });
    await expect(initTursoSchema(client, { retry: true })).rejects.toThrow(/connection reset/);
  });
});
