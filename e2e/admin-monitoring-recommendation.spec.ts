/**
 * E2E: Panel "Rekomendasi AI" di Admin Monitoring (P10.2/P10.2c/P10.2d).
 *
 * Regression guard untuk:
 *   1. Endpoint GET /api/admin/metrics/recommendation-engagement —
 *      auth gate (401 tanpa cookie) + shape respons lengkap dengan cookie
 *      admin: { ok, shown, opened, ctr, byFeature[], byDay[], byEventType[] }.
 *   2. UI panel di /admin/monitoring:
 *      - Ringkasan: stat labels Ditampilkan / Dibuka / CTR + badge persen CTR.
 *      - Line chart CTR per hari (byDay) — recharts render ≥ 1 garis.
 *      - Breakdown per feature (advisor & insight dari seed) + per event type.
 *
 * Determinisme data (pola admin-monitoring-chart.spec.ts):
 *   - seedE2eDataset TIDAK mengisi recommendation_shown/opened → sebelum test,
 *     spec men-seed 8 baris fixture (6 shown: advisor×4 + insight×2; 2 opened:
 *     advisor×2; created_at relatif now: 1-5 jam & 26-28 jam lalu sehingga
 *     byDay ≥ 2 hari dan tidak pernah future-dated) via Turso langsung
 *     sehingga panel PASTI punya data. Dihapus di afterAll (prefiks 'e2e-reco-').
 *   - Assertion STRUKTURAL (bukan nilai numerik mutlak): spec lain dalam satu
 *     suite juga bisa menambahkan event rekomendasi (mis. ai-timeline.spec
 *     fire recommendation_shown) — angka total tidak deterministik lintas run.
 *     Yang diverifikasi: labels stat, keberadaan % CTR, garis chart, dan nama
 *     feature/eventType hasil seed WAJIB muncul di breakdown.
 *   - Retry navigasi maks 3× bila panel belum tampil (blip Turso transient —
 *     pola agent-search-engagement.spec.ts).
 *   - Theme via helper setTheme(context, 'light') + reload (pola visual spec);
 *     dark-mode pass: setTheme('dark') + reload + waitForTheme → panel tetap
 *     render (heading, stat, line chart scoped) tanpa pageerror (pola
 *     admin-monitoring-chart.spec.ts).
 *
 * Menjalankan:
 *   npx playwright test e2e/admin-monitoring-recommendation.spec.ts
 *   npm run test:e2e:recommendation-panel
 */
import { test, expect, type APIRequestContext, type APIResponse } from 'playwright/test';
import {
  mintSessionCookie,
  cleanupTestSessions,
  seedRecommendationFixtures,
  cleanupRecommendationFixtures,
  type MintedSession,
} from './helpers/mintSession';
import { setupAuthContext } from './helpers/authContext';
import { collectPageErrors } from './helpers/errors';
import { setTheme, waitForTheme } from './helpers/theme';

const ENGAGEMENT_ENDPOINT = '/api/admin/metrics/recommendation-engagement';

/** GET ke endpoint engagement dengan atau tanpa cookie (relative → via baseURL/proxy). */
async function getEngagement(request: APIRequestContext, cookie?: string): Promise<APIResponse> {
  return request.get(ENGAGEMENT_ENDPOINT, {
    headers: cookie ? { Cookie: `better-auth.session_token=${cookie}` } : {},
  });
}

/** Validasi shape respons recommendation-engagement (semua field wajib ada). */
async function expectEngagementShape(body: Record<string, unknown>): Promise<void> {
  expect(body.ok, 'ok harus true').toBe(true);
  for (const key of ['shown', 'opened', 'ctr']) {
    expect(typeof body[key], `${key} harus number`).toBe('number');
  }
  for (const key of ['byFeature', 'byDay', 'byEventType']) {
    expect(Array.isArray(body[key]), `${key} harus array`).toBe(true);
  }
  const ctr = body.ctr as number;
  expect(ctr, 'ctr harus 0..1').toBeGreaterThanOrEqual(0);
  expect(ctr, 'ctr harus 0..1').toBeLessThanOrEqual(1);
  // byDay elemen wajib punya shown/opened/ctr; byFeature punya feature/count.
  const days = body.byDay as Array<Record<string, unknown>>;
  for (const d of days) {
    expect(typeof d.shown, 'byDay[].shown harus number').toBe('number');
    expect(typeof d.opened, 'byDay[].opened harus number').toBe('number');
    expect(typeof d.ctr, 'byDay[].ctr harus number').toBe('number');
  }
  const features = body.byFeature as Array<Record<string, unknown>>;
  for (const f of features) {
    expect(typeof f.feature, 'byFeature[].feature harus string').toBe('string');
    expect(typeof f.count, 'byFeature[].count harus number').toBe('number');
  }
}

