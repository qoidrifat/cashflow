/**
 * Global Error Handler (Sprint 2 — OBSERVABILITY_REVIEW; ekstraksi dari index.js).
 *
 * Satu-satunya tempat respons error tak terduga (route memanggil `next(err)`).
 * Shape kanonik §0 (docs/api/ai-product-api.md):
 *
 *   { success: false, ok: false, errorCode, code, error, message, userMessage,
 *     requestId, ...(dev ? { detail } : {}) }
 *
 * - `errorCode` default SERVER_ERROR; route boleh me-mount `err.errorCode`
 *   (mis. conversation → 'CONVERSATION_FAILED') dan `err.userMessage` spesifik.
 * - `requestId` SELALU diambil dari `req.id` (requestIdMiddleware) → klien bisa
 *   mengorelasikan error dengan log/metrics (ADR-010).
 * - `detail` hanya di non-produksi (jangan bocorkan internal ke produksi).
 * - Kasus khusus payload: 413 (multer/body-parser) & 400 (tipe file) — shape
 *   sama + requestId, dipertahankan dari perilaku lama index.js.
 */
import { isProduction } from '../lib/vertexContext.js';

export const ERROR_CODE_SERVER = 'SERVER_ERROR';
export const ERROR_MESSAGE_SERVER = 'Terjadi error teknis di server AI.';

/** Bentuk JSON untuk 413/400 kasus khusus (payload/tipe file). */
function payloadError(res, req, status, errorCode, message) {
  return res.status(status).json({
    success: false,
    ok: false,
    errorCode,
    code: errorCode,
    userMessage: message,
    message,
    error: message,
    requestId: req.id,
  });
}

/**
 * Express error middleware — pasang TERAKHIR setelah semua route.
 *
 * @param {Error & { code?: string; type?: string; errorCode?: string; userMessage?: string }} err
 * @param {import('express').Request} req
 * @param {import('express').Response} res
 * @param {import('express').NextFunction} next
 */
export function handleServerError(err, req, res, next) {
  if (!err) {
    next();
    return;
  }

  if (err.code === 'LIMIT_FILE_SIZE' || err.type === 'entity.too.large') {
    return payloadError(
      res, req, 413, 'PAYLOAD_TOO_LARGE',
      'Gambar terlalu besar untuk diproses. Kompres gambar atau upload file yang lebih kecil.',
    );
  }

  if (err.message?.includes('File harus berupa gambar')) {
    return payloadError(res, req, 400, 'INVALID_IMAGE_TYPE', err.message);
  }

  const errorCode = err.errorCode || ERROR_CODE_SERVER;
  const userMessage = err.userMessage || ERROR_MESSAGE_SERVER;

  return res.status(500).json({
    success: false,
    ok: false,
    errorCode,
    code: errorCode,
    userMessage,
    message: userMessage,
    error: userMessage,
    // req.id (requestIdMiddleware) adalah sumber kanonik; err.requestId
    // dihormati bila route menyerahkan id berbeda (defense-in-depth).
    requestId: req.id || err.requestId,
    ...(!isProduction() ? { detail: err.message } : {}),
  });
}
