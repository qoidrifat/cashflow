/**
 * CashFlow AI Proxy Server - Vertex AI Edition
 *
 * Server ini berfungsi sebagai proxy antara frontend CashFlow dan Google Vertex AI Gemini.
 *
 * P4.14: Monolit diekstrak — seluruh route domain kini ada di server/routes/*:
 *   - transactionRoutes / categoryRoutes / budgetRoutes / recurringRoutes
 *   - notificationRoutes / professionalSuiteRoutes / gmailRoutes
 *   - geminiRoutes (receipt + extract-transaction + monthly-report + gemini/health)
 *   - agentSearchRoutes (query/answer/sync-docs/sync-*)
 *   - adminMetricsRoutes (CF-053 monitoring)
 *   - healthRoutes
 * State & helper Vertex AI ada di server/lib/vertexContext.js.
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
 *   GET  /api/admin/metrics/*
 *   GET  /api/health
 *
 * Cara menjalankan:
 *   1. cd server
 *   2. Pastikan server/.env berisi:
 *      GOOGLE_APPLICATION_CREDENTIALS=./google-agent-search-service-account.json
 *      GOOGLE_CLOUD_PROJECT=snappy-weft-479506-h5
 *      GCP_LOCATION=us-central1
 *      GEMINI_PRIMARY_MODEL=gemini-2.5-flash
 *      GEMINI_FALLBACK_MODEL=gemini-2.5-flash-lite
 *   3. node index.js
 */

// IMPORT PERTAMA WAJIB: env loader (ESM mengevaluasi imports depth-first sesuai
// urutan — module ini harus selesai SEBELUM module lain membaca process.env di
// module scope). Lihat server/lib/env.js untuk root cause & penjelasan.
import './lib/env.js';

import path from 'node:path';
import express from 'express';
import cors from 'cors';
import cookieParser from 'cookie-parser';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';

import { toNodeHandler } from 'better-auth/node';
import { getAuth } from './lib/auth.js';
import { authMiddleware, requireAuth } from './middleware/authMiddleware.js';
import { registerSSERoute, closeSSEClients } from './lib/sse.js';
import { registerTransactionRoutes } from './routes/transactionRoutes.js';
import { registerFraudRoutes } from './routes/fraudRoutes.js';
import { registerCategoryRoutes } from './routes/categoryRoutes.js';
import { registerBudgetRoutes } from './routes/budgetRoutes.js';
import { registerRecurringRoutes } from './routes/recurringRoutes.js';
import { registerNotificationRoutes } from './routes/notificationRoutes.js';
import { registerProfessionalSuiteRoutes } from './routes/professionalSuiteRoutes.js';
import { registerGmailRoutes } from './routes/gmailRoutes.js';
import { registerGeminiRoutes } from './routes/geminiRoutes.js';
import { registerAgentSearchRoutes } from './routes/agentSearchRoutes.js';
import { registerKnowledgeRoutes } from './routes/knowledgeRoutes.js';
import { registerAdminMetricsRoutes } from './routes/adminMetricsRoutes.js';
import { registerHealthRoutes } from './routes/healthRoutes.js';
import { registerAiProductRoutes } from './routes/aiProductRoutes.js';
import { registerConversationRoutes } from './routes/conversationRoutes.js';
import { registerPrivacyRoutes } from './routes/privacyRoutes.js';
import { registerFinancialSettingsRoutes } from './routes/financialSettingsRoutes.js';
import { registerReconciliationRoutes } from './routes/reconciliationRoutes.js';
import { getTurso, closeTurso } from './lib/turso.js';
import { runAlertEvaluation } from './services/metricsService.js';
import { cleanupExpiredSessions } from './lib/sessionCleanup.js';
import helmet from 'helmet';
import { rateLimit } from 'express-rate-limit';
import { logger } from './lib/logger.js';
import { requestIdMiddleware, httpMetricsMiddleware } from './middleware/observabilityMiddleware.js';
import { handleServerError } from './middleware/errorHandler.js';
import { assertGeminiMockSafe } from './lib/aiMock.js';
import {
  configureVertexAI,
  initGemini,
  getVertexState,
  isProduction,
  generateVertexContent,
  classifyVertexError,
} from './lib/vertexContext.js';

