/**
 * Unit test: server/services/alertNotifier.js — channel notifikasi alert
 * (MONITORING_AUDIT gap #1). Menguji bagian MURNI (tanpa DB/jaringan):
 * cooldown `shouldNotify` + shape payload webhook `buildWebhookPayload`.
 *
 * Pengiriman aktual (fetch webhook + INSERT notifications) di-cover oleh
 * smoke/server run — logika keputusan & format payload dijamin di sini.
 */
import { describe, it, expect, vi, afterEach } from 'vitest';
import { shouldNotify, buildWebhookPayload } from '../../server/services/alertNotifier.js';

const RULE = {
  name: 'agent_search_error_rate',
  metricName: 'agent_search_error_rate',
  status: 'triggered',
  currentValue: 0.5,
  threshold: 0.1,
  condition: 'gt',
  windowMinutes: 60,
};

describe('shouldNotify (cooldown)', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it('belum pernah notified → true (kirim)', () => {
    expect(shouldNotify(null)).toBe(true);
    expect(shouldNotify(undefined)).toBe(true);
    expect(shouldNotify('')).toBe(true);
  });

  it('baru notified (dalam cooldown) → false (skip)', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-08-02T12:00:00Z'));
    const last = new Date(Date.now() - 5 * 60_000).toISOString(); // 5 menit lalu
    expect(shouldNotify(last, 60 * 60_000)).toBe(false); // cooldown 60m
  });

  it('notified sudah lewat cooldown → true (kirim ulang)', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-08-02T12:00:00Z'));
    const last = new Date(Date.now() - 61 * 60_000).toISOString(); // 61 menit lalu
    expect(shouldNotify(last, 60 * 60_000)).toBe(true);
  });

  it('tepat di ambang cooldown (>=) → true', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-08-02T12:00:00Z'));
    const last = new Date(Date.now() - 60 * 60_000).toISOString();
    expect(shouldNotify(last, 60 * 60_000)).toBe(true);
  });

  it('timestamp korup → true (anggap belum notified, jangan lewatkan alert)', () => {
    expect(shouldNotify('bukan-timestamp')).toBe(true);
  });

  it('cooldown 0 → selalu kirim', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-08-02T12:00:00Z'));
    const last = new Date(Date.now() - 1000).toISOString();
    expect(shouldNotify(last, 0)).toBe(true);
  });
});

describe('buildWebhookPayload', () => {
  it('shape stabil: event + app + timestamp + rule lengkap', () => {
    const payload = buildWebhookPayload(RULE);
    expect(payload.event).toBe('alert.triggered');
    expect(payload.app).toBe('cashflow');
    expect(typeof payload.timestamp).toBe('string');
    expect(new Date(payload.timestamp).getTime()).not.toBeNaN();
    expect(payload.rule).toEqual(RULE);
  });

  it('tidak membawa field sensitif (hanya data rule)', () => {
    const payload = buildWebhookPayload(RULE);
    expect(Object.keys(payload.rule).sort()).toEqual([
      'condition', 'currentValue', 'metricName', 'name', 'status', 'threshold', 'windowMinutes',
    ]);
    expect(JSON.stringify(payload)).not.toMatch(/token|secret|key|password/i);
  });
});
