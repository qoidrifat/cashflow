/**
 * E2E: Accessibility (P1.9 → P2.1) — scan axe-core pada halaman inti.
 *
 * Kebijakan:
 *   - Halaman: 9 — /dashboard · /transactions · /ai · /ai/timeline ·
 *     /admin/monitoring · /suite/ai-search · /reports · /gmail-sync · /privacy
 *     (gmail-sync & privacy ditambahkan P2.3.2)
 *   - Tema: light + dark (P2.1 — kontras wajib lolos dua mode).
 *   - Autentikasi: sesi seed admin via mintSessionCookie + setupAuthContext
 *     (BUKAN bypass auth — admin gate resolveAdmin diuji sebagai jalur nyata).
 *   - Ambang (P2.1): GAGAL pada impact `serious` ke atas — target utama
 *     `color-contrast` = 0. `moderate`/`minor` TIDAK menggagalkan (dilaporkan
 *     sebagai data tren). P1.9 hanya memblokir `critical`; debt contrast
 *     design-system diselesaikan di P2.1 (semantic tokens + opacity scale),
 *     sehingga ambang dinaikkan.
 *   - Determinisme: animasi/transisi di-nonaktifkan via style tag SEBELUM
 *     scan (pola axe docs). Tanpa ini, fade-in framer-motion (opacity < 1)
 *     membuat warna computed = campuran bg card + bg halaman → contrast
 *     "pastel" PALSU (terbukti di quick-actions dashboard P2.1). Tambahan
 *     settle 1.2s setelah style tag: fade JS (rAF framer-motion) selesai →
 *     warna solid.
 *   - Tidak ada rule axe yang di-disable.
 *
 * Menjalankan:
 *   npx playwright test e2e/accessibility.spec.ts
 */
import { test, expect } from 'playwright/test';
import AxeBuilder from '@axe-core/playwright';
import { mintSessionCookie, cleanupTestSessions } from './helpers/mintSession';
import { setupAuthContext } from './helpers/authContext';
import { collectPageErrors } from './helpers/errors';
import { setTheme, type VisualTheme } from './helpers/theme';

/** Ambang blocking: serious ke atas (P2.1 — color-contrast serious = 0). */
const BLOCKING_IMPACTS: string[] = ['serious', 'critical'];
const BLOCKING_SET = new Set<string>(BLOCKING_IMPACTS);

/**
 * Tunggu sampai TIDAK ada elemen di `main` dengan opacity di antara 0 dan 1
 * (fade framer-motion selesai). Axe meng-blend warna saat opacity < 1 →
 * kontras "pastel" palsu. Kondisional (bukan timer): poll opacity computed,
 * timeout 8s → gagal eksplisit dengan konteks jika animasi tak kunjung selesai.
 */
async function waitForFadesToFinish(page: import('playwright/test').Page, timeoutMs = 8000) {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const mid = await page.evaluate(() => {
      // INLINE opacity < 1 (bukan class) = elemen framer-motion yang belum
      // selesai: nilai (0,1) = fade berjalan; nilai "0" = fase DELAY stagger
      // (belum mulai) — keduanya harus ditunggu. Opacity via class (disabled
      // button opacity-50, ikon dekoratif) permanen → dikecualikan (inline
      // kosong) agar tidak false-positive "never settle".
      let count = 0;
      let lowest: { op: number; cls: string } | null = null;
      const root = document.querySelector('main') || document.body;
      for (const el of root.querySelectorAll('*')) {
        const inline = (el as HTMLElement).style?.opacity;
        if (!inline) continue; // bukan fade framer (inline style kosong)
        const op = parseFloat(inline);
        if (!Number.isFinite(op) || op >= 1) continue;
        count++;
        if (!lowest || op < lowest.op) {
          const cls =
            typeof (el as HTMLElement).className === 'string'
              ? (el as HTMLElement).className.slice(0, 80)
              : el.tagName;
          lowest = { op, cls };
        }
      }
      return { count, lowest };
    });
    if (mid.count === 0) return;
    if (Date.now() > deadline) {
      throw new Error(
        `Animations did not settle in ${timeoutMs}ms — ${mid.count} element(s) mid-fade, lowest opacity ${mid.lowest?.op} (${mid.lowest?.cls}). Axe would measure blended colors.`,
      );
    }
    await page.waitForTimeout(150);
  }
}

const THEMES: VisualTheme[] = ['light', 'dark'];

/** Halaman + gate konten stabil (dari spec e2e existing — bukan timer). */
interface A11yPage {
  name: string;
  path: string;
  gate: (page: import('playwright/test').Page) => Promise<void>;
  /** /reports memuat ribuan transaksi via pagination berurutan → networkidle
   *   tidak pernah settle < 30s (flake P2.2). Gate konten + fade-wait sudah
   *   cukup untuk stabilitas scan. */
  skipNetworkIdle?: boolean;
}

