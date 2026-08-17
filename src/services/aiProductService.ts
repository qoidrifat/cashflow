/**
 * AI Product Experience Service (Sprint 1.5).
 *
 * Client untuk endpoint /api/ai-product/* — feedback, memory (preferensi AI),
 * dan timeline (riwayat rekomendasi). Semua panggilan memakai cookie session
 * (credentials: 'include') — server memakai requireAuth.
 */
import type { Rating } from '../features/ai-product/types';

// ── Response primitives ──────────────────────────────────────────────────────

export interface FeedbackRecord {
  id: string;
  feature: string;
  item_id?: string;
  rating: string;
  reason?: string;
  created_at?: string;
}

export interface MemoryRecord {
  id: string;
  category: string;
  key: string;
  value: string;
  source: string;
  created_at?: string;
  updated_at?: string;
}

export interface TimelineRecord {
  id: string;
  feature: string;
  /** P9: insight | recommendation | conversation | feedback | memory_update | risk | other. */
  event_type: string;
  /** P9: new | viewed | completed | dismissed. */
  status: string;
  title: string;
  body?: string;
  confidence?: number | null;
  payload?: string;
  created_at?: string;
}

/** Feedback yang dikaitkan ke satu timeline event (via item_id — P9 §13). */
export interface TimelineFeedbackRef {
  rating: string;
  reason?: string;
  created_at?: string;
}

/** Detail satu timeline event + feedback terkait. */
export interface TimelineDetail extends TimelineRecord {
  feedback: TimelineFeedbackRef[];
}

/** Respons GET /timeline — pagination keyset (P9 §18). */
export interface TimelinePage {
  items: TimelineRecord[];
  hasMore: boolean;
}

async function handle<T>(res: Response): Promise<T> {
  if (!res.ok) {
    let message = `HTTP ${res.status}`;
    try {
      const body = await res.json();
      message = body?.message || body?.error || message;
    } catch { /* ignore */ }
    throw new Error(message);
  }
  return res.json() as Promise<T>;
}

// ── Feedback ─────────────────────────────────────────────────────────────────

export async function submitFeedback(input: {
  feature: string;
  itemId?: string;
  rating: Rating;
  reason?: string;
}): Promise<{ id: string }> {
  const res = await fetch('/api/ai-product/feedback', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    credentials: 'include',
    body: JSON.stringify(input),
  });
  return handle<{ id: string }>(res);
}

export async function listFeedback(feature?: string): Promise<FeedbackRecord[]> {
  const q = feature ? `?feature=${encodeURIComponent(feature)}` : '';
  const res = await fetch(`/api/ai-product/feedback${q}`, { credentials: 'include' });
  return handle<FeedbackRecord[]>(res);
}

// ── Memory ───────────────────────────────────────────────────────────────────

export async function listMemory(): Promise<MemoryRecord[]> {
  const res = await fetch('/api/ai-product/memory', { credentials: 'include' });
  return handle<MemoryRecord[]>(res);
}

export async function upsertMemory(input: {
  category: string;
  key: string;
  value: string;
  source?: string;
}): Promise<{ id: string }> {
  const res = await fetch('/api/ai-product/memory', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    credentials: 'include',
    body: JSON.stringify(input),
  });
  return handle<{ id: string }>(res);
}

export async function updateMemory(id: string, input: { value: string; source?: string }): Promise<{ success: boolean }> {
  const res = await fetch(`/api/ai-product/memory/${id}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    credentials: 'include',
    body: JSON.stringify(input),
  });
  return handle<{ success: boolean }>(res);
}

export async function deleteMemory(id: string): Promise<{ success: boolean }> {
  const res = await fetch(`/api/ai-product/memory/${id}`, {
    method: 'DELETE',
    credentials: 'include',
  });
  return handle<{ success: boolean }>(res);
}

// ── Timeline (P9) ────────────────────────────────────────────────────────────

/**
 * Daftar timeline (DESC, pagination keyset). Respons { items, hasMore }:
 * `before` = created_at event terakhir yang sudah dilihat (lihat item.terakhir).
 */
export async function listTimeline(opts?: {
  feature?: string;
  eventType?: string;
  before?: string;
  /** Tie-break keyset: id event terakhir (WAJIB bersama `before`). */
  beforeId?: string;
  limit?: number;
}): Promise<TimelinePage> {
  const params = new URLSearchParams();
  if (opts?.feature) params.set('feature', opts.feature);
  if (opts?.eventType) params.set('eventType', opts.eventType);
  if (opts?.before) params.set('before', opts.before);
  if (opts?.beforeId) params.set('beforeId', opts.beforeId);
  if (opts?.limit) params.set('limit', String(opts.limit));
  const q = params.toString();
  const res = await fetch(`/api/ai-product/timeline${q ? `?${q}` : ''}`, { credentials: 'include' });
  return handle<TimelinePage>(res);
}

/** Detail satu event + feedback terkait. */
export async function getTimelineEvent(id: string): Promise<TimelineDetail> {
  const res = await fetch(`/api/ai-product/timeline/${encodeURIComponent(id)}`, { credentials: 'include' });
  return handle<TimelineDetail>(res);
}

/** Transisi status (P9 §12: new→viewed|completed|dismissed · viewed→completed|dismissed). */
export async function updateTimelineStatus(id: string, status: string): Promise<{ success: boolean; status: string }> {
  const res = await fetch(`/api/ai-product/timeline/${encodeURIComponent(id)}/status`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    credentials: 'include',
    body: JSON.stringify({ status }),
  });
  return handle<{ success: boolean; status: string }>(res);
}

export async function addTimelineEntry(input: {
  feature: string;
  title: string;
  body?: string;
  confidence?: number | null;
  payload?: Record<string, unknown>;
}): Promise<{ id: string }> {
  const res = await fetch('/api/ai-product/timeline', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    credentials: 'include',
    body: JSON.stringify(input),
  });
  return handle<{ id: string }>(res);
}

// ── Track (P10.2 — Closed Beta Instrumentation) ────────────────────────────────

/**
 * Event telemetry frontend (fire-and-forget, tidak pernah melempar).
 * Whitelist server: ai_hub_view | recommendation_shown | recommendation_opened
 * | ai_result_shown (P10.2i — denominator Feedback Rate: tampilan kartu AI
 * feedback-capable, bukan page view).
 * non-PII: hanya event + feature/itemId/eventType (tanpa query/isi konten).
 * `eventType` = enum timeline kanonik (insight/recommendation/...) — dipakai
 * panel admin untuk CTR per event type (P10.2d).
 */
export async function trackAiProductEvent(
  event: 'ai_hub_view' | 'recommendation_shown' | 'recommendation_opened' | 'ai_result_shown',
  meta?: { feature?: string; itemId?: string; eventType?: string },
): Promise<void> {
  try {
    await fetch('/api/ai-product/track', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'include',
      body: JSON.stringify({ event, ...(meta || {}) }),
    });
  } catch {
    // analytics non-blocking — abaikan kegagalan
  }
}
