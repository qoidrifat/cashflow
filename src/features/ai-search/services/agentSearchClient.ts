import { apiGet, apiPost } from '../../../config/api';

export type AiSearchTab = 'help' | 'transactions' | 'insight' | 'gmail' | 'receipts' | 'docs' | 'gmail-logs';

export interface AgentSearchResult {
  id?: string;
  title?: string;
  snippet?: string;
  path?: string;
  type?: string;
  transaction_id?: string;
  merchant?: string;
  amount?: number;
  category?: string;
  payment_method?: string;
  note?: string;
  transaction_date?: string;
  source?: string;
  subject?: string;
  sender_domain?: string;
  final_status?: string;
  error_code?: string | null;
  confidence_score?: number | null;
  /** Sprint 1.4 — mengapa hasil ini relevan (deterministik, dari server). */
  explanation?: string[];
  relevance?: number;
  [key: string]: unknown;
}

export interface AgentSearchAnswer {
  text: string;
  citations?: unknown[];
  sourceCount?: number;
  warning?: string;
}

export interface AgentSearchFilters {
  dateFrom?: string;
  dateTo?: string;
  type?: 'expense' | 'income' | 'refund' | 'transfer';
  category?: string;
}

export interface AgentSearchResponse {
  ok: boolean;
  results: AgentSearchResult[];
  answer: AgentSearchAnswer | null;
  /** Sprint 1.4 — suggested queries (dari Discovery relatedQuestions + fallback). */
  suggestedQueries?: string[];
  diagnostics?: {
    tab: AiSearchTab;
    resultCount: number;
    rawCount?: number;
    fallbackUsed?: boolean;
    userIdHashRetrievable?: boolean;
    filtersApplied?: string | null;
  };
  code?: string;
  message?: string;
}

export interface AgentSearchHealth {
  ok: boolean;
  enabled: boolean;
  projectId?: string;
  location?: string;
  engineId?: string;
  credentialExists?: boolean;
  code?: string;
  message: string;
}

export async function fetchAgentSearchHealth(): Promise<AgentSearchHealth> {
  try {
    return await apiGet<AgentSearchHealth>('/api/agent-search/health');
  } catch {
    return { ok: false, enabled: false, message: 'AI Search server tidak merespons.' };
  }
}

export function checkAgentSearchHealth(): Promise<AgentSearchHealth> {
  return fetchAgentSearchHealth();
}

export async function syncAgentSearch(tab: AiSearchTab): Promise<{ ok: boolean }> {
  try {
    return await apiPost<{ ok: boolean }>(`/api/agent-search/sync-${tab}`, {});
  } catch {
    return { ok: false };
  }
}


export async function queryAgentSearch(query: string, tab: AiSearchTab, filters?: AgentSearchFilters): Promise<AgentSearchResponse> {
  return apiPost<AgentSearchResponse>('/api/agent-search/query', { query, tab, filters });
}

export async function answerAgentSearch(query: string, tab: AiSearchTab, filters?: AgentSearchFilters): Promise<AgentSearchResponse> {
  return apiPost<AgentSearchResponse>('/api/agent-search/answer', { query, tab, filters });
}

/** Sprint 1.4 — search analytics (fire-and-forget, tidak pernah melempar). */
export async function trackAgentSearchEvent(
  action: 'click' | 'suggestion_used',
  query: string,
  tab: AiSearchTab,
  resultId?: string,
): Promise<void> {
  try {
    await apiPost<{ ok: boolean }>('/api/agent-search/track', {
      action,
      query,
      tab,
      resultId,
    });
  } catch {
    // analytics non-blocking — abaikan kegagalan
  }
}
