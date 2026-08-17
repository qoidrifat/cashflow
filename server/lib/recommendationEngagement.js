/**
 * Recommendation Engagement (P10.2 — Closed Beta Instrumentation).
 *
 * Agregasi MURNI (tanpa DB) funnel rekomendasi dari baris system_metrics:
 *   recommendation_shown    — rekomendasi dirender (denominator CTR)
 *   recommendation_opened   — rekomendasi dibuka user (numerator CTR)
 *
 * Dipisah ke lib murni agar bisa di-unit-test tanpa DB & tanpa import side-effect
 * (pola agentSearchEngagement.js). Dipakai metricsService.getRecommendationEngagement
 * dan tests/unit/recommendationEngagement.test.ts.
 *
 * Input rows raw Turso `{ metric_name, metric_value, metadata }` (metadata bisa
 * string JSON atau object — defensive). CTR = opened ÷ shown (0..1).
 */

function safeMeta(row) {
  if (!row?.metadata) return {};
  if (typeof row.metadata === 'object') return row.metadata;
  try {
    const parsed = JSON.parse(row.metadata);
    return parsed && typeof parsed === 'object' ? parsed : {};
  } catch {
    return {};
  }
}

const sum = (rows) => rows.reduce((a, r) => a + (Number(r.metric_value) || 0), 0);

/** CTR 0..1 dibulatkan 3 desimal; 0 bila tanpa shown (hindari divide-by-zero). */
const ctrOf = (shown, opened) => (shown > 0 ? Math.round((opened / shown) * 1000) / 1000 : 0);

/** 'YYYY-MM-DD HH:MM:SS' (space-format DB) atau ISO → 'YYYY-MM-DD'. */
function dayOf(row) {
  const raw = row?.created_at || row?.createdAt;
  const s = String(raw || '');
  return s.length >= 10 ? s.slice(0, 10) : null;
}

function countByFeature(rows) {
  const map = new Map();
  for (const row of rows) {
    const feature = String(safeMeta(row).feature || 'unknown');
    map.set(feature, (map.get(feature) || 0) + (Number(row.metric_value) || 0));
  }
  return [...map.entries()]
    .map(([feature, count]) => ({ feature, count }))
    .sort((a, b) => b.count - a.count);
}

/**
 * CTR per event_type (P10.2d): shown/opened/ctr dikelompokkan dari metadata
 * `eventType` (enum timeline kanonik). Tanpa eventType → 'unknown'. Urut total
 * aktivitas (shown+opened) desc. Murni — bisa di-unit-test.
 */
export function aggregateRecommendationByEventType({ shownRows = [], openedRows = [] } = {}) {
  const map = new Map();
  const bump = (rows, key) => {
    for (const row of rows) {
      const type = String(safeMeta(row).eventType || 'unknown');
      const cur = map.get(type) || { eventType: type, shown: 0, opened: 0 };
      cur[key] += Number(row.metric_value) || 0;
      map.set(type, cur);
    }
  };
  bump(shownRows, 'shown');
  bump(openedRows, 'opened');
  return [...map.values()]
    .map((d) => ({ ...d, ctr: ctrOf(d.shown, d.opened) }))
    .sort((a, b) => b.shown + b.opened - (a.shown + a.opened));
}

/**
 * @param {{ shownRows?: Array, openedRows?: Array }} rows
 * @returns {{ shown: number, opened: number, ctr: number, byFeature: Array<{feature: string, count: number}> }}
 */
export function aggregateRecommendationEngagement({ shownRows = [], openedRows = [] } = {}) {
  const shown = sum(shownRows);
  const opened = sum(openedRows);
  return {
    shown,
    opened,
    ctr: ctrOf(shown, opened),
    byFeature: countByFeature([...shownRows, ...openedRows]),
  };
}

export function emptyRecommendationEngagement() {
  return { shown: 0, opened: 0, ctr: 0, byFeature: [], byDay: [], byEventType: [] };
}

/**
 * Seri per-hari (panel admin "Rekomendasi AI"): shown/opened/ctr per tanggal
 * UTC (dari created_at baris). Hari tanpa aktivitas tidak muncul (hanya hari
 * dengan data). Urut tanggal naik.
 * @param {{ shownRows?: Array, openedRows?: Array }} rows
 * @returns {Array<{ date: string, shown: number, opened: number, ctr: number }>}
 */
export function aggregateRecommendationByDay({ shownRows = [], openedRows = [] } = {}) {
  const map = new Map();
  const bump = (rows, key) => {
    for (const row of rows) {
      const date = dayOf(row);
      if (!date) continue;
      const cur = map.get(date) || { date, shown: 0, opened: 0 };
      cur[key] += Number(row.metric_value) || 0;
      map.set(date, cur);
    }
  };
  bump(shownRows, 'shown');
  bump(openedRows, 'opened');
  return [...map.values()]
    .map((d) => ({ ...d, ctr: ctrOf(d.shown, d.opened) }))
    .sort((a, b) => (a.date < b.date ? -1 : 1));
}
