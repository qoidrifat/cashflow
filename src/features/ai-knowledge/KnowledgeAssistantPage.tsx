import { useCallback, useEffect, useState } from 'react';
import { motion } from 'framer-motion';
import { BookOpenCheck, BrainCircuit, FileText, LockKeyhole, Search, ShieldCheck, Sparkles } from 'lucide-react';
import Header from '../../components/layout/Header';
import Button from '../../components/ui/Button';
import Card from '../../components/ui/Card';
import { cn } from '../../lib/utils';
import {
  askCashflowKnowledge,
  fetchKnowledgeConfig,
  DEFAULT_SUGGESTED_QUESTIONS,
  type KnowledgeConfig,
  type KnowledgeResponse,
  type KnowledgeSource,
} from './services/knowledgeClient';

/**
 * CashFlow AI Knowledge Assistant (P0.14) — grounded Q&A atas knowledge base
 * CashFlow (docs non-sensitif, READ-ONLY).
 *
 * Gating:
 *   - Runtime: GET /api/ai/cashflow-knowledge/config → `enabled` adalah sumber
 *     kebenaran (server flag GOOGLE_AGENT_PLATFORM_ENABLED). Bila false, halaman
 *     menampilkan state "Fitur belum diaktifkan" (billing gate P0.14) — input
 *     pertanyaan tidak dirender.
 *   - Nav (Sidebar/BottomNav): hanya tampil bila VITE_GOOGLE_AGENT_PLATFORM_ENABLED
 *     (build-time). Route tetap terdaftar agar state non-aktif bisa diakses
 *     via deep-link & diuji E2E.
 *
 * Tidak ada data user yang dikirim ke Google; tidak ada mutasi wallet/verifikasi.
 */