// Pastikan Turso client & schema terinisialisasi
getTurso();

// ===================== Path helpers =====================

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// ===================== Configuration =====================

function cleanEnv(value) {
  return String(value || '').trim().replace(/[\\]+$/g, '');
}

const PORT = parseInt(process.env.PORT || '5181', 10);

const NODE_ENV = cleanEnv(process.env.NODE_ENV || 'development');

const ALLOWED_ORIGINS = process.env.ALLOWED_ORIGINS
  ? process.env.ALLOWED_ORIGINS.split(',').map((origin) => origin.trim()).filter(Boolean)
  : ['http://localhost:5180', 'http://127.0.0.1:5180', 'http://localhost:4173', 'http://127.0.0.1:4173'];

// S3.1 (audit 2026-09-04): validasi origin di boot — reject `*`, trailing path,
// dan format non-URL. Operator salah tulis (mis. `ALLOWED_ORIGINS=*` atau
// `https://app.example.com/`) harus gagal cepat, bukan diam-diam melemahkan
// CORS. `*` + credentials:true akan ditolak browser, tapi fail-fast lebih jujur.
for (const origin of ALLOWED_ORIGINS) {
  if (!/^https?:\/\/[^/]+$/.test(origin)) {
    throw new Error(
      `[CORS] ALLOWED_ORIGINS tidak valid: "${origin}". ` +
        'Format wajib http(s)://host[:port] tanpa path, tanpa wildcard `*`.',
    );
  }
}

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

// ===================== Vertex AI Context =====================

configureVertexAI({
  primaryModel: GEMINI_PRIMARY_MODEL,
  fallbackModel: GEMINI_FALLBACK_MODEL,
  projectId: GOOGLE_CLOUD_PROJECT,
  location: GCP_LOCATION,
  rawCredentials: RAW_GOOGLE_APPLICATION_CREDENTIALS,
  credentialsAbs: GOOGLE_APPLICATION_CREDENTIALS_ABS,
  nodeEnv: NODE_ENV,
});

initGemini();

// P1.8: AI mock boundary — fail-fast di boot bila GEMINI_MOCK=1 diaktifkan di
// produksi (mock hanya untuk E2E/test; tidak pernah boleh aktif di production).
assertGeminiMockSafe();

// ===================== Security Hardening (Sprint 1.1) =====================
// Helmet + rate limiting (express-rate-limit v7, kompatibel Express 4).
// Default longgar utk dev; overridable via env:
//   RATE_LIMIT_ENABLED=false            → matikan total (dev/CI)
//   RATE_LIMIT_GENERAL_MAX / _AUTH_MAX / _AI_MAX / _RECEIPT_MAX (per 15 menit)
const RATE_LIMIT_ENABLED = process.env.RATE_LIMIT_ENABLED !== 'false';

function envInt(key, fallback) {
  const v = parseInt(process.env[key], 10);
  return Number.isFinite(v) && v > 0 ? v : fallback;
}

// Key per-user bila terautentikasi, fallback ke IP — anti-sharing abuse.
const rateKeyGen = (req) => (req.user?.id ? `u:${req.user.id}` : `ip:${req.ip || 'unknown'}`);

const rlMessage = (msg) => ({ ok: false, code: 'RATE_LIMITED', message: msg });

const generalLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: envInt('RATE_LIMIT_GENERAL_MAX', 5000),
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  keyGenerator: rateKeyGen,
  message: rlMessage('Terlalu banyak request. Coba lagi nanti.'),
  skip: (req) => req.path === '/api/health' || req.path === '/api/ready',
});

