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
  /**
   * Pagination besar: di atas SOFT = warning (report-only, tidak gagal);
   * di atas HARD = test GAGAL (regresi orde-magnitudo).
   * Soft sengaja realistis untuk dev build + React dev mode (dataset 541+);
   * hard menangkap N+1 / query hilang index tanpa flaky dari noise mesin.
   */
  paginationSoftMs: number;
  paginationHardMs: number;
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
  paginationSoftMs: envNum('PERF_BUDGET_PAGINATION_SOFT_MS', 2000),
  paginationHardMs: envNum('PERF_BUDGET_PAGINATION_HARD_MS', 8000),
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
  // Count URL UNIK per asset (bukan raw request count). Investigasi 2026-08-05
  // (run CI #26/#27, +trace Playwright CI vs lokal): Vite DEV mode menyajikan 1
  // HTTP request PER MODUL (unbundled ESM) dan modul yang di-invalidate HMR
  // diberi query cache-busting `?t=<timestamp>` yang berubah tiap revalidate →
  // URL "unik" palsu. Fetch yang di-retry (server/Turso remote lambat) juga
  // memunculkan request duplikat. Semua itu BUKAN indikator bloat — yang relevan
  // adalah jumlah ASSET unik (chunk/modul/asset baru). Karena itu:
  //  1. Exclude infrastruktur dev: websocket (ws/wss — HMR & realtime),
  //     @react-refresh, /node_modules/vite/ (env.mjs).
  //  2. Strip query string (?t=, ?token=, dsb) SEBELUM dedup — file yang sama
  //     dengan query berbeda dihitung satu kali.
  //  3. Dedup URL bersih.
  // Catatan: dev mode tetap ~45-65 request unik/page (bervariasi mengikuti module
  // graph & HMR) — budget request CI 60 di-naikkan ke 80 (sama dengan default dev)
  // karena margin 60 terbukti flaky struktural (teramati 41-65 di CI & lokal).
  let requests = 0;
  const seenUrls = new Set<string>();
  const countRequests = (req: { url(): string; resourceType(): string }): void => {
    const url = req.url();
    const rt = req.resourceType();
    // Infrastruktur dev / koneksi persistent — bukan bagian page load waterfall.
    if (rt === 'websocket') return;
    if (url.startsWith('ws://') || url.startsWith('wss://')) return;
    if (url.includes('@react-refresh')) return;
    if (url.includes('vite')) return; // /@vite/client, /node_modules/.vite/deps/*, /node_modules/vite/*
    if (url.includes('/api/')) return; // API diukur terpisah (apiLatency)
    const clean = url.split('?')[0]; // strip ?t= HMR / token
    if (seenUrls.has(clean)) return; // retry/duplikat/revalidate — jangan hitung 2×
    seenUrls.add(clean);
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
