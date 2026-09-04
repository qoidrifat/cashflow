/**
 * Recurring Transaction Routes for CashFlow
 *
 * HIGH fix (audit 2026-09-04): tambah validasi body via shared library
 * server/lib/validation.js (konsisten dengan 11 route file domain lain).
 * Sebelumnya `req.body` mentah dipakai langsung INSERT/UPDATE → mass-assignment
 * + raw write DB. Enum `type` & `interval` harus selaras dengan CHECK DB
 * `recurring_transactions.type` di server/migrations/0001_baseline.sql.
 */
import { getTurso } from '../lib/turso.js';
import { requireAuth } from '../middleware/authMiddleware.js';
import { notifyUser } from '../lib/sse.js';
import {
  validateBody, sendValidationError,
  validateEnum, validateAmount, validateRequiredString,
  validateOptionalString, validateIsoDate, validateInt, validateBoolean,
} from '../lib/validation.js';
import crypto from 'node:crypto';

const RECURRING_TYPES = ['income', 'expense', 'transfer', 'refund'];
const RECURRING_INTERVALS = ['daily', 'weekly', 'monthly', 'yearly'];

const RECURRING_CREATE_SCHEMA = {
  type: { validate: validateEnum, options: { field: 'type', values: RECURRING_TYPES, required: true } },
  amount: { validate: validateAmount, options: { field: 'amount', required: true, max: 1e12 } },
  categoryId: { validate: validateRequiredString, options: { field: 'categoryId', max: 191 } },
  categoryName: { validate: validateRequiredString, options: { field: 'categoryName', max: 191 } },
  merchant: { validate: validateOptionalString, options: { field: 'merchant', max: 191 } },
  paymentMethod: { validate: validateOptionalString, options: { field: 'paymentMethod', max: 100 } },
  note: { validate: validateOptionalString, options: { field: 'note', max: 1000 } },
  interval: { validate: validateEnum, options: { field: 'interval', values: RECURRING_INTERVALS, required: true } },
  intervalDay: { validate: validateInt, options: { field: 'intervalDay', min: 1, max: 31 } },
  startDate: { validate: validateIsoDate, options: { field: 'startDate', required: true } },
  endDate: { validate: validateIsoDate, options: { field: 'endDate' } },
  nextDueDate: { validate: validateIsoDate, options: { field: 'nextDueDate' } },
};

const RECURRING_UPDATE_SCHEMA = {
  type: { validate: validateEnum, options: { field: 'type', values: RECURRING_TYPES } },
  amount: { validate: validateAmount, options: { field: 'amount', max: 1e12 } },
  categoryId: { validate: validateOptionalString, options: { field: 'categoryId', max: 191 } },
  categoryName: { validate: validateOptionalString, options: { field: 'categoryName', max: 191 } },
  merchant: { validate: validateOptionalString, options: { field: 'merchant', max: 191 } },
  paymentMethod: { validate: validateOptionalString, options: { field: 'paymentMethod', max: 100 } },
  note: { validate: validateOptionalString, options: { field: 'note', max: 1000 } },
  interval: { validate: validateEnum, options: { field: 'interval', values: RECURRING_INTERVALS } },
  intervalDay: { validate: validateInt, options: { field: 'intervalDay', min: 1, max: 31 } },
  startDate: { validate: validateIsoDate, options: { field: 'startDate' } },
  endDate: { validate: validateIsoDate, options: { field: 'endDate' } },
  nextDueDate: { validate: validateIsoDate, options: { field: 'nextDueDate' } },
  active: { validate: validateBoolean, options: { field: 'active' } },
};

export function registerRecurringRoutes(app) {
  app.get('/api/recurring', requireAuth, async (req, res) => {
    try {
      const turso = getTurso();
      const userId = req.user.id;
      const result = await turso.execute({
        sql: 'SELECT * FROM recurring_transactions WHERE user_id = ? ORDER BY next_due_date ASC',
        args: [userId],
      });
      res.json(result.rows);
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  app.post('/api/recurring', requireAuth, async (req, res) => {
    const bodyCheck = validateBody(req.body, RECURRING_CREATE_SCHEMA);
    if (!bodyCheck.ok) return sendValidationError(res, bodyCheck);
    const v = bodyCheck.value;
    if (v.endDate && v.endDate < v.startDate) {
      return res.status(400).json({ error: 'endDate harus >= startDate.' });
    }
    try {
      const turso = getTurso();
      const userId = req.user.id;
      const id = crypto.randomUUID();
      const now = new Date().toISOString();
      await turso.execute({
        sql: `INSERT INTO recurring_transactions
              (id, user_id, type, amount, category_id, category_name, merchant, payment_method, note, interval_type, interval_day, start_date, end_date, active, next_due_date, created_at, updated_at)
              VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?, ?)`,
        args: [
          id, userId, v.type, v.amount, v.categoryId, v.categoryName,
          v.merchant ?? '', v.paymentMethod ?? 'cash', v.note ?? '',
          v.interval, v.intervalDay ?? null,
          v.startDate, v.endDate ?? null,
          v.nextDueDate ?? v.startDate, now, now,
        ],
      });
      notifyUser(userId, 'recurring:changed', { id });
      res.json({ id });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  app.put('/api/recurring/:id', requireAuth, async (req, res) => {
    const bodyCheck = validateBody(req.body, RECURRING_UPDATE_SCHEMA);
    if (!bodyCheck.ok) return sendValidationError(res, bodyCheck);
    const v = bodyCheck.value;
    if (v.endDate && v.startDate && v.endDate < v.startDate) {
      return res.status(400).json({ error: 'endDate harus >= startDate.' });
    }
    try {
      const turso = getTurso();
      const userId = req.user.id;
      const { id } = req.params;
      const updates = [];
      const args = [];
      const map = {
        type: 'type', amount: 'amount', categoryId: 'category_id',
        categoryName: 'category_name', merchant: 'merchant',
        paymentMethod: 'payment_method', note: 'note',
        interval: 'interval_type', intervalDay: 'interval_day',
        startDate: 'start_date', endDate: 'end_date',
        nextDueDate: 'next_due_date',
      };
      for (const [k, col] of Object.entries(map)) {
        if (v[k] !== undefined) { updates.push(`${col} = ?`); args.push(v[k]); }
      }
      if (v.active !== undefined) { updates.push('active = ?'); args.push(v.active ? 1 : 0); }
      if (updates.length === 0) {
        notifyUser(userId, 'recurring:changed', { id });
        return res.json({ success: true });
      }
      updates.push("updated_at = datetime('now')");
      await turso.execute({
        sql: `UPDATE recurring_transactions SET ${updates.join(', ')} WHERE id = ? AND user_id = ?`,
        args: [...args, id, userId],
      });
      notifyUser(userId, 'recurring:changed', { id });
      res.json({ success: true });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  app.delete('/api/recurring/:id', requireAuth, async (req, res) => {
    try {
      const turso = getTurso();
      const userId = req.user.id;
      const { id } = req.params;
      await turso.execute({
        sql: 'DELETE FROM recurring_transactions WHERE id = ? AND user_id = ?',
        args: [id, userId],
      });
      notifyUser(userId, 'recurring:changed', { id });
      res.json({ success: true });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });
}
