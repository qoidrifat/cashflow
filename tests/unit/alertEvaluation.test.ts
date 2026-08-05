/**
 * Unit test: evaluasi alert (server/services/metricsService.js) — Sprint 2.
 *
 * Mencakup:
 * 1. ALERT_DEFAULTS valid (shape lengkap + rule baru `ai_cost_monthly` dengan
 *    window 30 hari = 43200 menit).
 * 2. evaluateCondition (murni, di-export) — gt/lt/eq/boundary/unknown.
 * 3. computeAlerts dengan Turso MOCK — branch `ai_cost_monthly` (SUM
 *    estimated_cost_idr dalam window rule): trigger, tidak-trigger, tanpa data,
 *    dan branch lama `estimated_cost_idr` tetap berfungsi.
 *
 * Pola mock: getTurso dari server/lib/turso.js diganti client palsu dengan
 * execute() yang mengembalikan baris sesuai SQL (pola fake-DB ringan).
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { ALERT_DEFAULTS } from '../../server/config/metricsConfig.js';
import metricsService, { evaluateCondition } from '../../server/services/metricsService.js';
import { getTurso } from '../../server/lib/turso.js';
import { notifyTriggeredAlerts } from '../../server/services/alertNotifier.js';

vi.mock('../../server/lib/turso.js', () => ({ getTurso: vi.fn() }));
vi.mock('../../server/services/alertNotifier.js', () => ({
  notifyTriggeredAlerts: vi.fn().mockResolvedValue(undefined),
}));

const RULE_MONTHLY = {
  id: 'alert_ai_cost_monthly',
  name: 'ai_cost_monthly',
  metric_name: 'ai_cost_monthly',
  condition: 'gt',
  threshold: 100000,
  window_minutes: 30 * 24 * 60,
  is_active: 1,
};

/** Fake Turso client: execute() memilih hasil berdasar isi SQL. */
function mockClient(rules: unknown[], costRows: Array<Record<string, unknown>>) {
  const execute = vi.fn(async ({ sql }: { sql: string }) => {
    if (sql.includes('FROM alert_rules')) return { rows: rules };
    if (sql.includes('UPDATE alert_rules')) return { rows: [] };
    if (sql.includes('FROM ai_usage_metrics')) return { rows: costRows };
    return { rows: [] };
  });
  return { execute };
}

describe('ALERT_DEFAULTS (metricsConfig)', () => {
  it('memuat rule ai_cost_monthly dengan window 30 hari', () => {
    const monthly = ALERT_DEFAULTS.find((r) => r.name === 'ai_cost_monthly');
    expect(monthly).toBeDefined();
    expect(monthly?.metric_name).toBe('ai_cost_monthly');
    expect(monthly?.condition).toBe('gt');
    expect(monthly?.window_minutes).toBe(30 * 24 * 60);
    expect(typeof monthly?.threshold).toBe('number');
  });

  it('semua rule punya shape lengkap & valid', () => {
    expect(ALERT_DEFAULTS.length).toBeGreaterThanOrEqual(5);
    for (const r of ALERT_DEFAULTS) {
      expect(typeof r.name).toBe('string');
      expect(typeof r.metric_name).toBe('string');
      expect(['gt', 'lt', 'eq']).toContain(r.condition);
      expect(typeof r.threshold).toBe('number');
      expect(Number(r.window_minutes) > 0).toBe(true);
    }
  });
});

describe('evaluateCondition (murni)', () => {
  it('gt: value > threshold (boundary = tidak trigger)', () => {
    expect(evaluateCondition(110000, 'gt', 100000)).toBe(true);
    expect(evaluateCondition(100000, 'gt', 100000)).toBe(false);
    expect(evaluateCondition(90000, 'gt', 100000)).toBe(false);
  });

  it('lt', () => {
    expect(evaluateCondition(0.4, 'lt', 0.5)).toBe(true);
    expect(evaluateCondition(0.5, 'lt', 0.5)).toBe(false);
  });

  it('eq', () => {
    expect(evaluateCondition(42, 'eq', 42)).toBe(true);
    expect(evaluateCondition(41, 'eq', 42)).toBe(false);
  });

  it('condition tak dikenal / kosong → false (fail-safe)', () => {
    expect(evaluateCondition(100, 'lte', 100)).toBe(false);
    expect(evaluateCondition(100, '', 100)).toBe(false);
    expect(evaluateCondition(100, undefined, 100)).toBe(false);
  });
});

describe('computeAlerts — branch ai_cost_monthly (Turso mock)', () => {
  beforeEach(() => {
    vi.mocked(notifyTriggeredAlerts).mockClear();
  });

  afterEach(() => {
    vi.mocked(getTurso).mockReset();
  });

  it('SUM biaya 30 hari > threshold → status triggered + notify', async () => {
    vi.mocked(getTurso).mockReturnValue(mockClient(
      [RULE_MONTHLY],
      [{ estimated_cost_idr: 60000 }, { estimated_cost_idr: 50000 }],
    ) as never);
    const results = await metricsService.runAlertEvaluation();
    expect(results).toHaveLength(1);
    expect(results[0].name).toBe('ai_cost_monthly');
    expect(results[0].metricName).toBe('ai_cost_monthly');
    expect(results[0].status).toBe('triggered');
    expect(results[0].currentValue).toBe(110000);
    expect(results[0].windowMinutes).toBe(30 * 24 * 60);
    expect(notifyTriggeredAlerts).toHaveBeenCalledTimes(1);
  });

  it('SUM biaya 30 hari ≤ threshold → status ok, tanpa notify', async () => {
    vi.mocked(getTurso).mockReturnValue(mockClient(
      [RULE_MONTHLY],
      [{ estimated_cost_idr: 40000 }, { estimated_cost_idr: 50000 }],
    ) as never);
    const results = await metricsService.runAlertEvaluation();
    expect(results[0].status).toBe('ok');
    expect(results[0].currentValue).toBe(90000);
    expect(notifyTriggeredAlerts).not.toHaveBeenCalled();
  });

  it('tanpa data di window → currentValue 0, tidak trigger', async () => {
    vi.mocked(getTurso).mockReturnValue(mockClient([RULE_MONTHLY], []) as never);
    const results = await metricsService.runAlertEvaluation();
    expect(results[0].currentValue).toBe(0);
    expect(results[0].status).toBe('ok');
  });

  it('branch lama estimated_cost_idr tetap berfungsi', async () => {
    vi.mocked(getTurso).mockReturnValue(mockClient(
      [{
        id: 'alert_ai_cost_daily',
        name: 'ai_cost_daily',
        metric_name: 'estimated_cost_idr',
        condition: 'gt',
        threshold: 50000,
        window_minutes: 1440,
        is_active: 1,
      }],
      [{ estimated_cost_idr: 60000 }],
    ) as never);
    const results = await metricsService.runAlertEvaluation();
    expect(results[0].metricName).toBe('estimated_cost_idr');
    expect(results[0].status).toBe('triggered');
    expect(results[0].currentValue).toBe(60000);
  });
});