// Auth limiter: HANYA request mutasi (POST). GET session-check adalah read-only
// yang dipanggil SPA setiap page-load — jika dihitung, 25 test E2E (tiap load =
// 1+ panggilan /api/auth/*) langsung menguras budget dan memblokir IP sendiri.
// Brute-force protection tetap efektif karena serangan memakai POST (sign-in/callback).
const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: envInt('RATE_LIMIT_AUTH_MAX', 120),
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  keyGenerator: rateKeyGen,
  message: rlMessage('Terlalu banyak percobaan auth. Coba lagi nanti.'),
  skip: (req) => req.method === 'GET' || req.path === '/api/health',
});

const aiLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: envInt('RATE_LIMIT_AI_MAX', 120),
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  keyGenerator: rateKeyGen,
  message: rlMessage('Terlalu banyak panggilan AI. Coba lagi nanti.'),
});

const receiptLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: envInt('RATE_LIMIT_RECEIPT_MAX', 30),
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  keyGenerator: rateKeyGen,
  message: rlMessage('Terlalu banyak scan struk. Coba lagi nanti.'),
});

// Pasang limiter hanya bila aktif (no-op middleware bila dimatikan).
const security = (limiter) => (RATE_LIMIT_ENABLED ? limiter : (req, _res, next) => next());

// ===================== Express App =====================

const app = express();

// Sprint 2: request-ID global (paling awal agar semua middleware punya req.id).
app.use(requestIdMiddleware);
app.use(cors({ origin: ALLOWED_ORIGINS, credentials: true }));
app.use(helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      scriptSrc: ["'self'"],
      styleSrc: ["'self'", "'unsafe-inline'"],
      imgSrc: ["'self'", 'data:', 'https://*.googleusercontent.com', 'https://www.gstatic.com'],
      fontSrc: ["'self'", 'data:', 'https://fonts.gstatic.com'],
      // connect-src dibangun dari ALLOWED_ORIGINS + trusted origins env (bukan
      // hardcode localhost saja) agar siap untuk static serving di domain produksi.
      connectSrc: Array.from(new Set([
        "'self'",
        ...ALLOWED_ORIGINS,
        'http://localhost:5181',
        'http://127.0.0.1:5181',
        ...(process.env.BETTER_AUTH_TRUSTED_ORIGINS || '').split(',').map((o) => o.trim()).filter(Boolean),
        'https://*.googleapis.com',
        'https://accounts.google.com',
      ])),
      frameSrc: ["'self'", 'https://accounts.google.com'],
      formAction: ["'self'", 'https://accounts.google.com'],
      objectSrc: ["'none'"],
      baseUri: ["'self'"],
      // S3.2 (audit 2026-09-04): upgrade http→https hanya di produksi. Dev
      // (http 5180/5181) TIDAK dipaksa https — bila dipaksa, Vite/HMR & fetch
      // lokal pecah. Produksi memaksa https untuk semua subresource.
      upgradeInsecureRequests: NODE_ENV === 'production' ? [] : null,
    },
  },
  crossOriginEmbedderPolicy: false,
  crossOriginResourcePolicy: { policy: 'cross-origin' },
  referrerPolicy: { policy: 'strict-origin-when-cross-origin' },
  hsts: NODE_ENV === 'production' ? { maxAge: 31536000, includeSubDomains: true, preload: true } : false,
}));
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));
app.use(cookieParser());

// S3.4 (audit 2026-09-04): trust proxy hanya boleh di-set di belakang reverse
// proxy nyata. Di produksi, nilai env salah (mis. dipakai TANPA proxy) membuat
// req.ip mengikuti X-Forwarded-For yang bisa di-spoof → bypass IP rate limiter.
// Produksi: maksimal 2 hop (Cloud Run/typical CDN), hardcoded clamp. Dev bebas.
if (process.env.TRUST_PROXY) {
  const trustProxy = Number(process.env.TRUST_PROXY) || 1;
  app.set('trust proxy', NODE_ENV === 'production' ? Math.min(trustProxy, 2) : trustProxy);
}

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
app.use('/api/auth', security(authLimiter));
app.all('/api/auth/*', toNodeHandler(getAuth()));
app.use(authMiddleware);

// HTTP metrics + request log (setelah auth → req.user tersedia; sebelum rate
// limiter agar respons 429 ikut terhitung).
app.use(httpMetricsMiddleware);

