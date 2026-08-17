/**
 * Unit test: server/lib/aiMock.js + boundary generateVertexContent (P1.8).
 *
 * Kontrak yang di-lock:
 *   - GEMINI_MOCK tidak diset → mock NONAKTIF (perilaku production normal)
 *   - GEMINI_MOCK=1 → mock AKTIF (deterministik, tanpa kredensial Vertex)
 *   - GEMINI_MOCK=1 + NODE_ENV=production → THROW (fail-fast, mock tidak
 *     pernah aktif di produksi)
 *   - skenario success → teks JSON valid per feature (schema output produksi)
 *   - skenario empty/malformed → teks yang membuat parser gagal (caller fallback)
 *   - skenario timeout/rate_limited/error → throw yang ter-classify dengan
 *     benar (VERTEX_TIMEOUT / VERTEX_QUOTA_EXCEEDED / VERTEX_UNKNOWN_ERROR)
 *   - skenario ocr_uncertain / ocr_failure → fixture receipt needs_review /
 *     auto_skip
 *   - integrasi: generateGeminiText dengan mock aktif mengembalikan teks mock
 *     (mocked:true); tanpa mock → VERTEX_NOT_CONFIGURED (tidak berubah)
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import {
  isGeminiMockEnabled,
  getMockScenario,
  runGeminiMock,
  mockSuccessText,
  fixtureFor,
} from '../../server/lib/aiMock.js';
import {
  generateGeminiText,
  generateGeminiVision,
  classifyVertexError,
  parseGeminiResponse,
} from '../../server/lib/vertexContext.js';

const ORIG_ENV = { ...process.env };

function setEnv(overrides: Record<string, string | undefined>) {
  for (const [k, v] of Object.entries(overrides)) {
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
}

beforeEach(() => {
  process.env = { ...ORIG_ENV };
  delete process.env.GEMINI_MOCK;
  delete process.env.GEMINI_MOCK_SCENARIO;
  delete process.env.NODE_ENV;
});

afterEach(() => {
  process.env = { ...ORIG_ENV };
});

describe('isGeminiMockEnabled — env gating & fail-fast produksi', () => {
  it('GEMINI_MOCK tidak diset → mock NONAKTIF (false)', () => {
    expect(isGeminiMockEnabled()).toBe(false);
  });

  it('GEMINI_MOCK=1 → mock AKTIF (true)', () => {
    setEnv({ GEMINI_MOCK: '1' });
    expect(isGeminiMockEnabled()).toBe(true);
  });

  it('GEMINI_MOCK=1 + NODE_ENV=production → THROW (fail-fast)', () => {
    setEnv({ GEMINI_MOCK: '1', NODE_ENV: 'production' });
    expect(() => isGeminiMockEnabled()).toThrow(/GEMINI_MOCK/);
  });

  it('GEMINI_MOCK=1 + NODE_ENV=development → aman (true)', () => {
    setEnv({ GEMINI_MOCK: '1', NODE_ENV: 'development' });
    expect(isGeminiMockEnabled()).toBe(true);
  });
});

describe('runGeminiMock — skenario sukses per feature (schema produksi)', () => {
  it('default scenario success → teks JSON valid per feature', () => {
    for (const feature of ['gmail_sync', 'ocr_receipt', 'insight_generator', 'financial_advisor', 'conversation', 'fraud_detection', 'unknown_feature']) {
      const result = runGeminiMock({ feature });
      expect(result.mocked).toBe(true);
      expect(result.modelUsed).toBe('e2e-gemini-mock');
      const parsed = parseGeminiResponse(result.text);
      expect(parsed.success, `fixture ${feature} harus parse JSON`).toBe(true);
    }
  });

  it('gmail_sync → schema ekstraksi valid (auto_accept + amount)', () => {
    const parsed = parseGeminiResponse(runGeminiMock({ feature: 'gmail_sync' }).text);
    expect(parsed.data.is_transaction).toBe(true);
    expect(parsed.data.decision).toBe('auto_accept');
    expect(typeof parsed.data.amount).toBe('number');
  });

  it('ocr_receipt → schema receipt valid (risk_flags array)', () => {
    const parsed = parseGeminiResponse(runGeminiMock({ feature: 'ocr_receipt' }).text);
    expect(parsed.data.decision).toBe('auto_accept');
    expect(Array.isArray(parsed.data.risk_flags)).toBe(true);
  });

  it('conversation → schema narrative valid (summary/insights/recommendations)', () => {
    const parsed = parseGeminiResponse(runGeminiMock({ feature: 'conversation' }).text);
    expect(typeof parsed.data.summary).toBe('string');
    expect(Array.isArray(parsed.data.insights)).toBe(true);
    expect(Array.isArray(parsed.data.recommendations)).toBe(true);
  });

  it('feature tak dikenal → fallback fixture JSON valid (tidak crash)', () => {
    const result = runGeminiMock({ feature: 'fitur-baru-belum-dikenal' });
    const parsed = parseGeminiResponse(result.text);
    expect(parsed.success).toBe(true);
  });
});

describe('runGeminiMock — skenario error/empty (deterministik & cepat)', () => {
  it('scenario empty → teks kosong (parser gagal → caller fallback)', () => {
    setEnv({ GEMINI_MOCK_SCENARIO: 'empty' });
    expect(runGeminiMock({ feature: 'gmail_sync' }).text).toBe('');
  });

  it('scenario malformed → JSON invalid (parser gagal → caller fallback)', () => {
    setEnv({ GEMINI_MOCK_SCENARIO: 'malformed' });
    const parsed = parseGeminiResponse(runGeminiMock({ feature: 'gmail_sync' }).text);
    expect(parsed.success).toBe(false);
  });

  it('scenario timeout → throw yang ter-classify VERTEX_TIMEOUT (504, retryable)', () => {
    setEnv({ GEMINI_MOCK_SCENARIO: 'timeout' });
    try {
      runGeminiMock({ feature: 'gmail_sync' });
      expect.unreachable('harus throw');
    } catch (err) {
      const cls = classifyVertexError(err);
      expect(cls.code).toBe('VERTEX_TIMEOUT');
      expect(cls.httpStatus).toBe(504);
      expect(cls.retryable).toBe(true);
    }
  });

  it('scenario rate_limited → throw yang ter-classify VERTEX_QUOTA_EXCEEDED (429, retryable)', () => {
    setEnv({ GEMINI_MOCK_SCENARIO: 'rate_limited' });
    try {
      runGeminiMock({ feature: 'gmail_sync' });
      expect.unreachable('harus throw');
    } catch (err) {
      const cls = classifyVertexError(err);
      expect(cls.code).toBe('VERTEX_QUOTA_EXCEEDED');
      expect(cls.httpStatus).toBe(429);
      expect(cls.retryable).toBe(true);
    }
  });

  it('scenario error → throw yang ter-classify VERTEX_UNKNOWN_ERROR (500)', () => {
    setEnv({ GEMINI_MOCK_SCENARIO: 'error' });
    try {
      runGeminiMock({ feature: 'gmail_sync' });
      expect.unreachable('harus throw');
    } catch (err) {
      const cls = classifyVertexError(err);
      expect(cls.code).toBe('VERTEX_UNKNOWN_ERROR');
      expect(cls.httpStatus).toBe(500);
    }
  });

  it('scenario ocr_uncertain → receipt needs_review + confidence rendah', () => {
    setEnv({ GEMINI_MOCK_SCENARIO: 'ocr_uncertain' });
    const parsed = parseGeminiResponse(runGeminiMock({ feature: 'ocr_receipt' }).text);
    expect(parsed.data.decision).toBe('needs_review');
    expect(parsed.data.confidence_score).toBeLessThan(0.9);
  });

  it('scenario ocr_failure → receipt auto_skip (bukan transaksi)', () => {
    setEnv({ GEMINI_MOCK_SCENARIO: 'ocr_failure' });
    const parsed = parseGeminiResponse(runGeminiMock({ feature: 'ocr_receipt' }).text);
    expect(parsed.data.decision).toBe('auto_skip');
    expect(parsed.data.is_transaction).toBe(false);
  });

  it('scenario ocr_* pada feature NON-receipt → tetap fixture sukses feature tsb', () => {
    setEnv({ GEMINI_MOCK_SCENARIO: 'ocr_failure' });
    const parsed = parseGeminiResponse(runGeminiMock({ feature: 'gmail_sync' }).text);
    expect(parsed.data.decision).toBe('auto_accept');
  });
});

describe('Integrasi generateVertexContent — mock boundary', () => {
  it('GEMINI_MOCK=1 → generateGeminiText mengembalikan teks mock TANPA kredensial Vertex', async () => {
    setEnv({ GEMINI_MOCK: '1' });
    const result = await generateGeminiText('prompt apa pun', { feature: 'gmail_sync' });
    expect(result.mocked).toBe(true);
    expect(result.modelUsed).toBe('e2e-gemini-mock');
    const parsed = parseGeminiResponse(result.text);
    expect(parsed.success).toBe(true);
  });

  it('GEMINI_MOCK=1 → generateGeminiVision juga ter-mock (OCR deterministik)', async () => {
    setEnv({ GEMINI_MOCK: '1' });
    const result = await generateGeminiVision('prompt', { mimeType: 'image/png', data: 'x' }, { feature: 'ocr_receipt' });
    const parsed = parseGeminiResponse(result.text);
    expect(parsed.data.decision).toBe('auto_accept');
  });

  it('tanpa GEMINI_MOCK → perilaku asli (VERTEX_NOT_CONFIGURED, tidak berubah)', async () => {
    setEnv({ NODE_ENV: 'development' }); // state vertex tidak di-configure di test
    await expect(generateGeminiText('prompt', { feature: 'gmail_sync' })).rejects.toMatchObject({
      code: 'VERTEX_NOT_CONFIGURED',
    });
  });
});

describe('helper fixtures — determinisme', () => {
  it('fixtureFor mengembalikan objek stabil (deep equal antar panggilan)', () => {
    expect(fixtureFor('gmail_sync')).toEqual(fixtureFor('gmail_sync'));
  });

  it('mockSuccessText sukses untuk tiap feature adalah JSON.stringify dari fixture', () => {
    for (const feature of ['gmail_sync', 'conversation', 'fraud_detection']) {
      expect(mockSuccessText(feature, 'success')).toBe(JSON.stringify(fixtureFor(feature)));
    }
  });

  it('getMockScenario default → success', () => {
    expect(getMockScenario()).toBe('success');
  });
});
