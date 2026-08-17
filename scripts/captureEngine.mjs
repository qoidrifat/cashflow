/**
 * captureEngine.mjs — engine screenshots Playwright REUSABLE untuk semua script
 * capture dokumentasi (admin panels, halaman AI, dst).
 *
 * Satu-satunya sumber kebenaran untuk plumbing yang dulunya diduplikasi di
 * tiap script:
 *   · loadEnv server/.env + .env.local
 *   · parseArgs (--theme/--email/--out/--viewport/--keep-data/--ci + flag kustom)
 *   · THEMES / outputNames (konvensi -light/-dark & -mobile/-mobile-dark)
 *   · mint sesi Better Auth + inject cookie + suppress onboarding
 *   · loop halaman × tema (set localStorage theme → reload → wait marker)
 *   · capture shot: fullPage ATAU elemen panel (heading → ancestor card)
 *   · cleanup sesi minted (finally — aman walau gagal)
 *   · mode CI (--ci): folder temp + summary.json + exit code untuk job GH Actions
 *
 * Mode CI (--ci):
 *   · parseArgs membuat folder output TEMPORER (mkdtemp) kecuali --out eksplisit
 *   · kegagalan shot dicatat (continue), bukan fail-fast — semua halaman dicapture
 *   · marker waitText yang tidak muncul dalam 20s → FAILURE (halaman tidak render)
 *   · menulis <out>/summary.json + runCapture mengembalikan { saved, failures,
 *     outDir } → klien exit 1 via exitForCapture() bila failures.length > 0
 *
 * Script klien cukup MENDEFINISIKAN konfigurasi:
 *   runCapture({
 *     email, width, height, themes, out, keepData, *   beforeAll: async (session) => {},          // e.g. seed fixture
 *   afterAll:  async () => {},                 // e.g. cleanup fixture
 *   ci: false,                                 // mode CI (summary.json + tolerant)
 *     pages: [{
 *       id, path,
 *       waitText,                                // penanda halaman termuat (hero)
 *       settleMs,                                // default 2500 (fetch data)
 *       onTheme: async (page, theme) => {},      // e.g. klik toggle "90 Hari"
 *       shots: [{
 *         // (a) nama eksplisit (panel admin)
 *         light: 'x.png', dark: 'x-dark.png',
 *         element: { heading: 'Rekomendasi AI' },// capture ancestor Card (.rounded-2xl)
 *         // (b) nama otomatis via outputNames(width, base)
 *         base: 'ai-hub',
 *         clickLabel, waitText,                  // buka detail dulu
 *         prepare: async (page, theme) => {},    // e.g. submit chat query
 *         settleMs,                              // default 1500 (klik) / 2500 (prepare)
 *       }],
 *     }],
 *   })
 *
 * Menjalankan script klien (dari package.json):
 *   npm run capture:admin   → scripts/capture-admin-panels.mjs
 *   npm run capture:ai      → scripts/captureAiScreenshots.mjs
 *
 * Prasyarat: server dev berjalan (Vite 5180 + API 5181, `npm run dev:all`) +
 * browser Playwright terpasang (`npx playwright install chromium`).
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { chromium } from 'playwright';
import {
  mintSessionCookieForEmail,
  cleanupTestSessions,
} from '../e2e/helpers/mintSession.ts';

/** Load server/.env + .env.local ke process.env (pola semua script & helper). */
export function loadEnv() {
  for (const p of ['server/.env', '.env.local']) {
    if (!fs.existsSync(p)) continue;
    for (const line of fs.readFileSync(p, 'utf8').split(/\r?\n/)) {
      const t = line.trim();
      if (t && !t.startsWith('#') && t.includes('=')) {
        const i = t.indexOf('=');
        const k = t.slice(0, i).trim();
        const v = t.slice(i + 1).trim().replace(/^["']|["']$/g, '');
        if (k && !process.env[k]) process.env[k] = v;
      }
    }
  }
}

/**
 * Parse argumen CLI. Flag bawaan: --theme --email --out --viewport --keep-data.
 * Flag kustom:
 *   booleans: array flag tanpa nilai, mis. ['--no-seed', '--chat-answer'] → args.noSeed
 *   values:   array flag bernilai,     mis. ['--pages']                     → args.pages
 */
/** '--no-seed' → 'noSeed', '--chat-answer' → 'chatAnswer' (konsisten dengan flag bawaan camelCase). */
function flagKey(flag) {
  const parts = flag.slice(2).split('-').filter(Boolean);
  return parts.map((p, i) => (i === 0 ? p : p[0].toUpperCase() + p.slice(1))).join('');
}

export function parseArgs(argv, { defaults = {}, booleans = [], values = [] } = {}) {
  const args = {
    theme: 'both',
    email: '',
    out: 'docs/assets/screenshots',
    keepData: false,
    ci: false,
    width: 1280,
    height: 900,
  };
  // Default flag kustom (boolean false / value undefined) dulu, LALU defaults
  // caller menimpa — urutan penting: defaults.pages='all' TIDAK boleh di-overwrite
  // undefined oleh loop inisialisasi di bawah.
  for (const f of booleans) args[flagKey(f)] = false;
  for (const f of values) args[flagKey(f)] = undefined;
  Object.assign(args, defaults);

  let outExplicit = false;
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--theme') args.theme = argv[++i] || 'both';
    else if (a === '--email') args.email = argv[++i] || '';
    else if (a === '--out') { args.out = argv[++i] || args.out; outExplicit = true; }
    else if (a === '--keep-data') args.keepData = true;
    else if (a === '--ci') args.ci = true;
    else if (a === '--viewport') {
      const [w, h] = (argv[++i] || '1280x900').split('x').map(Number);
      args.width = w || args.width;
      args.height = h || args.height;
    } else if (booleans.includes(a)) {
      args[flagKey(a)] = true;
    } else if (values.includes(a)) {
      // Lowercase + default 'all' (parity dengan script lama): `--pages ALL` →
      // 'all' dan `--pages` tanpa nilai → 'all' (bukan undefined → crash .split(',')).
      args[flagKey(a)] = (argv[++i] || 'all').toLowerCase();
    }
  }

  // Mode CI: output ke folder temporer (bukan docs/assets/screenshots yang
  // tracked git) KECUALI --out eksplisit — supaya job GH Actions bisa
  // men-diff ringkasan + memutuskan apakah gambar perlu di-commit.
  if (args.ci && !outExplicit) {
    args.out = fs.mkdtempSync(path.join(os.tmpdir(), 'cashflow-capture-'));
  }
  return args;
}

export const THEMES = (themeArg) => (themeArg === 'both' ? ['light', 'dark'] : [themeArg]);

/**
 * Nama file mengikuti konvensi existing:
 *   - Desktop (lebar > 480):  {base}-light.png / {base}-dark.png
 *   - Mobile (≤ 480):         {base}-mobile.png / {base}-mobile-dark.png
 * (suffix -mobile = pola dashboard-mobile.png di INDEX; -light/-dark = pola
 * file desktop existing — regenerasi menimpa file yang sama).
 */
export function outputNames(width, base) {
  const mobile = width <= 480;
  const variant = mobile ? `${base}-mobile` : base;
  return {
    light: mobile ? `${variant}.png` : `${variant}-light.png`,
    dark: `${variant}-dark.png`,
  };
}

/** Resolusi nama file shot: eksplisit (light/dark) menang atas base otomatis. */
function resolveShotFile(width, theme, shot) {
  if (shot.light && shot.dark) return theme === 'dark' ? shot.dark : shot.light;
  const names = outputNames(width, shot.base);
  return theme === 'dark' ? names.dark : names.light;
}

/**
 * Jalankan sesi capture lengkap: mint sesi → (beforeAll) → loop halaman × tema
 * → capture shots → cleanup sesi + (afterAll).
 *
 * Kembalikan `{ saved, failures, warnings, outDir }`:
 *   · saved    — file PNG yang berhasil disimpan
 *   · failures — [{ page, theme, file?, stage?, error }] — kegagalan shot/setup
 *
 * Mode `ci` (untuk job GH Actions):
 *   · Kegagalan shot TIDAK menggagalkan sisa run — semua halaman tetap dicapture,
 *     error dicatat per-shot (non-ci tetap fail-fast = throw, perilaku lama).
 *   · Setup (mint sesi / beforeAll / chromium.launch) gagal → dicatat sebagai
 *     failures + setelahAll tetap jalan (cleanup fixture tidak bocor).
 *   · Marker `waitText` halaman tidak muncul dalam 20s → FAILURE (stage
 *     'waitText') — halaman blank/error/redirect-to-login akan menggagalkan job
 *     (supaya gambar rusak tidak pernah ter-commit oleh job dokumentasi).
 *   · Menulis `<out>/summary.json` — ringkasan JSON machine-readable + exit code
 *     diatur lewat return (klien exit 1 bila failures.length > 0).
 */
export async function runCapture({
  email,
  baseUrl = process.env.CAPTURE_BASE_URL || 'http://localhost:5180',
  width,
  height,
  themes = ['light', 'dark'],
  out = 'docs/assets/screenshots',
  keepData = false,
  ci = false,
  pages = [],
  beforeAll = null,
  afterAll = null,
  logPrefix = '[capture]',
}) {
  loadEnv();
  const outDir = path.resolve(process.cwd(), out);
  fs.mkdirSync(outDir, { recursive: true });
  const saved = [];
  const failures = [];
  let browser = null;

  try {
    const session = await mintSessionCookieForEmail(email);
    console.log(`${logPrefix} Sesi minted userId=${session.userId.slice(0, 8)}…`);
    if (beforeAll) await beforeAll(session);

    browser = await chromium.launch();
    const context = await browser.newContext({
      viewport: { width, height },
      deviceScaleFactor: 1,
    });
    // Suppress onboarding modal (pola e2e/authContext.ts).
    await context.addInitScript((key) => {
      try {
        localStorage.setItem(key, 'true');
      } catch { /* noop */ }
    }, 'cashflow-onboarding-done');
    await context.addCookies([
      {
        name: 'better-auth.session_token',
        value: session.cookie,
        domain: 'localhost',
        path: '/',
      },
    ]);
    const page = await context.newPage();

    for (const pg of pages) {
      for (const theme of themes) {
        await page.goto(`${baseUrl}${pg.path}`, { waitUntil: 'domcontentloaded', timeout: 30000 });
        await page.evaluate((t) => localStorage.setItem('cashflow-theme', t), theme);
        await page.reload({ waitUntil: 'domcontentloaded', timeout: 30000 });
        if (pg.waitText) {
          const seen = await page
            .getByText(pg.waitText, { exact: false })
            .first()
            .waitFor({ timeout: 20000 })
            .then(() => true)
            .catch(() => false);
          // CI: marker halaman tidak muncul (blank/error/redirect) → FAILURE —
          // screenshot yang dihasilkan tidak layak di-commit oleh job dokumen.
          if (ci && !seen) {
            failures.push({ page: pg.id, theme, stage: 'waitText', text: pg.waitText });
            console.error(`${logPrefix} ✗ ${pg.id}/${theme}: waitText "${pg.waitText}" tidak muncul (halaman tidak render)`);
          }
        }
        await page.waitForTimeout(pg.settleMs ?? 2500); // fetch data halaman
        if (pg.onTheme) await pg.onTheme(page, theme);

        for (const shot of pg.shots) {
          const file = resolveShotFile(width, theme, shot);
          const target = path.join(outDir, file);
          try {
            if (shot.prepare) await shot.prepare(page, theme);
            if (shot.clickLabel) {
              await page.getByRole('button', { name: shot.clickLabel }).first().click().catch(() => {});
              if (shot.waitText) {
                await page
                  .getByText(shot.waitText, { exact: false })
                  .first()
                  .waitFor({ timeout: 15000 })
                  .catch(() => {});
              }
              await page.waitForTimeout(shot.settleMs ?? 1500);
            } else if (shot.prepare) {
              await page.waitForTimeout(shot.settleMs ?? 2500); // settle setelah prepare
            }

            if (shot.element) {
              // Capture kartu panel (heading → ancestor Card .rounded-2xl).
              const heading = page.locator(`h3:has-text("${shot.element.heading}")`).first();
              const card = heading.locator('xpath=ancestor::div[contains(@class,"rounded-2xl")][1]');
              await card.scrollIntoViewIfNeeded().catch(() => {});
              await card.screenshot({ path: target, timeout: 20000 });
            } else {
              await page.screenshot({ path: target, fullPage: true, timeout: 20000 });
            }
            saved.push(file);
            console.log(`${logPrefix} ✓ ${file}`);
          } catch (e) {
            const msg = String(e?.message || e).slice(0, 300);
            if (ci) failures.push({ page: pg.id, theme, file, error: msg });
            console.error(`${logPrefix} ✗ ${pg.id}/${theme} ${file} — ${msg}`);
            if (!ci) throw e; // non-ci: fail-fast (perilaku lama; tanpa double-count)
          }
        }
      }
    }

  } catch (e) {
    // Setup gagal (mint sesi / beforeAll / launch / goto): catat + non-ci throw.
    const msg = String(e?.message || e).slice(0, 300);
    failures.push({ stage: 'setup', error: msg });
    console.error(`${logPrefix} GAGAL (setup): ${msg}`);
    if (!ci) throw e;
  } finally {
    // Tutup browser + cleanup sesi/fixture SELALU jalan — walau launch gagal
    // (beforeAll sudah men-seed fixture; tanpa ini e2e-* bocor di DB).
    if (browser) await browser.close().catch(() => {});
    if (!keepData) {
      await cleanupTestSessions().catch((e) => {
        failures.push({ stage: 'cleanup', error: String(e?.message || e).slice(0, 300) });
      });
      console.log(`${logPrefix} Cleanup selesai (sesi minted dihapus)`);
    } else {
      console.log(`${logPrefix} --keep-data: sesi TIDAK dihapus`);
    }
    if (afterAll) {
      await afterAll().catch((e) => {
        failures.push({ stage: 'afterAll', error: String(e?.message || e).slice(0, 300) });
        console.error(`${logPrefix} afterAll GAGAL: ${String(e?.message || e).slice(0, 300)}`);
      });
    }

    // CI: ringkasan machine-readable → <out>/summary.json. Gagal menulis summary
    // TIDAK boleh menimpa/menghilangkan failure yang sudah tercatat — dicatat
    // sebagai failure 'summary' sendiri, jangan escape (job tetap exit 1).
    if (ci) {
      const summary = {
        ok: failures.length === 0 && saved.length > 0,
        generatedAt: new Date().toISOString(),
        email,
        viewport: { width, height },
        themes,
        out: outDir,
        pages: pages.map((p) => p.id),
        saved,
        failures,
      };
      const summaryPath = path.join(outDir, 'summary.json');
      try {
        fs.writeFileSync(summaryPath, JSON.stringify(summary, null, 2));
        console.log(
          `${logPrefix} CI summary → ${summaryPath} (ok=${summary.ok}, ${saved.length} shot, ${failures.length} error)`,
        );
      } catch (e) {
        failures.push({ stage: 'summary', error: String(e?.message || e).slice(0, 300) });
        console.error(`${logPrefix} ✗ GAGAL menulis summary.json: ${String(e?.message || e).slice(0, 300)}`);
      }
    }
  }

  console.log(`\nDONE — ${saved.length} screenshot → ${outDir}`);
  console.log(saved.map((f) => `  ${f}`).join('\n'));
  return { saved, failures, outDir };
}

/**
 * Exit code untuk mode CI: 1 bila ada kegagalan (job GH Actions gagal),
 * 0 bila bersih. Dipakai kedua script klien — hindari duplikasi.
 */
export function exitForCapture(result, ci, logPrefix = '[capture]') {
  if (ci && result.failures.length > 0) {
    console.error(
      `${logPrefix} CI GAGAL: ${result.failures.length} error → ${result.outDir}/summary.json`,
    );
    process.exit(1);
  }
  process.exit(0);
}
