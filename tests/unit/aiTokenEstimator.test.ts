/**
 * Unit test: src/utils/aiTokenEstimator.ts
 *
 * Estimator token & cost Gemini — pure utility (tanpa side effect).
 */
import { describe, it, expect } from 'vitest';
import {
  estimateTokensFromText,
  estimateTokensFromImageBytes,
  estimateGeminiCost,
  buildAiUsageSummary,
  formatCostUsd,
  formatTokenCount,
} from '../../src/utils/aiTokenEstimator';

describe('estimateTokensFromText', () => {
  it('0 untuk teks kosong', () => {
    expect(estimateTokensFromText('')).toBe(0);
    expect(estimateTokensFromText(null as unknown as string)).toBe(0);
  });

  it('~4 char per token (ceil)', () => {
    expect(estimateTokensFromText('abcd')).toBe(1);   // 4 char → 1 token
    expect(estimateTokensFromText('abcde')).toBe(2);  // 5 char → ceil(5/4) = 2
    expect(estimateTokensFromText('x'.repeat(400))).toBe(100);
  });
});

describe('estimateTokensFromImageBytes', () => {
  it('kategori berdasarkan ukuran', () => {
    expect(estimateTokensFromImageBytes(0)).toBe(0);
    expect(estimateTokensFromImageBytes(50_000)).toBe(1000);    // <100KB
    expect(estimateTokensFromImageBytes(300_000)).toBe(1500);   // <500KB
    expect(estimateTokensFromImageBytes(2_000_000)).toBe(2000); // 500KB-5MB
  });
});

describe('estimateGeminiCost', () => {
  it('hitung biaya input + output (default output 400 token)', () => {
    const cost = estimateGeminiCost({ inputTokens: 1_000_000 });
    expect(cost.model).toBe('gemini-2.5-flash');
    expect(cost.inputCostUsd).toBe(0.15);                       // 1M × 0.15/1M
    expect(cost.outputTokens).toBe(400);
    expect(cost.outputCostUsd).toBeCloseTo(0.00024, 5);         // 400 × 0.60/1M
    expect(cost.totalCostUsd).toBeCloseTo(0.15024, 5);
  });

  it('custom output tokens', () => {
    const cost = estimateGeminiCost({ inputTokens: 0, outputTokens: 1_000_000 });
    expect(cost.outputCostUsd).toBe(0.6);
    expect(cost.totalCostUsd).toBe(0.6);
  });
});

describe('buildAiUsageSummary', () => {
  it('ringkasan agregat konsisten', () => {
    const summary = buildAiUsageSummary({
      totalEmails: 100,
      skippedByRules: 30,
      parsedByFallback: 20,
      sentToAi: 50,
      aiSkippedDueQuota: 5,
      averageInputCharsPerAiCall: 2000,
    });
    expect(summary.totalCalls).toBe(50);
    expect(summary.savedAiCalls).toBe(50); // skipped + fallback
    expect(summary.estimatedInputTokens).toBe(50 * Math.ceil(2000 / 4));
    expect(summary.estimatedCostUsd).toBeGreaterThan(0);
  });
});

describe('format helpers', () => {
  it('formatCostUsd presisi sesuai magnitude', () => {
    expect(formatCostUsd(0.0005)).toBe('< $0.001');
    expect(formatCostUsd(0.005)).toBe('$0.0050');
    expect(formatCostUsd(0.123)).toBe('$0.123');
  });

  it('formatTokenCount K/M', () => {
    expect(formatTokenCount(500)).toBe('500');
    expect(formatTokenCount(1500)).toBe('1.5K');
    expect(formatTokenCount(2_300_000)).toBe('2.3M');
  });
});
