/**
 * AI Response Cache (Sprint 3 — AI_PLATFORM_AUDIT §P1: "tambah in-process LRU
 * response cache, TTL per feature, hash prompt+model — hemat biaya Gmail sync
 * berulang").
 *
 * In-process LRU (Map insertion-order) + TTL per entry. Hanya menyimpan HASIL
 * SUKSES (text + modelUsed) — tidak pernah error, tidak menyimpan raw response
 * (usageMetadata dkk) agar memori tetap kecil.
 *
 * Catatan desain:
 * - Key = sha256(feature + model-set + contents + config tergabung). Contents
 *   identik (email yang sama / gambar yang sama) → key sama → hit.
 * - Aman lintas user: prompt tidak memuat identitas user; hasil ekstraksi
 *   konten yang sama memang identik.
 * - In-process: hilang saat server restart (bukan cache lintas-instance) —
 *   cukup untuk menghemat biaya duplikasi dalam satu proses; cache terdistribusi
 *   (Redis) adalah evolusi P3.
 *
 * Env:
 *   AI_CACHE_MAX_ENTRIES (default 100)
 */
import crypto from 'node:crypto';

const DEFAULT_MAX_ENTRIES = 100;
const maxEntries = (() => {
  const v = parseInt(process.env.AI_CACHE_MAX_ENTRIES, 10);
  return Number.isFinite(v) && v > 0 ? v : DEFAULT_MAX_ENTRIES;
})();

/** Map<key, { value, expiresAt }> — urutan insertion = urutan LRU. */
const store = new Map();

const stats = { hits: 0, misses: 0, sets: 0, evictions: 0 };

/** Hash deterministik dari payload request AI (feature + model + contents + config). */
export function buildAICacheKey({ feature, models, contents, config }) {
  const payload = {
    f: feature || null,
    m: Array.isArray(models) ? models : [],
    c: contents,
    cfg: config || {},
  };
  return crypto.createHash('sha256').update(JSON.stringify(payload)).digest('hex');
}

/** Ambil entri (refresh recency); entri kedaluwarsa dianggap miss + dibuang. */
export function getCachedAICache(key) {
  const entry = store.get(key);
  if (!entry) {
    stats.misses++;
    return undefined;
  }
  if (entry.expiresAt <= Date.now()) {
    store.delete(key);
    stats.misses++;
    return undefined;
  }
  // Refresh LRU recency
  store.delete(key);
  store.set(key, entry);
  stats.hits++;
  return entry.value;
}

/** Simpan hasil sukses dengan TTL; evict item tertua bila melebihi maxEntries. */
export function setCachedAICache(key, value, ttlMs) {
  if (!Number.isFinite(ttlMs) || ttlMs <= 0) return;
  if (store.has(key)) store.delete(key);
  store.set(key, { value, expiresAt: Date.now() + ttlMs });
  stats.sets++;
  while (store.size > maxEntries) {
    const oldest = store.keys().next().value;
    if (oldest === undefined) break;
    store.delete(oldest);
    stats.evictions++;
  }
}

/** Kosongkan cache + reset statistik (dipakai unit test & ops admin). */
export function clearAICache() {
  store.clear();
  stats.hits = 0;
  stats.misses = 0;
  stats.sets = 0;
  stats.evictions = 0;
}

/** Statistik observasi (ukuran, max, hit/miss/set/evict). */
export function getAICacheStats() {
  return { size: store.size, maxEntries, ...stats };
}
