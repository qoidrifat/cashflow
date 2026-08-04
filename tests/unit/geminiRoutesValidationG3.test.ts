/**
 * Unit test: server/routes/geminiRoutes.js — P1-2 Validation Layer (Group G3).
 *
 * Lapisan validasi extract-transaction & monthly-report diuji lewat fake
 * Express app. Kontrak yang dikunci:
 *  - kegagalan validasi TETAP 400 lewat jalur classified error gemini
 *    (sendGeminiError: { success:false, errorCode, userMessage/error, requestId }),
 *    BUKAN bentuk sendValidationError milik CRUD generik.
 *  - errorCode existing dipertahankan (MISSING_EMAIL_TEXT, MISSING_REPORT_DATA).
 *  - payload valid lolos validasi dan melanjutkan pipeline (di sini berhenti di
 *    503 VERTEX_NOT_CONFIGURED karena Vertex AI tidak dikonfigurasi di unit test —
 *    membuktikan validasi tidak memblokir request sah).
 *  - konfigurasi multer extract-receipt-image TIDAK disentuh (sudah hardened).
 */
import { describe, it, expect, beforeAll } from 'vitest';
import { registerGeminiRoutes } from '../../server/routes/geminiRoutes.js';

type Handler = (req: any, res: any, next?: (err?: unknown) => void) => unknown;

interface FakeRes {
  statusCode: number;
  body: any;
  status(code: number): FakeRes;
  json(payload: any): FakeRes;
}

function makeRes(): FakeRes {
  const res: FakeRes = {
    statusCode: 200,
    body: undefined,
    status(code: number) { this.statusCode = code; return this; },
    json(payload: any) { this.body = payload; return this; },
  };
  return res;
}

const routes = new Map<string, Handler[]>();
const fakeApp = {
  get: (path: string, ...fns: Handler[]) => { routes.set(`GET ${path}`, fns); },
  post: (path: string, ...fns: Handler[]) => { routes.set(`POST ${path}`, fns); },
  put: (path: string, ...fns: Handler[]) => { routes.set(`PUT ${path}`, fns); },
};

async function invoke(
  method: string,
  path: string,
  { params = {}, query = {}, body = {}, user = { id: 'user-test' } } = {} as any,
): Promise<FakeRes> {
  const fns = routes.get(`${method} ${path}`);
  if (!fns) throw new Error(`Route tidak terdaftar: ${method} ${path}`);
  const req: any = { params, query, body, user };
  const res = makeRes();
  for (let i = 0; i < fns.length - 1; i++) {
    let nextCalled = false;
    fns[i](req, res, () => { nextCalled = true; });
    if (!nextCalled) return res;
  }
  await fns[fns.length - 1](req, res);
  return res;
}

beforeAll(() => {
  registerGeminiRoutes(fakeApp as any);
});

describe('POST /api/gemini/extract-transaction (G3)', () => {
  it('emailText absen → 400 MISSING_EMAIL_TEXT (bentuk sendGeminiError)', async () => {
    const res = await invoke('POST', '/api/gemini/extract-transaction', { body: {} });
    expect(res.statusCode).toBe(400);
    expect(res.body.success).toBe(false);
    expect(res.body.errorCode).toBe('MISSING_EMAIL_TEXT');
    expect(res.body.userMessage).toBeTruthy();
    expect(res.body.finalStatus).toBe('skipped');
    expect(res.body.requestId).toBeTruthy();
    // kontrak frontend lama: key `error` juga terisi
    expect(res.body.error).toBe(res.body.userMessage);
  });

  it('emailText string kosong → 400 MISSING_EMAIL_TEXT', async () => {
    const res = await invoke('POST', '/api/gemini/extract-transaction', { body: { emailText: '' } });
    expect(res.statusCode).toBe(400);
    expect(res.body.errorCode).toBe('MISSING_EMAIL_TEXT');
  });

  it('emailText melebihi 50.000 karakter → 400 INVALID_EMAIL_TEXT', async () => {
    const res = await invoke('POST', '/api/gemini/extract-transaction', {
      body: { emailText: 'x'.repeat(50_001) },
    });
    expect(res.statusCode).toBe(400);
    expect(res.body.success).toBe(false);
    expect(res.body.errorCode).toBe('INVALID_EMAIL_TEXT');
    expect(res.body.requestId).toBeTruthy();
  });

  it('emailText tepat 50.000 karakter lolos validasi (batas inklusif)', async () => {
    const res = await invoke('POST', '/api/gemini/extract-transaction', {
      body: { emailText: 'x'.repeat(50_000) },
    });
    // Validasi lolos → lanjut pipeline; Vertex tidak dikonfigurasi di unit test.
    expect(res.statusCode).toBe(503);
    expect(res.body.errorCode).toBe('VERTEX_NOT_CONFIGURED');
  });

  it('emailText bukan string → 400 INVALID_EMAIL_TEXT', async () => {
    const res = await invoke('POST', '/api/gemini/extract-transaction', {
      body: { emailText: 12345 },
    });
    expect(res.statusCode).toBe(400);
    expect(res.body.errorCode).toBe('INVALID_EMAIL_TEXT');
  });

  it('payload valid lolos validasi → pipeline Vertex (503 tanpa konfigurasi)', async () => {
    const res = await invoke('POST', '/api/gemini/extract-transaction', {
      body: {
        emailText: 'Pembayaran Rp50.000 ke Toko Kopi berhasil.',
        subject: 'Bukti Pembayaran',
        sender: 'noreply@merchant.com',
        emailDate: '2026-08-01',
      },
    });
    expect(res.statusCode).toBe(503);
    expect(res.body.errorCode).toBe('VERTEX_NOT_CONFIGURED');
  });
});

