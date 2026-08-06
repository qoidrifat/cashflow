/**
 * Unit test: scripts/seedE2eDataset.mjs — determinisme dataset & batching
 * TANPA DB nyata (Sprint 0.7 lanjutan).
 *
 * Menguji bagian MURNI dari seed script yang selama ini hanya terbukti
 * lewat smoke/CI:
 *   1. mulberry32 — RNG deterministik (seed sama → sequence identik).
 *   2. buildSeedStatements — SELURUH statement data dibangun deterministik
 *      (seed + nowMs sama → statement identik; jumlah sesuai SEED_DATASET).
 *   3. chunkArray — batching: chunk ≤ BATCH_SIZE, tanpa statement hilang /
 *      duplikat, urutan dipertahankan (regression guard batching CI).
 *   4. withRetry — retry HANYA untuk error transient; constraint tidak
 *      di-retry (fail-fast); error asli naik setelah attempts habis.
 *   5. createTimedFetch — timeout eksplisit: signal di-abort setelah
 *      timeoutMs; fetch cepat diteruskan.
 *   6. rpAmount / buildLogStmt — determinisme nilai & bentuk statement.
 *
 * Import aman: modul mengeksekusi main() HANYA saat dieksekusi langsung
 * (IS_MAIN), bukan saat di-import — jadi tidak butuh SEED_E2E / DB.
 */
import { describe, it, expect, afterEach } from 'vitest';
import {
  mulberry32,
  rpAmount,
  buildLogStmt,
  withRetry,
  createTimedFetch,
  chunkArray,
  buildSeedStatements,
  SEED_DATASET,
  BATCH_SIZE,
  EXPENSE_CATEGORIES,
  INCOME_CATEGORIES,
} from '../../scripts/seedE2eDataset.mjs';

const NOW_MS = 1_786_010_000_000; // fixed → determinisme penuh antar pemanggilan
const mkStatements = () =>
  buildSeedStatements({ seedUserId: 'user1', rng: mulberry32(20260802), nowMs: NOW_MS });

// ===========================================================================
// mulberry32 — determinisme RNG
// ===========================================================================
describe('mulberry32', () => {
  it('seed sama → sequence identik (deterministik)', () => {
    const a = mulberry32(20260802);
    const b = mulberry32(20260802);
    const seqA = Array.from({ length: 20 }, () => a());
    const seqB = Array.from({ length: 20 }, () => b());
    expect(seqA).toEqual(seqB);
  });

  it('seed berbeda → sequence berbeda', () => {
    const a = mulberry32(20260802);
    const b = mulberry32(1);
    expect(Array.from({ length: 20 }, () => a())).not.toEqual(
      Array.from({ length: 20 }, () => b()),
    );
  });

  it('nilai selalu dalam [0, 1)', () => {
    const rng = mulberry32(42);
    for (let i = 0; i < 100; i++) {
      const v = rng();
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThan(1);
    }
  });
});

// ===========================================================================
// rpAmount — nilai amount deterministik & dalam rentang
// ===========================================================================
describe('rpAmount', () => {
  it('selalu kelipatan 1000 dan dalam rentang [min, max]', () => {
    const rng = mulberry32(20260802);
    for (let i = 0; i < 100; i++) {
      const v = rpAmount(rng, 10_000, 2_000_000);
      expect(v % 1000).toBe(0);
      expect(v).toBeGreaterThanOrEqual(10_000);
      expect(v).toBeLessThanOrEqual(2_000_000);
    }
  });

  it('deterministik: RNG seed sama → nilai sama', () => {
    const a = rpAmount(mulberry32(20260802), 10_000, 2_000_000);
    const b = rpAmount(mulberry32(20260802), 10_000, 2_000_000);
    expect(a).toBe(b);
  });
});

