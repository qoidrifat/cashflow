/**
 * Agent Search Engagement (Sprint 1.9) — agregasi MURNI dari rows system_metrics
 * untuk metric agent_search_count / _click / _suggestion_used.
 *
 * Dipisah ke lib murni agar bisa di-unit-test tanpa DB dan tanpa import
 * side-effect (tidak meng-import turso/alertNotifier). Dipakai metricsService
 * (getAgentSearchEngagement) dan tests/unit/agentSearchEngagement.test.ts.
 *
 * Input rows berbentuk raw Turso rows `{ metric_name, metric_value, metadata }`
 * dengan metadata bisa string JSON atau object (defensive).
 *
 * CTR = klik hasil ÷ jumlah pencarian (berapa % pencarian berujung klik hasil).
 */

export function aggregateAgentSearchEngagement({ countRows = [], clickRows = [], suggestionRows = [] } = {}) {
  const sum = (rows) => rows.reduce((a, r) => a + (Number(r.metric_value) || 0), 0);
  const searches = sum(countRows);
  const clicks = sum(clickRows);
  const suggestionsUsed = sum(suggestionRows);

  const meta = (row) => {
    const m = row.metadata;
    if (!m) return {};
    if (typeof m === 'object') return m;
    try {
      return JSON.parse(m);
    } catch {
      return {};
    }
  };

  const groupByTab = (rows) => {
    const counts = new Map();
    for (const row of rows) {
      const tab = typeof meta(row).tab === 'string' ? meta(row).tab : 'unknown';
      counts.set(tab, (counts.get(tab) || 0) + (Number(row.metric_value) || 0));
    }
    return [...counts.entries()]
      .map(([tab, count]) => ({ tab, count }))
      .sort((a, b) => b.count - a.count);
  };

  // Top suggested queries — group suggestion_used rows by metadata.query.
  const queryCounts = new Map();
  for (const row of suggestionRows) {
    const q = typeof meta(row).query === 'string' ? meta(row).query.trim() : '';
    if (!q) continue;
    queryCounts.set(q, (queryCounts.get(q) || 0) + (Number(row.metric_value) || 0));
  }
  const topSuggestedQueries = [...queryCounts.entries()]
    .map(([query, count]) => ({ query, count }))
    .sort((a, b) => b.count - a.count)
    .slice(0, 8);

  return {
    searches,
    clicks,
    suggestionsUsed,
    ctr: searches > 0 ? Math.round((clicks / searches) * 1000) / 1000 : 0,
    topSuggestedQueries,
    clicksByTab: groupByTab(clickRows),
    suggestionsByTab: groupByTab(suggestionRows),
  };
}

/** Bentuk kosong (default) — konsisten untuk response tanpa data / DB down. */
export function emptyAgentSearchEngagement() {
  return { searches: 0, clicks: 0, suggestionsUsed: 0, ctr: 0, topSuggestedQueries: [], clicksByTab: [], suggestionsByTab: [] };
}