export default function KnowledgeAssistantPage() {
  const [config, setConfig] = useState<KnowledgeConfig | null>(null);
  const [query, setQuery] = useState('');
  const [response, setResponse] = useState<KnowledgeResponse | null>(null);
  const [asking, setAsking] = useState(false);

  useEffect(() => {
    let cancelled = false;
    // fail-closed: client sudah tidak pernah melempar, tapi tetap dijaga
    // defense-in-depth — kegagalan apa pun → state non-aktif (tanpa input).
    fetchKnowledgeConfig()
      .then((config) => {
        if (!cancelled) setConfig(config);
      })
      .catch(() => {
        if (!cancelled) setConfig({ enabled: false });
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const ask = useCallback(
    async (question?: string) => {
      const safeQuery = (question ?? query).trim();
      if (safeQuery.length < 2 || asking) return;
      setAsking(true);
      setResponse(null);
      try {
        setResponse(await askCashflowKnowledge(safeQuery));
      } finally {
        setAsking(false);
      }
    },
    [asking, query],
  );

  const enabled = config?.enabled === true;

  return (
    <div>
      <Header title="AI Knowledge" />

      <div className="mx-auto max-w-3xl space-y-5 p-4 lg:p-6">
        {/* Hero */}
        <section className="overflow-hidden rounded-[1.5rem] border border-app-border bg-app-elevated/88 p-5 shadow-sm lg:p-6">
          <div className="flex flex-col gap-5 lg:flex-row lg:items-end lg:justify-between">
            <div className="min-w-0">
              <div className="inline-flex items-center gap-2 rounded-full border border-mint-200 bg-mint-50 px-3 py-1 text-xs font-bold text-mint-700 dark:border-mint-400/20 dark:bg-mint-500/10 dark:text-mint-200">
                <Sparkles className="h-3.5 w-3.5" />
                Google Agent Platform
              </div>
              <h1 className="mt-4 text-2xl font-black text-app-text sm:text-3xl">CashFlow AI Knowledge</h1>
              <p className="mt-2 max-w-2xl text-sm leading-relaxed text-app-muted">
                Tanya tentang CashFlow — jawaban grounded dari knowledge base resmi, lengkap dengan sumber referensi.
              </p>
            </div>
            <StatusPill label={enabled ? 'Aktif' : 'Belum aktif'} active={enabled} />
          </div>
        </section>

        {config === null ? (
          <LoadingCard />
        ) : !enabled ? (
          <DisabledState />
        ) : (
          <>
            {/* Q&A panel */}
            <Card className="bg-app-elevated/72">
              <label htmlFor="knowledge-question" className="sr-only">
                Pertanyaan tentang CashFlow
              </label>
              <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
                <div className="relative min-w-0 flex-1">
                  <Search className="pointer-events-none absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-app-subtle" />
                  <input
                    id="knowledge-question"
                    type="text"
                    value={query}
                    onChange={(event) => setQuery(event.target.value)}
                    onKeyDown={(event) => {
                      if (event.key === 'Enter') ask();
                    }}
                    placeholder="Tanya tentang CashFlow… mis. cara menambahkan wallet"
                    maxLength={500}
                    disabled={asking}
                    className="h-12 w-full rounded-2xl border border-app-border bg-app-bg pl-10 pr-4 text-sm font-medium text-app-text outline-none placeholder:text-app-subtle focus:border-primary-400 focus:ring-2 focus:ring-primary-500/30 disabled:opacity-60"
                  />
                </div>
                <Button
                  onClick={() => ask()}
                  loading={asking}
                  disabled={asking || query.trim().length < 2}
                  className="shrink-0"
                >
                  Tanyakan
                </Button>
              </div>

              <div className="mt-4 flex flex-wrap items-center gap-2">
                <span className="inline-flex items-center gap-1.5 text-[11px] font-bold uppercase tracking-[0.08em] text-app-subtle">
                  <Sparkles className="h-3.5 w-3.5" />
                  Coba tanyakan
                </span>
                {DEFAULT_SUGGESTED_QUESTIONS.map((question) => (
                  <button
                    key={question}
                    type="button"
                    onClick={() => {
                      setQuery(question);
                      ask(question);
                    }}
                    disabled={asking}
                    className="inline-flex h-8 max-w-[280px] items-center truncate rounded-full border border-app-border bg-app-elevated px-3 text-xs font-semibold text-app-text transition-colors hover:border-primary-300 hover:bg-primary-50 hover:text-primary-700 disabled:opacity-60 dark:hover:bg-primary-500/10 dark:hover:text-primary-200"
                  >
                    <span className="truncate">{question}</span>
                  </button>
                ))}
              </div>
            </Card>

            {/* Result states */}
            {asking && <LoadingCard label="CashFlow sedang mencari jawaban dari knowledge base…" />}

            {!asking && response && response.ok && response.noInfo && (
              <Card className="border-app-border bg-app-elevated/72">
                <div className="flex items-start gap-3">
                  <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-2xl bg-amber-500/10 text-amber-600 dark:text-amber-300">
                    <BookOpenCheck className="h-5 w-5" />
                  </div>
                  <div className="min-w-0">
                    <p className="text-sm font-bold text-app-text">Belum ada jawaban di knowledge base</p>
                    <p className="mt-1 text-sm leading-relaxed text-app-muted">{response.message}</p>
                  </div>
                </div>
              </Card>
            )}

            {!asking && response && response.ok && !response.noInfo && (
              <AnswerCard answer={response.answer || ''} sources={response.sources || []} />
            )}

            {!asking && response && !response.ok && (
              <Card className="border-red-300/60 bg-red-50/60 dark:border-red-400/20 dark:bg-red-500/8">
                <div className="flex items-start gap-3">
                  <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-2xl bg-red-500/10 text-red-600 dark:text-red-300">
                    <ShieldCheck className="h-5 w-5" />
                  </div>
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-bold text-app-text">AI knowledge service tidak tersedia</p>
                    <p className="mt-1 text-sm leading-relaxed text-app-muted">
                      {response.message || 'AI knowledge service temporarily unavailable'}
                    </p>
                    <Button size="sm" variant="outline" className="mt-3" onClick={() => ask()} disabled={asking}>
                      Coba lagi
                    </Button>
                  </div>
                </div>
              </Card>
            )}

            {/* Privacy note */}
            <Card className="bg-app-elevated/72">
              <div className="flex items-start gap-3">
                <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-2xl bg-primary-500/10 text-primary-600 dark:text-primary-200">
                  <ShieldCheck className="h-5 w-5" />
                </div>
                <div className="min-w-0">
                  <h2 className="text-sm font-bold text-app-text">Privacy guard aktif</h2>
                  <p className="mt-1 text-xs leading-relaxed text-app-muted">
                    Hanya pertanyaan &amp; knowledge base CashFlow (dokumentasi non-sensitif) yang dikirim ke Google.
                    Data transaksi, Gmail, wallet, dan identitas tidak pernah keluar dari CashFlow. Fitur ini read-only —
                    tidak mengubah wallet, saldo, atau status verifikasi.
                  </p>
                </div>
              </div>
            </Card>
          </>
        )}
      </div>
    </div>
  );
}

function StatusPill({ label, active }: { label: string; active: boolean }) {
  return (
    <div
      className={cn(
        'flex min-h-[44px] items-center gap-2 rounded-2xl border px-3 text-xs font-bold',
        active
          ? 'border-mint-200 bg-mint-50 text-mint-700 dark:border-mint-400/20 dark:bg-mint-500/10 dark:text-mint-200'
          : 'border-amber-200 bg-amber-50 text-amber-700 dark:border-amber-400/20 dark:bg-amber-500/10 dark:text-amber-200',
      )}
    >
      <span className={cn('h-2 w-2 rounded-full', active ? 'bg-mint-500' : 'bg-amber-500')} />
      {label}
    </div>
  );
}

function DisabledState() {
  return (
    <Card className="border-app-border bg-app-elevated/72">
      <div className="flex flex-col items-start gap-4 sm:flex-row sm:items-center">
        <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl bg-amber-500/10 text-amber-600 dark:text-amber-300">
          <LockKeyhole className="h-6 w-6" />
        </div>
        <div className="min-w-0">
          <h2 className="text-base font-bold text-app-text">Fitur AI Knowledge belum diaktifkan</h2>
          <p className="mt-1 text-sm leading-relaxed text-app-muted">
            Fitur ini aktif setelah verifikasi billing eligibility Google Agent Platform selesai
            (docs/google-agent-platform/BILLING_PROOF.md). Tidak ada data pengguna yang dikirim ke Google selama
            fitur nonaktif.
          </p>
        </div>
      </div>
    </Card>
  );
}

function AnswerCard({ answer, sources }: { answer: string; sources: KnowledgeSource[] }) {
  return (
    <Card className="border-mint-200/70 bg-mint-50/70 dark:border-mint-400/20 dark:bg-mint-500/8">
      <div className="flex items-start gap-3">
        <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-2xl bg-mint-500 text-white shadow-sm shadow-mint-500/20">
          <BrainCircuit className="h-5 w-5" />
        </div>
        <div className="min-w-0 flex-1">
          <p className="text-xs font-bold uppercase tracking-[0.14em] text-mint-700 dark:text-mint-200">Jawaban grounded</p>
          <p className="mt-2 whitespace-pre-wrap text-sm leading-relaxed text-app-text">{answer}</p>

          {sources.length > 0 && (
            <div className="mt-4 border-t border-app-border pt-4">
              <p className="text-[11px] font-bold uppercase tracking-[0.08em] text-app-subtle">Sumber</p>
              <ul className="mt-2 flex flex-wrap gap-2">
                {sources.map((source, index) => (
                  <li
                    key={`${source.title}-${index}`}
                    className="inline-flex max-w-full items-center gap-1.5 rounded-full border border-app-border bg-app-elevated px-3 py-1.5 text-xs font-semibold text-app-text"
                  >
                    <FileText className="h-3.5 w-3.5 shrink-0 text-app-subtle" />
                    <span className="truncate">{source.title}</span>
                    {source.section && (
                      <span className="shrink-0 rounded-full bg-app-hover px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide text-app-subtle">
                        {source.section}
                      </span>
                    )}
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
      </div>
    </Card>
  );
}

function LoadingCard({ label = 'Memeriksa status fitur…' }: { label?: string }) {
  return (
    <Card>
      <div className="animate-pulse space-y-4">
        <div className="h-4 w-48 rounded-full bg-app-hover" />
        <div className="h-3 w-full rounded-full bg-app-hover" />
        <div className="h-3 w-2/3 rounded-full bg-app-hover" />
        <p className="text-sm font-semibold text-app-muted">{label}</p>
      </div>
    </Card>
  );
}
