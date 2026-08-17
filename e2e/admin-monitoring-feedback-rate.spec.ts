/**
 * E2E: Panel "Feedback Rate" di Admin Monitoring (P10.2i).
 *
 * Regression guard untuk:
 *   1. Endpoint GET /api/admin/metrics/feedback-rate —
 *      auth gate (401 tanpa cookie) + shape respons lengkap dengan cookie
 *      admin: { ok, feedback, views, rate, byFeature[] }.
 *   2. UI panel di /admin/monitoring:
 *      - Ringkasan: stat labels Feedback / Tampilan Kartu / Rate + nilai % Rate.
 *      - Breakdown per feature (fixture e2e-fr-a & e2e-fr-b dari seed).
 *
 * Determinisme data (pola admin-monitoring-recommendation.spec.ts):
 *   - seedE2eDataset TIDAK mengisi ai_feedback maupun ai_result_shown →
 *     sebelum test, spec men-seed fixture DETERMINISTIK per-feature:
 *        ai_feedback: 4× feature 'e2e-fr-a' + 2× feature 'e2e-fr-b'
 *        ai_result_shown: 10 views 'e2e-fr-a' + 5 views 'e2e-fr-b'
 *     → per-feature rate eksak: e2e-fr-a = 4/10 = 0.4 · e2e-fr-b = 2/5 = 0.4
 *     (feature unik — angka per-feature PASTI, tidak bisa diganggu spec lain).
 *     Dihapus di afterAll (prefiks 'e2e-fr-').
 *   - TOTAL feedback/views/rate TIDAK deterministik lintas run (spec lain
 *     dalam suite bisa menambah ai_result_shown/ai_feedback) → yang di-assert:
 *     kontrak deterministik rate = round(feedback ÷ views, 3) + keberadaan
 *     feature hasil seed di breakdown + nilai per-feature eksak.
 *   - created_at relatif now (1-5 & 26-28 jam lalu) → selalu dalam window
 *     7 hari & tidak pernah future-dated.
 *   - Retry navigasi maks 3× bila panel belum tampil (blip Turso transient).
 *   - Theme via helper setTheme(context, 'light') + reload; dark-mode pass:
 *     setTheme('dark') + reload + waitForTheme → panel tetap render tanpa
 *     pageerror (pola admin-monitoring-chart.spec.ts).
 *
 * Menjalankan:
 *   npx playwright test e2e/admin-monitoring-feedback-rate.spec.ts
 *   npm run test:e2e:feedback-rate-panel
 */
import { test, expect, type APIRequestContext, type APIResponse } from 'playwright/test';
import {
  mintSessionCookie,
  cleanupTestSessions,
  seedFeedbackRateFixtures,
  cleanupFeedbackRateFixtures,
  type MintedSession,
} from './helpers/mintSession';
import { setupAuthContext } from './helpers/authContext';
import { collectPageErrors } from './helpers/errors';
import { setTheme, waitForTheme } from './helpers/theme';

const FEEDBACK_RATE_ENDPOINT = '/api/admin/metrics/feedback-rate';

/** GET ke endpoint feedback-rate dengan atau tanpa cookie (relative → via baseURL/proxy). */
async function getFeedbackRate(request: APIRequestContext, cookie?: string): Promise<APIResponse> {
  return request.get(FEEDBACK_RATE_ENDPOINT, {
    headers: cookie ? { Cookie: `better-auth.session_token=${cookie}` } : {},
  });
}

/** Validasi shape respons feedback-rate (semua field wajib ada). */
async function expectFeedbackRateShape(body: Record<string, unknown>): Promise<void> {
  expect(body.ok, 'ok harus true').toBe(true);
  for (const key of ['feedback', 'views', 'rate']) {
    expect(typeof body[key], `${key} harus number`).toBe('number');
  }
  expect(Array.isArray(body.byFeature), 'byFeature harus array').toBe(true);
  const rate = body.rate as number;
  // rate TIDAK di-clamp 0..1 — feedback bisa > views (mis. 9 fb / 5 views = 1.8 →
  // UI render 180%). Kontrak yang valid: non-negatif + round(fb÷views, 3).
  expect(rate, 'rate harus ≥ 0').toBeGreaterThanOrEqual(0);
  const features = body.byFeature as Array<Record<string, unknown>>;
  for (const f of features) {
    expect(typeof f.feature, 'byFeature[].feature harus string').toBe('string');
    expect(typeof f.feedback, 'byFeature[].feedback harus number').toBe('number');
    expect(typeof f.views, 'byFeature[].views harus number').toBe('number');
    expect(typeof f.rate, 'byFeature[].rate harus number').toBe('number');
    expect(f.rate as number, 'byFeature[].rate harus ≥ 0').toBeGreaterThanOrEqual(0);
  }
}

