/**
 * E2E: Dogfood alur AI lengkap (AI Hub → AI Timeline → detail → feedback 👍)
 * memakai seed user Dafa (demo@cashflow.test) — repeatable di CI.
 *
 * Alur yang di-dogfood:
 *   1. AI Hub (/ai) — kartu "AI Timeline" menampilkan event yang di-seed +
 *      link "Lihat semua" → telemetry `ai_hub_view` naik.
 *   2. AI Timeline (/ai/timeline) — kartu event tampil → `recommendation_shown`
 *      (denominator CTR) naik.
 *   3. Detail view — evidence payload → `recommendation_opened` (numerator CTR) naik.
 *   4. Feedback 👍 "Membantu" → row ai_feedback (rating helpful) tersimpan.
 *   5. `ai_result_shown` (denominator Feedback Rate) naik di seluruh surface.
 *
 * Verifikasi telemetry LANGSUNG di DB (system_metrics + ai_feedback) — bukan
 * hanya UI — sehingga spes ini benar-benar mengunci pipeline observability
 * (POST /api/ai-product/track → system_metrics; POST /feedback → ai_feedback).
 *
 * User Dafa: email demo@cashflow.test (scripts/seedDemoData.mjs). Spec ini
 * SELF-SUFFICIENT — memakai mintSessionCookieForEmail yang membuat user bila
 * belum ada (CI tanpa seedDemoData: user dibuat; lokal: user seed dipakai
 * ulang). Hanya data MILIK SPEC ini yang dibersihkan (event timeline + feedback
 * + system_metrics baru) — dataset demo Dafa tidak pernah disentuh.
 *
 * Menjalankan:
 *   npx playwright test e2e/ai-dogfood.spec.ts
 *   npm run test:e2e:ai-dogfood
 */
import { test, expect } from 'playwright/test';
import fs from 'node:fs';
import path from 'node:path';
import { createClient } from '@libsql/client';
import { mintSessionCookieForEmail, cleanupTestSessions, createE2eTursoClient, type MintedSession } from './helpers/mintSession';
import { setupAuthContext } from './helpers/authContext';
import { collectPageErrors } from './helpers/errors';

/** Email seed user Dafa (scripts/seedDemoData.mjs — DEMO_EMAIL). */
const DEMO_EMAIL = 'demo@cashflow.test';

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

/** Bungkus koneksi Turso dengan loadEnv + close (pola ai-timeline.spec). */
async function withTurso<T>(fn: (turso: ReturnType<typeof createClient>) => Promise<T>): Promise<T> {
  loadEnv();
  const turso = await createE2eTursoClient();
  try {
    return await fn(turso);
  } finally {
    turso.close();
  }
}

/** Jumlah baris system_metrics user untuk satu metric_name. */
async function countMetric(userId: string, metricName: string): Promise<number> {
  return withTurso(async (turso) => {
    const res = await turso.execute({
      sql: 'SELECT COUNT(*) AS n FROM system_metrics WHERE user_id = ? AND metric_name = ?',
      args: [userId, metricName],
    });
    return Number(res.rows[0]?.n) || 0;
  });
}

/** Jumlah row ai_feedback user untuk (item_id, rating) — rating 'helpful' setelah 👍. */
async function countFeedback(userId: string, itemId: string, rating: string): Promise<number> {
  return withTurso(async (turso) => {
    const res = await turso.execute({
      sql: 'SELECT COUNT(*) AS n FROM ai_feedback WHERE user_id = ? AND item_id = ? AND rating = ?',
      args: [userId, itemId, rating],
    });
    return Number(res.rows[0]?.n) || 0;
  });
}

/** Snapshot id system_metrics user SEBELUM flow — dasar cleanup (hapus hanya baris baru). */
async function listSystemMetricIds(userId: string): Promise<string[]> {
  return withTurso(async (turso) => {
    const res = await turso.execute({
      sql: 'SELECT id FROM system_metrics WHERE user_id = ?',
      args: [userId],
    });
    return res.rows.map((r) => String(r.id));
  });
}

