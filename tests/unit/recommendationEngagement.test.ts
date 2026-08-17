/**
 * Unit test: server/lib/recommendationEngagement.js — funnel rekomendasi
 * (P10.2): recommendation_shown/_opened → CTR. Murni (tanpa DB).
 *
 * Kontrak yang dikunci:
 *  - CTR = opened ÷ shown (0..1), 0 bila tanpa shown (hindari divide-by-zero).
 *  - Metadata string JSON ATAU object diterima (defensive).
 *  - byFeature dikelompokkan dari shown+opened (metadata.feature).
 *  - emptyRecommendationEngagement = bentuk default stabil.
 */
import { describe, it, expect } from 'vitest';
import {
  aggregateRecommendationEngagement,
  aggregateRecommendationByDay,
  aggregateRecommendationByEventType,
  emptyRecommendationEngagement,
} from '../../server/lib/recommendationEngagement.js';

const shown = (v = 1, feature = 'advisor', metaExtra = {}) => ({
  metric_name: 'recommendation_shown',
  metric_value: v,
  metadata: JSON.stringify({ feature, ...metaExtra }),
});
const opened = (v = 1, feature = 'advisor') => ({
  metric_name: 'recommendation_opened',
  metric_value: v,
  metadata: JSON.stringify({ feature }),
});

describe('aggregateRecommendationByDay — seri per-hari (panel admin)', () => {
  const row = (metric: string, day: string, v = 1) => ({
    metric_name: metric,
    metric_value: v,
    metadata: JSON.stringify({ feature: 'advisor' }),
    created_at: `${day} 09:00:00`, // space-format DB
  });

  it('grup per hari: shown/opened/ctr dihitung per tanggal, urut naik', () => {
    const r = aggregateRecommendationByDay({
      shownRows: [row('recommendation_shown', '2026-08-01', 10), row('recommendation_shown', '2026-08-02', 5)],
      openedRows: [row('recommendation_opened', '2026-08-01', 3)],
    });
    expect(r).toEqual([
      { date: '2026-08-01', shown: 10, opened: 3, ctr: 0.3 },
      { date: '2026-08-02', shown: 5, opened: 0, ctr: 0 },
    ]);
  });

  it('ISO created_at juga diterima (slice 10)', () => {
    const r = aggregateRecommendationByDay({
      shownRows: [{ metric_name: 'recommendation_shown', metric_value: 4, metadata: {}, created_at: '2026-08-03T10:00:00.000Z' }],
      openedRows: [],
    });
    expect(r[0].date).toBe('2026-08-03');
    expect(r[0].shown).toBe(4);
  });

  it('tanpa created_at → baris diabaikan (tidak crash); kosong → []', () => {
    const r = aggregateRecommendationByDay({
      shownRows: [{ metric_name: 'recommendation_shown', metric_value: 1, metadata: {} }],
      openedRows: [],
    });
    expect(r).toEqual([]);
  });
});