/** Cari entri byFeature dengan feature tertentu; undefined bila tak ada. */
function findByFeature(body: Record<string, unknown>, feature: string) {
  return (body.byFeature as Array<Record<string, unknown>>).find((f) => f.feature === feature);
}

test.describe('Admin "Feedback Rate" panel (e2e)', () => {
  let session: MintedSession;

  test.beforeAll(async () => {
    session = await mintSessionCookie();
    // Fixture deterministik per-feature (4+2 feedback, 10+5 views) → panel PASTI
    // punya data. Prefiks 'e2e-fr-' dibersihkan di afterAll.
    await seedFeedbackRateFixtures(session.userId);
  });

  test.afterAll(async () => {
    await cleanupFeedbackRateFixtures();
    await cleanupTestSessions();
  });

  test.beforeEach(async ({ context }) => {
    await setupAuthContext(context, session);
    await setTheme(context, 'light'); // deterministik: mulai dari light
  });

  test('tanpa cookie: /api/admin/metrics/feedback-rate → 401 (bukan 500) — auth gate bekerja', async ({ request }) => {
    const resp = await getFeedbackRate(request);
    expect(resp.status(), 'tanpa cookie harus 401').toBe(401);
  });

  test('dengan cookie admin: endpoint → 200 + ok + shape lengkap + per-feature eksak (rate 0.4) + kontrak rate deterministik', async ({ request }) => {
    await expect
      .poll(
        async () => {
          const resp = await getFeedbackRate(request, session.cookie);
          if (resp.status() !== 200) return false;
          let body: Record<string, unknown> = {};
          try {
            body = (await resp.json()) as Record<string, unknown>;
          } catch {
            return false;
          }
          return body.ok === true && Array.isArray(body.byFeature);
        },
        { timeout: 10_000, intervals: [150, 300, 600, 1200], message: 'feedback-rate endpoint harus 200 + ok setelah blip transient' },
      )
      .toBe(true);

    const final = await getFeedbackRate(request, session.cookie);
    expect(final.status()).toBe(200);
    const body = (await final.json()) as Record<string, unknown>;
    await expectFeedbackRateShape(body);

    // ── Kontrak numerik DETERMINISTIK (pola P10.2g): rate = round(fb ÷ views, 3) ──
    // Berlaku untuk DATASET APA PUN — server selalu menghitung begini.
    const { feedback, views, rate } = body as { feedback: number; views: number; rate: number };
    // Sanity seed-landed: fixture wajib ikut ter-agregasi (≥6 feedback, ≥15 views).
    expect(feedback, 'total feedback harus ≥ 6 (fixture seed)').toBeGreaterThanOrEqual(6);
    expect(views, 'total views harus ≥ 15 (fixture seed)').toBeGreaterThanOrEqual(15);
    if (views > 0) {
      const expectedRate = Math.round((feedback / views) * 1000) / 1000;
      expect(rate, `rate harus round(feedback/views, 3) = ${expectedRate} (feedback=${feedback}, views=${views})`).toBe(expectedRate);
    } else {
      expect(rate, 'tanpa views → rate harus 0').toBe(0);
    }

    // ── Fixture per-feature EKSAK (feature unik → deterministik lintas run) ──
    const featA = findByFeature(body, 'e2e-fr-a');
    expect(featA, 'byFeature harus memuat e2e-fr-a (seed)').toBeTruthy();
    expect(featA!.feedback, 'e2e-fr-a feedback harus 4').toBe(4);
    expect(featA!.views, 'e2e-fr-a views harus 10').toBe(10);
    expect(featA!.rate, 'e2e-fr-a rate harus 0.4').toBe(0.4);
    const featB = findByFeature(body, 'e2e-fr-b');
    expect(featB, 'byFeature harus memuat e2e-fr-b (seed)').toBeTruthy();
    expect(featB!.feedback, 'e2e-fr-b feedback harus 2').toBe(2);
    expect(featB!.views, 'e2e-fr-b views harus 5').toBe(5);
    expect(featB!.rate, 'e2e-fr-b rate harus 0.4').toBe(0.4);
  });

  test('panel "Feedback Rate" render: stat ringkasan + nilai % Rate + breakdown per feature — light & dark tanpa pageerror', async ({ page }) => {
    const pageErrors = collectPageErrors(page);

    const panelHeading = page.getByRole('heading', { name: 'Feedback Rate' });
    for (let attempt = 0; attempt < 3; attempt++) {
      await page.goto('/admin/monitoring', { waitUntil: 'domcontentloaded' });
      await expect(panelHeading).toBeVisible({ timeout: 6000 }).catch(() => {});
      if (await panelHeading.isVisible()) break;
    }
    await expect(panelHeading).toBeVisible({ timeout: 20_000 });

    // Scope ke CARD panel "Feedback Rate" — halaman punya panel lain yang juga
    // punya label persen (Rekomendasi AI) → assertion harus di-scope.
    const panel = panelHeading.locator('xpath=ancestor::div[contains(@class,"rounded-2xl")][1]');

    // ── LIGHT: semua section panel harus render ──
    await assertPanelRendered(panel);

    // ── Konsistensi numerik DETERMINISTIK: nilai % Rate yang dirender = Math.round(rate API × 100) ──
    const apiBody = (await (await getFeedbackRate(page.request, session.cookie)).json()) as { rate: number };
    const expectedPct = Math.round(apiBody.rate * 100);
    await expect
      .poll(async () => {
        const el = panel.locator('p.font-black', { hasText: '%' }).first();
        if (!(await el.isVisible())) return null;
        const text = (await el.textContent()) || '';
        const rendered = Number.parseInt(text.replace(/[^0-9]/g, ''), 10);
        return Number.isFinite(rendered) ? rendered : null;
      }, { timeout: 20_000, message: 'nilai Rate % yang dirender harus muncul' })
      .toBeGreaterThanOrEqual(expectedPct - 1);
    const renderedFinal = Number.parseInt(
      ((await panel.locator('p.font-black', { hasText: '%' }).first().textContent()) || '').replace(/[^0-9]/g, ''),
      10,
    );
    expect(
      renderedFinal,
      `rendered % harus ≈ Math.round(rate API × 100) = ${expectedPct}% (rate=${apiBody.rate})`,
    ).toBeLessThanOrEqual(expectedPct + 1);

    // ── DARK: set theme + reload → panel tetap render (pola monitoring-chart) ──
    await setTheme(page.context(), 'dark');
    await page.reload({ waitUntil: 'domcontentloaded' });
    await waitForTheme(page, 'dark');
    await expect(panelHeading).toBeVisible({ timeout: 20_000 });
    const panelDark = panelHeading.locator('xpath=ancestor::div[contains(@class,"rounded-2xl")][1]');
    await assertPanelRendered(panelDark);

    pageErrors.expectClean();
  });
});