const PAGES: A11yPage[] = [
  { name: 'dashboard', path: '/dashboard', gate: async (page: import('playwright/test').Page) => {
    // P2.5: kartu bernama "Arus Kas Bersih" (lifetime net cash flow) + kartu
    // "Saldo Saat Ini" (account-based ledger) — label lama "Total Saldo" dihapus.
    await expect(page.getByText('Arus Kas Bersih', { exact: true }).first()).toBeVisible();
    await expect(page.getByText('Saldo Saat Ini', { exact: true }).first()).toBeVisible();
  } },
  { name: 'transactions', path: '/transactions', gate: async (page: import('playwright/test').Page) => {
    await expect(page.getByText(/Menampilkan \d+-\d+ dari \d+ transaksi/).first()).toBeVisible();
  } },
  { name: 'ai-hub', path: '/ai', gate: async (page: import('playwright/test').Page) => {
    await expect(page.getByRole('heading', { name: 'Dashboard keuangan cerdas kamu' })).toBeVisible({ timeout: 20_000 });
  } },
  { name: 'ai-timeline', path: '/ai/timeline', gate: async (page: import('playwright/test').Page) => {
    await expect(page.getByRole('heading', { name: /Perjalanan finansialmu bersama AI/ })).toBeVisible({ timeout: 20_000 });
  } },
  { name: 'admin-monitoring', path: '/admin/monitoring', gate: async (page: import('playwright/test').Page) => {
    await expect(page.getByRole('heading', { name: 'Rekomendasi AI' })).toBeVisible({ timeout: 20_000 });
  } },
  // P2.2 — halaman tambahan: AI Search (focus + input) & Reports (chart a11y).
  { name: 'ai-search', path: '/suite/ai-search', gate: async (page: import('playwright/test').Page) => {
    await expect(page.getByRole('heading', { name: 'AI Search' }).first()).toBeVisible({ timeout: 20_000 });
  } },
  { name: 'reports', path: '/reports', gate: async (page: import('playwright/test').Page) => {
    await expect(page.getByRole('heading', { name: /Cashflow/ }).first()).toBeVisible({ timeout: 20_000 });
  }, skipNetworkIdle: true },
  // P2.3.2 — halaman tambahan: gmail-sync (select Interval AutoSyncStatus) & privacy.
  // P3.0 — determinisme scan: "Interval" muncul lebih awal dari daftar email
  // (fetch async + lazy chunk EmailCard). Tanpa menunggu jumlah email, kartu
  // yang mount kemudian ter-scan saat fade opacity < 1 → axe meng-blend warna
  // (bg #8d96a1 palsu, bukan token tema) → color-contrast false-positive.
  // Menunggu indikator "Menampilkan X-Y dari Z email" memastikan kartu sudah
  // mount sebelum waitForFadesToFinish menjalankan poll-nya.
  { name: 'gmail-sync', path: '/gmail-sync', gate: async (page: import('playwright/test').Page) => {
    await expect(page.getByText('Interval', { exact: true }).first()).toBeVisible({ timeout: 20_000 });
    await expect(page.getByText(/Menampilkan \d+-\d+ dari \d+ email/).first()).toBeVisible({ timeout: 20_000 });
  }, skipNetworkIdle: true },
  { name: 'privacy', path: '/privacy', gate: async (page: import('playwright/test').Page) => {
    await expect(page.getByRole('heading', { name: 'Privasi & Izin' })).toBeVisible({ timeout: 20_000 });
  } },
];

test.describe('Accessibility — core pages (axe-core, light+dark)', () => {
  let session: { cookie: string; userId: string };

  test.beforeAll(async () => {
    session = await mintSessionCookie();
  });

  test.afterAll(async () => {
    await cleanupTestSessions();
  });

  for (const theme of THEMES) {
    for (const pageDef of PAGES) {
      test(`${pageDef.name} ${theme} — 0 violations serious/critical`, async ({ page, context }) => {
        await setTheme(context, theme);
        await setupAuthContext(context, session);
        const pageErrors = collectPageErrors(page);

        await page.goto(pageDef.path);
        await page.waitForLoadState(pageDef.skipNetworkIdle ? 'domcontentloaded' : 'networkidle');
        // Gate konten stabil — axe men-scan DOM AKHIR (bukan skeleton/loading).
        await pageDef.gate(page);

        // Determinisme warna (URUTAN KRITIS — di-verifikasi P2.1):
        // 1) TUNGGU fade framer-motion selesai DULU (kondisional — poll inline
        //    opacity). Daftar transaksi di-stagger per baris (delay = index),
        //    baris ~40-an selesai ~2.4s; settle tetap 1.2s terbukti terlalu
        //    dini (axe mengukur warna campuran 4.09:1 → 3.36:1 → 1.96:1).
        // 2) BARU matikan transisi/animasi CSS (style tag). Urutan terbalik
        //    membekukan fade yang sedang berjalan: baris tersangkut di
        //    opacity 0 (inline) → invisible → axe meng-blend warnanya.
        await waitForFadesToFinish(page);
        await page.addStyleTag({
          content: '*,*::before,*::after{transition:none!important;animation:none!important}',
        });
        await page.waitForTimeout(300);

        const results = await new AxeBuilder({ page }).analyze();
        const blocking = results.violations.filter((v) => BLOCKING_SET.has(v.impact || ''));

        // Non-blocking (moderate/minor) — dilaporkan sebagai data tren, TIDAK
        // menggagalkan. Serius (mis. color-contrast) kini blocking (P2.1).
        const info = results.violations.filter((v) => !BLOCKING_SET.has(v.impact || ''));
        if (info.length > 0) {
          const summary = info
            .map((v) => `${v.id}(${v.impact},${v.nodes.length})`)
            .join(', ');
          console.log(`[a11y:${pageDef.name}:${theme}] non-blocking (info): ${summary}`);
        }

        expect(
          blocking,
          `Violations serious/critical di ${pageDef.path} (${theme}): ${JSON.stringify(
            blocking.map((v) => ({ id: v.id, impact: v.impact, nodes: v.nodes.length, help: v.help })),
            null,
            2,
          )}`,
        ).toEqual([]);
        pageErrors.expectClean();
      });
    }
  }
});

