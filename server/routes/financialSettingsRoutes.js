/**
 * Financial Settings Routes — konfigurasi finansial per-user.
 *
 * Latar belakang (docs/financial/FINANCIAL_CALCULATION_INTEGRITY.md §10.13):
 * rekonsiliasi balance aktual (2026-08-11) menemukan transfer ke akun milik
 * sendiri (merchant = LINE Bank / Bank Jago / blu / dst.) dihitung sebagai
 * expense → balance tampak sangat negatif padahal kekayaan bersih user tidak
 * berubah. Keputusan produk user: "transfer internal = netral".
 *
 * Endpoint ini mengelola daftar nama akun milik sendiri (`own_accounts`):
 *   GET /api/financial/settings → { ownAccounts: string[] }
 *   PUT /api/financial/settings → body { ownAccounts: string[] }
 *
 * Dipakai oleh GET /api/transactions/summary (computeFinancialSummary) untuk
 * mengecualikan transfer ke akun sendiri dari komponen expense.
 *
 * Keamanan:
 *  - requireAuth + user-scoped (userId = req.user.id, TIDAK menerima userId
 *    dari body/query sebagai authority).
 *  - Validasi fail-closed via shared validation lib (400 VALIDATION_ERROR,
 *    JANGAN 401).
 *  - Tanpa payload finansial (hanya nama akun konfigurasi).
 */
import { getTurso } from '../lib/turso.js';
import { requireAuth } from '../middleware/authMiddleware.js';
import {
  validateBody,
  sendValidationError,
} from '../lib/validation.js';
import { parseOwnAccounts } from '../lib/financialSummary.js';

/** Batas jumlah akun milik sendiri (anti payload raksasa). */
const MAX_OWN_ACCOUNTS = 100;
/** Batas panjang satu nama akun (konsisten guard id/merchant 191). */
const MAX_ACCOUNT_NAME_LENGTH = 191;

/**
 * Validator `ownAccounts`: wajib array string non-kosong (di-trim),
 * tiap nama ≤ 191 karakter, maksimal MAX_OWN_ACCOUNTS akun, duplikat dibuang.
 * Fail-closed: bukan array / berisi non-string → error.
 */
function validateOwnAccounts(value, opts) {
  const field = opts?.field || 'ownAccounts';
  if (!Array.isArray(value)) {
    return { ok: false, error: `${field} harus berupa array nama akun.` };
  }
  if (value.length > MAX_OWN_ACCOUNTS) {
    return { ok: false, error: `${field} maksimal ${MAX_OWN_ACCOUNTS} akun.` };
  }
  const seen = new Set();
  const cleaned = [];
  for (const item of value) {
    if (typeof item !== 'string') {
      return { ok: false, error: `${field} hanya boleh berisi teks nama akun.` };
    }
    const trimmed = item.trim();
    if (trimmed.length === 0) continue; // string kosong diabaikan (bukan error)
    if (trimmed.length > MAX_ACCOUNT_NAME_LENGTH) {
      return { ok: false, error: `${field} maksimal ${MAX_ACCOUNT_NAME_LENGTH} karakter per akun.` };
    }
    if (seen.has(trimmed)) continue; // duplikat dibuang
    seen.add(trimmed);
    cleaned.push(trimmed);
  }
  return { ok: true, value: cleaned };
}

/** Skema PUT /api/financial/settings — hanya field ownAccounts (anti mass-assignment). */
const FINANCIAL_SETTINGS_BODY_SCHEMA = {
  ownAccounts: { validate: validateOwnAccounts, options: { required: true } },
};

export function registerFinancialSettingsRoutes(app) {
  // GET /api/financial/settings — baca daftar akun milik sendiri
  app.get('/api/financial/settings', requireAuth, async (req, res) => {
    try {
      const turso = getTurso();
      const userId = req.user.id;
      let ownAccounts = [];
      try {
        const result = await turso.execute({
          sql: 'SELECT own_accounts FROM user_financial_settings WHERE user_id = ?',
          args: [userId],
        });
        ownAccounts = parseOwnAccounts(result.rows?.[0]?.own_accounts);
      } catch {
        // Tabel settings belum ada (DB lama tanpa migration 0004) → kosong.
        ownAccounts = [];
      }
      res.json({ ownAccounts });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  // PUT /api/financial/settings — simpan daftar akun milik sendiri (upsert)
  app.put('/api/financial/settings', requireAuth, async (req, res) => {
    try {
      const turso = getTurso();
      const userId = req.user.id;

      const validation = validateBody(req.body, FINANCIAL_SETTINGS_BODY_SCHEMA);
      if (!validation.ok) return sendValidationError(res, validation);
      const { ownAccounts } = validation.value;

      const now = new Date().toISOString();
      const json = JSON.stringify(ownAccounts);

      await turso.execute({
        sql: `INSERT INTO user_financial_settings (user_id, own_accounts, created_at, updated_at)
              VALUES (?, ?, ?, ?)
              ON CONFLICT(user_id) DO UPDATE SET
                own_accounts = excluded.own_accounts,
                updated_at = excluded.updated_at`,
        args: [userId, json, now, now],
      });

      res.json({ ownAccounts });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });
}
