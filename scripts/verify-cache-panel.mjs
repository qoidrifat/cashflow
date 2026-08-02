/**
 * TEMP verification script — Panel "AI Response Cache" di /admin/monitoring
 *
 * Login via cookie Better Auth (pola e2e/helpers/mintSession.ts). Verifikasi:
 *   1. Panel tampil tanpa pageerror (tidak 401/500)
 *   2. Hit Rate bar + 4 stat (Hits/Misses/Tersimpan/Evictions) render
 *   3. API /api/admin/metrics/cache merespons ok + shape benar
 *   4. Screenshot sebagai bukti visual
 *
 * Jalankan:
 *   node scripts/verify-cache-panel.mjs
 */
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { createClient } from '@libsql/client';
import { chromium } from 'playwright-core';

const BASE_URL = 'http://localhost:5180';
const CHROME_PATH = 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const SHOT_DIR = 'test-results/cache-panel';

function loadEnv() {
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

async function mintSessionCookie() {
  const turso = createClient({ url: process.env.TURSO_DATABASE_URL, authToken: process.env.TURSO_AUTH_TOKEN });
  try {
    const users = await turso.execute({ sql: 'SELECT id, email FROM user LIMIT 1', args: [] });
    const userId = users.rows[0]?.id;
    const email = users.rows[0]?.email;
    if (!userId) throw new Error('Tidak ada user di tabel user');
    const token = crypto.randomBytes(24).toString('base64url').slice(0, 32);
    const secret = process.env.BETTER_AUTH_SECRET || process.env.AUTH_SECRET || 'cashflow-dev-secret-change-in-production';
    const sig = crypto.createHmac('sha256', secret).update(token).digest('base64');
    const now = new Date();
    await turso.execute({
      sql: `INSERT INTO session (id, expiresAt, token, createdAt, updatedAt, ipAddress, userAgent, userId)
            VALUES (?, ?, ?, ?, ?, '', 'e2e-test', ?)`,
      args: [token, new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000).toISOString(), token, now.toISOString(), now.toISOString(), userId],
    });
    return { cookie: `${token}.${sig}`, userId, email };
  } finally {
    turso.close();
  }
}

async function cleanupTestSessions() {
  const turso = createClient({ url: process.env.TURSO_DATABASE_URL, authToken: process.env.TURSO_AUTH_TOKEN });
  try {
    await turso.execute({ sql: `DELETE FROM session WHERE userAgent = 'e2e-test'`, args: [] });
  } finally {
    turso.close();
  }
}

let failed = 0;
function check(label, ok, detail = '') {
  console.log(`${ok ? '✅' : '❌'} ${label}${detail ? ` — ${detail}` : ''}`);
  if (!ok) failed++;
}

loadEnv();
fs.mkdirSync(SHOT_DIR, { recursive: true });
const session = await mintSessionCookie();
console.log(`Minted session untuk: ${session.email}`);

const browser = await chromium.launch({ executablePath: CHROME_PATH, headless: true });
const context = await browser.newContext({ viewport: { width: 1440, height: 1200 } });
await context.addInitScript((key) => {
  try { localStorage.setItem(key, 'true'); } catch { /* noop */ }
}, 'cashflow-onboarding-done');
await context.addCookies([{
  name: 'better-auth.session_token',
  value: session.cookie,
  domain: 'localhost',
  path: '/',
  httpOnly: true,
  sameSite: 'Lax',
}]);

const page = await context.newPage();
const pageErrors = [];
page.on('pageerror', (err) => pageErrors.push(err.message));

let cacheApiBody = null;
page.on('response', async (resp) => {
  const url = resp.url();
  if (!url.includes('/api/admin/metrics/cache')) return;
  try { cacheApiBody = await resp.json(); } catch { /* noop */ }
});

// Picu aktivitas cache riil: 2 POST identik → miss dulu (panggil Vertex), lalu
// hit. Ini mengisi stats in-process server sehingga panel menampilkan nilai
// aktual (bukan 0/"—" dari fresh restart). Endpoint butuh cookie (session admin).
console.log('=== Picu aktivitas cache (2 POST identik) ===');
try {
  const payload = {
    emailText: 'Terima kasih telah berbelanja di Tokopedia. Pembayaran Rp 150.000 berhasil. Pesanan dikirim.',
    subject: 'Pembayaran berhasil',
    sender: 'noreply@tokopedia.com',
    emailDate: '2026-07-01',
  };
  for (let i = 0; i < 2; i++) {
    const t0 = Date.now();
    const r = await fetch('http://localhost:5181/api/gemini/extract-transaction', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Cookie': `better-auth.session_token=${session.cookie}`,
      },
      body: JSON.stringify(payload),
    });
    const ms = Date.now() - t0;
    console.log(`[cache-trigger] POST #${i + 1} → HTTP ${r.status} dalam ${ms}ms ${i === 1 ? '(harus jauh lebih cepat = hit)' : '(miss, panggil Vertex)'}`);
    if (i === 0 && ms < 1500) console.log('⚠️ POST #1 terlalu cepat — mungkin bukan miss (cache sudah panas?)');
  }
} catch (err) {
  console.log(`⚠️ Gagal memicu cache: ${err.message}`);
}

