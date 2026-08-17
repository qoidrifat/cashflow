/**
 * AI Quality Benchmark — LIVE integration mode (Gemini nyata).
 *
 * Menjalankan subset kasus (fixtures bagian 7) terhadap Vertex AI Gemini yang
 * sungguh-sungguh — membuktikan bahwa prompt builders + parser produksi bekerja
 * end-to-end dengan model nyata (bukan hanya fallback/lokal deterministik).
 *
 * SKIP secara default (CI aman — tidak butuh credentials/network/biaya).
 * Aktifkan dengan:
 *   npm run benchmark:ai:live          (set BENCH_LIVE=1) ← trigger resmi
 *   BENCH_LIVE=1 npx vitest run tests/benchmark/aiLiveBenchmark.spec.ts
 *
 * Catatan: `vitest ... --live` TIDAK didukung (vitest menolak flag tak dikenal);
 * `--live` di argv hanya fallback harmless.
 *
 * Requirements (server/.env):
 *   GOOGLE_CLOUD_PROJECT | GCP_PROJECT_ID, GCP_LOCATION,
 *   GEMINI_PRIMARY_MODEL, GEMINI_FALLBACK_MODEL,
 *   GOOGLE_APPLICATION_CREDENTIALS (service account JSON + file ada).
 *
 * Hasil ditulis ke docs/ai/benchmark-live-results.json (ber-timestamp,
 * non-deterministik → TIDAK di-commit; sudah di-.gitignore).
 */
import { describe, expect, it, beforeAll } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

import {
  configureVertexAI,
  initGemini,
  generateGeminiText,
  generateGeminiVision,
  parseGeminiResponse,
  normalizeReceiptResult,
  buildExtractionPrompt,
  buildReceiptExtractionPrompt,
  buildMonthlyReportPrompt,
  buildAdvisorPrompt,
} from '../../server/lib/vertexContext.js';
import { evaluateFraudRules } from '../../server/lib/fraudEngine.js';
import { buildFraudScoringPrompt } from '../../server/services/fraudDetectionService.js';
import { buildFallbackMonthlyReport } from '../../src/services/aiInsightService';
import { computeAdvisorMetrics } from '../../src/services/advisorService';
import {
  LIVE_FRAUD,
  LIVE_GMAIL,
  LIVE_INSIGHT,
  LIVE_ADVISOR,
  LIVE_RECEIPT,
} from './fixtures';
import {
  loadFeedbackPriorities,
  selectLiveCategory,
  type LiveCategorySelection,
} from './liveFeedbackSelection';

const LIVE = process.env.BENCH_LIVE === '1' || process.argv.includes('--live');
const RESULTS_FILE = path.resolve(process.cwd(), 'docs', 'ai', 'benchmark-live-results.json');

/**
 * Seleksi kategori live berbasis feedback NYATA (docs/ai/feedback-prompt-priorities.json,
 * ditulis oleh scripts/feedbackPromptPriorities.mjs). Bila snapshot ada & topPriority
 * punya live category → HANYA kategori itu yang dijalankan (fokus biaya AI ke fitur
 * yang paling dikeluhkan user). Set BENCH_LIVE_ALL=1 untuk memaksa full run.
 */
const FEEDBACK_PRIORITIES_FILE = path.resolve(process.cwd(), 'docs', 'ai', 'feedback-prompt-priorities.json');
const FORCE_ALL = process.env.BENCH_LIVE_ALL === '1';
const loadedPriorities = FORCE_ALL ? null : loadFeedbackPriorities(FEEDBACK_PRIORITIES_FILE);
const liveSelection: LiveCategorySelection | null = FORCE_ALL ? null : selectLiveCategory(loadedPriorities);

const FRAUD_DECISIONS = ['allow', 'review', 'block'];
const HEALTH_VALUES = ['sehat', 'stabil', 'waspada', 'kritis'];

/** Parse server/.env secara manual (tanpa dependency) — set process.env bila kosong. */
function loadServerEnv() {
  const envPath = path.resolve(process.cwd(), 'server', '.env');
  if (!fs.existsSync(envPath)) return;
  for (const line of fs.readFileSync(envPath, 'utf8').split(/\r?\n/)) {
    const t = line.trim();
    if (!t || t.startsWith('#')) continue;
    const eq = t.indexOf('=');
    if (eq <= 0) continue;
    const key = t.slice(0, eq).trim();
    let value = t.slice(eq + 1).trim();
    if (value.length >= 2 && ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'")))) {
      value = value.slice(1, -1);
    }
    if (!process.env[key]) process.env[key] = value;
  }
}

