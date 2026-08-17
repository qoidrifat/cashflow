/**
 * Transaction Routes for CashFlow
 * Replaces direct Supabase queries with Turso SQL + SSE events + RLS via requireAuth
 *
 * P1-2 (Validation Layer) — Group G1: semua endpoint mutating divalidasi via
 * server/lib/validation.js. Gagal validasi → 400 VALIDATION_ERROR via
 * sendValidationError (JANGAN PERNAH 401 — 401 khusus autentikasi dan memicu
 * dialog session-expired di frontend). Bentuk respons SUKSES tidak berubah
 * (contract-pinned di e2e/contract/contracts.ts).
 *
 * Sumber constraint (bukan karangan — diturunkan dari kode existing):
 *  - type        : CHECK DB (turso-schema.sql transactions.type) + union
 *                  TransactionType (src/types/index.ts).
 *  - amount > 0  : CHECK DB (transactions.amount REAL NOT NULL CHECK (amount > 0)).
 *  - categoryId/categoryName/date wajib : kolom NOT NULL di DB (absen hari ini
 *                  → error SQLite → 500; kini ditolak lebih awal sebagai 400).
 *  - paymentMethod & source DIBIAT PERMISIF (string opsional): kolom DB tanpa
 *                  CHECK yang konsisten (schema file memuat CHECK manual/gmail
 *                  tetapi union TransactionSource frontend juga memakai
 *                  'fallback'|'ai'|'import') — menolak nilai sah = risiko
 *                  regresi, sesuai aturan backward-compatibility P1-2.
 *  - limit GET   : clamp 1..5000 (frontend getAllTransactions memakai
 *                  limit=2000 dan e2e gmail-review memakai limit=5000 — clamp
 *                  lebih kecil akan memotong data secara diam-diam).
 */
import { getTurso } from '../lib/turso.js';
import { requireAuth } from '../middleware/authMiddleware.js';
import { notifyUser } from '../lib/sse.js';
import { logger } from '../lib/logger.js';
import { computeFinancialSummary, parseOwnAccounts } from '../lib/financialSummary.js';
import { computeAccountLedger } from '../lib/financialLedger.js';
import { buildReconciliationSummary } from '../lib/reconciliationEngine.js';
import metricsService from '../services/metricsService.js';
import { isConstraintError } from '../lib/retry.js';
import { runFraudDetection, isFraudDetectionEnabled } from '../services/fraudDetectionService.js';
import {
  validateBody,
  validateQuery,
  sendValidationError,
  validateRequiredString,
  validateEnum,
  validateAmount,
  validateIsoDate,
  validateInt,
  validateId,
} from '../lib/validation.js';
import crypto from 'node:crypto';

// Whitelist type: SAMA PERSIS dengan CHECK DB (turso-schema.sql) dan union
// TransactionType (src/types/index.ts): 'income' | 'expense' | 'transfer' | 'refund'.
export const TRANSACTION_TYPES = ['income', 'expense', 'transfer', 'refund'];

/** Clamp limit GET /api/transactions — 5000 = nilai terbesar yang sah dipakai
 *  client saat ini (e2e gmail-review ?limit=5000; frontend getAllTransactions
 *  limit=2000). Default 50 dipertahankan saat param absen. */
export const TRANSACTIONS_LIMIT_MAX = 5000;
export const TRANSACTIONS_LIMIT_DEFAULT = 50;

/**
 * Amount wajib + positif. Lapisan di atas validateAmount ini sekadar
 * memunculkan CHECK DB `amount > 0` sebagai 400 (sebelumnya 500 dari SQLite).
 */
export function validatePositiveAmount(value, opts) {
  const result = validateAmount(value, opts);
  if (!result.ok || result.value === undefined) return result;
  if (result.value <= 0) {
    return { ok: false, error: `${opts?.field ?? 'amount'} harus lebih dari 0.` };
  }
  return result;
}

/**
 * Validasi tanggal fail-closed via validateIsoDate, tetapi MENGEMBALIKAN
 * FORMAT ASLI string (mis. 'YYYY-MM-DD') alih-alih toISOString(). Alasan:
 * seluruh klien mengirim 'YYYY-MM-DD' (getTodayString, normalizeDate,
 * recurring dateStr) dan filter paginated membandingkan `date >= ?/<= ?`
 * secara leksikografis — mengubah format tersimpan akan menggeser hasil
 * filter (regresi diam-diam). Input number (epoch ms) tetap dinormalisasi.
 */
