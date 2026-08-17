/**
 * E2E: CashFlow AI Knowledge Assistant (P0.14) — feature flag OFF (safe default).
 *
 * Mengunci kontrak BILLING GATE: selama GOOGLE_AGENT_PLATFORM_ENABLED belum
 * di-set true (eligibility billing belum terbukti), endpoint knowledge wajib:
 *   1. GET  /api/ai/cashflow-knowledge/config → enabled:false, tanpa secret.
 *   2. POST /api/ai/cashflow-knowledge         → 503 GOOGLE_AGENT_PLATFORM_NOT_CONFIGURED
 *      (TIDAK ada panggilan Google, TIDAK ada biaya, TIDAK butuh kredensial).
 *   3. Query invalid → 400 GOOGLE_AGENT_PLATFORM_INVALID_REQUEST.
 *
 * Deterministik & offline: tidak butuh Turso remote, tidak butuh GCP, tidak
 * butuh session auth (knowledge base publik). Tidak menulis apa pun ke DB.
 *
 * Menjalankan (isolated, DB lokal — pola P0.12/P0.13):
 *   npx playwright test -c playwright.e2e-local.config.mjs e2e/knowledge-assistant.spec.ts
 */
import { test, expect } from 'playwright/test';
import { mintSessionCookie, cleanupTestSessions } from './helpers/mintSession';
import { setupAuthContext } from './helpers/authContext';

test.describe('CashFlow AI Knowledge — feature flag OFF (P0.14 billing gate)', () => {
  test('config mengembalikan enabled=false tanpa secret', async ({ request }) => {
    const response = await request.get('/api/ai/cashflow-knowledge/config');
    expect(response.ok()).toBeTruthy();

    const body = await response.json();
    expect(body.ok).toBe(true);
    expect(body.config.enabled).toBe(false);
    expect(body.config.service).toBe('agent_search');

    // Tidak boleh ada field kredensial/sensitif.
    const serialized = JSON.stringify(body);
    expect(serialized).not.toMatch(/(private[_-]?key|client[_-]?secret|refresh[_-]?token|api[_-]?key|credential|password|authorization)/i);
  });

  test('POST ditolak 503 NOT_CONFIGURED tanpa panggilan Google', async ({ request }) => {
    const response = await request.post('/api/ai/cashflow-knowledge', {
      data: { query: 'Bagaimana cara menambahkan wallet?' },
    });
    expect(response.status()).toBe(503);

    const body = await response.json();
    expect(body.ok).toBe(false);
    expect(body.code).toBe('GOOGLE_AGENT_PLATFORM_NOT_CONFIGURED');
    // Tidak ada usage receipt (tidak ada request yang sampai ke Google).
    expect(body.usage).toBeNull();
  });

  test('query invalid ditolak 400 INVALID_REQUEST', async ({ request }) => {
    const response = await request.post('/api/ai/cashflow-knowledge', {
      data: { query: 'a' },
    });
    expect(response.status()).toBe(400);

    const body = await response.json();
    expect(body.ok).toBe(false);
    expect(body.code).toBe('GOOGLE_AGENT_PLATFORM_INVALID_REQUEST');
  });
});

test.describe('CashFlow AI Knowledge — UI (flag OFF, billing gate)', () => {
  let session: { cookie: string; userId: string };

  test.beforeAll(async () => {
    session = await mintSessionCookie();
  });

  test.afterAll(async () => {
    await cleanupTestSessions();
  });

  test('halaman /suite/ai-knowledge: state "belum diaktifkan", input pertanyaan tidak dirender', async ({ page }) => {
    await setupAuthContext(page.context(), session);

    await page.goto('/suite/ai-knowledge');
    await page.waitForLoadState('domcontentloaded');

    // Hero halaman dirender.
    await expect(page.getByRole('heading', { name: 'CashFlow AI Knowledge' })).toBeVisible();
    // Gate server OFF → state non-aktif, tanpa input pertanyaan.
    await expect(page.getByText('Fitur AI Knowledge belum diaktifkan')).toBeVisible();
    await expect(page.getByRole('textbox')).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'Tanyakan' })).toHaveCount(0);
  });
});
