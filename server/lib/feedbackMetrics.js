/**
 * Feedback Metrics (Sprint 1.5 — integrasi ai_feedback ke benchmark AI).
 *
 * Agregasi DETERMINISTIK dari dataset `ai_feedback` (user feedback atas hasil
 * AI: 👍/👎 + rating lanjutan) menjadi prioritas perbaikan prompt per feature.
 *
 * Tujuan: dataset evaluasi nyata → "fitur mana prompt-nya perlu diperbaiki
 * duluan, dan ke arah mana" — dipakai sebelum menjalankan benchmark live dan
 * sebagai input evaluasi benchmark offline (kategori feedback_prioritization).
 *
 * Prinsip:
 *  - MURNI & tanpa I/O — mudah di-unit-test & dipakai script CLI + benchmark.
 *  - Rating negatif nyata (butuh perbaikan prompt): not_helpful, mismatched,
 *    irrelevant. already_done = sinyal "sudah diikuti" (positif tapi bisa
 *    berarti AI mengulang saran); skip = dilewati (bukan penilaian kualitas).
 *  - priorityScore = negativeRate × 100 (0-100); ranking = score desc lalu
 *    volume desc; confidence berdasarkan ukuran sampel (high ≥15, medium ≥5).
 */
// JAGA SINKRON: rating harus sama dengan server/routes/aiProductRoutes.js
// (FEEDBACK_RATINGS) — dijamin oleh unit test feedbackMetrics.test.ts.
export const FEEDBACK_RATINGS = ['helpful', 'not_helpful', 'mismatched', 'irrelevant', 'already_done', 'skip'];

/** Rating yang menandakan ketidakpuasan nyata → kandidat perbaikan prompt. */
export const NEGATIVE_RATINGS = ['not_helpful', 'mismatched', 'irrelevant'];

/** Normalisasi rating: valid → string; tidak dikenal → null (diabaikan). */
export function normalizeRating(rating) {
  return FEEDBACK_RATINGS.includes(rating) ? rating : null;
}

/**
 * Agregasi feedback per feature.
 * rows: array { feature, rating } (+ opsional reason — tidak dipakai untuk skor).
 * Mengembalikan { total, overall, features } — semua angka deterministik.
 */
export function aggregateFeedbackByFeature(rows) {
  const perFeature = new Map();

  for (const row of rows || []) {
    const feature = typeof row?.feature === 'string' && row.feature ? row.feature : 'unknown';
    const rating = normalizeRating(row?.rating);
    if (!rating) continue;
    const f = perFeature.get(feature) || { feature, total: 0, counts: Object.fromEntries(FEEDBACK_RATINGS.map((r) => [r, 0])) };
    f.total += 1;
    f.counts[rating] += 1;
    perFeature.set(feature, f);
  }

  const features = [...perFeature.values()].map((f) => {
    const negative = NEGATIVE_RATINGS.reduce((s, r) => s + f.counts[r], 0);
    const negativeRate = f.total > 0 ? negative / f.total : 0;
    const helpful = f.counts.helpful;
    const positiveRate = f.total > 0 ? helpful / f.total : 0;
    const skipRate = f.total > 0 ? f.counts.skip / f.total : 0;
    const alreadyDoneRate = f.total > 0 ? f.counts.already_done / f.total : 0;
    return {
      feature: f.feature,
      total: f.total,
      counts: f.counts,
      positiveRate,
      negativeRate,
      skipRate,
      alreadyDoneRate,
      priorityScore: Math.round(negativeRate * 100),
      confidence: f.total >= 15 ? 'high' : f.total >= 5 ? 'medium' : 'low',
    };
  });

  // Ranking prioritas perbaikan prompt: score tertinggi dulu, volume tie-break.
  features.sort((a, b) =>
    b.priorityScore - a.priorityScore || b.total - a.total || a.feature.localeCompare(b.feature),
  );

  const total = features.reduce((s, f) => s + f.total, 0);
  const overallNegative = total > 0 ? features.reduce((s, f) => s + f.counts.not_helpful + f.counts.mismatched + f.counts.irrelevant, 0) / total : 0;

  return {
    total,
    overall: {
      negativeRate: overallNegative,
      featuresWithFeedback: features.length,
    },
    features,
  };
}

