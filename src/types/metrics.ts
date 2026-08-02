// CF-053: Monitoring & Observability types

export interface FeatureUsage {
  costIdr: number;
  costUsd: number;
  tokens: number;
  calls: number;
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

export interface AiUsageResponse {
  ok: boolean;
  summary: AIUsageSummary;
  trend: CostTrendPoint[];
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
