/**
 * Unit tests — server/lib/fraudEngine.js (L1 rule engine, pure/deterministic).
 * Sprint 1 (Core Product): Fraud Detection.
 */
import { describe, expect, it } from 'vitest';
import {
  evaluateFraudRules,
  computeRuleRiskScore,
  getFraudFlagLabel,
  getHighestSeverity,
  summarizeFlags,
  DEFAULT_THRESHOLDS,
} from '../../server/lib/fraudEngine.js';

const baseTx = {
  id: 'tx-1',
  type: 'expense',
  amount: 50000,
  merchant: 'Indomaret',
  categoryId: 'cat-1',
  gmailMessageId: null,
};

const emptyAggregates = {
  gmailMessageIdExists: false,
  recentDuplicateCount: 0,
  merchantCount24h: 0,
  merchantSeen: true,
  p99Amount: 0,
  medianAmount: 0,
  categoryType: null,
};

describe('evaluateFraudRules', () => {
  it('tidak menghasilkan flag untuk transaksi normal tanpa agregat mencurigakan', () => {
    const flags = evaluateFraudRules({ transaction: baseTx, aggregates: emptyAggregates });
    expect(flags).toEqual([]);
  });

  it('menandai DUPLIKAT critical bila gmail_message_id sudah tercatat', () => {
    const flags = evaluateFraudRules({
      transaction: { ...baseTx, gmailMessageId: 'msg-123' },
      aggregates: { ...emptyAggregates, gmailMessageIdExists: true },
    });
    const dup = flags.find((f) => f.rule === 'duplicate');
    expect(dup).toBeDefined();
    expect(dup?.severity).toBe('critical');
  });

  it('menandai DUPLIKAT high bila nominal+merchant sama dalam jendela 7 hari', () => {
    const flags = evaluateFraudRules({
      transaction: baseTx,
      aggregates: { ...emptyAggregates, recentDuplicateCount: 1 },
    });
    const dup = flags.find((f) => f.rule === 'duplicate');
    expect(dup).toBeDefined();
    expect(dup?.severity).toBe('high');
  });

  it('menandai VELOCITY medium bila transaksi per merchant melebihi ambang 24 jam', () => {
    const flags = evaluateFraudRules({
      transaction: baseTx,
      aggregates: { ...emptyAggregates, merchantCount24h: DEFAULT_THRESHOLDS.velocityMaxPerMerchant + 1 },
    });
    const vel = flags.find((f) => f.rule === 'velocity');
    expect(vel).toBeDefined();
    expect(vel?.severity).toBe('medium');
  });

  it('tidak menandai velocity bila masih di bawah ambang', () => {
    const flags = evaluateFraudRules({
      transaction: baseTx,
      aggregates: { ...emptyAggregates, merchantCount24h: DEFAULT_THRESHOLDS.velocityMaxPerMerchant },
    });
    expect(flags.find((f) => f.rule === 'velocity')).toBeUndefined();
  });

  it('menandai AMOUNT OUTLIER high bila nominal > 3× p99', () => {
    const flags = evaluateFraudRules({
      transaction: { ...baseTx, amount: 1000000 },
      aggregates: { ...emptyAggregates, p99Amount: 300000 },
    });
    const outlier = flags.find((f) => f.rule === 'amount_outlier');
    expect(outlier).toBeDefined();
    expect(outlier?.severity).toBe('high');
  });

  it('menandai AMOUNT OUTLIER medium bila nominal > 1.5× p99', () => {
    const flags = evaluateFraudRules({
      transaction: { ...baseTx, amount: 500000 },
      aggregates: { ...emptyAggregates, p99Amount: 300000 },
    });
    const outlier = flags.find((f) => f.rule === 'amount_outlier');
    expect(outlier).toBeDefined();
    expect(outlier?.severity).toBe('medium');
  });

  it('menandai NEW MERCHANT medium bila merchant baru + nominal > 2× median', () => {
    const flags = evaluateFraudRules({
      transaction: { ...baseTx, merchant: 'Toko Baru Xyz' },
      aggregates: { ...emptyAggregates, merchantSeen: false, medianAmount: 20000 },
    });
    const nm = flags.find((f) => f.rule === 'new_merchant');
    expect(nm).toBeDefined();
    expect(nm?.severity).toBe('medium');
  });

  it('tidak menandai new merchant bila nominal di bawah ambang median', () => {
    const flags = evaluateFraudRules({
      transaction: { ...baseTx, merchant: 'Toko Baru Xyz', amount: 10000 },
      aggregates: { ...emptyAggregates, merchantSeen: false, medianAmount: 20000 },
    });
    expect(flags.find((f) => f.rule === 'new_merchant')).toBeUndefined();
  });

  it('menandai CATEGORY ANOMALY low bila expense di kategori income', () => {
    const flags = evaluateFraudRules({
      transaction: baseTx,
      aggregates: { ...emptyAggregates, categoryType: 'income' },
    });
    const cat = flags.find((f) => f.rule === 'category_anomaly');
    expect(cat).toBeDefined();
    expect(cat?.severity).toBe('low');
  });

  it('menghormati override thresholds (velocity max lebih rendah)', () => {
    const flags = evaluateFraudRules({
      transaction: baseTx,
      aggregates: { ...emptyAggregates, merchantCount24h: 3 },
      thresholds: { velocityMaxPerMerchant: 2 },
    });
    expect(flags.find((f) => f.rule === 'velocity')).toBeDefined();
  });

  it('menghasilkan BANYAK flag sekaligus bila beberapa rule terpukul', () => {
    const flags = evaluateFraudRules({
      transaction: { ...baseTx, amount: 1000000, merchant: 'Toko Baru' },
      aggregates: {
        gmailMessageIdExists: false,
        recentDuplicateCount: 1,
        merchantCount24h: 7,
        merchantSeen: false,
        p99Amount: 200000,
        medianAmount: 50000,
        categoryType: 'income',
      },
    });
    expect(flags.length).toBeGreaterThanOrEqual(4);
    expect(flags.map((f) => f.rule)).toContain('duplicate');
    expect(flags.map((f) => f.rule)).toContain('velocity');
    expect(flags.map((f) => f.rule)).toContain('amount_outlier');
    expect(flags.map((f) => f.rule)).toContain('new_merchant');
  });
});

