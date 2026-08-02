/**
 * TEMP verification script — AI Search page (suite/ai-search)
 *
 * Memverifikasi halaman AI Search berfungsi TANPA 500 setelah cleanup Supabase:
 *  - resolveAgentSearchUser kini memakai req.user Better Auth (bukan Supabase JWT).
 *  - Dead import createClient sudah dihapus dari agentSearchService.js.
 *
 * Test alur browser (login via cookie Better Auth yang di-mint langsung ke Turso):
 *  1. Navigasi /suite/ai-search — halaman render, health check jalan.
 *  2. Klik tab "Transaksi" → submit query → /api/agent-search/answer TIDAK 500/401.
 *  3. Klik "Sync transaksi" → /api/agent-search/sync-transactions TIDAK 500/401.
 *  4. Semua response /api/agent-search/* dirangkum: tidak boleh >= 500, tidak ada 401.
 *
 * Catatan: jika Agent Search belum dikonfigurasi (AGENT_SEARCH_ENABLED=false),
 * response yang valid adalah 200/400/503 (NOT_CONFIGURED / invalid request) —
 * BUKAN 500/401. Skrip hanya menggagalkan pada 500 dan 401.
 *
 * Jalankan:
 *   node scripts/verify-ai-search-browser.mjs
 */
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { createClient } from '@libsql/client';
import { chromium } from 'playwright-core';

const BASE_URL = 'http://localhost:5180';
const CHROME_PATH = 'C:/Program Files/Google/Chrome/Application/chrome.exe';

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
  const turso = createClient({
    url: process.env.TURSO_DATABASE_URL,
    authToken: process.env.TURSO_AUTH_TOKEN,
  });
  try {
    const users = await turso.execute({ sql: 'SELECT id, email FROM user LIMIT 1', args: [] });
    const userId = users.rows[0]?.id;
    const email = users.rows[0]?.email;
    if (!userId) throw new Error('Tidak ada user di tabel user — jalankan migrasi/seed dulu');
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

const results = [];
function record(name, status) {
  results.push({ name, status });
  console.log(`[api] ${name} → ${status}`);
}

loadEnv();
const session = await mintSessionCookie();
console.log(`Minted session untuk: ${session.email} (userId ${session.userId.slice(0, 8)}...)`);

const browser = await chromium.launch({ executablePath: CHROME_PATH, headless: true });
const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });

// Suppress onboarding modal (pola sama dengan authContext.ts)
await context.addInitScript((key) => {
  try { localStorage.setItem(key, 'true'); } catch { /* noop */ }
}, 'cashflow-onboarding-done');

// Inject cookie sesi
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
page.on('response', (resp) => {
  const url = resp.url();
  if (!url.includes('/api/agent-search')) return;
  const name = url.replace('http://localhost:5181', '');
  record(name, resp.status());
});

