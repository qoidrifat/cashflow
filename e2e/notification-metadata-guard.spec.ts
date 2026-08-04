/**
 * E2E: P1-4 Notification Metadata Guard — POST /api/notifications.
 *
 * Menutup temuan audit (Medium): payload forjaan dengan
 * `metadata.source = 'gmail_review'` + emailId dulu memicu side effect operator
 * (webhook GMAIL_WEBHOOK_URL + email SMTP) berisi konten pilihan penyerang.
 *
 * Spec ini berjalan terhadap server uji KHUSUS port 5183 (playwright.config.ts)
 * dengan GMAIL_WEBHOOK_URL → webhook sink (e2e/helpers/webhookSinkServer.mjs,
 * port 5184), sehingga side effect operator BISA di-assert deterministik:
 *
 *   1. FORGED (emailId tanpa baris gmail_sync_logs milik user):
 *      POST diterima (notifikasi in-app tersimpan) tetapi webhook TIDAK
 *      terkirim ke sink.
 *   2. FORGED (log ada tapi status tidak kompatibel dengan klaim):
 *      webhook TIDAK terkirim.
 *   3. LEGITIMATE (log approved milik user + klaim approved):
 *      webhook TERKIRIM, dan kontennya disaring dari data server
 *      (candidate merchant/amount log) — merchant/amount forjaan di body
 *      request TIDAK bocor ke payload operator. Jalur GmailSyncPage tetap
 *      berfungsi end-to-end (in-app + webhook).
 *   4. Metadata invalid (bukan objek / terlalu besar) → 400.
 *
 * Menjalankan:
 *   npx playwright test e2e/notification-metadata-guard.spec.ts
 */
import { test, expect } from 'playwright/test';
import { mintSessionCookie, cleanupTestSessions, cleanupGmailReviewTestData } from './helpers/mintSession';

const GUARD_API = 'http://localhost:5183';
const SINK = 'http://localhost:5184';

interface WebhookPayload {
  path: string;
  body: {
    event?: string;
    user?: { id?: string; email?: string };
    result?: { status?: string; emailId?: string; merchant?: string | null; amount?: number | null; message?: string | null };
  } | null;
}

async function resetSink(): Promise<void> {
  await fetch(`${SINK}/sink-reset`, { method: 'POST' });
}

async function sinkPayloads(): Promise<WebhookPayload[]> {
  const resp = await fetch(`${SINK}/sink-payloads`);
  const json = (await resp.json()) as { payloads: WebhookPayload[] };
  return json.payloads || [];
}

