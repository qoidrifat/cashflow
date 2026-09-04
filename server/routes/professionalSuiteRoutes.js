/**
 * Professional Suite Routes for CashFlow
 * (Wallet Accounts, Saving Goals, Subscriptions)
 *
 * P1-2 (Validation Layer): semua write-endpoint divalidasi via
 * server/lib/validation.js. Gagal validasi → 400 VALIDATION_ERROR
 * (sendValidationError), JANGAN PERNAH 401. Bentuk respons SUKSES tidak
 * berubah (contract-pinned). Enum dirujuk dari nilai kanonik frontend
 * (src/types/index.ts: WalletAccountType, SavingGoalStatus,
 * SubscriptionCycle, SubscriptionStatus) — satu-satunya caller endpoint ini
 * adalah ProfessionalSuitePage via professionalSuiteService.ts, sehingga
 * setiap request sah hari ini tetap lolos.
 */
import { getTurso } from '../lib/turso.js';
import { requireAuth } from '../middleware/authMiddleware.js';
import { notifyUser } from '../lib/sse.js';
import { publicProviderList, isProviderEnabled, matchProviderByInstitutionOrName } from '../lib/providerCatalog.js';
import { isConstraintError } from '../lib/retry.js';
import {
  validateBody,
  sendValidationError,
  validateRequiredString,
  validateOptionalString,
  validateEnum,
  validateAmount,
  validateBoolean,
  validateIsoDate,
  validateId,
} from '../lib/validation.js';
import crypto from 'node:crypto';

// ================= Enum kanonik (sumber: src/types/index.ts) =================

/** WalletAccountType — dipakai zod walletSchema di ProfessionalSuitePage. */
export const WALLET_TYPES = ['cash', 'bank', 'e-wallet', 'credit', 'investment', 'other'];

/** SavingGoalStatus — status 'on-track'/'completed' juga dihitung server saat POST. */
export const GOAL_STATUSES = ['on-track', 'behind', 'completed'];

/** SubscriptionCycle — detectSubscriptions hanya menghasilkan 'monthly'. */
export const SUBSCRIPTION_CYCLES = ['weekly', 'monthly', 'quarterly', 'yearly'];

/** SubscriptionStatus — default POST 'active' (perilaku lama dipertahankan). */
export const SUBSCRIPTION_STATUSES = ['active', 'paused', 'cancelled'];

/**
 * Tanggal ISO fail-closed tetapi MENGEMBALIKAN string mentah (di-trim), bukan
 * hasil normalisasi toISOString() — format tersimpan ('YYYY-MM-DD' kiriman
 * client) tidak boleh berubah agar pembaca existing tetap kompatibel.
 */
export function validateRawIsoDate(value, opts) {
  const check = validateIsoDate(value, opts);
  if (!check.ok || check.value === undefined) return check;
  return { ok: true, value: typeof value === 'string' ? value.trim() : check.value };
}

/**
 * Wrapper pola partial PUT: field TIDAK dikirim (undefined) → dilewati
 * (undefined-skip dipertahankan); field dikirim divalidasi seperti biasa.
 */
export const whenPresent = (validator) => (value, opts) =>
  (value === undefined ? { ok: true, value: undefined } : validator(value, opts));

// ================= Skema validasi (di-export untuk unit test) =================

export const WALLET_CREATE_SCHEMA = {
  name: { validate: validateRequiredString, options: { field: 'name', max: 100 } },
  type: { validate: validateEnum, options: { field: 'type', values: WALLET_TYPES, required: true } },
  institution: { validate: validateOptionalString, options: { field: 'institution', max: 100 } },
  // zod client: balance min(0) → negatif ditolak (tidak ada caller sah negatif).
  balance: { validate: validateAmount, options: { field: 'balance' } },
  color: { validate: validateOptionalString, options: { field: 'color', max: 50 } },
  // P2.5 account-based ledger: saldo awal per akun. allowNegative:true —
  // saldo awal credit card memang bisa negatif; tidak sama dengan `balance`
  // (snapshot min 0). NULL = belum dikonfigurasi → currentBalance unknown.
  openingBalance: { validate: validateAmount, options: { field: 'openingBalance', allowNegative: true } },
  openingBalanceDate: { validate: validateRawIsoDate, options: { field: 'openingBalanceDate' } },
  currency: { validate: validateOptionalString, options: { field: 'currency', max: 8 } },
  // P2.9 §41 — idempotensi aktivasi akun dari kandidat: bila `activation:true`
  // dan akun dengan nama sama sudah ada (case-insensitive, per user), POST
  // mengembalikan id existing — TANPA membuat duplikat (double-click/retry).
  activation: { validate: whenPresent(validateBoolean), options: { field: 'activation' } },
  // P0.11 — kode provider dari katalog (hubungkan wallet ke provider; diverifikasi
  // server terhadap katalog → provider tak dikenal ditolak fail-closed).
  providerCode: { validate: validateOptionalString, options: { field: 'providerCode', max: 60 } },
};

