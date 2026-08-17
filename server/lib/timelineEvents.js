/**
 * Timeline Events (P9 — AI Timeline & Longitudinal Financial Intelligence).
 *
 * Normalisasi & state machine timeline MURNI (tanpa network I/O / DB di logika
 * murni) — unit-testable. Satu sumber kebenaran untuk:
 *   - event_type kanonik (insight | recommendation | conversation | feedback |
 *     memory_update | risk | other) — P9 §7 (fokus minimal 5 + risk).
 *   - sanitasi input: title/body/confidence/payload dibatasi & dibersihkan.
 *   - status timeline (new | viewed | completed | dismissed) dengan transisi
 *     DETERMINISTIK (P9 §12) — bukan workflow bebas.
 *   - builder event otomatis dari feedback & memory (P9 §13-14).
 *
 * Aturan P9:
 *   - JANGAN menyimpan raw model response — hanya snapshot ringkas (payload
 *     ≤ 8KB, primitives saja).
 *   - Confidence TIDAK pernah dikarang: null bila tidak tersedia (P9 §11).
 *   - Semua write user-scoped: caller WAJIB mengirim userId hasil requireAuth.
 */
import crypto from 'node:crypto';

/** Event type kanonik (P9 §7). */
export const EVENT_TYPES = ['insight', 'recommendation', 'conversation', 'feedback', 'memory_update', 'risk', 'other'];

/** Status timeline (P9 §12 minimal: new/viewed/completed/dismissed). */
export const TIMELINE_STATUSES = ['new', 'viewed', 'completed', 'dismissed'];

/** Status final — tidak bisa ditransisikan lagi. */
const FINAL_STATUSES = new Set(['completed', 'dismissed']);

/** Label rating feedback (untuk judul event). */
export const FEEDBACK_RATING_TITLES = {
  helpful: 'Feedback: Membantu',
  not_helpful: 'Feedback: Tidak membantu',
  mismatched: 'Feedback: Kurang sesuai',
  irrelevant: 'Feedback: Tidak relevan',
  already_done: 'Feedback: Sudah saya lakukan',
  skip: 'Feedback: Lewati',
};

/**
 * Peta feature → event_type. Fitur AI Product yang tercatat otomatis.
 * Feature tak dikenal → 'other' (tidak pernah error).
 */
export const FEATURE_EVENT_TYPE = {
  advisor: 'recommendation',
  health: 'recommendation',
  simulation: 'recommendation',
  insight: 'insight',
  search: 'insight',
  ocr: 'insight',
  conversation: 'conversation',
  memory: 'memory_update',
  fraud: 'risk',
};

/** Mapping deterministik feature → event_type. */
export function eventTypeFromFeature(feature) {
  if (typeof feature === 'string' && FEATURE_EVENT_TYPE[feature]) return FEATURE_EVENT_TYPE[feature];
  return 'other';
}

/** Apakah nilai adalah event_type kanonik? */
export function isEventType(value) {
  return EVENT_TYPES.includes(value);
}

/** Apakah nilai adalah status timeline kanonik? */
export function isStatus(value) {
  return TIMELINE_STATUSES.includes(value);
}

/** Batas panjang konsisten dengan TIMELINE_CREATE_SCHEMA di routes. */
export const LIMITS = { title: 200, body: 2000, payloadBytes: 8000, payloadKeys: 24 };

/**
 * Sanitasi payload ke string JSON ≤ payloadBytes dengan HANYA primitives
 * (number/string/boolean/null + array/objek 1-level yang berisi primitives).
 * Objek non-plain / array / undefined → '{}'. Gagal serialize → '{}'.
 * Mencegah penyimpanan objek besar / data sensitif tak sengaja.
 */
export function sanitizePayload(payload) {
  if (payload === undefined || payload === null) return '{}';
  if (typeof payload === 'string') {
    try {
      const parsed = JSON.parse(payload);
      return sanitizePayload(parsed);
    } catch {
      return '{}';
    }
  }
  if (typeof payload !== 'object' || Array.isArray(payload)) return '{}';

  const clean = {};
  for (const [key, value] of Object.entries(payload)) {
    if (Object.keys(clean).length >= LIMITS.payloadKeys) break;
    const t = typeof value;
    if (t === 'number' && Number.isFinite(value)) clean[key] = value;
    else if (t === 'string') clean[key] = value.slice(0, 200);
    else if (t === 'boolean' || value === null) clean[key] = value;
    // array/objek dalam: hanya simpan bila 1-level primitives & kecil
    else if (Array.isArray(value) && value.length <= 8) {
      clean[key] = value.filter((v) => ['number', 'string', 'boolean'].includes(typeof v) || v === null).slice(0, 8);
    }
  }
  try {
    const raw = JSON.stringify(clean);
    if (raw.length > LIMITS.payloadBytes) return '{}';
    return raw;
  } catch {
    return '{}';
  }
}

