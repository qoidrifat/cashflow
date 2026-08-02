/**
 * E2E: API Contract — deteksi schema drift otomatis (P3.10, dari API_CONTRACT_STRATEGY.md).
 *
 * Memvalidasi bentuk response endpoint inti terhadap kontrak di contracts.ts.
 * Bila server mengubah response (field hilang/rename/tipe berubah) → test merah
 * → drift terdeteksi sebelum user terkena dampak.
 *
 * Endpoint yang dicakup (prioritas dari strategi):
 *   1. /api/gmail/logs?includeSummary=1      — data[], total, page, pageSize, summary
 *   2. /api/transactions/paginated           — data[], total, page, pageSize, totalPages, has*
 *   3. /api/transactions                     — array rows
 *   4. /api/budgets                          — array rows
 *   5. /api/categories                       — array rows
 *   6. /api/notifications                    — array rows
 *   7. /api/admin/metrics/summary            — ok, today/week/month buckets
 *   8. /api/agent-search/config              — ok, config (publik, tanpa cookie)
 *
 * Anti-flaky: tiap check dibungkus expect.poll (pola yang sama dengan
 * admin-metrics-auth.spec) — toleran terhadap 401 transient saat blip Turso,
 * TAPI tetap strict pada end-state (drift persisten → poll habis → gagal).
 *
 * Menjalankan:
 *   npm run test:e2e:contract
 *   npx playwright test e2e/contract/contract-check.spec.ts
 */
import { test, expect, type APIRequestContext, type APIResponse } from 'playwright/test';
import { mintSessionCookie, cleanupTestSessions, type MintedSession } from '../helpers/mintSession';
import { bodyOf, type Contract, gmailLogsContract, transactionsPaginatedContract, transactionsListContract, budgetsContract, categoriesContract, notificationsContract, adminSummaryContract, agentSearchConfigContract } from './contracts';

/** GET dengan cookie eksplisit (fixture request = context terpisah). */
async function getWithCookie(
  request: APIRequestContext,
  pathname: string,
  cookie?: string,
): Promise<APIResponse> {
  return request.get(pathname, {
    headers: cookie ? { Cookie: `better-auth.session_token=${cookie}` } : {},
  });
}

/**
 * Jalankan satu contract check dengan expect.poll (anti-flaky 401 transient).
 * Poll berhenti hanya bila status 200 DAN body lolos kontrak → drift persisten
 * tetap terdeteksi (poll habis = gagal).
 */
async function checkContract(
  request: APIRequestContext,
  contract: Contract,
  pathname: string,
  cookie?: string,
): Promise<void> {
  await expect
    .poll(
      async () => {
        const resp = await getWithCookie(request, pathname, cookie);
        if (resp.status() !== 200) return false;
        const body = await bodyOf(resp);
        return contract.validate(body);
      },
      { timeout: 12_000, intervals: [150, 300, 600, 1200], message: `${contract.label} (${pathname}) harus 200 + sesuai kontrak. Diharapkan: ${contract.describe()}` },
    )
    .toBe(true);
}

test.describe('API contract — schema drift detection (e2e)', () => {
  let session: MintedSession;

  test.beforeAll(async () => {
    session = await mintSessionCookie();
  });

  test.afterAll(async () => {
    await cleanupTestSessions();
  });

  test('Gmail logs contract (data[], total, page, pageSize, summary{...})', async ({ request }) => {
    await checkContract(
      request,
      gmailLogsContract,
      '/api/gmail/logs?includeSummary=1&page=1&pageSize=5',
      session.cookie,
    );
  });

  test('Transactions paginated contract (data[], total, page, pageSize, totalPages, has*)', async ({ request }) => {
    await checkContract(
      request,
      transactionsPaginatedContract,
      '/api/transactions/paginated?page=1&pageSize=5',
      session.cookie,
    );
  });

  test('Transactions list contract (array row: id,type,amount,date)', async ({ request }) => {
    await checkContract(
      request,
      transactionsListContract,
      '/api/transactions?limit=5',
      session.cookie,
    );
  });

  test('Budgets contract (array row: id,category_id,amount,month,year)', async ({ request }) => {
    await checkContract(
      request,
      budgetsContract,
      '/api/budgets',
      session.cookie,
    );
  });

  test('Categories contract (array row: id,name,...)', async ({ request }) => {
    await checkContract(
      request,
      categoriesContract,
      '/api/categories',
      session.cookie,
    );
  });

  test('Notifications contract (array row: id,type,title,read,created_at)', async ({ request }) => {
    await checkContract(
      request,
      notificationsContract,
      '/api/notifications',
      session.cookie,
    );
  });

  test('Admin metrics summary contract (ok, today/week/month buckets)', async ({ request }) => {
    await checkContract(
      request,
      adminSummaryContract,
      '/api/admin/metrics/summary',
      session.cookie,
    );
  });

  test('Agent search config contract (ok, config) — publik tanpa cookie', async ({ request }) => {
    await checkContract(
      request,
      agentSearchConfigContract,
      '/api/agent-search/config',
      undefined, // publik
    );
  });
});