describe.skipIf(!LIVE)('AI Quality Benchmark — LIVE Gemini integration (--live)', () => {
  let initError: string | null = null;

  beforeAll(() => {
    if (liveSelection) {
      // eslint-disable-next-line no-console
      console.log(
        `\n🎯 FEEDBACK-DRIVEN: hanya menjalankan kategori "${liveSelection.category}" ` +
          `(feature=${liveSelection.feature}, skor=${liveSelection.priorityScore}, ` +
          `${liveSelection.total} feedback, alasan=${liveSelection.reason}). ` +
          'Set BENCH_LIVE_ALL=1 untuk semua kategori.',
      );
    } else if (FORCE_ALL) {
      // eslint-disable-next-line no-console
      console.log('\n🎯 BENCH_LIVE_ALL=1 — full run (feedback selection dilewati).');
    } else if (loadedPriorities) {
      // eslint-disable-next-line no-console
      console.log(
        '\n🎯 Snapshot feedback ada tapi tidak ada fitur dengan skor > 0 yang bisa ' +
          'dipetakan (semua feedback non-negatif / tanpa live category) — full run semua kategori.',
      );
    } else {
      // eslint-disable-next-line no-console
      console.log('\n🎯 Tidak ada snapshot feedback (kosong/hilang) — full run semua kategori.');
    }
    // Hasil live = snapshot sekali jalan: truncate file lama agar tidak menumpuk
    // antar run (append antar test di dalam run ini tetap berlaku).
    if (fs.existsSync(RESULTS_FILE)) {
      fs.rmSync(RESULTS_FILE, { force: true });
    }
    loadServerEnv();
    const projectId = process.env.GOOGLE_CLOUD_PROJECT || process.env.GCP_PROJECT_ID;
    const rawCredentials = process.env.GOOGLE_APPLICATION_CREDENTIALS || '';
    const credentialsAbs = path.resolve(process.cwd(), 'server', rawCredentials.replace(/^\.\//, ''));

    if (!projectId) {
      initError = 'GOOGLE_CLOUD_PROJECT / GCP_PROJECT_ID tidak ada di server/.env';
      return;
    }
    if (!rawCredentials) {
      initError = 'GOOGLE_APPLICATION_CREDENTIALS tidak ada di server/.env (butuh service account JSON)';
      return;
    }
    if (!fs.existsSync(credentialsAbs)) {
      initError = `Service account tidak ditemukan: ${credentialsAbs}`;
      return;
    }

    // GoogleGenAI (mode Vertex) membaca ADC via env var ini saat konstruksi.
    process.env.GOOGLE_APPLICATION_CREDENTIALS = credentialsAbs;
    configureVertexAI({
      primaryModel: process.env.GEMINI_PRIMARY_MODEL || '',
      fallbackModel: process.env.GEMINI_FALLBACK_MODEL || '',
      projectId,
      location: process.env.GCP_LOCATION || 'us-central1',
      rawCredentials,
      credentialsAbs,
      nodeEnv: 'test',
    });
    if (!initGemini()) {
      initError = 'initGemini() gagal — cek model/project/credentials di server/.env';
    }
  });

  /** Jalankan satu panggilan Gemini; catat latency, token, error. */
  async function callGemini(prompt: string, feature: string) {
    const startedAt = performance.now();
    try {
      const result = await generateGeminiText(prompt, { feature, cacheTtlMs: 0 });
      const usage = result.response?.usageMetadata || {};
      return {
        ok: true,
        latencyMs: Math.round(performance.now() - startedAt),
        promptTokens: usage.promptTokenCount ?? 0,
        completionTokens: usage.candidatesTokenCount ?? 0,
        text: result.text,
        model: result.modelUsed,
      };
    } catch (error) {
      return {
        ok: false,
        latencyMs: Math.round(performance.now() - startedAt),
        promptTokens: 0,
        completionTokens: 0,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }

  /** Vision (OCR struk): gambar PNG base64 + prompt receipt → text + metrik. */
  async function callGeminiVision(prompt: string, mimeType: string, data: string) {
    const startedAt = performance.now();
    try {
      const result = await generateGeminiVision(
        prompt,
        { mimeType, data },
        { feature: 'ocr_receipt', cacheTtlMs: 0 },
      );
      const usage = result.response?.usageMetadata || {};
      return {
        ok: true,
        latencyMs: Math.round(performance.now() - startedAt),
        promptTokens: usage.promptTokenCount ?? 0,
        completionTokens: usage.candidatesTokenCount ?? 0,
        text: result.text,
        model: result.modelUsed,
      };
    } catch (error) {
      return {
        ok: false,
        latencyMs: Math.round(performance.now() - startedAt),
        promptTokens: 0,
        completionTokens: 0,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }

  it.skipIf(!!liveSelection && liveSelection.category !== 'fraud_l2_live')('fraud L2 — AI risk scoring setuju dengan rule engine L1', async () => {
    if (initError) throw new Error(initError);
    const rows: unknown[] = [];
    let agree = 0; let parsed = 0; let totalTokens = 0;

    for (const c of LIVE_FRAUD) {
      const flags = evaluateFraudRules({ transaction: c.tx, aggregates: c.ag });
      const prompt = buildFraudScoringPrompt({ transaction: c.tx, flags, aggregates: c.ag });
      const res = await callGemini(prompt, 'fraud_detection');
      totalTokens += res.promptTokens + res.completionTokens;

      let schemaOk = false; let agreeOk = false; let detail: string | null = null;
      if (res.ok) {
        const parsedRes = parseGeminiResponse(res.text);
        if (parsedRes.success && parsedRes.data) {
          const d = parsedRes.data;
          const score = Number(d.fraud_score);
          const decision = d.decision;
          schemaOk = Number.isFinite(score) && score >= 0 && score <= 1
            && FRAUD_DECISIONS.includes(decision)
            && Array.isArray(d.reasons);
          // Agree L2 vs L1: ada flag L1 → jangan 'allow'; bersih → 'allow'.
          agreeOk = c.exp.length > 0 ? decision !== 'allow' : decision === 'allow';
          if (schemaOk) parsed += 1;
          if (schemaOk && agreeOk) agree += 1;
          detail = schemaOk
            ? `score=${score} decision=${decision} reasons=${(d.reasons || []).length}`
            : `schema invalid: ${JSON.stringify(d).slice(0, 120)}`;
        } else {
          detail = `unparseable: ${res.text.slice(0, 120)}`;
        }
      } else {
        detail = `error: ${res.error}`;
      }
      rows.push({ name: c.name, ok: res.ok && schemaOk && agreeOk, flags: c.exp, latencyMs: res.latencyMs, detail });
      // eslint-disable-next-line no-console
      console.log(`  fraud  ${res.ok && schemaOk && agreeOk ? 'PASS' : 'FAIL'} ${c.name} → ${detail}`);
    }

    fs.mkdirSync(path.dirname(RESULTS_FILE), { recursive: true });
    const report = {
      category: 'fraud_l2_live', cases: LIVE_FRAUD.length,
      parseRate: parsed / LIVE_FRAUD.length,
      agreeRate: agree / LIVE_FRAUD.length,
      totalTokens,
      rows,
    };
    appendLiveResult(report);

    // Floor lunak: mayoritas ter-parse & ≥1 case pass (live flaky — bukan gate CI).
    expect(parsed / LIVE_FRAUD.length).toBeGreaterThanOrEqual(0.5);
    expect(agree).toBeGreaterThanOrEqual(1);
  }, 180_000);

  it.skipIf(!!liveSelection && liveSelection.category !== 'gmail_extraction_live')('gmail extraction — decision & amount cocok dengan ground truth', async () => {
    if (initError) throw new Error(initError);
    const rows: unknown[] = [];
    let passed = 0; let totalTokens = 0;

    for (const c of LIVE_GMAIL) {
      const prompt = buildExtractionPrompt(c.email.body, c.email.subject, c.email.from, c.email.date);
      const res = await callGemini(prompt, 'gmail_sync');
      totalTokens += res.promptTokens + res.completionTokens;

      let ok = false; let detail: string | null = null;
      if (res.ok) {
        const parsedRes = parseGeminiResponse(res.text);
        if (parsedRes.success && parsedRes.data) {
          const d = parsedRes.data;
          const checks: string[] = [];
          if (d.is_transaction === c.expected.isTransaction) checks.push('is_transaction');
          if (c.expected.amount !== undefined && d.amount === c.expected.amount) checks.push('amount');
          if (c.expected.transactionType !== undefined && d.transaction_type === c.expected.transactionType) checks.push('transaction_type');
          const wanted = ['is_transaction', ...(c.expected.amount !== undefined ? ['amount'] : []), ...(c.expected.transactionType !== undefined ? ['transaction_type'] : [])];
          ok = wanted.every((w) => checks.includes(w));
          detail = `checks=${checks.join(',')} decision=${d.decision} amount=${d.amount} confidence=${d.confidence_score}`;
        } else {
          detail = `unparseable: ${res.text.slice(0, 120)}`;
        }
      } else {
        detail = `error: ${res.error}`;
      }
      if (ok) passed += 1;
      rows.push({ name: c.name, ok, latencyMs: res.latencyMs, detail });
      // eslint-disable-next-line no-console
      console.log(`  gmail  ${ok ? 'PASS' : 'FAIL'} ${c.name} → ${detail}`);
    }

    const report = {
      category: 'gmail_extraction_live', cases: LIVE_GMAIL.length,
      passRate: passed / LIVE_GMAIL.length,
      totalTokens,
      rows,
    };
    appendLiveResult(report);

    expect(passed / LIVE_GMAIL.length).toBeGreaterThanOrEqual(0.5);
    expect(passed).toBeGreaterThanOrEqual(1);
  }, 180_000);

  it.skipIf(!!liveSelection && liveSelection.category !== 'insight_live')('insight — health & score valid dan konsisten', async () => {
    if (initError) throw new Error(initError);
    const rows: unknown[] = [];
    let passed = 0; let totalTokens = 0;

    for (const c of LIVE_INSIGHT) {
      const reportData = buildFallbackMonthlyReport(c.input);
      const prompt = buildMonthlyReportPrompt(reportData);
      const res = await callGemini(prompt, 'insight_generator');
      totalTokens += res.promptTokens + res.completionTokens;

      let ok = false; let detail: string | null = null;
      if (res.ok) {
        const parsedRes = parseGeminiResponse(res.text);
        if (parsedRes.success && parsedRes.data) {
          const d = parsedRes.data;
          const score = Number(d.financialHealthScore);
          const healthOk = HEALTH_VALUES.includes(d.cashflowHealth);
          const scoreOk = Number.isFinite(score) && score >= 0 && score <= 100;
          ok = healthOk && scoreOk && d.cashflowHealth === c.health;
          detail = `health=${d.cashflowHealth} (exp ${c.health}) score=${score} summary="${String(d.summary || '').slice(0, 60)}"`;
        } else {
          detail = `unparseable: ${res.text.slice(0, 120)}`;
        }
      } else {
        detail = `error: ${res.error}`;
      }
      if (ok) passed += 1;
      rows.push({ name: c.name, ok, latencyMs: res.latencyMs, detail });
      // eslint-disable-next-line no-console
      console.log(`  insight ${ok ? 'PASS' : 'FAIL'} ${c.name} → ${detail}`);
    }

    const report = {
      category: 'insight_live', cases: LIVE_INSIGHT.length,
      passRate: passed / LIVE_INSIGHT.length,
      totalTokens,
      rows,
    };
    appendLiveResult(report);

    expect(passed / LIVE_INSIGHT.length).toBeGreaterThanOrEqual(0.5);
    expect(passed).toBeGreaterThanOrEqual(1);
  }, 180_000);

  it.skipIf(!!liveSelection && liveSelection.category !== 'ocr_receipt_vision_live')('ocr receipt vision — ekstrak struk dari gambar nyata (generateGeminiVision)', async () => {
    if (initError) throw new Error(initError);
    const rows: unknown[] = [];
    let passed = 0; let totalTokens = 0;

    for (const r of LIVE_RECEIPT) {
      const prompt = buildReceiptExtractionPrompt({});
      const res = await callGeminiVision(prompt, r.mimeType, r.data);
      totalTokens += res.promptTokens + res.completionTokens;

      let ok = false; let detail: string | null = null;
      if (res.ok) {
        const parsedRes = parseGeminiResponse(res.text);
        if (parsedRes.success && parsedRes.data) {
          // Jalur produksi nyata: output Gemini → normalizeReceiptResult
          // (sama seperti receiptScanService) sebelum dibandingkan.
          const d = normalizeReceiptResult(parsedRes.data);
          const checks: string[] = [];
          const wanted: string[] = ['is_transaction'];
          if (d.is_transaction === r.expected.isTransaction) checks.push('is_transaction');
          if (r.expected.transactionType !== undefined) {
            wanted.push('transaction_type');
            if (d.transaction_type === r.expected.transactionType) checks.push('transaction_type');
          }
          if (r.expected.amount !== undefined) {
            wanted.push('amount');
            if (d.amount === r.expected.amount) checks.push('amount');
          }
          if (r.expected.paymentMethod !== undefined) {
            wanted.push('payment_method');
            if (d.payment_method === r.expected.paymentMethod) checks.push('payment_method');
          }
          if (r.expected.date !== undefined) {
            wanted.push('date');
            if (d.date === r.expected.date) checks.push('date');
          }
          ok = wanted.every((w) => checks.includes(w));
          detail = `checks=${checks.join(',')} decision=${d.decision} amount=${d.amount} pay=${d.payment_method} date=${d.date}`;
        } else {
          detail = `unparseable: ${res.text.slice(0, 120)}`;
        }
      } else {
        detail = `error: ${res.error}`;
      }
      if (ok) passed += 1;
      rows.push({ name: r.name, ok, latencyMs: res.latencyMs, detail });
      // eslint-disable-next-line no-console
      console.log(`  receipt ${ok ? 'PASS' : 'FAIL'} ${r.name} → ${detail}`);
    }

    const report = {
      category: 'ocr_receipt_vision_live', cases: LIVE_RECEIPT.length,
      passRate: passed / LIVE_RECEIPT.length,
      totalTokens,
      rows,
    };
    appendLiveResult(report);

    // Vision flaky pada kasus marginal — floor lunak (bukan gate CI).
    expect(passed / LIVE_RECEIPT.length).toBeGreaterThanOrEqual(0.5);
    expect(passed).toBeGreaterThanOrEqual(1);
  }, 240_000);

  it.skipIf(!!liveSelection && liveSelection.category !== 'advisor_live')('advisor — output JSON lengkap sesuai schema prompt', async () => {
    if (initError) throw new Error(initError);
    const rows: unknown[] = [];
    let passed = 0; let totalTokens = 0;

    for (const c of LIVE_ADVISOR) {
      const metrics = computeAdvisorMetrics(c.input);
      const prompt = buildAdvisorPrompt({ metrics, subscriptions: c.input.subscriptions || [] });
      const res = await callGemini(prompt, 'financial_advisor');
      totalTokens += res.promptTokens + res.completionTokens;

      let ok = false; let detail: string | null = null;
      if (res.ok) {
        const parsedRes = parseGeminiResponse(res.text);
        if (parsedRes.success && parsedRes.data) {
          const d = parsedRes.data;
          const missing = c.requiredKeys.filter((k) => !(k in d));
          ok = missing.length === 0;
          detail = ok
            ? `keys=${c.requiredKeys.length} summary="${String(d.summary || '').slice(0, 60)}"`
            : `missing keys: ${missing.join(', ')}`;
        } else {
          detail = `unparseable: ${res.text.slice(0, 120)}`;
        }
      } else {
        detail = `error: ${res.error}`;
      }
      if (ok) passed += 1;
      rows.push({ name: c.name, ok, latencyMs: res.latencyMs, detail });
      // eslint-disable-next-line no-console
      console.log(`  advisor ${ok ? 'PASS' : 'FAIL'} ${c.name} → ${detail}`);
    }

    const report = {
      category: 'advisor_live', cases: LIVE_ADVISOR.length,
      passRate: passed / LIVE_ADVISOR.length,
      totalTokens,
      rows,
    };
    appendLiveResult(report);

    expect(passed / LIVE_ADVISOR.length).toBeGreaterThanOrEqual(0.5);
    expect(passed).toBeGreaterThanOrEqual(1);
  }, 180_000);
});

/** Kumpulkan hasil live ke satu file (append antar test, timestamp sekali). */
function appendLiveResult(report: unknown) {
  const dir = path.dirname(RESULTS_FILE);
  fs.mkdirSync(dir, { recursive: true });
  let existing: { generatedAt?: string; runner?: string; categories: unknown[] } = { categories: [] };
  if (fs.existsSync(RESULTS_FILE)) {
    try {
      existing = JSON.parse(fs.readFileSync(RESULTS_FILE, 'utf8'));
    } catch {
      existing = { categories: [] };
    }
  }
  if (!Array.isArray(existing.categories)) existing.categories = [];
  existing.categories.push(report);
  existing.runner = 'tests/benchmark/aiLiveBenchmark.spec.ts (npm run benchmark:ai:live)';
  if (liveSelection && !existing.feedbackSelection) {
    existing.feedbackSelection = liveSelection;
  }
  existing.generatedAt = new Date().toISOString();
  fs.writeFileSync(RESULTS_FILE, JSON.stringify(existing, null, 2));
}
