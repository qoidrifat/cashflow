/**
 * Unit test: tests/benchmark/liveFeedbackSelection.ts — seleksi kategori live
 * benchmark berbasis feedback nyata (snapshot feedbackPromptPriorities).
 *
 * Menguji logika murni tanpa Gemini/Turso:
 *   - file snapshot hilang / JSON rusak → null (full run)
 *   - topPriority punya live category → kategori itu dipilih (reason topPriority)
 *   - topPriority tanpa live mapping (search/conversation) → fallback ke fitur
 *     ranking pertama yang punya mapping (reason firstMappedFeature)
 *   - tidak ada fitur yang bisa dipetakan / data kosong → null (full run)
 *   - mapping feature → live category lengkap & valid
 */
import { describe, expect, it, beforeAll, afterAll } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  FEATURE_TO_LIVE_CATEGORY,
  LIVE_CATEGORIES,
  loadFeedbackPriorities,
  selectLiveCategory,
  type FeedbackFeaturePriority,
  type FeedbackPriorities,
} from '../benchmark/liveFeedbackSelection';

const TMP_FILE = path.join(os.tmpdir(), 'cashflow-feedback-priorities-test.json');

function prio(
  features: FeedbackFeaturePriority[],
  topPriority: FeedbackFeaturePriority | null,
): FeedbackPriorities {
  return {
    totalFeedback: 10,
    featuresWithFeedback: features.length,
    features,
    topPriority,
  };
}

describe('loadFeedbackPriorities', () => {
  beforeAll(() => {
    if (fs.existsSync(TMP_FILE)) fs.rmSync(TMP_FILE, { force: true });
  });
  afterAll(() => {
    if (fs.existsSync(TMP_FILE)) fs.rmSync(TMP_FILE, { force: true });
  });

  it('file hilang → null (full run)', () => {
    expect(loadFeedbackPriorities(path.join(os.tmpdir(), 'tidak-ada.json'))).toBeNull();
  });

  it('JSON rusak → null (tidak crash)', () => {
    fs.writeFileSync(TMP_FILE, '{ ini bukan json', 'utf8');
    expect(loadFeedbackPriorities(TMP_FILE)).toBeNull();
  });

  it('snapshot tanpa features[] → null', () => {
    fs.writeFileSync(TMP_FILE, JSON.stringify({ topPriority: null }), 'utf8');
    expect(loadFeedbackPriorities(TMP_FILE)).toBeNull();
  });

  it('snapshot valid → struktur dinormalisasi (topPriority null bila kosong)', () => {
    fs.writeFileSync(
      TMP_FILE,
      JSON.stringify({ features: [], topPriority: null, totalFeedback: 0, featuresWithFeedback: 0 }),
      'utf8',
    );
    const loaded = loadFeedbackPriorities(TMP_FILE);
    expect(loaded).not.toBeNull();
    expect(loaded!.features).toEqual([]);
    expect(loaded!.topPriority).toBeNull();
  });

  it('topPriority tanpa field feature → dianggap null', () => {
    fs.writeFileSync(
      TMP_FILE,
      JSON.stringify({ features: [{ feature: 'advisor', priorityScore: 70, total: 10 }], topPriority: {} }),
      'utf8',
    );
    const loaded = loadFeedbackPriorities(TMP_FILE);
    expect(loaded!.topPriority).toBeNull();
    expect(loaded!.features).toHaveLength(1);
  });
});

describe('selectLiveCategory', () => {
  it('null input → null (full run)', () => {
    expect(selectLiveCategory(null)).toBeNull();
  });

  it('data kosong (features []) → null', () => {
    expect(selectLiveCategory(prio([], null))).toBeNull();
  });

  it('seluruh skor 0 (feedback tanpa sinyal negatif) → null (full run)', () => {
    expect(selectLiveCategory(prio(
      [{ feature: 'advisor', priorityScore: 0, total: 10 }],
      { feature: 'advisor', priorityScore: 0, total: 10 },
    ))).toBeNull();
  });

  it('topPriority skor 0 tetapi fitur lain skor > 0 → fallback ke fitur berskor > 0', () => {
    const sel = selectLiveCategory(prio(
      [
        { feature: 'advisor', priorityScore: 0, total: 8 },
        { feature: 'fraud', priorityScore: 40, total: 5 },
      ],
      { feature: 'advisor', priorityScore: 0, total: 8 },
    ));
    expect(sel).toEqual({
      category: 'fraud_l2_live',
      feature: 'fraud',
      priorityScore: 40,
      total: 5,
      reason: 'firstMappedFeature',
    });
  });

  it('topPriority advisor → advisor_live dengan reason topPriority', () => {
    const sel = selectLiveCategory(prio(
      [{ feature: 'advisor', priorityScore: 70, total: 10 }],
      { feature: 'advisor', priorityScore: 70, total: 10 },
    ));
    expect(sel).toEqual({
      category: 'advisor_live',
      feature: 'advisor',
      priorityScore: 70,
      total: 10,
      reason: 'topPriority',
    });
  });

  it('topPriority search (tanpa live mapping) → fallback fitur pertama yang punya mapping', () => {
    const sel = selectLiveCategory(prio(
      [
        { feature: 'search', priorityScore: 50, total: 6 },
        { feature: 'advisor', priorityScore: 30, total: 4 },
      ],
      { feature: 'search', priorityScore: 50, total: 6 },
    ));
    expect(sel).toEqual({
      category: 'advisor_live',
      feature: 'advisor',
      priorityScore: 30,
      total: 4,
      reason: 'firstMappedFeature',
    });
  });

  it('topPriority conversation (tanpa mapping) & tak ada fitur lain → null', () => {
    expect(selectLiveCategory(prio(
      [{ feature: 'conversation', priorityScore: 20, total: 2 }],
      { feature: 'conversation', priorityScore: 20, total: 2 },
    ))).toBeNull();
  });

  it('mapping lengkap: seluruh fitur feedback bermapping ke kategori live yang valid', () => {
    expect(FEATURE_TO_LIVE_CATEGORY.advisor).toBe('advisor_live');
    expect(FEATURE_TO_LIVE_CATEGORY.insight).toBe('insight_live');
    expect(FEATURE_TO_LIVE_CATEGORY.fraud).toBe('fraud_l2_live');
    expect(FEATURE_TO_LIVE_CATEGORY.gmail).toBe('gmail_extraction_live');
    expect(FEATURE_TO_LIVE_CATEGORY.ocr).toBe('ocr_receipt_vision_live');
    // Semua kategori unik & cocok dengan nama test di aiLiveBenchmark.spec.ts.
    expect(new Set(LIVE_CATEGORIES).size).toBe(LIVE_CATEGORIES.length);
    expect(LIVE_CATEGORIES.sort()).toEqual(
      ['advisor_live', 'fraud_l2_live', 'gmail_extraction_live', 'insight_live', 'ocr_receipt_vision_live'].sort(),
    );
  });
});
