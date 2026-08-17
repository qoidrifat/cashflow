/**
 * E2E: Panel "Retensi Pengguna" di Admin Monitoring (P10.2b/P10.2k).
 *
 * Regression guard untuk:
 *   1. Endpoint GET /api/admin/metrics/retention — auth gate (401 tanpa cookie)
 *      + shape lengkap: ok / minCohortUsers / totalCohortUsers / totalCohorts /
 *      cohortGuardActive / cohorts[] / days[].
 *   2. UI panel di /admin/monitoring:
 *      - Ringkasan mean D1/D7/D14/D28 (%).
 *      - Tabel cohort-day (tanggal registrasi, jumlah user, kolom D1..D28).
 *      - Guard cohort < 10 user (empty state) di-cover unit test — di sini
 *        fixture ≥ 10 user memastikan jalur DATA tampil.
 *
 * Determinisme data (pola admin-monitoring-chart/recommendation):
 *   - seedRetentionFixtures() menulis 1 cohort 10 user (id/email prefiks
 *     'e2e-ret-', createdAt = hari UTC − 40 hari) + 22 baris user_active
 *     (D+1: 10/10 · D+7: 6/10 · D+14: 4/10 · D+28: 2/10) → rate EKSAK
 *     1.0 / 0.6 / 0.4 / 0.2 (100% / 60% / 40% / 20%). Angka eksak AMAN:
 *     user id 'e2e-ret-u*' unik — spec lain tidak mungkin menulis user_active
 *     untuk user ini, dan tidak ada user lain yang terdaftar pada cohort-day
 *     itu (CI: hanya fixture yang createdAt-nya 40 hari lalu).
 *   - Panel default window 7 hari → cohort 40 hari lalu TIDAK terlihat; spec
 *     mengklik toggle periode "90 Hari" (pola nyata admin melihat retention
 *     dengan window lebar) agar cohort masuk window & semua jendela
 *     D1/D7/D14/D28 tercapai.
 *   - createdAt user ditulis TEXT ISO (bentuk adapter Better Auth riil) → E2E
 *     ini MENG-GUARD query cohort di getRetentionMetrics (normalisasi tipe via
 *     CASE typeof + strftime). Tanpa fix itu user riil (TEXT) selalu tersaring
 *     dari bound numerik (SQLite: INTEGER < TEXT) → retention kosong selamanya
 *     (bug P10.2k, terbukti gagal sebelum fix).
 *   - Dibersihkan di afterAll (cleanupRetentionFixtures: DELETE user +
 *     system_metrics prefiks 'e2e-ret-'). Seed delete-first → idempoten.
 *   - Retry navigasi maks 3× bila panel belum tampil (blip Turso transient —
 *     pola agent-search-engagement.spec.ts).
 *   - Dark-mode pass: setTheme('dark') + reload + waitForTheme → panel tetap
 *     render tanpa pageerror (pola admin-monitoring-chart.spec.ts).
 *
 * Menjalankan:
 *   npx playwright test e2e/admin-monitoring-retention.spec.ts
 *   npm run test:e2e:retention-panel
 */
import { test, expect, type APIRequestContext, type APIResponse } from 'playwright/test';
import {
  mintSessionCookie,
  cleanupTestSessions,
  seedRetentionFixtures,
  cleanupRetentionFixtures,
  type MintedSession,
} from './helpers/mintSession';
import { setupAuthContext } from './helpers/authContext';
import { collectPageErrors } from './helpers/errors';
import { setTheme, waitForTheme } from './helpers/theme';

const RETENTION_ENDPOINT = '/api/admin/metrics/retention';

/**
 * Rentang lebar 90 hari (ISO) — cohort fixture 40 hari lalu HANYA terlihat di
 * window ≥ 40 hari (parseDateRange default 7 hari → cohort terbuang). Mirror
 * perilaku panel setelah klik toggle "90 Hari".
 */
function wideRange(): { from: string; to: string } {
  const to = new Date().toISOString();
  const from = new Date(Date.now() - 90 * 86_400_000).toISOString();
  return { from, to };
}

/** GET ke endpoint retention dengan atau tanpa cookie (relative → via baseURL/proxy). */
async function getRetention(
  request: APIRequestContext,
  cookie?: string,
  range?: { from: string; to: string },
): Promise<APIResponse> {
  const qs = range ? `?from=${encodeURIComponent(range.from)}&to=${encodeURIComponent(range.to)}` : '';
  return request.get(`${RETENTION_ENDPOINT}${qs}`, {
    headers: cookie ? { Cookie: `better-auth.session_token=${cookie}` } : {},
  });
}