export const WALLET_UPDATE_SCHEMA = {
  name: { validate: whenPresent(validateRequiredString), options: { field: 'name', max: 100 } },
  type: { validate: whenPresent(validateEnum), options: { field: 'type', values: WALLET_TYPES } },
  institution: { validate: whenPresent(validateOptionalString), options: { field: 'institution', max: 100 } },
  balance: { validate: whenPresent(validateAmount), options: { field: 'balance' } },
  color: { validate: whenPresent(validateOptionalString), options: { field: 'color', max: 50 } },
  archived: { validate: whenPresent(validateBoolean), options: { field: 'archived' } },
  openingBalance: { validate: whenPresent(validateAmount), options: { field: 'openingBalance', allowNegative: true } },
  openingBalanceDate: { validate: whenPresent(validateRawIsoDate), options: { field: 'openingBalanceDate' } },
  currency: { validate: whenPresent(validateOptionalString), options: { field: 'currency', max: 8 } },
  providerCode: { validate: whenPresent(validateOptionalString), options: { field: 'providerCode', max: 60 } },
};

export const GOAL_CREATE_SCHEMA = {
  name: { validate: validateRequiredString, options: { field: 'name', max: 100 } },
  // zod client: targetAmount positive — dipakai menghitung status saat create.
  targetAmount: { validate: validateAmount, options: { field: 'targetAmount', required: true } },
  currentAmount: { validate: validateAmount, options: { field: 'currentAmount' } },
  targetDate: { validate: validateRawIsoDate, options: { field: 'targetDate' } },
  color: { validate: validateOptionalString, options: { field: 'color', max: 50 } },
};

export const GOAL_UPDATE_SCHEMA = {
  name: { validate: whenPresent(validateRequiredString), options: { field: 'name', max: 100 } },
  targetAmount: { validate: whenPresent(validateAmount), options: { field: 'targetAmount' } },
  currentAmount: { validate: whenPresent(validateAmount), options: { field: 'currentAmount' } },
  targetDate: { validate: whenPresent(validateRawIsoDate), options: { field: 'targetDate' } },
  color: { validate: whenPresent(validateOptionalString), options: { field: 'color', max: 50 } },
  status: { validate: whenPresent(validateEnum), options: { field: 'status', values: GOAL_STATUSES } },
};

export const SUBSCRIPTION_CREATE_SCHEMA = {
  name: { validate: validateRequiredString, options: { field: 'name', max: 100 } },
  // zod client: amount positive.
  amount: { validate: validateAmount, options: { field: 'amount', required: true } },
  cycle: { validate: validateEnum, options: { field: 'cycle', values: SUBSCRIPTION_CYCLES, required: true } },
  // categoryId/categoryName opsional: detectSubscriptions mengirim partial tanpa categoryId.
  categoryId: { validate: validateOptionalString, options: { field: 'categoryId', max: 100 } },
  categoryName: { validate: validateOptionalString, options: { field: 'categoryName', max: 100 } },
  nextBillingDate: { validate: validateRawIsoDate, options: { field: 'nextBillingDate' } },
  status: { validate: validateEnum, options: { field: 'status', values: SUBSCRIPTION_STATUSES } },
};