describe('POST /api/gemini/monthly-report (G3)', () => {
  const validMetrics = { totalIncome: 1_000_000, totalExpense: 500_000 };

  it('month/year/metrics absen → 400 MISSING_REPORT_DATA (bentuk gemini)', async () => {
    const res = await invoke('POST', '/api/gemini/monthly-report', { body: {} });
    expect(res.statusCode).toBe(400);
    expect(res.body.success).toBe(false);
    expect(res.body.errorCode).toBe('MISSING_REPORT_DATA');
    expect(res.body.requestId).toBeTruthy();
    // key `error` tetap ada (kontrak lama caller aiInsightService)
    expect(typeof res.body.error).toBe('string');
  });

  it('month di luar 1-12 → 400 MISSING_REPORT_DATA', async () => {
    for (const month of [0, 13, 1.5]) {
      const res = await invoke('POST', '/api/gemini/monthly-report', {
        body: { month, year: 2026, metrics: validMetrics },
      });
      expect(res.statusCode, String(month)).toBe(400);
      expect(res.body.errorCode).toBe('MISSING_REPORT_DATA');
    }
  });

  it('year di luar rentang wajar → 400', async () => {
    for (const year of [1999, 2101]) {
      const res = await invoke('POST', '/api/gemini/monthly-report', {
        body: { month: 8, year, metrics: validMetrics },
      });
      expect(res.statusCode, String(year)).toBe(400);
      expect(res.body.errorCode).toBe('MISSING_REPORT_DATA');
    }
  });

  it('metrics bukan objek (array/string/absen) → 400', async () => {
    for (const metrics of [[1, 2], 'metrics', undefined]) {
      const res = await invoke('POST', '/api/gemini/monthly-report', {
        body: { month: 8, year: 2026, metrics },
      });
      expect(res.statusCode, JSON.stringify(metrics)).toBe(400);
      expect(res.body.errorCode).toBe('MISSING_REPORT_DATA');
    }
  });

  it('month non-numerik → 400; beberapa error dikumpulkan sekaligus', async () => {
    const res = await invoke('POST', '/api/gemini/monthly-report', {
      body: { month: 'Agustus', year: 'dua ribu', metrics: null },
    });
    expect(res.statusCode).toBe(400);
    // Semua kegagalan dilaporkan dalam satu pesan gabungan
    expect(res.body.error).toContain('month');
    expect(res.body.error).toContain('year');
    expect(res.body.error).toContain('metrics');
  });

  it('payload valid lolos validasi → pipeline Vertex (503 tanpa konfigurasi)', async () => {
    const res = await invoke('POST', '/api/gemini/monthly-report', {
      body: { month: 8, year: 2026, metrics: validMetrics, sampleTransactions: [] },
    });
    expect(res.statusCode).toBe(503);
    expect(res.body.errorCode).toBe('VERTEX_NOT_CONFIGURED');
  });
});
