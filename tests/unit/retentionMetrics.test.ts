/**
 * Unit test: server/lib/retentionMetrics.js — retention D1/D7/D14/D28 (P10.2).
 *
 * Kontrak yang dikunci:
 *  - Cohort per hari registrasi (UTC) dari createdAt epoch (Better Auth).
 *  - Retention day-N = proporsi cohort aktif pada hari+N (via user_active).
 *  - Guard (a): cohort < 10 user TIDAK dilaporkan.
 *  - Guard (b): day-N dengan jendela belum tercapai → null (bukan 0 palsu).
 *  - Guard (c): total cohort < 10 → cohortGuardActive = true (empty state UI).
 *  - Dedupe user_active ganda per (user, hari) — tidak menggandakan numerator.
 *  - createdAt ISO string juga diterima (defensive).
 */
import { describe, it, expect } from 'vitest';
import {
  computeRetention,
  MIN_COHORT_USERS,
  RETENTION_DAYS,
} from '../../server/lib/retentionMetrics.js';

const D = '2026-08-01'; // anchor hari registrasi
/** Epoch sekon untuk tanggal UTC (dari Date.UTC). */
const epochOf = (day: string): number => {
  const [y, m, d] = day.split('-').map(Number);
  return Math.floor(Date.UTC(y, m - 1, d) / 1000);
};
const dayOffset = (day: string, offset: number): string => {
  const [y, m, d] = day.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d + offset)).toISOString().slice(0, 10);
};

/** Cohort record sederhana: id + createdAt epoch. */
const cohort = (n: number, createdAt: number): Array<{ id: string; createdAt: number }> =>
  Array.from({ length: n }, (_, i) => ({ id: `u-${createdAt}-${i}`, createdAt }));

/** Active record: user_id + metadata.day (bentuk system_metrics). */
const active = (uid: string, day: string) => ({ user_id: uid, metadata: JSON.stringify({ day }) });

describe('computeRetention — math dasar', () => {
  it('D1 = proporsi cohort yang aktif tepat hari+1', () => {
    const N = 10;
    const created = epochOf(D);
    const users = cohort(N, created);
    // 7 dari 10 aktif pada hari+1
    const actives = users.slice(0, 7).map((u) => active(u.id, dayOffset(D, 1)));
    const res = computeRetention(users, actives, new Date(`${dayOffset(D, 30)}T00:00:00Z`));
    expect(res.totalCohortUsers).toBe(N);
    expect(res.totalCohorts).toBe(1);
    expect(res.cohortGuardActive).toBe(false);
    expect(res.cohorts[0].d1).toBeCloseTo(0.7, 3);
    // window D+30 sudah lewat D+7 — tidak ada user aktif → 0 (bukan null)
    expect(res.cohorts[0].d7).toBe(0);
    expect(res.days.find((d) => d.day === 1)?.rate).toBeCloseTo(0.7, 3);
  });

  it('D7/D14/D28 terisi penuh bila jendela tercapai', () => {
    const N = 10;
    const created = epochOf(D);
    const users = cohort(N, created);
    // seluruh user aktif pada D+7, D+14, dan D+28
    const all = users.flatMap((u) => [
      active(u.id, dayOffset(D, 7)),
      active(u.id, dayOffset(D, 14)),
      active(u.id, dayOffset(D, 28)),
    ]);
    const res = computeRetention(users, all, new Date(`${dayOffset(D, 60)}T00:00:00Z`));
    expect(res.cohorts[0].d7).toBeCloseTo(1, 3);
    expect(res.cohorts[0].d14).toBeCloseTo(1, 3);
    expect(res.cohorts[0].d28).toBeCloseTo(1, 3);
  });

  it('dedupe user_active ganda per (user, hari) — numerator tidak digandakan', () => {
    const N = 10;
    const created = epochOf(D);
    const users = cohort(N, created);
    const actives = users.slice(0, 3).flatMap((u) => [
      active(u.id, dayOffset(D, 1)),
      active(u.id, dayOffset(D, 1)), // duplikat
      active(u.id, dayOffset(D, 1)),
    ]);
    const res = computeRetention(users, actives, new Date(`${dayOffset(D, 30)}T00:00:00Z`));
    expect(res.cohorts[0].d1).toBeCloseTo(0.3, 3);
  });

  it('createdAt ISO string juga diterima (defensive)', () => {
    const users = cohort(10, epochOf(D)).map((u, i) => ({ id: `iso-${i}`, createdAt: `${D}T00:00:00.000Z` }));
    const actives = users.slice(0, 5).map((u) => active(u.id, dayOffset(D, 1)));
    const res = computeRetention(users, actives, new Date(`${dayOffset(D, 30)}T00:00:00Z`));
    expect(res.totalCohorts).toBe(1);
    expect(res.cohorts[0].d1).toBeCloseTo(0.5, 3);
  });
});

