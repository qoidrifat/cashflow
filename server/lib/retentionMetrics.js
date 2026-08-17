/**
 * Retention Metrics (P10.2 — Closed Beta Instrumentation).
 *
 * Agregasi MURNI (tanpa DB) retention D1/D7/D14/D28 dari cohort Better Auth
 * (`user.createdAt` epoch) + sinyal aktivitas `user_active` (system_metrics,
 * metadata.day = UTC YYYY-MM-DD — di-record httpMetricsMiddleware P10.1).
 *
 * Definisi:
 *   - Cohort day X = user yang registrasi pada hari UTC X.
 *   - Retention day-N = proporsi cohort day X yang AKTIF pada hari X+N
 *     (user_active hadir pada tanggal itu).
 *   - Guard: (a) hanya cohort dengan `users >= MIN_COHORT_USERS` dilaporkan;
 *     (b) hanya day-N yang jendela pengamatannya SUDAH TERCAPAI (today >=
 *     X+N) dilaporkan; (c) total cohort < MIN_COHORT_USERS → `cohortGuardActive`
 *     (tidak menampilkan angka kosong/menyesatkan).
 *
 * Dipisah ke lib murni agar bisa di-unit-test tanpa DB (pola
 * recommendationEngagement.js / agentSearchEngagement.js).
 */

export const MIN_COHORT_USERS = 10;
/** Offset hari yang dilaporkan. */
export const RETENTION_DAYS = [1, 7, 14, 28];

/** "2026-08-07" → "2026-08-07" (no-op); ISO dengan waktu → slice 10. */
function toDayKey(value) {
  if (!value) return null;
  const s = String(value);
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s;
  return s.slice(0, 10);
}

/**
 * createdAt Better Auth: INTEGER unixepoch (sekon) ATAU ISO string (defensive).
 * @returns {string|null} 'YYYY-MM-DD' UTC
 */
function epochSecToDayKey(createdAt) {
  if (typeof createdAt === 'string') {
    const d = new Date(createdAt);
    return Number.isNaN(d.getTime()) ? null : d.toISOString().slice(0, 10);
  }
  const n = Number(createdAt);
  if (!Number.isFinite(n) || n <= 0) return null;
  return new Date(n * 1000).toISOString().slice(0, 10);
}

function emptyRetention() {
  return {
    totalCohortUsers: 0,
    totalCohorts: 0,
    cohortGuardActive: true, // tanpa cohort → belum cukup data (UI empty state)
    cohorts: [],
    days: RETENTION_DAYS.map((d) => ({ day: d, users: 0, rate: null })),
  };
}

/**
 * Hitung retention per cohort-day.
 *
 * @param {{ id: string, createdAt: number|string }[]} cohortRecords
 *   Baris user (Better Auth): createdAt epoch (sekon).
 * @param {{ user_id: string, metadata: string|object }[]} activeRecords
 *   Baris system_metrics user_active: metadata.day = 'YYYY-MM-DD' UTC.
 * @param {Date} [nowRef] tanggal acuan (default now) — untuk guard window.
 * @returns {object} { totalCohortUsers, totalCohorts, cohortGuardActive, cohorts, days }
 *   cohorts: [{ day, users, d1, d7, d14, d28 }] — hanya cohort dengan users ≥ 10
 *   & minimal day-1 sudah tercapai; hari tak tercapai → null (bukan 0 palsu).
 *   days: ringkasan per offset (rate = mean rate cohort valid, atau null).
 */
export function computeRetention(cohortRecords = [], activeRecords = [], nowRef = new Date()) {
  if (!Array.isArray(cohortRecords) || cohortRecords.length === 0) return emptyRetention();
  const today = nowRef instanceof Date && !Number.isNaN(nowRef.getTime())
    ? nowRef.toISOString().slice(0, 10)
    : new Date().toISOString().slice(0, 10);

  // Aktif per (user, day) — dedupe (user_active bisa dobel per hari).
  const activeDays = new Set();
  for (const r of activeRecords) {
    const uid = r?.user_id || r?.userId;
    const day = toDayKey(typeof r?.metadata === 'object' ? r.metadata.day : (() => {
      try {
        return r.metadata ? JSON.parse(String(r.metadata)).day : null;
      } catch {
        return null;
      }
    })());
    if (uid && day) activeDays.add(`${uid}|${day}`);
  }
  const isActive = (uid, day) => activeDays.has(`${uid}|${day}`);

  // Cohort per day.
  const cohortByDay = new Map();
  for (const c of cohortRecords) {
    const day = epochSecToDayKey(c?.createdAt);
    if (!day) continue;
    if (!cohortByDay.has(day)) cohortByDay.set(day, []);
    cohortByDay.get(day).push(c.id || c.user_id);
  }

  const cohorts = [];
  for (const [day, userIds] of cohortByDay) {
    if (userIds.length < MIN_COHORT_USERS) continue; // guard (a)
    const row = { day, users: userIds.length, d1: null, d7: null, d14: null, d28: null };
    for (const offset of RETENTION_DAYS) {
      const target = dayOffsetKey(day, offset);
      if (!target || target > today) continue; // guard (b): window belum tercapai
      const active = userIds.filter((uid) => isActive(uid, target)).length;
      row[`d${offset}`] = Math.round((active / userIds.length) * 1000) / 1000;
    }
    if (row.d1 !== null) cohorts.push(row); // minimal day-1 tercapai
  }
  cohorts.sort((a, b) => (a.day < b.day ? -1 : 1));

  const allUsers = cohorts.reduce((a, c) => a + c.users, 0);

  const days = RETENTION_DAYS.map((offset) => {
    const rates = cohorts.map((c) => c[`d${offset}`]).filter((v) => v !== null);
    return {
      day: offset,
      users: cohorts.length,
      rate: rates.length > 0
        ? Math.round((rates.reduce((a, b) => a + b, 0) / rates.length) * 1000) / 1000
        : null,
    };
  });

  return {
    totalCohortUsers: allUsers,
    totalCohorts: cohorts.length,
    cohortGuardActive: allUsers < MIN_COHORT_USERS,
    cohorts,
    days,
  };
}

/** 'YYYY-MM-DD' + offset hari → 'YYYY-MM-DD' (UTC). */
function dayOffsetKey(day, offsetDays) {
  const d = new Date(`${day}T00:00:00Z`);
  if (Number.isNaN(d.getTime())) return null;
  d.setUTCDate(d.getUTCDate() + offsetDays);
  return d.toISOString().slice(0, 10);
}
