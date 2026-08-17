/**
 * AiFeedbackButtons — feedback loop pengguna atas hasil AI (Sprint 1.5 Phase 2).
 *
 * Setiap AI card bisa memakai komponen ini: 👍 Membantu / 👎 Tidak membantu,
 * dengan opsi lanjutan (Kurang sesuai, Tidak relevan, Sudah saya lakukan,
 * Lewati) + alasan opsional. Feedback DI-SIMPAN ke server (ai_feedback) dengan
 * timestamp, feature, user, dan recommendation id — tetapi TIDAK langsung
 * mengubah AI: menjadi dataset evaluasi untuk future training.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { ThumbsUp, ThumbsDown, CheckCircle2, Loader2, Send, X } from 'lucide-react';
import { cn } from '../../../lib/utils';
import { submitFeedback } from '../../../services/aiProductService';
import { FEEDBACK_RATING_LABELS, type Rating } from '../types';

interface AiFeedbackButtonsProps {
  /** Kategori feature AI (advisor, insight, fraud, search, ocr, health, simulation). */
  feature: string;
  /** Id rekomendasi/entitas yang diberi feedback. */
  itemId?: string;
  className?: string;
  /** Label aksesibilitas opsional. */
  ariaLabel?: string;
}

const ADVANCED_RATINGS: Rating[] = ['mismatched', 'irrelevant', 'already_done', 'skip'];

export default function AiFeedbackButtons({
  feature,
  itemId,
  className,
  ariaLabel,
}: AiFeedbackButtonsProps) {
  const [submitted, setSubmitted] = useState<Rating | null>(null);
  const [saving, setSaving] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pendingRating, setPendingRating] = useState<Rating | null>(null);
  const [reasonInput, setReasonInput] = useState('');
  const timerRef = useRef<number | null>(null);

  // Bersihkan timer reset bila komponen unmount (hindari setState setelah unmount).
  useEffect(() => {
    return () => {
      if (timerRef.current) window.clearTimeout(timerRef.current);
    };
  }, []);

  const send = useCallback(async (rating: Rating, reason?: string) => {
    setSaving(true);
    setError(null);
    try {
      await submitFeedback({ feature, itemId, rating, reason: reason?.trim() || undefined });
      setSubmitted(rating);
      setMenuOpen(false);
      setPendingRating(null);
      setReasonInput('');
      if (timerRef.current) window.clearTimeout(timerRef.current);
      timerRef.current = window.setTimeout(() => setSubmitted(null), 4000);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Gagal mengirim feedback');
    } finally {
      setSaving(false);
    }
  }, [feature, itemId]);

  // Pilih rating lanjutan → tampilkan form alasan opsional.
  const chooseAdvanced = (rating: Rating) => {
    setMenuOpen(false);
    setPendingRating(rating);
    setReasonInput('');
  };

  const cancelPending = () => {
    setPendingRating(null);
    setReasonInput('');
  };

  if (submitted) {
    return (
      <span className={cn('inline-flex items-center gap-1.5 text-[11px] font-medium text-mint-600 dark:text-mint-300', className)}>
        <CheckCircle2 className="h-3.5 w-3.5" />
        {FEEDBACK_RATING_LABELS[submitted]} — terima kasih!
      </span>
    );
  }

  if (pendingRating) {
    return (
      <div className={cn('flex items-center gap-1.5 rounded-lg border border-app-border bg-app-bg/60 px-2 py-1.5', className)}>
        <span className="text-[11px] text-app-text">
          {FEEDBACK_RATING_LABELS[pendingRating]} — alasan (opsional):
        </span>
        <input
          value={reasonInput}
          onChange={(e) => setReasonInput(e.target.value)}
          placeholder="Tulis alasan..."
          className="w-36 rounded-md border border-app-border bg-app-card px-2 py-1 text-[11px] text-app-text placeholder:text-app-subtle focus:outline-none focus:border-primary-500/50 focus:ring-2 focus:ring-primary-500/30"
          aria-label="Alasan feedback"
        />
        <button
          type="button"
          aria-label="Kirim feedback"
          disabled={saving}
          onClick={() => send(pendingRating, reasonInput)}
          className="inline-flex h-8 items-center gap-1.5 rounded-md bg-primary-500 px-2.5 text-[11px] font-semibold text-white hover:bg-primary-600 disabled:opacity-50"
        >
          {saving ? <Loader2 className="h-3 w-3 animate-spin" /> : <Send className="h-3 w-3" />}
        </button>
        <button
          type="button"
          aria-label="Batal"
          onClick={cancelPending}
          className="inline-flex h-8 w-8 items-center justify-center rounded-md text-app-subtle hover:text-app-text"
        >
          <X className="h-3.5 w-3.5" />
        </button>
      </div>
    );
  }

  return (
    <div className={cn('inline-flex items-center gap-1.5', className)} role="group" aria-label={ariaLabel || 'Beri feedback pada hasil AI'}>
      <span className="text-[11px] font-medium uppercase tracking-wide text-app-subtle">Feedback:</span>
      <button
        type="button"
        aria-label="Membantu"
        disabled={saving}
        onClick={() => send('helpful')}
        className="app-icon-button h-8 w-8 rounded-md text-app-muted hover:text-mint-600 dark:hover:text-mint-300 disabled:opacity-50"
      >
        <ThumbsUp className="h-4 w-4" />
      </button>
      <button
        type="button"
        aria-label="Tidak membantu"
        disabled={saving}
        onClick={() => setMenuOpen((v) => !v)}
        className="app-icon-button h-8 w-8 rounded-md text-app-muted hover:text-red-500 dark:hover:text-red-300 disabled:opacity-50"
      >
        <ThumbsDown className="h-4 w-4" />
      </button>

      {saving && <Loader2 className="h-3.5 w-3.5 animate-spin text-app-subtle" />}

      {menuOpen && (
        <div className="relative">
          <div className="absolute left-0 top-full z-30 mt-1 w-52 rounded-lg border border-app-border bg-app-card p-1.5 shadow-xl">
            <p className="px-2 pb-1 pt-0.5 text-[11px] font-semibold uppercase tracking-wide text-app-subtle">
              Apa yang kurang?
            </p>
            {ADVANCED_RATINGS.map((r) => (
              <button
                key={r}
                type="button"
                onClick={() => chooseAdvanced(r)}
                className="block w-full rounded-md px-2 py-1.5 text-left text-xs text-app-text hover:bg-app-hover"
              >
                {FEEDBACK_RATING_LABELS[r]}
              </button>
            ))}
          </div>
        </div>
      )}

      {error && <span className="text-[11px] text-red-500">{error}</span>}
    </div>
  );
}
