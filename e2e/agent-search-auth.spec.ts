/**
 * E2E: Auth gate /api/agent-search/*
 *
 * Regression guard untuk fix resolveAgentSearchUser (CF: Supabase JWT → req.user
 * Better Auth). Sebelum fix, route ini melempar ReferenceError (createClient tak
 * ter-import) → semua request user-scoped 500. Kini: tanpa cookie → 401,
 * dengan cookie → lolos, tab help → anonim, sync-docs → publik.
 *
 * Apa yang diverifikasi (semua API-level via fixture `request`, cookie eksplisit):
 *   1. TANPA cookie:
 *      - query tab=transactions/insight/gmail/receipts → 401 (bukan 500)
 *      - answer tab=insight → 401
 *      - sync-transactions / sync-gmail-logs / sync-receipts → 401
 *      - query tab=help → BUKAN 401/500 (anonim diizinkan; hasilnya 200/400/503
 *        tergantung konfigurasi Agent Search)
 *      - sync-docs → BUKAN 401 (endpoint publik)
 *   2. DENGAN cookie minted:
 *      - query tab=transactions → BUKAN 401/500
 *      - sync-transactions → BUKAN 401/500
 *
 * Catatan: assertion tidak menggantungkan nilai 200 — Agent Search boleh belum
 * dikonfigurasi (503/400 valid). Yang dilarang hanya 401 (auth gate gagal) dan
 * 500 (regresi crash server).
 *
 * Menjalankan:
 *   npx playwright test e2e/agent-search-auth.spec.ts
 */
import { test, expect, type APIRequestContext } from 'playwright/test';
import { mintSessionCookie, cleanupTestSessions, type MintedSession } from './helpers/mintSession';

/** POST ke /api/agent-search/* dengan atau tanpa cookie sesi (relative → via baseURL/proxy, sama seperti spec lain). */
async function postAgentSearch(
  request: APIRequestContext,
  pathname: string,
  body: Record<string, unknown>,
  cookie?: string,
): Promise<number> {
  const resp = await request.post(pathname, {
    data: body,
    headers: cookie ? { Cookie: `better-auth.session_token=${cookie}` } : {},
  });
  return resp.status();
}

test.describe('Auth gate /api/agent-search/* (e2e)', () => {
  let session: MintedSession;

  test.beforeAll(async () => {
    session = await mintSessionCookie();
  });

  test.afterAll(async () => {
    await cleanupTestSessions();
  });

  test('tanpa cookie: tab user-scoped & sync → 401, bukan 500 (auth gate bekerja)', async ({ request }) => {
    // Tabs yang butuh login (required: true di resolveAgentSearchUser)
    for (const tab of ['transactions', 'insight', 'gmail', 'receipts']) {
      const status = await postAgentSearch(request, '/api/agent-search/query', { query: 'test', tab });
      expect(status, `query tab=${tab} tanpa cookie harus 401`).toBe(401);
    }

    // answer tab user-scoped
    const answerStatus = await postAgentSearch(request, '/api/agent-search/answer', {
      query: 'hutang',
      tab: 'insight',
    });
    expect(answerStatus, 'answer tab=insight tanpa cookie harus 401').toBe(401);

    // Route sync user-scoped (required: true)
    for (const scope of ['sync-transactions', 'sync-gmail-logs', 'sync-receipts']) {
      const status = await postAgentSearch(request, `/api/agent-search/${scope}`, {});
      expect(status, `${scope} tanpa cookie harus 401`).toBe(401);
    }
  });

  test('tanpa cookie: tab help anonim diizinkan & sync-docs publik (bukan 401/500)', async ({ request }) => {
    // query tab=help → anonim (required: false) → boleh 200/400/503, DILARANG 401/500
    const helpStatus = await postAgentSearch(request, '/api/agent-search/query', {
      query: 'halo',
      tab: 'help',
    });
    expect(helpStatus, 'query tab=help tanpa cookie BUKAN 401').not.toBe(401);
    expect(helpStatus, 'query tab=help tanpa cookie BUKAN 500').not.toBe(500);

    // answer tab=help → anonim juga
    const answerHelp = await postAgentSearch(request, '/api/agent-search/answer', {
      query: 'halo',
      tab: 'help',
    });
    expect(answerHelp, 'answer tab=help tanpa cookie BUKAN 401').not.toBe(401);
    expect(answerHelp, 'answer tab=help tanpa cookie BUKAN 500').not.toBe(500);

    // sync-docs → publik (tanpa resolveAgentSearchUser sama sekali)
    const docsStatus = await postAgentSearch(request, '/api/agent-search/sync-docs', {});
    expect(docsStatus, 'sync-docs tanpa cookie BUKAN 401').not.toBe(401);
  });

  test('dengan cookie minted: tab user-scoped & sync lolos auth (bukan 401/500)', async ({ request }) => {
    // query tab user-scoped → lolos auth (boleh 200/400/503, DILARANG 401/500)
    for (const tab of ['transactions', 'insight', 'gmail', 'receipts']) {
      const status = await postAgentSearch(request, '/api/agent-search/query', { query: 'test', tab }, session.cookie);
      expect(status, `query tab=${tab} dengan cookie BUKAN 401`).not.toBe(401);
      expect(status, `query tab=${tab} dengan cookie BUKAN 500`).not.toBe(500);
    }

    // sync-transactions → lolos auth
    const syncStatus = await postAgentSearch(request, '/api/agent-search/sync-transactions', {}, session.cookie);
    expect(syncStatus, 'sync-transactions dengan cookie BUKAN 401').not.toBe(401);
    expect(syncStatus, 'sync-transactions dengan cookie BUKAN 500').not.toBe(500);

    // answer tab user-scoped → lolos auth
    const answerStatus = await postAgentSearch(request, '/api/agent-search/answer', {
      query: 'hutang',
      tab: 'insight',
    }, session.cookie);
    expect(answerStatus, 'answer tab=insight dengan cookie BUKAN 401').not.toBe(401);
    expect(answerStatus, 'answer tab=insight dengan cookie BUKAN 500').not.toBe(500);
  });
});