describe('computeRetention — guard sample & window', () => {
  it('cohort < MIN_COHORT_USERS tidak dilaporkan + cohortGuardActive', () => {
    const users = cohort(MIN_COHORT_USERS - 1, epochOf(D));
    const res = computeRetention(users, [], new Date(`${dayOffset(D, 30)}T00:00:00Z`));
    expect(res.cohorts).toEqual([]);
    expect(res.totalCohorts).toBe(0);
    expect(res.cohortGuardActive).toBe(true);
  });

  it('tepat MIN_COHORT_USERS → cohort dilaporkan, guard off', () => {
    const users = cohort(MIN_COHORT_USERS, epochOf(D));
    const actives = users.slice(0, 10).map((u) => active(u.id, dayOffset(D, 1)));
    const res = computeRetention(users, actives, new Date(`${dayOffset(D, 30)}T00:00:00Z`));
    expect(res.cohorts.length).toBe(1);
    expect(res.cohortGuardActive).toBe(false);
  });

  it('day-N jendela belum tercapai → null (bukan 0 palsu)', () => {
    const N = 10;
    const users = cohort(N, epochOf(D));
    // Anchor hari ini = D+2 → hanya D1 yang tercapai
    const res = computeRetention(users, [], new Date(`${dayOffset(D, 2)}T00:00:00Z`));
    expect(res.cohorts[0].d1).toBe(0); // tercapai, 0 aktif
    expect(res.cohorts[0].d7).toBe(null);
    expect(res.cohorts[0].d14).toBe(null);
    expect(res.cohorts[0].d28).toBe(null);
  });

  it('cohort 10 user 40 hari lalu, aktivitas bervariasi per offset → rate EKSAK 1.0/0.6/0.4/0.2', () => {
    // P10.2k: pola fixture E2E panel retention (e2e/admin-monitoring-retention
    // spec) — kunci matematika yang di-seed: D+1 10/10 · D+7 6/10 · D+14 4/10
    // · D+28 2/10 → rate persis (bulat 3 desimal), semua jendela tercapai.
    const cohortDay = dayOffset(D, -40);
    const N = 10;
    const users = cohort(N, epochOf(cohortDay));
    const actives = [
      ...users.slice(0, 10).map((u) => active(u.id, dayOffset(cohortDay, 1))),
      ...users.slice(0, 6).map((u) => active(u.id, dayOffset(cohortDay, 7))),
      ...users.slice(0, 4).map((u) => active(u.id, dayOffset(cohortDay, 14))),
      ...users.slice(0, 2).map((u) => active(u.id, dayOffset(cohortDay, 28))),
    ];
    const res = computeRetention(users, actives, new Date(`${dayOffset(D, 0)}T00:00:00Z`));
    expect(res.cohortGuardActive).toBe(false);
    expect(res.cohorts.length).toBe(1);
    expect(res.cohorts[0].d1).toBe(1);
    expect(res.cohorts[0].d7).toBe(0.6);
    expect(res.cohorts[0].d14).toBe(0.4);
    expect(res.cohorts[0].d28).toBe(0.2);
    const byDay = Object.fromEntries(res.days.map((d) => [d.day, d.rate]));
    expect(byDay[1]).toBe(1);
    expect(byDay[7]).toBe(0.6);
    expect(byDay[14]).toBe(0.4);
    expect(byDay[28]).toBe(0.2);
  });

  it('multi cohort hari berbeda — setiap cohort dihitung independen', () => {
    const dayA = D;
    const dayB = dayOffset(D, 5);
    const users = [...cohort(10, epochOf(dayA)), ...cohort(10, epochOf(dayB))];
    // 5 user cohort A aktif di A+1; 8 user cohort B aktif di B+1
    const actives = [
      ...users.slice(0, 5).map((u) => active(u.id, dayOffset(dayA, 1))),
      ...users.slice(10, 18).map((u) => active(u.id, dayOffset(dayB, 1))),
    ];
    const res = computeRetention(users, actives, new Date(`${dayOffset(dayB, 40)}T00:00:00Z`));
    expect(res.totalCohorts).toBe(2);
    const byDay = Object.fromEntries(res.cohorts.map((c) => [c.day, c]));
    expect(byDay[dayA].d1).toBeCloseTo(0.5, 3);
    expect(byDay[dayB].d1).toBeCloseTo(0.8, 3);
    // ringkasan days = mean rate cohort valid
    expect(res.days.find((d) => d.day === 1)?.rate).toBeCloseTo(0.65, 3);
  });

  it('tanpa cohort → bentuk default stabil + guard aktif', () => {
    const res = computeRetention([], [], new Date());
    expect(res).toEqual({
      totalCohortUsers: 0,
      totalCohorts: 0,
      cohortGuardActive: true,
      cohorts: [],
      days: RETENTION_DAYS.map((d) => ({ day: d, users: 0, rate: null })),
    });
  });
});
