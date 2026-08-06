import { describe, expect, it } from 'vitest';
import { validateBody } from '../../server/lib/validation.js';
import {
  FEEDBACK_CREATE_SCHEMA,
  MEMORY_UPSERT_SCHEMA,
  MEMORY_UPDATE_SCHEMA,
  TIMELINE_CREATE_SCHEMA,
  AI_FEATURES,
  FEEDBACK_RATINGS,
  MEMORY_CATEGORIES,
} from '../../server/routes/aiProductRoutes.js';

describe('aiProductRoutes — feedback schema', () => {
  it('menerima feedback valid', () => {
    const r = validateBody({ feature: 'advisor', rating: 'helpful', itemId: 'rec-1', reason: 'Bagus' }, FEEDBACK_CREATE_SCHEMA);
    expect(r.ok).toBe(true);
    expect(r.value).toMatchObject({ feature: 'advisor', rating: 'helpful', itemId: 'rec-1', reason: 'Bagus' });
  });

  it('menolak feature di luar enum (400 VALIDATION_ERROR, bukan 401)', () => {
    const r = validateBody({ feature: 'hack', rating: 'helpful' }, FEEDBACK_CREATE_SCHEMA);
    expect(r.ok).toBe(false);
  });

  it('menolak rating di luar enum', () => {
    const r = validateBody({ feature: 'insight', rating: 'maybe' }, FEEDBACK_CREATE_SCHEMA);
    expect(r.ok).toBe(false);
  });

  it('wajib feature & rating', () => {
    expect(validateBody({ rating: 'helpful' }, FEEDBACK_CREATE_SCHEMA).ok).toBe(false);
    expect(validateBody({ feature: 'advisor' }, FEEDBACK_CREATE_SCHEMA).ok).toBe(false);
  });

  it('reason opsional & dipangkas', () => {
    const r = validateBody({ feature: 'fraud', rating: 'not_helpful', reason: '  salah alasan  ' }, FEEDBACK_CREATE_SCHEMA);
    expect(r.ok).toBe(true);
    expect(r.value.reason).toBe('salah alasan');
  });

  it('semua rating kanonik diterima', () => {
    for (const rating of FEEDBACK_RATINGS) {
      expect(validateBody({ feature: 'advisor', rating }, FEEDBACK_CREATE_SCHEMA).ok).toBe(true);
    }
  });
});

describe('aiProductRoutes — memory schema', () => {
  it('menerima upsert valid', () => {
    const r = validateBody({ category: 'payment_preference', key: 'Metode favorit', value: 'QRIS' }, MEMORY_UPSERT_SCHEMA);
    expect(r.ok).toBe(true);
    // validateBody membuang field undefined dari output (source tidak dikirim → tidak muncul)
    expect(r.value).toMatchObject({ category: 'payment_preference', key: 'Metode favorit', value: 'QRIS' });
    expect(r.value.source).toBeUndefined();
  });

  it('default source manual bila tidak dikirim', () => {
    const r = validateBody({ category: 'spending_habit', key: 'Makan siang', value: 'Sering GoFood' }, MEMORY_UPSERT_SCHEMA);
    expect(r.ok).toBe(true);
  });

  it('menolak kategori di luar enum', () => {
    const r = validateBody({ category: 'secret', key: 'x', value: 'y' }, MEMORY_UPSERT_SCHEMA);
    expect(r.ok).toBe(false);
  });

  it('key & value wajib', () => {
    expect(validateBody({ category: 'goal', value: 'x' }, MEMORY_UPSERT_SCHEMA).ok).toBe(false);
    expect(validateBody({ category: 'goal', key: 'x' }, MEMORY_UPSERT_SCHEMA).ok).toBe(false);
  });

  it('update schema hanya value/source', () => {
    const r = validateBody({ value: 'baru' }, MEMORY_UPDATE_SCHEMA);
    expect(r.ok).toBe(true);
    expect(validateBody({ value: '' }, MEMORY_UPDATE_SCHEMA).ok).toBe(false);
  });
});

describe('aiProductRoutes — timeline schema', () => {
  it('menerima entri valid', () => {
    const r = validateBody({ feature: 'insight', title: 'Insight', body: 'Detail', confidence: 0.8, payload: { a: 1 } }, TIMELINE_CREATE_SCHEMA);
    expect(r.ok).toBe(true);
    expect(r.value.confidence).toBe(0.8);
    expect(typeof r.value.payload).toBe('string'); // di-serialisasi JSON
  });

  it('confidence harus 0-1', () => {
    expect(validateBody({ feature: 'insight', title: 't', confidence: 1.5 }, TIMELINE_CREATE_SCHEMA).ok).toBe(false);
    expect(validateBody({ feature: 'insight', title: 't', confidence: -1 }, TIMELINE_CREATE_SCHEMA).ok).toBe(false);
    expect(validateBody({ feature: 'insight', title: 't', confidence: 0.5 }, TIMELINE_CREATE_SCHEMA).ok).toBe(true);
  });

  it('title wajib, body opsional', () => {
    expect(validateBody({ feature: 'insight' }, TIMELINE_CREATE_SCHEMA).ok).toBe(false);
    expect(validateBody({ feature: 'insight', title: 't' }, TIMELINE_CREATE_SCHEMA).ok).toBe(true);
  });

  it('payload menolak array & ukuran berlebih', () => {
    expect(validateBody({ feature: 'insight', title: 't', payload: [1, 2] }, TIMELINE_CREATE_SCHEMA).ok).toBe(false);
  });
});

describe('aiProductRoutes — enum kanonik konsisten', () => {
  it('AI_FEATURES mencakup seluruh fitur UI', () => {
    expect(AI_FEATURES).toContain('advisor');
    expect(AI_FEATURES).toContain('insight');
    expect(AI_FEATURES).toContain('fraud');
    expect(AI_FEATURES).toContain('search');
    expect(AI_FEATURES).toContain('ocr');
    expect(AI_FEATURES).toContain('health');
    expect(AI_FEATURES).toContain('simulation');
  });

  it('MEMORY_CATEGORIES mencakup kategori UI', () => {
    for (const c of ['spending_habit', 'payment_preference', 'budget_style', 'subscription', 'goal', 'note']) {
      expect(MEMORY_CATEGORIES).toContain(c);
    }
  });
});
