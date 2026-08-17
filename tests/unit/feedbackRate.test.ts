/**
 * Unit test: server/lib/feedbackRate.js (P10.2i — Feedback Rate).
 *
 * Agregasi MURNI: ai_feedback (numerator) ÷ ai_result_shown (denominator
 * "AI result views" — tampilan kartu AI feedback-capable). Diverifikasi:
 *   - global + per-feature rate, pembulatan 3 desimal
 *   - guard divide-by-zero (views = 0 → rate 0)
 *   - metadata viewRows: object / string JSON / corrupt → defensive
 *   - metric_value dijumlahkan (default 1)
 *   - urutan byFeature (feedback desc → views desc)
 */
import { describe, it, expect } from 'vitest';
import { aggregateFeedbackRate, emptyFeedbackRate } from '../../server/lib/feedbackRate.js';

describe('aggregateFeedbackRate', () => {
  it('tanpa data → feedback 0, views 0, rate 0, byFeature []', () => {
    const r = aggregateFeedbackRate();
    expect(r).toEqual({ feedback: 0, views: 0, rate: 0, byFeature: [] });
    expect(emptyFeedbackRate()).toEqual(r);
  });

  it('dasar: 3 feedback ÷ 5 views → rate 0.6 (global)', () => {
    const r = aggregateFeedbackRate({
      feedbackRows: [
        { feature: 'advisor', rating: 'helpful' },
        { feature: 'advisor', rating: 'not_helpful' },
        { feature: 'advisor', rating: 'skip' },
      ],
      viewRows: [
        { metric_value: 1, metadata: { feature: 'advisor' } },
        { metric_value: 1, metadata: { feature: 'advisor' } },
        { metric_value: 1, metadata: { feature: 'advisor' } },
        { metric_value: 1, metadata: { feature: 'advisor' } },
        { metric_value: 1, metadata: { feature: 'advisor' } },
      ],
    });
    expect(r.feedback).toBe(3);
    expect(r.views).toBe(5);
    expect(r.rate).toBe(0.6);
  });

  it('per feature: grouping + rate masing-masing (insight: 1/4 = 0.25)', () => {
    const r = aggregateFeedbackRate({
      feedbackRows: [
        { feature: 'advisor', rating: 'helpful' },
        { feature: 'advisor', rating: 'not_helpful' },
        { feature: 'insight', rating: 'helpful' },
      ],
      viewRows: [
        { metric_value: 1, metadata: { feature: 'advisor' } },
        { metric_value: 1, metadata: { feature: 'advisor' } },
        { metric_value: 1, metadata: { feature: 'advisor' } },
        { metric_value: 1, metadata: { feature: 'advisor' } },
        { metric_value: 1, metadata: { feature: 'insight' } },
        { metric_value: 1, metadata: { feature: 'insight' } },
        { metric_value: 1, metadata: { feature: 'insight' } },
        { metric_value: 1, metadata: { feature: 'insight' } },
      ],
    });
    expect(r.feedback).toBe(3);
    expect(r.views).toBe(8);
    expect(r.rate).toBe(Math.round((3 / 8) * 1000) / 1000);
    const advisor = r.byFeature.find((f) => f.feature === 'advisor');
    const insight = r.byFeature.find((f) => f.feature === 'insight');
    expect(advisor?.feedback).toBe(2);
    expect(advisor?.views).toBe(4);
    expect(advisor?.rate).toBe(0.5);
    expect(insight?.feedback).toBe(1);
    expect(insight?.views).toBe(4);
    expect(insight?.rate).toBe(0.25);
  });

  it('feature HANYA di views (tanpa feedback) → rate 0, tetap tampil', () => {
    const r = aggregateFeedbackRate({
      viewRows: [{ metric_value: 1, metadata: { feature: 'conversation' } }],
    });
    const conv = r.byFeature.find((f) => f.feature === 'conversation');
    expect(conv).toBeDefined();
    expect(conv?.feedback).toBe(0);
    expect(conv?.views).toBe(1);
    expect(conv?.rate).toBe(0);
    expect(r.rate).toBe(0);
  });

  it('feature HANYA di feedback (views 0) → rate 0 TANPA divide-by-zero', () => {
    const r = aggregateFeedbackRate({
      feedbackRows: [
        { feature: 'health', rating: 'not_helpful' },
        { feature: 'health', rating: 'helpful' },
      ],
    });
    expect(r.feedback).toBe(2);
    expect(r.views).toBe(0);
    expect(r.rate).toBe(0);
    expect(r.byFeature[0].rate).toBe(0);
  });

  it('metadata viewRows berupa string JSON → di-parse (defensive)', () => {
    const r = aggregateFeedbackRate({
      viewRows: [
        { metric_value: 1, metadata: JSON.stringify({ feature: 'advisor' }) },
        { metric_value: 1, metadata: '{corrupt' },
        { metric_value: 1, metadata: null },
      ],
    });
    const advisor = r.byFeature.find((f) => f.feature === 'advisor');
    expect(advisor?.views).toBe(1); // 1 valid + 2 defensif ke 'unknown'
    const unknown = r.byFeature.find((f) => f.feature === 'unknown');
    expect(unknown?.views).toBe(2);
  });

  it('metric_value dijumlahkan (baris tunggal bernilai N)', () => {
    const r = aggregateFeedbackRate({
      viewRows: [{ metric_value: 3, metadata: { feature: 'advisor' } }],
    });
    expect(r.views).toBe(3);
    expect(r.byFeature[0].views).toBe(3);
  });

  it('pembulatan 3 desimal (1/3 = 0.333)', () => {
    const r = aggregateFeedbackRate({
      feedbackRows: [{ feature: 'advisor', rating: 'helpful' }],
      viewRows: [
        { metric_value: 1, metadata: { feature: 'advisor' } },
        { metric_value: 1, metadata: { feature: 'advisor' } },
        { metric_value: 1, metadata: { feature: 'advisor' } },
      ],
    });
    expect(r.rate).toBe(0.333);
  });

  it('urutan byFeature: feedback desc dulu, lalu views desc', () => {
    const r = aggregateFeedbackRate({
      feedbackRows: [
        { feature: 'b', rating: 'helpful' },
        { feature: 'a', rating: 'helpful' },
        { feature: 'a', rating: 'helpful' },
      ],
      viewRows: [
        { metric_value: 1, metadata: { feature: 'b' } },
        { metric_value: 1, metadata: { feature: 'c' } },
      ],
    });
    expect(r.byFeature.map((f) => f.feature)).toEqual(['a', 'b', 'c']);
  });

  it('row feedback tanpa feature → key "unknown" dikelompokkan sendiri', () => {
    const r = aggregateFeedbackRate({
      feedbackRows: [{ rating: 'helpful' }],
      viewRows: [{ metric_value: 1, metadata: {} }],
    });
    const unknown = r.byFeature.find((f) => f.feature === 'unknown');
    expect(unknown?.feedback).toBe(1);
    expect(unknown?.views).toBe(1);
  });
});
