#!/usr/bin/env node
/**
 * Demo Data Seeder — Preview tanpa Google OAuth.
 *
 * Membuat user demo (demo@cashflow.test) + dataset realistis sehingga user
 * bisa login lewat cookie (tanpa OAuth) dan melihat Dashboard, AI Hub,
 * AI Timeline, dan Admin Monitoring berisi data:
 *
 *   - user demo (user + users + profiles, id sama)
 *   - 7 kategori default
 *   - ±32 transaksi realistis (bobot bulan berjalan → saldo/chart/budget hidup)
 *   - 5 budgets bulan berjalan (used_amount konsisten dengan transaksi)
 *   - 4 notifikasi · 2 gmail sync runs + 6 logs (4 auto_accepted, 2 needs_review)
 *   - AI: 6 timeline events, 7 feedback, 3 memory
 *   - system_metrics: recommendation_shown/opened (panel Rekomendasi AI),
 *     ai_result_shown (Feedback Rate), ai_hub_view, user_active (4 hari),
 *     http_2xx_total + http_latency_ms
 *   - ai_usage_metrics 4 baris (panel AI Usage & Tren Biaya)
 *   - Sesi Better Auth 7 hari → cookie `${token}.${sig}` untuk di-inject
 *     ke browser preview (nama cookie: better-auth.session_token).
 *
 * IDEMPOTEN: delete-first hanya untuk data milik demo (email demo@cashflow.test
 * + prefiks id 'demo-*' / 'demo-reco-*' / 'demo-usage-*') — TIDAK menyentuh
 * data user lain.
 *
 * ⚠️ SAFETY GUARD: wajib SEED_DEMO=1 (pola scripts/seedE2eDataset.mjs) —
 * mencegah eksekusi tak sengaja terhadap DB development.
 *
 * Penggunaan:
 *   SEED_DEMO=1 node scripts/seedDemoData.mjs            # seed + cetak cookie
 *   SEED_DEMO=1 node scripts/seedDemoData.mjs --cleanup  # hapus semua data demo
 */
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { createClient } from '@libsql/client';
import { withRetry, TRANSIENT_RE } from '../server/lib/retry.js';

const IS_MAIN = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;

const DEMO_EMAIL = 'demo@cashflow.test';
const DEMO_NAME = 'Dafa Preview';
const DEMO_PREFIX = 'demo';
const DEV_FALLBACK_SECRET = 'cashflow-dev-secret-change-in-production';

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

/** YYYY-MM-DD n hari lalu (UTC). */
function daysAgoDate(n) {
  return new Date(Date.now() - n * 86_400_000).toISOString().slice(0, 10);
}

/** "YYYY-MM-DD HH:MM:SS" n hari lalu — format created_at system_metrics. */
function daysAgoSpace(n, hour = 10) {
  const d = new Date(Date.now() - n * 86_400_000);
  d.setUTCHours(hour, 15, 0, 0);
  return d.toISOString().slice(0, 19).replace('T', ' ');
}

const EXPENSE_CATEGORIES = [
  ['food', 'Makanan & Minuman', 'Utensils', '#f97316'],
  ['transport', 'Transportasi', 'Bus', '#3b82f6'],
  ['shopping', 'Belanja', 'ShoppingBag', '#ec4899'],
  ['bills', 'Tagihan', 'FileText', '#ef4444'],
  ['entertainment', 'Hiburan', 'Clapperboard', '#8b5cf6'],
];
const INCOME_CATEGORIES = [
  ['salary', 'Gaji', 'Wallet', '#10b981'],
  ['freelance', 'Freelance', 'Briefcase', '#14b8a6'],
];

