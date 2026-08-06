/**
 * AI Quality Benchmark — Sprint 1 · Phase 1.6 (Product Intelligence Refinement).
 *
 * Benchmark DETERMINISTIK & RE-RUNNABLE untuk lapisan AI yang bisa dieksekusi
 * offline (tanpa Gemini/DB/network): L1 fraud rule engine, fallback insight,
 * fallback advisor, re-rank search, local gmail parser, normalizer OCR.
 *
 * - 5 kategori × 100 kasus (hand-crafted edge cases + generator deterministik
 *   ber-index, tanpa RNG liar) + kategori ke-6 hand_crafted (74 kasus bernama
 *   dari fixtures.ts) dengan ground-truth eksplisit.
 * - Metrik: accuracy, precision, recall, F1, latency (ms), token input estimasi,
 *   cost estimasi (pricing AI_PRICING), distribusi confidence.
 * - Hasil ditulis ke docs/ai/benchmark-results.json (JANGAN hardcode hasil).
 * - Floor assertion = regression guard: perubahan prompt/rule yang menurunkan
 *   kualitas deterministik akan memecah CI.
 *
 * Jalankan: npm run benchmark:ai   (alias vitest run tests/benchmark/...)
 * Dokumentasi: docs/ai/AI_BENCHMARK.md
 */
import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

// Hand-crafted edge cases (bagian 1 fixtures) — kategori benchmark ke-6.
import {
  HAND_CRAFTED_FRAUD,
  HAND_CRAFTED_OCR,
  HAND_CRAFTED_GMAIL,
  HAND_CRAFTED_INSIGHT,
  HAND_CRAFTED_ADVISOR,
  HAND_CRAFTED_SEARCH,
  LIVE_RECEIPT,
} from './fixtures';
import { buildReceipt } from './receiptImage';

// ── Predictor deterministik (tanpa AI/DB/network) ──
import { evaluateFraudRules, computeRuleRiskScore } from '../../server/lib/fraudEngine.js';
import { buildFraudScoringPrompt } from '../../server/services/fraudDetectionService.js';
import { rankAndExplainResults, buildSuggestedQueries } from '../../server/services/agentSearchService.js';
import { buildFallbackMonthlyReport } from '../../src/services/aiInsightService';
import { computeAdvisorMetrics, buildFallbackAdvisorReport } from '../../src/services/advisorService';
import { evaluateLocalGmailParser } from '../../src/lib/gmailLocalParser';
import { normalizeReceiptResult } from '../../server/lib/vertexContext.js';
import { estimateTokensFromText } from '../../src/utils/aiTokenEstimator';
import { AI_PRICING } from '../../server/config/metricsConfig.js';
import type { AdvisorInput, Transaction } from '../../src/types';

const FLASH = (AI_PRICING as Record<string, { input: number; output: number }>).gemini_flash;