/**
 * Self-heal: hapus sisa run SEBELUMNYA yang mati sebelum afterAll (marker title
 * 'E2E Dogfood%'). Tanpa ini, event stale bisa mendorong event baru keluar dari
 * top-5 kartu AI Timeline di hub (listTimeline limit 5) → asersi title gagal.
 * Feedback terkait dihapus dulu (FK), lalu event. Idempoten (0 row bila bersih).
 */
async function cleanupStaleDogfoodRows(): Promise<void> {
  await withTurso(async (turso) => {
    await turso.execute({
      sql: `DELETE FROM ai_feedback WHERE item_id IN (
              SELECT id FROM ai_timeline
              WHERE user_id = (SELECT id FROM user WHERE email = ?)
                AND title LIKE 'E2E Dogfood%'
            )`,
      args: [DEMO_EMAIL],
    });
    await turso.execute({
      sql: `DELETE FROM ai_timeline
            WHERE user_id = (SELECT id FROM user WHERE email = ?)
              AND title LIKE 'E2E Dogfood%'`,
      args: [DEMO_EMAIL],
    });
  });
}

/**
 * Pastikan baris `users` (plural) ada untuk Dafa. mintSessionCookieForEmail
 * HANYA menulis `user` singular — sedangkan tabel bisnis (ai_timeline/
 * ai_feedback) ber-FK ke `users` (pola seedDemoData & mintSessionCookie yang
 * dual-insert). Lokal: Dafa sudah punya dari seedDemoData (no-op). CI: user
 * fresh tanpa `users` → tanpa ini, insert seed/feedback bisa gagal bila Turso
 * mengaktifkan PRAGMA foreign_keys. ON CONFLICT(id) DO NOTHING = idempoten.
 */
async function ensureUsersRow(userId: string): Promise<void> {
  await withTurso(async (turso) => {
    await turso.execute({
      sql: `INSERT INTO users (id, email, name, display_name)
            VALUES (?, ?, 'Dafa Preview', 'Dafa Preview')
            ON CONFLICT(id) DO NOTHING`,
      args: [userId, DEMO_EMAIL],
    });
  });
}

/**
 * Cleanup data dogfood: event timeline + feedback terkait + SEMUA system_metrics
 * baru user (id ∉ baseline) — deterministic. Dataset demo Dafa (id baseline)
 * tidak pernah dihapus. Idempoten.
 */
async function cleanupDogfoodData(userId: string, eventId: string, baselineIds: string[]): Promise<void> {
  await withTurso(async (turso) => {
    await turso.execute({ sql: 'DELETE FROM ai_timeline WHERE id = ?', args: [eventId] });
    await turso.execute({ sql: 'DELETE FROM ai_feedback WHERE item_id = ?', args: [eventId] });
    if (baselineIds.length === 0) {
      // CI: user Dafa fresh (dibuat mintSession) → semua metrics user = milik run ini.
      await turso.execute({ sql: 'DELETE FROM system_metrics WHERE user_id = ?', args: [userId] });
    } else {
      const placeholders = baselineIds.map(() => '?').join(',');
      await turso.execute({
        sql: `DELETE FROM system_metrics WHERE user_id = ? AND id NOT IN (${placeholders})`,
        args: [userId, ...baselineIds],
      });
    }
  });
}

const COOKIE_HEADER = (cookie: string) => ({ Cookie: `better-auth.session_token=${cookie}` });