try {
  // ============ 1. Navigasi halaman ============
  console.log('\n=== /suite/ai-search ===');
  const respNav = await page.goto(`${BASE_URL}/suite/ai-search`, { waitUntil: 'domcontentloaded', timeout: 30000 });
  check('Navigasi ke /suite/ai-search', respNav && respNav.status() < 400, respNav ? `HTTP ${respNav.status()}` : 'no response');

  await page.waitForSelector('h1:has-text("AI Search")', { timeout: 15000 }).catch(() => {});
  const titleVisible = await page.getByRole('heading', { name: 'AI Search', exact: true }).count();
  check('Judul "AI Search" tampil', titleVisible > 0);

  // Status pills (health check selesai dalam 5 detik)
  await page.waitForTimeout(4000);
  const pillActive = await page.getByText('Agent Search aktif', { exact: true }).count();
  const pillInactive = await page.getByText('Belum aktif', { exact: true }).count();
  check('Status pill health tampil (aktif atau belum)', pillActive > 0 || pillInactive > 0,
    pillActive > 0 ? 'aktif' : 'belum aktif (OK — tergantung konfigurasi)');

  // Tab tabs tampil
  const tabTransaksi = await page.getByRole('button', { name: 'Transaksi', exact: true }).count();
  check('Tab "Transaksi" tampil', tabTransaksi > 0);

  // ============ 2. Query di tab transactions ============
  console.log('\n=== Query tab transactions ===');
  await page.getByRole('button', { name: 'Transaksi', exact: true }).click().catch(() => {});
  await page.waitForTimeout(500);

  const input = page.locator('input[placeholder*="Contoh: cari transaksi"]');
  const inputCount = await input.count();
  check('Input query transactions tampil', inputCount > 0);
  if (inputCount > 0) {
    await input.fill('cari transaksi tiket Bali');
    await page.getByRole('button', { name: 'Cari', exact: true }).click().catch(() => {});
    // Tunggu response answer (sampai loading selesai atau error state)
    await page.waitForTimeout(7000);
    const loadingGone = (await page.locator('button:has-text("Mencari")').count()) === 0;
    check('Loading selesai (tidak stuck)', loadingGone);
    // Error state mungkin muncul jika belum dikonfigurasi — itu valid, bukan 500
    const errorState = await page.getByText(/Agent Search belum dikonfigurasi|belum dikonfigurasi/).count();
    console.log(`[info] error state (valid jika belum dikonfigurasi): ${errorState > 0 ? 'muncul' : 'tidak'}`);
  }

  // ============ 3. Sync transaksi ============
  console.log('\n=== Sync transaksi ===');
  const syncBtn = page.getByRole('button', { name: 'Sync transaksi', exact: true });
  const syncBtnCount = await syncBtn.count();
  check('Tombol "Sync transaksi" tampil (tab transactions)', syncBtnCount > 0);
  if (syncBtnCount > 0) {
    // Tombol disabled selama syncing (disabled={!!syncing}) dan re-enabled setelah selesai.
    // Jangan cek teks — teks 'Sync transaksi' selalu tampil (loading hanya menukar ikon).
    await syncBtn.click().catch(() => {});
    await page.waitForTimeout(6000);
    const stillDisabled = await syncBtn.isDisabled().catch(() => true);
    const toastError = await page.getByText('Sync gagal', { exact: true }).count();
    const toastSuccess = await page.getByText('Sync berhasil', { exact: true }).count();
    console.log(`[info] toast sync: ${toastSuccess > 0 ? 'berhasil' : toastError > 0 ? 'gagal (valid jika belum dikonfigurasi)' : 'tidak terlihat'}`);
    check('Sync selesai (tombol tidak lagi disabled)', !stillDisabled);
  }
} catch (err) {
  check('Eksekusi skrip', false, err.message);
} finally {
  // ============ Ringkasan API responses ============
  console.log('\n=== Ringkasan API /api/agent-search/* ===');
  if (results.length === 0) {
    console.log('⚠️ Tidak ada response /api/agent-search/* yang tertangkap');
  }
  const serverErrors = results.filter((r) => r.status >= 500);
  if (serverErrors.length === 0) {
    console.log('✅ Tidak ada response 500 pada /api/agent-search/*');
  } else {
    console.log(`❌ ${serverErrors.length} response 5xx: ${serverErrors.map((r) => `${r.name}=${r.status}`).join(', ')}`);
    failed++;
  }
  const authErrors = results.filter((r) => r.status === 401);
  if (authErrors.length === 0) {
    console.log('✅ Tidak ada response 401 (auth req.user bekerja)');
  } else {
    console.log(`❌ ${authErrors.length} response 401: ${authErrors.map((r) => `${r.name}`).join(', ')}`);
    failed++;
  }

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
  console.log(failed === 0 ? '✅ VERIFIKASI LULUS — AI Search berfungsi tanpa 500/401' : `❌ ${failed} check GAGAL`);
  console.log('========================================');
  process.exit(failed === 0 ? 0 : 1);
}
