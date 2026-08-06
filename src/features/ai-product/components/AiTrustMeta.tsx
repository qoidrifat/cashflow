/**
 * AiTrustMeta — indikator kepercayaan untuk setiap hasil AI (Sprint 1.5 Phase 10).
 *
 * Menampilkan baris kecil: sumber (Gemini / rule-based), model, status fallback,
 * waktu proses, dan kapan diperbarui — agar user tidak merasa AI "mengarang".
 * Komponen ini murni presentasi: menerima ExplainabilityModel, tidak fetch.
 */
import { Bot, Clock, Database, Cpu, ShieldCheck, TriangleAlert } from 'lucide-react';
import { cn } from '../../../lib/utils';
import {
  fallbackReason,
  formatProcessingTime,
  formatTimestamp,
  type ExplainabilityModel,
} from '../../../lib/explainability';

interface AiTrustMetaProps {
  model?: ExplainabilityModel;
  className?: string;
}

const SOURCE_LABELS: Record<string, string> = {
  gemini: 'Didukung Gemini AI',
  'rule-based': 'Aturan lokal (deterministik)',
  local: 'Diproses lokal',
};

export default function AiTrustMeta({ model, className }: AiTrustMetaProps) {
  if (!model) return null;

  const source = model.source || '';
  const sourceLabel = SOURCE_LABELS[source] || (source ? `Sumber: ${source}` : null);
  const fallback = fallbackReason(source);
  const processing = formatProcessingTime(model.processingTimeMs);
  const updated = formatTimestamp(model.lastUpdated || model.timestamp);

  const items: Array<{ icon: React.ReactNode; text: string; tone?: string }> = [];
  if (sourceLabel) items.push({ icon: <ShieldCheck className="h-3 w-3" />, text: sourceLabel });
  if (model.model) items.push({ icon: <Bot className="h-3 w-3" />, text: model.model });
  if (model.dataCoverage) items.push({ icon: <Database className="h-3 w-3" />, text: model.dataCoverage });
  if (processing) items.push({ icon: <Cpu className="h-3 w-3" />, text: `${processing}` });
  if (updated) items.push({ icon: <Clock className="h-3 w-3" />, text: `Diperbarui ${updated}` });

  if (items.length === 0 && !fallback) return null;

  return (
    <div className={cn('flex flex-wrap items-center gap-x-3 gap-y-1 text-[10px] text-app-subtle', className)}>
      {items.map((item, i) => (
        <span key={i} className="inline-flex items-center gap-1">
          {item.icon}
          {item.text}
        </span>
      ))}
      {fallback && (
        <span className="inline-flex items-center gap-1 text-amber-600 dark:text-amber-300" title={fallback}>
          <TriangleAlert className="h-3 w-3" />
          {fallback}
        </span>
      )}
    </div>
  );
}
