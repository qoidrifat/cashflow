import { useCallback, useEffect, useMemo, useState } from 'react';
import { motion } from 'framer-motion';
import { Clock3, DatabaseZap, RefreshCw, ShieldCheck, Sparkles, X } from 'lucide-react';
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
  trackAgentSearchEvent,
  type AgentSearchAnswer,
  type AgentSearchFilters,
  type AgentSearchHealth,
  type AgentSearchResult,
  type AiSearchTab,
} from '../features/ai-search/services/agentSearchClient';
import {
  addRecentSearch,
  clearRecentSearches,
  readRecentSearches,
  removeRecentSearch,
  type RecentSearchEntry,
} from '../lib/searchHistory';
import { CATEGORY_FILTER_MAX_LENGTH, sanitizeCategoryInput } from '../lib/categoryFilter';
import { listenToCategories } from '../services/categoryService';
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
  const [recentSearches, setRecentSearches] = useState<RecentSearchEntry[]>([]);
  const [suggestedQueries, setSuggestedQueries] = useState<string[]>([]);
  const [filters, setFilters] = useState<AgentSearchFilters>({});
  const [showFilters, setShowFilters] = useState(false);
  const [userCategories, setUserCategories] = useState<string[]>([]);

  const activeTabMeta = useMemo(
    () => AI_SEARCH_TABS.find((tab) => tab.id === activeTab) || AI_SEARCH_TABS[0],
    [activeTab],
  );

  // Recent searches per-user (Sprint 1.4) — reload saat user/tab berubah.
  useEffect(() => {
    setRecentSearches(readRecentSearches(authUser?.uid));
  }, [authUser?.uid]);

  // Kategori user untuk suggestion input filter kategori (Sprint 1.9).
  // listenToCategories: fetch + subscribe SSE category:changed; error → fallback
  // daftar kosong (filter input tetap berfungsi sebagai free-text).
  useEffect(() => {
    if (!authUser?.uid) return;
    return listenToCategories(
      authUser.uid,
      (categories) => {
        setUserCategories(
          [...new Set(categories.map((c) => c.name))].sort((a, b) => a.localeCompare(b)),
        );
      },
      () => setUserCategories([]),
    );
  }, [authUser?.uid]);

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

  const runSearch = useCallback(
    async (queryOverride?: string, filtersOverride?: AgentSearchFilters, tabOverride?: AiSearchTab) => {
      const safeTab = tabOverride ?? activeTab;
      const safeQuery = (queryOverride ?? query).trim();
      const safeFilters = filtersOverride ?? filters;
      if (safeQuery.length < 2) return;
      setLoading(true);
      setError(null);
      setHasSearched(true);
      try {
        const response = await answerAgentSearch(safeQuery, safeTab, safeFilters);
        setResults(response.results || []);
        setAnswer(response.answer || null);
        setSuggestedQueries(response.suggestedQueries || []);
        // Recent searches: simpan (dedupe otomatis), reload state.
        setRecentSearches(addRecentSearch(authUser?.uid, safeQuery, safeTab) || readRecentSearches(authUser?.uid));
        // Distinguish "not synced" (no raw docs at all) from "no match"
        const isUserTab = safeTab !== 'help';
        const rawCount = response.diagnostics?.rawCount ?? 0;
        setNotSynced(isUserTab && (response.results?.length ?? 0) === 0 && rawCount === 0);
      } catch (err) {
        const typed = err as Error & { code?: string };
        setResults([]);
        setAnswer(null);
        setSuggestedQueries([]);
        setError({
          code: typed.code,
          message: typed.message || 'AI Search gagal memproses request.',
        });
      } finally {
        setLoading(false);
      }
    },
    [activeTab, authUser?.uid, filters, query],
  );

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
            setSuggestedQueries([]);
            setHasSearched(false);
            setNotSynced(false);
          }}
        />

        <AiSearchBox
          value={query}
          placeholder={activeTabMeta.placeholder}
          loading={loading}
          onChange={setQuery}
          onSubmit={() => runSearch()}
        />

        <SemanticFilters
          visible={showFilters}
          onToggle={() => setShowFilters((v) => !v)}
          filters={filters}
          onChange={setFilters}
          onApply={() => runSearch()}
          disabled={loading}
          categories={userCategories}
        />

        {!hasSearched && recentSearches.length > 0 && !loading && (
          <RecentSearches
            items={recentSearches}
            onPick={(entry) => {
              setQuery(entry.query);
              setActiveTab(entry.tab as AiSearchTab);
              // tabOverride memastikan query dijalankan di tab entri (bukan
              // closure activeTab lama — fix race reviewer Sprint 1.4).
              runSearch(entry.query, undefined, entry.tab as AiSearchTab);
            }}
            onRemove={(index) => {
              const updated = removeRecentSearch(authUser?.uid, index);
              if (updated) setRecentSearches(updated);
            }}
            onClear={() => {
              clearRecentSearches(authUser?.uid);
              setRecentSearches([]);
            }}
          />
        )}

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

        {!loading && (
          <AiAnswerCard
            answer={answer}
            suggestedQueries={hasSearched ? suggestedQueries : []}
            onSuggestionPick={(suggestion) => {
              setQuery(suggestion);
              trackAgentSearchEvent('suggestion_used', suggestion, activeTab);
              runSearch(suggestion);
            }}
          />
        )}

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
                  <AiSearchResultCard
                    result={result}
                    tab={activeTab}
                    onOpen={() => {
                      trackAgentSearchEvent('click', query, activeTab, result.id);
                    }}
                  />
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

