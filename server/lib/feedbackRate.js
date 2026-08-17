/**
 * Feedback Rate (P10.2i — Closed Beta Instrumentation).
 *
 * Agregasi MURNI (tanpa DB) Feedback Rate dari dua sumber:
 *   - `ai_feedback`   — jumlah feedback user (numerator), dari tabel ai_feedback
 *   - `ai_result_shown` — jumlah tampilan kartu AI feedback-capable
 *                        (denominator "AI result views"), dari system_metrics
 *                        (POST /api/ai-product/track — whitelist P10.2i)
 *
 * Definisi canonical (PRODUCT_METRICS §2):
 *   feedback_rate = total ai_feedback ÷ total ai_result_shown
 *
 * Numerator & denominator SAMA-SAMA dari surface feedback-capable (semua kartu
 * yang me-render AiFeedbackButtons fire `ai_result_shown`) → scoping konsisten
 * (bukan page view, bukan timeline_view yang = GET list).
 *
 * Dipisah ke lib murni agar bisa di-unit-test tanpa DB & tanpa import
 * side-effect (pola recommendationEngagement.js / agentSearchEngagement.js).
 * Input rows raw: feedbackRows `{ feature, rating }` dan viewRows
 * `{ metric_value, metadata }` (metadata string JSON atau object — defensive).
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

/** rate 0..1 dibulatkan 3 desimal; 0 bila tanpa views (hindari divide-by-zero). */
const rateOf = (feedback, views) => (views > 0 ? Math.round((feedback / views) * 1000) / 1000 : 0);

/**
 * @param {{ feedbackRows?: Array, viewRows?: Array }} rows
 * @returns {{ feedback: number, views: number, rate: number,
 *            byFeature: Array<{feature: string, feedback: number, views: number, rate: number}> }}
 */
export function aggregateFeedbackRate({ feedbackRows = [], viewRows = [] } = {}) {
  const map = new Map();
  const bump = (feature, key, amount) => {
    const cur = map.get(feature) || { feature, feedback: 0, views: 0 };
    cur[key] += amount;
    map.set(feature, cur);
  };
  for (const row of feedbackRows) {
    bump(String(row?.feature || 'unknown'), 'feedback', 1);
  }
  for (const row of viewRows) {
    bump(String(safeMeta(row).feature || 'unknown'), 'views', Number(row.metric_value) || 1);
  }
  const byFeature = [...map.values()]
    .map((d) => ({ ...d, rate: rateOf(d.feedback, d.views) }))
    .sort((a, b) => b.feedback - a.feedback || b.views - a.views);
  const feedback = byFeature.reduce((a, d) => a + d.feedback, 0);
  const views = byFeature.reduce((a, d) => a + d.views, 0);
  return { feedback, views, rate: rateOf(feedback, views), byFeature };
}

export function emptyFeedbackRate() {
  return { feedback: 0, views: 0, rate: 0, byFeature: [] };
}
