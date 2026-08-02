/**
 * Gemini / AI Routes — CashFlow AI Proxy (P4.14 ekstraksi dari index.js)
 *
 * Endpoints:
 *   POST /api/ai/extract-receipt-image   — OCR bukti transaksi (multipart)
 *   POST /api/gemini/extract-transaction — ekstrak transaksi dari email
 *   POST /api/gemini/monthly-report      — insight laporan bulanan
 *   GET  /api/gemini/health              — health check Vertex AI
 *
 * Semua state & helper diimpor dari lib/vertexContext.js (satu sumber).
 */
import fs from 'node:fs';
import multer from 'multer';
import metricsService from '../services/metricsService.js';
import { logger } from '../lib/logger.js';
import {
  getVertexState,
  isProduction,
  buildExtractionPrompt,
  buildReceiptExtractionPrompt,
  buildMonthlyReportPrompt,
  parseGeminiResponse,
  normalizeReceiptResult,
  generateGeminiText,
  generateGeminiVision,
  generateVertexContent,
  createRequestId,
  classifyVertexError,
  sendGeminiError,
} from '../lib/vertexContext.js';

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

export function registerGeminiRoutes(app) {
  // ===================== Routes: Receipt Scan =====================

  app.post('/api/ai/extract-receipt-image', receiptImageUpload.single('image'), async (req, res) => {
    const { geminiReady, vertexAI, primaryModel } = getVertexState();
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

      logger.info({
        requestId,
        fileSize: estimatedBytes,
        mimeType: safeMimeType,
        model: primaryModel,
        provider: 'vertex-ai',
      }, 'receipt-ai request received');

      const generated = await generateGeminiVision(prompt, {
        mimeType: safeMimeType,
        data: imageBase64,
      }, {
        feature: 'ocr_receipt',
        userId: req.user?.id || null,
        metricMeta: { mimeType: safeMimeType, sizeBytes: estimatedBytes, requestId: req.id || requestId },
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

      logger.error({
        requestId,
        code: classified.code,
        message: error.message,
      }, 'Receipt image extraction error');

      return res.status(classified.httpStatus).json({
        success: false,
        errorCode: classified.code,
        userMessage: classified.message,
        retryable: classified.retryable,
        requestId,
        ...(!isProduction() ? { detail: error.message } : {}),
      });
    }
  });

  // ===================== Routes: Email Extraction =====================

  app.post('/api/gemini/extract-transaction', async (req, res) => {
    const { geminiReady, vertexAI } = getVertexState();
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

      const generated = await generateGeminiText(prompt, {
        feature: 'gmail_sync',
        userId: req.user?.id || null,
        metricMeta: { requestId: req.id || requestId },
      });
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

      logger.error({
        requestId,
        code: classified.code,
        message: error.message,
      }, 'Vertex AI Gemini email extraction error');

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
    const { geminiReady, vertexAI } = getVertexState();
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

      const generated = await generateGeminiText(prompt, {
        feature: 'insight_generator',
        userId: req.user?.id || null,
        metricMeta: { requestId: req.id || requestId },
      });
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

      logger.error({
        requestId,
        code: classified.code,
        message: error.message,
      }, 'Vertex AI monthly report error');

      return res.status(classified.httpStatus).json({
        success: false,
        error: classified.message,
        errorCode: classified.code,
        retryable: classified.retryable,
        requestId,
        ...(!isProduction() ? { detail: error.message } : {}),
      });
    }
  });

  // ===================== Routes: Gemini / Vertex Health =====================

  app.get('/api/gemini/health', async (_req, res) => {
    const {
      geminiReady,
      vertexAI,
      primaryModel,
      fallbackModel,
      projectId,
      location,
      rawCredentials,
      credentialsAbs,
    } = getVertexState();

    if (!projectId) {
      return res.status(503).json({
        ok: false,
        status: 'unconfigured',
        message: 'GOOGLE_CLOUD_PROJECT / GCP_PROJECT_ID belum diisi di server/.env.',
        provider: 'vertex-ai',
        model: primaryModel,
        projectId: null,
        location,
        credentialExists: fs.existsSync(credentialsAbs),
        sdkVersion: '@google/genai',
      });
    }

    if (!rawCredentials) {
      return res.status(503).json({
        ok: false,
        status: 'unconfigured',
        message: 'GOOGLE_APPLICATION_CREDENTIALS belum diisi di server/.env.',
        provider: 'vertex-ai',
        model: primaryModel,
        projectId,
        location,
        credentialExists: false,
        sdkVersion: '@google/genai',
      });
    }

    if (!fs.existsSync(credentialsAbs)) {
      return res.status(503).json({
        ok: false,
        status: 'credential_missing',
        message: 'File service account tidak ditemukan.',
        provider: 'vertex-ai',
        model: primaryModel,
        projectId,
        location,
        credentialPath: rawCredentials,
        absoluteCredentialPath: credentialsAbs,
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
        model: primaryModel,
        projectId,
        location,
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
          primaryModel,
          fallbackModel,
          projectId,
          location,
          credentialPath: rawCredentials,
          absoluteCredentialPath: credentialsAbs,
          credentialExists: true,
          sdkVersion: '@google/genai',
        });
      }

      return res.status(503).json({
        ok: false,
        status: 'empty_response',
        message: 'Vertex AI Gemini merespons kosong pada health check.',
        provider: 'vertex-ai',
        model: primaryModel,
        projectId,
        location,
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
        model: primaryModel,
        projectId,
        location,
        credentialPath: rawCredentials,
        absoluteCredentialPath: credentialsAbs,
        credentialExists: fs.existsSync(credentialsAbs),
        sdkVersion: '@google/genai',
        errorCode: classified.code,
        retryable: classified.retryable,
        ...(!isProduction() ? { detail: error.message } : {}),
      });
    }
  });
}