// [daysAgo, type, amount, catKey, merchant, note]
const TRANSACTIONS = [
  // Pemasukan
  [1, 'income', 8500000, 'salary', 'PT Maju Jaya', 'Gaji bulan Agustus'],
  [4, 'income', 2400000, 'freelance', 'Upwork', 'Project dashboard analitik'],
  // Makanan & Minuman
  [0, 'expense', 45000, 'food', 'GoFood', 'Lunch'],
  [0, 'expense', 28000, 'food', 'Kopi Kenangan', 'Es kopi susu'],
  [1, 'expense', 38500, 'food', 'ShopeeFood', 'Ayam geprek + es teh'],
  [2, 'expense', 25000, 'food', 'Warung Bu Tini', 'Makan siang'],
  [3, 'expense', 155000, 'food', 'Diamond Resto', 'Makan malam teman'],
  [5, 'expense', 12000, 'food', 'Alfamart', 'Snack'],
  [8, 'expense', 60000, 'food', 'GoFood', 'Bakso'],
  // Transportasi
  [0, 'expense', 42000, 'transport', 'Gojek', 'GoRide ke kantor'],
  [1, 'expense', 68000, 'transport', 'GoCar', 'Meeting client'],
  [2, 'expense', 35000, 'transport', 'Grab', 'GoCar pulang malam'],
  [4, 'expense', 20000, 'transport', 'KRL', 'Commuter line'],
  [6, 'expense', 250000, 'transport', 'MyPertamina', 'Isi bensin'],
  [9, 'expense', 20000, 'transport', 'KRL', 'Commuter line'],
  // Belanja
  [1, 'expense', 189000, 'shopping', 'Tokopedia', 'Tas laptop'],
  [2, 'expense', 120000, 'shopping', 'Shopee', 'Kabel charger'],
  [5, 'expense', 349000, 'shopping', 'Uniqlo', 'Kaos polos ×2'],
  [7, 'expense', 156000, 'shopping', 'Sociolla', 'Skincare'],
  // Tagihan
  [2, 'expense', 485000, 'bills', 'PLN', 'Listrik Agustus'],
  [3, 'expense', 320000, 'bills', 'IndiHome', 'Internet + TV'],
  [4, 'expense', 132000, 'bills', 'BPJS', 'Kesehatan'],
  [6, 'expense', 50000, 'bills', 'Telkomsel', 'Pulsa'],
  // Hiburan
  [3, 'expense', 79000, 'entertainment', 'Netflix', 'Langganan bulanan'],
  [4, 'expense', 55000, 'entertainment', 'Spotify', 'Premium'],
  [6, 'expense', 85000, 'entertainment', 'XXI', 'Nonton film'],
  [9, 'expense', 65000, 'entertainment', 'Disney+', 'Langganan'],
  // Lainnya
  [8, 'refund', 75000, 'shopping', 'Refund Tokopedia', 'Pengembalian pesanan'],
  [5, 'transfer', 500000, 'food', 'Transfer Bank', 'Transfer ke rekening tabungan'],
];

// Budgets bulan berjalan — used_amount dihitung dari transaksi (konsisten).
const BUDGET_LIMITS = { food: 1500000, transport: 1000000, shopping: 1200000, bills: 1000000, entertainment: 400000 };

const NOTIFICATIONS = [
  ['budget_warning', 'high', 'Budget Transportasi hampir habis', 'Pengeluaran transportasi sudah 82% dari limit bulan ini.'],
  ['gmail_sync', 'normal', 'Gmail Sync selesai', '4 email transaksi baru diproses, 2 menunggu review.'],
  ['ai_insight', 'normal', 'Insight baru dari AI', 'Pengeluaran makanan naik 27% dibanding minggu lalu.'],
  ['system', 'low', 'Selamat datang di CashFlow!', 'Ini akun demo preview — data bisa dibersihkan kapan saja.'],
];