export function validateDateKeepFormat(value, opts) {
  const result = validateIsoDate(value, opts);
  if (!result.ok) return result;
  if (result.value === undefined) return result;
  return { ok: true, value: typeof value === 'string' ? value.trim() : result.value };
}

/** metadata transaksi: plain object JSON (atau absen). Array/primitive ditolak. */
export function validateMetadataObject(value, opts) {
  const field = opts?.field ?? 'metadata';
  if (value === undefined || value === null) return { ok: true, value: undefined };
  if (typeof value !== 'object' || Array.isArray(value)) {
    return { ok: false, error: `${field} harus berupa objek JSON.` };
  }
  return { ok: true, value };
}

/**
 * String opsional untuk body mutasi: BERBEDA dari validateOptionalString —
 * string kosong '' TETAP lolos (bukan dianggap absen) karena PUT sah memakai
 * '' untuk mengosongkan merchant/note (perilaku lama harus dipertahankan).
 */
export function validateClearableString(value, opts) {
  const { field, max = 1000 } = opts || {};
  if (value === undefined || value === null) return { ok: true, value: undefined };
  if (typeof value !== 'string') {
    return { ok: false, error: `${field} harus berupa teks.` };
  }
  const trimmed = value.trim();
  if (trimmed.length > max) {
    return { ok: false, error: `${field} maksimal ${max} karakter.` };
  }
  return { ok: true, value: trimmed };
}

/** confidenceScore: angka 0..1 (validateAmount menolak negatif; max 1). */
const CONFIDENCE_SCORE_FIELD = { validate: validateAmount, options: { field: 'confidenceScore', max: 1 } };

/**
 * Skema POST /api/transactions (di-export untuk unit test).
 * Default nilai lama DIPERTAHANKAN di handler (merchant '', paymentMethod
 * 'cash', note '', source 'manual', gmailMessageId null, confidenceScore
 * null, metadata {}).
 */
export const TRANSACTION_CREATE_SCHEMA = {
  type: { validate: validateEnum, options: { values: TRANSACTION_TYPES, required: true } },
  amount: { validate: validatePositiveAmount, options: { required: true } },
  categoryId: { validate: validateRequiredString, options: { max: 191 } },
  categoryName: { validate: validateRequiredString },
  merchant: { validate: validateClearableString },
  paymentMethod: { validate: validateClearableString, options: { max: 100 } },
  note: { validate: validateClearableString },
  date: { validate: validateDateKeepFormat, options: { required: true } },
  source: { validate: validateClearableString, options: { max: 50 } },
  gmailMessageId: { validate: validateClearableString, options: { max: 191 } },
  confidenceScore: CONFIDENCE_SCORE_FIELD,
  metadata: { validate: validateMetadataObject },
  // P2.5 account-based ledger (migration 0006/0007): akun + grup transfer
  // eksplisit. Opsional — NULL = legacy (unclassified / heuristic pairing).
  accountId: { validate: validateClearableString, options: { max: 191 } },
  transferGroupId: { validate: validateClearableString, options: { max: 191 } },
  // Idempotency-Key (2026-08-09): key opsional utk create-once di server.
  // Dibaca dari header `Idempotency-Key` ATAU body `idempotencyKey` (body
  // field dipakai unit-test harness tanpa header support). Key sama + user
  // sama → kembalikan transaksi existing (replayed), TANPA insert baru.
  idempotencyKey: { validate: validateClearableString, options: { max: 191 } },
};

/**
 * Skema PUT /api/transactions/:id — partial update: handler hanya memasukkan
 * field yang hadir (bukan undefined) ke skema ini (pola undefined-skip lama).
 */
export const TRANSACTION_UPDATE_SCHEMA = {
  type: { validate: validateEnum, options: { values: TRANSACTION_TYPES } },
  amount: { validate: validatePositiveAmount },
  categoryId: { validate: validateClearableString, options: { max: 191 } },
  categoryName: { validate: validateClearableString },
  merchant: { validate: validateClearableString },
  paymentMethod: { validate: validateClearableString, options: { max: 100 } },
  note: { validate: validateClearableString },
  date: { validate: validateDateKeepFormat },
  accountId: { validate: validateClearableString, options: { max: 191 } },
  transferGroupId: { validate: validateClearableString, options: { max: 191 } },
};

