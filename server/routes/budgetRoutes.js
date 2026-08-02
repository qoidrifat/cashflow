/**
 * Budget Routes for CashFlow
 */
import { getTurso } from '../lib/turso.js';
import { requireAuth } from '../middleware/authMiddleware.js';
import { notifyUser } from '../lib/sse.js';
import crypto from 'node:crypto';

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
      const { categoryId, categoryName, amount, month, year } = req.body;
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
      const { id } = req.params;
      const { categoryId, categoryName, amount, month, year } = req.body;

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
      const { month, year, transactions } = req.body;

      if (!Array.isArray(transactions)) return res.json({ success: true });

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
      const { id } = req.params;

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
