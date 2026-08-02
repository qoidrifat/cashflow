/**
 * TEMP verification script — Admin Monitoring page (CF-053/CF-055)
 *
 * Memverifikasi fix resolveAdmin(): halaman /admin/monitoring memuat summary
 * cards dan riwayat panggilan per fitur TANPA 401.
 *
 * Login via cookie Better Auth yang di-mint langsung ke Turso (pola sama dengan
 * e2e/helpers/mintSession.ts + authContext.ts). User pertama di DB =
 * qoidrifat23@gmail.com = ADMIN_EMAILS, jadi otomatis lolos gate admin.
 *
 * Jalankan:
 *   node scripts/verify-admin-monitoring.mjs
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
function record(name, status, payload) {
  results.push({ name, status, payload });
  console.log(`[api] ${name} → ${status}${payload && payload.total !== undefined ? ` (total=${payload.total})` : ''}`);
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
  if (!url.includes('/api/admin/metrics')) return;
  const name = url.replace('http://localhost:5181', '');
  resp.json().then((j) => record(name, resp.status(), j)).catch(() => record(name, resp.status()));
});

try {
  // ============ 1. Halaman utama Monitoring ============
  console.log('\n=== /admin/monitoring ===');
  const respNav = await page.goto(`${BASE_URL}/admin/monitoring`, { waitUntil: 'domcontentloaded', timeout: 30000 });
  check('Navigasi ke /admin/monitoring', respNav && respNav.status() < 400, respNav ? `HTTP ${respNav.status()}` : 'no response');

  // Tunggu summary cards render (judul halaman + salah satu card)
  await page.waitForSelector('text=AI Cost & Health', { timeout: 15000 }).catch(() => {});
  const titleVisible = await page.getByText('AI Cost & Health', { exact: true }).count();
  check('Judul "AI Cost & Health" tampil', titleVisible > 0);

  // Tunggu data summary render (dalam 5 detik — error/403 akan muncul lebih cepat)
  await page.waitForTimeout(4000);
  const errorCard = await page.getByText(/Tidak dapat memuat data monitoring|Akses ditolak/).count();
  check('TIDAK ada error card (401/403)', errorCard === 0, errorCard > 0 ? 'error card muncul' : 'OK');

  // Cards summary (Biaya Hari Ini, Token Hari Ini, Calls Hari Ini, Avg Time)
  const cardLabels = ['Biaya Hari Ini', 'Token Hari Ini', 'Calls Hari Ini', 'Avg Time'];
  for (const label of cardLabels) {
    const count = await page.getByText(label, { exact: true }).count();
    check(`Summary card "${label}" tampil`, count > 0);
  }

  // Skeleton tidak stuck (data dirender bukan loading selamanya)
  const skeletonCount = await page.locator('.animate-pulse').count();
  check('Skeleton loading hilang', skeletonCount === 0, skeletonCount > 0 ? 'masih skeleton' : 'OK');

  // ============ 2. Feature health cards + navigasi detail ============
  console.log('\n=== Feature health + detail ===');
  // Klik card fitur pertama (role=button dengan aria-label "Lihat detail riwayat panggilan ...")
  const featureCards = page.locator('div[role="button"]', { hasText: 'Lihat detail' });
  const featureCount = await featureCards.count();
  check('Feature health cards tampil', featureCount > 0, `${featureCount} card`);

  let detailNavigated = false;
  let detailUrl = '';
  if (featureCount > 0) {
    // Ambil feature dari aria-label
    const ariaLabel = await featureCards.first().getAttribute('aria-label');
    const featureMatch = ariaLabel?.match(/Lihat detail riwayat panggilan (.+)/);
    const feature = featureMatch ? featureMatch[1] : 'gmail_sync';
    detailUrl = `${BASE_URL}/admin/monitoring/${encodeURIComponent(feature)}`;
    console.log(`[nav] klik card → /admin/monitoring/${feature}`);
    await featureCards.first().click();
    await page.waitForURL((u) => u.toString().includes('/admin/monitoring/'), { timeout: 15000 }).catch(() => {});
    detailNavigated = true;
  }

  if (detailNavigated) {
    await page.waitForSelector('text=Riwayat panggilan', { timeout: 15000 }).catch(() => {});
    await page.waitForTimeout(4000);
    const detailError = await page.getByText(/Tidak dapat memuat data|Akses ditolak/).count();
    check('Detail: TIDAK ada error (401/403)', detailError === 0, detailError > 0 ? 'error card muncul' : 'OK');
    const detailTitle = await page.getByText('Riwayat panggilan AI 30 hari terakhir.', { exact: false }).count();
    check('Detail: deskripsi riwayat tampil', detailTitle > 0);
    // Summary cards detail
    for (const label of ['Total Calls', 'Success Rate', 'Gagal', 'Avg Time']) {
      const c = await page.getByText(label, { exact: true }).count();
      check(`Detail: summary card "${label}" tampil`, c > 0);
    }
    // Status tabs
    for (const tab of ['Semua', 'Berhasil', 'Gagal']) {
      const c = await page.getByText(tab, { exact: true }).count();
      check(`Detail: tab status "${tab}" tampil`, c > 0);
    }
  } else {
    check('Detail: navigasi ke fitur', false, 'tidak ada feature card');
  }
} catch (err) {
  check('Eksekusi skrip', false, err.message);
} finally {
  // ============ Ringkasan API responses ============
  console.log('\n=== Ringkasan API /api/admin/metrics/* ===');
  const apiCalls = results.filter((r) => r.status === 401);
  if (apiCalls.length === 0) {
    console.log('✅ Tidak ada 401 pada /api/admin/metrics/*');
  } else {
    console.log(`❌ ${apiCalls.length} response 401:`);
    apiCalls.forEach((r) => console.log(`   ${r.name}`));
    failed++;
  }
  const nonOk = results.filter((r) => r.status >= 400);
  if (nonOk.length === 0) {
    console.log('✅ Semua response /api/admin/metrics/* < 400');
  } else {
    console.log(`⚠️ Response non-2xx: ${nonOk.map((r) => `${r.name}=${r.status}`).join(', ')}`);
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
  console.log(failed === 0 ? '✅ VERIFIKASI LULUS — Admin Monitoring berfungsi tanpa 401' : `❌ ${failed} check GAGAL`);
  console.log('========================================');
  process.exit(failed === 0 ? 0 : 1);
}
