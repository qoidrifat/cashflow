/**
 * Seleksi kategori live benchmark berbasis FEEDBACK NYATA (Sprint 1.5).
 *
 * Membaca snapshot `docs/ai/feedback-prompt-priorities.json` (ditulis oleh
 * `scripts/feedbackPromptPriorities.mjs` dari tabel `ai_feedback` di Turso) dan
 * memilih kategori live mana yang harus dijalankan — fitur yang paling banyak
 * feedback negatif adalah yang paling perlu evaluasi ulang dengan Gemini nyata
 * (fokus biaya AI ke tempat yang bermasalah).
 *
 * MURNI & deterministik (tanpa I/O di selectLiveCategory; loadFeedbackPriorities
 * hanya baca file) — unit-testable.
 *
 * Aturan seleksi:
 *   1. `topPriority.feature` → live category bila ada mapping DAN skor > 0.
 *   2. Fallback: fitur ranking pertama (features[]) yang punya mapping & skor > 0
 *      (topPriority bisa berupa fitur tanpa live category: search/conversation).
 *   3. Tidak ada snapshot / tidak ada mapping / data kosong / seluruh skor 0
 *      (feedback tanpa sinyal negatif) → null = full run (perilaku default).
 *
 * Gate skor > 0: feedback yang ada tapi semuanya non-negatif (priorityScore 0)
 * bukan alasan menyempitkan evaluasi — full run lebih tepat.
 */
import fs from 'node:fs';

/** Fitur (dari ai_feedback) → kategori live benchmark yang menjalankannya. */
export const FEATURE_TO_LIVE_CATEGORY: Record<string, string> = {
  advisor: 'advisor_live',
  insight: 'insight_live',
  fraud: 'fraud_l2_live',
  gmail: 'gmail_extraction_live',
  ocr: 'ocr_receipt_vision_live',
};

/** Semua kategori live yang mungkin (dipakai untuk validasi mapping & test). */
export const LIVE_CATEGORIES = [...new Set(Object.values(FEATURE_TO_LIVE_CATEGORY))];

export interface FeedbackFeaturePriority {
  feature: string;
  priorityScore: number;
  total: number;
}

export interface FeedbackPriorities {
  totalFeedback: number;
  featuresWithFeedback: number;
  features: FeedbackFeaturePriority[];
  topPriority: FeedbackFeaturePriority | null;
}

export interface LiveCategorySelection {
  category: string;
  feature: string;
  priorityScore: number;
  total: number;
  /** Alasan pemilihan: 'topPriority' | 'firstMappedFeature'. */
  reason: 'topPriority' | 'firstMappedFeature';
}

/** Baca snapshot prioritas feedback; null bila file hilang/rusak (→ full run). */
export function loadFeedbackPriorities(filePath: string): FeedbackPriorities | null {
  try {
    if (!fs.existsSync(filePath)) return null;
    const raw = JSON.parse(fs.readFileSync(filePath, 'utf8')) as Partial<FeedbackPriorities>;
    if (!raw || !Array.isArray(raw.features)) return null;
    return {
      totalFeedback: Number(raw.totalFeedback) || 0,
      featuresWithFeedback: Number(raw.featuresWithFeedback) || 0,
      features: raw.features,
      topPriority: raw.topPriority && raw.topPriority.feature ? raw.topPriority : null,
    };
  } catch {
    return null; // JSON rusak → aman: full run, bukan crash.
  }
}

/** Pilih satu kategori live; null = full run. */
export function selectLiveCategory(
  priorities: FeedbackPriorities | null,
): LiveCategorySelection | null {
  if (!priorities || !Array.isArray(priorities.features)) return null;

  // 1. topPriority langsung (hanya bila ada sinyal negatif: skor > 0).
  const top = priorities.topPriority;
  if (top?.feature && top.priorityScore > 0) {
    const category = FEATURE_TO_LIVE_CATEGORY[top.feature];
    if (category) {
      return {
        category,
        feature: top.feature,
        priorityScore: top.priorityScore,
        total: top.total,
        reason: 'topPriority',
      };
    }
  }

  // 2. Fallback: fitur ranking pertama yang punya live category & skor > 0.
  for (const f of priorities.features) {
    const category = FEATURE_TO_LIVE_CATEGORY[f.feature];
    if (category && f.priorityScore > 0) {
      return {
        category,
        feature: f.feature,
        priorityScore: f.priorityScore,
        total: f.total,
        reason: 'firstMappedFeature',
      };
    }
  }

  // 3. Tidak ada fitur yang bisa dipetakan / seluruh skor 0 → full run.
  return null;
}
