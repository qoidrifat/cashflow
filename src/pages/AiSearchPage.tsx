import { useEffect, useMemo, useState } from 'react';
import { motion } from 'framer-motion';
import { DatabaseZap, RefreshCw, ShieldCheck, Sparkles } from 'lucide-react';
import Header from '../components/layout/Header';
import Button from '../components/ui/Button';
import Card from '../components/ui/Card';
import { useAppStore } from '../store/useAppStore';
import { useAuthStore } from '../store/useAuthStore';
import AiAnswerCard from '../features/ai-search/components/AiAnswerCard';
import AiSearchBox from '../features/ai-search/components/AiSearchBox';
import AiSearchEmptyState from '../features/ai-search/components/AiSearchEmptyState';
import AiSearchErrorState from '../features/ai-search/components/AiSearchErrorState';
import AiSearchResultCard from '../features/ai-search/components/AiSearchResultCard';
import AiSearchTabs, { AI_SEARCH_TABS } from '../features/ai-search/components/AiSearchTabs';
import {
  answerAgentSearch,
  checkAgentSearchHealth,
  syncAgentSearch,
  type AgentSearchAnswer,
  type AgentSearchHealth,
  type AgentSearchResult,
  type AiSearchTab,
} from '../features/ai-search/services/agentSearchClient';
import { cn } from '../lib/utils';

