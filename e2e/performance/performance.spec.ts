/**
 * E2E: Performance budget (P3.13 — dari PERFORMANCE_TEST_PLAN.md).
 *
 * Mengukur page load, API latency (p50/p95), dan request count terhadap budget
 * di performance.config.ts. Tag: @perf — TIDAK dijalankan di suite default
 * (`npm run test:e2e`); jalankan eksplisit:
 *
 *   npm run test:e2e:perf
 *
 * Catatan anti-flaky:
 *  - Budget dev sengaja longgar (dev build + machine noise). CI bisa override
 *    via env PERF_BUDGET_* (lihat config).
 *  - API latency dihitung dari 3 sample → p50/p95 (median, bukan single run).
 *  - Hasil ditulis ke test-results/perf/perf-*.json untuk trend CI.
 */
import { test, expect } from 'playwright/test';
import { mintSessionCookie, cleanupTestSessions } from '../helpers/mintSession';
import {
  PERF_BUDGETS,
  CORE_API_ENDPOINTS,
  measurePageTiming,
  measureApiLatency,
  writePerfReport,
  type PageTiming,
} from './performance.config';

test.describe('Performance budget @perf', () => {
  test.setTimeout(180_000);
  let session: { cookie: string };

  test.beforeAll(async () => {
    session = await mintSessionCookie();
  });

  test.afterAll(async () => {
    await cleanupTestSessions();
  });

  test('page load budget: Dashboard, Transactions, Gmail Sync (domContentLoaded + requests)', async ({ browser }) => {
    const report: { budgets: typeof PERF_BUDGETS; pages: PageTiming[] } = { budgets: PERF_BUDGETS, pages: [] };
    for (const path of ['/dashboard', '/transactions', '/gmail-sync']) {
      const context = await browser.newContext();
      const page = await context.newPage();
      const timing = await measurePageTiming(page, path, session.cookie);
      report.pages.push(timing);
      await context.close();

      expect(
        timing.domContentLoaded,
        `${path}: domContentLoaded ${timing.domContentLoaded}ms > budget ${PERF_BUDGETS.pageLoadDomMs}ms`,
      ).toBeLessThan(PERF_BUDGETS.pageLoadDomMs);
      expect(
        timing.loadEventEnd,
        `${path}: loadEventEnd ${timing.loadEventEnd}ms > budget ${PERF_BUDGETS.pageLoadLoadMs}ms`,
      ).toBeLessThan(PERF_BUDGETS.pageLoadLoadMs);
      expect(
        timing.requests,
        `${path}: ${timing.requests} request > budget ${PERF_BUDGETS.maxRequestsPerPage}`,
      ).toBeLessThan(PERF_BUDGETS.maxRequestsPerPage);
    }
    writePerfReport(report);
  });

  test('API latency budget: endpoint inti p95 < budget', async ({ request }) => {
    const apiResults = await measureApiLatency(request, CORE_API_ENDPOINTS, session.cookie);
    writePerfReport({ budgets: PERF_BUDGETS, api: apiResults });
    for (const r of apiResults) {
      expect(
        r.p95,
        `${r.endpoint}: p95 ${r.p95}ms > budget ${PERF_BUDGETS.apiLatencyP95Ms}ms`,
      ).toBeLessThan(PERF_BUDGETS.apiLatencyP95Ms);
    }
  });

  test('large dataset pagination: pindah halaman transaksi < 2s (soft budget)', async ({ browser }) => {
    const context = await browser.newContext();
    const page = await context.newPage();
    await page.context().addCookies([
      { name: 'better-auth.session_token', value: session.cookie, domain: 'localhost', path: '/', httpOnly: true, sameSite: 'Lax' },
    ]);
    await page.goto('/transactions', { waitUntil: 'domcontentloaded' });
    await page.waitForLoadState('load');

    // Klik halaman 2 — ukur waktu sampai counter berubah
    const t0 = Date.now();
    await page.getByRole('button', { name: '2', exact: true }).click();
    await page.getByText(/Menampilkan 51-100 dari \d+ transaksi/).first().waitFor({ timeout: 10_000 });
    const paginationMs = Date.now() - t0;

    writePerfReport({ budgets: PERF_BUDGETS, paginationMs });
    // Soft budget: 2s (dev). Gagal = warning (report), bukan hard-fail.
    expect.soft(paginationMs, `pagination ${paginationMs}ms > 2000ms`).toBeLessThan(2000);
    await context.close();
  });
});
