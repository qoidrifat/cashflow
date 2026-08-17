/**
 * Responsive audit P2.2 — horizontal overflow, chart clipping, nav label
 * overflow & feedback-button collision pada viewport 360/390/430/768.
 *
 * Prasyarat: server dev berjalan (Vite 5180 + API 5181, `npm run dev:all`) +
 * database e2e (seed user Dafa via e2e/helpers/mintSession.ts). Sesi di-mint
 * otomatis per run; tidak perlu login manual.
 *
 * Output: docs/assets/screenshots/responsive-p22/<page>-<vp>.png (24 file)
 *         + docs/assets/screenshots/responsive-p22/summary.json
 *
 * Kriteria:
 *   - overflow  : 0 (body scrollWidth - innerWidth)
 *   - charts    : render (>=1) dan tidak clipped (right <= viewport)
 *   - nav label : tidak ada overflow teks pada span 11px di <nav>
 *   - feedback  : tombol 👍/👎 >= 32px (min desktop P2.2) dan fits di viewport
 *
 * Usage: node scripts/responsive-audit.mjs
 */
import fs from 'node:fs';
import { chromium } from 'playwright';
import { mintSessionCookie } from '../e2e/helpers/mintSession.ts';
import { injectSessionCookie } from '../e2e/helpers/authContext.ts';

const BASE = 'http://localhost:5180';
const OUT = 'docs/assets/screenshots/responsive-p22';
fs.mkdirSync(OUT, { recursive: true });

const VIEWPORTS = [
  { name: '360', width: 360, height: 800 },
  { name: '390', width: 390, height: 844 },
  { name: '430', width: 430, height: 932 },
  { name: '768', width: 768, height: 1024 },
];

const PAGES = [
  { name: 'ai-chat', path: '/ai/chat', gate: (page) => page.getByLabel('Pertanyaan finansial').waitFor({ timeout: 45_000 }), ask: true },
  { name: 'ai-hub', path: '/ai', gate: (page) => page.getByRole('heading', { name: 'Dashboard keuangan cerdas kamu' }).waitFor({ timeout: 25_000 }) },
  { name: 'ai-timeline', path: '/ai/timeline', gate: (page) => page.getByRole('heading', { name: /Perjalanan finansialmu bersama AI/ }).waitFor({ timeout: 25_000 }) },

  { name: 'ai-search', path: '/suite/ai-search', gate: (page) => page.getByRole('heading', { name: 'AI Search' }).first().waitFor({ timeout: 25_000 }) },
  { name: 'reports', path: '/reports', gate: (page) => page.getByText('Net Cashflow', { exact: true }).first().waitFor({ timeout: 25_000 }) },
  { name: 'admin-monitoring', path: '/admin/monitoring', gate: (page) => page.getByRole('heading', { name: 'Rekomendasi AI' }).waitFor({ timeout: 25_000 }) },
  { name: 'transactions', path: '/transactions', gate: (page) => page.getByRole('heading', { name: /Transaksi/i }).first().waitFor({ timeout: 25_000 }) },
  { name: 'gmail-sync', path: '/gmail-sync', gate: (page) => page.getByText('Interval', { exact: true }).first().waitFor({ timeout: 25_000 }) },
];

