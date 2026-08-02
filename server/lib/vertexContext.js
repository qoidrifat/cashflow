/**
 * Vertex AI Context — CashFlow AI Proxy
 *
 * P4.14: Ekstraksi dari server/index.js monolit. Modul ini menampung SEMUA
 * state & helper Vertex AI Gemini yang sebelumnya inline di index.js, agar
 * route modules (geminiRoutes, agentSearchRoutes, healthRoutes, adminMetricsRoutes)
 * bisa memakainya tanpa duplikasi.
 *
 * State mutasi hanya lewat configureVertexAI() (dipanggil index.js setelah
 * membaca env) dan initGemini(). Route module membaca via getVertexState().
 */
import fs from 'node:fs';
import { GoogleGenAI } from '@google/genai';
import metricsService from '../services/metricsService.js';
import { FEATURE_PROVIDER } from '../config/metricsConfig.js';
import { logger } from './logger.js';
import {
  buildAICacheKey,
  getCachedAICache,
  setCachedAICache,
} from './aiCache.js';

// ===================== Retry & Cache Tuning (Sprint 3) =====================
// Retry exponential backoff hanya untuk error retryable (quota/timeout/network).
// Env:
//   AI_RETRY_MAX_ATTEMPTS (default 3 — 1 eksekusi + 2 retry)
//   AI_RETRY_BASE_MS      (default 500ms — delay = base * 2^(attempt-1) * jitter 80-120%)
function envInt(key, fallback) {
  const v = parseInt(process.env[key], 10);
  return Number.isFinite(v) && v > 0 ? v : fallback;
}
const AI_RETRY_MAX_ATTEMPTS = envInt('AI_RETRY_MAX_ATTEMPTS', 3);
const AI_RETRY_BASE_MS = envInt('AI_RETRY_BASE_MS', 500);

const RETRYABLE_CODES = new Set([
  'VERTEX_QUOTA_EXCEEDED',
  'VERTEX_TIMEOUT',
  'VERTEX_NETWORK_ERROR',
]);