export const SUBSCRIPTION_UPDATE_SCHEMA = {
  name: { validate: whenPresent(validateRequiredString), options: { field: 'name', max: 100 } },
  amount: { validate: whenPresent(validateAmount), options: { field: 'amount' } },
  cycle: { validate: whenPresent(validateEnum), options: { field: 'cycle', values: SUBSCRIPTION_CYCLES } },
  categoryId: { validate: whenPresent(validateOptionalString), options: { field: 'categoryId', max: 100 } },
  categoryName: { validate: whenPresent(validateOptionalString), options: { field: 'categoryName', max: 100 } },
  nextBillingDate: { validate: whenPresent(validateRawIsoDate), options: { field: 'nextBillingDate' } },
  status: { validate: whenPresent(validateEnum), options: { field: 'status', values: SUBSCRIPTION_STATUSES } },
};

/** Tolak id path param tak valid dengan 400 VALIDATION_ERROR (bukan 401/500). */
function rejectInvalidId(res, rawId) {
  const check = validateId(rawId, { field: 'id' });
  if (!check.ok) {
    sendValidationError(res, check);
    return false;
  }
  return true;
}

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
      // P0.11 — fallback derived: bila provider_code belum terpasang, cocokkan
      // institution/name ke katalog (tanpa mutasi DB). Server tetap berdaulat.
      const rows = result.rows.map((row) => {
        const pc = row.provider_code || matchProviderByInstitutionOrName(row);
        return pc ? { ...row, provider_code: pc } : row;
      });
      res.json(rows);
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  // P0.11 — Provider Catalog: daftar institusi yang didukung untuk onboarding.
  // Hanya field publik; TIDAK ada secret/credential. Wajib authenticated.
  app.get('/api/wallet-providers', requireAuth, (req, res) => {
    res.json(publicProviderList());
  });

  app.post('/api/wallets', requireAuth, async (req, res) => {
    try {
      const turso = getTurso();
      const userId = req.user.id;
      const id = crypto.randomUUID();

      // P1-2: validasi body (400 VALIDATION_ERROR bila gagal); field tak
      // dikenal dibuang (anti mass-assignment).
      const result = validateBody(req.body, WALLET_CREATE_SCHEMA);
      if (!result.ok) return sendValidationError(res, result);
      const {
        name,
        type,
        institution = '',
        balance = 0,
        color = '#8b5cf6',
        openingBalance = null,
        openingBalanceDate = null,
        currency = 'IDR',
        activation = false,
        providerCode = null,
      } = result.value;
      // P0.11 — provider tak dikenal DITOLAK fail-closed. Provider yang belum
      // punya integrasi otomatis tetap boleh dibuat (manual) — hanya kode yang
      // bukan dari katalog yang ditolak, agar tidak ada provider nazir arbitrary.
      if (providerCode && !isProviderEnabled(providerCode)) {
        return res.status(400).json({ error: `Provider "${providerCode}" tidak dikenal.`, errorCode: 'VALIDATION_ERROR' });
      }
      const now = new Date().toISOString();

      // P2.9 §41 — aktivasi idempoten: nama sama + user sama → akun existing
      // dikembalikan (tidak ada duplikat, tidak ada double audit).
      if (activation === true) {
        const existing = await turso.execute({
          sql: `SELECT id FROM wallet_accounts WHERE user_id = ? AND LOWER(name) = LOWER(?) AND archived = 0 LIMIT 1`,
          args: [userId, name],
        });
        if (existing.rows?.[0]) {
          res.json({ id: String(existing.rows[0].id), idempotent: true });
          return;
        }
      }

      try {
        await turso.execute({
          sql: `INSERT INTO wallet_accounts (id, user_id, name, type, institution, balance, color, archived, opening_balance, opening_balance_date, currency, created_at, updated_at, provider_code)
                VALUES (?, ?, ?, ?, ?, ?, ?, 0, ?, ?, ?, ?, ?, ?)`,
          args: [
            id,
            userId,
            name,
            type,
            institution,
            Number(balance),
            color,
            openingBalance === null ? null : Number(openingBalance),
            openingBalanceDate || null,
            String(currency || 'IDR').toUpperCase(),
            now,
            now,
            providerCode,
          ],
        });
      } catch (err) {
        // Migration 0012 (idx_wallets_user_name_active): dua request activation
        // simultan bisa sama-sama lolos SELECT di atas → INSERT kedua kena
        // UNIQUE. Idempoten: kembalikan id existing (pola sama dengan blok
        // SELECT di atas), BUKAN 500.
        if (isConstraintError(String(err?.message || err))) {
          const existing = await turso.execute({
            sql: `SELECT id FROM wallet_accounts WHERE user_id = ? AND LOWER(name) = LOWER(?) AND archived = 0 LIMIT 1`,
            args: [userId, name],
          });
          if (existing.rows?.[0]) {
            res.json({ id: String(existing.rows[0].id), idempotent: true });
            return;
          }
        }
        throw err;
      }

      notifyUser(userId, 'wallet:changed', { id });
      res.json({ id });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  app.put('/api/wallets/:id', requireAuth, async (req, res) => {
    try {
      if (!rejectInvalidId(res, req.params.id)) return;
      const turso = getTurso();
      const userId = req.user.id;
      const { id } = req.params;

      // P1-2: partial update — field undefined dilewati (pola lama), field
      // terkirim divalidasi; gagal → 400 VALIDATION_ERROR.
      const result = validateBody(req.body, WALLET_UPDATE_SCHEMA);
      if (!result.ok) return sendValidationError(res, result);
      const data = result.value;

      const updates = [];
      const args = [];
      if (data.name !== undefined) { updates.push('name = ?'); args.push(data.name); }
      if (data.type !== undefined) { updates.push('type = ?'); args.push(data.type); }
      if (data.institution !== undefined) { updates.push('institution = ?'); args.push(data.institution); }
      if (data.balance !== undefined) { updates.push('balance = ?'); args.push(Number(data.balance)); }
      if (data.color !== undefined) { updates.push('color = ?'); args.push(data.color); }
      if (data.archived !== undefined) { updates.push('archived = ?'); args.push(data.archived ? 1 : 0); }
      // P2.5: saldo awal (nullable — null/undefined = belum dikonfigurasi).
      if (data.openingBalance !== undefined) { updates.push('opening_balance = ?'); args.push(data.openingBalance === null ? null : Number(data.openingBalance)); }
      if (data.openingBalanceDate !== undefined) { updates.push('opening_balance_date = ?'); args.push(data.openingBalanceDate || null); }
      if (data.currency !== undefined) { updates.push('currency = ?'); args.push(String(data.currency || 'IDR').toUpperCase()); }
      // P0.11 — provider_code hanya boleh di-update ke nilai dari katalog.
      if (data.providerCode !== undefined) {
        if (data.providerCode === null || !isProviderEnabled(data.providerCode)) return res.status(400).json({ error: `Provider "${data.providerCode}" tidak dikenal.`, errorCode: 'VALIDATION_ERROR' });
        updates.push('provider_code = ?'); args.push(data.providerCode);
      }

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
      if (!rejectInvalidId(res, req.params.id)) return;
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

      // P1-2: validasi body (400 VALIDATION_ERROR bila gagal).
      const result = validateBody(req.body, GOAL_CREATE_SCHEMA);
      if (!result.ok) return sendValidationError(res, result);
      const { name, targetAmount, currentAmount = 0, targetDate, color = '#10b981' } = result.value;
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
      if (!rejectInvalidId(res, req.params.id)) return;
      const turso = getTurso();
      const userId = req.user.id;
      const { id } = req.params;

      // P1-2: partial update tervalidasi (undefined-skip dipertahankan).
      const result = validateBody(req.body, GOAL_UPDATE_SCHEMA);
      if (!result.ok) return sendValidationError(res, result);
      const data = result.value;

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
      if (!rejectInvalidId(res, req.params.id)) return;
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

      // P1-2: validasi body (400 VALIDATION_ERROR bila gagal). status default
      // 'active' dipertahankan lewat destructure, bukan schema.
      const result = validateBody(req.body, SUBSCRIPTION_CREATE_SCHEMA);
      if (!result.ok) return sendValidationError(res, result);
      const { name, amount, cycle, categoryId, categoryName, nextBillingDate, status = 'active' } = result.value;
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
      if (!rejectInvalidId(res, req.params.id)) return;
      const turso = getTurso();
      const userId = req.user.id;
      const { id } = req.params;

      // P1-2: partial update tervalidasi (undefined-skip dipertahankan).
      const result = validateBody(req.body, SUBSCRIPTION_UPDATE_SCHEMA);
      if (!result.ok) return sendValidationError(res, result);
      const data = result.value;

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
      if (!rejectInvalidId(res, req.params.id)) return;
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
