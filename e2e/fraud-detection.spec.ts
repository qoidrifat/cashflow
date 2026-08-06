/**
 * E2E: Fraud Detection (Sprint 1 — Core Product, ADR-011).
 *
 * Regression guard untuk pipeline fraud:
 *   1. POST /api/transactions dua kali dengan gmail_message_id SAMA →
 *      rule engine L1 menandai DUPLIKAT (severity critical) pada transaksi kedua.
 *   2. GET /api/fraud/summary menampilkan flag baru (recent) — deteksi berjalan
 *      async (fire-and-forget), jadi dipoll.
 *   3. Transaksi ter-flag: fraud_flag = 'review' + fraud_score numerik (0..1).
 *   4. Notifikasi warning muncul di bell (dedupe `fraud:<txId>`, type 'warning').
 *   5. POST /api/fraud/flags/:id/review → status flag jadi 'reviewed'.
 *
 * Menjalankan:
 *   npx playwright test e2e/fraud-detection.spec.ts
 */
import { test, expect, type APIRequestContext } from 'playwright/test';
import { mintSessionCookie, cleanupTestSessions, type MintedSession } from './helpers/mintSession';
import { setupAuthContext } from './helpers/authContext';

const runTag = `fraud-e2e-${Date.now()}`;

function authHeaders(cookie: string): Record<string, string> {
  return { Cookie: `better-auth.session_token=${cookie}` };
}

async function createExpense(request: APIRequestContext, cookie: string, overrides: Record<string, unknown> = {}): Promise<string> {
  const resp = await request.post('/api/transactions', {
    headers: authHeaders(cookie),
    data: {
      type: 'expense',
      amount: 150000,
      categoryId: 'cat-food-e2e',
      categoryName: 'Makanan',
      merchant: `Merchant ${runTag}`,
      date: new Date().toISOString().split('T')[0],
      ...overrides,
    },
  });
  expect(resp.status(), 'POST /api/transactions harus 2xx').toBeGreaterThanOrEqual(200);
  const body = await resp.json();
  expect(typeof body.id, 'POST harus mengembalikan id').toBe('string');
  return body.id as string;
}

