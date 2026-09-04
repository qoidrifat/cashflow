/**
 * Category Routes for CashFlow
 *
 * P1-2 (Validation Layer) — Group G1: endpoint mutating divalidasi via
 * server/lib/validation.js. Gagal validasi → 400 VALIDATION_ERROR via
 * sendValidationError (JANGAN PERNAH 401). Bentuk respons SUKSES tidak
 * berubah (contract-pinned di e2e/contract/contracts.ts).
 *
 * Sumber constraint (diturunkan dari kode existing, bukan karangan):
 *  - type : CHECK DB `type IN ('income','expense')` (turso-schema.sql
 *           categories.type) + union Category.type (src/types/index.ts).
 *  - name wajib : kolom DB NOT NULL (absen hari ini → 500 dari SQLite).
 *  - icon/color : default lama dipertahankan ('MoreHorizontal' / '#6b7280').
 */
import { getTurso } from '../lib/turso.js';
import { requireAuth } from '../middleware/authMiddleware.js';
import { notifyUser } from '../lib/sse.js';
import {
  validateBody,
  sendValidationError,
  validateRequiredString,
  validateOptionalString,
  validateEnum,
  validateId,
} from '../lib/validation.js';
import crypto from 'node:crypto';

// Whitelist type kategori: SAMA PERSIS dengan CHECK DB dan Category.type
// (src/types/index.ts): 'income' | 'expense'.
export const CATEGORY_TYPES = ['income', 'expense'];

/** String opsional yang boleh kosong ('' sah utk PUT — pola lama dipertahankan). */
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

/** Skema POST /api/categories (di-export untuk unit test). */
export const CATEGORY_CREATE_SCHEMA = {
  name: { validate: validateRequiredString, options: { max: 200 } },
  type: { validate: validateEnum, options: { values: CATEGORY_TYPES, required: true } },
  icon: { validate: validateOptionalString, options: { max: 100 } },
  color: { validate: validateOptionalString, options: { max: 50 } },
};

/** Skema PUT /api/categories/:id — partial update (hanya field hadir). */
export const CATEGORY_UPDATE_SCHEMA = {
  name: { validate: validateClearableString, options: { max: 200 } },
  type: { validate: validateEnum, options: { values: CATEGORY_TYPES } },
  icon: { validate: validateClearableString, options: { max: 100 } },
  color: { validate: validateClearableString, options: { max: 50 } },
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

/**
 * Skema SATU item init-defaults. id wajib: bagian PRIMARY KEY (user_id, id) —
 * absen hari ini → constraint error SQLite → 500. name/type wajib: NOT NULL +
 * CHECK DB. Nilai default item lama ('MoreHorizontal'/'#6b7280') dipertahankan
 * di handler. Label field memakai `categories[i].*` agar pesan error jelas.
 */
export function categoryInitItemSchema(index) {
  const prefix = `categories[${index}]`;
  return {
    id: { validate: validateRequiredString, options: { field: `${prefix}.id`, max: 191 } },
    name: { validate: validateRequiredString, options: { field: `${prefix}.name`, max: 200 } },
    type: { validate: validateEnum, options: { field: `${prefix}.type`, values: CATEGORY_TYPES, required: true } },
    icon: { validate: validateOptionalString, options: { field: `${prefix}.icon`, max: 100 } },
    color: { validate: validateOptionalString, options: { field: `${prefix}.color`, max: 50 } },
  };
}

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

      // P1-2: validasi body via shared validation library. Gagal → 400
      // VALIDATION_ERROR. Field tak dikenal dibuang (anti mass-assignment).
      const result = validateBody(req.body, CATEGORY_CREATE_SCHEMA);
      if (!result.ok) return sendValidationError(res, result);
      const { name, type, icon = 'MoreHorizontal', color = '#6b7280' } = result.value;

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
      const { categories } = req.body ?? {};

      // Perilaku lama DIPERTAHANKAN: `categories` bukan array → no-op sukses.
      if (Array.isArray(categories)) {
        // P1-2: validasi SEMUA item dulu (kumpul semua error) SEBELUM ada
        // INSERT — setengah-jalan gagal tidak meninggalkan data parsial.
        const cleanedItems = [];
        const itemErrors = [];
        for (let i = 0; i < categories.length; i++) {
          const itemResult = validateBody(categories[i], categoryInitItemSchema(i));
          if (!itemResult.ok) {
            itemErrors.push(...itemResult.errors);
            continue;
          }
          cleanedItems.push(itemResult.value);
        }
        if (itemErrors.length > 0) {
          return sendValidationError(res, { ok: false, error: itemErrors.join('; '), errors: itemErrors });
        }
        // L1 (audit 2026-09-04): N+1 INSERT per kategori → 1 round-trip via
        // turso.batch(). ON CONFLICT(user_id, id) DO NOTHING dipertahankan agar
        // idempoten (retry tidak menduplikasi).
        await turso.batch(
          cleanedItems.map((cat) => ({
            sql: `INSERT INTO categories (id, user_id, name, type, icon, color, is_default, created_at)
                  VALUES (?, ?, ?, ?, ?, ?, 1, datetime('now'))
                  ON CONFLICT(user_id, id) DO NOTHING`,
            args: [cat.id, userId, cat.name, cat.type, cat.icon || 'MoreHorizontal', cat.color || '#6b7280'],
          })),
        );
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

      // P1-2: validasi path param :id (400 bila kosong/terlalu panjang).
      const idCheck = validateId(req.params.id, { field: 'id' });
      if (!idCheck.ok) return sendValidationError(res, idCheck);
      const id = idCheck.value;

      // Partial update: HANYA field yang hadir divalidasi (pola undefined-skip).
      const result = validateBody(req.body, presentFieldsSchema(req.body, CATEGORY_UPDATE_SCHEMA));
      if (!result.ok) return sendValidationError(res, result);
      const { name, type, icon, color } = result.value;

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

      // P1-2: validasi path param :id (400 bila kosong/terlalu panjang).
      const idCheck = validateId(req.params.id, { field: 'id' });
      if (!idCheck.ok) return sendValidationError(res, idCheck);
      const id = idCheck.value;

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