// [daysAgo, feature, eventType, status, title, body, confidence, payload]
const TIMELINE = [
  [1, 'insight', 'insight', 'viewed', 'Pengeluaran makanan naik 27%', 'Belanja GoFood dan ShopeeFood meningkat vs minggu sebelumnya. Pertimbangkan batas harian.', 0.82, { periodDays: 7, expense: 1150000, topCategory: 'Makanan' }],
  [2, 'advisor', 'recommendation', 'completed', 'Kurangi belanja impulsif', 'Total belanja online 668rb minggu ini — tetapkan masa tunggu 24 jam sebelum checkout.', 0.71, { windowDays: 7, shoppingExpense: 668000 }],
  [3, 'conversation', 'conversation', 'completed', 'Kenapa uangku habis minggu ini?', 'Pertanyaan natural language dengan ringkasan ringkas + grafik.', null, { periodDays: 7 }],
  [5, 'memory', 'memory_update', 'new', 'Preferensi diperbarui', 'AI ingat: Metode pembayaran = Transfer e-wallet.', null, { category: 'payment_preference', key: 'Metode pembayaran', action: 'set' }],
  [6, 'insight', 'insight', 'new', 'Tagihan bulan ini lebih tinggi', 'Total tagihan 987rb — 22% di atas rata-rata 3 bulan terakhir.', 0.66, { periodDays: 30, bills: 987000 }],
  [7, 'fraud', 'risk', 'dismissed', 'Transaksi mencurigakan terdeteksi', 'Pola pembelian di jam tak biasa — sudah direview dan aman.', 0.9, { rule: 'unusual_hour' }],
];

// [daysAgo, feature, rating, reason]
const FEEDBACK = [
  [1, 'insight', 'helpful', 'Angkanya jelas'],
  [2, 'advisor', 'helpful', 'Saran bisa langsung dipraktekkan'],
  [2, 'insight', 'not_helpful', 'Terlalu generik'],
  [3, 'conversation', 'mismatched', 'Tidak sesuai konteks budget'],
  [5, 'advisor', 'already_done', 'Sudah saya lakukan'],
  [6, 'insight', 'skip', ''],
  [7, 'advisor', 'irrelevant', 'Bukan prioritas saya'],
];

const MEMORY = [
  ['payment_preference', 'Metode pembayaran', 'Transfer e-wallet'],
  ['goal', 'Target nabung', 'Rp 5 juta akhir tahun'],
  ['note', 'Anggaran makanan', 'Maksimal 1,5 juta per bulan'],
];

function makeCategoriesStmts(userId) {
  const stmts = [];
  for (const [id, name, icon, color] of EXPENSE_CATEGORIES) {
    stmts.push([`INSERT INTO categories (id, user_id, name, type, icon, color, is_default) VALUES (?, ?, ?, 'expense', ?, ?, 1) ON CONFLICT(user_id, id) DO NOTHING`, [`cat-${id}`, userId, name, icon, color]]);
  }
  for (const [id, name, icon, color] of INCOME_CATEGORIES) {
    stmts.push([`INSERT INTO categories (id, user_id, name, type, icon, color, is_default) VALUES (?, ?, ?, 'income', ?, ?, 1) ON CONFLICT(user_id, id) DO NOTHING`, [`cat-${id}`, userId, name, icon, color]]);
  }
  return stmts;
}

function makeTransactionStmts(userId) {
  const nowIso = new Date().toISOString();
  const byCat = {};
  const stmts = TRANSACTIONS.map(([daysAgo, type, amount, catKey, merchant, note], i) => {
    const date = daysAgoDate(daysAgo);
    if (type === 'expense') byCat[catKey] = (byCat[catKey] || 0) + amount;
    return [
      `INSERT INTO transactions (id, user_id, type, amount, category_id, category_name, merchant, payment_method, note, date, transaction_date, source, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, 'cash', ?, ?, ?, 'manual', ?, ?) ON CONFLICT(id) DO NOTHING`,
      [`${DEMO_PREFIX}-tx-${String(i).padStart(3, '0')}`, userId, type, amount, `cat-${catKey}`,
        type === 'income' ? INCOME_CATEGORIES.find((c) => c[0] === catKey)?.[1] : EXPENSE_CATEGORIES.find((c) => c[0] === catKey)?.[1],
        merchant, note, date, date, nowIso, nowIso],
    ];
  });
  return { stmts, byCat };
}

function makeBudgetStmts(userId, byCat, month, year) {
  const nowIso = new Date().toISOString();
  return EXPENSE_CATEGORIES.map(([catKey, name]) => {
    const amount = BUDGET_LIMITS[catKey] || 500000;
    const used = byCat[catKey] || 0;
    const status = used >= amount ? 'overbudget' : used >= amount * 0.8 ? 'warning' : 'safe';
    return [
      `INSERT INTO budgets (id, user_id, category_id, category_name, amount, used_amount, month, year, status, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?) ON CONFLICT(user_id, category_id, month, year) DO NOTHING`,
      [`${DEMO_PREFIX}-budget-${catKey}`, userId, `cat-${catKey}`, name, amount, used, month, year, status, nowIso, nowIso],
    ];
  });
}

