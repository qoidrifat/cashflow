/**
 * Performance budget config (P3.13 — dari PERFORMANCE_TEST_PLAN.md).
 *
 * Angka terpusat di satu file; diukur vs dev server (localhost:5180/5181).
 * Budget dev sengaja longgar (dev build + machine noise); CI/perf job bisa
 * meng-override lewat env (mis. PERF_BUDGET_PAGE_LOAD_MS) untuk angka lebih ketat.
 */
import fs from 'node:fs';
import path from 'node:path';
import type { Page, APIRequestContext } from 'playwright/test';

export interface PerfBudgets {
  /** Page load (navigation timing: domContentLoaded) dalam ms — dev build. */
  pageLoadDomMs: number;
  /** LCP proxy (loadEventEnd) dalam ms — dev build. */
  pageLoadLoadMs: number;
  /** API latency p95 dalam ms untuk endpoint inti. */
  apiLatencyP95Ms: number;
  /** Maksimal request HTTP per page load (exclude HMR/websocket). */
  maxRequestsPerPage: number;
}

const envNum = (key: string, fallback: number): number => {
  const v = Number(process.env[key]);
  return Number.isFinite(v) && v > 0 ? v : fallback;
};

export const PERF_BUDGETS: PerfBudgets = {
  pageLoadDomMs: envNum('PERF_BUDGET_PAGE_LOAD_MS', 4000),
  pageLoadLoadMs: envNum('PERF_BUDGET_LOAD_MS', 6000),
  apiLatencyP95Ms: envNum('PERF_BUDGET_API_P95_MS', 1200),
  maxRequestsPerPage: envNum('PERF_BUDGET_MAX_REQUESTS', 80),
};

/** Endpoint inti yang diukur API latency-nya (p95). */
export const CORE_API_ENDPOINTS = [
  '/api/transactions/paginated?page=1&pageSize=50',
  '/api/gmail/logs?includeSummary=1&page=1&pageSize=5',
  '/api/budgets',
  '/api/categories',
];

/** Ukur navigation timing + request count untuk satu halaman. */
export interface PageTiming {
  page: string;
  domContentLoaded: number;
  loadEventEnd: number;
  requests: number;
  lcpMs: number | null;
}

export async function measurePageTiming(
  page: Page,
  path: string,
  cookie?: string,
): Promise<PageTiming> {
  let requests = 0;
  const countRequests = (req: { url(): string; resourceType(): string }): void => {
    const url = req.url();
    const rt = req.resourceType();
    // Exclude HMR/websocket/polling — bukan bagian dari page load waterfall.
    if (url.includes('vite') || url.includes('@vite') || rt === 'websocket') return;
    if (url.includes('/api/')) return; // API diukur terpisah (apiLatency)
    requests++;
  };
  page.on('request', countRequests);

  if (cookie) {
    await page.context().addCookies([
      {
        name: 'better-auth.session_token',
        value: cookie,
        domain: 'localhost',
        path: '/',
        httpOnly: true,
        sameSite: 'Lax',
      },
    ]);
  }

  await page.goto(path, { waitUntil: 'domcontentloaded' });
  await page.waitForLoadState('load');
  // Tunggu render konten stabil (skeleton hilang → data tampil)
  await page.waitForTimeout(500);

  const nav = await page.evaluate(() => {
    const n = performance.getEntriesByType('navigation')[0] as PerformanceNavigationTiming | undefined;
    const lcpEntry = performance.getEntriesByType('largest-contentful-paint')[0] as
      | (PerformanceEntry & { startTime: number })
      | undefined;
    return {
      domContentLoaded: n ? Math.round(n.domContentLoadedEventEnd) : -1,
      loadEventEnd: n ? Math.round(n.loadEventEnd) : -1,
      lcpMs: lcpEntry ? Math.round(lcpEntry.startTime) : null,
    };
  });

  page.off('request', countRequests);
  return { page: path, ...nav, requests };
}

/** Ukur p50/p95 API latency untuk daftar endpoint (via request fixture + cookie). */
export async function measureApiLatency(
  request: APIRequestContext,
  endpoints: string[],
  cookie: string,
  samples = 3,
): Promise<Array<{ endpoint: string; p50: number; p95: number; n: number }>> {
  const results: Array<{ endpoint: string; p50: number; p95: number; n: number }> = [];
  for (const endpoint of endpoints) {
    const timings: number[] = [];
    for (let i = 0; i < samples; i++) {
      const t0 = Date.now();
      const resp = await request.get(endpoint, {
        headers: { Cookie: `better-auth.session_token=${cookie}` },
      });
      timings.push(Date.now() - t0);
      if (!resp.ok()) timings.push(0); // status non-2xx → jangan dihitung sebagai ok
      await resp.body();
    }
    const ok = timings.filter((t) => t > 0);
    ok.sort((a, b) => a - b);
    const p50 = ok[Math.floor(ok.length * 0.5)] ?? 0;
    const p95 = ok[Math.floor(ok.length * 0.95)] ?? p50;
    results.push({ endpoint, p50, p95, n: ok.length });
  }
  return results;
}

/** Ringkas hasil menjadi JSON report (dipakai CI trend / artifact). */
export function writePerfReport(report: unknown): string {
  const dir = path.resolve(process.cwd(), 'test-results', 'perf');
  fs.mkdirSync(dir, { recursive: true });
  const file = path.join(dir, `perf-${Date.now()}.json`);
  fs.writeFileSync(file, JSON.stringify(report, null, 2));
  return file;
}