test.describe('Admin "Rekomendasi AI" panel (e2e)', () => {
  let session: MintedSession;

  test.beforeAll(async () => {
    session = await mintSessionCookie();
    // Fixture deterministik: 8 baris recommendation_shown/_opened (created_at
    // relatif now — 1-5 jam & 26-28 jam lalu, byDay ≥ 2 hari) → panel PASTI
    // punya data (tanpa ini system_metrics bisa kosong di CI). Prefiks
    // 'e2e-reco-' dibersihkan di afterAll.
    await seedRecommendationFixtures(session.userId);
  });

  test.afterAll(async () => {
    await cleanupRecommendationFixtures();
    await cleanupTestSessions();
  });

  test.beforeEach(async ({ context }) => {
    await setupAuthContext(context, session);
    await setTheme(context, 'light'); // deterministik: mulai dari light
  });

  test('tanpa cookie: /api/admin/metrics/recommendation-engagement → 401 (bukan 500) — auth gate bekerja', async ({ request }) => {
    const resp = await getEngagement(request);
    expect(resp.status(), 'tanpa cookie harus 401').toBe(401);
  });

  test('dengan cookie admin: endpoint → 200 + ok + shape lengkap (shown/opened/ctr + byFeature/byDay/byEventType)', async ({ request }) => {
    await expect
      .poll(
        async () => {
          const resp = await getEngagement(request, session.cookie);
          if (resp.status() !== 200) return false;
          let body: Record<string, unknown> = {};
          try {
            body = (await resp.json()) as Record<string, unknown>;
          } catch {
            return false;
          }
          return body.ok === true && Array.isArray(body.byDay) && Array.isArray(body.byFeature);
        },
        { timeout: 10_000, intervals: [150, 300, 600, 1200], message: 'engagement endpoint harus 200 + ok setelah blip transient' },
      )
      .toBe(true);

    const final = await getEngagement(request, session.cookie);
    expect(final.status()).toBe(200);
    const body = (await final.json()) as Record<string, unknown>;
    await expectEngagementShape(body);

    // ── Kontrak numerik DETERMINISTIK (P10.2g): ctr = round(opened ÷ shown, 3) ──
    // Berlaku untuk DATASET APA PUN (server selalu menghitung begini) — bukan
    // nilai mutlak, jadi kebal terhadap baris dari spec lain di suite.
    const { shown, opened, ctr } = body as { shown: number; opened: number; ctr: number };
    if (shown > 0) {
      const expectedCtr = Math.round((opened / shown) * 1000) / 1000;
      expect(ctr, `ctr harus round(opened/shown, 3) = ${expectedCtr} (shown=${shown}, opened=${opened})`).toBe(expectedCtr);
    } else {
      expect(ctr, 'tanpa shown → ctr harus 0').toBe(0);
    }

    // Fixture seed WAJIB terlihat: byFeature memuat advisor & insight (seed
    // menambah ≥6 count advisor & ≥2 count insight — total bisa lebih besar
    // bila spec lain men-track rekomendasi, jadi hanya keberadaan yang di-assert).
    const features = (body.byFeature as Array<{ feature: string }>).map((f) => f.feature);
    expect(features).toContain('advisor');
    expect(features).toContain('insight');
    // byEventType memuat recommendation (seed) — item track selalu eventType recommendation.
    const eventTypes = (body.byEventType as Array<{ eventType: string }>).map((e) => e.eventType);
    expect(eventTypes).toContain('recommendation');
  });

  test('panel "Rekomendasi AI" render: stat ringkasan + % CTR + line chart per hari + breakdown feature/eventType — light & dark tanpa pageerror', async ({ page }) => {
    const pageErrors = collectPageErrors(page);

    const panelHeading = page.getByRole('heading', { name: 'Rekomendasi AI' });
    for (let attempt = 0; attempt < 3; attempt++) {
      await page.goto('/admin/monitoring', { waitUntil: 'domcontentloaded' });
      await expect(panelHeading).toBeVisible({ timeout: 6000 }).catch(() => {});
      if (await panelHeading.isVisible()) break;
    }
    await expect(panelHeading).toBeVisible({ timeout: 20_000 });

    // Scope ke CARD panel "Rekomendasi AI" — halaman yang sama punya chart
    // "Tren Biaya" yang JUGA mengeluarkan .recharts-line & label % (Y-axis
    // ticks) → tanpa scoping, assertion bisa lulus dari chart yang salah.
    const panel = panelHeading.locator('xpath=ancestor::div[contains(@class,"rounded-2xl")][1]');

    // ── LIGHT: semua section panel harus render (ringkasan, chart, breakdown) ──
    await assertPanelRendered(panel);

    // ── Konsistensi numerik DETERMINISTIK (P10.2g): nilai % yang dirender di
    // panel harus = round(ctr API × 100) dalam toleransi pembulatan. API & panel
    // memakai jendela yang sama (default 7 hari) → dataset identik. Poll agar
    // render chart selesai sebelum membaca teks nilai CTR.
    const apiBody = await (await getEngagement(page.request, session.cookie)).json();
    const apiCtr = (apiBody as { ctr: number }).ctr;
    const expectedPct = Math.round(apiCtr * 100);
    await expect
      .poll(async () => {
        const el = panel.locator('p.font-black', { hasText: '%' }).first();
        if (!(await el.isVisible())) return null;
        const text = (await el.textContent()) || '';
        const rendered = Number.parseInt(text.replace(/[^0-9]/g, ''), 10);
        return Number.isFinite(rendered) ? rendered : null;
      }, { timeout: 20_000, message: 'nilai CTR % yang dirender harus muncul' })
      .toBeGreaterThanOrEqual(expectedPct - 1);
    const renderedFinal = Number.parseInt(
      ((await panel.locator('p.font-black', { hasText: '%' }).first().textContent()) || '').replace(/[^0-9]/g, ''),
      10,
    );
    expect(
      renderedFinal,
      `rendered % harus ≈ round(ctr API × 100) = ${expectedPct}% (ctr=${apiCtr})`,
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
 * Assert semua bagian panel "Rekomendasi AI" render (dipakai untuk light & dark):
 *   - Ringkasan: stat labels Ditampilkan/Dibuka + nilai CTR persen.
 *   - Line chart CTR per hari (byDay) — scoped ke panel, bukan Tren Biaya.
 *   - Breakdown per feature (seed advisor & insight) + per event type.
 */
async function assertPanelRendered(panel: import('playwright/test').Locator): Promise<void> {
  // ── Ringkasan: stat labels + nilai CTR persen (pola CacheStat) ──
  // Nilai summary CTR = <p class="font-black">33%</p> (CacheStat) — satu-
  // satunya <p font-black> ber-'%' di panel; Y-axis ticks adalah SVG text.
  await expect(panel.getByText('Ditampilkan')).toBeVisible();
  await expect(panel.getByText('Dibuka')).toBeVisible();
  await expect(panel.locator('p.font-black', { hasText: '%' })).toBeVisible();

  // ── Line chart CTR per hari (byDay) — scoped ke panel, bukan Tren Biaya ──
  await expect.poll(
    () => panel.locator('.recharts-line').count(),
    { timeout: 20_000, message: 'line chart CTR per hari harus render di panel' },
  ).toBeGreaterThanOrEqual(1);

  // ── Breakdown per feature (seed advisor & insight) ──
  await expect(panel.getByText('Per Feature')).toBeVisible();
  await expect(panel.getByText('advisor', { exact: true })).toBeVisible();
  await expect(panel.getByText('insight', { exact: true })).toBeVisible();

  // ── Breakdown per event type (P10.2d — seed eventType recommendation) ──
  await expect(panel.getByText('Per Event Type')).toBeVisible();
  await expect(panel.getByText('recommendation', { exact: true })).toBeVisible();
}