function retryDelayMs(attempt) {
  const exponent = Math.min(attempt - 1, 4); // cap 2^4 = 16x base
  const jitter = 0.8 + Math.random() * 0.4; // 80-120%
  return Math.round(AI_RETRY_BASE_MS * 2 ** exponent * jitter);
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

// ===================== State (mutable, di-set index.js) =====================

const state = {
  geminiReady: false,
  vertexAI: null,
  primaryModel: '',
  fallbackModel: '',
  models: [],
  projectId: '',
  location: 'us-central1',
  rawCredentials: '',
  credentialsAbs: '',
  nodeEnv: 'development',
};

/** Set seluruh konfigurasi (dari env yang sudah diolah index.js). */
export function configureVertexAI(cfg) {
  Object.assign(state, cfg);
  state.models = Array.from(
    new Set([state.primaryModel, state.fallbackModel].filter(Boolean)),
  );
}

/** Baca state saat ini (route module memakai ini, bukan variabel global). */
export function getVertexState() {
  return state;
}

export function isProduction() {
  return state.nodeEnv === 'production';
}

// ===================== Vertex AI Gemini Setup =====================

export function initGemini() {
  if (!state.projectId) {
    logger.warn({}, 'GOOGLE_CLOUD_PROJECT / GCP_PROJECT_ID belum diisi — Vertex AI Gemini tidak berfungsi');
    return false;
  }

  if (!state.rawCredentials) {
    logger.warn({}, 'GOOGLE_APPLICATION_CREDENTIALS belum diisi — Vertex AI Gemini membutuhkan service account');
    return false;
  }

  if (!fs.existsSync(state.credentialsAbs)) {
    logger.warn({ path: state.credentialsAbs }, 'File GOOGLE_APPLICATION_CREDENTIALS tidak ditemukan');
    return false;
  }

  try {
    state.vertexAI = new GoogleGenAI({
      vertexai: true,
      project: state.projectId,
      location: state.location,
    });

    logger.info({ model: state.primaryModel, project: state.projectId, location: state.location }, 'Vertex AI Gemini siap');
    state.geminiReady = true;
    return true;
  } catch (error) {
    logger.error({ err: error.message }, 'Gagal inisialisasi Vertex AI Gemini');
    return false;
  }
}

// ===================== Prompt Builders =====================

export function buildExtractionPrompt(emailText, subject, sender, emailDate) {
  return `Kamu adalah AI financial transaction extractor untuk aplikasi CashFlow Indonesia.

Tugas: Baca email pengguna dan tentukan apakah email berisi transaksi keuangan nyata.
Keluarkan SATU JSON OBJECT VALID SAJA. Tidak ada teks lain.

DEFINISI TRANSAKSI VALID:
- Pembayaran aktual (invoice, receipt, struk, e-ticket)
- Transfer masuk/keluar aktual
- Pembelian berhasil
- Top up berhasil
- Refund/pengembalian dana berhasil
- Cashback yang benar-benar diterima
- QRIS/VA/kartu/e-wallet/bank berhasil
- Informasi transaksi bank yang memuat aktivitas finansial aktual

BUKAN TRANSAKSI (is_transaction = false):
- Promo, diskon, kupon, newsletter
- Iklan, rekomendasi produk, survei
- Login alert, notifikasi keamanan
- Artikel, digest, lowongan kerja
- Cashback promosi yang belum diterima
- Email promo cashback seperti "cashback hingga", "cashback s/d", "cashback sampai", "cashback up to", "dapatkan cashback", "promo cashback", "ajukan KTA", atau "buka deposito, cashback"
- Nominal yang muncul sebagai nilai maksimum promo cashback, bukan uang yang sudah diterima
- Aktivasi kartu, request card berhasil, welcome email, bluSpending dibuat
- Pembayaran COD yang belum dilakukan

ATURAN OUTPUT WAJIB:
1. Output hanya SATU JSON OBJECT. Tidak ada markdown, tidak ada code block, tidak ada teks lain.
2. Jangan gunakan tanda | dalam value. Pilih satu value.
3. Jangan gunakan trailing comma.
4. Jangan gunakan undefined. Gunakan null jika data tidak ditemukan.
5. Jangan gunakan NaN. Gunakan null.
6. Semua key WAJIB ada.
7. amount: number tanpa Rp/titik/koma atau null jika tidak ditemukan.
8. date: format YYYY-MM-DD. Jika tanggal tidak ditemukan, gunakan ${emailDate}.
9. confidence_score: number antara 0.0 dan 1.0.
10. Jika is_transaction = false, reason WAJIB menjelaskan kenapa.
11. Jika email promo cashback, output wajib:
{"is_transaction":false,"transaction_type":null,"amount":null,"currency":"IDR","date":null,"merchant":null,"category":null,"payment_method":null,"description":null,"confidence_score":0,"reason":"Email promo cashback, bukan transaksi cashback aktual","decision":"auto_reject"}
12. Cashback aktual boleh transaksi hanya jika email menyatakan cashback berhasil diterima, masuk, cair, atau dikreditkan.

decision WAJIB diisi:
- "auto_accept": hanya jika sangat yakin transaksi valid
- "auto_skip": email finansial tapi bukan transaksi aktual
- "auto_reject": promo/newsletter/marketing/diskon/cashback promo
- "needs_review": jika konteks ambigu

Jangan auto_accept jika:
- Email mengandung promo/cashback maksimum
- Email aktivasi kartu atau welcome
- Nominal tidak ditemukan
- Sender baru/tidak dikenal
- Pembayaran COD belum dilakukan
- Ragu-ragu

OUTPUT SCHEMA:
{
  "is_transaction": true,
  "transaction_type": "income | expense | transfer | refund | null",
  "amount": 0,
  "currency": "IDR",
  "date": "YYYY-MM-DD",
  "merchant": "string | null",
  "category": "string | null",
  "payment_method": "string | null",
  "description": "string | null",
  "confidence_score": 0.0,
  "reason": "string | null",
  "decision": "auto_accept | auto_skip | auto_reject | needs_review"
}

Sender: ${sender}
Subject: ${subject}
Email Text:
${emailText}`;
}

export function buildReceiptExtractionPrompt(userHint = {}) {
  const defaultDate = new Date().toISOString().split('T')[0];

  return `Kamu adalah AI financial transaction extractor untuk aplikasi CashFlow Indonesia.

Tugas: Baca gambar bukti transaksi dan ekstrak data transaksinya.
Keluarkan SATU JSON OBJECT VALID SAJA. Tidak ada teks lain, tidak ada markdown, tidak ada code block.

DEFINISI BUKTI TRANSAKSI VALID:
- Struk belanja
- Invoice/faktur pembayaran
- Kuitansi/receipt pembayaran
- Nota pembelian
- Bukti transfer bank/mobile banking
- Bukti pembayaran QRIS/e-wallet
- Screenshot bukti bayar/sukses transaksi
- Tagihan/bill yang sudah dibayar

BUKAN TRANSAKSI:
- Foto selfie/orang
- Pemandangan/gambar tidak relevan
- KTP/identitas
- Screenshot chat tanpa bukti bayar
- Gambar promo/iklan
- Menu makanan tanpa total harga
- Halaman website tanpa informasi pembayaran

ATURAN EKSTRAKSI:
1. Cari nominal TOTAL/GRAND TOTAL/TOTAL BAYAR/JUMLAH/NOMINAL/DIBAYAR/AMOUNT.
2. Jangan gunakan subtotal, PPN, service charge, diskon, atau uang kembalian sebagai amount utama.
3. Jika banyak nominal dan tidak yakin total, decision "needs_review" dan risk_flags berisi "multiple_amounts_found".
4. amount: number tanpa Rp/titik/koma/spasi atau null.
5. date: YYYY-MM-DD. Jika tidak ada tanggal, gunakan ${defaultDate} dan risk_flags "date_inferred".
6. merchant: nama toko/merchant dari header struk. Bisa null.
7. category: tebak kategori paling sesuai.
8. payment_method: salah satu "cash", "qris", "transfer-bank", "e-wallet", "kartu-debit", "kartu-kredit", "lainnya-payment".
9. note: deskripsi singkat Bahasa Indonesia.
10. confidence_score: 0.0 sampai 1.0.
11. decision: "auto_accept" jika confidence >= 0.88 dan data jelas, "needs_review" jika ragu, "auto_skip" jika bukan transaksi.
12. transaction_type: "expense" untuk pembayaran/pembelian, "income" untuk penerimaan uang.

OUTPUT WAJIB:
{
  "decision": "auto_accept | needs_review | auto_skip",
  "is_transaction": true,
  "transaction_type": "expense | income | null",
  "amount": 0,
  "currency": "IDR",
  "date": "YYYY-MM-DD",
  "merchant": "string | null",
  "category": "string | null",
  "payment_method": "cash | qris | transfer-bank | e-wallet | kartu-debit | kartu-kredit | lainnya-payment",
  "note": "string",
  "confidence_score": 0.0,
  "reason": "string | null",
  "risk_flags": []
}

${userHint.paymentMethod ? `Petunjuk: Metode pembayaran default: ${userHint.paymentMethod}.` : ''}
${userHint.category ? `Petunjuk: Kategori default: ${userHint.category}.` : ''}
${userHint.date ? `Petunjuk: Tanggal default: ${userHint.date}.` : ''}`;
}

export function buildMonthlyReportPrompt(reportData) {
  return `Kamu adalah AI financial analyst untuk aplikasi CashFlow Indonesia.

Tugas: Buat insight laporan keuangan bulanan yang praktis, ringkas, profesional, dan mudah dipahami user muda.
Gunakan bahasa Indonesia natural. Jangan menggurui. Fokus pada cashflow, risiko, dan tindakan yang bisa dilakukan.

Keluarkan SATU JSON OBJECT VALID SAJA. Tidak ada markdown, tidak ada code block, tidak ada teks lain.

ATURAN OUTPUT WAJIB:
1. Output hanya JSON object valid.
2. Key wajib:
   - summary: string, maksimal 2 kalimat.
   - cashflowHealth: salah satu "sehat", "stabil", "waspada", "kritis".
   - topRisks: array string, maksimal 4 item.
   - recommendations: array string, maksimal 4 item.
   - positiveNotes: array string, maksimal 3 item.
3. Jangan gunakan trailing comma, undefined, NaN, atau null.
4. Jangan menyebut kamu punya akses rekening bank. Analisis hanya dari data aplikasi.

Data laporan:
${JSON.stringify(reportData).substring(0, 12000)}`;
}

// ===================== JSON Helpers =====================

export function cleanResponse(text) {
  return String(text || '')
    .trim()
    .replace(/^```(?:json)?\s*/i, '')
    .replace(/\s*```$/i, '')
    .trim();
}

export function repairJsonText(text) {
  return String(text || '')
    .replace(/,\s*([}\]])/g, '$1')
    .replace(/:\s*undefined\b/g, ': null')
    .replace(/:\s*NaN\b/g, ': null')
    .replace(/\bundefined\b/g, 'null')
    .replace(/\bNaN\b/g, 'null');
}

