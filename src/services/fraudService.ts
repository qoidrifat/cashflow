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

async function api<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(path, {
    ...init,
    credentials: 'include',
    headers: { 'Content-Type': 'application/json', ...(init?.headers || {}) },
  });
  if (!response.ok) {
    const body = await response.json().catch(() => ({}));
    throw new Error(body.error || body.message || `HTTP ${response.status}`);
  }
  return response.json() as Promise<T>;
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

/** Ambil ringkasan flag untuk widget dashboard. Gagal → null (widget di-sembunyikan). */
export async function getFraudSummary(): Promise<FraudSummary | null> {
  try {
    const data = await api<{ ok: boolean; openCount: number; totalCount: number; bySeverity: FraudSummary['bySeverity']; recent: FraudFlag[] }>('/api/fraud/summary');
    return {
      openCount: data.openCount,
      totalCount: data.totalCount,
      bySeverity: data.bySeverity || { low: 0, medium: 0, high: 0, critical: 0 },
      recent: data.recent || [],
    };
  } catch {
    return null;
  }
}

/** Ambil daftar flag terbaru user. */
export async function getFraudFlags(limit = 50): Promise<FraudFlag[]> {
  try {
    const data = await api<{ ok: boolean; flags: FraudFlag[] }>(`/api/fraud/flags?limit=${limit}`);
    return data.flags || [];
  } catch {
    return [];
  }
}

/** Tandai flag sudah dicek user (menghapusnya dari daftar "open"). */
export async function reviewFraudFlag(id: string): Promise<boolean> {
  try {
    const data = await api<{ ok: boolean }>(`/api/fraud/flags/${encodeURIComponent(id)}/review`, { method: 'POST' });
    return Boolean(data.ok);
  } catch {
    return false;
  }
}