function SemanticFilters({
  visible,
  onToggle,
  filters,
  onChange,
  onApply,
  disabled,
  categories,
}: {

  visible: boolean;
  onToggle: () => void;
  filters: AgentSearchFilters;
  onChange: (filters: AgentSearchFilters) => void;
  onApply: () => void;
  disabled: boolean;
  categories: string[];
}) {
  const [datePreset, setDatePreset] = useState<'all' | 'this-month' | 'last-3-months'>('all');

  // Sinkronkan preset lokal dengan filter eksternal: jika dateFrom dihapus dari
  // luar (mis. chip kategori di-clear → onChange menyebar), kembalikan ke 'all'.
  useEffect(() => {
    if (!filters.dateFrom && datePreset !== 'all') setDatePreset('all');
  }, [filters.dateFrom, datePreset]);

  const applyPreset = (preset: 'all' | 'this-month' | 'last-3-months') => {
    setDatePreset(preset);
    const now = new Date();
    const y = now.getFullYear();
    const m = now.getMonth() + 1; // 1..12
    if (preset === 'all') {
      onChange({ ...filters, dateFrom: undefined, dateTo: undefined });
      return;
    }
    if (preset === 'this-month') {
      const dateFrom = `${y}-${String(m).padStart(2, '0')}-01`;
      onChange({ ...filters, dateFrom, dateTo: undefined });
      return;
    }
    // last-3-months: 3 bulan terakhir termasuk bulan berjalan
    const cursor = new Date(y, m - 4, 1); // month 3 ke belakang (0-indexed)
    const dateFrom = `${cursor.getFullYear()}-${String(cursor.getMonth() + 1).padStart(2, '0')}-01`;
    onChange({ ...filters, dateFrom, dateTo: undefined });
  };

  return (
    <div className="flex flex-wrap items-center gap-2">
      <button
        type="button"
        onClick={onToggle}
        className={cn(
          'inline-flex h-9 items-center gap-1.5 rounded-full border px-3 text-xs font-bold transition-colors',
          visible || Object.values(filters).some(Boolean)
            ? 'border-primary-300 bg-primary-50 text-primary-700 dark:border-primary-400/30 dark:bg-primary-500/10 dark:text-primary-200'
            : 'border-app-border text-app-muted hover:bg-app-hover',
        )}
      >
        <Sparkles className="h-3.5 w-3.5" />
        Filter
      </button>

      {visible && (
        <>
          <select
            value={filters.type || ''}
            onChange={(e) => onChange({ ...filters, type: (e.target.value || undefined) as AgentSearchFilters['type'] })}
            className="h-9 rounded-full border border-app-border bg-app-elevated px-3 text-xs font-semibold text-app-text outline-none focus:border-primary-400"
          >
            <option value="">Semua tipe</option>
            <option value="expense">Pengeluaran</option>
            <option value="income">Pemasukan</option>
            <option value="refund">Refund</option>
            <option value="transfer">Transfer</option>
          </select>

          <select
            value={datePreset}
            onChange={(e) => applyPreset(e.target.value as 'all' | 'this-month' | 'last-3-months')}
            className="h-9 rounded-full border border-app-border bg-app-elevated px-3 text-xs font-semibold text-app-text outline-none focus:border-primary-400"
          >
            <option value="all">Semua waktu</option>
            <option value="this-month">Bulan ini</option>
            <option value="last-3-months">3 bulan terakhir</option>
          </select>

          <input
            type="text"
            value={filters.category || ''}
            onChange={(e) => {
              const cleaned = sanitizeCategoryInput(e.target.value);
              onChange({ ...filters, category: cleaned || undefined });
            }}
            placeholder="Kategori (mis. Makanan)"
            maxLength={CATEGORY_FILTER_MAX_LENGTH}
            aria-label="Filter kategori"
            list="ai-search-categories"
            className="h-9 w-48 rounded-full border border-app-border bg-app-elevated px-3 text-xs font-semibold text-app-text outline-none placeholder:text-app-subtle focus:border-primary-400"
          />
          <datalist id="ai-search-categories">
            {categories.map((name) => (
              <option key={name} value={name} />
            ))}
          </datalist>

          <Button size="sm" variant="outline" onClick={onApply} disabled={disabled}>
            Terapkan
          </Button>
        </>
      )}
    </div>
  );
}