export function parseGeminiResponse(rawResponse) {
  const errors = [];
  let cleanedResponse = null;

  try {
    cleanedResponse = cleanResponse(rawResponse);
    return {
      success: true,
      data: JSON.parse(cleanedResponse),
      cleanedResponse,
    };
  } catch (error) {
    errors.push(`Direct parse failed: ${error.message}`);
  }

  try {
    const jsonMatch = cleanedResponse?.match(/\{[\s\S]*\}/);
    if (jsonMatch) {
      const parsed = JSON.parse(jsonMatch[0]);
      return {
        success: true,
        data: parsed,
        cleanedResponse: jsonMatch[0],
      };
    }
  } catch (error) {
    errors.push(`Regex extract failed: ${error.message}`);
  }

  try {
    const jsonMatch = cleanedResponse?.match(/\{[\s\S]*\}/);
    const jsonText = jsonMatch ? jsonMatch[0] : cleanedResponse;
    const repaired = repairJsonText(jsonText);
    const parsed = JSON.parse(repaired);

    return {
      success: true,
      data: parsed,
      cleanedResponse: repaired,
      repairAttempted: true,
    };
  } catch (error) {
    errors.push(`Repair parse failed: ${error.message}`);
  }

  return {
    success: false,
    error: errors.join('; '),
    cleanedResponse,
    repairAttempted: true,
  };
}

