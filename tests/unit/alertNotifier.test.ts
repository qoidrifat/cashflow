/**
 * Unit test: server/services/alertNotifier.js — channel notifikasi alert
 * (MONITORING_AUDIT gap #1). Menguji bagian MURNI (tanpa DB/jaringan):
 * cooldown `shouldNotify` + shape payload webhook `buildWebhookPayload` +
 * keputusan email SMTP `shouldSendAlertEmail` + payload email `buildAlertEmailPayload`.
 *
 * Pengiriman aktual (fetch webhook + sendMail SMTP + INSERT notifications)
 * di-cover oleh smoke/server run — logika keputusan & format payload dijamin di sini.
 */
import { describe, it, expect, vi, afterEach } from 'vitest';
import {
  shouldNotify,
  buildWebhookPayload,
  shouldSendAlertEmail,
  buildAlertEmailPayload,
} from '../../server/services/alertNotifier.js';

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

const SMTP_ENV = {
  SMTP_HOST: 'smtp.example.com',
  SMTP_PORT: '587',
  SMTP_USER: 'alerts@example.com',
  SMTP_PASS: 'secret',
  SMTP_FROM: 'CashFlow <alerts@example.com>',
};

describe('shouldSendAlertEmail (keputusan channel SMTP)', () => {
  it('SMTP lengkap + ada admin → true', () => {
    expect(shouldSendAlertEmail(SMTP_ENV, ['admin@example.com'])).toBe(true);
  });

  it('SMTP_HOST hilang → false (skip silently)', () => {
    const { SMTP_HOST, ...rest } = SMTP_ENV;
    expect(shouldSendAlertEmail(rest, ['admin@example.com'])).toBe(false);
  });

  it('SMTP_USER hilang → false', () => {
    const { SMTP_USER, ...rest } = SMTP_ENV;
    expect(shouldSendAlertEmail(rest, ['admin@example.com'])).toBe(false);
  });

  it('SMTP_PASS hilang → false', () => {
    const { SMTP_PASS, ...rest } = SMTP_ENV;
    expect(shouldSendAlertEmail(rest, ['admin@example.com'])).toBe(false);
  });

  it('var SMTP hanya whitespace → false', () => {
    expect(shouldSendAlertEmail({ SMTP_HOST: '  ', SMTP_USER: '', SMTP_PASS: 'x' }, ['a@b.c'])).toBe(false);
  });

  it('ADMIN_EMAILS kosong → false (skip gracefully, tidak throw)', () => {
    expect(shouldSendAlertEmail(SMTP_ENV, [])).toBe(false);
  });

  it('admin emails bukan array → false', () => {
    expect(shouldSendAlertEmail(SMTP_ENV, undefined as unknown as string[])).toBe(false);
  });

  it('SMTP_PORT/FROM tidak wajib (ada default/fallback)', () => {
    expect(shouldSendAlertEmail({ SMTP_HOST: 'h', SMTP_USER: 'u', SMTP_PASS: 'p' }, ['a@b.c'])).toBe(true);
  });
});

describe('buildAlertEmailPayload', () => {
  it('subject memuat nama rule + ringkasan metric/threshold', () => {
    const { subject } = buildAlertEmailPayload(RULE);
    expect(subject).toBe('[CashFlow Alert] agent_search_error_rate — agent_search_error_rate gt 0.1');
  });

  it('body plain-text memuat rule, metric, threshold, nilai, timestamp', () => {
    const { text, timestamp } = buildAlertEmailPayload(RULE);
    expect(text).toContain('agent_search_error_rate');
    expect(text).toContain('gt 0.1');
    expect(text).toContain('0.5');
    expect(text).toContain('60');
    expect(new Date(timestamp).getTime()).not.toBeNaN();
    expect(text).toContain(timestamp);
  });

  it('tidak membawa field sensitif', () => {
    const { subject, text } = buildAlertEmailPayload(RULE);
    expect(`${subject}\n${text}`).not.toMatch(/token|secret|key|password/i);
  });
});
