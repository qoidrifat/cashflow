/**
 * E2E: Keyboard navigation (P2.3.2 §6) — walk tab nyata pada halaman inti.
 *
 * Tujuan: tidak boleh ada interactive element yang tidak bisa difokus, fokus
 * tidak terlihat (display:none), accessible name kosong, atau fokus terperangkap.
 *
 * Halaman: dashboard · transactions · ai-timeline · admin-monitoring.
 *
 * Per halaman:
 *   A. Tab-walk (maks. 30 langkah): tiap langkah assert — aktif bukan <body>,
 *      terlihat (bukan display:none), dan jika tag interaktif (button/a/select/
 *      textarea/input) accessible name-nya TIDAK kosong. Walk harus mencapai
 *      ≥6 elemen berbeda dan tidak ada dua langkah berurutan yang "stuck" di
 *      elemen yang sama (guard fokus terperangkap).
 *   B. Shift+Tab mundur: elemen aktif berubah (bukan stuck di elemen yang sama).
 *   C. Reachability terarah: kontrol yang diketahui (per halaman) HARUS dapat
 *      dicapai keyboard dalam walk.
 *
 * Autentikasi: sesi seed via mintSessionCookie (jalur nyata, bukan bypass).
 * Tema: light (fokus visibility diukur dari komposisi DOM, bukan warna).
 */
import { test, expect } from 'playwright/test';
import { mintSessionCookie, cleanupTestSessions } from './helpers/mintSession';
import { setupAuthContext } from './helpers/authContext';

// 45 langkah: admin-monitoring punya banyak panel — kontrol target di panel
// terbawah butuh walk lebih panjang (30 tidak cukup, terbukti).
const WALK_STEPS = 45;
const MIN_DISTINCT = 6;

interface FocusProbe {
  tag: string;
  aria: string | null;
  text: string;
  visible: boolean;
  name: string;
}

/** Properti elemen aktif — visible = punya layout box (bukan display:none). */
async function focusProbe(page: import('playwright/test').Page): Promise<FocusProbe> {
  return page.evaluate(() => {
    const el = document.activeElement;
    if (!el || el === document.body) return { tag: 'BODY', aria: null, text: '', visible: true, name: '' };
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const h = el as any;
    const aria = el.getAttribute('aria-label');
    const text = (el.textContent || '').trim().slice(0, 40);
    const visible = !!(h.offsetWidth || h.offsetHeight || el.getClientRects().length);
    const placeholder = el.getAttribute('placeholder');
    const inputValue = h.value;
    const name = (aria || text || placeholder || inputValue || '').toString().slice(0, 40);
    return { tag: el.tagName, aria, text, visible, name };
  });
}

const INTERACTIVE_TAGS = new Set(['BUTTON', 'A', 'SELECT', 'TEXTAREA', 'INPUT']);

interface PageTarget {
  name: string;
  path: string;
  gate: (page: import('playwright/test').Page) => Promise<void>;
  /** Kontrol yang harus tercapai keyboard (Playwright locator). */
  reachable: (page: import('playwright/test').Page) => import('playwright/test').Locator;
}

const PAGES: PageTarget[] = [
  {
    name: 'dashboard',
    path: '/dashboard',
    gate: async (page) => {
      await expect(page.getByText('Ringkasan Keuangan')).toBeVisible({ timeout: 20_000 });
    },
    reachable: (page) => page.getByRole('button', { name: 'Pemasukan', exact: true }),
  },
  {
    name: 'transactions',
    path: '/transactions',
    gate: async (page) => {
      await expect(page.getByText(/Menampilkan \d+-\d+ dari \d+ transaksi/)).toBeVisible({ timeout: 20_000 });
    },
    reachable: (page) => page.getByRole('button', { name: 'Semua', exact: true }),
  },
  {
    name: 'ai-timeline',
    path: '/ai/timeline',
    gate: async (page) => {
      await expect(page.getByRole('heading', { name: /Perjalanan finansialmu bersama AI/ })).toBeVisible({ timeout: 20_000 });
    },
    reachable: (page) => page.getByRole('button', { name: 'Rekomendasi', exact: true }),
  },
  {
    name: 'admin-monitoring',
    path: '/admin/monitoring',
    gate: async (page) => {
      await expect(page.getByRole('heading', { name: 'Rekomendasi AI' })).toBeVisible({ timeout: 20_000 });
    },
    reachable: (page) => page.getByLabel('Filter fitur pada grafik tren biaya'),
  },
];