/** Peta feature → prompt/proses yang menghasilkan output AI (untuk action plan). */
export const FEATURE_PROMPT_MAP = {
  advisor: { prompt: 'buildAdvisorPrompt', file: 'server/lib/vertexContext.js', label: 'Financial Advisor' },
  insight: { prompt: 'buildMonthlyReportPrompt', file: 'server/lib/vertexContext.js', label: 'AI Insight' },
  fraud: { prompt: 'buildFraudScoringPrompt', file: 'server/services/fraudDetectionService.js', label: 'Fraud Detection L2' },
  search: { prompt: 'rankAndExplainResults / buildSuggestedQueries', file: 'server/services/agentSearchService.js', label: 'AI Search' },
  gmail: { prompt: 'buildExtractionPrompt', file: 'server/lib/vertexContext.js', label: 'Gmail Sync' },
  ocr: { prompt: 'buildReceiptExtractionPrompt', file: 'server/lib/vertexContext.js', label: 'OCR Receipt' },
  conversation: { prompt: 'buildConversationPrompt', file: 'server/lib/conversationAggregator.js', label: 'Natural Conversation' },
  health: { prompt: 'rule-based deterministik (bukan LLM)', file: '-', label: 'Financial Health' },
  simulation: { prompt: 'rule-based deterministik (bukan LLM)', file: '-', label: 'Simulation' },
};

/**
 * Action plan perbaikan prompt berdasarkan rating negatif DOMINAN feature.
 * Mengembalikan array { feature, label, prompt, file, direction, reason }.
 */
export function promptActionPlan(features) {
  return features.map((f) => {
    const meta = FEATURE_PROMPT_MAP[f.feature] || { prompt: 'belum dipetakan', file: '-', label: f.feature };
    const c = f.counts;
    const dominant = [...NEGATIVE_RATINGS].sort((a, b) => c[b] - c[a])[0];
    const dominantCount = c[dominant];

    // Susun arah perbaikan dari sinyal-sinyal independen (hindari pesan
    // kontradiktif bila ada sinyal lain di samping tidak-ada-negatif).
    const parts = [];
    if (f.negativeRate > 0 && dominantCount > 0) {
      if (dominant === 'not_helpful') {
        parts.push('Saran terlalu generik — tambahkan konteks data spesifik user, angka kunci, dan alasan tiap rekomendasi.');
      } else if (dominant === 'mismatched') {
        parts.push('Output tidak sesuai konteks — perkuat instruksi skema, contoh, dan pembatasan cakupan.');
      } else if (dominant === 'irrelevant') {
        parts.push('Rekomendasi tak relevan — perketat filter data pendukung dan hindari saran di luar cakupan.');
      }
    }
    if (f.alreadyDoneRate >= 0.3) {
      parts.push('Banyak "sudah saya lakukan" — hindari mengulang saran yang sudah diikuti user.');
    }
    if (f.skipRate >= 0.4) {
      parts.push('Banyak "lewati" — pertimbangkan kurangi frekuensi atau perjelas nilai rekomendasi.');
    }
    const direction = parts.length > 0
      ? parts.join(' ')
      : 'Tidak ada sinyal negatif — pertahankan prompt saat ini.';

    return {
      feature: f.feature,
      label: meta.label,
      prompt: meta.prompt,
      file: meta.file,
      priorityScore: f.priorityScore,
      total: f.total,
      dominantNegative: dominantCount > 0 ? dominant : null,
      direction: direction.trim(),
    };
  });
}

/**
 * Laporan lengkap prioritas perbaikan prompt (deterministik).
 * rows: array { feature, rating }. Output siap untuk benchmark & script CLI.
 */
export function buildFeedbackPriorityReport(rows) {
  const { total, overall, features } = aggregateFeedbackByFeature(rows);
  const actionPlan = promptActionPlan(features);
  return {
    totalFeedback: total,
    overallNegativeRate: overall.negativeRate,
    featuresWithFeedback: overall.featuresWithFeedback,
    features,
    actionPlan,
    topPriority: features[0] ? { feature: features[0].feature, priorityScore: features[0].priorityScore, total: features[0].total } : null,
  };
}