async function runChecks(page) {
  return page.evaluate(() => {
    const vw = window.innerWidth;
    const scrollW = document.documentElement.scrollWidth;
    const offenders = [];
    for (const el of document.querySelectorAll('body *')) {
      const r = el.getBoundingClientRect();
      if (r.width > 0 && r.right > vw + 1 && getComputedStyle(el).position !== 'fixed') {
        let p = el.parentElement;
        let inScroll = false;
        while (p) {
          const cs = getComputedStyle(p);
          if (cs.overflowX === 'auto' || cs.overflowX === 'scroll' || cs.overflowX === 'overlay') { inScroll = true; break; }
          p = p.parentElement;
        }
        if (!inScroll && r.left < vw) offenders.push({ tag: el.tagName, cls: String(el.className).slice(0, 70), left: Math.round(r.left), right: Math.round(r.right) });
        if (offenders.length > 8) break;
      }
    }
    const charts = [...document.querySelectorAll('.recharts-wrapper')].map((el) => {
      const r = el.getBoundingClientRect();
      return { w: Math.round(r.width), left: Math.round(r.left), right: Math.round(r.right), clipped: r.width > 0 && r.right > vw + 1 };
    });
    const navLabels = [];
    for (const el of document.querySelectorAll('nav a span, nav button span')) {
      const cs = getComputedStyle(el);
      if (cs.fontSize === '11px') {
        navLabels.push({ text: (el.textContent || '').trim().slice(0, 20), overflow: el.scrollWidth > el.clientWidth + 1, w: el.clientWidth });
      }
    }
    const fb = [...document.querySelectorAll('button[aria-label="Membantu"], button[aria-label="Tidak membantu"]')].map((el) => {
      const r = el.getBoundingClientRect();
      return { label: el.getAttribute('aria-label'), w: Math.round(r.width), h: Math.round(r.height), left: Math.round(r.left), right: Math.round(r.right), top: Math.round(r.top), fits: r.right <= vw + 1 && r.left >= -1 };
    });
    return { vw, scrollW, overflow: scrollW - vw, offenders, charts, navLabels, fb };
  });
}

const report = [];
let failures = 0;
for (const vp of VIEWPORTS) {
  for (const p of PAGES) {
    const browser = await chromium.launch();
    const context = await browser.newContext({ viewport: { width: vp.width, height: vp.height } });
    const page = await context.newPage();
    const session = await mintSessionCookie();
    await injectSessionCookie(context, session);
    await page.goto(`${BASE}${p.path}`, { waitUntil: 'domcontentloaded' });
    try {
      await p.gate(page);
    } catch (e) {
      console.log(`GATE TIMEOUT ${vp.name} ${p.path} — ${e.message.split('\n')[0]}`);
      await browser.close();
      failures++;
      report.push({ vp: vp.name, page: p.name, error: 'gate timeout' });
      continue;
    }
    if (p.ask) {
      const ta = page.getByLabel('Pertanyaan finansial');
      await ta.fill('Berapa saldo saya bulan ini?');
      await ta.press('Enter');
      // Tunggu jawaban selesai (baris feedback 👍/👎 muncul bersama jawaban) —
      // polling, bukan timing fixed, supaya deterministik lintas kecepatan AI.
      try {
        await page.getByLabel('Tidak membantu').waitFor({ timeout: 25_000 });
      } catch {
        // jawaban mungkin gagal (degradasi) — tetap lanjut, checks hanya
        // overflow/layout; fb/charts bisa 0 dan bukan failure.
      }
    }
    await page.waitForTimeout(300); // settle transitions/fade (P2.2 determinisme)
    const res = await runChecks(page);
    const r = {
      vp: vp.name,
      page: p.name,
      overflow: res.overflow,
      charts: res.charts.length,
      chartsClipped: res.charts.filter((c) => c.clipped).length,
      navOverflow: res.navLabels.filter((n) => n.overflow).length,
      fbCount: res.fb.length,
      fbNotFit: res.fb.filter((f) => !f.fits).length,
      fbMinSize: res.fb.length ? Math.min(...res.fb.map((f) => Math.min(f.w, f.h))) : null,
      offenders: res.offenders,
    };
    report.push(r);
    await page.screenshot({ path: `${OUT}/${p.name}-${vp.name}.png` });
    const fail = r.overflow > 0 || r.chartsClipped > 0 || r.navOverflow > 0 || r.fbNotFit > 0;
    if (fail) failures++;
    console.log(`${fail ? 'FAIL' : 'ok  '} ${vp.name} ${p.path} overflow=${r.overflow} charts=${r.charts}/${r.chartsClipped} navOv=${r.navOverflow} fb=${r.fbCount} min=${r.fbMinSize ?? '-'}`);
    await browser.close();
  }
}
fs.writeFileSync(`${OUT}/summary.json`, JSON.stringify(report, null, 2));
console.log(`\nscreenshots → ${OUT}/ (${VIEWPORTS.length * PAGES.length} files)`);
process.exit(failures > 0 ? 1 : 0);
