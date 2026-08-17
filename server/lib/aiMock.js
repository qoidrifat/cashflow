/**
 * AI Mock Boundary (P1.8) — deterministik & offline untuk E2E.
 *
 * BOUNDARY: menggantikan PEMANGGILAN provider eksternal (Vertex AI Gemini) —
 * BUKAN business logic. Aktivasi eksplisit via env `GEMINI_MOCK=1` (bukan
 * default). Fail-fast di produksi (`GEMINI_MOCK=1` + `NODE_ENV=production`
 * → throw): mock TIDAK PERNAH aktif di production.
 *
 * Skenario (`GEMINI_MOCK_SCENARIO`):
 *   success        (default) — fixture JSON valid per feature (schema output
 *                              persis seperti prompt produksi)
 *   empty          — teks kosong → parseGeminiResponse gagal → caller fallback
 *   malformed      — JSON invalid → parse gagal → caller fallback
 *   timeout        — throw VERTEX_TIMEOUT (retryable) → jalur error 504
 *   rate_limited   — throw VERTEX_QUOTA_EXCEEDED (retryable) → jalur error 429
 *   error          — throw VERTEX_UNKNOWN_ERROR → jalur error 500
 *   ocr_uncertain  — receipt decision needs_review + confidence rendah
 *   ocr_failure    — receipt auto_skip (bukan transaksi) → UI "tidak terbaca"
 *
 * TIDAK ada retry/backoff di mock: skenario error harus deterministik & cepat.
 * Retry/fallback model adalah perilaku pipeline REAL (di-test unit lain).
 * Mock juga TIDAK mencatat AI usage/metrics — tidak ada token terpakai.
 *
 * Keamanan (P1.8 §19): mock HANYA mengganti provider; auth & user-scoping
 * tetap jalur aplikasi asli. Tidak ada kredensial; tidak ada panggilan
 * production Gemini dalam CI.
 */
const MOCK_MODEL = 'e2e-gemini-mock';

// Lokal (bukan import dari vertexContext.js — menghindari circular import).
function getErrorMessage(error) {
  if (!error) return '';
  if (typeof error === 'string') return error;
  if (error.message) return String(error.message);
  return String(error);
}

/** Mock aktif? Fail-fast bila diaktifkan di production. */
export function isGeminiMockEnabled() {
  if (process.env.GEMINI_MOCK !== '1') return false;
  if (process.env.NODE_ENV === 'production') {
    throw new Error(
      'GEMINI_MOCK=1 TIDAK diizinkan di production — mock hanya untuk E2E/test. ' +
      'Hapus env GEMINI_MOCK sebelum deploy.',
    );
  }
  return true;
}

/** Assert fail-fast di boot server (dipanggil index.js setelah load env). */
export function assertGeminiMockSafe() {
  if (process.env.GEMINI_MOCK === '1' && process.env.NODE_ENV === 'production') {
    throw new Error(
      'GEMINI_MOCK=1 TIDAK diizinkan di production — mock hanya untuk E2E/test.',
    );
  }
  return process.env.GEMINI_MOCK === '1';
}

export function getMockScenario() {
  return process.env.GEMINI_MOCK_SCENARIO || 'success';
}

// ===================== Fixtures per feature (schema output produksi) =====================