// Rate limiting umum API + jalur AI (setelah auth → key per-user tersedia).
app.use(security(generalLimiter));
app.use('/api/gemini', security(aiLimiter));
app.use('/api/agent-search', security(aiLimiter));
app.use('/api/ai/extract-receipt-image', security(receiptLimiter));

// ===================== Register API Routes =====================
registerSSERoute(app, requireAuth);  registerTransactionRoutes(app);
  registerFraudRoutes(app);
registerCategoryRoutes(app);
registerBudgetRoutes(app);
registerRecurringRoutes(app);
registerNotificationRoutes(app);
registerProfessionalSuiteRoutes(app);
registerGmailRoutes(app);
registerGeminiRoutes(app);
registerAgentSearchRoutes(app);
registerKnowledgeRoutes(app);
registerAdminMetricsRoutes(app);
registerHealthRoutes(app);  registerAiProductRoutes(app);
  registerConversationRoutes(app);
registerPrivacyRoutes(app);  registerFinancialSettingsRoutes(app);
  registerReconciliationRoutes(app);

// ===================== Error Middleware =====================
// Global error handler (shape kanonik §0: error + errorCode + requestId) —
// dipasang TERAKHIR; route memanggil next(err) untuk menyerahkan ke sini.
app.use(handleServerError);

// ===================== Start Server =====================

// ===================== Alert Scheduler (MONITORING_AUDIT gap #7) =============
// Evaluasi alert BERKALA (default 60s) walau tidak ada admin yang membuka
// dashboard — sehingga notification channel (gap #1) benar-benar mengirim.
// checkAlerts() punya cache 60s utk request path; runAlertEvaluation() bypass
// cache (khusus scheduler).
// Env: ALERT_SCHEDULER_ENABLED=false utk matikan; ALERT_SCHEDULER_INTERVAL_MS
// utk ubah interval. Nonaktif otomatis di server uji (PORT 5182 — rate-limit
// spec) agar tidak ada side-effect saat E2E.
const ALERT_SCHEDULER_ENABLED = process.env.ALERT_SCHEDULER_ENABLED !== 'false' && PORT !== 5182;
const ALERT_SCHEDULER_INTERVAL_MS = (() => {
  const v = parseInt(process.env.ALERT_SCHEDULER_INTERVAL_MS, 10);
  return Number.isFinite(v) && v > 0 ? v : 60_000;
})();

let alertSchedulerTimer = null;
function startAlertScheduler() {
  if (!ALERT_SCHEDULER_ENABLED) {
    logger.info({ port: PORT }, 'Alert scheduler dinonaktifkan (env/test server)');
    return;
  }
  alertSchedulerTimer = setInterval(() => {
    runAlertEvaluation()
      .catch((err) => logger.warn({ err: err.message }, 'Alert scheduler evaluation gagal'));
  }, ALERT_SCHEDULER_INTERVAL_MS);
  // unref: timer tidak menahan proses shutdown
  alertSchedulerTimer.unref();
  logger.info({ intervalMs: ALERT_SCHEDULER_INTERVAL_MS }, 'Alert scheduler aktif (evaluasi berkala)');
}

// ===================== Session Cleanup Scheduler (2026-08-09) ================
// Pembersihan sesi KEDALUWARSA dari tabel `session` (better-auth TIDAK pernah
// menghapus baris kedaluwarsa sendiri — hanya sign-out/rotasi yang hapus →
// akumulasi sampah tanpa batas). Pola IDENTIK alert scheduler:
//   Env: SESSION_CLEANUP_ENABLED=false utk matikan; SESSION_CLEANUP_INTERVAL_MS
//   utk ubah interval (default 24 jam = 86_400_000).
// Nonaktif otomatis di server uji (PORT 5182 — rate-limit spec) & 5183
// (webhook spec) agar tidak ada side-effect saat E2E.
const SESSION_CLEANUP_ENABLED =
  process.env.SESSION_CLEANUP_ENABLED !== 'false' && PORT !== 5182 && PORT !== 5183;
