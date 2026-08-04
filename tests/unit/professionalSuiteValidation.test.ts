/**
 * Unit test: server/routes/professionalSuiteRoutes.js — P1-2 Validation Layer (Group G2).
 *
 * Menguji skema validasi write-endpoint Professional Suite (wallets, goals,
 * subscriptions) sebagai komposisi MURNI validateBody(schema) — tanpa Express,
 * DB, atau SSE. Enum kanonik berasal dari src/types/index.ts
 * (WalletAccountType, SavingGoalStatus, SubscriptionCycle, SubscriptionStatus).
 *
 * Perilaku HTTP end-to-end (400 VALIDATION_ERROR) diuji terpisah di
 * e2e/crud-validation-g2.spec.ts.
 */
import { describe, it, expect } from 'vitest';
import { validateBody } from '../../server/lib/validation.js';
import {
  WALLET_TYPES,
  GOAL_STATUSES,
  SUBSCRIPTION_CYCLES,
  SUBSCRIPTION_STATUSES,
  WALLET_CREATE_SCHEMA,
  WALLET_UPDATE_SCHEMA,
  GOAL_CREATE_SCHEMA,
  GOAL_UPDATE_SCHEMA,
  SUBSCRIPTION_CREATE_SCHEMA,
  SUBSCRIPTION_UPDATE_SCHEMA,
  validateRawIsoDate,
  whenPresent,
} from '../../server/routes/professionalSuiteRoutes.js';
import { validateRequiredString } from '../../server/lib/validation.js';

describe('WALLET_CREATE_SCHEMA (POST /api/wallets)', () => {
  const validWallet = { name: 'BCA Utama', type: 'bank', institution: 'BCA', balance: 150000, color: '#8b5cf6' };

  it('payload khas client (zod walletSchema) lolos dan field tak dikenal dibuang', () => {
    const res = validateBody({ ...validWallet, hackerField: 'evil' }, WALLET_CREATE_SCHEMA);
    expect(res.ok).toBe(true);
    expect(res.value).toEqual(validWallet);
    expect(res.value).not.toHaveProperty('hackerField');
  });

  it('semua nilai WalletAccountType kanonik diterima', () => {
    expect(WALLET_TYPES).toEqual(['cash', 'bank', 'e-wallet', 'credit', 'investment', 'other']);
    for (const type of WALLET_TYPES) {
      const res = validateBody({ name: 'W', type }, WALLET_CREATE_SCHEMA);
      expect(res.ok, type).toBe(true);
    }
  });

  it('type di luar whitelist ditolak dengan daftar pilihan', () => {
    const res = validateBody({ name: 'W', type: 'crypto' }, WALLET_CREATE_SCHEMA);
    expect(res.ok).toBe(false);
    expect(res.error).toContain('type');
    expect(res.error).toContain('bank');
  });

  it('name wajib diisi; kosong/absen ditolak', () => {
    expect(validateBody({ type: 'bank' }, WALLET_CREATE_SCHEMA).ok).toBe(false);
    expect(validateBody({ name: '   ', type: 'bank' }, WALLET_CREATE_SCHEMA).ok).toBe(false);
  });

  it('balance negatif ditolak (range zod client: min 0); string numerik dikoersi', () => {
    expect(validateBody({ ...validWallet, balance: -1 }, WALLET_CREATE_SCHEMA).ok).toBe(false);
    const coerced = validateBody({ ...validWallet, balance: '25000' }, WALLET_CREATE_SCHEMA);
    expect(coerced.ok).toBe(true);
    expect(coerced.value.balance).toBe(25000);
  });

  it('field opsional absen memakai default route (institution/balance/color tidak muncul)', () => {
    const res = validateBody({ name: 'Dompet', type: 'cash' }, WALLET_CREATE_SCHEMA);
    expect(res.ok).toBe(true);
    expect(res.value).toEqual({ name: 'Dompet', type: 'cash' });
  });

  it('string terlalu panjang ditolak (name max 100)', () => {
    const res = validateBody({ ...validWallet, name: 'x'.repeat(101) }, WALLET_CREATE_SCHEMA);
    expect(res.ok).toBe(false);
  });
});