/** Validasi shape respons retention (semua field wajib ada). */
async function expectRetentionShape(body: Record<string, unknown>): Promise<void> {
  expect(body.ok, 'ok harus true').toBe(true);
  expect(body.minCohortUsers, 'minCohortUsers harus 10').toBe(10);
  expect(typeof body.totalCohortUsers, 'totalCohortUsers harus number').toBe('number');
  expect(typeof body.totalCohorts, 'totalCohorts harus number').toBe('number');
  expect(typeof body.cohortGuardActive, 'cohortGuardActive harus boolean').toBe('boolean');
  expect(Array.isArray(body.cohorts), 'cohorts harus array').toBe(true);
  expect(Array.isArray(body.days), 'days harus array').toBe(true);
  const days = body.days as Array<{ day: number; users: number; rate: number | null }>;
  expect(days.map((d) => d.day), 'days harus [1, 7, 14, 28]').toEqual([1, 7, 14, 28]);
  for (const d of days) {
    expect(typeof d.users, 'days[].users harus number').toBe('number');
    expect(
      d.rate === null || typeof d.rate === 'number',
      'days[].rate harus number atau null (window belum tercapai)',
    ).toBe(true);
  }
}

test.describe('Admin "Retensi Pengguna" panel (e2e)', () => {
  let session: MintedSession;
  let cohortDay: string;

  test.beforeAll(async () => {
    session = await mintSessionCookie();
    const seed = await seedRetentionFixtures();
    cohortDay = seed.cohortDay;
  });

  test.afterAll(async () => {
    await cleanupRetentionFixtures();
    await cleanupTestSessions();
  });

  test.beforeEach(async ({ context }) => {
    await setupAuthContext(context, session);
    await setTheme(context, 'light'); // deterministik: mulai dari light
  });

  test('tanpa cookie: /api/admin/metrics/retention → 401 (bukan 500) — auth gate bekerja', async ({ request }) => {
    const resp = await getRetention(request);
    expect(resp.status(), 'tanpa cookie harus 401').toBe(401);
  });

  test('dengan cookie admin: endpoint → 200 + ok + shape + cohort seed EKSAK (d1 1.0 / d7 0.6 / d14 0.4 / d28 0.2)', async ({ request }) => {
    // Cohort fixture 40 hari lalu → wajib pakai rentang lebar (90 hari),
    // sama seperti panel setelah toggle "90 Hari" (default 7 hari → terbuang).
    let body: Record<string, unknown> = {};
    await expect
      .poll(
        async () => {
          const resp = await getRetention(request, session.cookie, wideRange());
          if (resp.status() !== 200) return false;
          try {
            body = (await resp.json()) as Record<string, unknown>;
          } catch {
            return false;
          }
          return body.ok === true && Array.isArray(body.cohorts) && body.cohorts.length > 0;
        },
        { timeout: 10_000, intervals: [150, 300, 600, 1200], message: 'retention endpoint harus 200 + ok setelah blip transient' },
      )
      .toBe(true);

    const final = await getRetention(request, session.cookie, wideRange());
    expect(final.status()).toBe(200);
    body = (await final.json()) as Record<string, unknown>;
    await expectRetentionShape(body);

    // Guard OFF karena fixture = 1 cohort × 10 user (>= MIN_COHORT_USERS).
    expect(body.cohortGuardActive, 'fixture ≥ 10 user → guard harus off').toBe(false);

    // ── Kontrak numerik DETERMINISTIK: cohort seed dengan rate EKSAK ──
    // Dataset ini hanya milik fixture (user id 'e2e-ret-*', createdAt 40 hari
    // lalu) — tidak ada spec lain yang bisa ikut menulis baris untuk hari itu.
    const cohorts = (body.cohorts as Array<Record<string, unknown>>).filter((c) => c.day === cohortDay);
    expect(cohorts.length, `cohort ${cohortDay} harus ada`).toBe(1);
    const c = cohorts[0];
    expect(c.users, 'cohort seed harus 10 user').toBe(10);
    for (const [key, expected] of [
      ['d1', 1],
      ['d7', 0.6],
      ['d14', 0.4],
      ['d28', 0.2],
    ] as const) {
      expect(c[key] as number, `cohort.${key} harus ${expected}`).toBeCloseTo(expected, 3);
    }

    // Ringkasan days = mean rate cohort valid — sama dengan nilai cohort.
    const days = (body.days as Array<{ day: number; rate: number | null }>).map((d) => d.rate);
    expect(days[0]).toBeCloseTo(1, 3);
    expect(days[1]).toBeCloseTo(0.6, 3);
    expect(days[2]).toBeCloseTo(0.4, 3);
    expect(days[3]).toBeCloseTo(0.2, 3);
  });

  test('panel "Retensi Pengguna" render: ringkasan D1/D7/D14/D28 + tabel cohort-day — light & dark tanpa pageerror', async ({ page }) => {
    const pageErrors = collectPageErrors(page);

    const panelHeading = page.getByRole('heading', { name: 'Retensi Pengguna' });
    for (let attempt = 0; attempt < 3; attempt++) {
      await page.goto('/admin/monitoring', { waitUntil: 'domcontentloaded' });
      await expect(panelHeading).toBeVisible({ timeout: 6000 }).catch(() => {});
      if (await panelHeading.isVisible()) break;
    }
    await expect(panelHeading).toBeVisible({ timeout: 20_000 });

    // Window default 7 hari TIDAK memuat cohort 40 hari lalu → klik "90 Hari"
    // (pola admin memilih periode lebar untuk melihat retention).
    await page.getByRole('button', { name: '90 Hari' }).click();

    // Scope ke CARD panel "Retensi Pengguna" — halaman yang sama punya panel
    // lain (Rekomendasi AI, Feedback Rate, Prioritas Perbaikan Prompt) yang
    // juga mengeluarkan p.font-black ber-% → scoping wajib.
    const panel = panelHeading.locator('xpath=ancestor::div[contains(@class,"rounded-2xl")][1]');

    // ── LIGHT: ringkasan + tabel harus render dengan data fixture ──
    await assertPanelRendered(panel, cohortDay);

    // ── Konsistensi numerik DETERMINISTIK (pola P10.2g): % yang dirender ≈
    // round(rate API × 100) — panel (window 90 hari) & API memakai dataset
    // yang sama (hanya fixture yang memenuhi cohort ≥ 10) → identik. ──
    const apiBody = (await (await getRetention(page.request, session.cookie, wideRange())).json()) as {
      days: Array<{ day: number; rate: number | null }>;
    };
    for (const offset of [1, 7, 14, 28]) {
      const rate = apiBody.days.find((d) => d.day === offset)?.rate ?? null;
      const expectedPct = rate === null ? null : Math.round(rate * 100);
      if (expectedPct === null) continue;
      await expect
        .poll(
          async () => {
            const el = panel.locator('p.font-black').filter({ hasText: `${expectedPct}%` }).first();
            return (await el.isVisible()) ? expectedPct : null;
          },
          { timeout: 20_000, message: `nilai D${offset} % yang dirender harus muncul` },
        )
        .toBe(expectedPct);
    }

    // ── DARK: set theme + reload → panel tetap render (pola monitoring-chart) ──
    // RELOAD me-reset periode ke default 7 hari (state React hilang) → cohort
    // 40 hari lalu keluar window → klik "90 Hari" LAGI sebelum re-assert.
    await setTheme(page.context(), 'dark');
    await page.reload({ waitUntil: 'domcontentloaded' });
    await waitForTheme(page, 'dark');
    await expect(panelHeading).toBeVisible({ timeout: 20_000 });
    await page.getByRole('button', { name: '90 Hari' }).click();
    const panelDark = panelHeading.locator('xpath=ancestor::div[contains(@class,"rounded-2xl")][1]');
    await assertPanelRendered(panelDark, cohortDay);

    pageErrors.expectClean();
  });
});

