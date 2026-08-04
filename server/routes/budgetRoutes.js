/**
 * Budget Routes for CashFlow
 *
 * P1-2 (Validation Layer) — Group G1: endpoint mutating divalidasi via
 * server/lib/validation.js. Gagal validasi → 400 VALIDATION_ERROR via
 * sendValidationError (JANGAN PERNAH 401). Bentuk respons SUKSES tidak
 * berubah (contract-pinned di e2e/contract/contracts.ts).
 *
 * Sumber constraint (diturunkan dari kode existing, bukan karangan):
 *  - categoryId/categoryName/amount/month/year wajib: kolom DB NOT NULL
 *    (turso-schema.sql budgets) — absen hari ini → 500 dari SQLite.
 *  - amount > 0  : CHECK DB `amount REAL NOT NULL CHECK (amount > 0)`.
 *  - month 1-12  : CHECK DB `month BETWEEN 1 AND 12`.
 *  - year 2000-2100 : CHECK DB `year BETWEEN 2000 AND 2100`.
 */
import { getTurso } from '../lib/turso.js';
import { requireAuth } from '../middleware/authMiddleware.js';
import { notifyUser } from '../lib/sse.js';
import {
  validateBody,
  sendValidationError,
  validateRequiredString,
  validateInt,
  validateId,
} from '../lib/validation.js';
import { validatePositiveAmount, validateClearableString, presentFieldsSchema } from './transactionRoutes.js';
import crypto from 'node:crypto';

/** Rentang month/year: SAMA PERSIS dengan CHECK DB budgets (turso-schema.sql). */
export const BUDGET_MONTH_MIN = 1;
export const BUDGET_MONTH_MAX = 12;
export const BUDGET_YEAR_MIN = 2000;
export const BUDGET_YEAR_MAX = 2100;

/** Skema POST /api/budgets (di-export untuk unit test). */
export const BUDGET_CREATE_SCHEMA = {
  categoryId: { validate: validateRequiredString, options: { max: 191 } },
  categoryName: { validate: validateRequiredString },
  amount: { validate: validatePositiveAmount, options: { required: true } },
  month: { validate: validateInt, options: { min: BUDGET_MONTH_MIN, max: BUDGET_MONTH_MAX, required: true } },
  year: { validate: validateInt, options: { min: BUDGET_YEAR_MIN, max: BUDGET_YEAR_MAX, required: true } },
};

/** Skema PUT /api/budgets/:id — partial update (hanya field hadir). */
export const BUDGET_UPDATE_SCHEMA = {
  categoryId: { validate: validateClearableString, options: { max: 191 } },
  categoryName: { validate: validateClearableString },
  amount: { validate: validatePositiveAmount },
  month: { validate: validateInt, options: { min: BUDGET_MONTH_MIN, max: BUDGET_MONTH_MAX } },
  year: { validate: validateInt, options: { min: BUDGET_YEAR_MIN, max: BUDGET_YEAR_MAX } },
};

/** Skema POST /api/budgets/update-usage (month/year saja; `transactions`
 *  sengaja dibaca langsung dari req.body — early-return Array.isArray lama
 *  wajib dipertahankan apa adanya). */
export const BUDGET_USAGE_SCHEMA = {
  month: { validate: validateInt, options: { min: BUDGET_MONTH_MIN, max: BUDGET_MONTH_MAX, required: true } },
  year: { validate: validateInt, options: { min: BUDGET_YEAR_MIN, max: BUDGET_YEAR_MAX, required: true } },
};