export default function AiSearchPage() {
  const { authUser } = useAuthStore();
  const { addToast } = useAppStore();
  const [activeTab, setActiveTab] = useState<AiSearchTab>('help');
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<AgentSearchResult[]>([]);
  const [answer, setAnswer] = useState<AgentSearchAnswer | null>(null);
  const [health, setHealth] = useState<AgentSearchHealth | null>(null);
  const [loading, setLoading] = useState(false);
  const [syncing, setSyncing] = useState<string | null>(null);
  const [error, setError] = useState<{ code?: string; message: string } | null>(null);
  const [hasSearched, setHasSearched] = useState(false);
  const [notSynced, setNotSynced] = useState(false);

  const activeTabMeta = useMemo(
    () => AI_SEARCH_TABS.find((tab) => tab.id === activeTab) || AI_SEARCH_TABS[0],
    [activeTab],
  );

  useEffect(() => {
    checkAgentSearchHealth()
      .then(setHealth)
      .catch((err) => setHealth({
        ok: false,
        enabled: false,
        code: err.code || 'AGENT_SEARCH_NETWORK_ERROR',
        message: err instanceof Error ? err.message : 'AI Search health check gagal.',
      }));
  }, []);

  const runSearch = async () => {
    if (query.trim().length < 2) return;
    setLoading(true);
    setError(null);
    setHasSearched(true);
    try {
      const response = await answerAgentSearch(query.trim(), activeTab);
      setResults(response.results || []);
      setAnswer(response.answer || null);
      // Distinguish "not synced" (no raw docs at all) from "no match"
      const isUserTab = activeTab !== 'help';
      const rawCount = response.diagnostics?.rawCount ?? 0;
      setNotSynced(isUserTab && (response.results?.length ?? 0) === 0 && rawCount === 0);
    } catch (err) {
      const typed = err as Error & { code?: string };
      setResults([]);
      setAnswer(null);
      setError({
        code: typed.code,
        message: typed.message || 'AI Search gagal memproses request.',
      });
    } finally {
      setLoading(false);
    }
  };

  const runSync = async (scope: 'docs' | 'transactions' | 'gmail-logs' | 'receipts') => {
    setSyncing(scope);
    try {
      await syncAgentSearch(scope);
      addToast({ type: 'success', title: 'Sync berhasil', message: `Data ${scope.replace('-', ' ')} sudah dikirim ke Agent Search.` });
    } catch (err) {
      const typed = err as Error;
      addToast({ type: 'error', title: 'Sync gagal', message: typed.message });
    } finally {
      setSyncing(null);
    }
  };

  const syncItems: Array<{ scope: 'docs' | 'transactions' | 'gmail-logs' | 'receipts'; label: string; tab?: AiSearchTab }> = [
    { scope: 'docs', label: 'Sync docs', tab: 'help' },
    { scope: 'transactions', label: 'Sync transaksi', tab: 'transactions' },
    { scope: 'gmail-logs', label: 'Sync Gmail', tab: 'gmail' },
    { scope: 'receipts', label: 'Sync bukti', tab: 'receipts' },
  ];

  return (
    <div>
      <Header title="AI Search" />

      <div className="mx-auto max-w-7xl space-y-5 p-4 lg:p-6">
        <section className="overflow-hidden rounded-[1.5rem] border border-app-border bg-app-elevated/88 p-5 shadow-sm lg:p-6">
          <div className="flex flex-col gap-5 lg:flex-row lg:items-end lg:justify-between">
            <div className="min-w-0">
              <div className="inline-flex items-center gap-2 rounded-full border border-mint-200 bg-mint-50 px-3 py-1 text-xs font-bold text-mint-700 dark:border-mint-400/20 dark:bg-mint-500/10 dark:text-mint-200">
                <Sparkles className="h-3.5 w-3.5" />
                GenAI App Builder
              </div>
              <h1 className="mt-4 text-2xl font-black text-app-text sm:text-3xl">AI Search</h1>
              <p className="mt-2 max-w-2xl text-sm leading-relaxed text-app-muted">
                Cari transaksi, insight, panduan, dan riwayat CashFlow dengan bahasa natural.
              </p>
            </div>
            <div className="grid gap-2 sm:grid-cols-2 lg:min-w-[360px]">
              <StatusPill
                label={health?.ok ? 'Agent Search aktif' : 'Belum aktif'}
                active={!!health?.ok}
              />
              <StatusPill
                label={health?.credentialExists ? 'Credential terdeteksi' : 'Credential belum ada'}
                active={!!health?.credentialExists}
              />
            </div>
          </div>
        </section>

        <AiSearchTabs
          activeTab={activeTab}
          onChange={(tab) => {
            setActiveTab(tab);
            setError(null);
            setResults([]);
            setAnswer(null);
            setHasSearched(false);
            setNotSynced(false);
          }}
        />

        <AiSearchBox
          value={query}
          placeholder={activeTabMeta.placeholder}
          loading={loading}
          onChange={setQuery}
          onSubmit={runSearch}
        />

        <Card className="bg-app-elevated/72">
          <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
            <div className="flex min-w-0 items-start gap-3">
              <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-2xl bg-primary-500/10 text-primary-600 dark:text-primary-200">
                <ShieldCheck className="h-5 w-5" />
              </div>
              <div className="min-w-0">
                <h2 className="text-sm font-bold text-app-text">Privacy guard aktif</h2>
                <p className="mt-1 text-xs leading-relaxed text-app-muted">
                  Query user difilter dengan hash user ID. Token, raw email body, service role, dan gambar bukti tidak dikirim ke Agent Search.
                </p>
              </div>
            </div>
            <div className="flex gap-2 overflow-x-auto pb-1 lg:pb-0">
              {syncItems
                .filter((item) => activeTab === 'insight' ? item.scope === 'transactions' : !item.tab || item.tab === activeTab)
                .map((item) => (
                  <Button
                    key={item.scope}
                    size="sm"
                    variant="outline"
                    loading={syncing === item.scope}
                    disabled={!!syncing}
                    icon={syncing === item.scope ? <RefreshCw className="h-4 w-4 animate-spin" /> : <DatabaseZap className="h-4 w-4" />}
                    onClick={() => runSync(item.scope)}
                    className="shrink-0"
                  >
                    {item.label}
                  </Button>
                ))}
            </div>
          </div>
        </Card>

        {health && !health.ok && !error && (
          <AiSearchErrorState code={health.code} message={health.message} />
        )}

        {error && <AiSearchErrorState code={error.code} message={error.message} onRetry={runSearch} />}

        {loading && (
          <div className="space-y-3">
            <LoadingCard />
            <LoadingCard />
            <LoadingCard />
          </div>
        )}

        {!loading && <AiAnswerCard answer={answer} />}

        {!loading && !error && (
          <div className={cn('space-y-3', answer ? 'pt-1' : '')}>
            {results.length > 0 ? (
              results.map((result, index) => (
                <motion.div
                  key={String(result.id || index)}
                  initial={{ opacity: 0, y: 8 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ delay: index * 0.035 }}
                >
                  <AiSearchResultCard result={result} tab={activeTab} />
                </motion.div>
              ))
            ) : (
              <AiSearchEmptyState hasSearched={hasSearched} notSynced={notSynced} />
            )}
          </div>
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

function LoadingCard() {
  return (
    <Card>
      <div className="animate-pulse space-y-4">
        <div className="h-4 w-48 rounded-full bg-app-hover" />
        <div className="h-3 w-full rounded-full bg-app-hover" />
        <div className="h-3 w-2/3 rounded-full bg-app-hover" />
        <p className="text-sm font-semibold text-app-muted">CashFlow sedang mencari jawaban...</p>
      </div>
    </Card>
  );
}