const FIXTURES = {
  // geminiRoutes gmail extraction (buildExtractionPrompt schema)
  gmail_sync: {
    is_transaction: true,
    transaction_type: 'expense',
    amount: 150000,
    currency: 'IDR',
    date: '2026-08-01',
    merchant: 'E2E Mock Merchant',
    category: 'Makanan',
    payment_method: 'qris',
    description: 'Transaksi dari mock Gemini (P1.8)',
    confidence_score: 0.97,
    reason: null,
    decision: 'auto_accept',
  },
  // geminiRoutes receipt OCR (buildReceiptExtractionPrompt schema)
  ocr_receipt: {
    decision: 'auto_accept',
    is_transaction: true,
    transaction_type: 'expense',
    amount: 50000,
    currency: 'IDR',
    date: '2026-08-01',
    merchant: 'E2E Mock Cafe',
    category: 'Makanan',
    payment_method: 'qris',
    note: 'Struk dari mock Gemini (P1.8)',
    confidence_score: 0.95,
    reason: null,
    risk_flags: [],
  },
  // geminiRoutes monthly report (buildMonthlyReportPrompt schema)
  insight_generator: {
    summary: 'Keuangan bulan ini sehat dengan pengeluaran terkendali.',
    cashflowHealth: 'sehat',
    financialHealthScore: 78,
    savingOpportunities: ['Kurangi langganan yang tidak terpakai'],
    unusualSpending: ['Pengeluaran transportasi naik 12%'],
    topRisks: ['Saldo menurun dua bulan berturut-turut'],
    recommendations: ['Tetapkan budget bulanan per kategori'],
    positiveNotes: ['Pemasukan stabil dari gaji'],
  },
  // geminiRoutes advisor (buildAdvisorPrompt schema)
  financial_advisor: {
    summary: 'Kondisi cashflow stabil; prioritaskan dana darurat.',
    spendingAdvice: ['Kurangi makan di luar maksimal 4x per bulan'],
    savingStrategy: ['Auto-transfer 10% gaji ke tabungan darurat'],
    budgetStrategy: ['Naikkan budget Makanan & Minuman 15%'],
    emergencyFund: {
      suggestion: 'Siapkan dana darurat 3 bulan pengeluaran tetap.',
      monthsCoverage: 2.5,
      targetAmount: 9000000,
    },
    subscriptionOptimization: ['Audit langganan bulanan yang jarang dipakai'],
    actionList: [
      { priority: 'high', action: 'Buat auto-transfer dana darurat' },
      { priority: 'medium', action: 'Tinjau ulang langganan streaming' },
    ],
  },
  // conversationRoutes narrative (normalizeConversationNarrative schema)
  conversation: {
    summary: 'Pengeluaran 7 hari terakhir terkendali dan stabil.',
    insights: [
      { title: 'Kategori terbesar', detail: 'Makanan & Minuman 38% dari total.', severity: 'info' },
    ],
    recommendations: [
      {
        title: 'Tetapkan budget',
        action: 'Buat budget bulanan kategori Makanan.',
        href: '/budgets',
        impact: 'Pengeluaran lebih terkontrol.',
      },
    ],
  },
  // fraudDetectionService L2 scoring (buildFraudScoringPrompt schema)
  fraud_detection: {
    fraud_score: 0.1,
    decision: 'allow',
    reasons: [],
    confidence: 0.9,
  },
};

/** Fixture generik untuk feature tak dikenal — JSON valid (parse sukses). */
const FALLBACK_FIXTURE = { summary: 'E2E Gemini mock (P1.8)', ok: true };

export function fixtureFor(feature) {
  return FIXTURES[feature] || FALLBACK_FIXTURE;
}

// ===================== Scenario runners =====================

/** Skenario sukses → teks JSON valid per feature. */
export function mockSuccessText(feature, scenario) {
  const fixture = fixtureFor(feature);
  if (scenario === 'ocr_uncertain' && feature === 'ocr_receipt') {
    return JSON.stringify({
      ...fixture,
      decision: 'needs_review',
      confidence_score: 0.55,
      risk_flags: ['date_inferred'],
      reason: 'Tanggal diinfer dari konteks struk (mock P1.8).',
    });
  }
  if (scenario === 'ocr_failure' && feature === 'ocr_receipt') {
    return JSON.stringify({
      ...fixture,
      decision: 'auto_skip',
      is_transaction: false,
      transaction_type: null,
      amount: null,
      confidence_score: 0.2,
      reason: 'Gambar bukan bukti transaksi (mock P1.8).',
    });
  }
  return JSON.stringify(fixture);
}

/**
 * Jalankan boundary mock — menggantikan generateVertexContent ketika
 * GEMINI_MOCK=1. Mengembalikan kontrak sama seperti pipeline asli:
 *   success → { text, modelUsed, cached:false, mocked:true, response:null }
 *   error   → throw Error ber-message yang bisa di-classify (classifyVertexError)
 */
export function runGeminiMock({ label = 'mock', feature = null }) {
  const scenario = getMockScenario();

  switch (scenario) {
    case 'empty':
      return { text: '', modelUsed: MOCK_MODEL, cached: false, mocked: true, response: null };
    case 'malformed':
      return { text: '{ ini bukan json valid !!!', modelUsed: MOCK_MODEL, cached: false, mocked: true, response: null };
    case 'timeout': {
      const err = new Error(`VERTEX_TIMEOUT: ${label} exceeded mock timeout`);
      err.code = 'VERTEX_TIMEOUT';
      throw err;
    }
    case 'rate_limited': {
      const err = new Error('429 Too Many Requests: Vertex AI quota exceeded (mock P1.8)');
      err.status = 429;
      err.code = 'VERTEX_QUOTA_EXCEEDED';
      throw err;
    }
    case 'error': {
      const err = new Error('E2E mock: Vertex AI provider error (P1.8)');
      err.code = 'VERTEX_UNKNOWN_ERROR';
      throw err;
    }
    case 'ocr_uncertain':
    case 'ocr_failure':
    case 'success':
    default:
      return {
        text: mockSuccessText(feature, scenario),
        modelUsed: MOCK_MODEL,
        cached: false,
        mocked: true,
        response: null,
      };
  }
}

/** Helper untuk test unit: klasifikasi error mock identik dengan pipeline asli. */
export function classifyMockError(error) {
  return { code: error?.code || 'VERTEX_UNKNOWN_ERROR', message: getErrorMessage(error) };
}
