/**
 * Unit test: server/middleware/errorHandler.js — global error handler.
 *
 * Kontrak yang dikunci (shape kanonik §0 — docs/api/ai-product-api.md):
 *   - 500 default: `{ success:false, ok:false, errorCode:'SERVER_ERROR', code,
 *     userMessage, message, error, requestId, detail?(dev) }`.
 *   - `requestId` SELALU dari `req.id` (requestIdMiddleware) — korelasi error ↔
 *     log/metrics (ADR-010).
 *   - Metadata yang di-mount route dihormati: `err.errorCode` + `err.userMessage`
 *     (conversation → 'CONVERSATION_FAILED' + pesan spesifik).
 *   - `detail` (err.message) HANYA di non-produksi.
 *   - Kasus khusus payload: 413 (LIMIT_FILE_SIZE / entity.too.large) &
 *     400 (INVALID_IMAGE_TYPE) — shape sama + requestId.
 *   - `next()` dipanggil tanpa respons bila `err` falsy.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

// isProduction di-mock agar kontrol detail dev/prod deterministik (tanpa
// memuat modul vertexContext asli yang berat).
const isProductionMock = vi.fn(() => false);
vi.mock('../../server/lib/vertexContext.js', () => ({
  isProduction: (...args: unknown[]) => isProductionMock(...args),
}));

import {
  handleServerError,
  ERROR_CODE_SERVER,
  ERROR_MESSAGE_SERVER,
} from '../../server/middleware/errorHandler.js';

interface FakeRes {
  statusCode: number;
  body: unknown;
  status: ReturnType<typeof vi.fn>;
  json: ReturnType<typeof vi.fn>;
}

function makeRes(): FakeRes {
  const res: FakeRes = { statusCode: 200, body: undefined, status: vi.fn(), json: vi.fn() };
  res.status.mockImplementation((code: number) => { res.statusCode = code; return res; });
  res.json.mockImplementation((body: unknown) => { res.body = body; return res; });
  return res;
}

function invoke(err: unknown, reqId = 'req_x') {
  const res = makeRes();
  const next = vi.fn();
  handleServerError(err as never, { id: reqId } as never, res as never, next as never);
  return { res, next };
}

beforeEach(() => {
  vi.clearAllMocks();
  isProductionMock.mockReturnValue(false);
});

describe('500 default (tanpa metadata route)', () => {
  it('shape §0: success false, error, errorCode SERVER_ERROR, requestId dari req.id', () => {
    const { res } = invoke(new Error('boom'));
    expect(res.statusCode).toBe(500);
    expect(res.body).toMatchObject({
      success: false,
      ok: false,
      errorCode: ERROR_CODE_SERVER,
      code: ERROR_CODE_SERVER,
      userMessage: ERROR_MESSAGE_SERVER,
      message: ERROR_MESSAGE_SERVER,
      error: ERROR_MESSAGE_SERVER,
      requestId: 'req_x',
    });
  });

  it('detail berisi err.message di non-produksi', () => {
    const { res } = invoke(new Error('boom'));
    expect((res.body as { detail: string }).detail).toBe('boom');
  });

  it('produksi → detail dihilangkan (tidak bocorkan internal)', () => {
    isProductionMock.mockReturnValue(true);
    const { res } = invoke(new Error('boom'));
    expect((res.body as { detail?: string }).detail).toBeUndefined();
  });
});

describe('metadata yang di-mount route dihormati (conversation)', () => {
  it('errorCode + userMessage route dipakai; requestId tetap dari req.id', () => {
    const err = new Error('db down');
    (err as { errorCode?: string }).errorCode = 'CONVERSATION_FAILED';
    (err as { userMessage?: string }).userMessage = 'Gagal menganalisis percakapan. Coba lagi sebentar.';
    const { res } = invoke(err, 'req_conv_9');
    expect(res.statusCode).toBe(500);
    expect(res.body).toMatchObject({
      errorCode: 'CONVERSATION_FAILED',
      code: 'CONVERSATION_FAILED',
      userMessage: 'Gagal menganalisis percakapan. Coba lagi sebentar.',
      message: 'Gagal menganalisis percakapan. Coba lagi sebentar.',
      error: 'Gagal menganalisis percakapan. Coba lagi sebentar.',
      requestId: 'req_conv_9',
    });
  });
});

describe('kasus khusus payload', () => {
  it('LIMIT_FILE_SIZE → 413 PAYLOAD_TOO_LARGE + requestId', () => {
    const err = new Error('gambar 20MB');
    (err as { code?: string }).code = 'LIMIT_FILE_SIZE';
    const { res } = invoke(err, 'req_big');
    expect(res.statusCode).toBe(413);
    expect(res.body).toMatchObject({ errorCode: 'PAYLOAD_TOO_LARGE', requestId: 'req_big' });
  });

  it('entity.too.large (body-parser) → 413', () => {
    const err = new Error('request entity too large');
    (err as { type?: string }).type = 'entity.too.large';
    const { res } = invoke(err);
    expect(res.statusCode).toBe(413);
    expect((res.body as { errorCode: string }).errorCode).toBe('PAYLOAD_TOO_LARGE');
  });

  it('File harus berupa gambar → 400 INVALID_IMAGE_TYPE', () => {
    const { res } = invoke(new Error('File harus berupa gambar'));
    expect(res.statusCode).toBe(400);
    expect((res.body as { errorCode: string }).errorCode).toBe('INVALID_IMAGE_TYPE');
  });
});

describe('tanpa error', () => {
  it('next() dipanggil tanpa menulis respons', () => {
    const { res, next } = invoke(undefined);
    expect(next).toHaveBeenCalledTimes(1);
    expect(res.json).not.toHaveBeenCalled();
  });
});