/** Saring skema partial update: hanya field yang benar-benar hadir di body. */
export function presentFieldsSchema(body, schema) {
  const filtered = {};
  if (!body || typeof body !== 'object' || Array.isArray(body)) return filtered;
  for (const key of Object.keys(schema)) {
    if (body[key] !== undefined) filtered[key] = schema[key];
  }
  return filtered;
}

export function registerTransactionRoutes(app) {
  // GET /api/transactions — fetch recent transactions (default 50)
  // `id` OPSIONAL (2026-08-09): query point untuk getTransaction(id) — filter
  // user-scoped `AND id = ?`, [] = tidak ada (bukan 404/ambigu). Menutup bug
  // laten roadmap: client sebelumnya mengambil 500 baris terbaru lalu mencari
  // id di memori → transaksi lebih tua dari 500 baris kembali null.
  app.get('/api/transactions', requireAuth, async (req, res) => {
    try {
      const turso = getTurso();
      const userId = req.user.id;

      // P1-2 quick win: clamp limit via validateInt (clamp:true) — nilai di
      // luar rentang dipotong, bukan ditolak; absen → default lama (50).
      // id pakai validateClearableString (BUKAN validateId yang wajib-required):
      // absen → tanpa filter; > 191 char → 400 fail-closed.
      const queryCheck = validateQuery(req.query, {
        limit: { validate: validateInt, options: { min: 1, max: TRANSACTIONS_LIMIT_MAX, clamp: true } },
        id: { validate: validateClearableString, options: { max: 191 } },
      });
      if (!queryCheck.ok) return sendValidationError(res, queryCheck);
      const limit = queryCheck.value.limit ?? TRANSACTIONS_LIMIT_DEFAULT;
      const id = queryCheck.value.id;

      const result = await turso.execute({
        sql: `SELECT * FROM transactions WHERE user_id = ?${id ? ' AND id = ?' : ''} ORDER BY date DESC, created_at DESC LIMIT ?`,
        args: id ? [userId, id, limit] : [userId, limit],
      });

      res.json(result.rows);
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  // GET /api/transactions/paginated — fetch paginated transactions with search/filter
  app.get('/api/transactions/paginated', requireAuth, async (req, res) => {
    try {
      const turso = getTurso();
      const userId = req.user.id;
      const page = Math.max(parseInt(req.query.page || '1', 10), 1);
      const pageSize = Math.min(Math.max(parseInt(req.query.pageSize || '50', 10), 1), 100);
      const offset = (page - 1) * pageSize;

      const { type, categoryId, paymentMethod, source, dateFrom, dateTo, minAmount, maxAmount, search, sortBy } = req.query;

      let whereClause = 'WHERE user_id = ?';
      const args = [userId];

      if (type && type !== 'all') {
        whereClause += ' AND type = ?';
        args.push(type);
      }
      if (categoryId && categoryId !== 'all') {
        whereClause += ' AND category_id = ?';
        args.push(categoryId);
      }
      if (paymentMethod && paymentMethod !== 'all') {
        whereClause += ' AND payment_method = ?';
        args.push(paymentMethod);
      }
      if (source && source !== 'all') {
        whereClause += ' AND source = ?';
        args.push(source);
      }
      if (dateFrom) {
        whereClause += ' AND date >= ?';
        args.push(dateFrom);
      }
      if (dateTo) {
        whereClause += ' AND date <= ?';
        args.push(dateTo);
      }
      if (minAmount) {
        whereClause += ' AND amount >= ?';
        args.push(Number(minAmount));
      }
      if (maxAmount) {
        whereClause += ' AND amount <= ?';
        args.push(Number(maxAmount));
      }
      if (search) {
        whereClause += ' AND (merchant LIKE ? OR category_name LIKE ? OR note LIKE ? OR payment_method LIKE ?)';
        const pattern = `%${search}%`;
        args.push(pattern, pattern, pattern, pattern);
      }

      let orderBy = 'ORDER BY date DESC, created_at DESC';
      switch (sortBy) {
        case 'date-asc':
          orderBy = 'ORDER BY date ASC, created_at ASC';
          break;
        case 'amount-desc':
          orderBy = 'ORDER BY amount DESC, date DESC';
          break;
        case 'amount-asc':
          orderBy = 'ORDER BY amount ASC, date DESC';
          break;
        case 'merchant-asc':
          orderBy = 'ORDER BY merchant ASC, date DESC';
          break;
        case 'merchant-desc':
          orderBy = 'ORDER BY merchant DESC, date DESC';
          break;
      }

      // Count query
      const countResult = await turso.execute({
        sql: `SELECT COUNT(*) as total FROM transactions ${whereClause}`,
        args,
      });
      const total = Number(countResult.rows[0]?.total || 0);

      // Data query
      const dataResult = await turso.execute({
        sql: `SELECT * FROM transactions ${whereClause} ${orderBy} LIMIT ? OFFSET ?`,
        args: [...args, pageSize, offset],
      });

      const totalPages = total > 0 ? Math.ceil(total / pageSize) : 1;

      res.json({
        data: dataResult.rows,
        page,
        pageSize,
        total,
        totalPages,
        hasNextPage: page < totalPages,
        hasPreviousPage: page > 1,
      });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  // GET /api/transactions/summary — ringkasan keuangan WINDOWLESS
  // (lifetime + bulan berjalan + pengeluaran per kategori). Root cause insiden
  // 2026-08-08: dashboard menghitung saldo dari 50 baris terbaru (windowed)
  // sehingga saldo melompat saat window bergeser. Endpoint ini agregasi atas
  // SELURUH transaksi user via SQL — sumber kebenaran tunggal.
  // Observability (audit 2026-08-10): financial_summary_requested / _completed
  // / _failed dicatat non-blocking (recordSystemMetric internal try/catch —
  // kegagalan metrics TIDAK boleh memengaruhi respons). TIDAK ada payload
  // finansial/nominal yang di-log — hanya requestId + duration.
  app.get('/api/transactions/summary', requireAuth, async (req, res) => {
    const userId = req.user.id;
    const startMs = Date.now();
    metricsService.recordSystemMetric({
      metricName: 'financial_summary_requested',
      feature: 'financial',
      userId,
      metadata: { requestId: req.id },
    });
    try {
      const turso = getTurso();

      // month/year opsional (default = bulan server berjalan); clamp ke rentang
      // sah. Gagal → 400 VALIDATION_ERROR (konsisten P1-2).
      const queryCheck = validateQuery(req.query, {
        month: { validate: validateInt, options: { min: 1, max: 12, clamp: true } },
        year: { validate: validateInt, options: { min: 2000, max: 2100, clamp: true } },
      });
      if (!queryCheck.ok) return sendValidationError(res, queryCheck);
      const month = queryCheck.value.month ?? new Date().getMonth() + 1;
      const year = queryCheck.value.year ?? new Date().getFullYear();

      // Semantik "transfer internal = netral" (2026-08-11, §10.13): transfer ke
      // akun milik sendiri (user_financial_settings.own_accounts) TIDAK
      // mengurangi saldo. Tabel settings OPSIONAL — bila tidak ada baris /
      // tabel belum ada, parseOwnAccounts('') → [] → perilaku legacy (semua
      // transfer = expense, backward-compat). Baca settings SEKALI per
      // request summary (bukan per query).
      let ownAccounts = [];
      try {
        const settingsRes = await turso.execute({
          sql: 'SELECT own_accounts FROM user_financial_settings WHERE user_id = ?',
          args: [userId],
        });
        ownAccounts = parseOwnAccounts(settingsRes.rows?.[0]?.own_accounts);
      } catch (err) {
        // Review 2026-08-11: fallback legacy HANYA wajar bila error = tabel
        // settings belum ada (DB tanpa migration 0004). Error lain (koneksi
        // DB, dll.) tidak boleh senyap — log warning agar operasi tidak
        // mengira konfigurasi own_accounts tidak ada padahal read-nya yang
        // gagal. Tanpa payload finansial (hanya userId + pesan error).
        logger.warn(
          { userId, err: err?.message },
          'Gagal membaca user_financial_settings — summary memakai own_accounts kosong (legacy). Periksa migration 0004.',
        );
        ownAccounts = [];
      }

      const summary = await computeFinancialSummary(turso, userId, { month, year, ownAccounts });
      // P2.5: canonical ledger — Current Balance account-based (status jujur
      // known/partial/unknown) terpisah dari Net Cash Flow (lifetime).
      // Append-only: seluruh field existing TIDAK berubah (backward-compat
      // contract e2e/contract). Ledger gagal TIDAK boleh mematikan summary
      // (di-log, ledger null) — kartu lama tetap berfungsi.
      // netCashFlow dirakit dari summary yang sudah dihitung (TANPA agregasi
      // ulang — satu panggilan computeFinancialSummary per request).
      let ledger = null;
      try {
        const accountLedger = await computeAccountLedger(turso, userId);
        ledger = {
          ...accountLedger,
          netCashFlow: {
            amount: summary.lifetime.balance,
            totalIncome: summary.lifetime.totalIncome,
            totalExpense: summary.lifetime.totalExpense,
          },
        };
      } catch (ledgerErr) {
        logger.warn(
          { userId, err: ledgerErr?.message, requestId: req.id },
          'computeAccountLedger gagal — respons tanpa ledger (summary tetap valid)',
        );
      }
      // P2.6: reconciliation summary ringan (counts + status only) —
      // append-only di samping ledger; gagal → reconciliation null, summary
      // tetap valid. Dashboard memakainya untuk banner status + coverage.
      let reconciliation = null;
      try {
        reconciliation = await buildReconciliationSummary(turso, userId);
      } catch (reconErr) {
        logger.warn(
          { userId, err: reconErr?.message, requestId: req.id },
          'buildReconciliationSummary gagal — respons tanpa reconciliation (summary tetap valid)',
        );
      }
      metricsService.recordSystemMetric({
        metricName: 'financial_summary_completed',
        feature: 'financial',
        userId,
        metadata: { requestId: req.id, durationMs: Date.now() - startMs },
      });
      res.json({ ...summary, ledger, reconciliation });
    } catch (err) {
      metricsService.recordSystemMetric({
        metricName: 'financial_summary_failed',
        feature: 'financial',
        userId,
        metadata: { requestId: req.id, durationMs: Date.now() - startMs },
      });
      res.status(500).json({ error: err.message });
    }
  });

  // POST /api/transactions — create transaction
  app.post('/api/transactions', requireAuth, async (req, res) => {
    try {
      const turso = getTurso();
      const userId = req.user.id;
      const id = crypto.randomUUID();

      // P1-2: validasi body via shared validation library. Gagal → 400
      // VALIDATION_ERROR. Field tak dikenal dibuang (anti mass-assignment).
      const result = validateBody(req.body, TRANSACTION_CREATE_SCHEMA);
      if (!result.ok) return sendValidationError(res, result);
      const {
        type,
        amount,
        categoryId,
        categoryName,
        merchant = '',
        paymentMethod = 'cash',
        note = '',
        date,
        source = 'manual',
        gmailMessageId = null,
        confidenceScore = null,
        metadata = {},
        accountId = null,
        transferGroupId = null,
      } = result.value;

      // Idempotency-Key: header mendominasi; body `idempotencyKey` dipakai
      // sebagai fallback (utamanya test harness tanpa header). Key None →
      // perilaku lama sepenuhnya (tanpa pre-SELECT, tanpa jaminan create-once).
      let idempotencyKey =
        (typeof req.get === 'function' ? req.get('Idempotency-Key') : undefined) ||
        result.value.idempotencyKey ||
        null;
      // Key divalidasi PERSIS sama dari sumber mana pun (header TIDAK boleh
      // bypass batas body): trim, max 191 — gagal → 400 fail-closed; kosong
      // setelah trim → dianggap absen (perilaku lama).
      if (idempotencyKey !== null) {
        const trimmedKey = String(idempotencyKey).trim();
        if (trimmedKey.length === 0) {
          idempotencyKey = null;
        } else if (trimmedKey.length > 191) {
          return sendValidationError(res, {
            error: 'Idempotency-Key maksimal 191 karakter.',
            errors: ['Idempotency-Key maksimal 191 karakter.'],
          });
        } else {
          idempotencyKey = trimmedKey;
        }
      }

      if (idempotencyKey) {
        const existing = await turso.execute({
          sql: 'SELECT id FROM transactions WHERE user_id = ? AND idempotency_key = ?',
          args: [userId, idempotencyKey],
        });
        if (existing.rows.length > 0) {
          // Replay sah (retry/timeout): kembalikan transaksi yang sudah ada.
          // SSE + fraud TIDAK di-fire ulang (bukan create baru).
          return res.json({ id: String(existing.rows[0].id), replayed: true });
        }
      }

      // Gmail dedupe server-side penuh (2026-08-11) — menutup gap audit
      // FINANCIAL_CALCULATION_INTEGRITY §10.2: cek duplikat klien
      // (findDuplicateTransaction) hanya memeriksa window 100 transaksi
      // terbaru → pesan LAMA (mis. Maret) di luar window lolos dan di-import
      // ulang setiap sync ulang batch (631 baris duplikat historis).
      // Idempotency-Key di atas hanya menutup request BARU (baris lama punya
      // idempotency_key NULL); cek gmail_message_id penuh (user-scoped, via
      // index idx_transactions_gmail_msg) menutup baris lama juga.
      // TOCTOU antar request baru tetap ditangani unique partial index
      // (user_id, idempotency_key) — klien selalu mengirim Idempotency-Key
      // untuk import gmail (createFingerprint = gmail::userId::gmailMessageId).
      //
      // P3.2 §12 — unik index (user_id, gmail_message_id) BERSIFAT UNCONDITIONAL
      // (bukan hanya source='gmail'); replay karena itu TIDAK boleh di-gate
      // source. Sebelumnya POST non-gmail (mis. source='manual') yang membawa
      // gmailMessageId sudah ada → jatuh ke INSERT mentah → 500 UNIQUE
      // constraint. Kontrak yang konsisten dengan index: SETIAP transaksi yang
      // membawa gmailMessageId yang sudah tercatat → replay { id, replayed:
      // true } (deterministik 200, invariant "Gmail duplicates = 0" tetap).
      if (gmailMessageId) {
        // ORDER BY created_at,id → keep-oldest deterministik (semantik sama
        // tool cleanup §10.7 & unik index 2026-08-11 menjamin ≤ 1 baris).
        const existingGmail = await turso.execute({
          sql: 'SELECT id FROM transactions WHERE user_id = ? AND gmail_message_id = ? ORDER BY created_at ASC, id ASC',
          args: [userId, gmailMessageId],
        });
        if (existingGmail.rows.length > 0) {
          // Pesan sudah pernah di-import → replay (jangan buat baris kedua).
          return res.json({ id: String(existingGmail.rows[0].id), replayed: true });
        }
      }

      const now = new Date().toISOString();

      try {      await turso.execute({
        sql: `INSERT INTO transactions 
                (id, user_id, type, amount, category_id, category_name, merchant, payment_method, note, date, transaction_date, source, gmail_message_id, confidence_score, metadata, idempotency_key, account_id, transfer_group_id, created_at, updated_at)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        args: [
          id,
          userId,
          type,
          Number(amount),
          categoryId,
          categoryName,
          merchant,
          paymentMethod,
          note,
          date,
          date,
          source,
          gmailMessageId,
          confidenceScore,
          JSON.stringify(metadata),
          idempotencyKey,
          accountId,
          transferGroupId,
          now,
          now,
        ],
      });
      } catch (err) {
        // Race TOCTOU: dua request key sama sama-sama lolos pre-SELECT → SATU
        // insert menang, satunya kena unique partial index → replay, bukan 500.
        // Hanya di-handle untuk constraint (unique idempotency); error lain
        // tetap naik (500, tidak disembunyikan).
        const msg = String(err?.message || err);
        if (isConstraintError(msg)) {
          // 1) Idempotency-Key replay (jika ada) — unique partial index
          //    (user_id, idempotency_key).
          if (idempotencyKey) {
            const existing = await turso.execute({
              sql: 'SELECT id FROM transactions WHERE user_id = ? AND idempotency_key = ?',
              args: [userId, idempotencyKey],
            });
            if (existing.rows.length > 0) {
              return res.json({ id: String(existing.rows[0].id), replayed: true });
            }
          }
          // 2) Gmail unique partial index (user_id, gmail_message_id) —
          //    hardening TOCTOU FINAL (2026-08-11, turso-schema.sql
          //    idx_transactions_gmail_msg_unique): request gmail TANPA
          //    Idempotency-Key (direct API / importer batch masa depan) yang
          //    kalah race → replay via gmail lookup, bukan 500.
          //    P3.2 §12 — gate source dihapus (index unconditional; replay
          //    konsisten untuk SEMUA source yang membawa gmailMessageId).
          if (gmailMessageId) {
            const existingGmail = await turso.execute({
              sql: 'SELECT id FROM transactions WHERE user_id = ? AND gmail_message_id = ? ORDER BY created_at ASC, id ASC',
              args: [userId, gmailMessageId],
            });
            if (existingGmail.rows.length > 0) {
              return res.json({ id: String(existingGmail.rows[0].id), replayed: true });
            }
          }
        }
        throw err;
      }

      notifyUser(userId, 'transaction:created', { id, date });

      // Fraud Detection (Sprint 1): L1 rule engine dijalankan fire-and-forget —
      // di luar critical path; write tidak pernah diblokir/digagalkan oleh deteksi.
      if (isFraudDetectionEnabled()) {
        runFraudDetection({
          userId,
          transaction: {
            id,
            type,
            amount: Number(amount),
            merchant,
            categoryId,
            categoryName,
            date,
            source,
            gmailMessageId,
          },
        }).catch(() => {});
      }

      res.json({ id });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  // PUT /api/transactions/:id — update transaction
  app.put('/api/transactions/:id', requireAuth, async (req, res) => {
    try {
      const turso = getTurso();
      const userId = req.user.id;

      // P1-2: validasi path param :id (400 bila kosong/terlalu panjang).
      const idCheck = validateId(req.params.id, { field: 'id' });
      if (!idCheck.ok) return sendValidationError(res, idCheck);
      const id = idCheck.value;

      // Partial update: HANYA field yang hadir divalidasi (pola undefined-skip).
      const result = validateBody(req.body, presentFieldsSchema(req.body, TRANSACTION_UPDATE_SCHEMA));
      if (!result.ok) return sendValidationError(res, result);
      const { type, amount, categoryId, categoryName, merchant, paymentMethod, note, date, accountId, transferGroupId } = result.value;

      const updates = [];
      const args = [];

      if (type !== undefined) { updates.push('type = ?'); args.push(type); }
      if (amount !== undefined) { updates.push('amount = ?'); args.push(Number(amount)); }
      if (categoryId !== undefined) { updates.push('category_id = ?'); args.push(categoryId); }
      if (categoryName !== undefined) { updates.push('category_name = ?'); args.push(categoryName); }
      if (merchant !== undefined) { updates.push('merchant = ?'); args.push(merchant); }
      if (paymentMethod !== undefined) { updates.push('payment_method = ?'); args.push(paymentMethod); }
      if (note !== undefined) { updates.push('note = ?'); args.push(note); }
      if (date !== undefined) {
        updates.push('date = ?'); args.push(date);
        updates.push('transaction_date = ?'); args.push(date);
      }
      if (accountId !== undefined) { updates.push('account_id = ?'); args.push(accountId || null); }
      if (transferGroupId !== undefined) { updates.push('transfer_group_id = ?'); args.push(transferGroupId || null); }

      if (updates.length === 0) return res.json({ success: true });

      updates.push("updated_at = datetime('now')");

      await turso.execute({
        sql: `UPDATE transactions SET ${updates.join(', ')} WHERE id = ? AND user_id = ?`,
        args: [...args, id, userId],
      });

      notifyUser(userId, 'transaction:updated', { id });
      res.json({ success: true });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  // DELETE /api/transactions/:id — delete transaction
  app.delete('/api/transactions/:id', requireAuth, async (req, res) => {
    try {
      const turso = getTurso();
      const userId = req.user.id;

      // P1-2: validasi path param :id (400 bila kosong/terlalu panjang).
      const idCheck = validateId(req.params.id, { field: 'id' });
      if (!idCheck.ok) return sendValidationError(res, idCheck);
      const id = idCheck.value;

      await turso.execute({
        sql: `DELETE FROM transactions WHERE id = ? AND user_id = ?`,
        args: [id, userId],
      });

      notifyUser(userId, 'transaction:deleted', { id });
      res.json({ success: true });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });
}
