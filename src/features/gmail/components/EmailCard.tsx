/**
 * EmailCard — kartu hasil scan Gmail (diekstrak dari GmailSyncPage, Sprint 1.9).
 * Dipisah agar bisa di-load lazy (chunk terpisah) dan file halaman lebih ramping.
 */
import { motion } from 'framer-motion';
import {
  CheckCircle, ChevronDown, ChevronUp, CopyPlus, RotateCcw, XCircle,
} from 'lucide-react';
import Card from '../../../components/ui/Card';
import CategoryIcon from '../../../components/ui/CategoryIcon';
import { cn } from '../../../lib/utils';
import type { SyncEmail } from '../gmailLogMapper';
import { STATUS_CONFIG } from '../gmailSyncHelpers';

export interface EmailCardProps {
  email: SyncEmail;
  index: number;
  isExpanded: boolean;
  showDebug: boolean;
  onToggleExpand: () => void;
  onApprove: () => void;
  onReject: () => void;
  onRetry: () => void;
  onMarkAsTransaction: () => void;
  onParseWithFallback?: () => void;
  onSkip?: () => void;
  /** State + setter untuk editable note pada needs_review/pending_review */
  noteEditState: Record<string, string>;
  onNoteChange: (emailId: string, value: string) => void;
}

export function EmailCard({
  email,
  index,
  isExpanded,
  showDebug,
  onToggleExpand,
  onApprove,
  onReject,
  onRetry,
  onMarkAsTransaction,
  onParseWithFallback,
  onSkip,
  noteEditState,
  onNoteChange,
}: EmailCardProps) {
  const config = STATUS_CONFIG[email.status] || STATUS_CONFIG.failed;

  return (
    <motion.div
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay: index * 0.02 }}
      data-testid={`email-card-${email.id}`}
    >
      <Card>
        <div className="flex items-start justify-between">
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2">
              <p className="text-sm font-medium text-app-text truncate">
                {email.subject}
              </p>
              {/* Status badge */}
              <span className={cn(
                'text-[10px] font-medium px-1.5 py-0.5 rounded-full whitespace-nowrap',
                config.color,
                config.bg
              )}>
                {config.label}
              </span>
              {email.confidence && email.confidence >= 0.8 && (
                <span className="text-[10px] font-medium text-mint-700 dark:text-mint-300 bg-mint-50 dark:bg-mint-500/12 px-1.5 py-0.5 rounded-full">
                  {Math.round(email.confidence * 100)}%
                </span>
              )}
              {/* Fallback badge */}
              {email.debug?.fallbackUsed && (
                <span className="text-[10px] font-medium text-purple-700 dark:text-purple-300 bg-purple-50 dark:bg-purple-500/12 px-1.5 py-0.5 rounded-full">
                  Parsed by Fallback
                </span>
              )}
            </div>
            <div className="flex items-center gap-2 mt-0.5">
              <span className="text-xs text-app-subtle">{email.from}</span>
              <span className="text-xs text-app-subtle">&middot;</span>
              <span className="text-xs text-app-subtle">
                {new Date(email.date).toLocaleDateString('id-ID')}
              </span>
            </div>

            {/* Amount & merchant */}
            {(email.amount || email.merchant) && (
              <div className="flex items-center gap-2 mt-1">
                {email.amount && (
                  <p className="text-sm font-semibold text-app-text tabular-nums">
                    Rp {email.amount.toLocaleString('id-ID')}
                  </p>
                )}
                {email.merchant && (
                  <span className="text-[10px] text-app-subtle">{email.merchant}</span>
                )}
                {email.category && (
                  <span className="inline-flex items-center gap-1">
                    <CategoryIcon
                      name={email.category}
                      size="sm"
                      animated
                      animationVariant={email.status === 'retry_later' ? 'warning' : email.status === 'pending_review' ? 'review' : email.status === 'approved' ? 'success' : 'soft'}
                    />
                    <span className="text-[10px] text-app-subtle">{email.category}</span>
                  </span>
                )}
              </div>
            )}

            {/* Reason */}
            {/* Transaction note — editable untuk needs_review/pending_review, statis untuk auto_accepted */}
            {(email.status === 'needs_review' || email.status === 'pending_review') && (
              <div className="mt-1.5 space-y-1">
                <span className="text-[10px] font-medium text-app-subtle">Catatan transaksi</span>
                <textarea
                  value={noteEditState[email.id] ?? email.note ?? ''}
                  onChange={(e) => onNoteChange(email.id, e.target.value)}
                  className="w-full rounded-lg px-2.5 py-1.5 text-[11px] app-field resize-none"
                  rows={2}
                  placeholder="Deskripsi singkat transaksi..."
                />
              </div>
            )}
            {email.note && email.status === 'auto_accepted' && (
              <div className="mt-1 flex items-start gap-1.5">
                <span className="text-[10px] font-medium text-app-subtle flex-shrink-0">Catatan:</span>
                <p className="text-[10px] text-app-text line-clamp-2">
                  {email.note}
                </p>
              </div>
            )}

            {email.reason && (
              <p className="text-[10px] text-app-subtle mt-1 italic">
                {email.reason}
              </p>
            )}

            {/* Debug info (expandable) */}
            {showDebug && email.debug && (
              <motion.div
                initial={{ opacity: 0, height: 0 }}
                animate={{ opacity: 1, height: 'auto' }}
                className="mt-2 p-2 rounded-lg bg-app-hover/80 text-[10px] font-mono space-y-0.5"
              >
                <DebugRow label="Message ID" value={email.debug.gmailMessageId} />
                <DebugRow label="Domain" value={email.debug.senderDomain} />
                <DebugRow label="Prefilter" value={email.debug.prefilterDecision} />
                <DebugRow label="AI Called" value={String(email.debug.aiCalled)} />
                <DebugRow label="AI Parsed" value={String(email.debug.aiParsedSuccessful)} />
                <DebugRow label="Amount" value={email.debug.extractedAmount !== null ? String(email.debug.extractedAmount) : '-'} />
                <DebugRow label="Merchant" value={email.debug.extractedMerchant || '-'} />
                <DebugRow label="Confidence" value={email.debug.confidenceScore !== null ? `${Math.round(email.debug.confidenceScore * 100)}%` : '-'} />
                <DebugRow label="Final Status" value={email.debug.finalStatus} />
                {email.debug.errorDetail && (
                  <DebugRow label="Error" value={email.debug.errorDetail} />
                )}
                {email.debug.aiErrorCode && (
                  <DebugRow label="Error Code" value={email.debug.aiErrorCode} />
                )}
                <DebugRow label="Fallback" value={email.debug.fallbackUsed ? 'Yes' : 'No'} />
                {email.debug.skipReason && (
                  <DebugRow label="Skip Reason" value={email.debug.skipReason} />
                )}
                {email.debug.matchedRule && (
                  <DebugRow label="Matched Rule" value={email.debug.matchedRule} />
                )}
                {typeof email.debug.detectedPromoAmount === 'number' && (
                  <DebugRow label="Promo Amount" value={`Rp ${email.debug.detectedPromoAmount.toLocaleString('id-ID')}`} />
                )}
                {email.debug.amountIgnored && (
                  <DebugRow label="Amount Ignored" value="true" />
                )}
                {email.debug.rawResponse && (
                  <DebugRow label="Raw AI" value={email.debug.rawResponse.substring(0, 200)} />
                )}
                {email.debug.cleanedResponse && (
                  <DebugRow label="Cleaned" value={email.debug.cleanedResponse.substring(0, 200)} />
                )}
                {email.debug.modelUsed && (
                  <DebugRow label="Model" value={email.debug.modelUsed} />
                )}
              </motion.div>
            )}

            {/* Expanded detail */}
            {isExpanded && (
              <motion.div
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                className="mt-2 space-y-1"
              >
                {email.description && (
                  <p className="text-[10px] text-app-muted leading-relaxed">
                    {email.description}
                  </p>
                )}
                {email.paymentMethod && (
                  <p className="text-[10px] text-app-subtle">
                    Pembayaran: {email.paymentMethod}
                  </p>
                )}
                {email.transactionType && (
                  <p className="text-[10px] text-app-subtle">
                    Tipe: {email.transactionType === 'expense' ? 'Pengeluaran' : email.transactionType === 'income' ? 'Pemasukan' : email.transactionType}
                  </p>
                )}
              </motion.div>
            )}
          </div>

          {/* Action buttons */}
          <div className="flex flex-col items-end gap-1 ml-2 sm:ml-3">
            {/* Expand/collapse */}
            <button
              onClick={onToggleExpand}
              className="p-1 rounded-lg text-app-subtle hover:text-app-text hover:bg-app-hover transition-colors"
              title="Lihat detail"
            >
              {isExpanded ? <ChevronUp className="w-3.5 h-3.5" /> : <ChevronDown className="w-3.5 h-3.5" />}
            </button>

            {/* Contextual actions */}
            {(email.status === 'pending_review' || email.status === 'needs_review') && (
              <div className="flex gap-1">
                <button
                  onClick={onApprove}
                  className="p-2 rounded-xl bg-mint-50 dark:bg-mint-900/20 text-mint-500 hover:bg-mint-100 dark:hover:bg-mint-900/40 transition-colors"
                  title="Setujui"
                >
                  <CheckCircle className="w-4 h-4" />
                </button>
                <button
                  onClick={onReject}
                  className="p-2 rounded-xl bg-red-50 dark:bg-red-900/20 text-red-500 hover:bg-red-100 dark:hover:bg-red-900/40 transition-colors"
                  title="Tolak"
                >
                  <XCircle className="w-4 h-4" />
                </button>
              </div>
            )}

            {(email.status === 'failed' || email.status === 'retry_later') && (
              <div className="flex gap-1">
                <button
                  onClick={onRetry}
                  className="p-2 rounded-xl bg-amber-50 dark:bg-amber-900/20 text-amber-500 hover:bg-amber-100 dark:hover:bg-amber-900/40 transition-colors"
                  title="Coba Ekstrak Ulang"
                >
                  <RotateCcw className="w-4 h-4" />
                </button>
                {email.status === 'failed' && onParseWithFallback && (
                  <button
                    onClick={onParseWithFallback}
                    className="p-2 rounded-xl bg-purple-50 dark:bg-purple-900/20 text-soft-purple hover:bg-purple-100 dark:hover:bg-purple-900/40 transition-colors"
                    title="Parse dengan Fallback"
                  >
                    <CopyPlus className="w-4 h-4" />
                  </button>
                )}
                {onSkip && (
                  <button
                    onClick={onSkip}
                    className="p-2 rounded-xl bg-app-hover/80 text-app-subtle hover:text-app-text transition-colors"
                    title="Tandai Dilewati"
                  >
                    <XCircle className="w-4 h-4" />
                  </button>
                )}
              </div>
            )}

            {(email.status === 'auto_rejected' || email.status === 'skipped') && (
              <button
                onClick={onMarkAsTransaction}
                className="p-2 rounded-xl bg-primary-50 dark:bg-primary-900/20 text-primary-500 hover:bg-primary-100 dark:hover:bg-primary-900/40 transition-colors"
                title="Tandai sebagai Transaksi"
              >
                <CopyPlus className="w-4 h-4" />
              </button>
            )}
          </div>
        </div>
      </Card>
    </motion.div>
  );
}

function DebugRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex gap-2">
      <span className="text-app-subtle w-20 flex-shrink-0">{label}:</span>
      <span className="text-app-text break-all">{value}</span>
    </div>
  );
}
