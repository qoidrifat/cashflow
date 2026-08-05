// CF-053: Monitoring & Observability types

export interface FeatureUsage {
  costIdr: number;
  costUsd: number;
  tokens: number;
  calls: number;
  /** Latensi rata-rata per panggilan (ms) — Sprint 2 Cost Monitoring. */
  avgTimeMs: number;
  successRate: number;
}

export interface AIUsageSummary {
  costIdr: number;
  costUsd: number;
  tokens: number;
  calls: number;
  avgTimeMs: number;
  features: Record<string, FeatureUsage>;
}

export interface CostTrendPoint {
  date: string;
  costIdr: number;
  tokens: number;
  calls: number;
}

export interface PeriodSummary {
  costIdr: number;
  tokens: number;
  calls: number;
  avgTimeMs: number;
}

export interface MetricsSummary {
  ok: boolean;
  today: PeriodSummary;
  week: PeriodSummary;
  month: PeriodSummary;
  features: Record<string, FeatureUsage>;
}

export interface FeatureHealth {
  feature: string;
  totalCalls: number;
  successRate: number;
  failureCount: number;
  avgTimeMs: number;
}

export interface AlertStatus {
  name: string;
  metricName: string;
  status: 'ok' | 'triggered';
  currentValue: number;
  threshold: number;
  condition: 'gt' | 'lt' | 'eq';
  windowMinutes: number;
}

export interface CacheByFeature {
  feature: string;
  hits: number;
  misses: number;
  /** Rasio hit/(hit+miss) dalam 0..1 — 1.0 bila belum ada aktivitas cache. */
  hitRate: number;
}

export interface AiUsageResponse {
  ok: boolean;
  summary: AIUsageSummary;
  trend: CostTrendPoint[];
  /** Cache-hit per fitur (Sprint 2) — dari ai_cache_hit/_miss di system_metrics. */
  cacheByFeature: CacheByFeature[];
}

export type FeatureCallStatus = 'all' | 'success' | 'failed';

export interface FeatureCall {
  id: string;
  createdAt: string;
  provider: string;
  model: string | null;
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
  costIdr: number;
  executionTimeMs: number | null;
  status: string;
  errorMessage: string | null;
  metadata: Record<string, unknown>;
}

export interface FeatureCallsResponse {
  ok: boolean;
  feature: string;
  summary: FeatureHealth;
  page: number;
  pageSize: number;
  total: number;
  items: FeatureCall[];
}

export interface AICacheStats {
  ok: boolean;
  size: number;
  maxEntries: number;
  hits: number;
  misses: number;
  sets: number;
  evictions: number;
  /** Rasio hit/(hit+miss) — 0 bila belum ada request cacheable. */
  hitRate: number;
  /** Jumlah request single-flight yang sedang berjalan (dedup konkuren). */
  inflight: number;
}

export interface AgentSearchTabCount {
  tab: string;
  count: number;
}

export interface SuggestedQueryStat {
  query: string;
  count: number;
}

/** Sprint 1.9 — AI Search engagement dari system_metrics (count/click/suggestion_used). */
export interface AgentSearchEngagement {
  ok: boolean;
  /** Jumlah pencarian (denominator CTR). */
  searches: number;
  /** Klik hasil pencarian. */
  clicks: number;
  /** Suggested query yang dipakai user. */
  suggestionsUsed: number;
  /** Click-through rate = clicks ÷ searches (0..1). */
  ctr: number;
  topSuggestedQueries: SuggestedQueryStat[];
  clicksByTab: AgentSearchTabCount[];
  suggestionsByTab: AgentSearchTabCount[];
}
