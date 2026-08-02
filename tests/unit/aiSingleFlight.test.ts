/**
 * Unit test: single-flight dedup AI (anti thundering herd — dari code review
 * Sprint 3, diimplementasikan post-Sprint 3).
 *
 * Dua lapis:
 * 1. Primitif aiCache.js: inflight Map lifecycle (set/get/auto-cleanup/reset).
 * 2. Integrasi generateVertexContent: 2+ request identik KONKUREN (cache key
 *    sama, cache miss) → hanya SATU panggilan Vertex; yang join menerima hasil
 *    pemenang (joined: true), tanpa panggil Vertex lagi.
 *
 * Vertex di-mock via getVertexState() (state mutasi langsung) — tanpa jaringan.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import {
  getInflightAICache,
  setInflightAICache,
  getInflightAICacheSize,
  clearAICache,
  getAICacheStats,
} from '../../server/lib/aiCache.js';
import {
  configureVertexAI,
  getVertexState,
  generateVertexContent,
} from '../../server/lib/vertexContext.js';

// ===================== Primitif inflight =====================

describe('single-flight primitives (aiCache)', () => {
  beforeEach(() => {
    clearAICache();
  });

  it('getInflightAICache → undefined saat belum ada request berjalan', () => {
    expect(getInflightAICache('key-x')).toBeUndefined();
    expect(getInflightAICacheSize()).toBe(0);
  });

  it('set → get mengembalikan promise yang sama', () => {
    const p = Promise.resolve({ text: 'ok' });
    setInflightAICache('key-a', p);
    expect(getInflightAICache('key-a')).toBe(p);
    expect(getInflightAICacheSize()).toBe(1);
    // cleanup manual di akhir agar tidak bocor antar-test
    return p;
  });

  it('auto-cleanup setelah promise settle (sukses)', async () => {
    let resolveFn;
    const p = new Promise((resolve) => { resolveFn = resolve; });
    setInflightAICache('key-b', p);
    expect(getInflightAICacheSize()).toBe(1);
    resolveFn({ text: 'ok' });
    await p;
    await new Promise((r) => setTimeout(r, 10)); // tunggu .then cleanup
    expect(getInflightAICache('key-b')).toBeUndefined();
    expect(getInflightAICacheSize()).toBe(0);
  });

  it('auto-cleanup setelah promise reject (pemenang gagal — joiner ikut gagal)', async () => {
    let rejectFn;
    const p = new Promise((_, reject) => { rejectFn = reject; });
    setInflightAICache('key-c', p);
    expect(getInflightAICacheSize()).toBe(1);
    rejectFn(new Error('vertex down'));
    await p.catch(() => {}); // swallow
    await new Promise((r) => setTimeout(r, 10));
    expect(getInflightAICacheSize()).toBe(0);
  });

  it('clearAICache mereset inflight juga', () => {
    setInflightAICache('key-d', new Promise(() => {}));
    expect(getInflightAICacheSize()).toBe(1);
    clearAICache();
    expect(getInflightAICacheSize()).toBe(0);
  });

  it('stats mengekspos inflight count (observability)', () => {
    setInflightAICache('key-e', new Promise(() => {}));
    expect(getAICacheStats().inflight).toBe(1);
    clearAICache();
  });
});

// ===================== Integrasi generateVertexContent =====================

describe('single-flight di generateVertexContent (anti thundering herd)', () => {
  let vertexCalls;
  /** Semua promise Vertex yang sedang tertahan — releaseAll/failAll melepas SEMUA. */
  let pending;

  /**
   * Mock Vertex: generateContent menahan resolve sampai tes melepaskannya via
   * releaseAll() — meniru latency upstream sehingga request kedua sempat JOIN.
   * Semua pending call di-release/fail sekaligus (mendukung N call independen).
   */
  function installMockVertex() {
    vertexCalls = 0;
    pending = [];
    const s = getVertexState();
    s.geminiReady = true;
    s.vertexAI = {
      models: {
        generateContent: async () => {
          vertexCalls++;
          return new Promise((resolve, reject) => {
            pending.push({ resolve, reject });
          });
        },
      },
    };
  }

  function releaseAll(value) {
    for (const p of pending.splice(0)) p.resolve(value);
  }

  function failAll(error) {
    for (const p of pending.splice(0)) p.reject(error);
  }

  beforeEach(() => {
    clearAICache();
    configureVertexAI({
      primaryModel: 'gemini-test',
      fallbackModel: 'gemini-test',
      projectId: 'test-project',
      location: 'us-central1',
      nodeEnv: 'test',
    });
    installMockVertex();
  });

  it('2 request identik konkuren → 1 panggilan Vertex, joiner dapat hasil pemenang', async () => {
    const contents = [{ role: 'user', parts: [{ text: 'email identik' }] }];
    const opts = { feature: 'gmail_sync', cacheTtlMs: 60_000 };

    // Kedua request mulai bersamaan — keduanya miss, hanya pemenang yang
    // memanggil Vertex; yang kedua JOIN.
    const p1 = generateVertexContent({ contents, ...opts });
    const p2 = generateVertexContent({ contents, ...opts });

    await new Promise((r) => setTimeout(r, 30)); // pastikan keduanya masuk pipeline
    expect(vertexCalls).toBe(1); // SATU panggilan Vertex, bukan dua
    expect(getInflightAICacheSize()).toBe(1);

    // Pemenang resolve → kedua request menerima hasil
    const payload = { text: '{"is_transaction":true,"amount":150000,"decision":"auto_accept"}' };
    releaseAll(payload);

    const [r1, r2] = await Promise.all([p1, p2]);

    expect(r1.text).toBe(payload.text);
    expect(r1.modelUsed).toBe('gemini-test');
    expect(r1.cached).toBe(false);
    expect(r1.joined).toBeUndefined();

    expect(r2.text).toBe(r1.text);
    expect(r2.modelUsed).toBe('gemini-test');
    expect(r2.joined).toBe(true); // joiner menandai hasil gabungan
    expect(r2.cached).toBe(true);

    expect(vertexCalls).toBe(1);
    await new Promise((r) => setTimeout(r, 10));
    expect(getInflightAICacheSize()).toBe(0); // cleanup otomatis
  });

  it('request ketiga setelah selesai → cache HIT (pemenang sudah menulis LRU)', async () => {
    const contents = [{ role: 'user', parts: [{ text: 'email identik' }] }];
    const opts = { feature: 'gmail_sync', cacheTtlMs: 60_000 };

    const p1 = generateVertexContent({ contents, ...opts });
    const p2 = generateVertexContent({ contents, ...opts });
    await new Promise((r) => setTimeout(r, 30));
    releaseAll({ text: '{"is_transaction":true}' });
    await Promise.all([p1, p2]);
    await new Promise((r) => setTimeout(r, 10));

    const callsBefore = vertexCalls;
    const p3 = await generateVertexContent({ contents, ...opts });
    expect(vertexCalls).toBe(callsBefore); // TIDAK ada panggilan Vertex baru
    expect(p3.cached).toBe(true); // dari LRU cache
    expect(p3.text).toBe('{"is_transaction":true}');
  });

  it('tanpa cacheTtlMs (non-cacheable) → tidak ada single-flight, tiap request panggil Vertex', async () => {
    const contents = [{ role: 'user', parts: [{ text: 'monthly report' }] }];
    // monthly-report: cacheTtlMs = 0 → tanpa cache & tanpa dedup
    const p1 = generateVertexContent({ contents, feature: 'insight_generator', cacheTtlMs: 0 });
    const p2 = generateVertexContent({ contents, feature: 'insight_generator', cacheTtlMs: 0 });

    await new Promise((r) => setTimeout(r, 30));
    expect(vertexCalls).toBe(2); // dua pemanggilan independen (tanpa dedup)
    releaseAll({ text: '{"summary":"ok"}' });
    const [r1, r2] = await Promise.all([p1, p2]);

    expect(r1.joined).toBeUndefined();
    expect(r2.joined).toBeUndefined();
    expect(r1.text).toBe('{"summary":"ok"}');
    expect(r2.text).toBe('{"summary":"ok"}');
    expect(vertexCalls).toBe(2);
  });

  it('pemenang gagal → joiner ikut gagal (tidak memulai panggilan baru)', async () => {
    const contents = [{ role: 'user', parts: [{ text: 'email identik' }] }];
    const opts = { feature: 'gmail_sync', cacheTtlMs: 60_000 };

    const p1 = generateVertexContent({ contents, ...opts });
    const p2 = generateVertexContent({ contents, ...opts });
    await new Promise((r) => setTimeout(r, 30));
    expect(vertexCalls).toBe(1);

    // Error non-retryable (auth) agar tidak memicu retry backoff yang menambah
    // call baru — pemenang gagal langsung, joiner mewarisi kegagalan.
    failAll(new Error('unauthenticated: default credentials not found'));
    await expect(p1).rejects.toThrow();
    await expect(p2).rejects.toThrow(); // joiner mewarisi kegagalan pemenang
    expect(vertexCalls).toBe(1); // tidak ada panggilan tambahan
  });
});
