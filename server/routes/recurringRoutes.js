/**
 * Recurring Transaction Routes for CashFlow
 */
import { getTurso } from '../lib/turso.js';
import { requireAuth } from '../middleware/authMiddleware.js';
import { notifyUser } from '../lib/sse.js';
import crypto from 'node:crypto';

export function registerRecurringRoutes(app) {
  // GET /api/recurring
  app.get('/api/recurring', requireAuth, async (req, res) => {
    try {
      const turso = getTurso();
      const userId = req.user.id;

      const result = await turso.execute({
        sql: `SELECT * FROM recurring_transactions WHERE user_id = ? ORDER BY next_due_date ASC`,
        args: [userId],
      });

      res.json(result.rows);
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  // POST /api/recurring
  app.post('/api/recurring', requireAuth, async (req, res) => {
    try {
      const turso = getTurso();
      const userId = req.user.id;
      const id = crypto.randomUUID();
      const {
        type,
        amount,
        categoryId,
        categoryName,
        merchant = '',
        paymentMethod = 'cash',
        note = '',
        interval,
        intervalDay,
        startDate,
        endDate = null,
        nextDueDate,
      } = req.body;
      const now = new Date().toISOString();

      await turso.execute({
        sql: `INSERT INTO recurring_transactions 
              (id, user_id, type, amount, category_id, category_name, merchant, payment_method, note, interval_type, interval_day, start_date, end_date, active, next_due_date, created_at, updated_at)
              VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?, ?)`,
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
          interval,
          intervalDay,
          startDate,
          endDate,
          nextDueDate || startDate,
          now,
          now,
        ],
      });

      notifyUser(userId, 'recurring:changed', { id });
      res.json({ id });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  // PUT /api/recurring/:id
  app.put('/api/recurring/:id', requireAuth, async (req, res) => {
    try {
      const turso = getTurso();
      const userId = req.user.id;
      const { id } = req.params;
      const data = req.body;

      const updates = [];
      const args = [];

      if (data.type !== undefined) { updates.push('type = ?'); args.push(data.type); }
      if (data.amount !== undefined) { updates.push('amount = ?'); args.push(Number(data.amount)); }
      if (data.categoryId !== undefined) { updates.push('category_id = ?'); args.push(data.categoryId); }
      if (data.categoryName !== undefined) { updates.push('category_name = ?'); args.push(data.categoryName); }
      if (data.merchant !== undefined) { updates.push('merchant = ?'); args.push(data.merchant); }
      if (data.paymentMethod !== undefined) { updates.push('payment_method = ?'); args.push(data.paymentMethod); }
      if (data.note !== undefined) { updates.push('note = ?'); args.push(data.note); }
      if (data.interval !== undefined) { updates.push('interval_type = ?'); args.push(data.interval); }
      if (data.intervalDay !== undefined) { updates.push('interval_day = ?'); args.push(data.intervalDay); }
      if (data.startDate !== undefined) { updates.push('start_date = ?'); args.push(data.startDate); }
      if (data.endDate !== undefined) { updates.push('end_date = ?'); args.push(data.endDate); }
      if (data.active !== undefined) { updates.push('active = ?'); args.push(data.active ? 1 : 0); }
      if (data.nextDueDate !== undefined) { updates.push('next_due_date = ?'); args.push(data.nextDueDate); }
      if (data.lastProcessedDate !== undefined) { updates.push('last_processed_date = ?'); args.push(data.lastProcessedDate); }

      if (updates.length > 0) {
        updates.push("updated_at = datetime('now')");
        await turso.execute({
          sql: `UPDATE recurring_transactions SET ${updates.join(', ')} WHERE id = ? AND user_id = ?`,
          args: [...args, id, userId],
        });
      }

      notifyUser(userId, 'recurring:changed', { id });
      res.json({ success: true });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  // DELETE /api/recurring/:id
  app.delete('/api/recurring/:id', requireAuth, async (req, res) => {
    try {
      const turso = getTurso();
      const userId = req.user.id;
      const { id } = req.params;

      await turso.execute({
        sql: `DELETE FROM recurring_transactions WHERE id = ? AND user_id = ?`,
        args: [id, userId],
      });

      notifyUser(userId, 'recurring:changed', { id });
      res.json({ success: true });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });
}
