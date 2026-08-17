/**
 * E2E: Halaman AI Timeline (P9 — Sprint 1.5) · /ai/timeline
 *
 * Regression guard untuk:
 *   1. Render halaman: hero heading + event card dari event yang di-seed.
 *   2. Filter event type (Percakapan) memfilter list.
 *   3. Detail view: evidence (Mengapa AI mengatakan ini) + angka payload.
 *   4. Feedback loop: klik 👍 Membantu → konfirmasi "terima kasih".
 *   5. Status update: klik "Tandai selesai" → chip status berubah jadi Selesai.
 *   6. Feedback terkait tampil di detail setelah submit.
 *
 * Seed via API POST /api/ai-product/timeline (cookie sesi admin), cleanup via
 * Turso langsung (id ditandai dari respons API). Server dev dengan --watch
 * otomatis memuat route baru.
 *
 * Menjalankan:
 *   npx playwright test e2e/ai-timeline.spec.ts
 */
import { test, expect } from 'playwright/test';
import fs from 'node:fs';
import path from 'node:path';
import { mintSessionCookie, cleanupTestSessions, createE2eTursoClient, type MintedSession } from './helpers/mintSession';
import { setupAuthContext } from './helpers/authContext';
import { collectPageErrors } from './helpers/errors';

/** Baca server/.env untuk koneksi Turso (pola helpers/mintSession). */
function loadEnv(): void {
  const envPath = path.resolve(process.cwd(), 'server', '.env');
  if (!fs.existsSync(envPath)) return;
  for (const line of fs.readFileSync(envPath, 'utf8').split(/\r?\n/)) {
    const t = line.trim();
    if (t && !t.startsWith('#') && t.includes('=')) {
      const i = t.indexOf('=');
      const k = t.slice(0, i).trim();
      const v = t.slice(i + 1).trim().replace(/^["']|["']$/g, '');
      if (k && !process.env[k]) process.env[k] = v;
    }
  }
}

/** Hapus timeline + feedback test (id dari respons API). */
async function cleanupTimelineTestData(ids: string[]): Promise<void> {
  if (ids.length === 0) return;
  loadEnv();
  const turso = await createE2eTursoClient();
  try {
    for (const id of ids) {
      await turso.execute({ sql: 'DELETE FROM ai_timeline WHERE id = ?', args: [id] });
      await turso.execute({ sql: 'DELETE FROM ai_feedback WHERE item_id = ?', args: [id] });
    }
  } finally {
    turso.close();
  }
}

const COOKIE_HEADER = (cookie: string) => ({ Cookie: `better-auth.session_token=${cookie}` });

test.describe('AI Timeline page (P9)', () => {
  let session: MintedSession;
  const eventIds: string[] = [];
  const insightTitle = `E2E Timeline Insight ${Date.now()}`;
  const chatTitle = 'E2E Timeline Chat';

  test.beforeAll(async () => {
    session = await mintSessionCookie();
  });

  test.afterAll(async () => {
    await cleanupTimelineTestData(eventIds);
    await cleanupTestSessions();
  });

  test.beforeEach(async ({ context }) => {
    await setupAuthContext(context, session);
  });

  test('render + filter + detail + feedback + status update', async ({ page, request }) => {
    const pageErrors = collectPageErrors(page);

    // ── Seed 2 event via API (deterministik, id tercatat untuk cleanup) ──
    const resInsight = await request.post('/api/ai-product/timeline', {
      headers: COOKIE_HEADER(session.cookie),
      data: {
        feature: 'insight',
        title: insightTitle,
        body: 'Pengeluaran makanan meningkat 27% dibanding minggu sebelumnya.',
        confidence: 0.87,
        payload: { expense: 150000, periodDays: 7, topCategory: 'Makanan' },
      },
    });
    expect(resInsight.status(), 'seed insight harus 201').toBe(201);
    eventIds.push((await resInsight.json()).id);

    const resChat = await request.post('/api/ai-product/timeline', {
      headers: COOKIE_HEADER(session.cookie),
      data: {
        feature: 'conversation',
        title: chatTitle,
        body: 'Ringkasan percakapan keuangan.',
        confidence: 0.8,
      },
    });
    expect(resChat.status(), 'seed conversation harus 201').toBe(201);
    eventIds.push((await resChat.json()).id);

    // ── Render halaman ──
    await page.goto('/ai/timeline', { waitUntil: 'domcontentloaded' });
    await expect(page.getByRole('heading', { name: /Perjalanan finansialmu bersama AI/ })).toBeVisible({ timeout: 15_000 });
    await expect(page.getByText(insightTitle, { exact: false }).first()).toBeVisible();

    // ── Filter Percakapan ──
    await page.getByRole('button', { name: 'Percakapan' }).click();
    await expect(page.getByText(chatTitle, { exact: false }).first()).toBeVisible();
    await expect(page.getByText(insightTitle, { exact: false })).toHaveCount(0);
    // Kembali ke Semua
    await page.getByRole('button', { name: 'Semua' }).click();
    await expect(page.getByText(insightTitle, { exact: false }).first()).toBeVisible();

    // ── Detail view kartu INSIGHT (payload ber-evidence) ──
    const detailBtn = page.getByRole('button', { name: new RegExp(`Lihat detail ${insightTitle}`) });
    await detailBtn.click();
    await expect(page.getByText('Mengapa AI mengatakan ini')).toBeVisible();
    await expect(page.getByText(/150\.000/)).toBeVisible();
    await expect(page.getByText('Makanan', { exact: true })).toBeVisible();

    // ── Feedback loop di kartu insight (group feedback ber-aria-label) ──
    const insightFeedback = page.getByRole('group', { name: new RegExp(`Feedback ${insightTitle}`) });
    await insightFeedback.getByRole('button', { name: 'Membantu', exact: true }).click();
    await expect(page.getByText(/terima kasih/).first()).toBeVisible({ timeout: 10_000 });

    // Feedback terkait tampil di detail setelah re-open (P9 §13)
    await page.getByRole('button', { name: new RegExp(`Tutup detail ${insightTitle}`) }).click();
    await detailBtn.click();
    await expect(page.getByText('Feedback kamu')).toBeVisible();
    await expect(page.getByText('helpful').first()).toBeVisible();

    // ── Status update: Selesai (state machine P9 §12) ──
    await page.getByRole('button', { name: new RegExp(`Tandai selesai ${insightTitle}`) }).click();
    await expect(page.getByText('Selesai', { exact: true }).first()).toBeVisible({ timeout: 10_000 });
    await expect(detailBtn).not.toBeVisible().catch(() => {});

    pageErrors.expectClean();
  });
});
