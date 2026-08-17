/**
 * Unit test — Feedback Metrics → prioritas perbaikan prompt (Sprint 1.5).
 *
 * Memverifikasi server/lib/feedbackMetrics.js:
 *   - agregasi per feature/rating (counts, positive/negative rate, priorityScore,
 *     confidence) — DETERMINISTIK
 *   - ranking prioritas (score desc, volume tie-break)
 *   - promptActionPlan: arah perbaikan sesuai rating negatif dominan, threshold
 *     already_done/skip, dan tidak ada sinyal negatif
 *   - buildFeedbackPriorityReport: ringkasan + topPriority
 *   - sinkronisasi enum rating dengan server/routes/aiProductRoutes.js
 *
 * Murni — tanpa DB.
 */
import { describe, expect, it } from 'vitest';
import {
  FEEDBACK_RATINGS,
  NEGATIVE_RATINGS,
  aggregateFeedbackByFeature,
  promptActionPlan,
  buildFeedbackPriorityReport,
  normalizeRating,
} from '../../server/lib/feedbackMetrics.js';
import { FEEDBACK_RATINGS as ROUTE_FEEDBACK_RATINGS } from '../../server/routes/aiProductRoutes.js';

const R = (feature, rating) => ({ feature, rating });

describe('aggregateFeedbackByFeature', () => {
  it('menghitung counts, rates & priorityScore dengan benar', () => {
    const rows = [
      ...Array.from({ length: 10 }, () => R('advisor', 'not_helpful')),
      ...Array.from({ length: 6 }, () => R('advisor', 'helpful')),
      ...Array.from({ length: 4 }, () => R('advisor', 'mismatched')),
    ];
    const { features, total } = aggregateFeedbackByFeature(rows);
    expect(total).toBe(20);
    const advisor = features.find((f) => f.feature === 'advisor');
    expect(advisor.counts.not_helpful).toBe(10);
    expect(advisor.counts.mismatched).toBe(4);
    expect(advisor.counts.helpful).toBe(6);
    // negative = not_helpful + mismatched + irrelevant = 14/20 = 0.7
    expect(advisor.negativeRate).toBeCloseTo(0.7, 5);
    expect(advisor.priorityScore).toBe(70);
    expect(advisor.positiveRate).toBeCloseTo(0.3, 5);
    expect(advisor.confidence).toBe('high'); // >= 15
  });

  it('confidence medium (5-14) & low (<5)', () => {
    const med = aggregateFeedbackByFeature([R('insight', 'not_helpful'), R('insight', 'helpful'), R('insight', 'helpful'), R('insight', 'helpful'), R('insight', 'helpful')]);
    expect(med.features[0].confidence).toBe('medium');
    const low = aggregateFeedbackByFeature([R('fraud', 'helpful')]);
    expect(low.features[0].confidence).toBe('low');
  });

  it('ranking: score desc, volume tie-break, nama asc', () => {
    const rows = [
      ...Array.from({ length: 5 }, () => R('insight', 'not_helpful')), // 5/10 → 50
      ...Array.from({ length: 5 }, () => R('insight', 'helpful')),
      ...Array.from({ length: 8 }, () => R('advisor', 'not_helpful')), // 8/10 → 80
      ...Array.from({ length: 2 }, () => R('advisor', 'helpful')),
      ...Array.from({ length: 5 }, () => R('fraud', 'helpful')), // 0 → 0
    ];
    const { features } = aggregateFeedbackByFeature(rows);
    expect(features.map((f) => f.feature)).toEqual(['advisor', 'insight', 'fraud']);
    expect(features[0].priorityScore).toBe(80);
    expect(features[2].priorityScore).toBe(0);
  });

  it('rating tidak dikenal diabaikan; feature kosong → unknown', () => {
    const { features, total } = aggregateFeedbackByFeature([
      R('advisor', 'not_helpful'),
      R('advisor', 'hack'),
      { feature: '', rating: 'helpful' },
    ]);
    expect(total).toBe(2);
    expect(features.find((f) => f.feature === 'unknown')).toBeDefined();
    expect(features.find((f) => f.feature === 'advisor').total).toBe(1);
  });

  it('kosong → laporan nol tanpa error', () => {
    const { total, features } = aggregateFeedbackByFeature([]);
    expect(total).toBe(0);
    expect(features).toEqual([]);
  });
});

