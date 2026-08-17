/**
 * Reconciliation Routes (P2.6) — Assisted Ledger Reconciliation.
 *
 *   GET  /api/reconciliation/state         — matriks rekonsiliasi + saran
 *   POST /api/reconciliation/classify      — terima klasifikasi 1 transaksi
 *   POST /api/reconciliation/classify-bulk — terima klasifikasi batch
 *   POST /api/reconciliation/transfer-pair — konfirmasi pasangan transfer
 *   POST /api/reconciliation/verify-balance— verifikasi saldo nyata (system vs actual)
 *
 * KEAMANAN (mandate P2.6 §36):
 *   - requireAuth + user-scoped: userId = req.user.id, TIDAK pernah dari body.
 *   - Validasi fail-closed (400 VALIDATION_ERROR, bukan 401).
 *   - Account/tx milik user lain ditolak oleh engine (WHERE user_id).
 *   - Audit trail per aksi (reconciliation_audit_log) — tanpa payload sensitif.
 * OBSERVABILITY: reconciliation_started/_completed/_failed + per-aksi metrics;
 * hanya requestId/duration/counts (tanpa nominal).
 */
import { getTurso } from '../lib/turso.js';
import { requireAuth } from '../middleware/authMiddleware.js';
import { validateBody, validateQuery, sendValidationError } from '../lib/validation.js';
import { logger } from '../lib/logger.js';
import metricsService from '../services/metricsService.js';
import {
  buildReconciliationState,
  classifyTransactions,
  classifyBySuggestion,
  rejectBySuggestion,
  rejectTransferCandidate,
  pairTransfer,
  verifyAccountBalance,
} from '../lib/reconciliationEngine.js';

/** Id transaksi/akun: string non-kosong ≤ 191 (pola validateRequiredString). */
function validateRefString(value, opts) {
  const field = opts?.field || 'id';
  const required = opts?.required === true;
  if (value === undefined || value === null) {
    if (required) return { ok: false, error: `${field} wajib diisi.` };
    return { ok: true, value: undefined };
  }
  if (typeof value !== 'string') return { ok: false, error: `${field} harus berupa teks.` };
  const trimmed = value.trim();
  if (trimmed.length === 0) return { ok: false, error: `${field} wajib diisi.` };
  if (trimmed.length > 191) return { ok: false, error: `${field} maksimal 191 karakter.` };
  return { ok: true, value: trimmed };
}

function validateAmount(value, opts) {
  const field = opts?.field || 'amount';
  const required = opts?.required === true;
  if (value === undefined || value === null) {
    if (required) return { ok: false, error: `${field} wajib diisi.` };
    return { ok: true, value: undefined };
  }
  const num = Number(value);
  if (!Number.isFinite(num)) return { ok: false, error: `${field} harus berupa angka.` };
  return { ok: true, value: num };
}

function validateIsoDateStr(value, opts) {
  const field = opts?.field || 'date';
  const required = opts?.required === true;
  if (value === undefined || value === null || value === '') {
    if (required) return { ok: false, error: `${field} wajib diisi.` };
    return { ok: true, value: undefined };
  }
  if (typeof value !== 'string') return { ok: false, error: `${field} harus berupa tanggal.` };
  const trimmed = value.trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(trimmed)) return { ok: false, error: `${field} harus berformat YYYY-MM-DD.` };
  return { ok: true, value: trimmed };
}

const CLASSIFY_SCHEMA = {
  transactionId: { validate: validateRefString, options: { field: 'transactionId', required: true } },
  accountId: { validate: validateRefString, options: { field: 'accountId', required: true } },
};

const CLASSIFY_BULK_SCHEMA = {
  pairs: {
    validate: (value, opts) => {
      const field = opts?.field || 'pairs';
      if (!Array.isArray(value)) return { ok: false, error: `${field} harus berupa array.` };
      if (value.length > 2000) return { ok: false, error: `${field} maksimal 2000 item per batch.` };
      const cleaned = [];
      for (const item of value) {
        if (!item || typeof item !== 'object' || Array.isArray(item)) {
          return { ok: false, error: `${field} berisi item tidak valid.` };
        }
        const t = validateRefString(item.transactionId, { field: 'transactionId' });
        const a = validateRefString(item.accountId, { field: 'accountId' });
        if (!t.ok || !a.ok) return t.ok ? a : t;
        cleaned.push({ transactionId: t.value, accountId: a.value });
      }
      return { ok: true, value: cleaned };
    },
    options: { required: true },
  },
};

const CLASSIFY_BY_SUGGESTION_SCHEMA = {
  accountId: { validate: validateRefString, options: { field: 'accountId', required: true } },
  confidence: {
    validate: (value) => {
      if (value !== 'high' && value !== 'medium') {
        return { ok: false, error: 'confidence harus "high" atau "medium".' };
      }
      return { ok: true, value };
    },
    options: { required: true },
  },
};

const TRANSFER_REJECT_SCHEMA = {
  transferId: { validate: validateRefString, options: { field: 'transferId', required: true } },
};

const PAIR_SCHEMA = {
  transferId: { validate: validateRefString, options: { field: 'transferId', required: true } },
  incomeId: { validate: validateRefString, options: { field: 'incomeId', required: true } },
};

const VERIFY_SCHEMA = {
  accountId: { validate: validateRefString, options: { field: 'accountId', required: true } },
  actualBalance: { validate: validateAmount, options: { field: 'actualBalance', required: true } },
  date: { validate: validateIsoDateStr, options: { field: 'date' } },
};

function track(metricName, userId, extra = {}) {
  metricsService.recordSystemMetric({ metricName, feature: 'reconciliation', userId, metadata: extra }).catch(() => {});
}

