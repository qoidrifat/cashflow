/**
 * Category Routes for CashFlow
 */
import { getTurso } from '../lib/turso.js';
import { requireAuth } from '../middleware/authMiddleware.js';
import { notifyUser } from '../lib/sse.js';
import crypto from 'node:crypto';

// H-2 (Sprint 4): cache in-memory GET /api/categories per-user (30s TTL) +
// invalidasi pada mutasi (POST/PUT/DELETE/init-defaults) — menghindari query
// berulang per page-load tanpa risiko stale (SSE tetap meng-invalidasi store).
const CATEGORIES_CACHE_TTL_MS = 30_000;
const categoriesCache = new Map(); // userId -> { rows, expiresAt }

function pruneCategoriesCache() {
  const now = Date.now();
  for (const [userId, entry] of categoriesCache) {
    if (entry.expiresAt <= now) categoriesCache.delete(userId);
  }
}

function getCategoriesCached(userId) {
  const entry = categoriesCache.get(userId);
  if (entry && entry.expiresAt > Date.now()) return entry.rows;
  return null;
}

function setCategoriesCache(userId, rows) {
  if (categoriesCache.size > 200) pruneCategoriesCache();
  categoriesCache.set(userId, { rows, expiresAt: Date.now() + CATEGORIES_CACHE_TTL_MS });
}

function invalidateCategoriesCache(userId) {
  categoriesCache.delete(userId);
}

export function registerCategoryRoutes(app) {
  // GET /api/categories
  app.get('/api/categories', requireAuth, async (req, res) => {
    try {
      const userId = req.user.id;
      const cached = getCategoriesCached(userId);
      if (cached) return res.json(cached);

      const turso = getTurso();
      const result = await turso.execute({
        sql: `SELECT * FROM categories WHERE user_id = ? ORDER BY name ASC`,
        args: [userId],
      });

      setCategoriesCache(userId, result.rows);
      res.json(result.rows);
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  // POST /api/categories
  app.post('/api/categories', requireAuth, async (req, res) => {
    try {
      const turso = getTurso();
      const userId = req.user.id;
      const id = crypto.randomUUID();
      const { name, type, icon = 'MoreHorizontal', color = '#6b7280' } = req.body;

      await turso.execute({
        sql: `INSERT INTO categories (id, user_id, name, type, icon, color, is_default, created_at)
              VALUES (?, ?, ?, ?, ?, ?, 0, datetime('now'))`,
        args: [id, userId, name, type, icon, color],
      });

      invalidateCategoriesCache(userId);
      notifyUser(userId, 'category:changed', { id, action: 'create' });
      res.json({ id });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  // POST /api/categories/init-defaults — initialize default expense & income categories
  app.post('/api/categories/init-defaults', requireAuth, async (req, res) => {
    try {
      const turso = getTurso();
      const userId = req.user.id;
      const { categories } = req.body;

      if (Array.isArray(categories)) {
        for (const cat of categories) {
          await turso.execute({
            sql: `INSERT INTO categories (id, user_id, name, type, icon, color, is_default, created_at)
                  VALUES (?, ?, ?, ?, ?, ?, 1, datetime('now'))
                  ON CONFLICT(user_id, id) DO NOTHING`,
            args: [cat.id, userId, cat.name, cat.type, cat.icon || 'MoreHorizontal', cat.color || '#6b7280'],
          });
        }
      }

      invalidateCategoriesCache(userId);
      notifyUser(userId, 'category:changed', { action: 'init' });
      res.json({ success: true });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  // PUT /api/categories/:id
  app.put('/api/categories/:id', requireAuth, async (req, res) => {
    try {
      const turso = getTurso();
      const userId = req.user.id;
      const { id } = req.params;
      const { name, type, icon, color } = req.body;

      const updates = [];
      const args = [];
      if (name !== undefined) { updates.push('name = ?'); args.push(name); }
      if (type !== undefined) { updates.push('type = ?'); args.push(type); }
      if (icon !== undefined) { updates.push('icon = ?'); args.push(icon); }
      if (color !== undefined) { updates.push('color = ?'); args.push(color); }

      if (updates.length > 0) {
        await turso.execute({
          sql: `UPDATE categories SET ${updates.join(', ')} WHERE id = ? AND user_id = ? AND is_default = 0`,
          args: [...args, id, userId],
        });
      }

      invalidateCategoriesCache(userId);
      notifyUser(userId, 'category:changed', { id, action: 'update' });
      res.json({ success: true });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  // DELETE /api/categories/:id
  app.delete('/api/categories/:id', requireAuth, async (req, res) => {
    try {
      const turso = getTurso();
      const userId = req.user.id;
      const { id } = req.params;

      await turso.execute({
        sql: `DELETE FROM categories WHERE id = ? AND user_id = ? AND is_default = 0`,
        args: [id, userId],
      });

      invalidateCategoriesCache(userId);
      notifyUser(userId, 'category:changed', { id, action: 'delete' });
      res.json({ success: true });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });
}