describe('aggregateRecommendationEngagement', () => {
  it('kosong → bentuk default (semua 0)', () => {
    expect(aggregateRecommendationEngagement({})).toEqual({ shown: 0, opened: 0, ctr: 0, byFeature: [] });
    expect(emptyRecommendationEngagement()).toEqual({ shown: 0, opened: 0, ctr: 0, byFeature: [], byDay: [], byEventType: [] });
  });

  it('CTR = opened ÷ shown', () => {
    const r = aggregateRecommendationEngagement({
      shownRows: [shown(10), shown(1)],   // 11 shown
      openedRows: [opened(3), opened(1)], // 4 opened
    });
    expect(r.shown).toBe(11);
    expect(r.opened).toBe(4);
    expect(r.ctr).toBeCloseTo(4 / 11, 3);
  });

  it('tanpa shown → ctr 0 (bukan NaN/Infinity)', () => {
    const r = aggregateRecommendationEngagement({ openedRows: [opened(2)] });
    expect(r.shown).toBe(0);
    expect(r.opened).toBe(2);
    expect(r.ctr).toBe(0);
  });

  it('metadata object langsung (bukan string) diterima', () => {
    const r = aggregateRecommendationEngagement({
      shownRows: [{ metric_name: 'recommendation_shown', metric_value: 5, metadata: { feature: 'insight' } }],
      openedRows: [{ metric_name: 'recommendation_opened', metric_value: 1, metadata: { feature: 'insight' } }],
    });
    expect(r.shown).toBe(5);
    expect(r.opened).toBe(1);
    expect(r.ctr).toBe(0.2);
    expect(r.byFeature).toEqual([{ feature: 'insight', count: 6 }]);
  });

  it('metadata rusak (bukan JSON) → diabaikan tanpa throw, feature unknown', () => {
    const r = aggregateRecommendationEngagement({
      shownRows: [{ metric_name: 'recommendation_shown', metric_value: 3, metadata: 'not-json{{' }],
      openedRows: [],
    });
    expect(r.shown).toBe(3);
    expect(r.byFeature).toEqual([{ feature: 'unknown', count: 3 }]);
  });

  it('byFeature menggabungkan shown+opened per feature, urut count desc', () => {
    const r = aggregateRecommendationEngagement({
      shownRows: [shown(10, 'advisor'), shown(2, 'insight')],
      openedRows: [opened(1, 'advisor')],
    });
    expect(r.byFeature).toEqual([
      { feature: 'advisor', count: 11 },
      { feature: 'insight', count: 2 },
    ]);
  });

  it('metric_value non-numerik diperlakukan 0 (defensive)', () => {
    const r = aggregateRecommendationEngagement({
      shownRows: [{ metric_name: 'recommendation_shown', metric_value: 'abc', metadata: {} }],
      openedRows: [],
    });
    expect(r.shown).toBe(0);
    expect(r.ctr).toBe(0);
  });
});

describe('aggregateRecommendationByEventType — CTR per event_type (P10.2d)', () => {
  const shownRow = (v = 1, eventType = 'recommendation', extra = {}) => ({
    metric_name: 'recommendation_shown',
    metric_value: v,
    metadata: JSON.stringify({ feature: 'advisor', eventType, ...extra }),
  });
  const openedRow = (v = 1, eventType = 'recommendation') => ({
    metric_name: 'recommendation_opened',
    metric_value: v,
    metadata: JSON.stringify({ feature: 'advisor', eventType }),
  });

  it('CTR per event type dihitung dari metadata.eventType, urut total desc', () => {
    const r = aggregateRecommendationByEventType({
      shownRows: [shownRow(10, 'recommendation'), shownRow(5, 'insight')],
      openedRows: [openedRow(2, 'recommendation'), openedRow(1, 'insight')],
    });
    expect(r).toEqual([
      { eventType: 'recommendation', shown: 10, opened: 2, ctr: 0.2 },
      { eventType: 'insight', shown: 5, opened: 1, ctr: 0.2 },
    ]);
  });

  it('tanpa metadata.eventType → unknown (defensive); kosong → []', () => {
    expect(
      aggregateRecommendationByEventType({
        shownRows: [{ metric_name: 'recommendation_shown', metric_value: 3, metadata: {} }],
        openedRows: [],
      }),
    ).toEqual([{ eventType: 'unknown', shown: 3, opened: 0, ctr: 0 }]);
    expect(aggregateRecommendationByEventType({})).toEqual([]);
  });

  it('metadata object langsung (bukan string) diterima; ctr zero-divide aman', () => {
    const r = aggregateRecommendationByEventType({
      shownRows: [{ metric_name: 'recommendation_shown', metric_value: 5, metadata: { eventType: 'insight' } }],
      openedRows: [{ metric_name: 'recommendation_opened', metric_value: 0, metadata: { eventType: 'insight' } }],
    });
    expect(r).toEqual([{ eventType: 'insight', shown: 5, opened: 0, ctr: 0 }]);
  });
});
