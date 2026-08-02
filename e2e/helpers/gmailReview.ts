/**
 * Helpers E2E BERSAMA untuk spec Gmail Sync "Perlu Review".
 *
 * Mengurangi duplikasi antar 5 spec:
 *   - e2e/gmail-review-approve.spec.ts
 *   - e2e/gmail-review-reject.spec.ts
 *   - e2e/gmail-review-duplicate.spec.ts
 *   - e2e/gmail-review-amount-missing.spec.ts
 *   - e2e/notifications-realtime.spec.ts (bell)
 *
 * Dua helper inti:
 *   1. seedGmailReviewEmail — POST /api/gmail/logs (needs_review + candidate).
 *   2. openReviewFilter     — buka /gmail-sync + filter "Perlu Review" + tunggu
 *                             email test tampil (return locator kartu).
 *
 * CATATAN: helper bell/realtime (bellButton / unreadCountFromLabel /
 * waitRealtimeConnected / assertBellNotification) TIDAK lagi di sini —
 * di-relokasi ke e2e/helpers/realtime.ts (generik, dipakai ulang spec lain).
 */
import { expect, type APIRequestContext, type Locator, type Page } from 'playwright/test';

/** Bentuk minimal sesi hasil mintSessionCookie (cukup cookie untuk seed API). */
export interface MintedSessionLike {
  cookie: string;
}

export interface GmailReviewSeedOptions {
  /** Prefiks messageId unik per spec (mis. 'e2e-review-'). Helper menambahkan timestamp. */
  prefix: string;
  subject?: string;
  sender?: string;
  confidenceScore?: number;
  /**
   * Candidate yang disimpan di metadata. `amount` OPSIONAL — kasus
   * amount-missing TIDAK mengirim amount (menyimulasikan nominal tidak ditemukan).
   */
  candidate: {
    amount?: number;
    merchant?: string;
    category?: string;
    paymentMethod?: string;
    transactionType?: string;
    date?: string;
    confidence?: number;
  };
}

/**
 * Seed email test (status needs_review + metadata.candidate) via POST /api/gmail/logs.
 * Mengembalikan messageId yang dibuat (dipakai tracking & cleanup di spec).
 */
export async function seedGmailReviewEmail(
  request: APIRequestContext,
  session: MintedSessionLike,
  options: GmailReviewSeedOptions,
): Promise<string> {
  const messageId = `${options.prefix}${Date.now()}`;
  const confidence = options.confidenceScore ?? 0.7;

  const resp = await request.post('/api/gmail/logs', {
    headers: { Cookie: `better-auth.session_token=${session.cookie}` },
    data: {
      messageId,
      subject: options.subject ?? `E2E Gmail Review ${Date.now()}`,
      sender: options.sender ?? 'e2e-gmail@example.com',
      emailDate: '2026-08-01T00:00:00.000Z',
      status: 'needs_review',
      finalStatus: 'needs_review',
      confidenceScore: confidence,
      metadata: {
        candidate: {
          ...options.candidate,
          confidence: options.candidate.confidence ?? confidence,
        },
      },
    },
  });
  expect(resp.ok(), 'seed email test via API').toBeTruthy();
  return messageId;
}

/**
 * Buka /gmail-sync, klik filter "Perlu Review", tunggu email test tampil.
 * Return locator kartu email test (siap di-assert / diklik aksinya).
 */
export async function openReviewFilter(page: Page, testMessageId: string): Promise<Locator> {
  await page.goto('/gmail-sync');
  await page.waitForLoadState('domcontentloaded');

  // Tunggu list data tampil dulu (ground truth dari server)
  await page.getByRole('button', { name: 'Perlu Review', exact: true }).click();

  const card = page.getByTestId(`email-card-${testMessageId}`);
  await expect(card).toBeVisible({ timeout: 20_000 });
  return card;
}