describe('WALLET_UPDATE_SCHEMA (PUT /api/wallets/:id — undefined-skip)', () => {
  it('field absen dilewati (tidak error, tidak muncul di hasil)', () => {
    const res = validateBody({ archived: true }, WALLET_UPDATE_SCHEMA);
    expect(res.ok).toBe(true);
    expect(res.value).toEqual({ archived: true });
  });

  it('body kosong {} valid (partial tanpa update — pola lama)', () => {
    const res = validateBody({}, WALLET_UPDATE_SCHEMA);
    expect(res.ok).toBe(true);
    expect(res.value).toEqual({});
  });

  it('field terkirim tetap divalidasi: type invalid & balance negatif ditolak', () => {
    const res = validateBody({ type: 'gold', balance: -5 }, WALLET_UPDATE_SCHEMA);
    expect(res.ok).toBe(false);
    expect(res.errors.length).toBe(2);
  });

  it('archived menerima boolean dan string boolean (koersi query/body)', () => {
    expect(validateBody({ archived: false }, WALLET_UPDATE_SCHEMA).value).toEqual({ archived: false });
    expect(validateBody({ archived: '1' }, WALLET_UPDATE_SCHEMA).value).toEqual({ archived: true });
    expect(validateBody({ archived: 'maybe' }, WALLET_UPDATE_SCHEMA).ok).toBe(false);
  });
});

describe('GOAL_CREATE_SCHEMA (POST /api/goals)', () => {
  const validGoal = { name: 'Dana Darurat', targetAmount: 10000000, currentAmount: 250000, targetDate: '2026-12-31', color: '#10b981' };

  it('payload khas client lolos', () => {
    const res = validateBody(validGoal, GOAL_CREATE_SCHEMA);
    expect(res.ok).toBe(true);
    expect(res.value.name).toBe('Dana Darurat');
    expect(res.value.targetAmount).toBe(10000000);
  });

  it('targetAmount wajib & tidak boleh negatif', () => {
    expect(validateBody({ name: 'G' }, GOAL_CREATE_SCHEMA).ok).toBe(false);
    expect(validateBody({ name: 'G', targetAmount: -100 }, GOAL_CREATE_SCHEMA).ok).toBe(false);
    expect(validateBody({ name: 'G', targetAmount: '50000' }, GOAL_CREATE_SCHEMA).ok).toBe(true);
  });

  it('targetDate gagal fail-closed untuk tanggal tak terparse; format mentah dipertahankan', () => {
    expect(validateBody({ ...validGoal, targetDate: 'bukan-tanggal' }, GOAL_CREATE_SCHEMA).ok).toBe(false);
    const res = validateBody(validGoal, GOAL_CREATE_SCHEMA);
    expect(res.ok).toBe(true);
    // PENTING: nilai tersimpan tetap 'YYYY-MM-DD' kiriman client (bukan
    // normalisasi toISOString) — kompatibilitas pembaca existing.
    expect(res.value.targetDate).toBe('2026-12-31');
  });

  it('status TIDAK ada di skema create (dihitung server) → dibuang diam-diam', () => {
    const res = validateBody({ ...validGoal, status: 'completed' }, GOAL_CREATE_SCHEMA);
    expect(res.ok).toBe(true);
    expect(res.value).not.toHaveProperty('status');
  });
});

describe('GOAL_UPDATE_SCHEMA (PUT /api/goals/:id)', () => {
  it('semua nilai SavingGoalStatus kanonik diterima saat update', () => {
    expect(GOAL_STATUSES).toEqual(['on-track', 'behind', 'completed']);
    for (const status of GOAL_STATUSES) {
      expect(validateBody({ status }, GOAL_UPDATE_SCHEMA).ok, status).toBe(true);
    }
  });

  it('status di luar whitelist ditolak', () => {
    const res = validateBody({ status: 'archived' }, GOAL_UPDATE_SCHEMA);
    expect(res.ok).toBe(false);
    expect(res.error).toContain('on-track');
  });

  it('undefined-skip: currentAmount absen tidak error, terkirim negatif ditolak', () => {
    expect(validateBody({ name: 'Baru' }, GOAL_UPDATE_SCHEMA).ok).toBe(true);
    expect(validateBody({ currentAmount: -10 }, GOAL_UPDATE_SCHEMA).ok).toBe(false);
  });
});

