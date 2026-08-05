import { BrainCircuit, FileText, Lightbulb } from 'lucide-react';
import Card from '../../../components/ui/Card';
import type { AgentSearchAnswer } from '../services/agentSearchClient';

export default function AiAnswerCard({
  answer,
  suggestedQueries = [],
  onSuggestionPick,
}: {
  answer: AgentSearchAnswer | null;
  suggestedQueries?: string[];
  onSuggestionPick?: (suggestion: string) => void;
}) {
  if (!answer?.text && !answer?.warning) return null;

  return (
    <Card className="border-mint-200/70 bg-mint-50/70 dark:border-mint-400/20 dark:bg-mint-500/8">
      <div className="flex items-start gap-3">
        <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-2xl bg-mint-500 text-white shadow-sm shadow-mint-500/20">
          <BrainCircuit className="h-5 w-5" />
        </div>
        <div className="min-w-0 flex-1">
          <p className="text-xs font-bold uppercase tracking-[0.14em] text-mint-700 dark:text-mint-200">Jawaban AI</p>
          {answer.text ? (
            <p className="mt-2 whitespace-pre-wrap text-sm leading-relaxed text-app-text">{answer.text}</p>
          ) : (
            <p className="mt-2 text-sm leading-relaxed text-app-muted">{answer.warning}</p>
          )}
          <div className="mt-4 flex flex-wrap items-center gap-2 text-xs text-app-muted">
            <span className="inline-flex items-center gap-1 rounded-full border border-app-border bg-app-elevated px-2.5 py-1">
              <FileText className="h-3.5 w-3.5" />
              {answer.sourceCount || 0} sumber
            </span>
            {answer.warning && (
              <span className="rounded-full border border-amber-300/70 bg-amber-50 px-2.5 py-1 text-amber-700 dark:border-amber-400/25 dark:bg-amber-500/10 dark:text-amber-200">
                Ringkasan terbatas
              </span>
            )}
          </div>
          {suggestedQueries.length > 0 && onSuggestionPick && (
            <div className="mt-4 flex flex-wrap items-center gap-2 border-t border-app-border pt-4">
              <span className="inline-flex items-center gap-1.5 text-[11px] font-bold uppercase tracking-[0.08em] text-app-subtle">
                <Lightbulb className="h-3.5 w-3.5" />
                Coba tanyakan
              </span>
              {suggestedQueries.map((suggestion) => (
                <button
                  key={suggestion}
                  type="button"
                  onClick={() => onSuggestionPick(suggestion)}
                  className="inline-flex h-8 max-w-[280px] items-center truncate rounded-full border border-mint-200 bg-white/60 px-3 text-xs font-semibold text-mint-700 transition-colors hover:border-mint-300 hover:bg-mint-50 dark:border-mint-400/20 dark:bg-mint-500/10 dark:text-mint-200 dark:hover:bg-mint-500/20"
                >
                  <span className="truncate">{suggestion}</span>
                </button>
              ))}
            </div>
          )}
        </div>
      </div>
    </Card>
  );
}
