/**
 * Unit test: server/lib/telemetryUsers.js — agregasi daftar user dengan
 * aktivitas telemetry AI (dropdown view per-user admin monitoring, P10.2).
 *
 * Kontrak yang di-lock:
 *   - Merge activity system_metrics (recommendations = shown+opened, views =
 *     ai_result_shown) + feedback ai_feedback per user.
 *   - Label dari userRows (Better Auth `user`): email → name → userId.
 *   - Urut activity desc; cap MAX_TELEMETRY_USERS.
 *   - user_id null/unknown di-skip (defensive).
 *   - Tanpa data → [] (bukan error).
 */
import { describe, it, expect } from 'vitest';
import {
  aggregateTelemetryUsers,
  emptyTelemetryUsers,
  MAX_TELEMETRY_USERS,
} from '../../server/lib/telemetryUsers.js';

describe('aggregateTelemetryUsers', () => {
  it('merge aktivitas system_metrics (recommendations + views) dengan feedback per user', () => {
    const users = aggregateTelemetryUsers({
      activityRows: [
        { user_id: 'u1', recommendations: 4, views: 2 },
        { user_id: 'u2', recommendations: 0, views: 5 },
      ],
      feedbackRows: [{ user_id: 'u1', feedback: 1 }],
      userRows: [
        { id: 'u1', name: 'Dafa', email: 'demo@cashflow.test' },
        { id: 'u2', name: 'Beta', email: 'beta@cashflow.test' },
      ],
    });

    const u1 = users.find((u) => u.userId === 'u1');
    const u2 = users.find((u) => u.userId === 'u2');
    expect(u1).toMatchObject({ recommendations: 4, views: 2, feedback: 1, activity: 7, email: 'demo@cashflow.test', name: 'Dafa' });
    expect(u2).toMatchObject({ recommendations: 0, views: 5, feedback: 0, activity: 5 });
  });

  it('label fallback: email → name → userId', () => {
    const users = aggregateTelemetryUsers({
      activityRows: [{ user_id: 'u1', recommendations: 1, views: 0 }],
      feedbackRows: [],
      userRows: [{ id: 'u1', name: 'No Email', email: '' }],
    });
    expect(users[0].label).toBe('No Email');

    const onlyId = aggregateTelemetryUsers({
      activityRows: [{ user_id: 'uX', recommendations: 1, views: 0 }],
      feedbackRows: [],
      userRows: [], // user row hilang (user dihapus / orphaning)
    });
    expect(onlyId[0].label).toBe('uX');
    expect(onlyId[0].email).toBeNull();
  });

  it('urut activity desc (bukan urutan input)', () => {
    const users = aggregateTelemetryUsers({
      activityRows: [
        { user_id: 'low', recommendations: 1, views: 0 },
        { user_id: 'high', recommendations: 30, views: 10 },
        { user_id: 'mid', recommendations: 5, views: 5 },
      ],
      feedbackRows: [],
      userRows: [],
    });
    expect(users.map((u) => u.userId)).toEqual(['high', 'mid', 'low']);
  });

  it('user_id null / unknown di-skip (defensive)', () => {
    const users = aggregateTelemetryUsers({
      activityRows: [
        { user_id: null, recommendations: 9, views: 9 },
        { user_id: 'unknown', recommendations: 9, views: 9 },
        { user_id: 'u1', recommendations: 1, views: 0 },
      ],
      feedbackRows: [{ user_id: 'u1', feedback: 2 }],
      userRows: [],
    });
    expect(users).toHaveLength(1);
    expect(users[0].userId).toBe('u1');
  });

  it('cap MAX_TELEMETRY_USERS (dropdown ringkas)', () => {
    const activityRows = Array.from({ length: MAX_TELEMETRY_USERS + 50 }, (_, i) => ({
      user_id: `u-${i}`,
      recommendations: i + 1,
      views: 0,
    }));
    const users = aggregateTelemetryUsers({ activityRows, feedbackRows: [], userRows: [] });
    expect(users).toHaveLength(MAX_TELEMETRY_USERS);
    // Yang paling aktif tetap masuk (urutan desc dipertahankan).
    expect(users[0].userId).toBe(`u-${MAX_TELEMETRY_USERS + 49}`);
  });

  it('tanpa input → [] (bukan error)', () => {
    expect(aggregateTelemetryUsers()).toEqual([]);
    expect(aggregateTelemetryUsers({ activityRows: [], feedbackRows: [], userRows: [] })).toEqual([]);
  });

  it('nilai amount non-numeric diperlakukan 0', () => {
    const users = aggregateTelemetryUsers({
      activityRows: [{ user_id: 'u1', recommendations: 'abc', views: null }],
      feedbackRows: [],
      userRows: [],
    });
    expect(users[0]).toMatchObject({ recommendations: 0, views: 0, activity: 0 });
  });
});

describe('emptyTelemetryUsers', () => {
  it('bentuk kosong stabil { users: [] }', () => {
    expect(emptyTelemetryUsers()).toEqual({ users: [] });
  });
});