function makeAiStmts(userId) {
  const stmts = [];
  TIMELINE.forEach(([daysAgo, feature, eventType, status, title, body, confidence, payload], i) => {
    stmts.push([
      `INSERT INTO ai_timeline (id, user_id, feature, event_type, status, title, body, confidence, payload, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?) ON CONFLICT(id) DO NOTHING`,
      [`${DEMO_PREFIX}-tl-${i}`, userId, feature, eventType, status, title, body, confidence, JSON.stringify(payload), daysAgoSpace(daysAgo, 9)],
    ]);
  });
  FEEDBACK.forEach(([daysAgo, feature, rating, reason], i) => {
    stmts.push([
      `INSERT INTO ai_feedback (id, user_id, feature, item_id, rating, reason, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?) ON CONFLICT(id) DO NOTHING`,
      [`${DEMO_PREFIX}-fb-${i}`, userId, feature, '', rating, reason, daysAgoSpace(daysAgo, 11)],
    ]);
  });
  MEMORY.forEach(([category, key, value], i) => {
    stmts.push([
      `INSERT INTO ai_memory (id, user_id, category, key, value, source, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, 'manual', ?, ?) ON CONFLICT(user_id, category, key) DO NOTHING`,
      [`${DEMO_PREFIX}-mem-${i}`, userId, category, key, value, daysAgoSpace(4, 12), daysAgoSpace(4, 12)],
    ]);
  });
  return stmts;
}

function makeSystemMetricsStmts(userId) {
  const stmts = [];
  const meta = (obj) => JSON.stringify(obj);
  const reco = (id, name, feature, eventType, daysAgo) => [
    `INSERT INTO system_metrics (id, metric_name, metric_value, feature, user_id, metadata, created_at) VALUES (?, ?, 1, 'ai_product', ?, ?, ?) ON CONFLICT(id) DO NOTHING`,
    [`demo-reco-${id}`, name, userId, meta({ feature, itemId: `demo-reco-${id}`, eventType }), daysAgoSpace(daysAgo, 10)],
  ];
  stmts.push(
    reco('a1', 'recommendation_shown', 'advisor', 'recommendation', 0),
    reco('a2', 'recommendation_shown', 'advisor', 'recommendation', 1),
    reco('a3', 'recommendation_shown', 'advisor', 'recommendation', 2),
    reco('a4', 'recommendation_shown', 'insight', 'recommendation', 3),
    reco('a5', 'recommendation_shown', 'conversation', 'recommendation', 4),
    reco('o1', 'recommendation_opened', 'advisor', 'recommendation', 0),
    reco('o2', 'recommendation_opened', 'advisor', 'recommendation', 1),
    reco('o3', 'recommendation_opened', 'insight', 'recommendation', 3),
  );
  // Feedback Rate denominator: tampilan kartu AI
  ['advisor', 'insight', 'conversation', 'insight', 'advisor', 'conversation', 'insight', 'advisor'].forEach((feature, i) => {
    stmts.push([
      `INSERT INTO system_metrics (id, metric_name, metric_value, feature, user_id, metadata, created_at) VALUES (?, 'ai_result_shown', 1, ?, ?, '{}', ?) ON CONFLICT(id) DO NOTHING`,
      [`demo-ars-${i}`, feature, userId, daysAgoSpace(i % 4, 9)],
    ]);
  });
  // AI Hub exposure
  stmts.push(
    [`INSERT INTO system_metrics (id, metric_name, metric_value, feature, user_id, metadata, created_at) VALUES (?, 'ai_hub_view', 1, 'ai_hub', ?, '{}', ?) ON CONFLICT(id) DO NOTHING`, ['demo-hub-1', userId, daysAgoSpace(0, 8)]],
    [`INSERT INTO system_metrics (id, metric_name, metric_value, feature, user_id, metadata, created_at) VALUES (?, 'ai_hub_view', 1, 'ai_hub', ?, '{}', ?) ON CONFLICT(id) DO NOTHING`, ['demo-hub-2', userId, daysAgoSpace(1, 13)]],
  );
  // Retention signal (user_active) — 4 hari terakhir
  for (let i = 0; i < 4; i++) {
    const day = daysAgoDate(i);
    stmts.push([
      `INSERT INTO system_metrics (id, metric_name, metric_value, feature, user_id, metadata, created_at) VALUES (?, 'user_active', 1, 'app', ?, ?, ?) ON CONFLICT(id) DO NOTHING`,
      [`demo-active-${i}`, userId, JSON.stringify({ day }), `${day} 12:00:00`],
    ]);
  }
  // HTTP traffic ringan
  stmts.push(
    [`INSERT INTO system_metrics (id, metric_name, metric_value, feature, user_id, metadata, created_at) VALUES (?, 'http_2xx_total', 1, 'http', ?, '{}', ?) ON CONFLICT(id) DO NOTHING`, ['demo-http-1', userId, daysAgoSpace(0, 7)]],
    [`INSERT INTO system_metrics (id, metric_name, metric_value, feature, user_id, metadata, created_at) VALUES (?, 'http_2xx_total', 1, 'http', ?, '{}', ?) ON CONFLICT(id) DO NOTHING`, ['demo-http-2', userId, daysAgoSpace(1, 14)]],
    [`INSERT INTO system_metrics (id, metric_name, metric_value, feature, user_id, metadata, created_at) VALUES (?, 'http_latency_ms', 240, 'http', ?, '{}', ?) ON CONFLICT(id) DO NOTHING`, ['demo-lat-1', userId, daysAgoSpace(0, 7)]],
  );
  return stmts;
}

