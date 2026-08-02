/**
 * Professional Suite Routes for CashFlow
 * (Wallet Accounts, Saving Goals, Subscriptions)
 */
import { getTurso } from '../lib/turso.js';
import { requireAuth } from '../middleware/authMiddleware.js';
import { notifyUser } from '../lib/sse.js';
import crypto from 'node:crypto';

export function registerProfessionalSuiteRoutes(app) {
  // ================= WALLET ACCOUNTS =================
  app.get('/api/wallets', requireAuth, async (req, res) => {
    try {
      const turso = getTurso();
      const userId = req.user.id;
      const result = await turso.execute({
        sql: `SELECT * FROM wallet_accounts WHERE user_id = ? ORDER BY archived ASC, created_at DESC`,
        args: [userId],
      });
      res.json(result.rows);
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  app.post('/api/wallets', requireAuth, async (req, res) => {
    try {
      const turso = getTurso();
      const userId = req.user.id;
      const id = crypto.randomUUID();
      const { name, type, institution = '', balance = 0, color = '#8b5cf6' } = req.body;
      const now = new Date().toISOString();

      await turso.execute({
        sql: `INSERT INTO wallet_accounts (id, user_id, name, type, institution, balance, color, archived, created_at, updated_at)
              VALUES (?, ?, ?, ?, ?, ?, ?, 0, ?, ?)`,
        args: [id, userId, name, type, institution, Number(balance), color, now, now],
      });

      notifyUser(userId, 'wallet:changed', { id });
      res.json({ id });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  app.put('/api/wallets/:id', requireAuth, async (req, res) => {
    try {
      const turso = getTurso();
      const userId = req.user.id;
      const { id } = req.params;
      const data = req.body;

      const updates = [];
      const args = [];
      if (data.name !== undefined) { updates.push('name = ?'); args.push(data.name); }
      if (data.type !== undefined) { updates.push('type = ?'); args.push(data.type); }
      if (data.institution !== undefined) { updates.push('institution = ?'); args.push(data.institution); }
      if (data.balance !== undefined) { updates.push('balance = ?'); args.push(Number(data.balance)); }
      if (data.color !== undefined) { updates.push('color = ?'); args.push(data.color); }
      if (data.archived !== undefined) { updates.push('archived = ?'); args.push(data.archived ? 1 : 0); }

      if (updates.length > 0) {
        updates.push("updated_at = datetime('now')");
        await turso.execute({
          sql: `UPDATE wallet_accounts SET ${updates.join(', ')} WHERE id = ? AND user_id = ?`,
          args: [...args, id, userId],
        });
      }

      notifyUser(userId, 'wallet:changed', { id });
      res.json({ success: true });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  app.delete('/api/wallets/:id', requireAuth, async (req, res) => {
    try {
      const turso = getTurso();
      const userId = req.user.id;
      const { id } = req.params;

      await turso.execute({
        sql: `DELETE FROM wallet_accounts WHERE id = ? AND user_id = ?`,
        args: [id, userId],
      });

      notifyUser(userId, 'wallet:changed', { id });
      res.json({ success: true });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  // ================= SAVING GOALS =================
  app.get('/api/goals', requireAuth, async (req, res) => {
    try {
      const turso = getTurso();
      const userId = req.user.id;
      const result = await turso.execute({
        sql: `SELECT * FROM saving_goals WHERE user_id = ? ORDER BY created_at DESC`,
        args: [userId],
      });
      res.json(result.rows);
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  app.post('/api/goals', requireAuth, async (req, res) => {
    try {
      const turso = getTurso();
      const userId = req.user.id;
      const id = crypto.randomUUID();
      const { name, targetAmount, currentAmount = 0, targetDate, color = '#10b981' } = req.body;
      const now = new Date().toISOString();

      let status = 'on-track';
      if (Number(currentAmount) >= Number(targetAmount)) status = 'completed';

      await turso.execute({
        sql: `INSERT INTO saving_goals (id, user_id, name, target_amount, current_amount, target_date, color, status, created_at, updated_at)
              VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        args: [id, userId, name, Number(targetAmount), Number(currentAmount), targetDate, color, status, now, now],
      });

      notifyUser(userId, 'goal:changed', { id });
      res.json({ id });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  app.put('/api/goals/:id', requireAuth, async (req, res) => {
    try {
      const turso = getTurso();
      const userId = req.user.id;
      const { id } = req.params;
      const data = req.body;

      const updates = [];
      const args = [];
      if (data.name !== undefined) { updates.push('name = ?'); args.push(data.name); }
      if (data.targetAmount !== undefined) { updates.push('target_amount = ?'); args.push(Number(data.targetAmount)); }
      if (data.currentAmount !== undefined) { updates.push('current_amount = ?'); args.push(Number(data.currentAmount)); }
      if (data.targetDate !== undefined) { updates.push('target_date = ?'); args.push(data.targetDate); }
      if (data.color !== undefined) { updates.push('color = ?'); args.push(data.color); }
      if (data.status !== undefined) { updates.push('status = ?'); args.push(data.status); }

      if (updates.length > 0) {
        updates.push("updated_at = datetime('now')");
        await turso.execute({
          sql: `UPDATE saving_goals SET ${updates.join(', ')} WHERE id = ? AND user_id = ?`,
          args: [...args, id, userId],
        });
      }

      notifyUser(userId, 'goal:changed', { id });
      res.json({ success: true });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  app.delete('/api/goals/:id', requireAuth, async (req, res) => {
    try {
      const turso = getTurso();
      const userId = req.user.id;
      const { id } = req.params;

      await turso.execute({
        sql: `DELETE FROM saving_goals WHERE id = ? AND user_id = ?`,
        args: [id, userId],
      });

      notifyUser(userId, 'goal:changed', { id });
      res.json({ success: true });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  // ================= SUBSCRIPTIONS =================
  app.get('/api/subscriptions', requireAuth, async (req, res) => {
    try {
      const turso = getTurso();
      const userId = req.user.id;
      const result = await turso.execute({
        sql: `SELECT * FROM subscriptions WHERE user_id = ? ORDER BY next_billing_date ASC`,
        args: [userId],
      });
      res.json(result.rows);
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  app.post('/api/subscriptions', requireAuth, async (req, res) => {
    try {
      const turso = getTurso();
      const userId = req.user.id;
      const id = crypto.randomUUID();
      const { name, amount, cycle, categoryId, categoryName, nextBillingDate, status = 'active' } = req.body;
      const now = new Date().toISOString();

      await turso.execute({
        sql: `INSERT INTO subscriptions (id, user_id, name, amount, cycle, category_id, category_name, next_billing_date, status, created_at, updated_at)
              VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        args: [id, userId, name, Number(amount), cycle, categoryId, categoryName, nextBillingDate, status, now, now],
      });

      notifyUser(userId, 'subscription:changed', { id });
      res.json({ id });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  app.put('/api/subscriptions/:id', requireAuth, async (req, res) => {
    try {
      const turso = getTurso();
      const userId = req.user.id;
      const { id } = req.params;
      const data = req.body;

      const updates = [];
      const args = [];
      if (data.name !== undefined) { updates.push('name = ?'); args.push(data.name); }
      if (data.amount !== undefined) { updates.push('amount = ?'); args.push(Number(data.amount)); }
      if (data.cycle !== undefined) { updates.push('cycle = ?'); args.push(data.cycle); }
      if (data.categoryId !== undefined) { updates.push('category_id = ?'); args.push(data.categoryId); }
      if (data.categoryName !== undefined) { updates.push('category_name = ?'); args.push(data.categoryName); }
      if (data.nextBillingDate !== undefined) { updates.push('next_billing_date = ?'); args.push(data.nextBillingDate); }
      if (data.status !== undefined) { updates.push('status = ?'); args.push(data.status); }

      if (updates.length > 0) {
        updates.push("updated_at = datetime('now')");
        await turso.execute({
          sql: `UPDATE subscriptions SET ${updates.join(', ')} WHERE id = ? AND user_id = ?`,
          args: [...args, id, userId],
        });
      }

      notifyUser(userId, 'subscription:changed', { id });
      res.json({ success: true });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  app.delete('/api/subscriptions/:id', requireAuth, async (req, res) => {
    try {
      const turso = getTurso();
      const userId = req.user.id;
      const { id } = req.params;

      await turso.execute({
        sql: `DELETE FROM subscriptions WHERE id = ? AND user_id = ?`,
        args: [id, userId],
      });

      notifyUser(userId, 'subscription:changed', { id });
      res.json({ success: true });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });
}
