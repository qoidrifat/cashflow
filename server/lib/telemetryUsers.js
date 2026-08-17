/**
 * Telemetry Users (P10.2 — per-user view admin monitoring).
 *
 * Agregasi MURNI (tanpa DB) daftar user yang punya aktivitas telemetry AI
 * pada rentang — sumber dropdown "view per-user" di panel Rekomendasi AI &
 * Feedback Rate (QA memverifikasi telemetry satu user tanpa query Turso).
 *
 * Input rows raw Turso:
 *   activityRows: [{ user_id, recommendations, views }] — hasil
 *     `SELECT user_id, SUM(...) ... FROM system_metrics WHERE metric_name IN
 *     ('recommendation_shown','recommendation_opened','ai_result_shown')
 *     GROUP BY user_id` (metric_value dijumlahkan per keluarga event).
 *   feedbackRows: [{ user_id, feedback }] — `SELECT user_id, COUNT(*)
 *     FROM ai_feedback GROUP BY user_id`.
 *   userRows: [{ id, name, email }] — label dari tabel Better Auth `user`
 *     (system_metrics.user_id FK → user.id; req.user.id ditulis ke kedua tabel).
 *
 * Dipisah ke lib murni agar bisa di-unit-test tanpa DB (pola
 * recommendationEngagement.js / feedbackRate.js). Dipakai
 * metricsService.getTelemetryUsers dan tests/unit/telemetryUsers.test.ts.
 */

/** Batas user yang dikembalikan (dropdown ringkas; 10-30 user beta riil). */
export const MAX_TELEMETRY_USERS = 200;

/**
 * @param {{ activityRows?: Array, feedbackRows?: Array, userRows?: Array }} rows
 * @returns {Array<{ userId: string, name: string|null, email: string|null,
 *           label: string, recommendations: number, views: number,
 *           feedback: number, activity: number }>}
 *   Urut activity (recommendations+views+feedback) desc; cap MAX_TELEMETRY_USERS.
 */
export function aggregateTelemetryUsers({ activityRows = [], feedbackRows = [], userRows = [] } = {}) {
  const userLookup = new Map(userRows.map((u) => [String(u?.id), u]));
  const map = new Map();

  const bump = (userId, key, amount) => {
    const id = String(userId || '');
    if (!id || id === 'unknown' || id === 'null' || id === 'undefined') return;
    const cur = map.get(id) || { userId: id, recommendations: 0, views: 0, feedback: 0 };
    cur[key] += Number(amount) || 0;
    map.set(id, cur);
  };

  for (const row of activityRows) {
    bump(row?.user_id, 'recommendations', row?.recommendations || 0);
    bump(row?.user_id, 'views', row?.views || 0);
  }
  for (const row of feedbackRows) {
    bump(row?.user_id, 'feedback', row?.feedback || 0);
  }

  return [...map.values()]
    .map((u) => {
      const row = userLookup.get(u.userId);
      const name = row?.name ? String(row.name) : null;
      const email = row?.email ? String(row.email) : null;
      return {
        ...u,
        name,
        email,
        label: email || name || u.userId,
        activity: u.recommendations + u.views + u.feedback,
      };
    })
    .sort((a, b) => b.activity - a.activity)
    .slice(0, MAX_TELEMETRY_USERS);
}

export function emptyTelemetryUsers() {
  return { users: [] };
}
