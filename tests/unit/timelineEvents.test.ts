/**
 * Unit test: server/lib/timelineEvents.js (P9 — AI Timeline).
 *
 * MURNI tanpa DB: eventType mapping, sanitize payload, normalisasi input,
 * state machine status (P9 §12), builder feedback/memory (P9 §13-14), dan
 * helper INSERT (turso di-mock).
 */
import { describe, it, expect, vi } from 'vitest';
import {
  EVENT_TYPES,
  TIMELINE_STATUSES,
  eventTypeFromFeature,
  isEventType,
  isStatus,
  sanitizePayload,
  normalizeTimelineInput,
  canTransition,
  buildFeedbackEvent,
  buildMemoryEvent,
  insertTimelineEvent,
} from '../../server/lib/timelineEvents.js';

describe('eventTypeFromFeature — mapping deterministik (P9 §7)', () => {
  it('mapping utama', () => {
    expect(eventTypeFromFeature('advisor')).toBe('recommendation');
    expect(eventTypeFromFeature('health')).toBe('recommendation');
    expect(eventTypeFromFeature('simulation')).toBe('recommendation');
    expect(eventTypeFromFeature('insight')).toBe('insight');
    expect(eventTypeFromFeature('search')).toBe('insight');
    expect(eventTypeFromFeature('ocr')).toBe('insight');
    expect(eventTypeFromFeature('conversation')).toBe('conversation');
    expect(eventTypeFromFeature('memory')).toBe('memory_update');
    expect(eventTypeFromFeature('fraud')).toBe('risk');
  });

  it('feature tak dikenal → other (tidak pernah error)', () => {
    expect(eventTypeFromFeature('hack')).toBe('other');
    expect(eventTypeFromFeature(undefined)).toBe('other');
  });

  it('enum kanonik konsisten', () => {
    expect(EVENT_TYPES).toContain('insight');
    expect(EVENT_TYPES).toContain('recommendation');
    expect(EVENT_TYPES).toContain('conversation');
    expect(EVENT_TYPES).toContain('feedback');
    expect(EVENT_TYPES).toContain('memory_update');
    expect(TIMELINE_STATUSES).toEqual(['new', 'viewed', 'completed', 'dismissed']);
    expect(isEventType('insight')).toBe(true);
    expect(isStatus('completed')).toBe(true);
    expect(isStatus('bogus')).toBe(false);
  });
});

describe('sanitizePayload — hanya primitives aman (P9 §9-10)', () => {
  it('menyimpan primitives & membuang objek dalam', () => {
    const raw = sanitizePayload({ periodDays: 7, expense: 1250000, topCategory: 'Makanan', flag: true });
    expect(JSON.parse(raw)).toEqual({ periodDays: 7, expense: 1250000, topCategory: 'Makanan', flag: true });
  });

  it('membuang nested object, fungsi, & array > 8 item; array kecil disimpan', () => {
    const raw = sanitizePayload({ nested: { secret: 1 }, big: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10], small: [1, 2], fn: () => {} });
    const parsed = JSON.parse(raw);
    expect(parsed.nested).toBeUndefined();
    expect(parsed.fn).toBeUndefined();
    expect(parsed.big).toBeUndefined(); // > 8 item → dibuang
    expect(parsed.small).toEqual([1, 2]);
  });

  it('array top-level / non-object → {}', () => {
    expect(sanitizePayload([1, 2])).toBe('{}');
    expect(sanitizePayload('not-json')).toBe('{}');
    expect(sanitizePayload(undefined)).toBe('{}');
    expect(sanitizePayload(null)).toBe('{}');
  });

  it('string JSON valid diparse lalu disanitasi', () => {
    expect(JSON.parse(sanitizePayload('{"a":1}'))).toEqual({ a: 1 });
  });

  it('string panjang di-cap (bukan disimpan mentah) — snapshot tetap ringkas', () => {
    const raw = sanitizePayload({ data: 'x'.repeat(9000) });
    expect(JSON.parse(raw).data.length).toBe(200);
  });
});

