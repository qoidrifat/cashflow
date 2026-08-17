/**
 * E2E: P1-2 G4 — Validation Layer untuk agent-search + admin metrics.
 *
 * Memaku BENTUK ERROR domain-spesifik untuk kegagalan validasi (HARD RULES
 * Task #42): validasi gagal → HTTP 400 — JANGAN PERNAH 401 (401 memicu dialog
 * session-expired di client).
 *
 *   - POST /api/agent-search/query & /answer:
 *       400 { ok:false, code:'AGENT_SEARCH_INVALID_REQUEST', message }
 *     (bukan bentuk generik sendValidationError)
 *   - GET /api/admin/metrics/*:
 *       400 { ok:false, code:'ADMIN_METRICS_400', message }
 *
 * Tidak boleh kontradiksi dengan e2e/agent-search-auth.spec.ts (auth gate)
 * maupun e2e/admin-metrics-auth.spec.ts (role gate):
 *   - tab user-scoped TANPA cookie → tetap 401 bahkan bila body invalid
 *     (auth gate dievaluasi sebelum validasi body).
 *   - endpoint admin TANPA cookie → tetap 401 bahkan bila query invalid.
 *
 * Semua probe validasi agent-search memakai tab 'help' / anonim sehingga TIDAK
 * menyentuh Google Discovery — deterministik tanpa kredensial. Probe admin
 * memakai cookie minted (user pertama = ADMIN_EMAILS, pola admin-metrics-auth)
 * dan toleran blip Turso via expect.poll.
 *
 * Menjalankan (serial, JANGAN paralel dengan suite lain — port bersama):
 *   npx playwright test e2e/crud-validation-g4.spec.ts
 */
import { test, expect, type APIRequestContext, type APIResponse } from 'playwright/test';
import { mintSessionCookie, cleanupTestSessions, type MintedSession } from './helpers/mintSession';

/** Bentuk error domain agent-search yang wajib dipenuhi setiap 400 validasi. */
interface AgentSearchErrorBody {
  ok: boolean;
  code: string;
  message: string;
  detail?: string;
}

/** Bentuk error domain admin metrics yang wajib dipenuhi setiap 400 validasi. */
interface AdminMetricsErrorBody {
  ok: boolean;
  code: string;
  message: string;
}

async function postAgentSearch(
  request: APIRequestContext,
  pathname: string,
  body: Record<string, unknown>,
  cookie?: string,
): Promise<APIResponse> {
  return request.post(pathname, {
    data: body,
    headers: cookie ? { Cookie: `better-auth.session_token=${cookie}` } : {},
  });
}

/** Assert 400 + bentuk domain agent-search (ok:false, code, message string). */
async function expectAgentSearch400(resp: APIResponse, label: string): Promise<void> {
  expect(resp.status(), `${label} harus 400`).toBe(400);
  const body = (await resp.json()) as AgentSearchErrorBody;
  expect(body.ok, `${label} body.ok harus false`).toBe(false);
  expect(body.code, `${label} code domain`).toBe('AGENT_SEARCH_INVALID_REQUEST');
  expect(typeof body.message, `${label} message string`).toBe('string');
  expect(body.message.length, `${label} message tidak kosong`).toBeGreaterThan(0);
}

/**
 * Poll GET admin metrics sampai tercapai status+body yang diharapkan
 * (anti-flaky blip Turso transient — pola sama e2e/admin-metrics-auth.spec.ts).
 */
async function pollAdminMetrics(
  request: APIRequestContext,
  pathname: string,
  cookie: string,
  expectedStatus: number,
  checkBody: (body: Record<string, unknown>) => boolean,
): Promise<Record<string, unknown>> {
  let lastBody: Record<string, unknown> = {};
  await expect
    .poll(
      async () => {
        const resp = await request.get(pathname, {
          headers: { Cookie: `better-auth.session_token=${cookie}` },
        });
        if (resp.status() !== expectedStatus) return false;
        try {
          lastBody = (await resp.json()) as Record<string, unknown>;
        } catch {
          return false;
        }
        return checkBody(lastBody);
      },
      { timeout: 10_000, intervals: [150, 300, 600, 1200], message: `${pathname} harus ${expectedStatus}` },
    )
    .toBe(true);
  return lastBody;
}

