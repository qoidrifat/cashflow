/**
 * CashFlow AI Proxy Server - Vertex AI Edition
 *
 * Server ini berfungsi sebagai proxy antara frontend CashFlow dan Google Vertex AI Gemini.
 *
 * Mode baru:
 * - Tidak lagi bergantung pada GEMINI_API_KEY / AI Studio Prepay.
 * - Menggunakan Google Cloud Vertex AI + Service Account.
 * - Auth via GOOGLE_APPLICATION_CREDENTIALS.
 *
 * Endpoints:
 *   POST /api/gemini/extract-transaction
 *   POST /api/ai/extract-receipt-image
 *   POST /api/gemini/monthly-report
 *   GET  /api/gemini/health
 *   GET  /api/agent-search/config
 *   GET  /api/agent-search/health
 *   POST /api/agent-search/query
 *   POST /api/agent-search/answer
 *   POST /api/agent-search/sync-docs
 *   POST /api/agent-search/sync-transactions
 *   POST /api/agent-search/sync-gmail-logs
 *   POST /api/agent-search/sync-receipts
 *   GET  /api/health
 *
 * Cara menjalankan:
 *   1. cd server
 *   2. npm install @google/genai
 *   3. Pastikan server/.env berisi:
 *      GOOGLE_APPLICATION_CREDENTIALS=./google-agent-search-service-account.json
 *      GOOGLE_CLOUD_PROJECT=snappy-weft-479506-h5
 *      GCP_LOCATION=us-central1
 *      GEMINI_PRIMARY_MODEL=gemini-2.5-flash
 *      GEMINI_FALLBACK_MODEL=gemini-2.5-flash-lite
 *   4. node index.js
 */

import path from 'node:path';
import dotenv from 'dotenv';
dotenv.config({ path: path.resolve(process.cwd(), 'server', '.env') });
dotenv.config({ path: path.resolve(process.cwd(), '.env.local') });
dotenv.config();

import express from 'express';
import cors from 'cors';
import multer from 'multer';
import cookieParser from 'cookie-parser';
import { GoogleGenAI } from '@google/genai';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';

import { toNodeHandler } from 'better-auth/node';
import { getAuth } from './lib/auth.js';
import { authMiddleware, requireAuth } from './middleware/authMiddleware.js';
import { registerSSERoute } from './lib/sse.js';
import { registerTransactionRoutes } from './routes/transactionRoutes.js';
import { registerCategoryRoutes } from './routes/categoryRoutes.js';
import { registerBudgetRoutes } from './routes/budgetRoutes.js';
import { registerRecurringRoutes } from './routes/recurringRoutes.js';
import { registerNotificationRoutes } from './routes/notificationRoutes.js';
import { registerProfessionalSuiteRoutes } from './routes/professionalSuiteRoutes.js';
import { registerGmailRoutes } from './routes/gmailRoutes.js';
import { getTurso } from './lib/turso.js';

// Pastikan Turso client & schema terinisialisasi
getTurso();

import {
  answerAgentSearch,
  checkAgentSearchHealth,
  classifyAgentSearchError,
  getPublicAgentSearchConfig,
  queryAgentSearch,
  syncCashFlowDocs,
  syncGmailLogsForUser,
  syncReceiptsForUser,
  syncTransactionsForUser,
} from './services/agentSearchService.js';

import metricsService from './services/metricsService.js';
import { getAdminEmails, FEATURE_PROVIDER, FEATURES } from './config/metricsConfig.js';


// ===================== Path / Env Loader =====================

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