test.describe('Fraud Detection (e2e)', () => {
  let session: MintedSession;

  test.beforeAll(async () => {
    session = await mintSessionCookie();
  });

  test.afterAll(async () => {
    await cleanupTestSessions();
  });

  test('duplikat gmail_message_id → flag critical + notifikasi warning + review flow', async ({ request }) => {
    const cookie = session.cookie;
    const msgId = `fraud-msg-${runTag}`;
    const createdTxIds: string[] = [];

    try {
    // Transaksi pertama: normal (tanpa flag).
    const tx1 = await createExpense(request, cookie, { gmailMessageId: msgId });
    createdTxIds.push(tx1);

    // Transaksi kedua dengan ID email Gmail sama → DUPLIKAT critical.
    const tx2 = await createExpense(request, cookie, { gmailMessageId: msgId });
    createdTxIds.push(tx2);

    // Fraud detection berjalan async — poll summary sampai flag transaksi-2 muncul.
    await expect.poll(async () => {
      const resp = await request.get('/api/fraud/summary', { headers: authHeaders(cookie) });
      if (resp.status() !== 200) return 0;
      const body = await resp.json();
      return (body.recent || []).filter((f: { transaction_id?: string }) => f.transaction_id === tx2).length;
    }, { timeout: 20_000 }).toBeGreaterThanOrEqual(1);

    // Transaksi ter-flag: label 'review' (critical) + skor numerik.
    const txResp = await request.get('/api/transactions?limit=500', { headers: authHeaders(cookie) });
    const txs = (await txResp.json()) as Array<{ id: string; fraud_flag?: string | null; fraud_score?: number | null }>;
    const flagged = txs.find((t) => t.id === tx2);
    expect(flagged, 'transaksi kedua harus ditemukan').toBeTruthy();
    expect(flagged?.fraud_flag, 'fraud_flag critical harus = review').toBe('review');
    expect(typeof flagged?.fraud_score, 'fraud_score harus numerik').toBe('number');

    // Notifikasi warning di bell (dedupe fraud:<txId>).
    const notifResp = await request.get('/api/notifications?limit=50', { headers: authHeaders(cookie) });
    const notifs = (await notifResp.json()) as Array<{ dedupe_key?: string | null; type?: string }>;
    const fraudNotif = notifs.find((n) => n.dedupe_key === `fraud:${tx2}`);
    expect(fraudNotif, 'notifikasi fraud (warning, dedupe fraud:<txId>) harus ada').toBeTruthy();
    expect(fraudNotif?.type, 'tipe notifikasi harus warning').toBe('warning');

    // Review flow: tandai flag sudah dicek → status reviewed.
    const summaryResp = await request.get('/api/fraud/summary', { headers: authHeaders(cookie) });
    const summary = await summaryResp.json();
    const flag = (summary.recent || []).find((f: { transaction_id?: string }) => f.transaction_id === tx2);
    expect(flag, 'flag transaksi-2 harus muncul di recent').toBeTruthy();

    const reviewResp = await request.post(`/api/fraud/flags/${flag.id}/review`, { headers: authHeaders(cookie) });
    expect(reviewResp.status(), 'POST review harus 200').toBe(200);

    await expect.poll(async () => {
      const resp = await request.get('/api/fraud/flags?limit=100', { headers: authHeaders(cookie) });
      const body = await resp.json();
      const found = (body.flags || []).find((f: { id?: string }) => f.id === flag.id);
      return found?.status;
    }, { timeout: 10_000 }).toBe('reviewed');
    } finally {
      // Cleanup dataset: hapus transaksi yang dibuat (fraud_flags ter-cascade
      // ON DELETE CASCADE). Mencegah polusi dataset pinned user seed di CI/dev.
      for (const txId of createdTxIds) {
        await request.delete(`/api/transactions/${txId}`, { headers: authHeaders(cookie) }).catch(() => {});
      }
    }
  });

  test('UI: halaman /fraud menampilkan flag + flow tandai sudah dicek', async ({ browser, playwright }) => {
    const cookie = session.cookie;
    const msgId = `fraud-ui-msg-${runTag}`;
    const merchant = `Merchant UI ${runTag}`;
    const createdTxIds: string[] = [];

    // API context terpisah (request fixture tidak tersedia di test bertipe browser).
    const api = await playwright.request.newContext({ baseURL: 'http://localhost:5180' });

    try {
      const tx1 = await createExpense(api, cookie, { gmailMessageId: msgId, merchant });
      createdTxIds.push(tx1);
      const tx2 = await createExpense(api, cookie, { gmailMessageId: msgId, merchant });
      createdTxIds.push(tx2);

      // Tunggu flag transaksi-2 muncul (deteksi async).
      let flagId = '';
      await expect.poll(async () => {
        const resp = await api.get('/api/fraud/summary', { headers: authHeaders(cookie) });
        if (resp.status() !== 200) return '';
        const body = await resp.json();
        const flag = (body.recent || []).find((f: { transaction_id?: string }) => f.transaction_id === tx2);
        flagId = flag?.id || '';
        return flagId;
      }, { timeout: 20_000 }).not.toBe('');

      // Buka halaman /fraud dengan sesi browser.
      const context = await browser.newContext();
      await setupAuthContext(context, session);
      const page = await context.newPage();
      await page.goto('/fraud');

      // Card flag tampil dengan label rule + severity + merchant.
      const card = page.getByTestId(`fraud-flag-${flagId}`);
      await expect(card).toBeVisible({ timeout: 15_000 });
      await expect(card).toContainText('Duplikat');
      await expect(card).toContainText(merchant);
      await expect(card).toContainText('Kritis');

      // Tombol "Sudah dicek" → status flag berubah jadi reviewed (API ground truth).
      await card.getByRole('button', { name: /Sudah dicek/ }).click();
      await expect.poll(async () => {
        const resp = await api.get('/api/fraud/flags?limit=100', { headers: authHeaders(cookie) });
        const body = await resp.json();
        const found = (body.flags || []).find((f: { id?: string }) => f.id === flagId);
        return found?.status;
      }, { timeout: 10_000 }).toBe('reviewed');

      // UI: card keluar dari daftar "Perlu dicek" (filter default open).
      await expect(card).not.toBeVisible();
      await context.close();
    } finally {
      // Cleanup SEBELUM dispose — setelah context ditutup, delete request gagal
      // dan transaksi bocor ke dataset seed (mengacaukan transactions.spec
      // yang meng-assert PINNED 284; terlihat sebagai +2/+4 di CI, bukan flake).
      for (const txId of createdTxIds) {
        await api.delete(`/api/transactions/${txId}`, { headers: authHeaders(cookie) }).catch(() => {});
      }
      await api.dispose().catch(() => {});
    }
  });
});