describe('normalizeTimelineInput — cap & default (P9 §9, §11)', () => {
  it('event_type dihitung dari feature (klien tidak set sendiri)', () => {
    const out = normalizeTimelineInput({ feature: 'advisor', title: 't', payload: { a: 1 } });
    expect(out.eventType).toBe('recommendation');
    expect(out.status).toBeUndefined(); // status di-set di INSERT
  });

  it('event_type EKSPLISIT dari builder (feedback/memory) dihormati di atas feature', () => {
    const feedback = normalizeTimelineInput(buildFeedbackEvent({ feature: 'insight', rating: 'helpful' }));
    expect(feedback.eventType).toBe('feedback');
    const memory = normalizeTimelineInput(buildMemoryEvent({ category: 'goal', key: 'x', action: 'set' }));
    expect(memory.eventType).toBe('memory_update');
    // eventType invalid di-abaikan → fallback feature
    expect(normalizeTimelineInput({ feature: 'insight', title: 't', eventType: 'hack' }).eventType).toBe('insight');
  });

  it('cap panjang title/body & confidence di-clamp', () => {
    const out = normalizeTimelineInput({
      feature: 'insight',
      title: 'x'.repeat(500),
      body: 'y'.repeat(5000),
      confidence: 1.5,
    });
    expect(out.title.length).toBe(200);
    expect(out.body.length).toBe(2000);
    expect(out.confidence).toBeNull();
  });

  it('confidence valid dipertahankan; null TIDAK jadi 0 (Number(null)=0 guard)', () => {
    expect(normalizeTimelineInput({ feature: 'insight', title: 't', confidence: 0.72 }).confidence).toBe(0.72);
    expect(normalizeTimelineInput({ feature: 'insight', title: 't', confidence: null }).confidence).toBeNull();
    expect(normalizeTimelineInput({ feature: 'insight', title: 't', confidence: undefined }).confidence).toBeNull();
    expect(normalizeTimelineInput({ feature: 'insight', title: 't', confidence: 'x' }).confidence).toBeNull();
  });
});

describe('canTransition — state machine DETERMINISTIK (P9 §12)', () => {
  it('new → viewed | completed | dismissed', () => {
    expect(canTransition('new', 'viewed')).toBe(true);
    expect(canTransition('new', 'completed')).toBe(true);
    expect(canTransition('new', 'dismissed')).toBe(true);
  });

  it('viewed → completed | dismissed', () => {
    expect(canTransition('viewed', 'completed')).toBe(true);
    expect(canTransition('viewed', 'dismissed')).toBe(true);
  });

  it('completed/dismissed adalah FINAL — tidak ada transisi keluar', () => {
    expect(canTransition('completed', 'viewed')).toBe(false);
    expect(canTransition('completed', 'new')).toBe(false);
    expect(canTransition('dismissed', 'completed')).toBe(false);
  });

  it('no-op & status invalid ditolak', () => {
    expect(canTransition('new', 'new')).toBe(false);
    expect(canTransition('viewed', 'viewed')).toBe(false);
    expect(canTransition('bogus', 'completed')).toBe(false);
    expect(canTransition('new', 'bogus')).toBe(false);
  });
});

describe('builders feedback & memory (P9 §13-14)', () => {
  it('buildFeedbackEvent — judul berlabel + payload ringkas', () => {
    const e = buildFeedbackEvent({ feature: 'advisor', rating: 'not_helpful', reason: 'Saran generik' });
    expect(e.eventType).toBe('feedback');
    expect(e.title).toBe('Feedback: Tidak membantu');
    expect(e.body).toBe('Saran generik');
    expect(e.payload).toEqual({ feature: 'advisor', rating: 'not_helpful' });
    expect(e.confidence).toBeNull();
  });

  it('buildMemoryEvent — aksi set & delete', () => {
    const set = buildMemoryEvent({ category: 'payment_preference', key: 'Metode', action: 'set' });
    expect(set.eventType).toBe('memory_update');
    expect(set.title).toBe('Preferensi diperbarui');
    expect(set.payload.action).toBe('set');

    const del = buildMemoryEvent({ category: 'goal', key: 'Beli rumah', action: 'delete' });
    expect(del.title).toBe('Preferensi dihapus');
    expect(del.payload.action).toBe('delete');
  });
});

describe('insertTimelineEvent — INSERT user-scoped (P9 §8)', () => {
  it('menyisipkan event_type dari feature, status new, payload sanitized', async () => {
    const execute = vi.fn().mockResolvedValue({ rows: [] });
    const id = await insertTimelineEvent({ execute }, 'user-1', {
      feature: 'conversation',
      title: 'Kenapa uangku habis?',
      body: 'Ringkasan',
      confidence: 0.8,
      payload: { expense: 100000 },
    });
    expect(id).toBeTruthy();
    const call = execute.mock.calls[0][0];
    expect(call.sql).toContain('INSERT INTO ai_timeline');
    expect(call.sql).toContain("'new'"); // status hardcoded di SQL (default)
    expect(call.args[1]).toBe('user-1'); // user_id scope
    expect(call.args[2]).toBe('conversation'); // feature
    expect(call.args[3]).toBe('conversation'); // event_type
    expect(call.args[4]).toBe('Kenapa uangku habis?'); // title
    expect(call.args[7]).toContain('100000'); // payload JSON
  });

  it('menormalkan input sebelum INSERT', async () => {
    const execute = vi.fn().mockResolvedValue({ rows: [] });
    await insertTimelineEvent({ execute }, 'u', { feature: 'advisor', title: 't', confidence: 2, payload: { a: 1 } });
    const call = execute.mock.calls[0][0];
    expect(call.args[3]).toBe('recommendation');
    expect(call.args[6]).toBeNull(); // confidence di-clamp ke null
  });
});