/**
 * Assert semua bagian panel "Feedback Rate" render (dipakai untuk light & dark):
 *   - Ringkasan: stat labels Feedback / Tampilan Kartu / Rate + nilai % Rate.
 *   - Breakdown per feature: baris e2e-fr-a ("4 fb · 10 views") & e2e-fr-b
 *     ("2 fb · 5 views") dari seed + badge % rate per feature.
 */
async function assertPanelRendered(panel: import('playwright/test').Locator): Promise<void> {
  // ── Ringkasan: stat labels (pola CacheStat) + nilai % Rate ──
  // Nilai summary Rate = <p class="font-black">40%</p> — satu-satunya
  // <p font-black> ber-'%' di panel (badge per-feature adalah <span>).
  await expect(panel.getByText('Feedback', { exact: true })).toBeVisible();
  await expect(panel.getByText('Tampilan Kartu', { exact: true })).toBeVisible();
  await expect(panel.getByText('Rate', { exact: true })).toBeVisible();
  await expect(panel.locator('p.font-black', { hasText: '%' })).toBeVisible();

  // ── Breakdown per feature: nilai per-feature EKSAK dari seed (unique) ──
  await expect(panel.getByText('Per Feature')).toBeVisible();
  await expect(panel.getByText('4 fb · 10 views')).toBeVisible();
  await expect(panel.getByText('2 fb · 5 views')).toBeVisible();
  // Badge % per feature (span rounded-full, bukan p.font-black)
  await expect(panel.locator('span.rounded-full', { hasText: '40%' }).first()).toBeVisible();
}