console.log('\n=== /admin/monitoring (panel AI Response Cache) ===');
try {
  const respNav = await page.goto(`${BASE_URL}/admin/monitoring`, { waitUntil: 'domcontentloaded', timeout: 30000 });
  check('Navigasi 200', respNav && respNav.status() < 400, respNav ? `HTTP ${respNav.status()}` : 'no response');

  // Tunggu panel cache render
  const panel = page.getByText('AI Response Cache', { exact: true });
  await panel.waitFor({ state: 'visible', timeout: 20000 }).catch(() => {});
  check('Panel "AI Response Cache" tampil', (await panel.count()) > 0);

  // Sub-elemen panel
  const hitRateLabel = await page.getByText('Hit Rate', { exact: true }).count();
  check('Label "Hit Rate" tampil', hitRateLabel > 0);

  for (const stat of ['Hits', 'Misses', 'Tersimpan', 'Evictions']) {
    const c = await page.getByText(stat, { exact: true }).count();
    check(`Stat "${stat}" tampil`, c > 0);
  }

  // Progress bar render (div dengan bg-mint-500 / bg-amber-500)
  const bar = page.locator('.bg-mint-500, .bg-amber-500').first();
  const barCount = await bar.count();
  check('Progress bar hit rate render', barCount > 0, barCount > 0 ? 'bar ada' : 'tidak ada');

  // Hit rate value: "—" (0 aktivitas) ATAU "NN%" — keduanya valid, pastikan ada teks
  const hitValue = await page.locator('text=AI Response Cache').locator('..').locator('..')
    .getByText(/(\d+%|—)/).count().catch(() => 0);
  check('Nilai hit rate tampil (persen atau "—")', hitValue > 0);

  // Error card tidak boleh muncul
  const errorCard = await page.getByText(/Tidak dapat memuat data monitoring|Akses ditolak/).count();
  check('TIDAK ada error card (401/403)', errorCard === 0, errorCard > 0 ? 'error card muncul' : 'OK');

  // API response shape
  await page.waitForTimeout(1500);
  check('API /api/admin/metrics/cache merespons ok', cacheApiBody?.ok === true);
  if (cacheApiBody) {
    const shapeOk = ['size', 'maxEntries', 'hits', 'misses', 'sets', 'evictions', 'hitRate', 'inflight']
      .every((k) => typeof cacheApiBody[k] === 'number');
    check('Shape API cache lengkap (8 field numeric)', shapeOk, JSON.stringify(cacheApiBody));
  }

  // Screenshot penuh
  await page.screenshot({ path: `${SHOT_DIR}/monitoring-cache-panel.png`, fullPage: false });
  // Zoom ke panel cache
  const panelBox = await panel.boundingBox();
  if (panelBox) {
    await page.screenshot({ path: `${SHOT_DIR}/cache-panel-zoom.png`, clip: {
      x: Math.max(0, panelBox.x - 40), y: Math.max(0, panelBox.y - 30),
      width: Math.min(1200, panelBox.width + 80), height: panelBox.height + 80,
    } });
  }
  console.log(`📸 Screenshot: ${SHOT_DIR}/monitoring-cache-panel.png`);

  // Panel cache + summary cards bersama (bukti konteks halaman)
  const summaryCards = ['Biaya Hari Ini', 'Token Hari Ini', 'Calls Hari Ini'];
  for (const label of summaryCards) {
    const c = await page.getByText(label, { exact: true }).count();
    check(`Summary card "${label}" masih tampil (panel tidak merusak layout)`, c > 0);
  }
} catch (err) {
  check('Eksekusi skrip', false, err.message);
} finally {
  console.log('\n=== Page errors (console) ===');
  if (pageErrors.length === 0) {
    console.log('✅ Tidak ada pageerror');
  } else {
    console.log(`❌ ${pageErrors.length} pageerror:`);
    pageErrors.forEach((e) => console.log(`   ${e.slice(0, 200)}`));
    failed++;
  }

  await browser.close();
  await cleanupTestSessions();
  console.log('\n========================================');
  console.log(failed === 0 ? '✅ VERIFIKASI LULUS — panel AI Response Cache tampil & berfungsi' : `❌ ${failed} check GAGAL`);
  console.log('========================================');
  process.exit(failed === 0 ? 0 : 1);
}
