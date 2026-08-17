import { AlertTriangle, BookOpen, RefreshCw, Search } from 'lucide-react';
import { Link } from 'react-router-dom';
import Card from '../../../components/ui/Card';

export default function AiSearchErrorState({
  code,
  message,
  onRetry,
}: {
  code?: string;
  message: string;
  onRetry?: () => void;
}) {
  const notConfigured = code === 'AGENT_SEARCH_NOT_CONFIGURED' || code === 'AGENT_SEARCH_CREDENTIAL_MISSING';
  const isInvalidRequest = code === 'AGENT_SEARCH_INVALID_REQUEST';
  const isQuota = code === 'AGENT_SEARCH_QUOTA_EXCEEDED';
  const isNetwork = code === 'AGENT_SEARCH_NETWORK_ERROR';

  const title = notConfigured
    ? 'AI Search belum aktif'
    : isInvalidRequest
      ? 'Pencarian perlu penyesuaian'
      : isQuota
        ? 'Limit tercapai'
        : isNetwork
          ? 'Koneksi terputus'
          : 'AI Search belum bisa memproses';

  const description = notConfigured
    ? 'Lengkapi setup GenAI App Builder di server/.env.'
    : isInvalidRequest
      ? 'Coba dengan kata kunci berbeda atau pastikan data sudah di-sync ke Agent Search.'
      : message;

  return (
    <Card className="border-amber-200 bg-amber-50/70 dark:border-amber-400/20 dark:bg-amber-500/8">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex min-w-0 items-start gap-3">
          <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-2xl bg-amber-500 text-white">
            {isInvalidRequest ? <Search className="h-5 w-5" /> : <AlertTriangle className="h-5 w-5" />}
          </div>
          <div className="min-w-0">
            <h3 className="text-sm font-bold text-app-text">{title}</h3>
            <p className="mt-1 break-words text-sm leading-relaxed text-app-muted">{description}</p>
            {isInvalidRequest && (
              <div className="mt-2 space-y-1">
                <p className="text-xs font-medium text-app-subtle">Coba query seperti:</p>
                <div className="flex flex-wrap gap-1.5">
                  {['total pengeluaran', 'transaksi shopee', 'pembayaran bulan ini'].map((suggestion) => (
                    <span key={suggestion} className="rounded-full bg-app-hover px-2.5 py-0.5 text-[11px] font-medium text-app-muted">
                      {suggestion}
                    </span>
                  ))}
                </div>
              </div>
            )}
          </div>
        </div>
        <div className="flex shrink-0 gap-2">
          {onRetry && (
            <button
              onClick={onRetry}
              className="inline-flex min-h-[44px] items-center justify-center gap-2 rounded-xl bg-primary-600 px-3 text-sm font-semibold text-white shadow-sm transition-colors hover:bg-primary-700"
            >
              <RefreshCw className="h-4 w-4" />
              Coba Lagi
            </button>
          )}
          {notConfigured && (
            <Link
              to="/docs/google-cloud/GENAI_APP_BUILDER_CASHFLOW_SETUP.md"
              className="inline-flex min-h-[44px] items-center justify-center gap-2 rounded-xl bg-app-elevated px-3 text-sm font-semibold text-app-text shadow-sm transition-colors hover:bg-app-hover"
            >
              <BookOpen className="h-4 w-4" />
              Panduan Setup
            </Link>
          )}
        </div>
      </div>
    </Card>
  );
}
