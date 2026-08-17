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

/** Sprint 2 — cost trend per fitur (satu baris per hari+fitur) untuk multi-seri. */
export interface CostTrendByFeaturePoint {
  date: string;
  feature: string;
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
  /** Cost trend per fitur (Sprint 2) — untuk line chart multi-seri. */
  trendByFeature: CostTrendByFeaturePoint[];
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

// ===================== REKOMENDASI AI (P10.2) =====================

/** Satu baris seri per-hari funnel rekomendasi. */
export interface RecommendationDayStat {
  date: string;
  shown: number;
  opened: number;
  ctr: number;
}

/** Per-feature breakdown funnel rekomendasi. */
export interface RecommendationFeatureStat {
  feature: string;
  count: number;
}

/** CTR per event_type (insight/recommendation/...) — P10.2d. */
export interface RecommendationEventTypeStat {
  eventType: string;
  shown: number;
  opened: number;
  ctr: number;
}

/** Respons GET /api/admin/metrics/recommendation-engagement. */
export interface RecommendationEngagement {
  ok: boolean;
  shown: number;
  opened: number;
  ctr: number;
  byFeature: RecommendationFeatureStat[];
  byDay: RecommendationDayStat[];
  byEventType: RecommendationEventTypeStat[];
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

// ===================== FEEDBACK =====================

/** Sprint 1.5 — statistik per feature dari dataset ai_feedback (GET /api/admin/metrics/feedback-summary). */
export interface FeedbackFeatureStats {
  feature: string;
  total: number;
  counts: Record<string, number>;
  positiveRate: number;
  negativeRate: number;
  skipRate: number;
  alreadyDoneRate: number;
  /** Skor prioritas perbaikan prompt 0-100 (negativeRate x 100). */
  priorityScore: number;
  confidence: 'high' | 'medium' | 'low';
}

// ===================== RETENTION (P10.2) =====================

/** Satu cohort-day: user yang registrasi pada hari UTC yang sama. */
export interface RetentionCohort {
  /** Hari registrasi cohort (UTC YYYY-MM-DD). */
  day: string;
  users: number;
  /** Proporsi aktif pada hari+1 / +7 / +14 / +28 — null bila jendela belum tercapai. */
  d1: number | null;
  d7: number | null;
  d14: number | null;
  d28: number | null;
}

/** Ringkasan retention per offset hari (mean cohort valid). */
export interface RetentionDayStat {
  day: number;
  /** Jumlah cohort yang jendelanya sudah tercapai untuk offset ini. */
  users: number;
  /** Rata-rata rate cohort valid — null bila belum ada cohort valid. */
  rate: number | null;
}

/** Respons GET /api/admin/metrics/retention. */
export interface RetentionMetrics {
  ok: boolean;
  /** Ambang minimum cohort (10) — untuk label UI. */
  minCohortUsers: number;
  totalCohortUsers: number;
  totalCohorts: number;
  /** true bila total cohort < ambang — panel menampilkan empty state (hindari angka kosong). */
  cohortGuardActive: boolean;
  cohorts: RetentionCohort[];
  days: RetentionDayStat[];
}

// ===================== FEEDBACK RATE (P10.2i) =====================

/** Per-feature breakdown Feedback Rate: feedback ÷ tampilan kartu AI. */
export interface FeedbackRateFeatureStat {
  feature: string;
  /** Jumlah ai_feedback untuk feature ini (numerator). */
  feedback: number;
  /** Jumlah ai_result_shown — kartu AI feedback-capable ditampilkan (denominator). */
  views: number;
  /** feedback ÷ views (0..1, 3 desimal) — 0 bila views = 0. */
  rate: number;
}

/** Respons GET /api/admin/metrics/feedback-rate (P10.2i). */
export interface FeedbackRateSummary {
  ok: boolean;
  /** Total ai_feedback pada rentang (numerator). */
  feedback: number;
  /** Total ai_result_shown pada rentang (denominator "AI result views"). */
  views: number;
  /** feedback ÷ views (0..1, 3 desimal) — 0 bila views = 0. */
  rate: number;
  byFeature: FeedbackRateFeatureStat[];
}

// ===================== VIEW PER-USER (P10.2 — admin) =====================

/** Satu user dengan aktivitas telemetry AI — opsi dropdown "view per-user". */
export interface TelemetryUser {
  userId: string;
  name: string | null;
  email: string | null;
  /** Label tampilan: email → name → userId (fallback). */
  label: string;
  /** Jumlah event recommendation_shown/_opened (funnel Rekomendasi AI). */
  recommendations: number;
  /** Jumlah ai_result_shown (tampilan kartu AI feedback-capable). */
  views: number;
  /** Jumlah ai_feedback. */
  feedback: number;
  /** recommendations + views + feedback — pemilah dropdown (desc). */
  activity: number;
}

/** Respons GET /api/admin/metrics/telemetry-users (P10.2). */
export interface TelemetryUsersResponse {
  ok: boolean;
  users: TelemetryUser[];
}

/** Sprint 1.5 — item action plan perbaikan prompt per feature. */
export interface FeedbackActionPlanItem {
  feature: string;
  label: string;
  prompt: string;
  file: string;
  priorityScore: number;
  total: number;
  dominantNegative: string | null;
  direction: string;
}

/** Sprint 1.5 — respons GET /api/admin/metrics/feedback-summary. */
export interface FeedbackSummaryResponse {
  ok: boolean;
  totalFeedback: number;
  overallNegativeRate: number;
  featuresWithFeedback: number;
  features: FeedbackFeatureStats[];
  actionPlan: FeedbackActionPlanItem[];
  topPriority: { feature: string; priorityScore: number; total: number } | null;
}