// ===========================================================================
// buildSeedStatements — determinisme & kelengkapan dataset (tanpa DB)
// ===========================================================================
describe('buildSeedStatements', () => {
  it('deterministik: seed & nowMs sama → statement IDENTIK (deep equal)', () => {
    const a = mkStatements();
    const b = mkStatements();
    expect(a.stmts).toEqual(b.stmts);
    expect(a.catIds).toEqual(b.catIds);
  });

  it('seed berbeda → dataset berbeda (bukan kebetulan)', () => {
    const a = buildSeedStatements({ seedUserId: 'user1', rng: mulberry32(20260802), nowMs: NOW_MS });
    const b = buildSeedStatements({ seedUserId: 'user1', rng: mulberry32(7), nowMs: NOW_MS });
    expect(a.stmts).not.toEqual(b.stmts);
  });

  it('nowMs berbeda → timestamp statement berbeda (kontrol determinisme)', () => {
    const a = buildSeedStatements({ seedUserId: 'user1', rng: mulberry32(20260802), nowMs: NOW_MS });
    const b = buildSeedStatements({ seedUserId: 'user1', rng: mulberry32(20260802), nowMs: NOW_MS + 86_400_000 });
    expect(a.stmts).not.toEqual(b.stmts);
  });

  it('jumlah statement per tabel sesuai SEED_DATASET (regression guard)', () => {
    const { stmts } = mkStatements();
    const count = (needle: string) => stmts.filter((s) => s.sql.includes(needle)).length;
    expect(count('INSERT INTO categories')).toBe(EXPENSE_CATEGORIES.length + INCOME_CATEGORIES.length);
    expect(count('INSERT INTO transactions')).toBe(SEED_DATASET.T_TOTAL);
    expect(count('INSERT INTO gmail_sync_runs')).toBe(2);
    expect(count('INSERT INTO gmail_sync_logs')).toBe(SEED_DATASET.G_TOTAL);
    expect(count('INSERT INTO budgets')).toBe(EXPENSE_CATEGORIES.length);
    expect(count('INSERT INTO notifications')).toBe(3);
    // total statement data = jumlah seluruh baris yang akan di-insert
    expect(stmts).toHaveLength(
      EXPENSE_CATEGORIES.length + INCOME_CATEGORIES.length
        + SEED_DATASET.T_TOTAL + 2 + SEED_DATASET.G_TOTAL
        + EXPENSE_CATEGORIES.length + 3,
    );
  });

  it('distribusi transaksi: income/expense/other sesuai SEED_DATASET', () => {
    const { stmts } = mkStatements();
    const txs = stmts.filter((s) => s.sql.includes('INSERT INTO transactions'));
    const typeAt = 2; // VALUES (?,?,type,...) → index 2 di args
    expect(txs.filter((t) => t.args[typeAt] === 'income')).toHaveLength(SEED_DATASET.T_INCOME);
    expect(txs.filter((t) => t.args[typeAt] === 'expense')).toHaveLength(SEED_DATASET.T_EXPENSE);
    expect(txs.filter((t) => t.args[typeAt] === 'transfer' || t.args[typeAt] === 'refund')).toHaveLength(SEED_DATASET.T_OTHER);
  });

  it('distribusi gmail logs: accepted/needs_review/skip-reject sesuai SEED_DATASET', () => {
    const { stmts } = mkStatements();
    const logs = stmts.filter((s) => s.sql.includes('INSERT INTO gmail_sync_logs'));
    const statusAt = 7; // status → index 7 di args
    expect(logs.filter((l) => l.args[statusAt] === 'auto_accepted')).toHaveLength(SEED_DATASET.G_ACCEPTED);
    expect(logs.filter((l) => l.args[statusAt] === 'needs_review')).toHaveLength(SEED_DATASET.G_NEEDS_REVIEW);
    expect(logs.filter((l) => l.args[statusAt] === 'auto_skipped' || l.args[statusAt] === 'auto_rejected')).toHaveLength(SEED_DATASET.G_SKIP_REJECT);
  });

  it('semua statement pakai ON CONFLICT ... DO NOTHING (defensif idempotensi)', () => {
    const { stmts } = mkStatements();
    for (const s of stmts) {
      expect(s.sql).toMatch(/ON CONFLICT\([^)]+\) DO NOTHING$/);
    }
  });
});

// ===========================================================================
// chunkArray — batching (tanpa DB)
// ===========================================================================
describe('chunkArray (batching)', () => {
  const { stmts } = mkStatements();

  it('chunk ≤ BATCH_SIZE dan jumlah chunk = ceil(total / BATCH_SIZE)', () => {
    const chunks = chunkArray(stmts, BATCH_SIZE);
    expect(chunks.length).toBe(Math.ceil(stmts.length / BATCH_SIZE));
    for (const c of chunks) {
      expect(c.length).toBeLessThanOrEqual(BATCH_SIZE);
      expect(c.length).toBeGreaterThan(0);
    }
  });

  it('TIDAK ada statement hilang atau duplikat (concat = original)', () => {
    const chunks = chunkArray(stmts, BATCH_SIZE);
    const flat = chunks.flat();
    expect(flat).toHaveLength(stmts.length);
    expect(flat).toEqual(stmts); // urutan & konten identik
  });

  it('ukuran chunk umum: 820 statement → 9 chunk (100×8 + 20)', () => {
    expect(stmts.length).toBeGreaterThan(BATCH_SIZE * 8);
    expect(stmts.length).toBeLessThanOrEqual(BATCH_SIZE * 9);
    const chunks = chunkArray(stmts, BATCH_SIZE);
    expect(chunks.length).toBe(9);
    expect(chunks[chunks.length - 1].length).toBe(stmts.length % BATCH_SIZE);
  });

  it('array kosong → tanpa chunk', () => {
    expect(chunkArray([], BATCH_SIZE)).toEqual([]);
  });
});

