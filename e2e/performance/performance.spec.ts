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
 *  - Pagination diukur 3 sample → assert pada MEDIAN (bukan single-shot):
 *    runner shared (Ubuntu CI) + Turso remote bisa spike 1x; median menyerap
 *    noise tanpa melemahkan HARD budget (regresi orde-magnitudo tetap terdeteksi
 *    karena SEMUA sampel ikut membengkak). Pola flaky terverifikasi 2026-08-05
 *    (run CI 30935084524 gagal di attempt 1, retry lulus; lokal 5081ms < 12s).
 *  - Hasil ditulis ke test-results/perf/perf-*.json untuk trend CI.
 */
import { test, expect } from 'playwright/test';
import { mintSessionCookie, cleanupTestSessions } from '../helpers/mintSession';
import { suppressOnboarding } from '../helpers/authContext';
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

  test('large dataset pagination: pindah halaman transaksi — HARD budget (median dari 3 sampel)', async ({ browser }) => {
    // 3 sampel, context baru tiap sampel (state bersih seperti navigasi user).
    // Assert pada MEDIAN: spike tunggal dari runner shared/Turso remote tidak
    // menggagalkan CI, tapi regresi orde-magnitudo (N+1, index hilang) tetap
    // terdeteksi — SEMUA sampel membengkak → median ikut melewati HARD budget.
    const samples: number[] = [];
    for (let i = 0; i < 3; i++) {
      const context = await browser.newContext();
      // Onboarding modal (fixed inset-0 z-50) menghalangi klik tombol pagination
      // bila tidak ditekan — pola sama dengan spec lain (authContext.suppressOnboarding).
      await suppressOnboarding(context);
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
      samples.push(Date.now() - t0);
      await context.close();
    }

    samples.sort((a, b) => a - b);
    const medianMs = samples[Math.floor(samples.length / 2)] ?? 0;
    const maxMs = samples[samples.length - 1] ?? 0;
    writePerfReport({ budgets: PERF_BUDGETS, paginationMs: medianMs, paginationSamples: samples });

    // HARD budget (CI default 12s): median melebihi = regresi orde-magnitudo
    // (mis. N+1, index hilang) → test GAGAL. Angka sengaja jauh di atas noise
    // mesin dev; median-of-3 menyerap spike 1x tanpa melemahkan gate.
    expect(
      medianMs,
      `pagination median ${medianMs}ms (samples: ${samples.join(', ')}ms) > HARD budget ${PERF_BUDGETS.paginationHardMs}ms (regresi orde-magnitudo)`,
    ).toBeLessThan(PERF_BUDGETS.paginationHardMs);

    // SOFT budget (CI default 6s): melebihi = warning di log + report JSON
    // (bukan hard-fail) — dev build + React dev mode wajar 3-5s, noise mesin
    // tidak boleh membatalkan CI. CI bisa mengetatkan via PERF_BUDGET_PAGINATION_SOFT_MS.
    if (maxMs > PERF_BUDGETS.paginationSoftMs) {
      console.warn(
        `[perf] pagination max ${maxMs}ms > soft budget ${PERF_BUDGETS.paginationSoftMs}ms (warning — tracking, bukan hard-fail)`,
      );
    }
  });
});
