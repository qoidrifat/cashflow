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
  title: string;
  body?: string;
  confidence?: number | null;
  payload?: string;
  created_at?: string;
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

// ── Timeline ─────────────────────────────────────────────────────────────────

export async function listTimeline(feature?: string): Promise<TimelineRecord[]> {
  const q = feature ? `?feature=${encodeURIComponent(feature)}` : '';
  const res = await fetch(`/api/ai-product/timeline${q}`, { credentials: 'include' });
  return handle<TimelineRecord[]>(res);
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