// ── Helpers ──
function mulberry32(seed: number) {
  let a = seed >>> 0;
  return function () {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function macroPrecisionRecallF1(samples: Array<{ pred: Set<string>; exp: Set<string> }>) {
  let precision = 0; let recall = 0; let exact = 0;
  for (const s of samples) {
    const tp = [...s.exp].filter((x) => s.pred.has(x)).length;
    const fp = s.pred.size - tp;
    const fn = s.exp.size - tp;
    const prec = tp + fp > 0 ? tp / (tp + fp) : 1;
    const rec = tp + fn > 0 ? tp / (tp + fn) : 1;
    precision += prec; recall += rec;
    if (s.exp.size === s.pred.size && tp === s.exp.size) exact += 1;
  }
  const n = samples.length;
  const avgPrecision = precision / n;
  const avgRecall = recall / n;
  return {
    precision: avgPrecision,
    recall: avgRecall,
    f1: avgPrecision + avgRecall > 0 ? (2 * avgPrecision * avgRecall) / (avgPrecision + avgRecall) : 0,
    accuracy: exact / n,
  };
}

function estimateCost(text: string): number {
  const inputTokens = estimateTokensFromText(text);
  const outputTokens = Math.round(inputTokens * 0.3); // asumsi output ~30% input
  return (inputTokens / 1e6) * FLASH.input + (outputTokens / 1e6) * FLASH.output;
}

function timed<T>(fn: () => T): { value: T; ms: number } {
  const start = performance.now();
  const value = fn();
  return { value, ms: performance.now() - start };
}

const RESULTS_DIR = path.resolve(process.cwd(), 'docs', 'ai');
const RESULTS_FILE = path.join(RESULTS_DIR, 'benchmark-results.json');

// ────────────────────────────────────────────────────────────────────────────
// 1. FRAUD L1 (100 kasus: 12 hand-crafted + 88 generator)
// ────────────────────────────────────────────────────────────────────────────
function buildFraudCases(): Array<{ tx: any; ag: any; exp: Set<string> }> {
  const cases: Array<{ tx: any; ag: any; exp: Set<string> }> = [
    { tx: { id: 'h1', type: 'expense', amount: 150000, merchant: 'Kopi Senja', gmailMessageId: 'msg-1' }, ag: { gmailMessageIdExists: true }, exp: new Set(['duplicate']) },
    { tx: { id: 'h2', type: 'expense', amount: 150000, merchant: 'Kopi Senja' }, ag: { recentDuplicateCount: 2, merchantCount24h: 0, merchantSeen: true, p99Amount: 0, medianAmount: 0 }, exp: new Set(['duplicate']) },
    { tx: { id: 'h3', type: 'expense', amount: 50000, merchant: 'Indomaret' }, ag: { merchantCount24h: 8, merchantSeen: true, recentDuplicateCount: 0, p99Amount: 0, medianAmount: 0 }, exp: new Set(['velocity']) },
    { tx: { id: 'h4', type: 'expense', amount: 400000, merchant: 'X' }, ag: { p99Amount: 100000, merchantSeen: true, medianAmount: 50000, merchantCount24h: 1, recentDuplicateCount: 0 }, exp: new Set(['amount_outlier']) },
    { tx: { id: 'h5', type: 'income', amount: 200000, merchant: 'Y' }, ag: { p99Amount: 100000, merchantSeen: true, medianAmount: 80000, merchantCount24h: 1, recentDuplicateCount: 0 }, exp: new Set(['amount_outlier']) },
    { tx: { id: 'h6', type: 'expense', amount: 150000, merchant: 'New Store' }, ag: { merchantSeen: false, medianAmount: 50000, p99Amount: 0, merchantCount24h: 1, recentDuplicateCount: 0 }, exp: new Set(['new_merchant']) },
    { tx: { id: 'h7', type: 'expense', amount: 25000, merchant: 'Z', categoryId: 'c-1' }, ag: { categoryType: 'income', merchantSeen: true, medianAmount: 0, p99Amount: 0, merchantCount24h: 1, recentDuplicateCount: 0 }, exp: new Set(['category_anomaly']) },
    { tx: { id: 'h8', type: 'expense', amount: 50000, merchant: 'A' }, ag: { merchantSeen: true, medianAmount: 0, p99Amount: 0, merchantCount24h: 1, recentDuplicateCount: 0 }, exp: new Set() },
    { tx: { id: 'h9', type: 'expense', amount: 800000, merchant: 'B', gmailMessageId: 'msg-9' }, ag: { gmailMessageIdExists: true, merchantCount24h: 9, p99Amount: 100000, merchantSeen: true, medianAmount: 50000 }, exp: new Set(['duplicate', 'velocity', 'amount_outlier']) },
    { tx: { id: 'h10', type: 'transfer', amount: 50000, merchant: '' }, ag: { merchantSeen: false, p99Amount: 0, medianAmount: 0, recentDuplicateCount: 0 }, exp: new Set() },
    { tx: { id: 'h11', type: 'expense', amount: 160000, merchant: 'C' }, ag: { p99Amount: 100000, merchantSeen: true, medianAmount: 80000, merchantCount24h: 1, recentDuplicateCount: 0 }, exp: new Set(['amount_outlier']) },
    { tx: { id: 'h12', type: 'expense', amount: 30000, merchant: 'D' }, ag: { merchantCount24h: 5, merchantSeen: true, p99Amount: 0, medianAmount: 0, recentDuplicateCount: 0 }, exp: new Set() },
  ];
  const rules = ['duplicate', 'velocity', 'amount_outlier', 'new_merchant', 'category_anomaly', 'clean'];
  for (let i = 0; i < 88; i++) {
    const rule = rules[i % 6];
    const base = 20000 + ((i * 7919) % 980000);
    if (rule === 'duplicate') {
      cases.push({ tx: { id: `g-dup-${i}`, type: 'expense', amount: base, merchant: 'Merch D', gmailMessageId: `gmsg-${i}` }, ag: { gmailMessageIdExists: true }, exp: new Set(['duplicate']) });
    } else if (rule === 'velocity') {
      cases.push({ tx: { id: `g-vel-${i}`, type: 'expense', amount: base, merchant: 'Merch V' }, ag: { merchantSeen: true, merchantCount24h: 6 + (i % 10), p99Amount: 0, medianAmount: 0, recentDuplicateCount: 0 }, exp: new Set(['velocity']) });
    } else if (rule === 'amount_outlier') {
      cases.push({ tx: { id: `g-out-${i}`, type: 'expense', amount: Math.round(100000 * (1.6 + (i % 5) * 0.3)), merchant: 'Merch O' }, ag: { p99Amount: 100000, merchantSeen: true, medianAmount: 50000, merchantCount24h: 0, recentDuplicateCount: 0 }, exp: new Set(['amount_outlier']) });
    } else if (rule === 'new_merchant') {
      cases.push({ tx: { id: `g-new-${i}`, type: 'expense', amount: Math.round(100000 * (2.1 + (i % 4) * 0.2)), merchant: 'Merch N' }, ag: { merchantSeen: false, medianAmount: 100000, p99Amount: 0, merchantCount24h: 0, recentDuplicateCount: 0 }, exp: new Set(['new_merchant']) });
    } else if (rule === 'category_anomaly') {
      cases.push({ tx: { id: `g-cat-${i}`, type: 'expense', amount: base, merchant: 'Merch C', categoryId: 'c-x' }, ag: { categoryType: 'income', merchantSeen: true, p99Amount: 0, medianAmount: 0, merchantCount24h: 0, recentDuplicateCount: 0 }, exp: new Set(['category_anomaly']) });
    } else {
      cases.push({ tx: { id: `g-cln-${i}`, type: 'expense', amount: base, merchant: 'Merch P' }, ag: { merchantSeen: true, p99Amount: 0, medianAmount: 0, merchantCount24h: 0, recentDuplicateCount: 0 }, exp: new Set() });
    }
  }
  return cases;
}

// ────────────────────────────────────────────────────────────────────────────
// 2. INSIGHT fallback (100 kasus)
// ────────────────────────────────────────────────────────────────────────────
function buildInsightCase(i: number): { input: { transactions: Transaction[]; month: number; year: number }; health: string; score: [number, number]; contains: string[] } {
  const r = mulberry32(1000 + i);
  const tpl = ['healthy', 'critical', 'watch', 'stable', 'empty', 'merchant-heavy'][i % 6];
  const tx: Transaction[] = [];
  const month = 8; const year = 2026;
  let income = 0; let expense = 0; let health = 'stabil'; let score: [number, number] = [70, 90]; const contains: string[] = [];

  if (tpl === 'healthy') {
    income = Math.round(8000000 + r() * 4000000);
    expense = Math.round(income * (0.3 + r() * 0.3));
    health = 'sehat'; score = [75, 100]; contains.push('surplus');
  } else if (tpl === 'critical') {
    income = 5000000;
    expense = Math.round(income * (1.1 + r() * 0.4));
    health = 'kritis'; score = [0, 50]; contains.push('negatif');
  } else if (tpl === 'watch') {
    income = 10000000;
    expense = Math.round(income * (0.85 + r() * 0.12));
    health = 'waspada'; score = [55, 75]; contains.push('di atas batas');
  } else if (tpl === 'stable') {
    income = 10000000;
    expense = Math.round(income * (0.65 + r() * 0.18));
    health = 'stabil'; score = [70, 90]; contains.push('');
  } else if (tpl === 'empty') {
    health = 'stabil'; score = [70, 70]; contains.push('');
  } else {
    income = 10000000;
    expense = Math.round(income * (0.85 + r() * 0.12));
    health = 'waspada'; score = [55, 75]; contains.push('Frekuensi tinggi');
  }

  if (income > 0) {
    tx.push({ id: `ins-${i}-inc`, type: 'income', amount: income, date: `2026-08-05`, merchant: 'Gaji', categoryId: 'gaji', categoryName: 'Gaji' } as Transaction);
  }
  // merchant-heavy WAJIB n >= 6 agar sinyal 'Frekuensi tinggi' (count >= 5) valid
  const n = tpl === 'merchant-heavy' ? 6 + Math.floor(r() * 3) : 4 + Math.floor(r() * 4);
  for (let k = 0; k < n; k++) {
    const merchant = tpl === 'merchant-heavy' && k < 6 ? 'Toko Rutin' : `Merch ${k}`;
    tx.push({ id: `ins-${i}-exp-${k}`, type: 'expense', amount: Math.round(expense / Math.max(1, n)), date: `2026-08-${10 + k}`, merchant, categoryId: 'makanan-minuman', categoryName: 'Makanan & Minuman' } as Transaction);
  }
  return { input: { transactions: tx, month, year }, health, score, contains };
}

// ────────────────────────────────────────────────────────────────────────────
// 3. ADVISOR fallback (100 kasus)
// ────────────────────────────────────────────────────────────────────────────
function buildAdvisorInput(i: number): { input: AdvisorInput; contains: string[] } {
  const r = mulberry32(2000 + i);
  const tpl = ['highRatio', 'lowCoverage', 'subscriptionHeavy', 'overBudget', 'healthy', 'empty'][i % 6];
  const tx: Transaction[] = [];
  const month = 8; const year = 2026;
  let income = 10000000; let expense = 5000000; let balance = 30000000;
  let budgets: any[] = []; let subs: any[] = [];
  const contains: string[] = [];

  if (tpl === 'highRatio') { expense = Math.round(income * 0.95); contains.push('Pengeluaran sudah'); }
  else if (tpl === 'lowCoverage') { balance = 2000000; contains.push('dana darurat'); }
  else if (tpl === 'subscriptionHeavy') { subs = [{ id: 's1', name: 'Netflix', amount: 1500000, cycle: 'monthly' }, { id: 's2', name: 'Spotify', amount: 1000000, cycle: 'monthly' }]; contains.push('Total langganan'); }
  else if (tpl === 'overBudget') { expense = 8000000; budgets = [{ id: 'b1', categoryId: 'makanan-minuman', categoryName: 'Makanan & Minuman', amount: 4000000, month, year }]; contains.push('Makanan & Minuman'); }
  else if (tpl === 'healthy') { expense = 6000000; contains.push('auto-transfer'); contains.push('Surplus'); }
  else { income = 0; expense = 0; contains.push('Laporan'); }

  if (income > 0) {
    tx.push({ id: `adv-${i}-inc`, type: 'income', amount: income, date: '2026-08-05', merchant: 'Gaji', categoryId: 'gaji', categoryName: 'Gaji' } as Transaction);
  }
  const n = 4 + Math.floor(r() * 3);
  for (let k = 0; k < n; k++) {
    tx.push({ id: `adv-${i}-exp-${k}`, type: 'expense', amount: Math.round(expense / Math.max(1, n)), date: `2026-08-${10 + k}`, merchant: `Merch ${k}`, categoryId: 'makanan-minuman', categoryName: 'Makanan & Minuman' } as Transaction);
  }

  const input = {
    transactions: tx,
    budgets,
    subscriptions: subs,
    wallets: [{ id: 'w1', name: 'Utama', balance }],
    goals: [{ id: 'g1', name: 'Liburan', targetAmount: 12000000, currentAmount: 3000000 }],
    month,
    year,
  } as unknown as AdvisorInput;
  return { input, contains };
}

// ────────────────────────────────────────────────────────────────────────────
// 4. SEARCH re-rank (100 kasus)
// ────────────────────────────────────────────────────────────────────────────
function buildSearchCase(i: number) {
  const r = mulberry32(3000 + i);
  const target = ['Indomaret', 'Gojek', 'Shopee', 'Tokopedia', 'Blu', 'Grab'][i % 6];
  const withDateFilter = i % 3 === 0;
  const results = [];
  for (let k = 0; k < 10; k++) {
    const isTarget = k === 0;
    results.push({
      id: `r-${i}-${k}`,
      title: isTarget ? `${target} Rp${(50000 + k * 1000).toLocaleString('id-ID')}` : `Merch ${i}-${k} Rp${(20000 + k * 500).toLocaleString('id-ID')}`,
      merchant: isTarget ? target : `Merch ${k}`,
      category: isTarget ? 'makanan-minuman' : 'lainnya',
      amount: isTarget ? 50000 : 20000 + k * 500,
      transaction_date: withDateFilter ? (isTarget ? '2026-08-05' : '2026-09-01') : '2026-08-05',
    });
  }
  const filters = withDateFilter ? { dateFrom: '2026-08-01', dateTo: '2026-08-10' } : {};
  return { results, query: target, tab: 'transactions' as const, filters };
}

// ────────────────────────────────────────────────────────────────────────────
// 5. OCR / PARSING LOKAL (100 kasus: 50 gmail L0 + 50 normalizer receipt)
// ────────────────────────────────────────────────────────────────────────────
function buildGmailCase(i: number) {
  const tpl = ['promo', 'promo_cashback', 'real_high', 'security', 'ambiguous'][i % 5];
  if (tpl === 'promo') {
    return { email: { subject: 'Promo Diskon 50%', from: 'promo@tokopedia.com', body: 'Dapatkan diskon besar-besaran untuk semua produk pilihan, hanya hari ini. Klik untuk melihat penawaran.', date: '2026-08-05' }, decision: 'auto_reject' };
  }
  if (tpl === 'promo_cashback') {
    return { email: { subject: 'Cashback hingga 20%', from: 'promo@shopee.co.id', body: 'Cashback s/d 20% untuk transaksi menggunakan ShopeePay hari ini.', date: '2026-08-05' }, decision: 'auto_reject' };
  }
  if (tpl === 'real_high') {
    return { email: { subject: 'Pembayaran Berhasil', from: 'notif@shopee.co.id', body: 'Pembayaran berhasil. Anda membayar Rp 150.000 untuk pesanan #12345 menggunakan ShopeePay.', date: '2026-08-05' }, decision: 'auto_accept', amount: 150000 };
  }
  if (tpl === 'security') {
    return { email: { subject: 'Login dari perangkat baru', from: 'security@bankjago.com', body: 'Login dari perangkat baru terdeteksi. Jika bukan Anda, segera hubungi kami.', date: '2026-08-05' }, decision: 'auto_skip' };
  }
  return { email: { subject: 'Terima kasih', from: 'info@blu.com', body: 'Terima kasih telah menggunakan layanan kami. Semoga harimu menyenangkan.', date: '2026-08-05' }, decision: 'auto_skip' };
}

function buildReceiptCase(i: number): { payload: any; expect: Record<string, unknown> } {
  const tpl = ['valid', 'string_amount', 'bad_amount', 'bad_date', 'credit', 'garbage_decision', 'not_transaction', 'income'][i % 8];
  if (tpl === 'valid') {
    return { payload: { decision: 'auto_accept', is_transaction: true, transaction_type: 'expense', amount: 150000, currency: 'IDR', date: '2026-08-01', merchant: 'Indomaret', category: 'Makanan', payment_method: 'qris', note: 'Struk belanja', confidence_score: 0.92, reason: null, risk_flags: [] }, expect: { amount: 150000, payment_method: 'qris', decision: 'auto_accept', date: '2026-08-01', transaction_type: 'expense' } };
  }
  if (tpl === 'string_amount') {
    return { payload: { decision: 'auto_accept', is_transaction: true, transaction_type: 'expense', amount: '250000', date: '2026-08-02', payment_method: 'cash' }, expect: { amount: 250000 } };
  }
  if (tpl === 'bad_amount') {
    return { payload: { decision: 'auto_accept', is_transaction: true, transaction_type: 'expense', amount: 'Rp 12.000', date: '2026-08-02', payment_method: 'cash' }, expect: { amount: null } };
  }
  if (tpl === 'bad_date') {
    return { payload: { decision: 'auto_accept', is_transaction: true, transaction_type: 'expense', amount: 50000, date: '12/08/2026', payment_method: 'cash' }, expect: { date: null } };
  }
  if (tpl === 'credit') {
    return { payload: { decision: 'auto_accept', is_transaction: true, transaction_type: 'expense', amount: 50000, date: '2026-08-02', payment_method: 'kartu kredit' }, expect: { payment_method: 'kartu-kredit' } };
  }
  if (tpl === 'garbage_decision') {
    return { payload: { decision: 'maybe', is_transaction: true, transaction_type: 'expense', amount: 50000, date: '2026-08-02', payment_method: 'cash' }, expect: { decision: 'needs_review' } };
  }
  if (tpl === 'not_transaction') {
    return { payload: { decision: 'auto_skip', is_transaction: false, transaction_type: 'expense', amount: null, date: null, payment_method: 'cash' }, expect: { transaction_type: null } };
  }
  return { payload: { decision: 'auto_accept', is_transaction: true, transaction_type: 'income', amount: 1000000, date: '2026-08-02', payment_method: 'transfer-bank' }, expect: { transaction_type: 'income' } };
}

// ────────────────────────────────────────────────────────────────────────────
// Runner
// ────────────────────────────────────────────────────────────────────────────
function runBenchmark() {
  const reports: any[] = [];
  const latencySamples: Record<string, number[]> = {};

  // 1) Fraud L1
  {
    const cases = buildFraudCases();
    const samples: Array<{ pred: Set<string>; exp: Set<string> }> = [];
    const confidences: number[] = [];
    let promptTokens = 0; let promptCost = 0; let totalMs = 0;
    for (const c of cases) {
      const t = timed(() => evaluateFraudRules({ transaction: c.tx, aggregates: c.ag }));
      const flags = t.value;
      totalMs += t.ms;
      latencySamples.fraud = latencySamples.fraud || [];
      latencySamples.fraud.push(t.ms);
      samples.push({ pred: new Set(flags.map((f: any) => f.rule)), exp: c.exp });
      const score = computeRuleRiskScore(flags);
      if (score > 0) confidences.push(score);
      const prompt = buildFraudScoringPrompt({ transaction: c.tx, flags, aggregates: c.ag });
      promptTokens += estimateTokensFromText(prompt);
      promptCost += estimateCost(prompt);
    }
    const m = macroPrecisionRecallF1(samples);
    reports.push({ category: 'fraud_l1', cases: cases.length, ...m, avgLatencyMs: totalMs / cases.length, avgInputTokens: Math.round(promptTokens / cases.length), estCostUsdPerCase: promptCost / cases.length, confidenceDistribution: confidenceBucket(confidences) });
  }

  // 2) Insight fallback
  {
    const cases: Array<{ pred: any; exp: Set<string> }> = [];
    let totalMs = 0; let tokens = 0; let cost = 0; const confidences: number[] = [];
    for (let i = 0; i < 100; i++) {
      const { input, health, score, contains } = buildInsightCase(i);
      const t = timed(() => buildFallbackMonthlyReport(input));
      const report = t.value;
      totalMs += t.ms;
      const checks: string[] = [];
      if (report.cashflowHealth === health) checks.push('health');
      if (typeof report.financialHealthScore === 'number' && report.financialHealthScore >= score[0] && report.financialHealthScore <= score[1]) checks.push('score');
      for (const c of contains) if (c && JSON.stringify(report).includes(c)) checks.push('signal:' + c);
      const expected = new Set(['health', 'score', ...contains.filter(Boolean).map((c) => 'signal:' + c)]);
      cases.push({ pred: new Set(checks), exp: expected });
      if (typeof report.financialHealthScore === 'number') confidences.push(report.financialHealthScore / 100);
      const payload = JSON.stringify(input.transactions.slice(0, 30));
      tokens += estimateTokensFromText(payload); cost += estimateCost(payload);
    }
    const m = macroPrecisionRecallF1(cases);
    reports.push({ category: 'insight_fallback', cases: 100, ...m, avgLatencyMs: totalMs / 100, avgInputTokens: Math.round(tokens / 100), estCostUsdPerCase: cost / 100, confidenceDistribution: confidenceBucket(confidences) });
  }

  // 3) Advisor fallback
  {
    const cases: Array<{ pred: Set<string>; exp: Set<string> }> = [];
    let totalMs = 0; let tokens = 0; let cost = 0;
    for (let i = 0; i < 100; i++) {
      const { input, contains } = buildAdvisorInput(i);
      const t = timed(() => buildFallbackAdvisorReport(computeAdvisorMetrics(input)));
      const report = t.value;
      totalMs += t.ms;
      const text = JSON.stringify(report);
      const checks = contains.filter((c) => text.includes(c));
      cases.push({ pred: new Set(checks), exp: new Set(contains) });
      const payload = JSON.stringify({ metrics: computeAdvisorMetrics(input), subscriptions: input.subscriptions });
      tokens += estimateTokensFromText(payload); cost += estimateCost(payload);
    }
    const m = macroPrecisionRecallF1(cases);
    reports.push({ category: 'advisor_fallback', cases: 100, ...m, avgLatencyMs: totalMs / 100, avgInputTokens: Math.round(tokens / 100), estCostUsdPerCase: cost / 100 });
  }

  // 4) Search re-rank
  {
    let top1 = 0; let explanation = 0; let suggestionsOk = 0; let totalMs = 0;
    for (let i = 0; i < 100; i++) {
      const { results, query, tab, filters } = buildSearchCase(i);
      const t = timed(() => rankAndExplainResults(results, query, tab, filters));
      const ranked = t.value;
      totalMs += t.ms;
      if (ranked[0]?.id === `r-${i}-0`) top1 += 1;
      const target = ranked.find((x: any) => x.id === `r-${i}-0`);
      if (target && Array.isArray(target.explanation) && target.explanation.length > 0) explanation += 1;
      const suggestions = buildSuggestedQueries(query, tab, []);
      if (suggestions.length === 4 && new Set(suggestions.map((s: string) => s.toLowerCase())).size === 4 && suggestions.every((s: string) => s.length > 0 && s.toLowerCase() !== query.toLowerCase())) suggestionsOk += 1;
    }
    reports.push({ category: 'search_rerank', cases: 100, top1HitRate: top1 / 100, explanationRate: explanation / 100, suggestedQueriesValidRate: suggestionsOk / 100, avgLatencyMs: totalMs / 100 });
  }

  // 5) OCR / parsing lokal (gmail L0 + receipt normalizer)
  {
    let gmailOk = 0; let gmailAmountOk = 0; let gmailWithAmount = 0; const gmailConfidences: number[] = [];
    let receiptChecks = 0; let receiptTotal = 0;
    let totalMs = 0;
    for (let i = 0; i < 50; i++) {
      const c = buildGmailCase(i);
      const t = timed(() => evaluateLocalGmailParser(c.email));
      const res = t.value;
      totalMs += t.ms;
      gmailConfidences.push(res.confidence);
      if (res.decision === c.decision) gmailOk += 1;
      if (c.amount) {
        gmailWithAmount += 1;
        if (res.extracted?.amount === c.amount) gmailAmountOk += 1;
      }
    }
    for (let i = 0; i < 50; i++) {
      const c = buildReceiptCase(i);
      const t = timed(() => normalizeReceiptResult(c.payload));
      const res = t.value;
      totalMs += t.ms;
      for (const [key, val] of Object.entries(c.expect)) {
        receiptTotal += 1;
        if (res[key] === val) receiptChecks += 1;
      }
    }
    reports.push({
      category: 'ocr_parsing_local', cases: 100,
      gmailDecisionAccuracy: gmailOk / 50,
      gmailAmountExtractionAccuracy: gmailWithAmount > 0 ? gmailAmountOk / gmailWithAmount : 1,
      receiptFieldAccuracy: receiptChecks / receiptTotal,
      avgLatencyMs: totalMs / 100,
      confidenceDistribution: confidenceBucket(gmailConfidences),
    });
  }

  // 6) HAND-CRAFTED edge cases — 74 kasus bernama (fraud 20, OCR 20, gmail 10,
  //    insight 8, advisor 8, search 8). Ground truth eksplisit + alasan tiap kasus.
  //    (fixtures.ts — auditable, bukan generator acak.)
  {
    // 6a) Fraud L1
    {
      const samples: Array<{ pred: Set<string>; exp: Set<string> }> = [];
      let totalMs = 0;
      for (const c of HAND_CRAFTED_FRAUD) {
        const t = timed(() => evaluateFraudRules({ transaction: c.tx, aggregates: c.ag }));
        totalMs += t.ms;
        samples.push({ pred: new Set(t.value.map((f: any) => f.rule)), exp: new Set(c.exp) });
      }
      const m = macroPrecisionRecallF1(samples);
      reports.push({ category: 'hand_crafted_fraud', cases: HAND_CRAFTED_FRAUD.length, ...m, avgLatencyMs: totalMs / HAND_CRAFTED_FRAUD.length });
    }

    // 6b) OCR receipt normalizer
    {
      let checks = 0; let total = 0; let totalMs = 0;
      for (const c of HAND_CRAFTED_OCR) {
        const t = timed(() => normalizeReceiptResult(c.payload));
        totalMs += t.ms;
        for (const [key, val] of Object.entries(c.expect)) {
          total += 1;
          if (t.value[key] === val) checks += 1;
        }
      }
      reports.push({ category: 'hand_crafted_ocr', cases: HAND_CRAFTED_OCR.length, receiptFieldAccuracy: checks / total, avgLatencyMs: totalMs / HAND_CRAFTED_OCR.length });
    }

    // 6c) Gmail L0 parser
    {
      let decisionOk = 0; let amountOk = 0; let withAmount = 0; let totalMs = 0;
      for (const c of HAND_CRAFTED_GMAIL) {
        const t = timed(() => evaluateLocalGmailParser(c.email));
        totalMs += t.ms;
        if (t.value.decision === c.decision) decisionOk += 1;
        if (c.amount !== undefined) {
          withAmount += 1;
          if (t.value.extracted?.amount === c.amount) amountOk += 1;
        }
      }
      reports.push({
        category: 'hand_crafted_gmail', cases: HAND_CRAFTED_GMAIL.length,
        gmailDecisionAccuracy: decisionOk / HAND_CRAFTED_GMAIL.length,
        gmailAmountExtractionAccuracy: withAmount > 0 ? amountOk / withAmount : 1,
        avgLatencyMs: totalMs / HAND_CRAFTED_GMAIL.length,
      });
    }

    // 6d) Insight fallback
    {
      const samples: Array<{ pred: Set<string>; exp: Set<string> }> = [];
      let totalMs = 0;
      for (const c of HAND_CRAFTED_INSIGHT) {
        const t = timed(() => buildFallbackMonthlyReport(c.input));
        const report = t.value;
        totalMs += t.ms;
        const checks: string[] = [];
        if (report.cashflowHealth === c.health) checks.push('health');
        if (typeof report.financialHealthScore === 'number' && report.financialHealthScore >= c.score[0] && report.financialHealthScore <= c.score[1]) checks.push('score');
        for (const needle of c.contains) if (needle && JSON.stringify(report).includes(needle)) checks.push('signal:' + needle);
        samples.push({ pred: new Set(checks), exp: new Set(['health', 'score', ...c.contains.filter(Boolean).map((x) => 'signal:' + x)]) });
      }
      const m = macroPrecisionRecallF1(samples);
      reports.push({ category: 'hand_crafted_insight', cases: HAND_CRAFTED_INSIGHT.length, ...m, avgLatencyMs: totalMs / HAND_CRAFTED_INSIGHT.length });
    }

    // 6e) Advisor fallback
    {
      const samples: Array<{ pred: Set<string>; exp: Set<string> }> = [];
      let totalMs = 0;
      for (const c of HAND_CRAFTED_ADVISOR) {
        const t = timed(() => buildFallbackAdvisorReport(computeAdvisorMetrics(c.input)));
        const text = JSON.stringify(t.value);
        totalMs += t.ms;
        samples.push({ pred: new Set(c.contains.filter((x) => text.includes(x))), exp: new Set(c.contains) });
      }
      const m = macroPrecisionRecallF1(samples);
      reports.push({ category: 'hand_crafted_advisor', cases: HAND_CRAFTED_ADVISOR.length, ...m, avgLatencyMs: totalMs / HAND_CRAFTED_ADVISOR.length });
    }

    // 6f) Search re-rank
    {
      let top1 = 0; let totalMs = 0;
      for (const c of HAND_CRAFTED_SEARCH) {
        const t = timed(() => rankAndExplainResults(c.results, c.query, c.tab, c.filters));
        const ranked = t.value;
        totalMs += t.ms;
        if (c.expectedTopId === undefined) {
          if (ranked.length === 0) top1 += 1; // empty results → kosong, tidak crash
        } else if (ranked[0]?.id === c.expectedTopId) {
          top1 += 1;
        }
      }
      reports.push({ category: 'hand_crafted_search', cases: HAND_CRAFTED_SEARCH.length, top1HitRate: top1 / HAND_CRAFTED_SEARCH.length, avgLatencyMs: totalMs / HAND_CRAFTED_SEARCH.length });
    }
  }

  return reports;
}

function confidenceBucket(values: number[]): Record<string, number> {
  const buckets: Record<string, number> = { '0.0-0.5': 0, '0.5-0.7': 0, '0.7-0.85': 0, '0.85-1.0': 0 };
  for (const v of values) {
    if (v < 0.5) buckets['0.0-0.5'] += 1;
    else if (v < 0.7) buckets['0.5-0.7'] += 1;
    else if (v < 0.85) buckets['0.7-0.85'] += 1;
    else buckets['0.85-1.0'] += 1;
  }
  return buckets;
}

describe('AI Quality Benchmark (Sprint 1 · Phase 1.6)', () => {
  it('menjalankan 6 kategori benchmark deterministik (5×100 + 74 hand-crafted) & menulis docs/ai/benchmark-results.json', () => {
    const reports = runBenchmark();
    fs.mkdirSync(RESULTS_DIR, { recursive: true });
    const output = {
      // TANPA timestamp — artifact deterministik agar diff git bersih antar run.
      runner: 'tests/benchmark/aiQualityBenchmark.spec.ts (npm run benchmark:ai)',
      deterministic: true,
      categories: reports,
    };
    fs.writeFileSync(RESULTS_FILE, JSON.stringify(output, null, 2));
    // eslint-disable-next-line no-console
    console.log('\n=== AI QUALITY BENCHMARK ===');
    // eslint-disable-next-line no-console
    console.table(reports.map((r: any) => ({ category: r.category, cases: r.cases, precision: r.precision, recall: r.recall, f1: r.f1, accuracy: r.accuracy, top1: r.top1HitRate, latencyMs: Number(r.avgLatencyMs?.toFixed(2)) })));

    // ── Regression floors (deterministik — perubahan rule/prompt menurunkan ini = CI merah) ──
    const fraud = reports.find((r: any) => r.category === 'fraud_l1');
    const insight = reports.find((r: any) => r.category === 'insight_fallback');
    const advisor = reports.find((r: any) => r.category === 'advisor_fallback');
    const search = reports.find((r: any) => r.category === 'search_rerank');
    const ocr = reports.find((r: any) => r.category === 'ocr_parsing_local');
    // Hand-crafted (kategori 6)
    const hcFraud = reports.find((r: any) => r.category === 'hand_crafted_fraud');
    const hcOcr = reports.find((r: any) => r.category === 'hand_crafted_ocr');
    const hcGmail = reports.find((r: any) => r.category === 'hand_crafted_gmail');
    const hcInsight = reports.find((r: any) => r.category === 'hand_crafted_insight');
    const hcAdvisor = reports.find((r: any) => r.category === 'hand_crafted_advisor');
    const hcSearch = reports.find((r: any) => r.category === 'hand_crafted_search');

    expect(fraud.precision).toBeGreaterThanOrEqual(0.95);
    expect(fraud.recall).toBeGreaterThanOrEqual(0.95);
    expect(insight.accuracy).toBeGreaterThanOrEqual(0.9);
    expect(advisor.accuracy).toBeGreaterThanOrEqual(0.9);
    expect(search.top1HitRate).toBeGreaterThanOrEqual(0.95);
    expect(search.suggestedQueriesValidRate).toBeGreaterThanOrEqual(0.99);
    expect(ocr.receiptFieldAccuracy).toBeGreaterThanOrEqual(0.9);
    expect(ocr.gmailDecisionAccuracy).toBeGreaterThanOrEqual(0.9);

    // Floor kategori hand-crafted — edge case bernama wajib lulus (regression guard tambahan).
    expect(hcFraud.precision).toBeGreaterThanOrEqual(0.95);
    expect(hcFraud.recall).toBeGreaterThanOrEqual(0.95);
    expect(hcOcr.receiptFieldAccuracy).toBeGreaterThanOrEqual(0.9);
    expect(hcGmail.gmailDecisionAccuracy).toBeGreaterThanOrEqual(0.9);
    expect(hcInsight.accuracy).toBeGreaterThanOrEqual(0.9);
    expect(hcAdvisor.accuracy).toBeGreaterThanOrEqual(0.9);
    expect(hcSearch.top1HitRate).toBeGreaterThanOrEqual(0.9);
  });

  it('receipt image generator — PNG valid, deterministik, ground-truth persis (regression guard vision)', () => {
    // (1) Output benar-benar PNG (signature 8 byte) & deterministik antar panggilan.
    const PNG_SIG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
    for (const r of LIVE_RECEIPT) {
      expect(Buffer.from(r.data, 'base64').subarray(0, 8)).toEqual(PNG_SIG);
      expect(r.mimeType).toBe('image/png');
    }
    const a = buildReceipt('dup-check', { header: 'TOKO MAKMUR', items: ['NASI GORENG RP 35.000'], total: 'TOTAL RP 150.000', payment: 'QRIS', date: '01/08/2026' });
    const b = buildReceipt('dup-check', { header: 'TOKO MAKMUR', items: ['NASI GORENG RP 35.000'], total: 'TOTAL RP 150.000', payment: 'QRIS', date: '01/08/2026' });
    expect(a.data).toBe(b.data); // byte-identik antar run

    // (2) Ground-truth fixture = literal eksplisit (parseAmount/normalizePayment/
    //     normalizeDate bekerja benar — TANPA Gemini). Jika helper ini berubah,
    //     live vision bisa menghasilkan expected yang salah diam-diam.
    const expectedTruth: Record<string, unknown> = {
      live_receipt_expense_qris: { isTransaction: true, transactionType: 'expense', amount: 150000, paymentMethod: 'qris', date: '2026-08-01' },
      live_receipt_expense_cash: { isTransaction: true, transactionType: 'expense', amount: 25000, paymentMethod: 'cash', date: '2026-08-02' },
      live_receipt_income_transfer: { isTransaction: true, transactionType: 'income', amount: 500000, paymentMethod: 'transfer-bank', date: '2026-08-03' },
      live_receipt_not_transaction: { isTransaction: false },
    };
    for (const r of LIVE_RECEIPT) {
      expect(r.expected).toEqual(expectedTruth[r.name]);
    }
  });
});
