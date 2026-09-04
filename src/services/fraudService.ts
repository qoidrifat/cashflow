/**
 * Fraud Detection Service (Sprint 1 — Core Product)
 *
 * Client API untuk endpoint /api/fraud/*:
 *   GET  /api/fraud/summary      — ringkasan flag (widget dashboard)
 *   GET  /api/fraud/flags        — daftar flag terbaru
 *   POST /api/fraud/flags/:id/review — tandai flag sudah dicek
 *
 * Seluruh request memakai cookie sesi (credentials: 'include') — endpoint
 * dilindungi requireAuth di server.
 */
import type { FraudFlag, FraudSummary } from '../types';
import { apiGet, apiPost } from '../config/api';

async function getJson<T>(path: string, signal?: AbortSignal): Promise<T> {
  return apiGet<T>(path, signal ? { signal } : {});
}

/** Label Bahasa Indonesia per rule (dipakai widget dashboard). */
export const FRAUD_RULE_LABELS: Record<string, string> = {
  duplicate: 'Duplikat',
  velocity: 'Aktivitas tinggi',
  amount_outlier: 'Nominal tidak wajar',
  new_merchant: 'Merchant baru',
  category_anomaly: 'Kategori anomali',
};

export const FRAUD_SEVERITY_LABELS: Record<string, string> = {
  low: 'Rendah',
  medium: 'Sedang',
  high: 'Tinggi',
  critical: 'Kritis',
};

interface RawFraudFlag {
  id: string;
  user_id?: string;
  transaction_id?: string | null;
  flag_type: string;
  severity: string;
  description?: string | null;
  rule_data?: string | null;
  risk_score?: number | null;
  decision?: string | null;
  status: string;
  created_at?: string;
  merchant?: string | null;
  amount?: number | null;
  date?: string | null;
  transaction_type?: string | null;
}

/**
 * Map baris API (snake_case, rule_data JSON string) → FraudFlag (camelCase).
 * Server mengembalikan kolom DB mentah (flag_type/risk_score/rule_data); UI
 * memakai camelCase — tanpa mapper ini label rule/skor risiko tidak tampil.
 */
function mapFlag(raw: RawFraudFlag): FraudFlag {
  let ruleData: Record<string, unknown> | undefined;
  if (typeof raw.rule_data === 'string' && raw.rule_data) {
    try {
      const parsed = JSON.parse(raw.rule_data);
      if (parsed && typeof parsed === 'object') ruleData = parsed;
    } catch {
      /* abaikan rule_data korup */
    }
  }
  return {
    id: raw.id,
    userId: raw.user_id || '',
    transactionId: raw.transaction_id || undefined,
    flagType: raw.flag_type as FraudFlag['flagType'],
    severity: raw.severity as FraudFlag['severity'],
    description: raw.description || '',
    ruleData,
    riskScore: typeof raw.risk_score === 'number' ? raw.risk_score : undefined,
    decision: (['allow', 'review', 'block'].includes(raw.decision as string)
      ? raw.decision
      : undefined) as FraudFlag['decision'],
    status: raw.status as FraudFlag['status'],
    createdAt: raw.created_at || '',
    merchant: raw.merchant || undefined,
    amount: typeof raw.amount === 'number' ? raw.amount : undefined,
    date: raw.date || undefined,
    transactionType: raw.transaction_type || undefined,
  };
}

/** Ambil ringkasan flag untuk widget dashboard. Throw agar caller bisa tangani (DashboardPage tangkap + toast). */
export async function getFraudSummary(options: { signal?: AbortSignal } = {}): Promise<FraudSummary | null> {
  const data = await getJson<{
    ok: boolean;
    openCount: number;
    totalCount: number;
    bySeverity: FraudSummary['bySeverity'];
    recent: RawFraudFlag[];
  }>('/api/fraud/summary', options.signal);
  return {
    openCount: data.openCount,
    totalCount: data.totalCount,
    bySeverity: data.bySeverity || { low: 0, medium: 0, high: 0, critical: 0 },
    recent: (data.recent || []).map(mapFlag),
  };
}

/** Ambil daftar flag terbaru user. */
export async function getFraudFlags(limit = 50): Promise<FraudFlag[]> {
  try {
    const data = await getJson<{ ok: boolean; flags: RawFraudFlag[] }>(`/api/fraud/flags?limit=${limit}`);
    return (data.flags || []).map(mapFlag);
  } catch {
    return [];
  }
}

/**
 * Data lengkap halaman review — THROWS pada kegagalan (berbeda dari varian
 * fail-silent di atas) agar halaman /fraud bisa menampilkan ErrorState yang
 * reachable, bukan empty state yang menyesatkan saat API down.
 */
export async function getFraudPageData(limit = 100): Promise<{ flags: FraudFlag[]; summary: FraudSummary }> {
  const [flagsData, summaryData] = await Promise.all([
    getJson<{ ok: boolean; flags: RawFraudFlag[] }>(`/api/fraud/flags?limit=${limit}`),
    getJson<{
      ok: boolean;
      openCount: number;
      totalCount: number;
      bySeverity: FraudSummary['bySeverity'];
      recent: RawFraudFlag[];
    }>('/api/fraud/summary'),
  ]);
  return {
    flags: (flagsData.flags || []).map(mapFlag),
    summary: {
      openCount: summaryData.openCount,
      totalCount: summaryData.totalCount,
      bySeverity: summaryData.bySeverity || { low: 0, medium: 0, high: 0, critical: 0 },
      recent: (summaryData.recent || []).map(mapFlag),
    },
  };
}

/** Tandai flag sudah dicek user (menghapusnya dari daftar "open"). */
export async function reviewFraudFlag(id: string): Promise<boolean> {
  try {
    await apiPost(`/api/fraud/flags/${encodeURIComponent(id)}/review`);
    return true;
  } catch {
    return false;
  }
}
