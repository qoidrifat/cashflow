/**
 * Network resilience helpers (Turso/libSQL) — single source of truth.
 *
 * Dipakai oleh:
 *   - server/lib/turso.js   → initTursoSchema({ retry: true }) saat apply schema
 *   - scripts/seedE2eDataset.mjs  → batching + retry seed E2E (Sprint 0.7)
 *   - scripts/applyTursoSchema.mjs → retry apply schema (Sprint 0.7 lanjutan)
 *
 * Logika dipindah dari scripts/seedE2eDataset.mjs agar seed & apply schema
 * berbagi perilaku yang SAMA (satu sumber kebenaran, tanpa drift regex/retry).
 */

// Error yang pantas di-retry: gangguan transport/HTTP transien + kondisi busy
// SQLite/Turso (database is locked / SQLITE_BUSY) yang sering muncul saat
// concurrent writer. Error constraint (UNIQUE dsb.) = bug deterministik →
// JANGAN di-retry (di-masking hanya menunda kegagalan & menyulitkan diagnosis).
export const TRANSIENT_RE = /network|timed?\s?out|timeout|econn|socket|fetch failed|too many requests|\b429\b|\b5\d\d\b|connection|\bbusy\b|locked|blocked/i;

/**
 * Klasifikasi error constraint (UNIQUE / duplicate / already exists) —
 * single source of truth untuk fail-fast (dipakai withRetry & initTursoSchema).
 */
export function isConstraintError(msg) {
  return /constraint|unique|already exists|duplicate/i.test(msg);
}

/**
 * Retry exponential backoff HANYA untuk error transient.
 *
 * Asumsi klasifikasi berbasis pesan: pesan yang mengandung 'constraint'/'unique'
 * dianggap bug deterministik (fail-fast, TIDAK di-masking); pesan lain yang
 * cocok TRANSIENT_RE dianggap gangguan transport (retry). Trade-off diterima:
 * fail-fast lebih baik daripada retry yang menunda kegagalan deterministik.
 *
 * @param {() => Promise<any>} fn
 * @param {{ attempts?: number, baseMs?: number, label?: string, logPrefix?: string }} [options]
 */
export async function withRetry(fn, { attempts = 4, baseMs = 400, label = 'query', logPrefix = '[retry]' } = {}) {
  for (let i = 0; i < attempts; i++) {
    try {
      return await fn();
    } catch (err) {
      const msg = String(err?.message || err);
      const isConstraint = isConstraintError(msg);
      const isTransient = TRANSIENT_RE.test(msg) && !isConstraint;
      if (!isTransient || i === attempts - 1) throw err; // attempt terakhir: biarkan error asli naik
      const delay = baseMs * 2 ** i + Math.round(Math.random() * 200);
      console.warn(`${logPrefix} ⚠️ ${label} transien (${msg.slice(0, 140)}), retry ${i + 1}/${attempts - 1} dalam ${delay}ms`);
      await new Promise((r) => setTimeout(r, delay));
    }
  }
}

/**
 * Timeout eksplisit per request Turso.
 *
 * createClient menerima opsi `fetch` (custom fetch untuk HTTP client — hanya
 * dipakai untuk URL http(s); DB file: lokal tidak terpengaruh). Wrapper ini
 * membungkus fetch native undici dengan AbortSignal.timeout: bila request HANG,
 * undici melempar DOMException 'TimeoutError' (pesan mengandung 'timeout' →
 * cocok TRANSIENT_RE → ditangani withRetry). Fallback aman bila signal lain
 * sudah ada (AbortSignal.any, Node 20+; CI & lokal Node 24).
 */
export function createTimedFetch(timeoutMs) {
  const nativeFetch = globalThis.fetch;
  return (input, init = {}) => {
    const timeoutSignal = AbortSignal.timeout(timeoutMs);
    const signal = init.signal
      ? (typeof AbortSignal.any === 'function' ? AbortSignal.any([init.signal, timeoutSignal]) : init.signal)
      : timeoutSignal;
    return nativeFetch(input, { ...init, signal });
  };
}
