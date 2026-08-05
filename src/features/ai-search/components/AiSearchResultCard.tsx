import { ArrowUpRight, CalendarDays, Mail, ReceiptText, Search, Tag } from 'lucide-react';
import { Link } from 'react-router-dom';
import Card from '../../../components/ui/Card';
import { cn, formatCurrency } from '../../../lib/utils';
import type { AiSearchTab, AgentSearchResult } from '../services/agentSearchClient';

function valueText(value: unknown): string {
  return typeof value === 'string' ? value : '';
}

function amountText(value: unknown): string {
  return typeof value === 'number' ? formatCurrency(value) : '';
}

function actionFor(tab: AiSearchTab, result: AgentSearchResult) {
  if (tab === 'help') return { label: 'Buka Panduan', href: result.path ? `/${result.path}` : '/settings' };
  if (tab === 'gmail') return { label: 'Lihat Gmail Sync', href: '/gmail-sync' };
  return { label: 'Lihat Transaksi', href: '/transactions' };
}

export default function AiSearchResultCard({
  result,
  tab,
  onOpen,
}: {
  result: AgentSearchResult;
  tab: AiSearchTab;
  onOpen?: () => void;
}) {
  const action = actionFor(tab, result);
  const title = valueText(result.title) || valueText(result.merchant) || valueText(result.subject) || 'Hasil AI Search';
  const amount = amountText(result.amount);
  const date = valueText(result.transaction_date) || valueText(result.email_date);
  const source = valueText(result.source) || (tab === 'gmail' ? 'gmail_sync' : tab);
  const description = String(result.snippet || result.note || result.extracted_note || '');

  return (
    <Card className="transition-all duration-200 hover:-translate-y-0.5 hover:shadow-lg">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <span
              className={cn(
                'inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-[11px] font-bold uppercase tracking-[0.08em]',
                tab === 'gmail'
                  ? 'bg-sky-50 text-sky-700 dark:bg-sky-500/10 dark:text-sky-200'
                  : tab === 'receipts'
                    ? 'bg-amber-50 text-amber-700 dark:bg-amber-500/10 dark:text-amber-200'
                    : 'bg-primary-50 text-primary-700 dark:bg-primary-500/10 dark:text-primary-200',
              )}
            >
              {tab === 'gmail' ? <Mail className="h-3.5 w-3.5" /> : tab === 'receipts' ? <ReceiptText className="h-3.5 w-3.5" /> : <Search className="h-3.5 w-3.5" />}
              {source.replace(/_/g, ' ')}
            </span>
            {result.final_status && (
              <span className="rounded-full border border-app-border px-2.5 py-1 text-[11px] font-semibold text-app-muted">
                {String(result.final_status).replace(/_/g, ' ')}
              </span>
            )}
            {result.error_code && (
              <span className="rounded-full border border-red-200 bg-red-50 px-2.5 py-1 text-[11px] font-semibold text-red-700 dark:border-red-400/20 dark:bg-red-500/10 dark:text-red-200">
                {String(result.error_code)}
              </span>
            )}
          </div>

          <h3 className="mt-3 break-words text-base font-bold text-app-text">{title}</h3>
          {description && (
            <p className="mt-2 line-clamp-3 break-words text-sm leading-relaxed text-app-muted">
              {description}
            </p>
          )}

          <div className="mt-4 flex flex-wrap gap-2 text-xs text-app-muted">
            {amount && (
              <span className="rounded-full bg-app-hover px-2.5 py-1 font-bold tabular-nums text-app-text">{amount}</span>
            )}
            {result.category && (
              <span className="inline-flex items-center gap-1 rounded-full bg-app-hover px-2.5 py-1">
                <Tag className="h-3.5 w-3.5" />
                {String(result.category)}
              </span>
            )}
            {date && (
              <span className="inline-flex items-center gap-1 rounded-full bg-app-hover px-2.5 py-1">
                <CalendarDays className="h-3.5 w-3.5" />
                {date.slice(0, 10)}
              </span>
            )}
            {result.sender_domain && <span className="rounded-full bg-app-hover px-2.5 py-1">{String(result.sender_domain)}</span>}
            {result.payment_method && <span className="rounded-full bg-app-hover px-2.5 py-1">{String(result.payment_method)}</span>}
          </div>

          {Array.isArray(result.explanation) && result.explanation.length > 0 && (
            <p className="mt-3 flex flex-wrap gap-1.5 text-[11px] text-app-subtle">
              <span className="font-semibold">Mengapa muncul:</span>
              {result.explanation.map((reason) => (
                <span key={reason} className="rounded-full bg-app-hover px-2 py-0.5">
                  {reason}
                </span>
              ))}
            </p>
          )}
        </div>

        <Link
          to={action.href}
          onClick={onOpen}
          className="inline-flex min-h-[44px] shrink-0 items-center justify-center gap-2 rounded-xl border border-app-border px-3 text-sm font-semibold text-app-text transition-colors hover:bg-app-hover"
        >
          {action.label}
          <ArrowUpRight className="h-4 w-4" />
        </Link>
      </div>
    </Card>
  );
}
