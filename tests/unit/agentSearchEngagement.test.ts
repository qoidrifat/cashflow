/**
 * Unit tests — aggregateAgentSearchEngagement (server/lib/agentSearchEngagement.js).
 * Agregasi AI Search engagement: count/click/suggestion_used → CTR, top
 * suggested queries, breakdown per tab. Murni (tanpa DB).
 */
import { describe, expect, it } from 'vitest';
import { aggregateAgentSearchEngagement, emptyAgentSearchEngagement } from '../../server/lib/agentSearchEngagement.js';

const countRow = (v = 1, tab = 'transactions') => ({
  metric_name: 'agent_search_count', metric_value: v, metadata: JSON.stringify({ tab }),
});
const clickRow = (v = 1, tab = 'transactions', query = 'tiket') => ({
  metric_name: 'agent_search_click', metric_value: v, metadata: JSON.stringify({ tab, query, resultId: 'r1' }),
});
const sugRow = (v = 1, tab = 'transactions', query = 'makanan terdekat') => ({
  metric_name: 'agent_search_suggestion_used', metric_value: v, metadata: JSON.stringify({ tab, query }),
});

describe('aggregateAgentSearchEngagement', () => {
  it('kosong → semua nol + array kosong (bentuk default)', () => {
    expect(aggregateAgentSearchEngagement({})).toEqual(emptyAgentSearchEngagement());
  });

  it('CTR = klik ÷ pencarian', () => {
    const r = aggregateAgentSearchEngagement({ countRows: [countRow(10)], clickRows: [clickRow(3)] });
    expect(r.searches).toBe(10);
    expect(r.clicks).toBe(3);
    expect(r.suggestionsUsed).toBe(0);
    expect(r.ctr).toBe(0.3);
  });

  it('CTR 0 bila tidak ada pencarian (hindari divide-by-zero)', () => {
    const r = aggregateAgentSearchEngagement({ clickRows: [clickRow(2)] });
    expect(r.searches).toBe(0);
    expect(r.clicks).toBe(2);
    expect(r.ctr).toBe(0);
  });

  it('top suggested queries di-group (query sama lintas tab) + urut count desc', () => {
    const r = aggregateAgentSearchEngagement({
      suggestionRows: [
        sugRow(1, 'transactions', 'makanan'),
        sugRow(1, 'gmail', 'makanan'),
        sugRow(1, 'transactions', 'gaji'),
        sugRow(1, 'help', 'sisa'),
      ],
    });
    expect(r.suggestionsUsed).toBe(4);
    expect(r.topSuggestedQueries[0]).toEqual({ query: 'makanan', count: 2 });
    expect(r.topSuggestedQueries).toHaveLength(3);
  });

  it('query kosong/absen tidak masuk top queries', () => {
    const r = aggregateAgentSearchEngagement({
      suggestionRows: [
        sugRow(1, 'help', ''),
        { metric_name: 'x', metric_value: 1, metadata: '{}' },
      ],
    });
    expect(r.topSuggestedQueries).toEqual([]);
  });

  it('metadata string JSON maupun object didukung (defensive)', () => {
    const r = aggregateAgentSearchEngagement({
      clickRows: [{ metric_name: 'c', metric_value: 1, metadata: { tab: 'transactions' } }],
    });
    expect(r.clicksByTab).toEqual([{ tab: 'transactions', count: 1 }]);
  });

  it('metadata rusak → tab fallback unknown', () => {
    const r = aggregateAgentSearchEngagement({
      clickRows: [{ metric_name: 'c', metric_value: 1, metadata: 'not-json' }],
    });
    expect(r.clicksByTab).toEqual([{ tab: 'unknown', count: 1 }]);
  });

  it('group by tab + urut count desc', () => {
    const r = aggregateAgentSearchEngagement({
      clickRows: [clickRow(2, 'gmail'), clickRow(5, 'transactions')],
      suggestionRows: [sugRow(1, 'transactions')],
    });
    expect(r.clicksByTab).toEqual([{ tab: 'transactions', count: 5 }, { tab: 'gmail', count: 2 }]);
    expect(r.suggestionsByTab).toEqual([{ tab: 'transactions', count: 1 }]);
  });

  it('cap top suggested queries di 8', () => {
    const suggestionRows = Array.from({ length: 12 }, (_, i) => sugRow(1, 'help', `query-${i}`));
    const r = aggregateAgentSearchEngagement({ suggestionRows });
    expect(r.topSuggestedQueries).toHaveLength(8);
    expect(r.suggestionsUsed).toBe(12);
  });
});
