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

import path from 'node:path';
import dotenv from 'dotenv';
dotenv.config({ path: path.resolve(process.cwd(), 'server', '.env') });
dotenv.config({ path: path.resolve(process.cwd(), '.env.local') });
dotenv.config();

import express from 'express';
import cors from 'cors';
import cookieParser from 'cookie-parser';
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
import { registerGeminiRoutes } from './routes/geminiRoutes.js';
import { registerAgentSearchRoutes } from './routes/agentSearchRoutes.js';
import { registerAdminMetricsRoutes } from './routes/adminMetricsRoutes.js';
import { registerHealthRoutes } from './routes/healthRoutes.js';
import { getTurso } from './lib/turso.js';
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
registerGeminiRoutes(app);
registerAgentSearchRoutes(app);
registerAdminMetricsRoutes(app);
registerHealthRoutes(app);

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
    ...(!isProduction() ? { detail: err.message } : {}),
  });
});

// ===================== Start Server =====================

app.listen(PORT, '0.0.0.0', () => {
  const {
    geminiReady,
    vertexAI,
    primaryModel,
    fallbackModel,
    projectId,
    location,
  } = getVertexState();

  console.log(`[Server] CashFlow AI Proxy berjalan di port ${PORT}`);
  console.log(`[Server] Provider: Vertex AI`);
  console.log(`[Server] Gemini: ${geminiReady ? '✅ Siap' : '❌ Belum dikonfigurasi'}`);
  console.log(`[Server] Model utama: ${primaryModel}`);
  console.log(`[Server] Model fallback: ${fallbackModel}`);
  console.log(`[Server] Project: ${projectId || '-'}`);
  console.log(`[Server] Location: ${location}`);
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

        if (!isProduction()) {
          console.warn(`[Server] ⚠️  Detail: ${error.message}`);
        }
      });
  }
});
