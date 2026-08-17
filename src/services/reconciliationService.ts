/**
 * Reconciliation Service (P2.6) — Assisted Ledger Reconciliation.
 *
 * API (server/routes/reconciliationRoutes.js):
 *   GET  /api/reconciliation/state          — matriks + saran klasifikasi
 *   POST /api/reconciliation/classify       — terima 1 klasifikasi
 *   POST /api/reconciliation/classify-bulk  — terima batch klasifikasi
 *   POST /api/reconciliation/transfer-pair  — konfirmasi pasangan transfer
 *   POST /api/reconciliation/verify-balance — verifikasi saldo nyata
 *
 * Semua endpoint user-scoped (userId dari session, bukan body) dan idempoten
 * (run kedua → no-op). Frontend hanya merender hasil canonical — tidak ada
 * perhitungan finansial di sisi klien.
 */
import { apiGet, apiPost } from '../config/api';
import type { ReconciliationState } from '../types';

export async function getReconciliationState(): Promise<ReconciliationState> {
  return apiGet<ReconciliationState>('/api/reconciliation/state');
}

export interface ClassifyResult {
  applied: number;
  skipped: number;
}

export async function classifyTransaction(transactionId: string, accountId: string): Promise<ClassifyResult> {
  return apiPost<ClassifyResult>('/api/reconciliation/classify', { transactionId, accountId });
}

export async function classifyTransactionsBulk(pairs: Array<{ transactionId: string; accountId: string }>): Promise<ClassifyResult> {
  return apiPost<ClassifyResult>('/api/reconciliation/classify-bulk', { pairs });
}

/**
 * Klasifikasi semua transaksi pending yang saran deterministiknya cocok persis
 * dengan (accountId, confidence). Endpoint server-side; batch berisi transaksi
 * nyata yang dihitung ulang oleh engine — bukan daftar dari klien.
 */
export async function classifyBySuggestion(accountId: string, confidence: 'high' | 'medium'): Promise<ClassifyResult> {
  return apiPost<ClassifyResult>('/api/reconciliation/classify-by-suggestion', { accountId, confidence });
}

export interface RejectResult {
  rejected: number;
  skipped: number;
}

/** P2.8 §13 [Abaikan] — tolak semua transaksi pending yang saran
 *  deterministiknya cocok persis dengan (accountId, confidence). Server-side
 *  re-evaluation; audit `account_rejected`; transaksi confirmed tidak tersentuh. */
export async function rejectBySuggestion(accountId: string, confidence: 'high' | 'medium'): Promise<RejectResult> {
  return apiPost<RejectResult>('/api/reconciliation/classify-reject', { accountId, confidence });
}

export interface PairTransferResult {
  ok: boolean;
  error?: string;
}

export async function pairTransfer(transferId: string, incomeId: string): Promise<PairTransferResult> {
  return apiPost<PairTransferResult>('/api/reconciliation/transfer-pair', { transferId, incomeId });
}

export interface RejectTransferResult {
  ok: boolean;
  alreadyRejected?: boolean;
  error?: string;
}

/** P2.8 §17 [Reject] — tolak kandidat pasangan transfer (transfer tetap
 *  ungrouped; hanya sugesti yang berhenti). Audit `transfer_rejected`. */
export async function rejectTransferCandidate(transferId: string): Promise<RejectTransferResult> {
  return apiPost<RejectTransferResult>('/api/reconciliation/transfer-reject', { transferId });
}

export interface VerifyBalanceResult {
  ok: boolean;
  systemBalance: number;
  actualBalance: number;
  difference: number;
  status: 'verified' | 'mismatch';
  /** P3.1 §19 — waterfall kuantitatif (evidence nyata, non-overlapping). */
  breakdown?: {
    unclassifiedAmount: number;
    unresolvedTransferAmount: number;
    postAnchorMovements: {
      inflow: number;
      expense: number;
      incomingTransfer: number;
      outgoingTransfer: number;
    } | null;
  };
  error?: string;
}

export async function verifyAccountBalance(accountId: string, actualBalance: number, date?: string): Promise<VerifyBalanceResult> {
  return apiPost<VerifyBalanceResult>('/api/reconciliation/verify-balance', { accountId, actualBalance, date });
}

/** P3.1 §21 — reassign eksplisit transaksi tertaut ke rekening lain. */
export async function reassignTransaction(transactionId: string, accountId: string): Promise<ClassifyResult> {
  return apiPost<ClassifyResult>('/api/reconciliation/classify-reassign', { transactionId, accountId });
}
