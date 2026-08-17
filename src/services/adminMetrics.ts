import { apiGet } from '../config/api';
import type {
  AiUsageResponse, MetricsSummary, FeatureHealth, AlertStatus,
  FeatureCallsResponse, FeatureCallStatus, AICacheStats, AgentSearchEngagement,
  FeedbackSummaryResponse, RetentionMetrics, RecommendationEngagement, FeedbackRateSummary,
  TelemetryUsersResponse,
} from '../types/metrics';

function range(from?: string, to?: string): string {
  const params = new URLSearchParams();
  if (from) params.set('from', from);
  if (to) params.set('to', to);
  const q = params.toString();
  return q ? `?${q}` : '';
}

export function fetchMetricsSummary(): Promise<MetricsSummary> {
  return apiGet<MetricsSummary>('/api/admin/metrics/summary');
}

export function fetchAiUsage(from?: string, to?: string, feature?: string): Promise<AiUsageResponse> {
  const params = new URLSearchParams();
  if (from) params.set('from', from);
  if (to) params.set('to', to);
  if (feature) params.set('feature', feature);
  const q = params.toString();
  return apiGet<AiUsageResponse>(`/api/admin/metrics/ai-usage${q ? `?${q}` : ''}`);
}

export function fetchFeatureHealth(from?: string, to?: string): Promise<{ ok: boolean; health: FeatureHealth[] }> {
  return apiGet<{ ok: boolean; health: FeatureHealth[] }>(`/api/admin/metrics/feature-health${range(from, to)}`);
}

export function fetchAlerts(): Promise<{ ok: boolean; alerts: AlertStatus[] }> {
  return apiGet<{ ok: boolean; alerts: AlertStatus[] }>('/api/admin/metrics/alerts');
}

export function fetchAICacheStats(): Promise<AICacheStats> {
  return apiGet<AICacheStats>('/api/admin/metrics/cache');
}

/** Sprint 1.9 — AI Search engagement: suggested queries + CTR (admin only). */
export function fetchAgentSearchEngagement(from?: string, to?: string): Promise<AgentSearchEngagement> {
  return apiGet<AgentSearchEngagement>(`/api/admin/metrics/agent-search-engagement${range(from, to)}`);
}

/** P10.2 — funnel rekomendasi AI: shown/opened/CTR + seri per hari (admin only).
 * Opsional userId → scoped ke satu user (view per-user panel admin). */
export function fetchRecommendationEngagement(from?: string, to?: string, userId?: string): Promise<RecommendationEngagement> {
  const params = new URLSearchParams();
  if (from) params.set('from', from);
  if (to) params.set('to', to);
  if (userId) params.set('userId', userId);
  const q = params.toString();
  return apiGet<RecommendationEngagement>(`/api/admin/metrics/recommendation-engagement${q ? `?${q}` : ''}`);
}

/** Sprint 1.5 — feedback → prioritas perbaikan prompt per feature (admin only). */
export function fetchFeedbackSummary(): Promise<FeedbackSummaryResponse> {
  return apiGet<FeedbackSummaryResponse>('/api/admin/metrics/feedback-summary');
}

/** P10.2i — Feedback Rate: ai_feedback ÷ ai_result_shown (admin only).
 * Opsional userId → scoped ke satu user (view per-user panel admin). */
export function fetchFeedbackRate(from?: string, to?: string, userId?: string): Promise<FeedbackRateSummary> {
  const params = new URLSearchParams();
  if (from) params.set('from', from);
  if (to) params.set('to', to);
  if (userId) params.set('userId', userId);
  const q = params.toString();
  return apiGet<FeedbackRateSummary>(`/api/admin/metrics/feedback-rate${q ? `?${q}` : ''}`);
}

/** P10.2 — daftar user dengan aktivitas telemetry AI (dropdown view per-user, admin only). */
export function fetchTelemetryUsers(from?: string, to?: string): Promise<TelemetryUsersResponse> {
  return apiGet<TelemetryUsersResponse>(`/api/admin/metrics/telemetry-users${range(from, to)}`);
}

export function fetchFeatureCalls(
  from?: string,
  to?: string,
  feature?: string,
  status?: FeatureCallStatus | 'all',
  page?: number,
  pageSize?: number,
): Promise<FeatureCallsResponse> {
  const params = new URLSearchParams();
  if (from) params.set('from', from);
  if (to) params.set('to', to);
  if (status && status !== 'all') params.set('status', status);
  if (page) params.set('page', String(page));
  if (pageSize) params.set('page_size', String(pageSize));
  const q = params.toString();
  return apiGet<FeatureCallsResponse>(`/api/admin/metrics/feature/${feature}/calls${q ? `?${q}` : ''}`);
}

/** P10.2 — retention D1/D7/D14/D28 dari cohort user + user_active (admin only). */
export function fetchRetentionMetrics(from?: string, to?: string): Promise<RetentionMetrics> {
  return apiGet<RetentionMetrics>(`/api/admin/metrics/retention${range(from, to)}`);
}
