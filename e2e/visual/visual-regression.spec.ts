/**
 * E2E: Visual regression (P3.11 — dari VISUAL_REGRESSION_PLAN.md).
 *
 * Snapshot Playwright untuk deteksi regresi visual:
 *   - Theme: light + dark (localStorage 'cashflow-theme' via helper setTheme)
 *   - Viewport: desktop 1440×900 + mobile 390×844 (loop di dalam test)
 *   - Baseline di-commit ke e2e/visual/__screenshots__/
 *
 * Halaman yang di-snapshot (above-the-fold, fullPage:false):
 *   - Landing (publik, tanpa auth)   — statis, baseline paling stabil
 *   - Dashboard (auth via cookie)    — data-driven: angka di-mask biar stabil
 *   - Transactions (auth)            — data-driven: nominal & counter di-mask
 *   - Gmail Sync (auth)              — data-driven: summary counts + email list di-mask
 *
 * Anti-flaky:
 *   - fonts.ready + animasi disabled + caret hide
 *   - maxDiffPixelRatio 0.02 (font AA/antialiasing)
 *   - region angka dinamis di-mask (stat cards dashboard, nominal/counter transactions,
 *     summary counts + email cards gmail sync)
 *   - Banner "Gemini AI siap digunakan" bergantung pada API key server (env lokal vs CI
 *     bisa beda) → di-deterministikan via route interception /api/gemini/health (mock ok)
 *
 * Menjalankan (generate baseline):
 *   npx playwright test e2e/visual/visual-regression.spec.ts --update-snapshots
 * Menjalankan (verify diff):
 *   npm run test:e2e:visual
 */
import fs from 'node:fs';
import path from 'node:path';
import { test, expect } from 'playwright/test';
import {
  mintSessionCookie,
  mintSessionCookieForEmail,
  cleanupTestSessions,
  createE2eTursoClient,
  seedRecommendationFixtures,
  cleanupRecommendationFixtures,
  seedFeedbackRateFixtures,
  cleanupFeedbackRateFixtures,
  seedAICostTrendFixtures,
  cleanupAICostTrendFixtures,
  seedRetentionFixtures,
  cleanupRetentionFixtures,
} from '../helpers/mintSession';
import { setupAuthContext } from '../helpers/authContext';
import { collectPageErrors } from '../helpers/errors';
import { setTheme, waitForTheme, type VisualTheme } from '../helpers/theme';
import { bellButton, waitRealtimeConnected } from '../helpers/realtime';

const DESKTOP = { width: 1440, height: 900 };
const MOBILE = { width: 390, height: 844 };
const THEMES: VisualTheme[] = ['light', 'dark'];

/** Render + tunggu stabil, lalu screenshot (masked region angka). */
async function snapshotPage(
  page: import('playwright/test').Page,
  opts: {
    name: string;
    theme: VisualTheme;
    mask?: import('playwright/test').Locator[];
    mobile?: boolean;
  },
): Promise<void> {
  await waitForTheme(page, opts.theme);
  // Tunggu font self-hosted selesai dimuat (bukan timer tetap) — font swap
  // tengah-screenshot = flaky. Font lokal (public/fonts) cepat, tapi robustness
  // lebih baik daripada waitForTimeout: replace font → render stabil.
  await page.evaluate(() => document.fonts.ready);
  await page.waitForTimeout(300); // skeleton → konten stabil
  await expect(page).toHaveScreenshot(opts.name, {
    animations: 'disabled',
    caret: 'hide',
    fullPage: false,
    maxDiffPixelRatio: 0.02,
    ...(opts.mask ? { mask: opts.mask } : {}),
  });
}

