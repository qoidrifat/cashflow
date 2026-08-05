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

/**
 * Single-flight (anti thundering herd, dari code review Sprint 3):
 * Map<key, Promise> — request AI identik (cache key sama) yang datang KONKUREN
 * saat belum ada hasil di cache, berbagi SATU pemanggilan upstream (Vertex).
 * Pemenang me-resolve promise; yang join tinggal menunggu hasil yang sama.
 *
 * Hidup dalam siklus singkat: di-set sebelum panggilan upstream, auto-cleanup
 * saat promise settle (then/finally). Tidak dihitung dalam stats LRU karena
 * bukan entri cache — hanya window konkurensi.
 */
const inflight = new Map();

const stats = { hits: 0, misses: 0, sets: 0, evictions: 0 };

/**
 * Normalisasi teks prompt untuk cache key (L2 — prompt normalization).
 *
 * Menerapkan normalisasi yang aman secara SEMANTIK: tidak mengubah isi prompt,
 * hanya menghapus noise formatting yang tidak memengaruhi hasil model:
 *   - CRLF/CR → LF (portabilitas lintas OS)
 *   - trailing whitespace per baris
 *   - kolaps 3+ baris kosong → 2 (margin email/struk sering beda jumlah baris)
 *   - trim ujung prompt
 *
 * Karena hanya whitespace-level, dua prompt yang "berbeda penampilan" tetapi
 * identik secara semantik kini berbagi cache key → hit rate naik tanpa risiko
 * false-positive untuk konten berbeda. Prompt yang dikirim ke model TIDAK
 * berubah — hanya key yang dinormalisasi.
 *
 * @returns {string} teks ternormalisasi (non-string dikembalikan apa adanya)
 */
export function normalizePromptText(text) {
  if (typeof text !== 'string') return text;
  return text
    .replace(/\r\n?/g, '\n')
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

/**
 * Hash deterministik dari payload request AI (feature + model + contents + config).
 *
 * L2 (prompt normalization): part TEXT dinormalisasi sebelum di-hash sehingga
 * prompt yang hanya beda formatting (whitespace/CRLF) berbagi key. Part
 * inlineData (base64 gambar) TIDAK dinormalisasi — harus exact agar OCR identik.
 */
export function buildAICacheKey({ feature, models, contents, config }) {
  const normalizedContents = Array.isArray(contents)
    ? contents.map((part) => {
      if (part && Array.isArray(part.parts)) {
        return {
          ...part,
          parts: part.parts.map((p) => (
            p && typeof p.text === 'string' ? { ...p, text: normalizePromptText(p.text) } : p
          )),
        };
      }
      return part;
    })
    : contents;

  const payload = {
    f: feature || null,
    m: Array.isArray(models) ? models : [],
    c: normalizedContents,
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

/**
 * Ambil promise single-flight untuk key (undefined bila tidak ada request
 * identik yang sedang berjalan).
 */
export function getInflightAICache(key) {
  return inflight.get(key);
}

/**
 * Daftarkan promise single-flight untuk key. Auto-cleanup saat promise settle
 * (sukses ATAU gagal) — pemenang yang menyimpan hasil ke LRU cache, joiner
 * hanya berbagi hasil yang sama.
 */
export function setInflightAICache(key, promise) {
  inflight.set(key, promise);
  promise.then(
    () => { if (inflight.get(key) === promise) inflight.delete(key); },
    () => { if (inflight.get(key) === promise) inflight.delete(key); },
  );
}

/** Jumlah request single-flight yang sedang berjalan (observability). */
export function getInflightAICacheSize() {
  return inflight.size;
}

/** Kosongkan cache + reset statistik (dipakai unit test & ops admin). */
export function clearAICache() {
  store.clear();
  inflight.clear();
  stats.hits = 0;
  stats.misses = 0;
  stats.sets = 0;
  stats.evictions = 0;
}

/** Statistik observasi (ukuran, max, hit/miss/set/evict + inflight). */
export function getAICacheStats() {
  return { size: store.size, maxEntries, inflight: inflight.size, ...stats };
}