export function extractTextFromGenAIResponse(response) {
  if (!response) return '';

  if (typeof response.text === 'string') {
    return response.text.trim();
  }

  if (typeof response.text === 'function') {
    const text = response.text();
    if (typeof text === 'string') return text.trim();
  }

  const parts = response?.candidates?.[0]?.content?.parts;
  if (Array.isArray(parts)) {
    return parts
      .map((part) => part.text || '')
      .join('')
      .trim();
  }

  return '';
}

// ===================== Normalizers =====================

export function normalizeReceiptPaymentMethod(value) {
  const normalized = String(value || '').toLowerCase().replace(/[_\\s]/g, '-');

  if (normalized === 'cash' || normalized === 'tunai') return 'cash';
  if (normalized === 'qris' || normalized === 'qr') return 'qris';
  if (normalized === 'e-wallet' || normalized === 'ewallet' || normalized === 'wallet') return 'e-wallet';
  if (normalized === 'transfer' || normalized === 'bank-transfer' || normalized === 'transfer-bank') return 'transfer-bank';
  if (normalized === 'debit' || normalized === 'debit-card' || normalized === 'kartu-debit') return 'kartu-debit';
  if (normalized === 'credit' || normalized === 'kredit' || normalized === 'credit-card' || normalized === 'kartu-kredit') return 'kartu-kredit';

  return 'cash';
}