test.describe('Notification Metadata Guard — P1-4 (e2e)', () => {
  let session: { cookie: string; userId: string };
  const testMessageIds: string[] = [];
  const createdNotificationIds: string[] = [];

  const authHeaders = () => ({ Cookie: `better-auth.session_token=${session.cookie}` });

  test.beforeAll(async () => {
    session = await mintSessionCookie();
  });

  test.afterAll(async () => {
    // Cleanup via API guard server (DB sama dengan helper libsql langsung).
    for (const id of createdNotificationIds) {
      try {
        await fetch(`${GUARD_API}/api/notifications/${id}`, {
          method: 'DELETE',
          headers: authHeaders(),
        });
      } catch { /* best-effort */ }
    }
    for (const id of testMessageIds) {
      await cleanupGmailReviewTestData(id);
    }
    await cleanupTestSessions();
  });

  test.beforeEach(async () => {
    await resetSink();
  });

  test('FORGED: metadata.source=gmail_review dengan emailId tak dikenal tidak memicu webhook operator', async ({ request }) => {
    const forgedEmailId = `e2e-guard-forged-${Date.now()}`;

    const resp = await request.post(`${GUARD_API}/api/notifications`, {
      headers: authHeaders(),
      data: {
        type: 'success',
        priority: 'low',
        title: 'Transaksi Gmail diterima',
        message: 'forged',
        metadata: {
          source: 'gmail_review',
          emailId: forgedEmailId,
          result: 'approved',
          merchant: 'ATTACKER MERCHANT',
          amount: 1,
          errorMessage: 'konten operator pilihan penyerang',
        },
      },
    });
    // Notifikasi in-app tetap dibuat (milik user sendiri) — API tidak rusak.
    expect(resp.status()).toBe(200);
    const body = (await resp.json()) as { id?: string };
    expect(body.id).toBeTruthy();
    if (body.id) createdNotificationIds.push(body.id);

    // Beri waktu side effect (fire-and-forget) mencapai sink — lalu assert KOSONG.
    await new Promise((r) => setTimeout(r, 2500));
    const payloads = await sinkPayloads();
    expect(payloads, 'webhook operator TIDAK boleh dipicu oleh metadata forjaan').toHaveLength(0);
  });

  test('FORGED: log ada tetapi status tidak kompatibel dengan klaim → webhook diblokir', async ({ request }) => {
    const messageId = `e2e-guard-status-${Date.now()}`;
    testMessageIds.push(messageId);

    // Seed log needs_review (belum di-approve) milik user.
    const seed = await request.post(`${GUARD_API}/api/gmail/logs`, {
      headers: authHeaders(),
      data: {
        messageId,
        subject: 'E2E Guard status mismatch',
        sender: 'e2e-guard@example.com',
        status: 'needs_review',
        finalStatus: 'needs_review',
        metadata: { candidate: { amount: 50000, merchant: 'E2E Guard Merchant' } },
      },
    });
    expect(seed.ok()).toBe(true);

    // Klaim approved padahal log masih needs_review → side effect wajib diblokir.
    const resp = await request.post(`${GUARD_API}/api/notifications`, {
      headers: authHeaders(),
      data: {
        type: 'success',
        title: 'Transaksi Gmail diterima',
        message: 'forged approve',
        dedupeKey: `gmail-review-${messageId}`,
        metadata: { source: 'gmail_review', emailId: messageId, result: 'approved', merchant: 'ATTACKER' },
      },
    });
    expect(resp.status()).toBe(200);

    await new Promise((r) => setTimeout(r, 2500));
    const payloads = await sinkPayloads();
    expect(payloads, 'klaim approved tanpa log approved tidak boleh memicu webhook').toHaveLength(0);
  });

  test('LEGITIMATE: hasil review terkoroborasi tetap memicu webhook dengan konten dari data server', async ({ request }) => {
    const messageId = `e2e-guard-legit-${Date.now()}`;
    testMessageIds.push(messageId);

    // 1. Seed log needs_review + candidate (meniru hasil sync).
    const seed = await request.post(`${GUARD_API}/api/gmail/logs`, {
      headers: authHeaders(),
      data: {
        messageId,
        subject: 'E2E Guard legit flow',
        sender: 'e2e-guard-merchant@example.com',
        status: 'needs_review',
        finalStatus: 'needs_review',
        metadata: { candidate: { amount: 125000, merchant: 'E2E Guard Merchant' } },
      },
    });
    expect(seed.ok()).toBe(true);

    // 2. Persist status approved — meniru persistGmailSyncResults yang SELALU
    //    mengirim ulang payload log LENGKAP termasuk metadata.candidate (upsert
    //    ON CONFLICT menimpa seluruh field; tanpa candidate, merchant webhook
    //    akan fallback ke sender). Sama persis dengan alur GmailSyncPage.
    const approve = await request.post(`${GUARD_API}/api/gmail/logs`, {
      headers: authHeaders(),
      data: {
        messageId,
        subject: 'E2E Guard legit flow',
        sender: 'e2e-guard-merchant@example.com',
        status: 'approved',
        finalStatus: 'approved',
        metadata: { candidate: { amount: 125000, merchant: 'E2E Guard Merchant' } },
      },
    });
    expect(approve.ok()).toBe(true);

    // 3. POST notifikasi hasil review — sertakan konten forjaan untuk membuktikan
    //    payload operator TIDAK mengambil field body client.
    const resp = await request.post(`${GUARD_API}/api/notifications`, {
      headers: authHeaders(),
      data: {
        type: 'success',
        priority: 'low',
        title: 'Transaksi Gmail diterima',
        message: 'E2E Guard Merchant Rp 125.000 berhasil disimpan ke daftar transaksi.',
        dedupeKey: `gmail-review-${messageId}`,
        metadata: {
          source: 'gmail_review',
          emailId: messageId,
          result: 'approved',
          merchant: 'ATTACKER-INJECTED-MERCHANT',
          amount: 999999,
          errorMessage: 'konten forjaan tidak boleh bocor',
        },
      },
    });
    expect(resp.status()).toBe(200);

    // 4. Webhook operator terkirim dengan konten DISARING dari log server.
    await expect.poll(async () => (await sinkPayloads()).length, { timeout: 10_000 }).toBeGreaterThan(0);
    const payloads = await sinkPayloads();
    const hook = payloads.find((p) => p.body?.event === 'gmail.review.result');
    expect(hook, 'webhook gmail.review.result harus terkirim untuk alur sah').toBeTruthy();
    expect(hook?.body?.user?.id).toBe(session.userId);
    expect(hook?.body?.result).toMatchObject({
      status: 'approved',
      emailId: messageId,
      merchant: 'E2E Guard Merchant', // dari candidate log server, bukan body client
      amount: 125000,
      message: null,
    });
    // Konten forjaan tidak boleh bocor ke channel operator.
    const raw = JSON.stringify(hook?.body);
    expect(raw).not.toContain('ATTACKER-INJECTED-MERCHANT');
    expect(raw).not.toContain('999999');
    expect(raw).not.toContain('konten forjaan tidak boleh bocor');
  });

  test('metadata invalid ditolak 400 dengan pesan jelas', async ({ request }) => {
    const base = { type: 'info', title: 't', message: 'm' };

    const notObject = await request.post(`${GUARD_API}/api/notifications`, {
      headers: authHeaders(),
      data: { ...base, metadata: 'bukan-objek' },
    });
    expect(notObject.status()).toBe(400);
    expect(((await notObject.json()) as { error?: string }).error).toBeTruthy();

    const oversized = await request.post(`${GUARD_API}/api/notifications`, {
      headers: authHeaders(),
      data: { ...base, metadata: { blob: 'x'.repeat(20_000) } },
    });
    expect(oversized.status()).toBe(400);
    expect(((await oversized.json()) as { error?: string }).error).toBeTruthy();
  });
});
