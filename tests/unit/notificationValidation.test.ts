/**
 * Unit test: server/routes/notificationRoutes.js — P1-2 Validation Layer (Group G2).
 *
 * Menguji skema POST /api/notifications + validator actionHref sebagai
 * komposisi MURNI validateBody(schema) — tanpa Express/DB. Whitelist type
 * berasal dari NotificationType (src/types/index.ts) dan sama persis dengan
 * filter GET (ALLOWED_TYPES lama) sehingga producer client-side
 * (notificationService/notificationTriggers/useAppStore) tidak pernah
 * tertolak; producer server (alertNotifier) INSERT langsung ke DB.
 *
 * Kontrol P1-4 (sanitizeNotificationMetadata, dedupeKey slice 200) TIDAK
 * diuji ulang di sini — sudah tercakup tests/unit/notificationMetadataGuard.test.ts.
 */
import { describe, it, expect } from 'vitest';
import { validateBody } from '../../server/lib/validation.js';
import {
  NOTIFICATION_TYPES,
  NOTIFICATION_PRIORITIES,
  NOTIFICATION_CREATE_SCHEMA,
  validateActionHref,
} from '../../server/routes/notificationRoutes.js';

describe('NOTIFICATION_CREATE_SCHEMA (POST /api/notifications)', () => {
  const validNotification = {
    type: 'success',
    priority: 'low',
    title: 'Transaksi Gmail diterima',
    message: 'E2E Merchant Rp 125.000 berhasil disimpan.',
    read: false,
    actionLabel: 'Lihat Review',
    actionHref: '/gmail-sync',
  };

  it('payload khas client lolos; field tak dikenal dibuang', () => {
    const res = validateBody({ ...validNotification, hackerField: 'evil' }, NOTIFICATION_CREATE_SCHEMA);
    expect(res.ok).toBe(true);
    expect(res.value).toEqual(validNotification);
    expect(res.value).not.toHaveProperty('hackerField');
  });

  it('SEMUA payload trigger client yang sah lolos (backwards compatibility)', () => {
    const realWorldPayloads = [
      // notificationTriggers: ringkasan sync Gmail.
      { type: 'gmail', priority: 'normal', title: 'Transaksi Gmail menunggu review', message: '3 transaksi perlu dicek.', actionHref: '/gmail-sync', actionLabel: 'Lihat Review' },
      // notificationTriggers: sukses tanpa review.
      { type: 'success', priority: 'low', title: 'Sinkronisasi Gmail selesai', message: '5 transaksi diterima otomatis.', actionHref: '/gmail-sync', actionLabel: 'Lihat Ringkasan' },
      // notificationTriggers: transaksi confidence rendah.
      { type: 'transaction', priority: 'normal', title: 'Transaksi perlu ditinjau', message: 'Kopi - Rp 25.000.', actionHref: '/transactions', actionLabel: 'Lihat Transaksi' },
      // budgetNotificationUtils: warning & over.
      { type: 'budget', priority: 'normal', title: 'Budget Makan hampir penuh', message: 'Pemakaian sudah 85%.' },
      { type: 'budget', priority: 'high', title: 'Budget Makan terlampaui', message: 'Melewati batas Rp 50.000.' },
      // e2e notification-metadata-guard (payload 200 historis).
      { type: 'success', title: 'Transaksi Gmail diterima', message: 'forged approve' },
      // tanpa priority/read (default route: 'normal'/false).
      { type: 'info', title: 't', message: 'm' },
    ];
    for (const payload of realWorldPayloads) {
      const res = validateBody(payload, NOTIFICATION_CREATE_SCHEMA);
      expect(res.ok, JSON.stringify(payload)).toBe(true);
    }
  });

  it('whitelist type = 8 nilai kanonik NotificationType; di luar itu ditolak', () => {
    expect(Array.from(NOTIFICATION_TYPES).sort()).toEqual(
      ['budget', 'error', 'gmail', 'info', 'success', 'system', 'transaction', 'warning'].sort(),
    );
    for (const type of NOTIFICATION_TYPES) {
      expect(validateBody({ type, title: 't', message: 'm' }, NOTIFICATION_CREATE_SCHEMA).ok, type).toBe(true);
    }
    const res = validateBody({ type: 'alert', title: 't', message: 'm' }, NOTIFICATION_CREATE_SCHEMA);
    expect(res.ok).toBe(false);
    expect(res.error).toContain('type');
  });

  it('type & title & message wajib diisi; kosong/absen ditolak', () => {
    expect(validateBody({ title: 't', message: 'm' }, NOTIFICATION_CREATE_SCHEMA).ok).toBe(false);
    expect(validateBody({ type: 'info', message: 'm' }, NOTIFICATION_CREATE_SCHEMA).ok).toBe(false);
    expect(validateBody({ type: 'info', title: 't' }, NOTIFICATION_CREATE_SCHEMA).ok).toBe(false);
    expect(validateBody({ type: 'info', title: '', message: 'm' }, NOTIFICATION_CREATE_SCHEMA).ok).toBe(false);
  });

  it('max length: title 200, message 1000 (inklusif)', () => {
    expect(validateBody({ type: 'info', title: 'x'.repeat(200), message: 'm' }, NOTIFICATION_CREATE_SCHEMA).ok).toBe(true);
    expect(validateBody({ type: 'info', title: 'x'.repeat(201), message: 'm' }, NOTIFICATION_CREATE_SCHEMA).ok).toBe(false);
    expect(validateBody({ type: 'info', title: 't', message: 'y'.repeat(1000) }, NOTIFICATION_CREATE_SCHEMA).ok).toBe(true);
    expect(validateBody({ type: 'info', title: 't', message: 'y'.repeat(1001) }, NOTIFICATION_CREATE_SCHEMA).ok).toBe(false);
  });

  it('priority: whitelist low/normal/high ditegakkan; absen ok (default route "normal")', () => {
    expect(NOTIFICATION_PRIORITIES).toEqual(['low', 'normal', 'high']);
    const noPriority = validateBody({ type: 'info', title: 't', message: 'm' }, NOTIFICATION_CREATE_SCHEMA);
    expect(noPriority.ok).toBe(true);
    expect(noPriority.value).not.toHaveProperty('priority');
    expect(validateBody({ type: 'info', title: 't', message: 'm', priority: 'urgent' }, NOTIFICATION_CREATE_SCHEMA).ok).toBe(false);
  });

  it('read boolean asli & string koersi diterima; nilai lain ditolak', () => {
    expect(validateBody({ type: 'info', title: 't', message: 'm', read: true }, NOTIFICATION_CREATE_SCHEMA).value.read).toBe(true);
    expect(validateBody({ type: 'info', title: 't', message: 'm', read: 'false' }, NOTIFICATION_CREATE_SCHEMA).value.read).toBe(false);
    expect(validateBody({ type: 'info', title: 't', message: 'm', read: 'yes' }, NOTIFICATION_CREATE_SCHEMA).ok).toBe(false);
  });

  it('beberapa error dikumpulkan sekaligus (tidak fail-fast)', () => {
    const res = validateBody({ type: 'hacked', title: '', message: 'm', priority: 'urgent' }, NOTIFICATION_CREATE_SCHEMA);
    expect(res.ok).toBe(false);
    expect(res.errors.length).toBe(3);
    expect(res.error).toBe(res.errors.join('; '));
  });

  it('metadata/dedupeKey tidak ada di skema — diproses kontrol P1-4 lama dari req.body', () => {
    expect(Object.keys(NOTIFICATION_CREATE_SCHEMA)).not.toContain('metadata');
    expect(Object.keys(NOTIFICATION_CREATE_SCHEMA)).not.toContain('dedupeKey');
  });
});