export function normalizeReceiptResult(payload) {
  const confidence = Number(payload?.confidence_score);
  const amount = Number(payload?.amount);
  const isTransaction = payload?.is_transaction !== false;

  const transactionType = ['income', 'expense', 'transfer', 'refund'].includes(payload?.transaction_type)
    ? payload.transaction_type
    : 'expense';

  const riskFlags = Array.isArray(payload?.risk_flags)
    ? payload.risk_flags.filter(Boolean).map(String)
    : [];

  return {
    decision: ['auto_accept', 'needs_review', 'auto_skip'].includes(payload?.decision)
      ? payload.decision
      : 'needs_review',
    is_transaction: isTransaction,
    transaction_type: isTransaction ? transactionType : null,
    amount: Number.isFinite(amount) && amount > 0 ? amount : null,
    currency: payload?.currency || 'IDR',
    date: typeof payload?.date === 'string' && /^\\d{4}-\\d{2}-\\d{2}$/.test(payload.date)
      ? payload.date
      : null,
    merchant: payload?.merchant ? String(payload.merchant).slice(0, 120) : null,
    category: payload?.category ? String(payload.category).slice(0, 80) : null,
    payment_method: normalizeReceiptPaymentMethod(payload?.payment_method),
    note: payload?.note ? String(payload.note).slice(0, 240) : null,
    confidence_score: Number.isFinite(confidence) ? Math.max(0, Math.min(1, confidence)) : 0,
    reason: payload?.reason ? String(payload.reason).slice(0, 300) : null,
    risk_flags: riskFlags,
  };
}

// ===================== Request / Error Helpers =====================