test.describe('Visual regression @visual', () => {
  let session: { cookie: string; userId: string };

  test.beforeAll(async () => {
    session = await mintSessionCookie();
  });

  test.afterAll(async () => {
    await cleanupTestSessions();
  });

  for (const theme of THEMES) {
    test(`landing ${theme} desktop`, async ({ page }) => {
      await setTheme(page.context(), theme);
      const pageErrors = collectPageErrors(page);
      await page.setViewportSize(DESKTOP);
      await page.goto('/landing');
      await page.waitForLoadState('domcontentloaded');
      await expect(page.locator('body')).toBeVisible();
      await snapshotPage(page, { name: `landing-${theme}-desktop.png`, theme });
      pageErrors.expectClean();
    });

    test(`landing ${theme} mobile`, async ({ page }) => {
      await setTheme(page.context(), theme);
      const pageErrors = collectPageErrors(page);
      await page.setViewportSize(MOBILE);
      await page.goto('/landing');
      await page.waitForLoadState('domcontentloaded');
      await expect(page.locator('body')).toBeVisible();
      await snapshotPage(page, { name: `landing-${theme}-mobile.png`, theme, mobile: true });
      pageErrors.expectClean();
    });
  }

  test('dashboard light desktop — stat cards dimask (data-driven)', async ({ page, context }) => {
    await setTheme(context, 'light');
    await setupAuthContext(context, session);
    const pageErrors = collectPageErrors(page);
    await page.setViewportSize(DESKTOP);
    await page.goto('/dashboard');
    await page.waitForLoadState('domcontentloaded');
    await expect(page.getByText('Arus Kas Bersih', { exact: true }).first()).toBeVisible();

    // Mask region angka dinamis (stat cards) — data berubah, layout tidak.
    // P2.5: "Arus Kas Bersih" menggantikan "Total Saldo"; kartu Saldo Saat Ini
    // punya baris unclassified data-driven (jumlah + nominal) → di-mask.
    const mask = [
      page.locator('text=Arus Kas Bersih').first().locator('xpath=following-sibling::*[1]'),
      page.locator('text=Pemasukan Bulan Ini').first().locator('xpath=following-sibling::*[1]'),
      page.locator('text=Pengeluaran Bulan Ini').first().locator('xpath=following-sibling::*[1]'),
      page.locator('text=Sisa Budget').first().locator('xpath=following-sibling::*[1]'),
      page.getByText(/transaksi belum terhubung ke rekening/),
    ];
    await snapshotPage(page, { name: 'dashboard-light-desktop.png', theme: 'light', mask });
    pageErrors.expectClean();
  });

  test('dashboard dark desktop — stat cards dimask (data-driven)', async ({ page, context }) => {
    await setTheme(context, 'dark');
    await setupAuthContext(context, session);
    const pageErrors = collectPageErrors(page);
    await page.setViewportSize(DESKTOP);
    await page.goto('/dashboard');
    await page.waitForLoadState('domcontentloaded');
    await expect(page.getByText('Arus Kas Bersih', { exact: true }).first()).toBeVisible();

    const mask = [
      page.locator('text=Arus Kas Bersih').first().locator('xpath=following-sibling::*[1]'),
      page.locator('text=Pemasukan Bulan Ini').first().locator('xpath=following-sibling::*[1]'),
      page.locator('text=Pengeluaran Bulan Ini').first().locator('xpath=following-sibling::*[1]'),
      page.locator('text=Sisa Budget').first().locator('xpath=following-sibling::*[1]'),
      page.getByText(/transaksi belum terhubung ke rekening/),
    ];
    await snapshotPage(page, { name: 'dashboard-dark-desktop.png', theme: 'dark', mask });
    pageErrors.expectClean();
  });

  // ── Transactions (auth, data-driven — nominal & counter pagination di-mask) ──
  // Dataset e2e user deterministik (seed 284 tx + cleanup approve/reject tests),
  // tapi nominal & counter tetap di-mask: nomor adalah data, layout adalah desain.
  for (const theme of THEMES) {
    test(`transactions ${theme} desktop — nominal & counter dimask (data-driven)`, async ({ page, context }) => {
      await setTheme(context, theme);
      await setupAuthContext(context, session);
      const pageErrors = collectPageErrors(page);
      await page.setViewportSize(DESKTOP);
      await page.goto('/transactions');
      await page.waitForLoadState('domcontentloaded');
      await expect(page.getByText(/Menampilkan \d+-\d+ dari \d+ transaksi/).first()).toBeVisible();

      // Mask: nominal per baris (p.tabular-nums) + counter pagination (angka dinamis).
      const mask = [
        page.locator('p.tabular-nums'),
        page.getByText(/Menampilkan \d+-\d+ dari \d+ transaksi/),
        page.getByText(/Halaman \d+ dari \d+/).first(),
      ];
      await snapshotPage(page, { name: `transactions-${theme}-desktop.png`, theme, mask });
      pageErrors.expectClean();
    });
  }

  // ── Mobile (auth) — dashboard + transactions — viewport 390px ──
  // Landing mobile sudah ada; authed pages belum punya snapshot mobile.
  // Mask region data-driven identik dengan varian desktop (stat values,
  // nominal tabular-nums, counter pagination) — layout = desain, angka = data.
  for (const theme of THEMES) {
    test(`dashboard ${theme} mobile — stat cards dimask (data-driven)`, async ({ page, context }) => {
      await setTheme(context, theme);
      await setupAuthContext(context, session);
      const pageErrors = collectPageErrors(page);
      await page.setViewportSize(MOBILE);
      await page.goto('/dashboard');
      await page.waitForLoadState('domcontentloaded');
      await expect(page.getByText('Arus Kas Bersih', { exact: true }).first()).toBeVisible({ timeout: 20_000 });
      const mask = [
        page.locator('text=Arus Kas Bersih').first().locator('xpath=following-sibling::*[1]'),
        page.locator('text=Pemasukan Bulan Ini').first().locator('xpath=following-sibling::*[1]'),
        page.locator('text=Pengeluaran Bulan Ini').first().locator('xpath=following-sibling::*[1]'),
        page.locator('text=Sisa Budget').first().locator('xpath=following-sibling::*[1]'),
        page.getByText(/transaksi belum terhubung ke rekening/),
      ];
      await snapshotPage(page, { name: `dashboard-${theme}-mobile.png`, theme, mask, mobile: true });
      await expectNoPageHorizontalOverflow(page);
      pageErrors.expectClean();
    });

    test(`transactions ${theme} mobile — nominal & counter dimask (data-driven)`, async ({ page, context }) => {
      await setTheme(context, theme);
      await setupAuthContext(context, session);
      const pageErrors = collectPageErrors(page);
      await page.setViewportSize(MOBILE);
      await page.goto('/transactions');
      await page.waitForLoadState('domcontentloaded');
      await expect(page.getByText(/Menampilkan \d+-\d+ dari \d+ transaksi/).first()).toBeVisible({ timeout: 20_000 });
      const mask = [
        page.locator('p.tabular-nums'),
        page.getByText(/Menampilkan \d+-\d+ dari \d+ transaksi/),
        page.getByText(/Halaman \d+ dari \d+/).first(),
      ];
      await snapshotPage(page, { name: `transactions-${theme}-mobile.png`, theme, mask, mobile: true });
      await expectNoPageHorizontalOverflow(page);
      pageErrors.expectClean();
    });
  }

  // ── Gmail Sync (auth, data-driven — summary counts & email list di-mask) ──
  // Banner Gemini health env-dependent (API key server lokal vs CI) → route
  // interception mock ok:true agar baseline lokal == CI (banner + layout di bawahnya
  // identik). Summary counts + email cards (data-testid^=email-card-) + counter
  // "Menampilkan X-Y dari N email" di-mask (data, bukan desain).
  for (const theme of THEMES) {
    test(`gmail-sync ${theme} desktop — summary counts & email list dimask (data-driven)`, async ({ page, context }) => {
      await setTheme(context, theme);
      await setupAuthContext(context, session);
      // Deterministikkan banner Gemini health (env-dependent) — mock ok:true.
      await page.route('**/api/gemini/health**', (route) =>
        route.fulfill({ json: { ok: true, status: 'ok', message: 'E2E mock health' } }),
      );
      // P2.3.8 — auto-sync checker (getGmailSyncSettings → /api/gmail/settings)
      // menjalankan scan nyata saat mount jika autoSyncEnabled && scan jatuh
      // tempo (env-dependent) → banner progress/result bergeser antar-run
      // (flake first-attempt gmail-sync light ×2). Mock matikan auto-sync:
      // toggle OFF deterministik + tidak ada scan otomatis — layout stabil.
      await page.route('**/api/gmail/settings**', (route) =>
        route.fulfill({ json: { autoSyncEnabled: false, syncIntervalMinutes: 60 } }),
      );
      const pageErrors = collectPageErrors(page);
      await page.setViewportSize(DESKTOP);
      await page.goto('/gmail-sync');
      await page.waitForLoadState('domcontentloaded');
      await expect(page.getByText('Diterima', { exact: true }).first()).toBeVisible();
      // Deterministikkan state SSE sebelum snapshot: WifiOff (belum connect) vs
      // terhubung mengubah header. Gate yang sama dipakai spec review realtime.
      await waitRealtimeConnected(bellButton(page));

      // ── Region DATA-DRIVEN disembunyikan (display:none) — terbukti CI #4-#6 ──
      // 1. AutoSync card (data-testid=autosync-status): settings + riwayat sync
      //    (toggle ON/OFF mengubah STRUKTUR card, tanggal, count dinamis). Tinggi
      //    card env-dependent (dev DB riil vs CI DB seed) → meski di-mask, konten
      //    di bawahnya bergeser (mask tidak menahan layout shift) → diff massif.
      // 2. Email cards ([data-testid^=email-card-]): TINGGI per-card tergantung
      //    konten (subjek email dev 2 baris vs seed 1 baris) → blok mask tidak
      //    sejajar antar-env (analisis diff PNG CI #6: gap y=680 di baseline).
      // Keduanya PURE data-driven → display:none DI TEST berlaku identik saat
      // generate baseline maupun check CI → layout di sekitarnya selalu sejajar.
      // Coverage list/card dipertahankan via spec fungsional (gmail-sync.spec.ts).
      await expect(page.locator('[data-testid="autosync-status"]')).toBeVisible();
      await page.addStyleTag({
        content:
          '[data-testid="autosync-status"]{display:none !important} ' +
          '[data-testid^="email-card-"]{display:none !important}',
      });

      // Mask: nilai summary (label → following-sibling value) + counter pagination.
      // Label pakai anchored regex (bukan substring) agar tidak salah tangkap badge
      // 'Diterima Otomatis' / tombol filter 'Config Error' / riwayat 'Diterima:'.
      // notification-badge = jumlah unread (dinamis per env).
      const mask = [
        page.locator('text=/^Diterima$/').first().locator('xpath=following-sibling::*[1]'),
        page.locator('text=/^Perlu Review$/').first().locator('xpath=following-sibling::*[1]'),
        page.locator('text=/^Dilewati\\/Ditolak$/').first().locator('xpath=following-sibling::*[1]'),
        page.locator('text=/^Error$/').first().locator('xpath=following-sibling::*[1]'),
        page.getByText(/Menampilkan \d+-\d+ dari \d+ email/),
        page.locator('[data-testid="notification-badge"]'),
      ];
      await snapshotPage(page, { name: `gmail-sync-${theme}-desktop.png`, theme, mask });
      pageErrors.expectClean();
    });
  }

  // ── Reports (auth, data-driven — nominal & chart di-mask) ──
  // P2.2 determinisme: AI Monthly Report card meng-generate report via
  // POST /api/gemini/monthly-report (async, bisa gagal → fallback local).
  // Tinggi card bergantung isi report (Gemini vs fallback) → chart bergeser →
  // mask .recharts-wrapper di posisi beda → baseline tidak stabil. Mock
  // payload FIXED (pola sama dengan mock /api/gemini/health di dashboard)
  // supaya tinggi card IDENTIK di semua env/run.
  const FIXED_MONTHLY_REPORT = {
    success: true,
    report: {
      summary: 'Ringkasan finansial periode ini: pengeluaran terkendali dengan saldo positif dan tabungan bertambah.',
      cashflowHealth: 'Sehat',
      financialHealthScore: 82,
      savingOpportunities: ['Kurangi langganan streaming', 'Masak di rumah lebih sering'],
      unusualSpending: ['Pengeluaran transportasi lebih tinggi dari biasanya'],
      topRisks: ['Potensi overspend di kategori Makanan'],
      recommendations: ['Alokasikan 20% pemasukan ke tabungan'],
      positiveNotes: ['Pemasukan stabil selama periode ini'],
      generatedBy: 'gemini',
      generatedAt: '2026-08-09T00:00:00.000Z',
    },
  };
  for (const theme of THEMES) {
    test(`reports ${theme} desktop — nominal & chart dimask (data-driven)`, async ({ page, context }) => {
      await setTheme(context, theme);
      await setupAuthContext(context, session);
      const pageErrors = collectPageErrors(page);
      await page.setViewportSize(DESKTOP);
      await page.route('**/api/gemini/monthly-report', (route) =>
        route.fulfill({ json: FIXED_MONTHLY_REPORT }),
      );
      await page.goto('/reports');
      await page.waitForLoadState('domcontentloaded');
      await expect(page.getByText('Net Cashflow', { exact: true }).first()).toBeVisible({ timeout: 20_000 });
      await expect(page.locator('.recharts-wrapper').first()).toBeVisible({ timeout: 20_000 });
      // Tunggu AI card settle (loading text hilang) — tinggi card final = layout final.
      await expect(page.getByText('AI sedang membaca pola cashflow bulan ini...')).toHaveCount(0, {
        timeout: 15_000,
      });
      // P2.2 — determinisme: tunggu fade/overlay transisi route (framer-motion
      // rAF, inline opacity) selesai SEBELUM snapshot. `animations:'disabled'`
      // Playwright hanya menahan CSS animation — framer via rAF tidak, sehingga
      // overlay transisi tertangkap (render "purple tint" — flake teramati).
      await page.evaluate(async () => {
        const deadline = Date.now() + 8000;
        for (;;) {
          let mid = 0;
          for (const el of document.querySelectorAll('*')) {
            const inline = (el as HTMLElement).style?.opacity;
            if (inline) {
              const op = parseFloat(inline);
              if (Number.isFinite(op) && op > 0 && op < 1) { mid++; break; }
            }
          }
          if (mid === 0) return;
          if (Date.now() > deadline) throw new Error('Route transition overlay did not settle in 8s');
          await new Promise((r) => setTimeout(r, 100));
        }
      });
      // Mask: nominal summary (tabular-nums) + chart (recharts-wrapper) — data
      // berubah per dataset, layout adalah desain.
      const mask = [page.locator('p.tabular-nums'), page.locator('.recharts-wrapper')];
      await snapshotPage(page, { name: `reports-${theme}-desktop.png`, theme, mask });
      pageErrors.expectClean();
    });
  }
});