// ===========================================================================
// withRetry — retry HANYA transient, constraint fail-fast
// ===========================================================================
describe('withRetry', () => {
  it('error transient → retry lalu sukses (3 panggilan)', async () => {
    let calls = 0;
    const result = await withRetry(async () => {
      calls += 1;
      if (calls < 3) throw new Error('network error: ECONNRESET');
      return 'ok';
    }, { attempts: 4, baseMs: 1 });
    expect(result).toBe('ok');
    expect(calls).toBe(3);
  });

  it('error constraint (UNIQUE) → TIDAK di-retry, throw asli', async () => {
    let calls = 0;
    await expect(
      withRetry(async () => {
        calls += 1;
        throw new Error('UNIQUE constraint failed: users.email');
      }, { attempts: 4, baseMs: 1 }),
    ).rejects.toThrow(/UNIQUE constraint failed: users.email/);
    expect(calls).toBe(1); // fail-fast — attempt tidak terbuang
  });

  it('persistent transient → throw error ASLI setelah attempts habis', async () => {
    let calls = 0;
    const err = new Error('fetch failed: connection reset');
    await expect(
      withRetry(async () => {
        calls += 1;
        throw err;
      }, { attempts: 3, baseMs: 1 }),
    ).rejects.toThrow(/connection reset/);
    expect(calls).toBe(3);
  });

  it('sukses di attempt pertama → tanpa panggilan ekstra', async () => {
    let calls = 0;
    const result = await withRetry(async () => {
      calls += 1;
      return 'first';
    }, { attempts: 4, baseMs: 1 });
    expect(result).toBe('first');
    expect(calls).toBe(1);
  });
});

// ===========================================================================
// createTimedFetch — timeout eksplisit
// ===========================================================================
describe('createTimedFetch', () => {
  const nativeFetch = globalThis.fetch;

  afterEach(() => {
    globalThis.fetch = nativeFetch;
  });

  it('fetch hang → signal di-abort setelah timeoutMs (TimeoutError)', async () => {
    const signals: Array<AbortSignal | undefined> = [];
    // Stub fetch yang tidak pernah resolve sendiri — hanya bereaksi pada abort.
    globalThis.fetch = ((_input: unknown, init?: RequestInit) => {
      return new Promise((_resolve, reject) => {
        const sig = init?.signal;
        signals.push(sig);
        sig?.addEventListener('abort', () => {
          reject(new DOMException('The operation was aborted due to timeout', 'TimeoutError'));
        });
      });
    }) as typeof fetch;

    const timedFetch = createTimedFetch(60);
    await expect(timedFetch('http://example.test')).rejects.toThrow(/timeout/i);
    expect(signals[0]?.aborted).toBe(true); // bukti: signal timeout benar-benar di-abort
  });

  it('fetch cepat → resolve normal (value diteruskan)', async () => {
    globalThis.fetch = (async () => new Response('ok')) as typeof fetch;
    const timedFetch = createTimedFetch(5_000);
    const r = await timedFetch('http://example.test');
    expect(r.status).toBe(200);
    expect(await r.text()).toBe('ok');
  });

  it('signal luar sudah aborted → reject cepat (fallback init.signal)', async () => {
    const controller = new AbortController();
    controller.abort();
    globalThis.fetch = ((_input: unknown, init?: RequestInit) => {
      return new Promise((_resolve, reject) => {
        if (init?.signal?.aborted) reject(new Error('aborted by caller'));
      });
    }) as typeof fetch;
    const timedFetch = createTimedFetch(5_000);
    await expect(timedFetch('http://example.test', { signal: controller.signal })).rejects.toThrow(/aborted by caller/);
  });
});

// ===========================================================================
// buildLogStmt — determinisme statement gmail log
// ===========================================================================
describe('buildLogStmt', () => {
  it('input sama → statement identik (deterministik)', () => {
    const a = buildLogStmt('user1', ['r1', 'r2'], 5, 'auto_accepted', 'auto_accepted', NOW_MS);
    const b = buildLogStmt('user1', ['r1', 'r2'], 5, 'auto_accepted', 'auto_accepted', NOW_MS);
    expect(a).toEqual(b);
  });

  it('status auto_accepted → confidence 0.92; lain → 0.5', () => {
    const accepted = buildLogStmt('user1', ['r1'], 1, 'auto_accepted', 'auto_accepted', NOW_MS);
    const skipped = buildLogStmt('user1', ['r1'], 2, 'auto_skipped', 'auto_skipped', NOW_MS);
    expect(accepted[1][9]).toBe(0.92);
    expect(skipped[1][9]).toBe(0.5);
  });
});
