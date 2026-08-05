/**
 * Fraud Detection Routes (Sprint 1 — Core Product).
 *
 * Endpoints:
 *   GET  /api/fraud/summary        — ringkasan flag (widget dashboard)
 *   GET  /api/fraud/flags          — daftar flag terbaru (join transaksi)
 *   POST /api/fraud/flags/:id/review — tandai flag "reviewed" (user mengakui)
 *
 * Auth: req.user dari authMiddleware (Better Auth session). Semua query
 * parameterized + scoped user_id — ownership dijamin di SQL, bukan di klien.
 * Data transaksi yang ikut di-join hanya field ringan (merchant/amount/date/type),
 * tanpa PII email/receipt.
 */
import { getTurso } from '../lib/turso.js';
import { requireAuth } from '../middleware/authMiddleware.js';
import { validateQuery, validateInt, validateId, sendValidationError } from '../lib/validation.js';

/** Skema query GET /api/fraud/flags — limit di-clamp 1..100 (fail-closed untuk non-int). */
const FRAUD_FLAGS_QUERY_SCHEMA = {
  limit: { validate: validateInt, options: { min: 1, max: 100, clamp: true } },
};

export function registerFraudRoutes(app) {
  // GET /api/fraud/summary — hitungan open/total + distribusi severity + 5 flag terbaru.
  app.get('/api/fraud/summary', requireAuth, async (req, res) => {
    try {
      const turso = getTurso();
      const userId = req.user.id;

      const [open, total, bySeverityRows, recent] = await Promise.all([
        turso.execute({
          sql: `SELECT COUNT(*) AS c FROM fraud_flags WHERE user_id = ? AND status = 'open'`,
          args: [userId],
        }),
        turso.execute({
          sql: `SELECT COUNT(*) AS c FROM fraud_flags WHERE user_id = ?`,
          args: [userId],
        }),
        turso.execute({
          sql: `SELECT severity, COUNT(*) AS c FROM fraud_flags WHERE user_id = ? GROUP BY severity`,
          args: [userId],
        }),
        turso.execute({
          sql: `SELECT f.id, f.flag_type, f.severity, f.description, f.risk_score, f.decision, f.status, f.created_at,
                       t.merchant, t.amount, t.date, t.type AS transaction_type, t.id AS transaction_id
                FROM fraud_flags f
                LEFT JOIN transactions t ON t.id = f.transaction_id
                WHERE f.user_id = ?
                ORDER BY f.created_at DESC
                LIMIT 5`,
          args: [userId],
        }),
      ]);

      const bySeverity = { low: 0, medium: 0, high: 0, critical: 0 };
      for (const row of bySeverityRows.rows) {
        if (row.severity in bySeverity) bySeverity[row.severity] = Number(row.c) || 0;
      }

      return res.json({
        ok: true,
        openCount: Number(open.rows[0]?.c || 0),
        totalCount: Number(total.rows[0]?.c || 0),
        bySeverity,
        recent: recent.rows,
      });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  // GET /api/fraud/flags?limit=50 — daftar flag terbaru user.
  app.get('/api/fraud/flags', requireAuth, async (req, res) => {
    try {
      const queryCheck = validateQuery(req.query, FRAUD_FLAGS_QUERY_SCHEMA);
      if (!queryCheck.ok) return res.status(400).json({ error: queryCheck.error });
      const limit = queryCheck.value.limit ?? 50;

      const turso = getTurso();
      const userId = req.user.id;
      const { rows } = await turso.execute({
        sql: `SELECT f.id, f.flag_type, f.severity, f.description, f.risk_score, f.decision, f.status, f.created_at,
                     t.merchant, t.amount, t.date, t.type AS transaction_type, t.id AS transaction_id
              FROM fraud_flags f
              LEFT JOIN transactions t ON t.id = f.transaction_id
              WHERE f.user_id = ?
              ORDER BY f.created_at DESC
              LIMIT ?`,
        args: [userId, limit],
      });
      return res.json({ ok: true, flags: rows });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  // POST /api/fraud/flags/:id/review — user menandai flag sudah dicek.
  app.post('/api/fraud/flags/:id/review', requireAuth, async (req, res) => {
    try {
      // P1-2 convention: path param :id divalidasi (400 VALIDATION_ERROR bila tak valid).
      const idCheck = validateId(req.params.id, { field: 'id' });
      if (!idCheck.ok) return sendValidationError(res, idCheck);
      const turso = getTurso();
      const userId = req.user.id;
      await turso.execute({
        sql: `UPDATE fraud_flags SET status = 'reviewed' WHERE id = ? AND user_id = ?`,
        args: [idCheck.value, userId],
      });
      return res.json({ ok: true, success: true });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });
}