const SESSION_CLEANUP_INTERVAL_MS = (() => {
  const v = parseInt(process.env.SESSION_CLEANUP_INTERVAL_MS, 10);
  return Number.isFinite(v) && v > 0 ? v : 86_400_000; // 24 jam
})();

let sessionCleanupTimer = null;
function startSessionCleanupScheduler() {
  if (!SESSION_CLEANUP_ENABLED) {
    logger.info({ port: PORT }, 'Session cleanup scheduler dinonaktifkan (env/test server)');
    return;
  }
  sessionCleanupTimer = setInterval(() => {
    cleanupExpiredSessions()
      .catch((err) => logger.warn({ err: err.message }, 'Session cleanup gagal'));
  }, SESSION_CLEANUP_INTERVAL_MS);
  // unref: timer tidak menahan proses shutdown
  sessionCleanupTimer.unref();
  logger.info({ intervalMs: SESSION_CLEANUP_INTERVAL_MS }, 'Session cleanup scheduler aktif (harian)');

  // RUN PERTAMA LANGSUNG di boot: server baru / redeploy tidak perlu menunggu
  // interval 24 jam untuk membersihkan sesi kedaluwarsa yang sudah menumpuk.
  // (Alert scheduler tidak punya ini; untuk cleanup nilainya murah & jelas.)
  cleanupExpiredSessions()
    .then(({ deleted }) => logger.info({ deleted }, 'Session cleanup boot: sesi kedaluwarsa dibersihkan'))
    .catch((err) => logger.warn({ err: err.message }, 'Session cleanup boot gagal'));
}

const server = app.listen(PORT, '0.0.0.0', () => {
  const {
    geminiReady,
    vertexAI,
    primaryModel,
    fallbackModel,
    projectId,
    location,
  } = getVertexState();

  logger.info({
    port: PORT,
    geminiReady,
    primaryModel,
    fallbackModel,
    projectId: projectId || null,
    location,
    allowedOrigins: ALLOWED_ORIGINS,
  }, 'CashFlow AI Proxy berjalan');

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
        logger.info({ model: result.modelUsed }, 'Vertex AI connectivity OK');
      })
      .catch((error) => {
        const classified = classifyVertexError(error);
        logger.warn({ code: classified.code, message: classified.message }, 'Vertex AI connectivity test gagal');

        if (!isProduction()) {
          logger.warn({ detail: error.message }, 'Vertex AI connectivity detail');
        }
      });
  }

  startAlertScheduler();
  startSessionCleanupScheduler();
});

// ===================== Graceful Shutdown (Sprint 1.2) =====================
// SIGTERM/SIGINT: hentikan terima request baru → tutup koneksi SSE + Turso →
// exit 0. Force exit setelah 10s (hindari hang saat drain macet).
function shutdown(signal) {
  logger.info({ signal }, 'Graceful shutdown dimulai');
  if (alertSchedulerTimer) {
    clearInterval(alertSchedulerTimer);
    alertSchedulerTimer = null;
  }
  if (sessionCleanupTimer) {
    clearInterval(sessionCleanupTimer);
    sessionCleanupTimer = null;
  }
  // PENTING: tutup SSE SEBELUM menunggu server.close(). server.close() menunggu
  // seluruh koneksi existing selesai; koneksi SSE (keep-alive) tidak pernah selesai
  // sendiri → tanpa ini callback close tidak akan pernah dipanggil (bug review).
  try {
    closeSSEClients();
  } catch (error) {
    logger.error({ err: error.message }, 'closeSSEClients error');
  }
  server.close(() => {
    logger.info({}, 'HTTP ditutup. Membersihkan Turso...');
    try {
      closeTurso();
    } catch (error) {
      logger.error({ err: error.message }, 'closeTurso error');
    }
    logger.info({}, 'Shutdown bersih selesai');
    process.exit(0);
  });
  setTimeout(() => {
    logger.error({}, 'Graceful shutdown timeout (10s) — force exit');
    process.exit(1);
  }, 10000).unref();
}

process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));