/**
 * Normalisasi satu input timeline → objek siap INSERT.
 * - feature: string di-cap (tak divalidasi enum di sini — route yang validasi).
 * - eventType: dari feature (klien TIDAK bisa set sendiri — kepercayaan server).
 * - title wajib di-cap, body di-cap, confidence null|0-1, payload string.
 */
export function normalizeTimelineInput({ feature, title, body, confidence, payload, eventType }) {
  const f = typeof feature === 'string' ? feature.slice(0, 64) : 'other';
  const safeConfidence = (() => {
    // PENTING: Number(null) = 0 — absen harus tetap null (P9 §11: jangan karang).
    if (confidence === undefined || confidence === null) return null;
    const n = Number(confidence);
    return Number.isFinite(n) && n >= 0 && n <= 1 ? n : null;
  })();
  return {
    feature: f || 'other',
    // eventType eksplisit (builder internal feedback/memory) dihormati;
    // fallback: dari feature. Klien TIDAK bisa set (route membuang field tak
    // dikenal via validateBody).
    eventType: isEventType(eventType) ? eventType : eventTypeFromFeature(f),
    title: typeof title === 'string' ? title.slice(0, LIMITS.title) : '',
    body: typeof body === 'string' ? body.slice(0, LIMITS.body) : '',
    confidence: safeConfidence,
    payload: sanitizePayload(payload),
  };
}

/**
 * State machine status timeline — DETERMINISTIK (P9 §12):
 *   new      → viewed | completed | dismissed
 *   viewed   → completed | dismissed
 *   completed/dismissed → final (tidak ada transisi keluar)
 * Status lain (invalid) → false.
 */
export function canTransition(from, to) {
  if (!isStatus(from) || !isStatus(to)) return false;
  if (from === to) return false; // no-op dilarang — klien tidak perlu self-set
  if (FINAL_STATUSES.has(from)) return false;
  if (from === 'new') return to === 'viewed' || to === 'completed' || to === 'dismissed';
  if (from === 'viewed') return to === 'completed' || to === 'dismissed';
  return false;
}

/** Builder event FEEDBACK (P9 §13) — feedback tanpa itemId timeline direkam. */
export function buildFeedbackEvent({ feature, rating, reason }) {
  return {
    eventType: 'feedback',
    title: FEEDBACK_RATING_TITLES[rating] || 'Feedback',
    body: typeof reason === 'string' && reason.trim() ? reason.slice(0, LIMITS.body) : '',
    confidence: null,
    payload: {
      feature: typeof feature === 'string' ? feature.slice(0, 64) : '',
      rating: typeof rating === 'string' ? rating.slice(0, 32) : '',
    },
  };
}

/** Builder event MEMORY_UPDATE (P9 §14) — aksi user atas preferensi (set/delete). */
export function buildMemoryEvent({ category, key, action, value }) {
  const act = action === 'delete' ? 'delete' : 'set';
  return {
    eventType: 'memory_update',
    title: act === 'delete' ? 'Preferensi dihapus' : 'Preferensi diperbarui',
    body: `${typeof category === 'string' ? category : 'note'}: ${typeof key === 'string' ? key.slice(0, 120) : ''}`,
    confidence: null,
    payload: {
      category: typeof category === 'string' ? category.slice(0, 64) : '',
      key: typeof key === 'string' ? key.slice(0, 120) : '',
      action: act,
    },
  };
}

/**
 * INSERT satu event timeline (sanitized) — menerima turso client sebagai arg
 * agar bisa di-unit-test dengan mock. Melempar error; caller yang memutuskan
 * fire-and-forget (pola recordTimeline di conversationRoutes).
 *
 * @param {import('@libsql/client').Client} turso
 * @param {string} userId userId terautentikasi (user-scoped).
 * @param {{ feature?: string, title?: string, body?: string, confidence?: number|null, payload?: unknown }} input
 * @returns {Promise<string>} id event baru.
 */
export async function insertTimelineEvent(turso, userId, input) {
  // normalizeTimelineInput menghormati eventType eksplisit (builder feedback/
  // memory) dengan fallback dari feature — satu sumber kebenaran.
  const normalized = normalizeTimelineInput(input || {});
  const id = crypto.randomUUID();
  await turso.execute({
    sql: `INSERT INTO ai_timeline (id, user_id, feature, event_type, status, title, body, confidence, payload, created_at)
          VALUES (?, ?, ?, ?, 'new', ?, ?, ?, ?, datetime('now'))`,
    args: [
      id,
      userId,
      normalized.feature,
      normalized.eventType,
      normalized.title,
      normalized.body,
      normalized.confidence,
      normalized.payload,
    ],
  });
  return id;
}