describe('validateActionHref', () => {
  it('path relatif lolos (client memakai route internal)', () => {
    for (const href of ['/gmail-sync', '/transactions', '/admin/monitoring', 'transactions']) {
      const res = validateActionHref(href, { field: 'actionHref' });
      expect(res.ok, href).toBe(true);
      expect(res.value).toBe(href);
    }
  });

  it('URL http/https absolut lolos', () => {
    expect(validateActionHref('https://example.com/promo', { field: 'actionHref' }).ok).toBe(true);
    expect(validateActionHref('http://example.com', { field: 'actionHref' }).ok).toBe(true);
  });

  it('skema non-http ditolak fail-closed (vektor XSS navigasi)', () => {
    for (const href of ['javascript:alert(1)', 'JaVaScRiPt:alert(1)', 'data:text/html,x', 'vbscript:msgbox(1)']) {
      const res = validateActionHref(href, { field: 'actionHref' });
      expect(res.ok, href).toBe(false);
    }
  });

  it('absen/kosong → undefined (opsional); max 500 ditegakkan', () => {
    expect(validateActionHref(undefined, { field: 'actionHref' })).toEqual({ ok: true, value: undefined });
    expect(validateActionHref('', { field: 'actionHref' })).toEqual({ ok: true, value: undefined });
    expect(validateActionHref(`/${'a'.repeat(500)}`, { field: 'actionHref' }).ok).toBe(false);
  });
});