test.describe('Keyboard navigation (P2.3.2) — tab-walk + reachability', () => {
  let session: { cookie: string; userId: string };

  test.beforeAll(async () => {
    session = await mintSessionCookie();
  });

  test.afterAll(async () => {
    await cleanupTestSessions();
  });

  for (const target of PAGES) {
    test(`${target.name} — tab-walk: fokus terlihat + bernama + tidak terperangkap + kontrol tercapai`, async ({ page, context }) => {
      await setupAuthContext(context, session);
      await page.goto(target.path);
      await target.gate(page);

      const seen = new Set<string>();
      let reachedTarget = false;
      // Handle elemen aktif — guard trap berbasis IDENTITAS ELEMEN (bukan
      // key `tag:name`). Beberapa tombol BEDA dengan nama sama (mis. 3 tombol
      // "Lihat" di baris fraud widget) bukan trap; fokus yang TIDAK berpindah
      // (elemen aktif sama persis) yang merupakan trap nyata.
      let prevHandle = await page.evaluateHandle(() => document.activeElement);

      for (let i = 0; i < WALK_STEPS; i++) {
        await page.keyboard.press('Tab');
        const p = await focusProbe(page);
        const key = `${p.tag}:${p.name || p.text}`;

        const currHandle = await page.evaluateHandle(() => document.activeElement);
        // handle.evaluate(1 arg) — bandingkan elemen yang direferensikan handle
        // dengan elemen aktif saat ini (tanpa overload multi-arg evaluate).
        const isSameElement = await prevHandle.evaluate((el) => el === document.activeElement);
        prevHandle.dispose();
        prevHandle = currHandle;

        // 1. Fokus jatuh ke <body> = akhir urutan tab (wrap alami browser),
        //    BUKAN trap — asal walk sudah melewati ≥MIN_DISTINCT elemen
        //    (urutan tab bermakna). Terjadi sebelum itu = tab order terlalu
        //    pendek/rusak.
        if (p.tag === 'BODY') {
          expect(seen.size, `step ${i}: fokus jatuh ke <body> SEBELUM ${MIN_DISTINCT} elemen berbeda tercapai (tab order rusak?)`).toBeGreaterThanOrEqual(MIN_DISTINCT);
          continue;
        }
        // 2. Elemen aktif harus terlihat (bukan display:none).
        expect(p.visible, `step ${i}: elemen ${p.tag} "${p.name}" tidak terlihat`).toBe(true);
        // 3. Interactive element wajib punya accessible name non-kosong.
        if (INTERACTIVE_TAGS.has(p.tag)) {
          expect(p.name.trim().length, `step ${i}: ${p.tag} tanpa accessible name (aria-label/text/placeholder kosong)`).toBeGreaterThan(0);
        }
        // 4. Guard fokus terperangkap: dua langkah berurutan tidak boleh
        //    berhenti di ELEMEN yang sama persis (bukan sekadar nama sama).
        expect(isSameElement, `step ${i}: fokus stuck di "${key}" (trap?)`).toBe(false);
        seen.add(key);
        // 5. Reachability: target kontrol PERNAH difokus selama walk (dengan
        //    walk selesai penuh — jangan break, Shift+Tab akhir akan memindah
        //    fokus menjauh sehingga toBeFocused akhir tidak valid).
        if (await target.reachable(page).evaluate((el) => el === document.activeElement).catch(() => false)) {
          reachedTarget = true;
        }
      }

      // 6. Walk benar-benar bergerak (≥6 elemen berbeda).
      expect(seen.size, `hanya ${seen.size} elemen berbeda tercapai di ${target.name}`).toBeGreaterThanOrEqual(MIN_DISTINCT);

      // 7. Shift+Tab mundur: elemen aktif berubah (backward navigation) —
      //    identitas elemen (nama sama antar elemen beda bukan pelanggaran).
      const beforeHandle = await page.evaluateHandle(() => document.activeElement);
      await page.keyboard.press('Shift+Tab');
      const movedBack = await beforeHandle.evaluate((el) => el !== document.activeElement);
      beforeHandle.dispose();
      expect(movedBack, 'Shift+Tab harus memindahkan fokus ke elemen lain').toBe(true);

      // 8. Kontrol target tercapai keyboard selama walk (assertion eksplisit).
      expect(reachedTarget, `kontrol target tidak pernah difokus keyboard di ${target.name}`).toBe(true);
    });
  }
});