test.describe('AI Dogfood flow (Dafa)', () => {
  let session: MintedSession;
  let eventId = '';
  let baselineIds: string[] = [];
  let baseline: { hub: number; shown: number; opened: number; result: number };
  const title = `E2E Dogfood Rekomendasi ${Date.now()}`;

  test.beforeAll(async () => {
    // Self-heal: bersihkan sisa run mati (marker) SEBELUM baseline & seed.
    await cleanupStaleDogfoodRows();
    // Dafa (demo@cashflow.test) — dibuat bila belum ada (CI) / dipakai ulang (lokal).
    // Spec menarget by EMAIL (bukan nama) — di CI user fresh ber-nama 'E2E Non-Admin'.
    session = await mintSessionCookieForEmail(DEMO_EMAIL);
    // CI robustness: pastikan row `users` (plural) ada (FK tabel bisnis).
    await ensureUsersRow(session.userId);
    baselineIds = await listSystemMetricIds(session.userId);
    baseline = {
      hub: await countMetric(session.userId, 'ai_hub_view'),
      shown: await countMetric(session.userId, 'recommendation_shown'),
      opened: await countMetric(session.userId, 'recommendation_opened'),
      result: await countMetric(session.userId, 'ai_result_shown'),
    };
  });

  test.afterAll(async () => {
    if (eventId) await cleanupDogfoodData(session.userId, eventId, baselineIds);
    await cleanupTestSessions();
  });

  test.beforeEach(async ({ context }) => {
    await setupAuthContext(context, session);
  });

  test('AI Hub → timeline → detail → feedback 👍 → telemetry bertambah di DB', async ({ page, request }) => {
    const pageErrors = collectPageErrors(page);

    // ── Seed 1 rekomendasi via API (feature advisor → event_type recommendation) ──
    const res = await request.post('/api/ai-product/timeline', {
      headers: COOKIE_HEADER(session.cookie),
      data: {
        feature: 'advisor',
        title,
        body: 'Kurangi pengeluaran GoFood agar cashflow bulan ini aman.',
        confidence: 0.82,
        payload: { periodDays: 7, expense: 150000, topCategory: 'Makanan' },
      },
    });
    expect(res.status(), 'seed timeline harus 201').toBe(201);
    eventId = (await res.json()).id;

    // ── 1. AI Hub (/ai): kartu timeline menampilkan event + link "Lihat semua" ──
    await page.goto('/ai', { waitUntil: 'domcontentloaded' });
    await expect(page.getByRole('heading', { name: 'Dashboard keuangan cerdas kamu' })).toBeVisible({ timeout: 15_000 });
    await expect(page.getByText(title, { exact: false }).first()).toBeVisible();
    await expect(page.getByRole('link', { name: 'Lihat semua' })).toBeVisible();

    // Telemetry: exposure AI Hub naik (StrictMode dev bisa double-fire → poll > baseline).
    await expect
      .poll(async () => (await countMetric(session.userId, 'ai_hub_view')) > baseline.hub, {
        message: 'ai_hub_view harus bertambah setelah buka /ai',
      })
      .toBe(true);

    // ── 2. AI Timeline (/ai/timeline): kartu event → recommendation_shown naik ──
    await page.getByRole('link', { name: 'Lihat semua' }).click();
    await expect(page.getByRole('heading', { name: /Perjalanan finansialmu bersama AI/ })).toBeVisible({ timeout: 15_000 });
    await expect(page.getByText(title, { exact: false }).first()).toBeVisible();

    await expect
      .poll(async () => (await countMetric(session.userId, 'recommendation_shown')) > baseline.shown, {
        message: 'recommendation_shown (denominator CTR) harus bertambah saat rekomendasi dirender',
      })
      .toBe(true);

    // ── 3. Detail view: evidence payload → recommendation_opened naik ──
    await page.getByRole('button', { name: new RegExp(`Lihat detail ${title}`) }).click();
    await expect(page.getByText('Mengapa AI mengatakan ini')).toBeVisible();
    await expect(page.getByText(/150\.000/)).toBeVisible();

    await expect
      .poll(async () => (await countMetric(session.userId, 'recommendation_opened')) > baseline.opened, {
        message: 'recommendation_opened (numerator CTR) harus bertambah saat detail dibuka',
      })
      .toBe(true);

    // ── 4. Feedback 👍 "Membantu" → ai_feedback (rating helpful) tersimpan ──
    const feedbackGroup = page.getByRole('group', { name: new RegExp(`Feedback ${title}`) });
    await feedbackGroup.getByRole('button', { name: 'Membantu', exact: true }).click();
    await expect(page.getByText(/terima kasih/).first()).toBeVisible({ timeout: 10_000 });

    await expect
      .poll(async () => (await countFeedback(session.userId, eventId, 'helpful')) >= 1, {
        message: 'ai_feedback rating helpful harus tersimpan untuk event yang di-dogfood',
      })
      .toBe(true);

    // ── 5. ai_result_shown (denominator Feedback Rate) naik ──
    await expect
      .poll(async () => (await countMetric(session.userId, 'ai_result_shown')) > baseline.result, {
        message: 'ai_result_shown harus bertambah di surface AI yang feedback-capable',
      })
      .toBe(true);

    pageErrors.expectClean();
  });
});