function loadEnvFile(filePath) {
  if (!fs.existsSync(filePath)) return;

  const lines = fs.readFileSync(filePath, 'utf8').split(/\r?\n/);

  for (const line of lines) {
    const trimmed = line.trim();

    if (!trimmed || trimmed.startsWith('#') || !trimmed.includes('=')) {
      continue;
    }

    const separatorIndex = trimmed.indexOf('=');
    const key = trimmed.slice(0, separatorIndex).trim();
    const value = trimmed
      .slice(separatorIndex + 1)
      .trim()
      .replace(/^["']|["']$/g, '');

    if (key && process.env[key] === undefined) {
      process.env[key] = value;
    }
  }
}

loadEnvFile(path.resolve(__dirname, '.env'));
loadEnvFile(path.resolve(__dirname, '..', '.env.local'));

// ===================== Configuration =====================

function cleanEnv(value) {
  return String(value || '').trim().replace(/[\\]+$/g, '');
}

const PORT = parseInt(process.env.PORT || '5181', 10);

const NODE_ENV = cleanEnv(process.env.NODE_ENV || 'development');

const ALLOWED_ORIGINS = process.env.ALLOWED_ORIGINS
  ? process.env.ALLOWED_ORIGINS.split(',').map((origin) => origin.trim()).filter(Boolean)
  : ['http://localhost:5180', 'http://127.0.0.1:5180'];

const GOOGLE_CLOUD_PROJECT = cleanEnv(
  process.env.GOOGLE_CLOUD_PROJECT
  || process.env.GCP_PROJECT_ID
  || process.env.AGENT_SEARCH_PROJECT_ID
  || '',
);

const GCP_LOCATION = cleanEnv(
  process.env.GCP_LOCATION
  || process.env.GOOGLE_CLOUD_LOCATION
  || process.env.GOOGLE_CLOUD_REGION
  || 'us-central1',
);

const GEMINI_PRIMARY_MODEL = cleanEnv(
  process.env.GEMINI_MODEL
  || process.env.GEMINI_PRIMARY_MODEL
  || 'gemini-2.5-flash',
);

const GEMINI_FALLBACK_MODEL = cleanEnv(
  process.env.GEMINI_FALLBACK_MODEL
  || 'gemini-2.5-flash-lite',
);

const GEMINI_MODELS = Array.from(
  new Set([GEMINI_PRIMARY_MODEL, GEMINI_FALLBACK_MODEL].filter(Boolean)),
);

const RAW_GOOGLE_APPLICATION_CREDENTIALS = cleanEnv(
  process.env.GOOGLE_APPLICATION_CREDENTIALS || '',
);

function resolveCredentialPath(rawCredentialPath) {
  if (!rawCredentialPath) return '';

  if (path.isAbsolute(rawCredentialPath)) {
    return rawCredentialPath;
  }

  const fromServerDir = path.resolve(__dirname, rawCredentialPath);
  if (fs.existsSync(fromServerDir)) {
    return fromServerDir;
  }

  const fromCwd = path.resolve(process.cwd(), rawCredentialPath);
  if (fs.existsSync(fromCwd)) {
    return fromCwd;
  }

  return fromServerDir;
}

const GOOGLE_APPLICATION_CREDENTIALS_ABS = resolveCredentialPath(
  RAW_GOOGLE_APPLICATION_CREDENTIALS,
);

if (GOOGLE_APPLICATION_CREDENTIALS_ABS) {
  process.env.GOOGLE_APPLICATION_CREDENTIALS = GOOGLE_APPLICATION_CREDENTIALS_ABS;
}

// ===================== Vertex AI Gemini Setup =====================

let vertexAI = null;
let geminiReady = false;

function initGemini() {
  if (!GOOGLE_CLOUD_PROJECT) {
    console.warn('[Server] GOOGLE_CLOUD_PROJECT / GCP_PROJECT_ID belum diisi. Vertex AI Gemini tidak akan berfungsi.');
    return false;
  }

  if (!RAW_GOOGLE_APPLICATION_CREDENTIALS) {
    console.warn('[Server] GOOGLE_APPLICATION_CREDENTIALS belum diisi. Vertex AI Gemini membutuhkan service account.');
    return false;
  }

  if (!fs.existsSync(GOOGLE_APPLICATION_CREDENTIALS_ABS)) {
    console.warn('[Server] File GOOGLE_APPLICATION_CREDENTIALS tidak ditemukan:', GOOGLE_APPLICATION_CREDENTIALS_ABS);
    return false;
  }

  try {
    vertexAI = new GoogleGenAI({
      vertexai: true,
      project: GOOGLE_CLOUD_PROJECT,
      location: GCP_LOCATION,
    });

    console.log(`[Server] Vertex AI Gemini model "${GEMINI_PRIMARY_MODEL}" siap digunakan.`);
    console.log(`[Server] Vertex AI project: ${GOOGLE_CLOUD_PROJECT}`);
    console.log(`[Server] Vertex AI location: ${GCP_LOCATION}`);
    return true;
  } catch (error) {
    console.error('[Server] Gagal inisialisasi Vertex AI Gemini:', error.message);
    return false;
  }
}

geminiReady = initGemini();

// ===================== Express App =====================

const app = express();

app.use(cors({ origin: ALLOWED_ORIGINS, credentials: true }));
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));
app.use(cookieParser());

// ===================== Better Auth Handler & Middleware =====================
app.use('/api/auth', (req, _res, next) => {
  if (req.headers['x-forwarded-proto']) {
    req.headers['x-forwarded-proto'] = req.headers['x-forwarded-proto'].split(',')[0].trim();
  }
  if (req.headers['x-forwarded-host']) {
    req.headers['x-forwarded-host'] = req.headers['x-forwarded-host'].split(',')[0].trim();
  }
  next();
});
app.all('/api/auth/*', toNodeHandler(getAuth()));
app.use(authMiddleware);

// ===================== Register API Routes =====================
registerSSERoute(app, requireAuth);
registerTransactionRoutes(app);
registerCategoryRoutes(app);
registerBudgetRoutes(app);
registerRecurringRoutes(app);
registerNotificationRoutes(app);
registerProfessionalSuiteRoutes(app);
registerGmailRoutes(app);

const receiptImageUpload = multer({

  storage: multer.memoryStorage(),
  limits: {
    fileSize: 5 * 1024 * 1024,
    files: 1,
  },
  fileFilter: (_req, file, cb) => {
    const allowedMimeTypes = new Set(['image/jpeg', 'image/png', 'image/webp']);

    if (!allowedMimeTypes.has(file.mimetype)) {
      cb(new Error('File harus berupa gambar JPG, PNG, atau WebP.'));
      return;
    }

    cb(null, true);
  },
});

// ===================== Prompt Builders =====================