describe('computeRuleRiskScore / getFraudFlagLabel / summarizeFlags', () => {
  it('risk score 0 bila tanpa flag', () => {
    expect(computeRuleRiskScore([])).toBe(0);
  });

  it('risk score naik sesuai severity tertinggi', () => {
    const low = computeRuleRiskScore([{ rule: 'category_anomaly', severity: 'low' }]);
    const critical = computeRuleRiskScore([{ rule: 'duplicate', severity: 'critical' }]);
    expect(critical).toBeGreaterThan(low);
    expect(critical).toBe(0.9);
  });

  it('label review untuk severity high/critical, flagged untuk medium/low', () => {
    expect(getFraudFlagLabel([{ severity: 'medium' }])).toBe('flagged');
    expect(getFraudFlagLabel([{ severity: 'high' }])).toBe('review');
    expect(getFraudFlagLabel([{ severity: 'critical' }])).toBe('review');
  });

  it('summarizeFlags menghasilkan label Bahasa Indonesia yang dipisah koma', () => {
    const text = summarizeFlags([
      { rule: 'duplicate', severity: 'high' },
      { rule: 'amount_outlier', severity: 'medium' },
    ]);
    expect(text).toContain('Duplikat');
    expect(text).toContain('Nominal tidak wajar');
  });

  it('getHighestSeverity mengambil nilai tertinggi', () => {
    expect(getHighestSeverity([
      { rule: 'a', severity: 'low' },
      { rule: 'b', severity: 'critical' },
      { rule: 'c', severity: 'medium' },
    ])).toBe('critical');
  });
});
