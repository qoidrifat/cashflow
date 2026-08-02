/**
 * E2E: Auth gate /api/admin/metrics/*
 *
 * Regression guard untuk fix resolveAdmin (CF-053: Supabase JWT → req.user
 * Better Auth + ADMIN_EMAILS) dan rewrite metricsService (Supabase query-builder
 * → raw SQL Turso). Sebelum fix, semua endpoint admin metrics 500 (query-builder
 * tidak kompatibel dengan libSQL); sebelum migrasi auth, gate memakai Supabase JWT.
 *
 * Apa yang diverifikasi (semua API-level via fixture `request`, cookie eksplisit):
 *   1. TANPA cookie:
 *      - semua 6 endpoint /api/admin/metrics/* → 401 (bukan 500) — auth gate bekerja
 *   2. DENGAN cookie NON-admin (user 'e2e-nonadmin@cashflow.test'):
 *      - semua 6 endpoint → 403 (resolveAdmin: email tidak ada di ADMIN_EMAILS)
 *        → BUKAN 401 (sudah login) dan BUKAN 500 (gate error)
 *   3. DENGAN cookie admin (user pertama = qoidrifat23@gmail.com = ADMIN_EMAILS):
 *      - semua 6 endpoint → 200 + ok:true — metricsService raw SQL bekerja penuh
 *
 * Endpoint yang dicakup:
 *   - /api/admin/metrics/summary
 *   - /api/admin/metrics/ai-usage
 *   - /api/admin/metrics/system
 *   - /api/admin/metrics/feature-health
 *   - /api/admin/metrics/feature/:feature/calls (feature=agent_search)
 *   - /api/admin/metrics/alerts
 *
 * Menjalankan:
 *   npx playwright test e2e/admin-metrics-auth.spec.ts
 *   npm run test:e2e:admin
 */
import { test, expect, type APIRequestContext, type APIResponse } from 'playwright/test';
import {
  mintSessionCookie,
  mintSessionCookieForEmail,
  cleanupTestSessions,
  type MintedSession,
} from './helpers/mintSession';

const NON_ADMIN_EMAIL = 'e2e-nonadmin@cashflow.test';

/** Semua endpoint admin metrics yang di-protect resolveAdmin. */
const ADMIN_ENDPOINTS = [
  '/api/admin/metrics/summary',
  '/api/admin/metrics/ai-usage',
  '/api/admin/metrics/system',
  '/api/admin/metrics/feature-health',
  '/api/admin/metrics/feature/agent_search/calls',
  '/api/admin/metrics/alerts',
];

/** GET ke /api/admin/metrics/* dengan atau tanpa cookie sesi (relative → via baseURL/proxy, sama seperti spec lain). */
async function getMetrics(
  request: APIRequestContext,
  pathname: string,
  cookie?: string,
): Promise<APIResponse> {
  return request.get(pathname, {
    headers: cookie ? { Cookie: `better-auth.session_token=${cookie}` } : {},
  });
}

/**
 * Poll GET sampai tercapai status/body yang diharapkan (anti-flaky).
 *
 * Latar: authMiddleware menelan error `getSession` (try/catch kosong → req.user
 * null), jadi blip koneksi Turso transient bisa tampil sebagai 401/403 sesaat
 * meski cookie valid. expect.poll membuat test tetap strict pada end-state
 * (pola sama seperti waitListTotal/waitListRange di pagination.ts) namun toleran
 * terhadap blip sesaat — bukan menoleransi regresi nyata (yang persisten → poll
 * habis → gagal).
 */
async function pollMetricsStatus(
  request: APIRequestContext,
  pathname: string,
  cookie: string | undefined,
  expectedStatus: number,
  checkBody?: (body: { ok?: boolean; code?: string }) => boolean,
): Promise<void> {
  await expect
    .poll(
      async () => {
        const resp = await getMetrics(request, pathname, cookie);
        if (resp.status() !== expectedStatus) return false;
        if (!checkBody) return true;
        let body: { ok?: boolean; code?: string } = {};
        try {
          body = (await resp.json()) as { ok?: boolean; code?: string };
        } catch {
          return false;
        }
        return checkBody(body);
      },
      { timeout: 10_000, intervals: [150, 300, 600, 1200], message: `${pathname} harus ${expectedStatus}` },
    )
    .toBe(true);
}

test.describe('Auth gate /api/admin/metrics/* (e2e)', () => {
  let adminSession: MintedSession;
  let nonAdminSession: MintedSession;

  test.beforeAll(async () => {
    adminSession = await mintSessionCookie();
    nonAdminSession = await mintSessionCookieForEmail(NON_ADMIN_EMAIL);
  });

  test.afterAll(async () => {
    await cleanupTestSessions();
  });

  test('tanpa cookie: semua endpoint admin → 401, bukan 500 (auth gate bekerja)', async ({ request }) => {
    for (const pathname of ADMIN_ENDPOINTS) {
      const resp = await getMetrics(request, pathname);
      expect(resp.status(), `${pathname} tanpa cookie harus 401`).toBe(401);
    }
  });

  test('dengan cookie non-admin: semua endpoint → 403 (bukan 401/500) — resolveAdmin menolak non-admin', async ({ request }) => {
    for (const pathname of ADMIN_ENDPOINTS) {
      await pollMetricsStatus(request, pathname, nonAdminSession.cookie, 403, (body) => {
        return body.ok === false && body.code === 'ADMIN_METRICS_403';
      });
    }
  });

  test('dengan cookie admin: semua endpoint → 200 + ok:true (metricsService raw SQL bekerja)', async ({ request }) => {
    for (const pathname of ADMIN_ENDPOINTS) {
      await pollMetricsStatus(request, pathname, adminSession.cookie, 200, (body) => {
        return body.ok === true;
      });
    }
  });
});