function makeAiUsageStmts(userId) {
  const rows = [
    ['demo-usage-gmail', 'gmail_sync', 2000, 0, 0.01, 150, 120, daysAgoSpace(1, 9)],
    ['demo-usage-ocr', 'ocr_receipt', 800, 0, 0.004, 50, 180, daysAgoSpace(1, 10)],
    ['demo-usage-insight', 'insight_generator', 1200, 0, 0.008, 100, 320, daysAgoSpace(0, 8)],
    ['demo-usage-advisor', 'advisor', 1800, 0, 0.012, 220, 410, daysAgoSpace(0, 9)],
  ];
  return rows.map(([id, feature, pt, ct, usd, idr, ms, createdAt]) => [
    `INSERT INTO ai_usage_metrics (id, user_id, feature, provider, model, prompt_tokens, completion_tokens, estimated_cost_usd, estimated_cost_idr, execution_time_ms, status, metadata, created_at)
     VALUES (?, ?, ?, 'gemini_flash', 'gemini-2.5-flash', ?, ?, ?, ?, ?, 'success', '{}', ?) ON CONFLICT(id) DO NOTHING`,
    [id, userId, feature, pt, ct, usd, idr, ms, createdAt],
  ]);
}

function makeGmailStmts(userId) {
  const stmts = [];
  const now = Date.now();
  for (let r = 0; r < 2; r++) {
    stmts.push([
      `INSERT INTO gmail_sync_runs (id, user_id, status, started_at, completed_at, total_emails, processed, accepted, rejected, skipped, failed)
       VALUES (?, ?, 'completed', ?, ?, 6, 6, 4, 0, 2, 0) ON CONFLICT(id) DO NOTHING`,
      [`demo-run-${r + 1}`, userId, new Date(now - (r + 1) * 86_400_000).toISOString(), new Date(now - r * 86_400_000).toISOString()],
    ]);
  }
  const logs = [
    ['auto_accepted', 'BCA', 'bca.co.id', 0.94],
    ['auto_accepted', 'GoPay', 'gopay.co.id', 0.91],
    ['auto_accepted', 'Shopee', 'shopee.co.id', 0.89],
    ['auto_accepted', 'Mandiri', 'bankmandiri.co.id', 0.95],
    ['needs_review', 'Tokopedia', 'tokopedia.com', 0.58],
    ['needs_review', 'Grab', 'grab.com', 0.61],
  ];
  logs.forEach(([status, sender, domain, conf], i) => {
    stmts.push([
      `INSERT INTO gmail_sync_logs (id, user_id, message_id, subject, sender, sender_domain, email_date, status, final_status, confidence_score, sync_run_id, scanned_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?) ON CONFLICT(id) DO NOTHING`,
      [`demo-log-${i + 1}`, userId, `demo-msg-${i + 1}`, `Transaksi ${sender} #${1000 + i}`, `no-reply@${domain}`, domain,
        daysAgoDate(i % 3), status, status, conf, `demo-run-${(i % 2) + 1}`, new Date(now - (i % 3) * 86_400_000).toISOString()],
    ]);
  });
  return stmts;
}