function RecentSearches({
  items,
  onPick,
  onRemove,
  onClear,
}: {
  items: RecentSearchEntry[];
  onPick: (entry: RecentSearchEntry) => void;
  onRemove: (index: number) => void;
  onClear: () => void;
}) {
  return (
    <div className="flex flex-wrap items-center gap-2">
      <span className="inline-flex items-center gap-1.5 text-xs font-bold text-app-subtle">
        <Clock3 className="h-3.5 w-3.5" />
        Pencarian terakhir
      </span>
      {items.map((entry, index) => (
        <span
          key={`${entry.query}-${index}`}
          className="group inline-flex h-8 max-w-[260px] items-center gap-1 truncate rounded-full border border-app-border bg-app-elevated text-xs font-semibold text-app-text transition-colors hover:border-primary-300 hover:bg-primary-50 hover:text-primary-700 dark:hover:bg-primary-500/10 dark:hover:text-primary-200"
        >
          <button
            type="button"
            onClick={() => onPick(entry)}
            className="min-w-0 flex-1 truncate pl-3 pr-0.5"
            title={`Cari "${entry.query}"`}
          >
            <span className="truncate">{entry.query}</span>
          </button>
          <button
            type="button"
            onClick={() => onRemove(index)}
            aria-label={`Hapus "${entry.query}" dari pencarian terakhir`}
            className="shrink-0 rounded-full p-1 text-app-subtle opacity-0 transition-opacity hover:text-red-500 group-hover:opacity-100 focus-visible:opacity-100"
          >
            <X className="h-3.5 w-3.5" />
          </button>
        </span>
      ))}
      <button
        type="button"
        onClick={onClear}
        className="text-[11px] font-semibold text-app-subtle underline-offset-2 hover:text-red-500 hover:underline"
      >
        Bersihkan
      </button>
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
