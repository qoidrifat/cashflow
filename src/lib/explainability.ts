/**
 * Explainability Model (Sprint 1.5 — AI Product Experience).
 *
 * Standarisasi "mengapa AI menghasilkan keputusan ini" untuk SEMUA hasil AI:
 * fraud, insight, advisor, search, OCR, health, simulation.
 *
 * Confidence TIDAK pernah ditampilkan sebagai angka mentah — selalu punya
 * interpretasi bahasa (mis. 98% → "Sangat yakin"). Setiap hasil AI minimal
 * memiliki: reason, evidence, confidence (+interpretasi), source, rule trigger,
 * affected transaction, timestamp, last updated, processing time, dan status
 * fallback (bila AI tidak tersedia, jelaskan).
 */
export type ConfidenceBucket = 'very_high' | 'high' | 'medium' | 'low';

export interface ConfidenceInterpretation {
  /** Nilai 0-1 asli. */
  score: number;
  /** Label bahasa Indonesia untuk user. */
  label: string;
  /** Bucket untuk styling (badge color, dsb). */
  bucket: ConfidenceBucket;
  /** Persen dibulatkan (0-100). */
  percent: number;
}

/**
 * Interpretasi confidence 0-1 → label + bucket.
 *   ≥ 0.90 → "Sangat yakin"  (very_high)
 *   ≥ 0.70 → "Yakin"         (high)
 *   ≥ 0.50 → "Cukup yakin"   (medium)
 *   < 0.50 → "Perlu verifikasi" (low)
 */
export function interpretConfidence(score: number | null | undefined): ConfidenceInterpretation | null {
  if (score === null || score === undefined) return null;
  const n = Number(score);
  if (!Number.isFinite(n)) return null;
  const clamped = Math.max(0, Math.min(1, n));
  const percent = Math.round(clamped * 100);

  if (clamped >= 0.9) return { score: clamped, label: 'Sangat yakin', bucket: 'very_high', percent };
  if (clamped >= 0.7) return { score: clamped, label: 'Yakin', bucket: 'high', percent };
  if (clamped >= 0.5) return { score: clamped, label: 'Cukup yakin', bucket: 'medium', percent };
  return { score: clamped, label: 'Perlu verifikasi', bucket: 'low', percent };
}

/** Warna Tailwind untuk tiap bucket (dark-mode aware). */
export const CONFIDENCE_BADGE_STYLES: Record<ConfidenceBucket, string> = {
  very_high: 'bg-mint-500/12 text-mint-600 dark:text-mint-300 border-mint-500/30',
  high: 'bg-primary-500/12 text-primary-600 dark:text-primary-300 border-primary-500/30',
  medium: 'bg-amber-500/12 text-amber-600 dark:text-amber-300 border-amber-500/30',
  low: 'bg-red-500/12 text-red-500 dark:text-red-300 border-red-500/30',
};

/**
 * Alasan fallback AI (dipakai saat AI tidak tersedia/gagal → hasil rule-based).
 * Menjelaskan kepada user bahwa hasil bukan dari model, dan kenapa.
 */
export function fallbackReason(source: 'gemini' | 'rule-based' | 'local' | string): string | null {
  if (source === 'gemini') return null;
  if (source === 'rule-based') return 'AI tidak tersedia saat ini — hasil dihitung dari aturan lokal yang deterministik.';
  if (source === 'local') return 'Diproses lokal tanpa AI untuk kecepatan dan privasi.';
  return `Sumber: ${source}`;
}

/**
 * Model explainability terpadu untuk satu hasil AI.
 * Semua field opsional — komponen rendering memilih mana yang tampil.
 */
export interface ExplainabilityModel {
  /** Alasan keputusan dalam bahasa manusia (1-2 kalimat). */
  reason?: string;
  /** Bukti pendukung (angka, threshold, fakta). */
  evidence?: string[];
  /** Confidence 0-1. */
  confidence?: number | null;
  /** Sumber: gemini | rule-based | local | dll. */
  source?: string;
  /** Rule yang memicu (mis. 'velocity > 5'). */
  ruleTrigger?: string;
  /** Transaksi terkait (id/merchant/nominal). */
  affectedTransaction?: string;
  /** Kapan hasil dibuat. */
  timestamp?: string;
  /** Kapan terakhir diperbarui (bisa beda dari timestamp). */
  lastUpdated?: string;
  /** Waktu proses (ms). */
  processingTimeMs?: number;
  /** Nama model (mis. gemini-2.5-flash). */
  model?: string;
  /** Kategori/feature AI. */
  feature?: string;
  /** Cakupan data yang mendukung hasil (mis. "3 bulan transaksi"). */
  dataCoverage?: string;
}

/** Ringkas processingTimeMs → label ramah user ("0.4 dtk"). */
export function formatProcessingTime(ms?: number): string | null {
  if (ms === undefined || ms === null || !Number.isFinite(ms)) return null;
  if (ms < 1000) return `${Math.round(ms)} ms`;
  return `${(ms / 1000).toFixed(1)} dtk`;
}

/** Ringkas timestamp ISO → label lokal ramah user. */
export function formatTimestamp(value?: string): string | null {
  if (!value) return null;
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return null;
  return d.toLocaleString('id-ID', {
    day: '2-digit',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
  });
}