describe('promptActionPlan', () => {
  it('not_helpful dominan → arah personalisasi & konteks spesifik', () => {
    const { features } = aggregateFeedbackByFeature([R('advisor', 'not_helpful'), R('advisor', 'not_helpful'), R('advisor', 'helpful')]);
    const plan = promptActionPlan(features);
    expect(plan[0].feature).toBe('advisor');
    expect(plan[0].prompt).toBe('buildAdvisorPrompt');
    expect(plan[0].dominantNegative).toBe('not_helpful');
    expect(plan[0].direction).toContain('generik');
  });

  it('mismatched dominan → arah perkuat skema', () => {
    const { features } = aggregateFeedbackByFeature([R('search', 'mismatched'), R('search', 'helpful')]);
    const plan = promptActionPlan(features);
    expect(plan[0].direction).toContain('skema');
  });

  it('already_done ≥ 30% → tambah saran hindari pengulangan', () => {
    const { features } = aggregateFeedbackByFeature([R('insight', 'already_done'), R('insight', 'already_done'), R('insight', 'already_done'), R('insight', 'helpful')]);
    const plan = promptActionPlan(features);
    expect(plan[0].direction).toContain('sudah saya lakukan');
  });

  it('tanpa negatif tapi already_done tinggi → TIDAK kontradiktif (tanpa "pertahankan")', () => {
    const { features } = aggregateFeedbackByFeature([R('insight', 'already_done'), R('insight', 'already_done'), R('insight', 'already_done'), R('insight', 'already_done')]);
    expect(features[0].negativeRate).toBe(0);
    const plan = promptActionPlan(features);
    expect(plan[0].direction).toContain('sudah saya lakukan');
    expect(plan[0].direction).not.toContain('pertahankan');
  });

  it('tanpa sinyal apa pun → pertahankan prompt', () => {
    const { features } = aggregateFeedbackByFeature([R('fraud', 'helpful'), R('fraud', 'helpful')]);
    const plan = promptActionPlan(features);
    expect(plan[0].direction).toContain('pertahankan');
  });

  it('skip ≥ 40% → arah kurangi frekuensi (bukan pertahankan)', () => {
    const { features } = aggregateFeedbackByFeature([R('fraud', 'skip'), R('fraud', 'skip'), R('fraud', 'helpful')]);
    const plan = promptActionPlan(features);
    expect(plan[0].direction).toContain('lewati');
    expect(plan[0].direction).not.toContain('pertahankan');
  });
});

describe('buildFeedbackPriorityReport', () => {
  it('menyusun ringkasan + topPriority + action plan', () => {
    const report = buildFeedbackPriorityReport([
      R('advisor', 'not_helpful'),
      R('advisor', 'not_helpful'),
      R('advisor', 'helpful'),
      R('insight', 'helpful'),
    ]);
    expect(report.totalFeedback).toBe(4);
    expect(report.featuresWithFeedback).toBe(2);
    expect(report.topPriority.feature).toBe('advisor');
    expect(report.topPriority.priorityScore).toBe(67);
    expect(report.actionPlan).toHaveLength(2);
  });
});

describe('sinkronisasi enum rating', () => {
  it('FEEDBACK_RATINGS identik dengan aiProductRoutes', () => {
    expect(FEEDBACK_RATINGS).toEqual(ROUTE_FEEDBACK_RATINGS);
  });

  it('NEGATIVE_RATINGS subset dari FEEDBACK_RATINGS & normalizeRating konsisten', () => {
    for (const r of NEGATIVE_RATINGS) {
      expect(FEEDBACK_RATINGS).toContain(r);
      expect(normalizeRating(r)).toBe(r);
    }
    expect(normalizeRating('hack')).toBeNull();
    expect(normalizeRating(undefined)).toBeNull();
  });
});
