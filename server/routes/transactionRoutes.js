/**
 * Transaction Routes for CashFlow
 * Replaces direct Supabase queries with Turso SQL + SSE events + RLS via requireAuth
 */
import { getTurso } from '../lib/turso.js';
import { requireAuth } from '../middleware/authMiddleware.js';
import { notifyUser } from '../lib/sse.js';
import crypto from 'node:crypto';

export function registerTransactionRoutes(app) {
  // GET /api/transactions — fetch recent 50 transactions
  app.get('/api/transactions', requireAuth, async (req, res) => {
    try {
      const turso = getTurso();
      const userId = req.user.id;
      const limit = parseInt(req.query.limit || '50', 10);

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
      } = req.body;

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
      const { id } = req.params;
      const { type, amount, categoryId, categoryName, merchant, paymentMethod, note, date } = req.body;

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
      const { id } = req.params;

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
