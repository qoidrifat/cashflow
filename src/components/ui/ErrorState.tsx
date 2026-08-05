import { AlertTriangle } from 'lucide-react';
import { friendlyErrorMessage } from '../../lib/errorSystem';
import Button from './Button';
import { cn } from '../../lib/utils';

interface ErrorStateProps {
  /** Error mentah dari fetch/aksi — diterjemahkan ke pesan ramah otomatis. */
  error?: unknown;
  title?: string;
  onRetry?: () => void;
  className?: string;
}

/**
 * Error State (Sprint 1 — Core Product).
 * Pengganti halaman/panel error kosong: ikon + pesan ramah + diagnostik
 * (requestId / error code untuk dukungan) + tombol Coba Lagi bila ada retry.
 */
export default function ErrorState({
  error,
  title = 'Terjadi Kesalahan',
  onRetry,
  className,
}: ErrorStateProps) {
  const info = friendlyErrorMessage(error);
  const showDiagnostic = Boolean(info.requestId || info.code);

  return (
    <div className={cn(
      'flex flex-col items-center justify-center py-16 px-6 text-center',
      className,
    )}>
      <div className="relative mb-4">
        <div className="absolute inset-0 rounded-3xl bg-red-500/10 blur-xl" />
        <div className="relative w-16 h-16 rounded-3xl border border-red-500/20 bg-red-500/[0.06] flex items-center justify-center text-red-500 dark:text-red-300 shadow-sm">
          <AlertTriangle className="w-8 h-8" />
        </div>
      </div>
      <h3 className="text-base font-bold text-app-text mb-1">
        {title}
      </h3>
      <p className="text-sm leading-relaxed text-app-muted max-w-sm mb-2">
        {info.message}
      </p>
      {showDiagnostic && (
        <p className="text-[11px] text-app-subtle/70 font-mono mb-4 break-all">
          {[info.requestId && `Request ${info.requestId}`, info.code]
            .filter(Boolean)
            .join(' · ')}
        </p>
      )}
      {onRetry && (
        <Button variant="primary" onClick={onRetry}>
          Coba Lagi
        </Button>
      )}
    </div>
  );
}