// ── AI Timeline (auth — event list DETERMINISTIK: seed e2e-visual-tl-*) ──
// User DEDIKASI (email e2e-visual-tl@) supaya baseline tidak bergantung pada
// akumulasi event user lain di DB dev; delete-first di beforeAll membuat seed
// idempoten walau run sebelumnya mati di tengah; cleanup di afterAll.
const VISUAL_TL_USER = 'e2e-visual-tl@cashflow.test';

/** [id, feature, eventType, status, title, body, confidence, payload, createdAt (UTC, > minggu lalu → group 'Sebelumnya')] */
const VISUAL_TIMELINE: Array<[string, string, string, string, string, string, number | null, Record<string, unknown>, string]> = [
  ['e2e-visual-tl-1', 'insight', 'insight', 'viewed', 'Pengeluaran makanan naik 12%', 'Body deterministik visual — insight.', 0.82, { periodDays: 7, expense: 420000, topCategory: 'Makanan' }, '2026-05-20 09:00:00'],
  ['e2e-visual-tl-2', 'advisor', 'recommendation', 'new', 'Kurangi langganan tidak terpakai', 'Body deterministik visual — rekomendasi.', 0.71, { windowDays: 7, shoppingExpense: 168000 }, '2026-05-19 09:00:00'],
  ['e2e-visual-tl-3', 'conversation', 'conversation', 'completed', 'Bagaimana cara menabung lebih?', 'Body deterministik visual — percakapan.', null, { periodDays: 30 }, '2026-05-18 09:00:00'],
];

