import { apiGet, apiDelete } from '../config/api';

/**
 * Privacy Service (P0.2/P0.3) — data portability & account deletion.
 * Backend: server/routes/privacyRoutes.js (GET /api/privacy/export,
 * DELETE /api/privacy/account).
 */

export interface PrivacyExport {
  exportVersion: string;
  generatedAt: string;
  user: Record<string, unknown> | null;
  transactions: unknown[];
  categories: unknown[];
  budgets: unknown[];
  ai: { feedback: unknown[]; memory: unknown[]; timeline: unknown[] };
  [key: string]: unknown;
}

export interface DeleteAccountResponse {
  ok: boolean;
  action: 'account_delete';
  deletedSessions: number;
  deletedTransactions: number;
  deletedTimeline: number;
  deletedFeedback: number;
  deletedMemory: number;
}

/**
 * Export SEMUA data user sebagai JSON (portabilitas). Server menjamin
 * user-scoped + tanpa secret. Di sini: unduh sebagai file JSON.
 */
export async function exportUserData(): Promise<PrivacyExport> {
  const data = await apiGet<PrivacyExport>('/api/privacy/export');
  downloadJson(data);
  return data;
}

/** Unduh objek sebagai file JSON (pola downloadTransactionsCSV). */
export function downloadJson(data: unknown, filename = `cashflow-export-${new Date().toISOString().slice(0, 10)}.json`): void {
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = filename;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  URL.revokeObjectURL(url);
}

/**
 * Hapus akun + SEMUA data (irreversible). Membutuhkan konfirmasi eksplisit
 * berupa teks "DELETE" (dikirim ke server — email saja tidak cukup).
 * Server idempoten: delete kedua → 404 ACCOUNT_NOT_FOUND.
 */
export async function deleteAccount(confirmation: string): Promise<DeleteAccountResponse> {
  return apiDelete<DeleteAccountResponse>('/api/privacy/account', { body: { confirmation } });
}