/** Mint sesi Better Auth (cookie `${token}.${sig}`) — identik dengan e2e/helpers/mintSession.ts. */
async function mintSession(turso, userId) {
  const token = crypto.randomBytes(24).toString('base64url').slice(0, 32);
  const secret = process.env.BETTER_AUTH_SECRET || process.env.AUTH_SECRET || DEV_FALLBACK_SECRET;
  const sig = crypto.createHmac('sha256', secret).update(token).digest('base64');
  const now = new Date();
  await turso.execute({
    sql: `INSERT INTO session (id, expiresAt, token, createdAt, updatedAt, ipAddress, userAgent, userId)
          VALUES (?, ?, ?, ?, ?, '', 'demo-preview', ?)`,
    args: [token, new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000).toISOString(), token, now.toISOString(), now.toISOString(), userId],
  });
  return { cookie: `${token}.${sig}`, token };
}

async function withRetryExec(turso, { sql, args }, label) {
  return withRetry(() => turso.execute({ sql, args }), { label });
}

async function cleanup(turso, userId) {
  // Hapus data demo-scoped (user_id = userId) + baris berprefiks demo-*.
  const tables = [
    'transactions', 'budgets', 'notifications', 'categories', 'ai_feedback',
    'ai_timeline', 'ai_memory', 'gmail_sync_logs', 'gmail_sync_runs',
  ];
  for (const t of tables) {
    await withRetryExec(turso, { sql: `DELETE FROM ${t} WHERE user_id = ?`, args: [userId] }, `cleanup ${t}`);
  }
  await withRetryExec(turso, { sql: `DELETE FROM system_metrics WHERE user_id = ? OR id LIKE 'demo-%'`, args: [userId] }, 'cleanup system_metrics');
  await withRetryExec(turso, { sql: `DELETE FROM ai_usage_metrics WHERE user_id = ? OR id LIKE 'demo-usage-%'`, args: [userId] }, 'cleanup ai_usage_metrics');
  await withRetryExec(turso, { sql: `DELETE FROM session WHERE userAgent = 'demo-preview'`, args: [] }, 'cleanup session');
  await withRetryExec(turso, { sql: `DELETE FROM profiles WHERE user_id = ?`, args: [userId] }, 'cleanup profiles');
  await withRetryExec(turso, { sql: `DELETE FROM user WHERE id = ?`, args: [userId] }, 'cleanup user');
  await withRetryExec(turso, { sql: `DELETE FROM users WHERE id = ?`, args: [userId] }, 'cleanup users');
}

