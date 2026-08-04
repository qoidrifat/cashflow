/**
 * Notification Metadata Guard (P1-4 — Phase 2).
 *
 * Menutup temuan security audit (severity Medium): POST /api/notifications
 * menerima `metadata` apa pun dari client; payload dengan
 * `metadata.source = 'gmail_review'` + emailId dapat memicu side effect
 * operator (webhook GMAIL_WEBHOOK_URL + email SMTP) dengan konten pilihan
 * penyerang.
 *
 * Guard ini menyediakan dua helper MURNI (unit-testable, tanpa DB/jaringan):
 *
 *  1. `sanitizeNotificationMetadata(raw)` — validasi bentuk metadata untuk
 *     SEMUA request: wajib plain object (atau null/undefined → {}), hanya
 *     JSON-serializable, ukuran & jumlah key dibatasi, key prototype-pollution
 *     di-strip rekursif.
 *
 *  2. `corroborateGmailReviewResult({ logRow, emailId, claimedResult })` —
 *     korelasi server-side untuk side effect webhook/email: hasil review HANYA
 *     dipercaya bila user memiliki baris `gmail_sync_logs` untuk emailId tsb
 *     DAN status log kompatibel dengan hasil yang diklaim. Konten yang dikirim
 *     ke channel eksternal DISARINKAN dari baris log server (candidate
 *     merchant/amount, error_message) — BUKAN dari field metadata client,
 *     sehingga konten operator tidak bisa lagi di-inject lewat body request.
 *
 * Dipakai oleh: server/routes/notificationRoutes.js (POST /api/notifications).
 */

/** Batas ukuran metadata terserialisasi (byte). */
export const METADATA_MAX_BYTES = 8192;

/** Batas jumlah key top-level metadata. */
export const METADATA_MAX_KEYS = 64;

/** Key yang dilarang (prototype pollution) — di-strip di semua kedalaman. */
const DANGEROUS_KEYS = new Set(['__proto__', 'constructor', 'prototype']);

/** Hasil review Gmail yang dikenal (sama dengan trigger client). */
export const GMAIL_REVIEW_RESULTS = new Set(['approved', 'rejected', 'duplicate', 'failed']);

/**
 * Status `gmail_sync_logs` yang KOMPATIBEL dengan tiap hasil review yang
 * diklaim. 'failed' sengaja longgar: notifikasi gagal dikirim saat log masih
 * needs_review/pending_review (mis. approve gagal karena amount kosong — log
 * tidak sempat di-update) atau setelah ditandai needs_review/failed.
 */
const COMPATIBLE_LOG_STATUS = {
  approved: ['approved', 'auto_accepted'],
  rejected: ['rejected', 'auto_rejected'],
  duplicate: ['duplicate'],
  failed: [
    'failed',
    'needs_review',
    'pending_review',
    'retry_later',
    'config_error',
    'paused_config_error',
  ],
};

/** Strip rekursif key berbahaya; nilai primitive lewat apa adanya. */
function stripDangerousKeys(value) {
  if (Array.isArray(value)) return value.map(stripDangerousKeys);
  if (value !== null && typeof value === 'object') {
    const clean = {};
    for (const [key, val] of Object.entries(value)) {
      if (!DANGEROUS_KEYS.has(key)) clean[key] = stripDangerousKeys(val);
    }
    return clean;
  }
  return value;
}

/**
 * Validasi & sanitasi metadata notifikasi dari body client.
 *
 * @param {*} raw nilai `metadata` dari req.body (boleh undefined/null)
 * @returns {{ ok: true, metadata: object } | { ok: false, error: string }}
 *   ok=false → route wajib merespons 400 dengan pesan `error`.
 */
export function sanitizeNotificationMetadata(raw) {
  if (raw === undefined || raw === null) return { ok: true, metadata: {} };
  if (typeof raw !== 'object' || Array.isArray(raw)) {
    return { ok: false, error: 'metadata harus berupa objek JSON' };
  }

  let serialized;
  try {
    serialized = JSON.stringify(raw);
  } catch {
    return { ok: false, error: 'metadata tidak dapat diserialisasi ke JSON' };
  }
  if (serialized === undefined) {
    return { ok: false, error: 'metadata harus berupa objek JSON' };
  }
  if (serialized.length > METADATA_MAX_BYTES) {
    return { ok: false, error: `metadata terlalu besar (maksimal ${METADATA_MAX_BYTES} byte)` };
  }
  if (Object.keys(raw).length > METADATA_MAX_KEYS) {
    return { ok: false, error: `metadata memiliki terlalu banyak field (maksimal ${METADATA_MAX_KEYS})` };
  }

  return { ok: true, metadata: stripDangerousKeys(raw) };
}

/**
 * Korelasi server-side untuk hasil review Gmail (gate side effect webhook/email).
 *
 * Murni (tanpa DB): caller mengambil baris `gmail_sync_logs` milik user untuk
 * emailId yang diklaim, lalu menyerahkan ke sini. Return null = TIDAK
 * dikorelasikan → side effect wajib DIBLOKIR (forgery / data tidak konsisten).
 *
 * Konten hasil (merchant/amount/message) diambil dari baris log server —
 * `metadata.candidate` + `sender` + `error_message` — bukan dari metadata
 * request, menutup jalur injeksi konten ke channel operator.
 *
 * @param {{ logRow?: object|null, emailId: string, claimedResult: string }} args
 * @returns {{ status: string, emailId: string, merchant: string|null, amount: number|null, message: string|null } | null}
 */
export function corroborateGmailReviewResult({ logRow, emailId, claimedResult }) {
  if (!logRow) return null;
  if (typeof emailId !== 'string' || emailId.length === 0 || emailId.length > 191) return null;
  const compatible = COMPATIBLE_LOG_STATUS[claimedResult];
  if (!compatible) return null;

  const rowStatus = logRow.final_status || logRow.status;
  if (!compatible.includes(rowStatus)) return null;

  let candidate = {};
  try {
    const parsed = JSON.parse(logRow.metadata || '{}');
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
      candidate = (parsed.candidate && typeof parsed.candidate === 'object') ? parsed.candidate : {};
    }
  } catch {
    // metadata log rusak → tetap boleh kirim dengan fallback sender.
    candidate = {};
  }

  const merchantFromCandidate = typeof candidate.merchant === 'string' && candidate.merchant.trim()
    ? candidate.merchant.trim()
    : null;
  const sender = typeof logRow.sender === 'string' && logRow.sender.trim()
    ? logRow.sender.trim()
    : null;

  return {
    status: claimedResult,
    emailId,
    merchant: (merchantFromCandidate || sender || null)?.slice(0, 200) ?? null,
    amount: typeof candidate.amount === 'number' && Number.isFinite(candidate.amount)
      ? candidate.amount
      : null,
    // Pesan hanya dari server (error_message log) untuk status failed —
    // field errorMessage/message milik client tidak pernah diteruskan.
    message: claimedResult === 'failed' && typeof logRow.error_message === 'string' && logRow.error_message.trim()
      ? logRow.error_message.trim().slice(0, 500)
      : null,
  };
}
