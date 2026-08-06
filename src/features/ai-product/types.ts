/**
 * AI Product Experience — shared types (Sprint 1.5).
 */

/** Opsi rating feedback (urut sesuai UI AiFeedbackButtons). */
export const FEEDBACK_RATINGS = [
  'helpful',
  'not_helpful',
  'mismatched',
  'irrelevant',
  'already_done',
  'skip',
] as const;

export type Rating = (typeof FEEDBACK_RATINGS)[number];

export const FEEDBACK_RATING_LABELS: Record<Rating, string> = {
  helpful: 'Membantu',
  not_helpful: 'Tidak membantu',
  mismatched: 'Kurang sesuai',
  irrelevant: 'Tidak relevan',
  already_done: 'Sudah saya lakukan',
  skip: 'Lewati',
};

/** Kategori preferensi AI Memory. */
export const MEMORY_CATEGORIES = [
  'spending_habit',
  'payment_preference',
  'budget_style',
  'subscription',
  'goal',
  'note',
] as const;

export type MemoryCategory = (typeof MEMORY_CATEGORIES)[number];

export const MEMORY_CATEGORY_LABELS: Record<MemoryCategory, string> = {
  spending_habit: 'Kebiasaan Belanja',
  payment_preference: 'Preferensi Pembayaran',
  budget_style: 'Gaya Budget',
  subscription: 'Langganan',
  goal: 'Tujuan Keuangan',
  note: 'Catatan',
};