test.describe('P1-2 G4 — validasi agent-search & admin metrics (e2e)', () => {
  let adminSession: MintedSession;
  let isAdmin = false;

  test.beforeAll(async ({ playwright }) => {
    adminSession = await mintSessionCookie();
    // Konfirmasi peran admin (user pertama = ADMIN_EMAILS, pola admin-metrics-auth).
    // Bila lingkungan berbeda (403), test admin di-skip — spec tidak boleh gagal
    // karena konfigurasi lingkungan, hanya karena regresi validasi.
    // GET /cache tanpa param: 200 hanya bila admin.
    // baseURL dari CONFIG (5180 main / 5190 isolated) — hardcode port membuat
    // probe menembak stack yang salah di config E2E terisolasi (P1.7).
    const baseURL = (test.info().project.use as { baseURL?: string }).baseURL ?? 'http://localhost:5180';
    const context = await playwright.request.newContext({ baseURL });
    try {
      const probe = await context.get('/api/admin/metrics/cache', {
        headers: { Cookie: `better-auth.session_token=${adminSession.cookie}` },
      });
      isAdmin = probe.status() === 200;
    } finally {
      await context.dispose();
    }
  });

  test.afterAll(async () => {
    await cleanupTestSessions();
  });

  test('agent-search: query invalid → 400 bentuk domain, JANGAN PERNAH 401', async ({ request }) => {
    const invalidBodies: Array<[string, Record<string, unknown>]> = [
      ['body kosong (query absen)', {}],
      ['query string kosong', { query: '', tab: 'help' }],
      ['query hanya whitespace', { query: '   \t ', tab: 'help' }],
      ['query 1 karakter (< minimal 2)', { query: 'a', tab: 'help' }],
      ['query > 2000 karakter', { query: 'x'.repeat(2001), tab: 'help' }],
      ['query non-string (number)', { query: 42, tab: 'help' }],
      ['tab di luar whitelist', { query: 'halo dunia', tab: 'sideways' }],
    ];

    for (const [label, body] of invalidBodies) {
      const resp = await postAgentSearch(request, '/api/agent-search/query', body);
      await expectAgentSearch400(resp, `POST query ${label}`);
    }

    // answer endpoint memakai gate yang sama
    const answerResp = await postAgentSearch(request, '/api/agent-search/answer', { query: '  ', tab: 'help' });
    await expectAgentSearch400(answerResp, 'POST answer query whitespace');

    const answerTab = await postAgentSearch(request, '/api/agent-search/answer', { query: 'halo dunia', tab: 'hacked' });
    await expectAgentSearch400(answerTab, 'POST answer tab invalid');
  });

  test('agent-search: auth gate tetap menang atas validasi (konsisten agent-search-auth)', async ({ request }) => {
    // Tanpa cookie + tab user-scoped + body INVALID → tetap 401 (auth dulu).
    const resp = await postAgentSearch(request, '/api/agent-search/query', { query: '', tab: 'transactions' });
    expect(resp.status(), 'tab user-scoped tanpa cookie harus 401, bukan 400').toBe(401);

    // Dengan cookie valid + body valid → lolos auth & validasi (bukan 401/500).
    // Hasil boleh 200/503 tergantung konfigurasi Agent Search (pola agent-search-auth).
    const valid = await postAgentSearch(request, '/api/agent-search/query', {
      query: 'cara melihat transaksi',
      tab: 'help',
    }, adminSession.cookie);
    expect(valid.status(), 'query help valid BUKAN 401').not.toBe(401);
    expect(valid.status(), 'query help valid BUKAN 500').not.toBe(500);
    // 400 DIPERBOLEHKAN hanya bila berasal dari SERVICE Agent Search (konfigurasi
    // data store, mis. multi-datastore menolak queryExpansionSpec — perilaku
    // service lama yang TIDAK berubah di Phase-1), BUKAN dari validasi body.
    // Validasi yang benar TIDAK boleh menolak query valid — deteksi via pesan
    // validasi khas (minimal/maksimal/wajib/harus salah satu).
    if (valid.status() === 400) {
      const body = (await valid.json()) as AgentSearchErrorBody;
      expect(body.ok, '400 dari service agent-search harus body.ok false').toBe(false);
      expect(body.code, '400 dari service agent-search (bukan validasi)').toBe('AGENT_SEARCH_INVALID_REQUEST');
      expect(
        String(body.message || '').toLowerCase(),
        'message 400 bukan penolakan validasi body (query/tab valid)',
      ).not.toMatch(/minimal|maksimal|wajib diisi|harus salah satu/);
    }
  });

  test('agent-search: GET config & health tetap publik dan bentuknya tidak berubah', async ({ request }) => {
    const config = await request.get('/api/agent-search/config');
    expect(config.status()).toBe(200);
    const configBody = (await config.json()) as { ok: boolean; config: Record<string, unknown> };
    expect(configBody.ok).toBe(true);
    expect(typeof configBody.config).toBe('object');

    const health = await request.get('/api/agent-search/health');
    expect([200, 503], 'health: 200 sehat / 503 belum dikonfigurasi').toContain(health.status());
    const healthBody = (await health.json()) as { ok: boolean };
    expect(typeof healthBody.ok).toBe('boolean');
  });

  test('admin metrics: TANPA cookie → 401 bahkan untuk query invalid (role gate dulu)', async ({ request }) => {
    const resp = await request.get('/api/admin/metrics/feature/agent_search/calls?page=abc&page_size=xyz');
    expect(resp.status(), 'auth gate sebelum validasi').toBe(401);
  });

  test('admin metrics: query invalid → 400 ADMIN_METRICS_400; clamp & whitelist dipertahankan', async ({ request }) => {
    test.skip(!isAdmin, 'User pertama bukan admin di lingkungan ini — probe admin dilewati.');

    // Gap-fill P1-2 G4: page/page_size non-integer kini 400 fail-closed.
    await pollAdminMetrics(request, '/api/admin/metrics/feature/agent_search/calls?page=abc', adminSession.cookie, 400, (b) =>
      b.ok === false && b.code === 'ADMIN_METRICS_400' && typeof b.message === 'string');
    await pollAdminMetrics(request, '/api/admin/metrics/feature/agent_search/calls?page_size=xyz', adminSession.cookie, 400, (b) =>
      b.ok === false && b.code === 'ADMIN_METRICS_400');

    // Whitelist lama tetap: feature tidak dikenal → 400 ADMIN_METRICS_400.
    await pollAdminMetrics(request, '/api/admin/metrics/feature-health?feature=hacked', adminSession.cookie, 400, (b) =>
      b.ok === false && b.code === 'ADMIN_METRICS_400');
    await pollAdminMetrics(request, '/api/admin/metrics/feature/hacked/calls', adminSession.cookie, 400, (b) =>
      b.ok === false && b.code === 'ADMIN_METRICS_400');

    // from/to invalid tetap 400 via parseDateRange.
    await pollAdminMetrics(request, '/api/admin/metrics/ai-usage?from=bukan-tanggal', adminSession.cookie, 400, (b) =>
      b.ok === false && b.code === 'ADMIN_METRICS_400');

    // Clamp pola lama dipertahankan: nilai numerik di luar rentang → 200, di-clamp.
    const clamped = await pollAdminMetrics(
      request,
      '/api/admin/metrics/feature/agent_search/calls?page=999999&page_size=500',
      adminSession.cookie,
      200,
      (b) => b.ok === true && b.page === 100000 && b.pageSize === 100,
    );
    expect(clamped.page).toBe(100000);
    expect(clamped.pageSize).toBe(100);

    // Baseline valid tetap 200 + ok:true (success path tidak berubah).
    await pollAdminMetrics(request, '/api/admin/metrics/feature/agent_search/calls?page=1&page_size=20', adminSession.cookie, 200, (b) =>
      b.ok === true);
  });
});
