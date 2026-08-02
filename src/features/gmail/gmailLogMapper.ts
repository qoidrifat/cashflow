/**
 * Pure helper — mapping antara log Gmail Sync (server) dan objek email UI.
 *
 * Dipisah dari `GmailSyncPage.tsx` (komponen React) dan `mappers.ts` agar bisa
 * di-unit-test tanpa memuat React/framer-motion, dan agar logika ini punya satu
 * sumber kebenaran.
 *
 * BUG FIX (tab "Perlu Review"): dulu metadata kolom `metadata` (TEXT JSON di
 * Turso/SQLite) dibiarkan sebagai string mentah, sehingga field `candidate`
 * (amount/merchant/category) tidak pernah terbaca dari data server → tombol
 * "Setujui" gagal diam-diam. `parseMetadata` memastikan string JSON ter-parse,
 * dan `mapLogToSyncEmail` membangun `SyncEmail` lengkap dari `metadata.candidate`.
 */
import type {
  ExtractedTransaction,
  GmailSyncLog,
  SyncEmailDebug,
  SyncEmailStatus,
  TransactionType,
} from '../../types';

/** Email yang dirender di UI Gmail Sync (list + kartu review). */
export interface SyncEmail {
  id: string;
  subject: string;
  from: string;
  date: string;
  body?: string; // Email body untuk retry/mark-as-transaction
  status: SyncEmailStatus;
  amount?: number | null;
  confidence?: number | null;
  merchant?: string | null;
  category?: string | null;
  paymentMethod?: string | null;
  transactionType?: TransactionType;
  description?: string | null;
  /** Catatan transaksi yang jelas — menjelaskan transaksi untuk apa */
  note?: string | null;
  extracted?: ExtractedTransaction | null;
  reason?: string;
  debug?: SyncEmailDebug;
  /** ID transaksi yang berhasil dibuat saat user menyetujui (untuk persist) */
  extractedTransactionId?: string;
}

/**
 * Parse kolom metadata (TEXT JSON di Turso/SQLite) menjadi object.
 * Row mentah dari server bisa membawa metadata sebagai string JSON ATAU object —
 * handle keduanya. BUG FIX: sebelumnya metadata dibiarkan string, sehingga field
 * seperti skipReason/candidate tidak pernah terbaca dari data server (memicu
 * approve "Perlu Review" gagal diam-diam).
 */
export function parseMetadata(raw: unknown): Record<string, unknown> {
  if (raw && typeof raw === 'object') return raw as Record<string, unknown>;
  if (typeof raw === 'string') {
    try {
      return JSON.parse(raw) || {};
    } catch {
      return {};
    }
  }
  return {};
}

/**
 * Bangun SyncEmail lengkap (termasuk amount/merchant/category/paymentMethod/
 * transactionType dari metadata candidate) dari log server, agar tombol
 * Setujui/Tolak di tab "Perlu Review" (yang datanya dari riwayat server)
 * selalu punya data transaksi yang cukup. (BUG FIX)
 */
export function mapLogToSyncEmail(log: GmailSyncLog): SyncEmail {
  const metadata = parseMetadata(log.metadata);
  const candidate = (metadata?.candidate as Record<string, unknown> | undefined) || {};
  return {
    id: log.messageId,
    subject: log.subject,
    from: log.sender,
    date: log.emailDate || log.scannedAt.toISOString(),
    status: log.status,
    confidence:
      log.confidenceScore ??
      (typeof candidate.confidence === 'number' ? candidate.confidence : null),
    note:
      log.extractedNote ||
      (typeof candidate.note === 'string' ? candidate.note : null) ||
      null,
    reason:
      log.errorMessage ||
      (log.status === 'auto_skipped' ||
      log.status === 'auto_rejected' ||
      log.status === 'skipped' ||
      log.status === 'rejected'
        ? (metadata?.skipReason as string | undefined)
        : undefined),
    amount: typeof candidate.amount === 'number' ? candidate.amount : null,
    merchant: typeof candidate.merchant === 'string' ? candidate.merchant : null,
    category: typeof candidate.category === 'string' ? candidate.category : null,
    paymentMethod: typeof candidate.paymentMethod === 'string' ? candidate.paymentMethod : null,
    transactionType:
      typeof candidate.transactionType === 'string'
        ? (candidate.transactionType as TransactionType)
        : undefined,
  };
}