describe('SUBSCRIPTION_CREATE_SCHEMA (POST /api/subscriptions)', () => {
  const validSub = {
    name: 'NETFLIX', amount: 186000, cycle: 'monthly',
    categoryId: 'langganan', categoryName: 'Langganan',
    nextBillingDate: '2026-09-01', status: 'active',
  };

  it('payload khas client (form default) lolos', () => {
    const res = validateBody(validSub, SUBSCRIPTION_CREATE_SCHEMA);
    expect(res.ok).toBe(true);
    expect(res.value).toEqual(validSub);
  });

  it('semua SubscriptionCycle kanonik diterima; yang lain ditolak', () => {
    expect(SUBSCRIPTION_CYCLES).toEqual(['weekly', 'monthly', 'quarterly', 'yearly']);
    for (const cycle of SUBSCRIPTION_CYCLES) {
      expect(validateBody({ name: 'S', amount: 1, cycle }, SUBSCRIPTION_CREATE_SCHEMA).ok, cycle).toBe(true);
    }
    expect(validateBody({ name: 'S', amount: 1, cycle: 'daily' }, SUBSCRIPTION_CREATE_SCHEMA).ok).toBe(false);
  });

  it('amount wajib & tidak boleh negatif; NaN/Infinity ditolak fail-closed', () => {
    expect(validateBody({ name: 'S', cycle: 'monthly' }, SUBSCRIPTION_CREATE_SCHEMA).ok).toBe(false);
    expect(validateBody({ ...validSub, amount: -1 }, SUBSCRIPTION_CREATE_SCHEMA).ok).toBe(false);
    expect(validateBody({ ...validSub, amount: Number.NaN }, SUBSCRIPTION_CREATE_SCHEMA).ok).toBe(false);
  });

  it('status opsional: absen ok (default route "active"), whitelist ditegakkan', () => {
    expect(SUBSCRIPTION_STATUSES).toEqual(['active', 'paused', 'cancelled']);
    const noStatus = validateBody({ name: 'S', amount: 1, cycle: 'monthly' }, SUBSCRIPTION_CREATE_SCHEMA);
    expect(noStatus.ok).toBe(true);
    expect(noStatus.value).not.toHaveProperty('status');
    expect(validateBody({ ...validSub, status: 'expired' }, SUBSCRIPTION_CREATE_SCHEMA).ok).toBe(false);
  });

  it('deteksi subscription partial (tanpa categoryId) tetap lolos — backward compatible', () => {
    const detected = { name: 'SPOTIFY', amount: 54900, cycle: 'monthly', categoryName: 'Langganan', status: 'active' };
    const res = validateBody(detected, SUBSCRIPTION_CREATE_SCHEMA);
    expect(res.ok).toBe(true);
    expect(res.value).toEqual(detected);
  });
});

describe('SUBSCRIPTION_UPDATE_SCHEMA (PUT /api/subscriptions/:id)', () => {
  it('undefined-skip parsial + nextBillingDate tervalidasi fail-closed', () => {
    expect(validateBody({ amount: 99000 }, SUBSCRIPTION_UPDATE_SCHEMA).ok).toBe(true);
    expect(validateBody({ nextBillingDate: '2026-13-45' }, SUBSCRIPTION_UPDATE_SCHEMA).ok).toBe(false);
    const raw = validateBody({ nextBillingDate: '2026-09-30' }, SUBSCRIPTION_UPDATE_SCHEMA);
    expect(raw.ok).toBe(true);
    expect(raw.value.nextBillingDate).toBe('2026-09-30');
  });

  it('cycle/status invalid ditolak dengan error menyebut field', () => {
    const res = validateBody({ cycle: 'hourly', status: 'done' }, SUBSCRIPTION_UPDATE_SCHEMA);
    expect(res.ok).toBe(false);
    expect(res.errors.length).toBe(2);
  });
});

describe('helper: validateRawIsoDate & whenPresent', () => {
  it('validateRawIsoDate mempertahankan string mentah, menolak invalid', () => {
    expect(validateRawIsoDate('2026-08-04', { field: 'd' })).toEqual({ ok: true, value: '2026-08-04' });
    expect(validateRawIsoDate('  2026-08-04  ', { field: 'd' })).toEqual({ ok: true, value: '2026-08-04' });
    expect(validateRawIsoDate('junk', { field: 'd' }).ok).toBe(false);
    expect(validateRawIsoDate(undefined, { field: 'd' })).toEqual({ ok: true, value: undefined });
  });

  it('whenPresent: undefined dilewati, nilai lain diteruskan ke validator', () => {
    const wrapped = whenPresent(validateRequiredString);
    expect(wrapped(undefined, { field: 'name' })).toEqual({ ok: true, value: undefined });
    expect(wrapped('  ok  ', { field: 'name' })).toEqual({ ok: true, value: 'ok' });
    expect(wrapped('', { field: 'name' }).ok).toBe(false);
  });
});