function loadEnv(): void {
  // Pola spec lain: baca server/.env untuk URL/token Turso bila env proses
  // belum di-set (config isolated sudah meng-export env via globalSetup).
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

async function withVisualTurso<T>(fn: (turso: Awaited<ReturnType<typeof createE2eTursoClient>>) => Promise<T>): Promise<T> {
  loadEnv();
  const turso = await createE2eTursoClient();
  try {
    return await fn(turso);
  } finally {
    turso.close();
  }
}

async function seedVisualTimelineFixtures(userId: string): Promise<void> {
  await withVisualTurso(async (turso) => {
    // Delete-first (idempoten): leftover run mati tidak menggandakan event.
    await turso.execute({ sql: `DELETE FROM ai_timeline WHERE id LIKE 'e2e-visual-tl-%'`, args: [] });
    // FK ai_timeline.user_id → users(id) PLURAL (pola tabel bisnis CashFlow) —
    // mintSessionCookieForEmail hanya membuat `user` (singular better-auth);
    // tanpa baris `users` INSERT ai_timeline kena FK violation. DELETE dulu
    // baris `users` email ini: cleanupTestSessions menghapus `user` singular
    // (e2e- prefiks) tapi TIDAK baris `users` → run berikutnya punya id baru
    // (random) dan INSERT kena UNIQUE(email). User ini khusus e2e → aman dihapus.
    await turso.execute({ sql: `DELETE FROM users WHERE email = ?`, args: [VISUAL_TL_USER] });
    await turso.execute({
      sql: `INSERT INTO users (id, email, name, display_name)
            VALUES (?, ?, 'E2E Visual TL', 'E2E Visual TL')`,
      args: [userId, VISUAL_TL_USER],
    });
    for (const [id, feature, eventType, status, title, body, confidence, payload, createdAt] of VISUAL_TIMELINE) {
      await turso.execute({
        sql: `INSERT INTO ai_timeline (id, user_id, feature, event_type, status, title, body, confidence, payload, created_at)
              VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        args: [id, userId, feature, eventType, status, title, body, confidence, JSON.stringify(payload), createdAt],
      });
    }
  });
}

async function cleanupVisualTimelineFixtures(): Promise<void> {
  await withVisualTurso(async (turso) => {
    await turso.execute({ sql: `DELETE FROM ai_timeline WHERE id LIKE 'e2e-visual-tl-%'`, args: [] });
  });
}

test.describe('Visual regression @visual — AI Timeline (deterministik)', () => {
  let tlSession: { cookie: string; userId: string };

  test.beforeAll(async () => {
    tlSession = await mintSessionCookieForEmail(VISUAL_TL_USER);
    await seedVisualTimelineFixtures(tlSession.userId);
  });

  test.afterAll(async () => {
    await cleanupVisualTimelineFixtures();
    await cleanupTestSessions();
  });

  for (const theme of THEMES) {
    test(`ai-timeline ${theme} desktop — list event seed deterministik`, async ({ page, context }) => {
      await setTheme(context, theme);
      await setupAuthContext(context, tlSession);
      const pageErrors = collectPageErrors(page);
      await page.setViewportSize(DESKTOP);
      await page.goto('/ai/timeline');
      await page.waitForLoadState('domcontentloaded');
      await expect(page.getByRole('heading', { name: /Perjalanan finansialmu bersama AI/ })).toBeVisible({ timeout: 20_000 });
      // Tunggu event seed benar-benar render (bukan skeleton/empty state).
      await expect(page.getByRole('button', { name: 'Lihat detail Pengeluaran makanan naik 12%' })).toBeVisible({ timeout: 20_000 });
      await snapshotPage(page, { name: `ai-timeline-${theme}-desktop.png`, theme });
      pageErrors.expectClean();
    });
  }
});

// ── Admin Monitoring (auth admin — metrics seed deterministik, chart/nilai dimask) ──
test.describe('Visual regression @visual — Admin Monitoring (deterministik)', () => {
  let adminSession: { cookie: string; userId: string };

  test.beforeAll(async () => {
    adminSession = await mintSessionCookie();
    // Seed DETERMINISTIK untuk panel (id prefiks e2e-reco-/e2e-fr-/e2e-usage-/
    // e2e-ret-*) — tanpa ini panel kosong (EmptyMini) → baseline kurang bermakna.
    await seedRecommendationFixtures(adminSession.userId);
    await seedFeedbackRateFixtures(adminSession.userId);
    await seedAICostTrendFixtures(adminSession.userId);
    await seedRetentionFixtures();
  });

  test.afterAll(async () => {
    await cleanupRecommendationFixtures();
    await cleanupFeedbackRateFixtures();
    await cleanupAICostTrendFixtures();
    await cleanupRetentionFixtures();
    await cleanupTestSessions();
  });

  for (const theme of THEMES) {
    test(`admin-monitoring ${theme} desktop — chart & nilai dimask`, async ({ page, context }) => {
      await setTheme(context, theme);
      await setupAuthContext(context, adminSession);
      const pageErrors = collectPageErrors(page);
      await page.setViewportSize(DESKTOP);
      await page.goto('/admin/monitoring');
      await page.waitForLoadState('domcontentloaded');
      await expect(page.getByText('Rekomendasi AI', { exact: true }).first()).toBeVisible({ timeout: 20_000 });
      // Mask chart (recharts) + semua nilai numerik (tabular-nums) — data per
      // env berbeda, layout panel adalah desain.
      const mask = [page.locator('.recharts-wrapper'), page.locator('[class*="tabular-nums"]')];
      await snapshotPage(page, { name: `admin-monitoring-${theme}-desktop.png`, theme, mask });
      pageErrors.expectClean();
    });
  }
});

// ── AI Hub (auth — dedicated user + transaksi seed DETERMINISTIK) ──
// AI Hub menghitung insight/skor/simulasi CLIENT-SIDE dari transaksi bulan
// berjalan (getCurrentMonth). User DEDIKASI + seed tanggal 1..11 bulan berjalan
// (relatif now saat seed) → metrics bulan ini SELALU terisi & identik antar-run
// dalam bulan yang sama; label bulan di summary + timestamp AiTrustMeta
// (generatedAt = now) adalah satu-satunya variabel → di-mask.
const AIHUB_USER = 'e2e-visual-aihub@cashflow.test';

/** [type, amount, categoryName, merchant, dayOfMonth] — day 1..11 selalu ada
    di bulan berjalan → deterministik apa pun tanggal run. */
const AIHUB_TX: Array<[string, number, string, string, number]> = [
  ['income', 8_500_000, 'Gaji', 'PT Maju Jaya', 1],
  ['income', 1_200_000, 'Freelance', 'Upwork', 3],
  ['expense', 1_850_000, 'Makanan', 'GoFood', 2],
  ['expense', 350_000, 'Transportasi', 'Gojek', 4],
  ['expense', 2_400_000, 'Rumah', 'Indomaret', 5],
  ['expense', 150_000, 'Hiburan', 'Netflix', 6],
  ['expense', 500_000, 'Makanan', 'GoFood', 8],
  ['expense', 75_000, 'Lainnya', 'Minimarket', 9],
  ['refund', 250_000, 'Refund', 'Tokopedia', 10],
  ['transfer', 600_000, 'Transfer', 'Blu', 11],
];

async function seedAiHubFixtures(userId: string): Promise<void> {
  await withVisualTurso(async (turso) => {
    // Delete-first (idempoten): leftover run mati tidak menggandakan transaksi.
    await turso.execute({ sql: `DELETE FROM transactions WHERE id LIKE 'e2e-visual-aihub-tx-%'`, args: [] });
    // FK transactions.user_id → users(id) PLURAL — mintSessionCookieForEmail
    // hanya membuat `user` (singular better-auth); tanpa baris `users` INSERT
    // transaksi kena FK violation (pola seedVisualTimelineFixtures).
    await turso.execute({ sql: `DELETE FROM users WHERE email = ?`, args: [AIHUB_USER] });
    await turso.execute({
      sql: `INSERT INTO users (id, email, name, display_name)
            VALUES (?, ?, 'E2E Visual AI Hub', 'E2E Visual AI Hub')`,
      args: [userId, AIHUB_USER],
    });
    const now = new Date();
    const year = now.getFullYear();
    const month = now.getMonth() + 1;
    const iso = (day: number) => {
      // Noon UTC → tanggal lokal tidak pernah lompat ke hari sebelumnya
      // (TZ ±14) → bulan berjalan selalu cocok dengan getCurrentMonth() client.
      const d = new Date(Date.UTC(year, month - 1, day, 12, 0, 0));
      return d.toISOString().slice(0, 10);
    };
    const nowIso = new Date().toISOString();
    for (const [i, [type, amount, categoryName, merchant, day]] of AIHUB_TX.entries()) {
      const date = iso(day);
      await turso.execute({
        sql: `INSERT INTO transactions
              (id, user_id, type, amount, category_id, category_name, merchant,
               payment_method, note, date, transaction_date, source, created_at, updated_at)
              VALUES (?, ?, ?, ?, 'cat-aihub', ?, ?, 'cash', ?, ?, ?, 'manual', ?, ?)`,
        args: [
          `e2e-visual-aihub-tx-${String(i + 1).padStart(2, '0')}`, userId, type, amount,
          categoryName, merchant, `seed ${i + 1}`, date, date, nowIso, nowIso,
        ],
      });
    }
  });
}

async function cleanupAiHubFixtures(): Promise<void> {
  await withVisualTurso(async (turso) => {
    await turso.execute({ sql: `DELETE FROM transactions WHERE id LIKE 'e2e-visual-aihub-tx-%'`, args: [] });
    await turso.execute({ sql: `DELETE FROM users WHERE email = ?`, args: [AIHUB_USER] });
  });
}

/** Assert tidak ada page-level horizontal overflow (guard GAP #3/#5 — body
    overflow-x:hidden MENYEMBUNYIKAN scroll, tapi scrollWidth tetap mengukur
    konten yang sebenarnya over-width; assertion ini menolak overflow nyata). */
async function expectNoPageHorizontalOverflow(page: import('playwright/test').Page): Promise<void> {
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  expect(overflow, `Page-level horizontal overflow ${overflow}px (harus ≤ 1)`).toBeLessThanOrEqual(1);
}

test.describe('Visual regression @visual — AI Hub mobile (dedicated user, deterministik)', () => {
  let aiHubSession: { cookie: string; userId: string };

  test.beforeAll(async () => {
    aiHubSession = await mintSessionCookieForEmail(AIHUB_USER);
    await seedAiHubFixtures(aiHubSession.userId);
  });

  test.afterAll(async () => {
    await cleanupAiHubFixtures();
    await cleanupTestSessions();
  });

  for (const theme of THEMES) {
    test(`ai-hub ${theme} mobile — insight & skor dari seed deterministik`, async ({ page, context }) => {
      await setTheme(context, theme);
      await setupAuthContext(context, aiHubSession);
      const pageErrors = collectPageErrors(page);
      await page.setViewportSize(MOBILE);
      await page.goto('/ai');
      await page.waitForLoadState('domcontentloaded');
      await expect(page.getByRole('heading', { name: 'Dashboard keuangan cerdas kamu' })).toBeVisible({ timeout: 20_000 });
      await expect(page.getByText('Skor Kesehatan Finansial', { exact: true }).first()).toBeVisible({ timeout: 20_000 });
      // Mask: nilai numerik (skor/subscores/simulasi) + summary hero (label
      // bulan + count) + timestamp AiTrustMeta (berubah per-run).
      const mask = [
        page.locator('[class*="tabular-nums"]'),
        page.getByText(/^Laporan /),
        page.getByText(/Diperbarui /),
      ];
      await snapshotPage(page, { name: `ai-hub-${theme}-mobile.png`, theme, mask, mobile: true });
      await expectNoPageHorizontalOverflow(page);
      pageErrors.expectClean();
    });
  }
});
