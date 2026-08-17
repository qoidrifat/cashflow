/**
 * CashFlow AI Knowledge Assistant — API client (P0.14)
 *
 * Konsumsi endpoint server (server/routes/knowledgeRoutes.js):
 *   GET  /api/ai/cashflow-knowledge/config
 *   POST /api/ai/cashflow-knowledge
 *
 * Gating runtime = config server (`config.enabled`) — sumber kebenaran flag
 * GOOGLE_AGENT_PLATFORM_ENABLED. Tidak ada kredensial Google di client.
 * askCashflowKnowledge TIDAK pernah melempar untuk non-2xx: 503/400 dipetakan
 * ke KnowledgeResponse { ok:false, code, message } agar UI bisa menampilkan
 * state yang ramah (tidak aktif / tidak tersedia) tanpa try/catch di komponen.
 */
import { apiGet, getApiBaseUrl, handleUnauthorizedResponse } from '../../../config/api';

export interface KnowledgeConfig {
  enabled: boolean;
  service?: string;
  skuLabel?: string;
  projectConfigured?: boolean;
  dataStoreConfigured?: boolean;
}

export interface KnowledgeSource {
  title: string;
  section?: string;
}

export interface KnowledgeUsage {
  service?: string;
  skuLabel?: string;
  projectId?: string;
  location?: string;
  dataStoreConfigured?: boolean;
  requestCount?: number;
  timestamp?: string;
  responseStatus?: string;
  errorCode?: string | null;
}

export interface KnowledgeResponse {
  ok: boolean;
  answer?: string;
  noInfo?: boolean;
  message?: string;
  sources?: KnowledgeSource[];
  code?: string;
  statusCode?: number;
  usage?: KnowledgeUsage | null;
}

export const DEFAULT_SUGGESTED_QUESTIONS = [
  'Bagaimana cara menambahkan wallet?',
  'Apa saja fitur AI di CashFlow?',
  'Bagaimana cara mengaktifkan sync Gmail?',
  'Bagaimana cara mengekspor data akun?',
];

export async function fetchKnowledgeConfig(): Promise<KnowledgeConfig> {
  try {
    const body = await apiGet<{ ok: boolean; config: KnowledgeConfig }>('/api/ai/cashflow-knowledge/config');
    return body.config || { enabled: false };
  } catch {
    // Server tidak merespons → anggap tidak aktif (fail-closed, tidak ada UI mati).
    return { enabled: false };
  }
}

export async function askCashflowKnowledge(query: string): Promise<KnowledgeResponse> {
  const res = await fetch(`${getApiBaseUrl()}/api/ai/cashflow-knowledge`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Accept': 'application/json',
    },
    credentials: 'include',
    body: JSON.stringify({ query }),
  });

  if (!res.ok) {
    handleUnauthorizedResponse('/api/ai/cashflow-knowledge', res.status);
    try {
      const body = await res.json();
      return {
        ok: false,
        code: body?.code || 'GOOGLE_AGENT_PLATFORM_INTERNAL_ERROR',
        message: body?.message || 'AI knowledge service temporarily unavailable',
        statusCode: res.status,
      };
    } catch {
      return {
        ok: false,
        code: 'GOOGLE_AGENT_PLATFORM_INTERNAL_ERROR',
        message: 'AI knowledge service temporarily unavailable',
        statusCode: res.status,
      };
    }
  }

  return res.json();
}