/**
 * Assert semua bagian panel "Retensi Pengguna" render (dipakai light & dark):
 *   - Ringkasan: label D1/D7/D14/D28 + nilai % (100/60/40/20 dari fixture).
 *   - Tabel cohort-day: header + baris cohort seed (tanggal, 10 user, D1..D28).
 */
async function assertPanelRendered(panel: import('playwright/test').Locator, cohortDay: string): Promise<void> {
  // ── Ringkasan mean per offset: <p font-black> + label D{day} ──
  const summaryValues = panel.locator('p.font-black');
  await expect.poll(() => summaryValues.count(), { timeout: 20_000, message: '4 ringkasan D1/D7/D14/D28 harus render' }).toBe(4);
  await expect(summaryValues.nth(0)).toHaveText('100%');
  await expect(summaryValues.nth(1)).toHaveText('60%');
  await expect(summaryValues.nth(2)).toHaveText('40%');
  await expect(summaryValues.nth(3)).toHaveText('20%');
  for (const label of ['D1', 'D7', 'D14', 'D28']) {
    await expect(panel.getByText(label, { exact: true }).first()).toBeVisible();
  }

  // ── Tabel cohort-day ──
  await expect(panel.getByText('Cohort (hari)')).toBeVisible();
  const row = panel.locator('tbody tr').first();
  await expect(row).toBeVisible();
  await expect(row).toContainText(cohortDay);
  await expect(row).toContainText('10');
  await expect(row).toContainText('100%');
  await expect(row).toContainText('60%');
  await expect(row).toContainText('40%');
  await expect(row).toContainText('20%');
}