async function main() {
  loadEnv();
  const url = process.env.TURSO_DATABASE_URL;
  const token = process.env.TURSO_AUTH_TOKEN;
  if (!url || !token) {
    console.error('[seedDemo] TURSO_DATABASE_URL / TURSO_AUTH_TOKEN wajib di-set (env atau server/.env).');
    process.exit(1);
  }
  const turso = createClient({ url, authToken: token });
  const isCleanup = process.argv.includes('--cleanup');

  try {
    // Resolusi id user demo (prioritas singular).
    const [sing] = (await withRetryExec(turso, { sql: 'SELECT id FROM user WHERE email = ?', args: [DEMO_EMAIL] }, 'SELECT user')).rows;
    const [plur] = (await withRetryExec(turso, { sql: 'SELECT id FROM users WHERE email = ?', args: [DEMO_EMAIL] }, 'SELECT users')).rows;
    const userId = sing?.id || plur?.id || crypto.randomBytes(16).toString('hex');

    await cleanup(turso, userId);
    if (isCleanup) {
      console.log(`[seedDemo] 🧹 Data demo dihapus (${DEMO_EMAIL}, id ${userId.slice(0, 8)}…).`);
      return;
    }

    // ==== User (singular + plural + profiles, id sama) ====
    await withRetryExec(turso, {
      sql: `INSERT INTO user (id, name, email, emailVerified, createdAt, updatedAt, displayName) VALUES (?, ?, ?, 1, ?, ?, ?)`,
      args: [userId, DEMO_NAME, DEMO_EMAIL, Math.floor(Date.now() / 1000) - 30 * 86400, Math.floor(Date.now() / 1000), DEMO_NAME],
    }, 'INSERT user');
    await withRetryExec(turso, {
      sql: `INSERT INTO users (id, email, name, display_name) VALUES (?, ?, ?, ?)`,
      args: [userId, DEMO_EMAIL, DEMO_NAME, DEMO_NAME],
    }, 'INSERT users');
    await withRetryExec(turso, {
      sql: `INSERT INTO profiles (user_id, name, display_name, email) VALUES (?, ?, ?, ?)`,
      args: [userId, DEMO_NAME, DEMO_NAME, DEMO_EMAIL],
    }, 'INSERT profiles');

    // ==== Data ====
    const now = new Date();
    const month = now.getMonth() + 1;
    const year = now.getFullYear();

    const catStmts = makeCategoriesStmts(userId);
    const { stmts: txStmts, byCat } = makeTransactionStmts(userId);
    const allStmts = [
      ...catStmts,
      ...txStmts,
      ...makeBudgetStmts(userId, byCat, month, year),
      ...NOTIFICATIONS.map(([type, priority, title, message], i) => [
        `INSERT INTO notifications (id, user_id, type, priority, title, message, read, dedupe_key, created_at)
         VALUES (?, ?, ?, ?, ?, ?, 0, ?, ?) ON CONFLICT(id) DO NOTHING`,
        [`demo-notif-${i}`, userId, type, priority, title, message, `demo-notif-${i}`, daysAgoSpace(i, 10)],
      ]),
      ...makeAiStmts(userId),
      ...makeSystemMetricsStmts(userId),
      ...makeAiUsageStmts(userId),
      ...makeGmailStmts(userId),
    ];

    // Batch (pola seedE2eDataset): chunk 50, write transaction, retry transien.
    for (let i = 0; i < allStmts.length; i += 50) {
      const chunk = allStmts.slice(i, i + 50).map(([sql, args]) => ({ sql, args }));
      await withRetry(() => turso.batch(chunk), { label: `seedDemo batch ${i / 50 + 1}` });
    }

    // ==== Sesi ====
    const { cookie } = await mintSession(turso, userId);

    console.log(`[seedDemo] ✅ Demo data siap untuk ${DEMO_EMAIL} (id ${userId.slice(0, 8)}…)`);
    console.log(`[seedDemo]    transaksi: ${TRANSACTIONS.length} · budget: 5 · notifikasi: ${NOTIFICATIONS.length}`);
    console.log(`[seedDemo]    timeline: ${TIMELINE.length} · feedback: ${FEEDBACK.length} · memory: ${MEMORY.length}`);
    console.log(`[seedDemo]    session cookie (better-auth.session_token):`);
    console.log(cookie);
    console.log(`[seedDemo]    URL login: http://localhost:5180/dashboard`);
  } finally {
    try { turso.close(); } catch { /* no-op */ }
  }
}

if (IS_MAIN && process.env.SEED_DEMO !== '1') {
  console.error('[seedDemo] ⛔ Safety guard: set SEED_DEMO=1 untuk menjalankan (mencegah penghapusan data di DB development).');
  process.exit(1);
}

if (IS_MAIN) {
  main()
    .then(() => process.exit(0))
    .catch((err) => {
      console.error(`[seedDemo] Gagal: ${err.message}`);
      process.exit(1);
    });
}