function buildExtractionPrompt(emailText, subject, sender, emailDate) {
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

function buildReceiptExtractionPrompt(userHint = {}) {
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

function buildMonthlyReportPrompt(reportData) {
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

function cleanResponse(text) {
  return String(text || '')
    .trim()
    .replace(/^```(?:json)?\s*/i, '')
    .replace(/\s*```$/i, '')
    .trim();
}

function repairJsonText(text) {
  return String(text || '')
    .replace(/,\s*([}\]])/g, '$1')
    .replace(/:\s*undefined\b/g, ': null')
    .replace(/:\s*NaN\b/g, ': null')
    .replace(/\bundefined\b/g, 'null')
    .replace(/\bNaN\b/g, 'null');
}

function parseGeminiResponse(rawResponse) {
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

function extractTextFromGenAIResponse(response) {
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

function normalizeReceiptPaymentMethod(value) {
  const normalized = String(value || '').toLowerCase().replace(/[_\s]/g, '-');

  if (normalized === 'cash' || normalized === 'tunai') return 'cash';
  if (normalized === 'qris' || normalized === 'qr') return 'qris';
  if (normalized === 'e-wallet' || normalized === 'ewallet' || normalized === 'wallet') return 'e-wallet';
  if (normalized === 'transfer' || normalized === 'bank-transfer' || normalized === 'transfer-bank') return 'transfer-bank';
  if (normalized === 'debit' || normalized === 'debit-card' || normalized === 'kartu-debit') return 'kartu-debit';
  if (normalized === 'credit' || normalized === 'kredit' || normalized === 'credit-card' || normalized === 'kartu-kredit') return 'kartu-kredit';

  return 'cash';
}

function normalizeReceiptResult(payload) {
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
    date: typeof payload?.date === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(payload.date)
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

function createRequestId(prefix = 'vertex') {
  return `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}

function getErrorMessage(error) {
  if (!error) return '';
  if (typeof error === 'string') return error;
  if (error.message) return String(error.message);
  return String(error);
}

function classifyVertexError(error) {
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
      message: `Model "${GEMINI_PRIMARY_MODEL}" tidak tersedia di region ${GCP_LOCATION}. Coba region/model lain.`,
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

function sendGeminiError(res, httpStatus, {
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
    ...(NODE_ENV !== 'production' && technicalMessage ? { technicalMessage } : {}),
    ...extra,
  });
}

// ===================== Supabase Helpers =====================

function getSupabaseServerClient() {
  const supabaseUrl = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL || '';
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY || '';

  if (!supabaseUrl || !serviceRoleKey) return null;

  return createClient(supabaseUrl, serviceRoleKey, {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
    },
  });
}

function getBearerToken(req) {
  const header = req.headers.authorization || '';
  const match = header.match(/^Bearer\s+(.+)$/i);
  return match?.[1] || '';
}

async function resolveAgentSearchUser(req, { required = false } = {}) {
  const token = getBearerToken(req);
  const supabase = getSupabaseServerClient();

  if (token && supabase) {
    const { data, error } = await supabase.auth.getUser(token);

    if (error || !data?.user?.id) {
      const authError = new Error('Session Supabase tidak valid atau sudah kedaluwarsa.');
      authError.status = 401;
      authError.code = 'AGENT_SEARCH_INVALID_REQUEST';
      throw authError;
    }

    return data.user.id;
  }

  if (required) {
    const authError = new Error(
      supabase
        ? 'Authorization Bearer Supabase access token wajib dikirim untuk sync/search data user.'
        : 'SUPABASE_URL dan SUPABASE_SERVICE_ROLE_KEY wajib ada di server untuk verifikasi token.',
    );

    authError.status = 401;
    authError.code = 'AGENT_SEARCH_INVALID_REQUEST';
    throw authError;
  }

  if (NODE_ENV !== 'production' && typeof req.body?.userId === 'string') {
    return req.body.userId;
  }

  return null;
}

function sendAgentSearchError(res, error) {
  const classified = classifyAgentSearchError(error);

  const status = error?.status
    || (classified.code === 'AGENT_SEARCH_INVALID_REQUEST' ? 400
      : classified.code === 'AGENT_SEARCH_NOT_CONFIGURED' ? 503
      : classified.code === 'AGENT_SEARCH_CREDENTIAL_MISSING' ? 503
      : classified.code === 'AGENT_SEARCH_PERMISSION_DENIED' ? 403
      : classified.code === 'AGENT_SEARCH_QUOTA_EXCEEDED' ? 429
      : 500);

  return res.status(status).json({
    ok: false,
    code: classified.code,
    message: classified.message,
    ...(NODE_ENV !== 'production' ? { detail: classified.detail } : {}),
  });
}

// ===================== Vertex AI Generate Helpers =====================

async function generateVertexContent({
  contents,
  config = {},
  timeoutMs = 45000,
  label = 'vertex-generate',
  feature = null,
  userId = null,
  metricMeta = {},
}) {
  if (!geminiReady || !vertexAI) {
    const error = new Error('Vertex AI Gemini belum dikonfigurasi di server.');
    error.code = 'VERTEX_NOT_CONFIGURED';
    throw error;
  }

  let lastError = null;
  const startedAt = Date.now();

  for (const currentModel of GEMINI_MODELS) {
    try {
      const resultPromise = vertexAI.models.generateContent({
        model: currentModel,
        contents,
        config: {
          temperature: 0.1,
          ...config,
        },
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

      return {
        text,
        modelUsed: currentModel,
        response,
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

      const isLastModel = currentModel === GEMINI_MODELS[GEMINI_MODELS.length - 1];

      console.warn('[Vertex AI] generateContent failed', {
        label,
        model: currentModel,
        code: classified.code,
        message: error.message,
        canTryFallback,
        isLastModel,
      });

      if (!canTryFallback || isLastModel) {
        // CF-053: record failure (non-blocking)
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
            metadata: metricMeta,
          }).catch(() => {});
        }
        throw error;
      }
    }
  }

  throw lastError || new Error('Vertex AI generateContent gagal tanpa detail error.');
}

async function generateGeminiText(prompt, { feature = null, userId = null, metricMeta = {} } = {}) {
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
  });

  return result;
}

async function generateGeminiVision(prompt, imageData, { feature = 'ocr_receipt', userId = null, metricMeta = {} } = {}) {
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
  });

  return result;
}

// ===================== Routes: Receipt Scan =====================

app.post('/api/ai/extract-receipt-image', receiptImageUpload.single('image'), async (req, res) => {
  const requestId = createRequestId('receipt');

  const { image, mimeType } = req.body;
  const allowedMimeTypes = new Set(['image/jpeg', 'image/png', 'image/webp']);

  let imageBase64 = null;
  let safeMimeType = 'image/jpeg';
  let userHint = {};

  if (typeof req.body.userHint === 'string') {
    try {
      userHint = JSON.parse(req.body.userHint);
    } catch {
      userHint = {};
    }
  } else if (req.body.userHint && typeof req.body.userHint === 'object') {
    userHint = req.body.userHint;
  }

  if (req.file) {
    safeMimeType = req.file.mimetype;
    imageBase64 = req.file.buffer.toString('base64');
  } else if (image) {
    if (typeof image !== 'string' || !/^[A-Za-z0-9+/=]+$/.test(image)) {
      return res.status(400).json({
        success: false,
        errorCode: 'INVALID_IMAGE_PAYLOAD',
        userMessage: 'Format gambar tidak valid. Upload ulang gambar bukti transaksi.',
        requestId,
      });
    }

    safeMimeType = allowedMimeTypes.has(mimeType) ? mimeType : 'image/jpeg';
    imageBase64 = image;
  }

  if (!imageBase64) {
    return res.status(400).json({
      success: false,
      errorCode: 'MISSING_IMAGE',
      userMessage: 'Gambar bukti transaksi tidak tersedia.',
      requestId,
    });
  }

  const estimatedBytes = Math.floor((imageBase64.length * 3) / 4);

  if (estimatedBytes > 5 * 1024 * 1024) {
    return res.status(413).json({
      success: false,
      errorCode: 'IMAGE_TOO_LARGE',
      userMessage: 'Ukuran gambar terlalu besar. Maksimal 5 MB.',
      requestId,
    });
  }

  if (!geminiReady || !vertexAI) {
    return res.status(503).json({
      success: false,
      errorCode: 'VERTEX_NOT_CONFIGURED',
      userMessage: 'Vertex AI Gemini belum dikonfigurasi di server.',
      requestId,
    });
  }

  try {
    const prompt = buildReceiptExtractionPrompt(userHint || {});

    console.log('[receipt-ai] request received', {
      requestId,
      fileSize: estimatedBytes,
      mimeType: safeMimeType,
      model: GEMINI_PRIMARY_MODEL,
      provider: 'vertex-ai',
    });

    const generated = await generateGeminiVision(prompt, {
      mimeType: safeMimeType,
      data: imageBase64,
    }, {
      feature: 'ocr_receipt',
      metricMeta: { mimeType: safeMimeType, sizeBytes: estimatedBytes },
    });

    const rawResponse = generated.text;

    if (!rawResponse) {
      return res.status(502).json({
        success: false,
        errorCode: 'VERTEX_EMPTY_RESPONSE',
        userMessage: 'AI mengembalikan response kosong. Coba lagi.',
        requestId,
        modelUsed: generated.modelUsed,
      });
    }

    const parsed = parseGeminiResponse(rawResponse);

    if (!parsed.success) {
      return res.status(422).json({
        success: false,
        errorCode: 'VERTEX_INVALID_JSON',
        userMessage: 'AI menghasilkan format yang tidak valid. Coba foto lebih jelas.',
        requestId,
        rawResponse,
        cleanedResponse: parsed.cleanedResponse,
        modelUsed: generated.modelUsed,
      });
    }

    return res.json({
      success: true,
      parsed: normalizeReceiptResult(parsed.data),
      rawResponse,
      cleanedResponse: parsed.cleanedResponse,
      modelUsed: generated.modelUsed,
      provider: 'vertex-ai',
      requestId,
    });
  } catch (error) {
    const classified = classifyVertexError(error);

    console.error('[Server] Receipt image extraction error:', {
      requestId,
      code: classified.code,
      message: error.message,
    });

    return res.status(classified.httpStatus).json({
      success: false,
      errorCode: classified.code,
      userMessage: classified.message,
      retryable: classified.retryable,
      requestId,
      ...(NODE_ENV !== 'production' ? { detail: error.message } : {}),
    });
  }
});

// ===================== Routes: Email Extraction =====================

app.post('/api/gemini/extract-transaction', async (req, res) => {
  const requestId = createRequestId('email');
  const { emailText, subject, sender, emailDate } = req.body;

  if (!emailText) {
    return sendGeminiError(res, 400, {
      requestId,
      errorCode: 'MISSING_EMAIL_TEXT',
      userMessage: 'Konten email tidak tersedia untuk diproses.',
      finalStatus: 'skipped',
    });
  }

  if (!geminiReady || !vertexAI) {
    return sendGeminiError(res, 503, {
      requestId,
      errorCode: 'VERTEX_NOT_CONFIGURED',
      userMessage: 'Vertex AI Gemini belum dikonfigurasi di server.',
      finalStatus: 'config_error',
      technicalMessage: 'Periksa GOOGLE_APPLICATION_CREDENTIALS, GOOGLE_CLOUD_PROJECT, dan GCP_LOCATION di server/.env.',
    });
  }

  try {
    const minimalEmailText = String(emailText).substring(0, 8000);

    const prompt = buildExtractionPrompt(
      minimalEmailText,
      subject || '',
      sender || '',
      emailDate || new Date().toISOString().split('T')[0],
    );

    const generated = await generateGeminiText(prompt, { feature: 'gmail_sync' });
    const rawResponse = generated.text;

    if (!rawResponse) {
      return sendGeminiError(res, 502, {
        requestId,
        errorCode: 'VERTEX_EMPTY_RESPONSE',
        userMessage: 'AI mengembalikan response kosong. Email ini bisa dicoba ulang nanti.',
        finalStatus: 'retry_later',
        retryable: true,
        extra: {
          modelUsed: generated.modelUsed,
          provider: 'vertex-ai',
        },
      });
    }

    const parsed = parseGeminiResponse(rawResponse);

    if (!parsed.success) {
      return sendGeminiError(res, 422, {
        requestId,
        errorCode: 'VERTEX_INVALID_JSON',
        userMessage: 'AI menghasilkan format yang belum valid. Parser lokal akan mencoba fallback.',
        finalStatus: 'retry_later',
        retryable: true,
        technicalMessage: parsed.error,
        extra: {
          rawResponse,
          cleanedResponse: parsed.cleanedResponse,
          repairAttempted: true,
          repairSuccess: false,
          modelUsed: generated.modelUsed,
          provider: 'vertex-ai',
        },
      });
    }

    metricsService.recordSystemMetric({ metricName: 'gmail_sync_success', feature: 'gmail_sync' }).catch(() => {});
    return res.json({
      success: true,
      parsed: parsed.data,
      rawResponse,
      cleanedResponse: parsed.cleanedResponse,
      repairAttempted: !!parsed.repairAttempted,
      modelUsed: generated.modelUsed,
      provider: 'vertex-ai',
    });
  } catch (error) {
    const classified = classifyVertexError(error);
    metricsService.recordSystemMetric({ metricName: 'gmail_sync_failed', feature: 'gmail_sync', metadata: { code: classified.code } }).catch(() => {});

    console.error('[Server] Vertex AI Gemini email extraction error:', {
      requestId,
      code: classified.code,
      message: error.message,
      subject: typeof subject === 'string' ? subject.substring(0, 120) : '',
      sender: typeof sender === 'string' ? sender.substring(0, 120) : '',
    });

    return sendGeminiError(res, classified.httpStatus, {
      requestId,
      errorCode: classified.code,
      userMessage: classified.message,
      finalStatus: classified.retryable ? 'retry_later' : 'config_error',
      retryable: classified.retryable,
      technicalMessage: error.message,
    });
  }
});

// ===================== Routes: Monthly Report =====================

app.post('/api/gemini/monthly-report', async (req, res) => {
  const requestId = createRequestId('report');
  const { month, year, metrics, sampleTransactions } = req.body;

  if (!month || !year || !metrics) {
    return res.status(400).json({
      success: false,
      error: 'month, year, dan metrics wajib diisi.',
      errorCode: 'MISSING_REPORT_DATA',
      requestId,
    });
  }

  if (!geminiReady || !vertexAI) {
    return res.status(503).json({
      success: false,
      error: 'Vertex AI Gemini belum dikonfigurasi. Periksa service account dan project.',
      errorCode: 'VERTEX_NOT_CONFIGURED',
      requestId,
    });
  }

  try {
    const prompt = buildMonthlyReportPrompt({
      month,
      year,
      metrics,
      sampleTransactions: Array.isArray(sampleTransactions)
        ? sampleTransactions.slice(0, 30)
        : [],
    });

    const generated = await generateGeminiText(prompt, { feature: 'insight_generator' });
    const rawResponse = generated.text;

    if (!rawResponse) {
      return res.status(502).json({
        success: false,
        error: 'Vertex AI Gemini mengembalikan response kosong.',
        errorCode: 'VERTEX_EMPTY_RESPONSE',
        requestId,
        modelUsed: generated.modelUsed,
      });
    }

    const parsed = parseGeminiResponse(rawResponse);

    if (!parsed.success) {
      return res.status(422).json({
        success: false,
        error: `AI menghasilkan JSON laporan tidak valid: ${parsed.error}`,
        errorCode: 'VERTEX_INVALID_JSON',
        rawResponse,
        cleanedResponse: parsed.cleanedResponse,
        modelUsed: generated.modelUsed,
        requestId,
      });
    }

    return res.json({
      success: true,
      report: parsed.data,
      rawResponse,
      cleanedResponse: parsed.cleanedResponse,
      modelUsed: generated.modelUsed,
      provider: 'vertex-ai',
      requestId,
    });
  } catch (error) {
    const classified = classifyVertexError(error);

    console.error('[Server] Vertex AI monthly report error:', {
      requestId,
      code: classified.code,
      message: error.message,
    });

    return res.status(classified.httpStatus).json({
      success: false,
      error: classified.message,
      errorCode: classified.code,
      retryable: classified.retryable,
      requestId,
      ...(NODE_ENV !== 'production' ? { detail: error.message } : {}),
    });
  }
});

// ===================== Routes: Gemini / Vertex Health =====================

app.get('/api/gemini/health', async (_req, res) => {
  if (!GOOGLE_CLOUD_PROJECT) {
    return res.status(503).json({
      ok: false,
      status: 'unconfigured',
      message: 'GOOGLE_CLOUD_PROJECT / GCP_PROJECT_ID belum diisi di server/.env.',
      provider: 'vertex-ai',
      model: GEMINI_PRIMARY_MODEL,
      projectId: null,
      location: GCP_LOCATION,
      credentialExists: fs.existsSync(GOOGLE_APPLICATION_CREDENTIALS_ABS),
      sdkVersion: '@google/genai',
    });
  }

  if (!RAW_GOOGLE_APPLICATION_CREDENTIALS) {
    return res.status(503).json({
      ok: false,
      status: 'unconfigured',
      message: 'GOOGLE_APPLICATION_CREDENTIALS belum diisi di server/.env.',
      provider: 'vertex-ai',
      model: GEMINI_PRIMARY_MODEL,
      projectId: GOOGLE_CLOUD_PROJECT,
      location: GCP_LOCATION,
      credentialExists: false,
      sdkVersion: '@google/genai',
    });
  }

  if (!fs.existsSync(GOOGLE_APPLICATION_CREDENTIALS_ABS)) {
    return res.status(503).json({
      ok: false,
      status: 'credential_missing',
      message: 'File service account tidak ditemukan.',
      provider: 'vertex-ai',
      model: GEMINI_PRIMARY_MODEL,
      projectId: GOOGLE_CLOUD_PROJECT,
      location: GCP_LOCATION,
      credentialPath: RAW_GOOGLE_APPLICATION_CREDENTIALS,
      absoluteCredentialPath: GOOGLE_APPLICATION_CREDENTIALS_ABS,
      credentialExists: false,
      sdkVersion: '@google/genai',
    });
  }

  if (!geminiReady || !vertexAI) {
    return res.status(503).json({
      ok: false,
      status: 'init_failed',
      message: 'Vertex AI Gemini gagal inisialisasi.',
      provider: 'vertex-ai',
      model: GEMINI_PRIMARY_MODEL,
      projectId: GOOGLE_CLOUD_PROJECT,
      location: GCP_LOCATION,
      credentialExists: true,
      sdkVersion: '@google/genai',
    });
  }

  try {
    const generated = await generateVertexContent({
      contents: [
        {
          role: 'user',
          parts: [{ text: 'Respond with only: OK' }],
        },
      ],
      config: {
        temperature: 0,
      },
      timeoutMs: 30000,
      label: 'health-check',
    });

    if (generated.text) {
      return res.json({
        ok: true,
        status: 'ok',
        message: `Vertex AI Gemini model "${generated.modelUsed}" siap digunakan dan merespons.`,
        provider: 'vertex-ai',
        model: generated.modelUsed,
        primaryModel: GEMINI_PRIMARY_MODEL,
        fallbackModel: GEMINI_FALLBACK_MODEL,
        projectId: GOOGLE_CLOUD_PROJECT,
        location: GCP_LOCATION,
        credentialPath: RAW_GOOGLE_APPLICATION_CREDENTIALS,
        absoluteCredentialPath: GOOGLE_APPLICATION_CREDENTIALS_ABS,
        credentialExists: true,
        sdkVersion: '@google/genai',
      });
    }

    return res.status(503).json({
      ok: false,
      status: 'empty_response',
      message: 'Vertex AI Gemini merespons kosong pada health check.',
      provider: 'vertex-ai',
      model: GEMINI_PRIMARY_MODEL,
      projectId: GOOGLE_CLOUD_PROJECT,
      location: GCP_LOCATION,
      credentialExists: true,
      sdkVersion: '@google/genai',
    });
  } catch (error) {
    const classified = classifyVertexError(error);

    return res.status(classified.httpStatus).json({
      ok: false,
      status: classified.code,
      message: classified.message,
      provider: 'vertex-ai',
      model: GEMINI_PRIMARY_MODEL,
      projectId: GOOGLE_CLOUD_PROJECT,
      location: GCP_LOCATION,
      credentialPath: RAW_GOOGLE_APPLICATION_CREDENTIALS,
      absoluteCredentialPath: GOOGLE_APPLICATION_CREDENTIALS_ABS,
      credentialExists: fs.existsSync(GOOGLE_APPLICATION_CREDENTIALS_ABS),
      sdkVersion: '@google/genai',
      errorCode: classified.code,
      retryable: classified.retryable,
      ...(NODE_ENV !== 'production' ? { detail: error.message } : {}),
    });
  }
});

// ===================== Routes: Agent Search =====================

app.get('/api/agent-search/config', (_req, res) => {
  res.json({
    ok: true,
    config: getPublicAgentSearchConfig(),
  });
});

app.get('/api/agent-search/health', async (_req, res) => {
  const health = await checkAgentSearchHealth();
  res.status(health.ok ? 200 : 503).json(health);
});

app.post('/api/agent-search/query', async (req, res) => {
  const t0 = Date.now();
  try {
    const tab = req.body?.tab || 'help';
    const userRequired = ['transactions', 'insight', 'gmail', 'receipts'].includes(tab);
    const userId = await resolveAgentSearchUser(req, { required: userRequired });

    const result = await queryAgentSearch({
      query: req.body?.query,
      tab,
      userId,
    });

    // CF-053: non-blocking search metrics (count/latency only — no token data)
    const latency = Date.now() - t0;
    metricsService.recordAIUsage({
      feature: 'agent_search', provider: 'vertex_search', executionTimeMs: latency,
      status: 'success', userId, metadata: { tab, resultCount: result?.diagnostics?.resultCount ?? 0 },
    }).catch(() => {});
    metricsService.recordSystemMetric({ metricName: 'agent_search_count', feature: 'agent_search', userId, metadata: { tab } }).catch(() => {});
    if ((result?.diagnostics?.resultCount ?? 0) === 0) {
      metricsService.recordSystemMetric({ metricName: 'agent_search_empty', feature: 'agent_search', userId, metadata: { tab } }).catch(() => {});
    }
    metricsService.recordSystemMetric({ metricName: 'agent_search_latency', metricValue: latency, feature: 'agent_search', userId }).catch(() => {});

    return res.json(result);
  } catch (error) {
    metricsService.recordAIUsage({
      feature: 'agent_search', provider: 'vertex_search', executionTimeMs: Date.now() - t0,
      status: 'error', errorMessage: error?.code || error?.message,
    }).catch(() => {});
    metricsService.recordSystemMetric({ metricName: 'agent_search_error', feature: 'agent_search' }).catch(() => {});
    return sendAgentSearchError(res, error);
  }
});

app.post('/api/agent-search/answer', async (req, res) => {
  const t0 = Date.now();
  try {
    const tab = req.body?.tab || 'help';
    const userRequired = ['transactions', 'insight', 'gmail', 'receipts'].includes(tab);
    const userId = await resolveAgentSearchUser(req, { required: userRequired });

    const result = await answerAgentSearch({
      query: req.body?.query,
      tab,
      userId,
    });

    // CF-053: non-blocking search metrics
    const latency = Date.now() - t0;
    metricsService.recordAIUsage({
      feature: 'agent_search', provider: 'vertex_search', executionTimeMs: latency,
      status: 'success', userId, metadata: { tab, resultCount: result?.diagnostics?.resultCount ?? 0 },
    }).catch(() => {});
    metricsService.recordSystemMetric({ metricName: 'agent_search_count', feature: 'agent_search', userId, metadata: { tab } }).catch(() => {});
    if ((result?.diagnostics?.resultCount ?? 0) === 0) {
      metricsService.recordSystemMetric({ metricName: 'agent_search_empty', feature: 'agent_search', userId, metadata: { tab } }).catch(() => {});
    }
    metricsService.recordSystemMetric({ metricName: 'agent_search_latency', metricValue: latency, feature: 'agent_search', userId }).catch(() => {});

    return res.json(result);
  } catch (error) {
    metricsService.recordAIUsage({
      feature: 'agent_search', provider: 'vertex_search', executionTimeMs: Date.now() - t0,
      status: 'error', errorMessage: error?.code || error?.message,
    }).catch(() => {});
    metricsService.recordSystemMetric({ metricName: 'agent_search_error', feature: 'agent_search' }).catch(() => {});
    return sendAgentSearchError(res, error);
  }
});

// ===================== Routes: Admin Monitoring (CF-053) =====================

/**
 * Resolve admin user dari session Better Auth (req.user diisi authMiddleware).
 * Admin = email di ADMIN_EMAILS env.
 * Migrasi dari validasi Supabase JWT — kini memakai cookie session Better Auth
 * yang sama dengan seluruh route lain (CF-053 admin monitoring fix).
 */
async function resolveAdmin(req) {
  const user = req.user;
  if (!user?.email) {
    const err = new Error('Autentikasi diperlukan. Silakan login terlebih dahulu.');
    err.status = 401;
    throw err;
  }
  const email = String(user.email).toLowerCase();
  const admins = getAdminEmails();
  if (admins.length === 0 || !admins.includes(email)) {
    const err = new Error('Akses ditolak. Hanya admin yang dapat mengakses monitoring.');
    err.status = 403;
    throw err;
  }
  return { userId: user.id, email };
}

function sendAdminError(res, error) {
  const status = error?.status || 500;
  const message = status === 401 ? 'Autentikasi diperlukan.'
    : status === 403 ? 'Akses ditolak. Khusus admin.'
    : status === 400 ? (error.message || 'Parameter tidak valid.')
    : 'Terjadi error saat memuat data monitoring.';
  return res.status(status).json({ ok: false, code: `ADMIN_METRICS_${status}`, message });
}

function parseDateRange(req, defaultDays = 7) {
  const to = req.query.to ? new Date(req.query.to) : new Date();
  const from = req.query.from ? new Date(req.query.from) : new Date(Date.now() - defaultDays * 86400_000);
  if (Number.isNaN(from.getTime()) || Number.isNaN(to.getTime())) {
    const err = new Error('Parameter from/to harus tanggal ISO valid.');
    err.status = 400;
    throw err;
  }
  return { from: from.toISOString(), to: to.toISOString() };
}

// GET /api/admin/metrics/ai-usage?from&to&feature
app.get('/api/admin/metrics/ai-usage', async (req, res) => {
  try {
    await resolveAdmin(req);
    const { from, to } = parseDateRange(req);
    const feature = req.query.feature && FEATURES.includes(req.query.feature) ? req.query.feature : null;
    const summary = await metricsService.getAIUsageSummary({ from, to, feature });
    const trend = await metricsService.getCostTrend({ from, to });
    return res.json({ ok: true, summary, trend });
  } catch (error) {
    return sendAdminError(res, error);
  }
});

// GET /api/admin/metrics/system?metric_name&from&to&feature
app.get('/api/admin/metrics/system', async (req, res) => {
  try {
    await resolveAdmin(req);
    const { from, to } = parseDateRange(req);
    const feature = req.query.feature && FEATURES.includes(req.query.feature) ? req.query.feature : null;
    const result = await metricsService.getSystemMetrics({
      metricName: req.query.metric_name || null, from, to, feature,
    });
    return res.json({ ok: true, ...result });
  } catch (error) {
    return sendAdminError(res, error);
  }
});

// GET /api/admin/metrics/summary — today/week/month + per-feature
app.get('/api/admin/metrics/summary', async (req, res) => {
  try {
    await resolveAdmin(req);
    const now = new Date();
    const startOfDay = new Date(now.getFullYear(), now.getMonth(), now.getDate()).toISOString();
    const weekAgo = new Date(Date.now() - 7 * 86400_000).toISOString();
    const monthAgo = new Date(Date.now() - 30 * 86400_000).toISOString();
    const nowIso = now.toISOString();

    const [today, week, month] = await Promise.all([
      metricsService.getAIUsageSummary({ from: startOfDay, to: nowIso }),
      metricsService.getAIUsageSummary({ from: weekAgo, to: nowIso }),
      metricsService.getAIUsageSummary({ from: monthAgo, to: nowIso }),
    ]);

    return res.json({
      ok: true,
      today: { costIdr: today.costIdr, tokens: today.tokens, calls: today.calls, avgTimeMs: today.avgTimeMs },
      week: { costIdr: week.costIdr, tokens: week.tokens, calls: week.calls, avgTimeMs: week.avgTimeMs },
      month: { costIdr: month.costIdr, tokens: month.tokens, calls: month.calls, avgTimeMs: month.avgTimeMs },
      features: week.features,
    });
  } catch (error) {
    return sendAdminError(res, error);
  }
});

// GET /api/admin/metrics/feature-health?feature&from&to
app.get('/api/admin/metrics/feature-health', async (req, res) => {
  try {
    await resolveAdmin(req);
    const { from, to } = parseDateRange(req);
    const feature = req.query.feature;
    if (feature && !FEATURES.includes(feature)) {
      const err = new Error('feature tidak valid.');
      err.status = 400;
      throw err;
    }
    if (feature) {
      const health = await metricsService.getFeatureHealth({ feature, from, to });
      return res.json({ ok: true, health: [health] });
    }
    const all = await Promise.all(FEATURES.map((f) => metricsService.getFeatureHealth({ feature: f, from, to })));
    return res.json({ ok: true, health: all });
  } catch (error) {
    return sendAdminError(res, error);
  }
});

// GET /api/admin/metrics/feature/:feature/calls?status&from&to&page&page_size
app.get('/api/admin/metrics/feature/:feature/calls', async (req, res) => {
  try {
    await resolveAdmin(req);
    const { from, to } = parseDateRange(req, 30);
    const feature = req.params.feature;
    if (!FEATURES.includes(feature)) {
      const err = new Error('feature tidak valid.');
      err.status = 400;
      throw err;
    }
    const allowedStatus = ['all', 'success', 'failed'];
    const status = allowedStatus.includes(req.query.status) ? req.query.status : 'all';
    const page = Math.max(1, parseInt(req.query.page, 10) || 1);
    const pageSize = Math.min(100, Math.max(1, parseInt(req.query.page_size, 10) || 20));

    const result = await metricsService.getFeatureCalls({ feature, status, from, to, page, pageSize });
    return res.json({ ok: true, ...result });
  } catch (error) {
    return sendAdminError(res, error);
  }
});

// GET /api/admin/metrics/alerts
app.get('/api/admin/metrics/alerts', async (req, res) => {
  try {
    await resolveAdmin(req);
    const alerts = await metricsService.checkAlerts();
    return res.json({ ok: true, alerts });
  } catch (error) {
    return sendAdminError(res, error);
  }
});

app.post('/api/agent-search/sync-docs', async (_req, res) => {
  try {
    const result = await syncCashFlowDocs();
    return res.json(result);
  } catch (error) {
    return sendAgentSearchError(res, error);
  }
});

app.post('/api/agent-search/sync-transactions', async (req, res) => {
  try {
    const userId = await resolveAgentSearchUser(req, { required: true });
    const result = await syncTransactionsForUser({ userId });
    return res.json(result);
  } catch (error) {
    return sendAgentSearchError(res, error);
  }
});

app.post('/api/agent-search/sync-gmail-logs', async (req, res) => {
  try {
    const userId = await resolveAgentSearchUser(req, { required: true });
    const result = await syncGmailLogsForUser({ userId });
    return res.json(result);
  } catch (error) {
    return sendAgentSearchError(res, error);
  }
});

app.post('/api/agent-search/sync-receipts', async (req, res) => {
  try {
    const userId = await resolveAgentSearchUser(req, { required: true });
    const result = await syncReceiptsForUser({ userId });
    return res.json(result);
  } catch (error) {
    return sendAgentSearchError(res, error);
  }
});

// ===================== Routes: Server Health =====================

app.get('/api/health', (_req, res) => {
  res.json({
    ok: true,
    status: 'running',
    provider: 'vertex-ai',
    geminiReady,
    model: GEMINI_PRIMARY_MODEL,
    fallbackModel: GEMINI_FALLBACK_MODEL,
    projectId: GOOGLE_CLOUD_PROJECT,
    location: GCP_LOCATION,
  });
});

// ===================== Error Middleware =====================

app.use((err, _req, res, next) => {
  if (!err) {
    next();
    return;
  }

  if (err.code === 'LIMIT_FILE_SIZE' || err.type === 'entity.too.large') {
    return res.status(413).json({
      success: false,
      ok: false,
      errorCode: 'PAYLOAD_TOO_LARGE',
      code: 'PAYLOAD_TOO_LARGE',
      userMessage: 'Gambar terlalu besar untuk diproses. Kompres gambar atau upload file yang lebih kecil.',
      message: 'Gambar terlalu besar untuk diproses. Kompres gambar atau upload file yang lebih kecil.',
    });
  }

  if (err.message?.includes('File harus berupa gambar')) {
    return res.status(400).json({
      success: false,
      ok: false,
      errorCode: 'INVALID_IMAGE_TYPE',
      code: 'INVALID_IMAGE_TYPE',
      userMessage: err.message,
      message: err.message,
    });
  }

  return res.status(500).json({
    success: false,
    ok: false,
    errorCode: 'SERVER_ERROR',
    code: 'SERVER_ERROR',
    userMessage: 'Terjadi error teknis di server AI.',
    message: 'Terjadi error teknis di server AI.',
    ...(NODE_ENV !== 'production' ? { detail: err.message } : {}),
  });
});

// ===================== Start Server =====================

app.listen(PORT, '0.0.0.0', () => {
  console.log(`[Server] CashFlow AI Proxy berjalan di port ${PORT}`);
  console.log(`[Server] Provider: Vertex AI`);
  console.log(`[Server] Gemini: ${geminiReady ? '✅ Siap' : '❌ Belum dikonfigurasi'}`);
  console.log(`[Server] Model utama: ${GEMINI_PRIMARY_MODEL}`);
  console.log(`[Server] Model fallback: ${GEMINI_FALLBACK_MODEL}`);
  console.log(`[Server] Project: ${GOOGLE_CLOUD_PROJECT || '-'}`);
  console.log(`[Server] Location: ${GCP_LOCATION}`);
  console.log(`[Server] Allowed origins: ${ALLOWED_ORIGINS.join(', ')}`);

  if (geminiReady && vertexAI) {
    generateVertexContent({
      contents: [
        {
          role: 'user',
          parts: [{ text: 'Respond with only: OK' }],
        },
      ],
      config: {
        temperature: 0,
      },
      timeoutMs: 30000,
      label: 'startup-connectivity-test',
    })
      .then((result) => {
        console.log(`[Server] Vertex AI connectivity: ✅ model "${result.modelUsed}" berhasil merespons.`);
      })
      .catch((error) => {
        const classified = classifyVertexError(error);
        console.warn(`[Server] ⚠️  Vertex AI connectivity test gagal: ${classified.code}`);
        console.warn(`[Server] ⚠️  ${classified.message}`);

        if (NODE_ENV !== 'production') {
          console.warn(`[Server] ⚠️  Detail: ${error.message}`);
        }
      });
  }
});