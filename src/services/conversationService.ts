/**
 * Natural Conversation Service (Sprint 1.5 — P8).
 *
 * Client untuk POST /api/ai-product/conversation — pertanyaan finansial natural
 * dengan jawaban kaya (ringkasan → grafik → kategori → transaksi → aksi).
 * Memakai cookie session (credentials: 'include'); server memakai requireAuth.
 */
export interface ConversationDailyPoint {
  date: string;
  income: number;
  expense: number;
}

export interface ConversationCategory {
  name: string;
  amount: number;
  count: number;
  pct: number;
}

export interface ConversationMerchant {
  merchant: string;
  amount: number;
  count: number;
}

export interface ConversationTopTransaction {
  id: string;
  merchant: string;
  note: string;
  categoryName: string;
  amount: number;
  date: string;
}

export interface ConversationInsight {
  title: string;
  detail: string;
  /** Server selalu menormalkan ke enum ini (normalizeConversationNarrative). */
  severity: 'high' | 'medium' | 'low';
}

export interface ConversationRecommendation {
  title: string;
  action: string;
  href?: string;
  impact?: string;
}

export interface ConversationStats {
  income: number;
  expense: number;
  net: number;
  prevIncome: number;
  prevExpense: number;
  prevNet: number;
  expenseDeltaPct: number | null;
  incomeDeltaPct: number | null;
  transactionCount: number;
  expenseCount: number;
  incomeCount: number;
  hasData: boolean;
}

export interface ConversationTrust {
  source: string;
  model?: string;
  processingTimeMs: number;
  dataCoverage?: string;
  timestamp?: string;
  fallbackReason?: string;
}

export interface ConversationAnswer {
  success: boolean;
  query: string;
  periodDays: number;
  period: { startDate: string; endDate: string; label: string };
  stats: ConversationStats;
  narrative: {
    summary: string;
    insights: ConversationInsight[];
    recommendations: ConversationRecommendation[];
  };
  chart: { daily: ConversationDailyPoint[] };
  categories: ConversationCategory[];
  topMerchants: ConversationMerchant[];
  topTransactions: ConversationTopTransaction[];
  trust: ConversationTrust;
  requestId?: string;
}

export const CONVERSATION_PERIOD_OPTIONS = [7, 30, 90] as const;
export type ConversationPeriod = (typeof CONVERSATION_PERIOD_OPTIONS)[number];

export const CONVERSATION_SUGGESTED_QUERIES = [
  'Kenapa uangku habis minggu ini?',
  'Kategori apa paling boros bulan ini?',
  'Transaksi terbesar minggu ini apa saja?',
  'Apa rekomendasi untuk hemat 30 hari ke depan?',
] as const;

export async function askFinancialQuestion(input: {
  query: string;
  periodDays?: number;
}): Promise<ConversationAnswer> {
  const res = await fetch('/api/ai-product/conversation', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    credentials: 'include',
    body: JSON.stringify({
      query: input.query,
      periodDays: input.periodDays ?? 30,
    }),
  });

  if (!res.ok) {
    let message = `HTTP ${res.status}`;
    try {
      const body = await res.json();
      message = body?.message || body?.error || message;
    } catch { /* ignore */ }
    throw new Error(message);
  }

  return res.json() as Promise<ConversationAnswer>;
}
