/**
 * AiConfidenceBadge — badge confidence dengan INTERPRETASI bahasa.
 * "Jangan hanya menampilkan angka confidence" (Sprint 1.5 Phase 1 & 10).
 *
 *   ≥90% "Sangat yakin" · ≥70% "Yakin" · ≥50% "Cukup yakin" · <50% "Perlu verifikasi"
 */
import { useState } from 'react';
import { Info } from 'lucide-react';
import { cn } from '../../../lib/utils';
import {
  interpretConfidence,
  CONFIDENCE_BADGE_STYLES,
  type ConfidenceInterpretation,
} from '../../../lib/explainability';

interface AiConfidenceBadgeProps {
  /** Confidence 0-1. */
  score?: number | null;
  /** Sembunyikan angka %, hanya tampilkan label. */
  hidePercent?: boolean;
  /** Tampilkan ikon info dengan interpretasi lebih lengkap. */
  showExplanation?: boolean;
  className?: string;
}

export default function AiConfidenceBadge({
  score,
  hidePercent = false,
  showExplanation = false,
  className,
}: AiConfidenceBadgeProps) {
  const [open, setOpen] = useState(false);
  const interpretation: ConfidenceInterpretation | null = interpretConfidence(score);

  if (!interpretation) return null;

  return (
    <span className={cn('relative inline-flex items-center gap-1', className)}>
      <span
        className={cn(
          'inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[11px] font-semibold',
          CONFIDENCE_BADGE_STYLES[interpretation.bucket],
        )}
      >
        <span className="relative flex h-1.5 w-1.5">
          <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-current opacity-40" />
          <span className="relative inline-flex h-1.5 w-1.5 rounded-full bg-current" />
        </span>
        {interpretation.label}
        {!hidePercent && <span className="tabular-nums opacity-80">{interpretation.percent}%</span>}
      </span>

      {showExplanation && (
        <button
          type="button"
          aria-label="Penjelasan confidence"
          onClick={() => setOpen((v) => !v)}
          className="inline-flex h-4 w-4 items-center justify-center rounded-full text-app-subtle hover:text-app-text"
        >
          <Info className="h-3.5 w-3.5" />
        </button>
      )}

      {open && (
        <span className="absolute left-0 top-full z-20 mt-1.5 w-52 rounded-lg border border-app-border bg-app-card p-2.5 text-[11px] leading-relaxed text-app-muted shadow-lg">
          Interpretasi confidence: {interpretation.label} ({interpretation.percent}%).
          {interpretation.bucket === 'low' && ' Hasil ini memerlukan verifikasi manual sebelum ditindaklanjuti.'}
          {interpretation.bucket === 'medium' && ' Berdasarkan pola yang cukup jelas, namun tetap bisa direview.'}
          {(interpretation.bucket === 'high' || interpretation.bucket === 'very_high') && ' Pola pendukung kuat dan konsisten.'}
        </span>
      )}
    </span>
  );
}