export function createRequestId(prefix = 'vertex') {
  return `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}

export function getErrorMessage(error) {
  if (!error) return '';
  if (typeof error === 'string') return error;
  if (error.message) return String(error.message);
  return String(error);
}

export function classifyVertexError(error) {
  const message = getErrorMessage(error);
  const lower = message.toLowerCase();
  const statusCode = error?.status || error?.statusCode || error?.code;

  if (
    lower.includes('could not load the default credentials')
    || lower.includes('application default credentials')
    || lower.includes('invalid_grant')
    || lower.includes('unauthenticated')
    || statusCode === 401
  ) {
    return {
      code: 'VERTEX_AUTH_ERROR',
      httpStatus: 401,
      message: 'Autentikasi Vertex AI gagal. Periksa service account dan GOOGLE_APPLICATION_CREDENTIALS.',
      retryable: false,
    };
  }

  if (
    lower.includes('permission denied')
    || lower.includes('iam')
    || lower.includes('does not have permission')
    || statusCode === 403
  ) {
    if (
      lower.includes('billing')
      || lower.includes('billing account')
      || lower.includes('billing disabled')
    ) {
      return {
        code: 'VERTEX_BILLING_DISABLED',
        httpStatus: 402,
        message: 'Billing Google Cloud belum aktif untuk Vertex AI pada project ini.',
        retryable: false,
      };
    }

    if (
      lower.includes('has not been used')
      || lower.includes('disabled')
      || lower.includes('enable it')
      || lower.includes('aiplatform.googleapis.com')
    ) {
      return {
        code: 'VERTEX_API_DISABLED',
        httpStatus: 403,
        message: 'Vertex AI API belum aktif. Aktifkan Vertex AI API di Google Cloud Console.',
        retryable: false,
      };
    }

    return {
      code: 'VERTEX_PERMISSION_DENIED',
      httpStatus: 403,
      message: 'Akses Vertex AI ditolak. Periksa role service account, minimal Vertex AI User.',
      retryable: false,
    };
  }

  if (
    lower.includes('quota')
    || lower.includes('rate limit')
    || lower.includes('resource exhausted')
    || lower.includes('too many requests')
    || statusCode === 429
  ) {
    return {
      code: 'VERTEX_QUOTA_EXCEEDED',
      httpStatus: 429,
      message: 'Limit/quota Vertex AI tercapai. CashFlow akan memakai fallback parser jika tersedia.',
      retryable: true,
    };
  }

  if (
    lower.includes('not found')
    || lower.includes('model')
    || statusCode === 404
  ) {
    return {
      code: 'VERTEX_MODEL_UNAVAILABLE',
      httpStatus: 404,
      message: `Model "${state.primaryModel}" tidak tersedia di region ${state.location}. Coba region/model lain.`,
      retryable: false,
    };
  }

  if (
    lower.includes('deadline')
    || lower.includes('timeout')
    || lower.includes('aborted')
  ) {
    return {
      code: 'VERTEX_TIMEOUT',
      httpStatus: 504,
      message: 'Vertex AI membutuhkan waktu terlalu lama. Coba lagi dengan input lebih kecil.',
      retryable: true,
    };
  }

  if (
    lower.includes('fetch')
    || lower.includes('enotfound')
    || lower.includes('econnreset')
    || lower.includes('econnrefused')
    || lower.includes('network')
  ) {
    return {
      code: 'VERTEX_NETWORK_ERROR',
      httpStatus: 502,
      message: 'Gagal terhubung ke Vertex AI. Periksa koneksi server.',
      retryable: true,
    };
  }

  return {
    code: 'VERTEX_UNKNOWN_ERROR',
    httpStatus: 500,
    message: 'Terjadi error teknis saat menghubungi Vertex AI.',
    retryable: false,
  };
}

export function sendGeminiError(res, httpStatus, {
  requestId,
  errorCode,
  userMessage,
  finalStatus,
  retryable = false,
  source = 'vertex-ai-proxy',
  technicalMessage,
  extra = {},
}) {
  return res.status(httpStatus).json({
    success: false,
    status: finalStatus,
    finalStatus,
    errorCode,
    userMessage,
    error: userMessage,
    retryable,
    source,
    requestId,
    ...(!isProduction() && technicalMessage ? { technicalMessage } : {}),
    ...extra,
  });
}

// ===================== Vertex AI Generate Helpers =====================

/**
 * generateVertexContent — pipeline AI dengan resilience (Sprint 3):
 *   1. LRU response cache (opt-in via cacheTtlMs > 0): key sha256(feature +
 *      models + contents + config). Hit → return tanpa panggil Vertex (hemat
 *      biaya/latency; AI usage TIDAK dicatat — tidak ada token terpakai).
 *   2. Retry exponential backoff untuk VERTEX_QUOTA_EXCEEDED / VERTEX_TIMEOUT /
 *      VERTEX_NETWORK_ERROR (max AI_RETRY_MAX_ATTEMPTS, delay base*2^n*jitter,
 *      budget waktu keseluruhan = max(timeoutMs*2, 60s)).
 *   3. Fallback model (perilaku lama) setelah retry habis.
 */
export async function generateVertexContent({
  contents,
  config = {},
  timeoutMs = 45000,
  label = 'vertex-generate',
  feature = null,
  userId = null,
  metricMeta = {},
  cacheTtlMs = 0,
}) {
  if (!state.geminiReady || !state.vertexAI) {
    const error = new Error('Vertex AI Gemini belum dikonfigurasi di server.');
    error.code = 'VERTEX_NOT_CONFIGURED';
    throw error;
  }

  const mergedConfig = { temperature: 0.1, ...config };

  // ── LRU response cache (Sprint 3) — hanya bila caller opt-in ──
  let cacheKey = null;
  if (Number.isFinite(cacheTtlMs) && cacheTtlMs > 0) {
    cacheKey = buildAICacheKey({
      feature,
      models: state.models,
      contents,
      config: mergedConfig,
    });
    const hit = getCachedAICache(cacheKey);
    if (hit) {
      metricsService.recordSystemMetric({
        metricName: 'ai_cache_hit',
        metricValue: 1,
        feature,
        userId,
        metadata: { label, ...metricMeta },
      }).catch(() => {});
      logger.debug({ label, feature, cache: 'hit' }, 'AI response cache HIT');
      // KONTAK: pada cache hit, `response` = null — caller HANYA boleh memakai
      // `text` dan `modelUsed` (raw response + usageMetadata tidak disimpan).
      return { text: hit.text, modelUsed: hit.modelUsed, cached: true, response: null };
    }
    metricsService.recordSystemMetric({
      metricName: 'ai_cache_miss',
      metricValue: 1,
      feature,
      userId,
      metadata: { label, ...metricMeta },
    }).catch(() => {});
  }

  let lastError = null;
  const startedAt = Date.now();
  const overallBudgetMs = Math.max(timeoutMs * 2, 60_000);

  for (const currentModel of state.models) {
    let attempt = 0;
    // eslint-disable-next-line no-constant-condition
    while (true) {
      attempt++;
      try {
        const resultPromise = state.vertexAI.models.generateContent({
          model: currentModel,
          contents,
          config: mergedConfig,
        });

        const timeoutPromise = new Promise((_, reject) => {
          setTimeout(() => {
            reject(new Error(`VERTEX_TIMEOUT: ${label} exceeded ${timeoutMs}ms`));
          }, timeoutMs);
        });

        const response = await Promise.race([resultPromise, timeoutPromise]);
        const text = extractTextFromGenAIResponse(response);

        // CF-053: non-blocking AI usage recording (token capture chokepoint)
        if (feature) {
          const usage = response?.usageMetadata || {};
          metricsService.recordAIUsage({
            feature,
            provider: FEATURE_PROVIDER[feature] || 'gemini_flash',
            model: currentModel,
            promptTokens: usage.promptTokenCount ?? 0,
            completionTokens: usage.candidatesTokenCount ?? 0,
            executionTimeMs: Date.now() - startedAt,
            status: 'success',
            userId,
            metadata: metricMeta,
          }).catch(() => {});
        }

        if (cacheKey) {
          // Simpan HANYA hasil sukses (text + model), bukan raw response.
          setCachedAICache(cacheKey, { text, modelUsed: currentModel }, cacheTtlMs);
        }

        return {
          text,
          modelUsed: currentModel,
          response,
          cached: false,
        };
      } catch (error) {
        lastError = error;

        const classified = classifyVertexError(error);

        const canTryFallback = [
          'VERTEX_MODEL_UNAVAILABLE',
          'VERTEX_QUOTA_EXCEEDED',
          'VERTEX_TIMEOUT',
          'VERTEX_UNKNOWN_ERROR',
        ].includes(classified.code);

        const isLastModel = currentModel === state.models[state.models.length - 1];
        const retryable = RETRYABLE_CODES.has(classified.code);

        logger.warn({
          label,
          model: currentModel,
          attempt,
          code: classified.code,
          message: error.message,
        }, 'generateContent failed');

        // Retry exponential backoff (Sprint 3) — hanya error retryable, selama
        // masih ada attempt tersisa dan belum melewati budget waktu keseluruhan.
        if (retryable && attempt < AI_RETRY_MAX_ATTEMPTS) {
          const elapsed = Date.now() - startedAt;
          const delay = retryDelayMs(attempt);
          if (elapsed + delay < overallBudgetMs) {
            logger.info({
              label,
              model: currentModel,
              attempt,
              delayMs: delay,
              code: classified.code,
            }, 'AI retry exponential backoff');
            await sleep(delay);
            continue;
          }
        }

        // CF-053: record failure (non-blocking), dengan jumlah retry
        if (feature) {
          const status = classified.code === 'VERTEX_QUOTA_EXCEEDED' ? 'rate_limited'
            : classified.code === 'VERTEX_TIMEOUT' ? 'timeout' : 'error';
          metricsService.recordAIUsage({
            feature,
            provider: FEATURE_PROVIDER[feature] || 'gemini_flash',
            model: currentModel,
            executionTimeMs: Date.now() - startedAt,
            status,
            errorMessage: classified.code,
            userId,
            metadata: { ...metricMeta, retries: attempt - 1 },
          }).catch(() => {});
        }

        if (!canTryFallback || isLastModel) {
          throw error;
        }
        break; // lanjut ke fallback model
      }
    }
  }

  throw lastError || new Error('Vertex AI generateContent gagal tanpa detail error.');
}

export async function generateGeminiText(prompt, { feature = null, userId = null, metricMeta = {}, cacheTtlMs = 0 } = {}) {
  const result = await generateVertexContent({
    contents: [
      {
        role: 'user',
        parts: [{ text: prompt }],
      },
    ],
    config: {
      responseMimeType: 'application/json',
    },
    timeoutMs: 45000,
    label: 'text-extraction',
    feature,
    userId,
    metricMeta,
    cacheTtlMs,
  });

  return result;
}

export async function generateGeminiVision(prompt, imageData, { feature = 'ocr_receipt', userId = null, metricMeta = {}, cacheTtlMs = 0 } = {}) {
  const result = await generateVertexContent({
    contents: [
      {
        role: 'user',
        parts: [
          { text: prompt },
          {
            inlineData: {
              mimeType: imageData.mimeType,
              data: imageData.data,
            },
          },
        ],
      },
    ],
    config: {
      responseMimeType: 'application/json',
    },
    timeoutMs: 60000,
    label: 'receipt-image-extraction',
    feature,
    userId,
    metricMeta,
    cacheTtlMs,
  });

  return result;
}