export function registerReconciliationRoutes(app) {
  app.get('/api/reconciliation/state', requireAuth, async (req, res) => {
    const userId = req.user.id;
    const startMs = Date.now();
    track('reconciliation_started', userId, { requestId: req.id });
    try {
      const state = await buildReconciliationState(getTurso(), userId);
      // Defensive: metric TIDAK boleh mematikan endpoint bila state parsial.
      track('reconciliation_completed', userId, {
        requestId: req.id,
        durationMs: Date.now() - startMs,
        counts: {
          accounts: state?.accounts?.length ?? 0,
          unlinked: state?.transactions?.unlinked ?? 0,
          ungroupedTransfers: state?.transfers?.ungrouped ?? 0,
        },
      });
      res.json(state);
    } catch (err) {
      track('reconciliation_failed', userId, { requestId: req.id });
      logger.warn({ userId, err: err?.message }, 'reconciliation state gagal');
      res.status(500).json({ error: err.message });
    }
  });

  app.post('/api/reconciliation/classify', requireAuth, async (req, res) => {
    const userId = req.user.id;
    const validation = validateBody(req.body, CLASSIFY_SCHEMA);
    if (!validation.ok) return sendValidationError(res, validation);
    try {
      const { applied } = await classifyTransactions(getTurso(), userId, [validation.value]);
      if (applied > 0) track('account_assignment_confirmed', userId, { count: applied, requestId: req.id });
      res.json({ applied, skipped: 1 - applied });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  app.post('/api/reconciliation/classify-bulk', requireAuth, async (req, res) => {
    const userId = req.user.id;
    const validation = validateBody(req.body, CLASSIFY_BULK_SCHEMA);
    if (!validation.ok) return sendValidationError(res, validation);
    try {
      const result = await classifyTransactions(getTurso(), userId, validation.value.pairs);
      if (result.applied > 0) track('account_assignment_confirmed', userId, { count: result.applied, requestId: req.id });
      res.json(result);
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  app.post('/api/reconciliation/classify-reassign', requireAuth, async (req, res) => {
    const userId = req.user.id;
    const validation = validateBody(req.body, CLASSIFY_SCHEMA);
    if (!validation.ok) return sendValidationError(res, validation);
    try {
      // P3.1 §21 — CORRECTION FLOW eksplisit: transaksi yang sudah confirmed
      // BISA dipindah ke rekening lain, TAPI hanya lewat jalur ini (reassign
      // eksplisit — classify biasa tidak pernah meng-overwrite diam-diam).
      // Idempoten: akun sama → no-op; akun berbeda → audit account_reassigned.
      const result = await classifyTransactions(getTurso(), userId, [validation.value], { reassign: true });
      if (result.applied > 0) track('account_reassigned', userId, { count: result.applied, requestId: req.id });
      res.json(result);
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  app.post('/api/reconciliation/classify-by-suggestion', requireAuth, async (req, res) => {
    const userId = req.user.id;
    const validation = validateBody(req.body, CLASSIFY_BY_SUGGESTION_SCHEMA);
    if (!validation.ok) return sendValidationError(res, validation);
    try {
      // Deterministik: engine re-evaluasi tiap transaksi pending, HANYA yang
      // suggestion-nya cocok persis (accountId + confidence) yang diklasifikasi.
      const result = await classifyBySuggestion(getTurso(), userId, validation.value);
      if (result.applied > 0) track('account_assignment_confirmed', userId, { count: result.applied, requestId: req.id });
      res.json(result);
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  app.post('/api/reconciliation/classify-reject', requireAuth, async (req, res) => {
    const userId = req.user.id;
    const validation = validateBody(req.body, CLASSIFY_BY_SUGGESTION_SCHEMA);
    if (!validation.ok) return sendValidationError(res, validation);
    try {
      // P2.8 §13 [Abaikan] — deterministik: engine re-evaluasi tiap transaksi
      // pending; HANYA yang suggestion-nya cocok persis yang ditolak. Audit
      // `account_rejected`; transaksi confirmed TIDAK pernah tersentuh.
      const result = await rejectBySuggestion(getTurso(), userId, validation.value);
      res.json(result);
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  app.post('/api/reconciliation/transfer-reject', requireAuth, async (req, res) => {
    const userId = req.user.id;
    const validation = validateBody(req.body, TRANSFER_REJECT_SCHEMA);
    if (!validation.ok) return sendValidationError(res, validation);
    try {
      // P2.8 §17 [Reject] — transfer tetap ungrouped (jujur); hanya sugesti
      // yang berhenti muncul. Audit `transfer_rejected`.
      const result = await rejectTransferCandidate(getTurso(), userId, validation.value);
      res.status(result.ok ? 200 : 400).json(result);
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  app.post('/api/reconciliation/transfer-pair', requireAuth, async (req, res) => {
    const userId = req.user.id;
    const validation = validateBody(req.body, PAIR_SCHEMA);
    if (!validation.ok) return sendValidationError(res, validation);
    try {
      const result = await pairTransfer(getTurso(), userId, validation.value);
      if (result.ok) track('transfer_pair_confirmed', userId, { requestId: req.id });
      res.status(result.ok ? 200 : 400).json(result);
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  app.post('/api/reconciliation/verify-balance', requireAuth, async (req, res) => {
    const userId = req.user.id;
    const validation = validateBody(req.body, VERIFY_SCHEMA);
    if (!validation.ok) return sendValidationError(res, validation);
    try {
      const result = await verifyAccountBalance(getTurso(), userId, validation.value);
      if (result.ok) {
        track(result.status === 'verified' ? 'balance_verified' : 'balance_mismatch', userId, {
          requestId: req.id,
          difference: result.difference,
        });
      }
      res.status(result.ok ? 200 : 400).json(result);
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });
}