test.describe('Accessibility — P2.2 targeted (focus, charts, headings, reduced motion)', () => {
  let session: { cookie: string; userId: string };

  test.beforeAll(async () => {
    session = await mintSessionCookie();
  });

  test.afterAll(async () => {
    await cleanupTestSessions();
  });

  test('ai-search — input fokus memiliki indikator ring (focus-within di wrapper label)', async ({ page, context }) => {
    await setupAuthContext(context, session);
    await page.goto('/suite/ai-search');
    await page.waitForLoadState('networkidle');
    const input = page.getByLabel('AI Search query');
    await input.waitFor({ state: 'visible', timeout: 20_000 });
    await input.focus();
    // Ring P2.2: focus-within:ring-2 di <label> → box-shadow computed non-none.
    const boxShadow = await input.evaluate((el) => {
      const label = el.closest('label');
      return label ? getComputedStyle(label).boxShadow : 'no-label';
    });
    expect(boxShadow).not.toBe('none');
  });

  test('dashboard + reports — chart punya accessible name (role="img" + aria-label)', async ({ page, context }) => {
    await setupAuthContext(context, session);
    await page.goto('/dashboard');
    await page.waitForLoadState('domcontentloaded');
    await expect(page.getByText('Ringkasan Keuangan')).toBeVisible({ timeout: 20_000 });
    await expect(
      page.getByRole('img', { name: 'Grafik garis Pemasukan dan Pengeluaran, 7 hari terakhir' }),
    ).toBeVisible();
    // P2.3 — /reports: `networkidle` TIDAK pernah settle (pagination ribuan
    // transaksi; pola yang sama dengan PAGES di spec ini — flake P2.2). Root
    // cause kegagalan targeted test ini BUKAN chart hilang (probe: 2
    // role="img" ada) melainkan waitForLoadState hang → domcontentloaded +
    // gate konten (bukan timer).
    await page.goto('/reports');
    await page.waitForLoadState('domcontentloaded');
    await expect(page.getByText('Net Cashflow', { exact: true }).first()).toBeVisible({ timeout: 20_000 });
    await expect(page.getByRole('img', { name: 'Grafik batang Pemasukan dan Pengeluaran harian' })).toBeVisible();
  });

  test('admin monitoring — hierarki heading h1→h2 tanpa lompat level', async ({ page, context }) => {
    await setupAuthContext(context, session);
    await page.goto('/admin/monitoring');
    await page.waitForLoadState('networkidle');
    await expect(page.getByRole('heading', { name: 'Rekomendasi AI' })).toBeVisible({ timeout: 20_000 });
    const levels = await page.evaluate(() =>
      Array.from(document.querySelectorAll('h1,h2,h3,h4,h5,h6')).map((el) => Number(el.tagName[1])),
    );
    expect(levels.length).toBeGreaterThan(0);
    expect(levels[0]).toBe(1);
    for (let i = 1; i < levels.length; i += 1) {
      // Lompat level > 1 (mis. h1→h3) = heading-order violation (moderate, P2.1).
      expect(levels[i] - levels[i - 1]).toBeLessThanOrEqual(1);
    }
  });

  test('reduced motion — app tetap berfungsi dengan prefers-reduced-motion: reduce', async ({ page, context }) => {
    await setupAuthContext(context, session);
    await page.emulateMedia({ reducedMotion: 'reduce' });
    const pageErrors = collectPageErrors(page);
    await page.goto('/transactions');
    await page.waitForLoadState('networkidle');
    await expect(page.getByText(/Menampilkan \d+-\d+ dari \d+ transaksi/).first()).toBeVisible();
    await waitForFadesToFinish(page);
    pageErrors.expectClean();
  });
});
