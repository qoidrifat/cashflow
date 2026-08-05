import { apiGet } from '../config/api';
import type {
  AiUsageResponse, MetricsSummary, FeatureHealth, AlertStatus,
  FeatureCallsResponse, FeatureCallStatus, AICacheStats, AgentSearchEngagement,
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