export function registerBudgetRoutes(app) {
  // GET /api/budgets
  app.get('/api/budgets', requireAuth, async (req, res) => {
    try {
      const turso = getTurso();
      const userId = req.user.id;

      const result = await turso.execute({
        sql: `SELECT * FROM budgets WHERE user_id = ? ORDER BY year DESC, month DESC, created_at DESC LIMIT 200`,
        args: [userId],
      });

      res.json(result.rows);
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  // POST /api/budgets
  app.post('/api/budgets', requireAuth, async (req, res) => {
    try {
      const turso = getTurso();
      const userId = req.user.id;
      const id = crypto.randomUUID();

      // P1-2: validasi body via shared validation library. Gagal → 400
      // VALIDATION_ERROR. Field tak dikenal dibuang (anti mass-assignment).
      const result = validateBody(req.body, BUDGET_CREATE_SCHEMA);
      if (!result.ok) return sendValidationError(res, result);
      const { categoryId, categoryName, amount, month, year } = result.value;
      const now = new Date().toISOString();

      await turso.execute({
        sql: `INSERT INTO budgets (id, user_id, category_id, category_name, amount, used_amount, month, year, status, created_at, updated_at)
              VALUES (?, ?, ?, ?, ?, 0, ?, ?, 'safe', ?, ?)`,
        args: [id, userId, categoryId, categoryName, Number(amount), month, year, now, now],
      });

      notifyUser(userId, 'budget:changed', { id });
      res.json({ id });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  // PUT /api/budgets/:id
  app.put('/api/budgets/:id', requireAuth, async (req, res) => {
    try {
      const turso = getTurso();
      const userId = req.user.id;

      // P1-2: validasi path param :id (400 bila kosong/terlalu panjang).
      const idCheck = validateId(req.params.id, { field: 'id' });
      if (!idCheck.ok) return sendValidationError(res, idCheck);
      const id = idCheck.value;

      // Partial update: HANYA field yang hadir divalidasi (pola undefined-skip).
      const result = validateBody(req.body, presentFieldsSchema(req.body, BUDGET_UPDATE_SCHEMA));
      if (!result.ok) return sendValidationError(res, result);
      const { categoryId, categoryName, amount, month, year } = result.value;

      const updates = [];
      const args = [];
      if (categoryId !== undefined) { updates.push('category_id = ?'); args.push(categoryId); }
      if (categoryName !== undefined) { updates.push('category_name = ?'); args.push(categoryName); }
      if (amount !== undefined) { updates.push('amount = ?'); args.push(Number(amount)); }
      if (month !== undefined) { updates.push('month = ?'); args.push(month); }
      if (year !== undefined) { updates.push('year = ?'); args.push(year); }

      if (updates.length > 0) {
        updates.push("updated_at = datetime('now')");
        await turso.execute({
          sql: `UPDATE budgets SET ${updates.join(', ')} WHERE id = ? AND user_id = ?`,
          args: [...args, id, userId],
        });
      }

      notifyUser(userId, 'budget:changed', { id });
      res.json({ success: true });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  // POST /api/budgets/update-usage — update budget usage based on month/year transactions
  app.post('/api/budgets/update-usage', requireAuth, async (req, res) => {
    try {
      const turso = getTurso();
      const userId = req.user.id;
      const { transactions } = req.body ?? {};

      // Perilaku lama DIPERTAHANKAN: tanpa array transaksi → no-op sukses
      // (early-return ini ada SEBELUM validasi month/year).
      if (!Array.isArray(transactions)) return res.json({ success: true });

      // P1-2: month/year wajib sesuai rentang DB — caller nyata
      // (budgetService.updateBudgetUsage) selalu mengirim angka valid.
      const result = validateBody(req.body, BUDGET_USAGE_SCHEMA);
      if (!result.ok) return sendValidationError(res, result);
      const { month, year } = result.value;

      const expenseTransactions = transactions.filter((t) => t.type === 'expense');

      const budgetsResult = await turso.execute({
        sql: `SELECT * FROM budgets WHERE user_id = ? AND month = ? AND year = ?`,
        args: [userId, month, year],
      });

      for (const budget of budgetsResult.rows) {
        const usedAmount = expenseTransactions
          .filter((t) => t.categoryId === budget.category_id || t.category_id === budget.category_id)
          .reduce((sum, t) => sum + Number(t.amount || 0), 0);

        let status = 'safe';
        if (usedAmount > budget.amount) {
          status = 'overbudget';
        } else if (usedAmount >= budget.amount * 0.8) {
          status = 'warning';
        }

        await turso.execute({
          sql: `UPDATE budgets SET used_amount = ?, status = ?, updated_at = datetime('now') WHERE id = ? AND user_id = ?`,
          args: [usedAmount, status, budget.id, userId],
        });
      }

      notifyUser(userId, 'budget:changed', { month, year });
      res.json({ success: true });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  // DELETE /api/budgets/:id
  app.delete('/api/budgets/:id', requireAuth, async (req, res) => {
    try {
      const turso = getTurso();
      const userId = req.user.id;

      // P1-2: validasi path param :id (400 bila kosong/terlalu panjang).
      const idCheck = validateId(req.params.id, { field: 'id' });
      if (!idCheck.ok) return sendValidationError(res, idCheck);
      const id = idCheck.value;

      await turso.execute({
        sql: `DELETE FROM budgets WHERE id = ? AND user_id = ?`,
        args: [id, userId],
      });

      notifyUser(userId, 'budget:changed', { id });
      res.json({ success: true });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });
}
