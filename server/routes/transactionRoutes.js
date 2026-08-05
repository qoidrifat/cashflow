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
  app.get('/api/transactions', requireAuth, async (req, res) => {
    try {
      const turso = getTurso();
      const userId = req.user.id;

      // P1-2 quick win: clamp limit via validateInt (clamp:true) — nilai di
      // luar rentang dipotong, bukan ditolak; absen → default lama (50).
      const queryCheck = validateQuery(req.query, {
        limit: { validate: validateInt, options: { min: 1, max: TRANSACTIONS_LIMIT_MAX, clamp: true } },
      });
      if (!queryCheck.ok) return sendValidationError(res, queryCheck);
      const limit = queryCheck.value.limit ?? TRANSACTIONS_LIMIT_DEFAULT;

      const result = await turso.execute({
        sql: `SELECT * FROM transactions WHERE user_id = ? ORDER BY date DESC, created_at DESC LIMIT ?`,
        args: [userId, limit],
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
      } = result.value;

      const now = new Date().toISOString();

      await turso.execute({
        sql: `INSERT INTO transactions 
              (id, user_id, type, amount, category_id, category_name, merchant, payment_method, note, date, transaction_date, source, gmail_message_id, confidence_score, metadata, created_at, updated_at)
              VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
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
          now,
          now,
        ],
      });

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
      const { type, amount, categoryId, categoryName, merchant, paymentMethod, note, date } = result.value;

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
