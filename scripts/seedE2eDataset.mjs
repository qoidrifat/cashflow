#!/usr/bin/env node
/**
 * CI-isolated DB seed untuk E2E (P4.15).
 *
 * Tujuan: CI TIDAK bergantung pada DB development. Script ini mengisi database
 * Turso (via env TURSO_DATABASE_URL/TURSO_AUTH_TOKEN) dengan dataset deterministik
 * yang menjadi baseline E2E (nilai cocok dengan e2e/helpers/fixtures.ts PINNED):
 *
 *   - 1 user admin (email = ADMIN_EMAILS[0] atau default e2e-seed-admin@cashflow.test)
 *   - 284 transaksi  (86 income, 131 expense, 67 transfer/refund)
 *   - 519 gmail_sync_logs dengan distribusi status tetap
 *   - 2 gmail_sync_runs (riwayat sinkronisasi)
 *   - kategori default, beberapa budgets & notifications
 *
 * IDEMPOTEN: delete-then-insert untuk user seed → aman dijalankan berulang.
 * Aman: hanya menyentuh data milik USER SEED (email = ADMIN_EMAILS[0] atau
 * default), TIDAK menghapus data user lain.
 *
 * ⚠️ SAFETY GUARD: script HANYA berjalan bila env SEED_E2E='1' — mencegah
 * eksekusi tidak sengaja terhadap DB development (yang bisa menghapus data
 * admin). Workflow CI (e2e.yml) men-set SEED_E2E=1 di step seed.
 *
 * Penggunaan:
 *   SEED_E2E=1 TURSO_DATABASE_URL=libsql://... TURSO_AUTH_TOKEN=... node scripts/seedE2eDataset.mjs
 *   (server/.env juga dibaca bila env tidak di-set)
 */
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { createClient } from '@libsql/client';

if (process.env.SEED_E2E !== '1') {
  console.error('[seedE2e] ⛔ Safety guard: set SEED_E2E=1 untuk menjalankan seed (mencegah penghapusan data di DB development).');
  process.exit(1);
}

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

const ADMIN_EMAIL = (process.env.ADMIN_EMAILS || '')
  .split(',')[0]?.trim().toLowerCase() || 'e2e-seed-admin@cashflow.test';

/** RNG deterministik (mulberry32) agar dataset CI selalu identik. */
function mulberry32(seed) {
  let a = seed >>> 0;
  return function () {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
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

function rpAmount(rng, min, max) {
  return Math.round((min + rng() * (max - min)) / 1000) * 1000;
}

async function main() {
  loadEnv();
  const url = process.env.TURSO_DATABASE_URL;
  const token = process.env.TURSO_AUTH_TOKEN;
  if (!url || !token) {
    console.error('[seedE2e] TURSO_DATABASE_URL / TURSO_AUTH_TOKEN wajib di-set (env atau server/.env).');
    process.exit(1);
  }

  const turso = createClient({ url, authToken: token });
  const rng = mulberry32(20260802); // seed tetap → dataset deterministik

  try {
    const seedEmail = ADMIN_EMAIL;
    const existing = await turso.execute({ sql: 'SELECT id FROM user WHERE email = ?', args: [seedEmail] });
    let seedUserId = existing.rows[0]?.id;
    if (!seedUserId) {
      seedUserId = crypto.randomBytes(16).toString('hex');
      await turso.execute({
        sql: `INSERT INTO user (id, name, email, emailVerified) VALUES (?, ?, ?, 1)`,
        args: [seedUserId, 'E2E Seed Admin', seedEmail],
      });
    }
    // SYNC ke users (plural) — tabel bisnis (categories/transactions/budgets/...)
    // ber-FK REFERENCES users(id), sementara Better Auth memakai user (singular).
    // Keduanya HARUS berisi user seed dengan id yang SAMA (pola user riil di dev
    // DB — terverifikasi: id pJV0r… ada di kedua tabel). Tanpa ini, seed di DB CI
    // yang fresh gagal: "FOREIGN KEY constraint failed" (users kosong).
    // Upsert idempoten: ON CONFLICT(id) DO NOTHING → aman dijalankan berulang.
    await turso.execute({
      sql: `INSERT INTO users (id, email, name, display_name) VALUES (?, ?, ?, ?) ON CONFLICT(id) DO NOTHING`,
      args: [seedUserId, seedEmail, 'E2E Seed Admin', 'E2E Seed Admin'],
    });

    // ==== HAPUS data seed user (idempotent) ====
    for (const table of ['gmail_sync_logs', 'transactions', 'gmail_sync_runs', 'gmail_sync_settings', 'budgets', 'notifications', 'categories']) {
      await turso.execute({ sql: `DELETE FROM ${table} WHERE user_id = ?`, args: [seedUserId] });
    }

    // ==== Kategori ====
    const catIds = {};
    for (const [id, name, icon, color] of EXPENSE_CATEGORIES) {
      const catId = `cat-${id}`;
      catIds[id] = catId;
      await turso.execute({
        sql: `INSERT INTO categories (id, user_id, name, type, icon, color, is_default) VALUES (?, ?, ?, 'expense', ?, ?, 1)`,
        args: [catId, seedUserId, name, icon, color],
      });
    }
    for (const [id, name, icon, color] of INCOME_CATEGORIES) {
      const catId = `cat-${id}`;
      catIds[id] = catId;
      await turso.execute({
        sql: `INSERT INTO categories (id, user_id, name, type, icon, color, is_default) VALUES (?, ?, ?, 'income', ?, ?, 1)`,
        args: [catId, seedUserId, name, icon, color],
      });
    }

    // ==== 284 transaksi: 86 income, 131 expense, 67 transfer/refund ====
    const T_TOTAL = 284;
    const T_INCOME = 86;
    const T_EXPENSE = 131;
    const T_OTHER = T_TOTAL - T_INCOME - T_EXPENSE; // 67
    const nowIso = new Date().toISOString();
    let txSeq = 0;
    const txIds = [];

    const insertTx = async (type, amount, catId, catName, daysAgo, merchant) => {
      const id = `e2e-tx-${seedUserId.slice(0, 8)}-${String(++txSeq).padStart(5, '0')}`;
      const date = new Date(Date.now() - daysAgo * 86400_000).toISOString().split('T')[0];
      await turso.execute({
        sql: `INSERT INTO transactions (id, user_id, type, amount, category_id, category_name, merchant, payment_method, note, date, transaction_date, source, created_at, updated_at)
              VALUES (?, ?, ?, ?, ?, ?, ?, 'cash', ?, ?, ?, 'manual', ?, ?)`,
        args: [id, seedUserId, type, amount, catId, catName, merchant, `${type} seed ${txSeq}`, date, date, nowIso, nowIso],
      });
      txIds.push(id);
    };

    for (let i = 0; i < T_INCOME; i++) {
      const cat = INCOME_CATEGORIES[i % INCOME_CATEGORIES.length];
      await insertTx('income', rpAmount(rng, 500000, 15000000), catIds[cat[0]], cat[1], i % 90, `Income ${cat[1]}`);
    }
    for (let i = 0; i < T_EXPENSE; i++) {
      const cat = EXPENSE_CATEGORIES[i % EXPENSE_CATEGORIES.length];
      await insertTx('expense', rpAmount(rng, 10000, 2000000), catIds[cat[0]], cat[1], i % 90, `Merchant ${cat[1]}`);
    }
    for (let i = 0; i < T_OTHER; i++) {
      await insertTx(i % 2 === 0 ? 'transfer' : 'refund', rpAmount(rng, 50000, 5000000), catIds.food, i % 2 === 0 ? 'Transfer' : 'Refund', i % 60, i % 2 === 0 ? 'Transfer Bank' : 'Refund Toko');
    }

    // ==== 519 gmail_sync_logs: 350 auto_accepted, 30 needs_review, 139 skipped/rejected ====
    const G_TOTAL = 519;
    const G_ACCEPTED = 350;
    const G_NEEDS_REVIEW = 30;
    const G_SKIP_REJECT = G_TOTAL - G_ACCEPTED - G_NEEDS_REVIEW; // 139
    const runIds = [];
    for (let r = 0; r < 2; r++) {
      const runId = `e2e-run-${seedUserId.slice(0, 8)}-${r + 1}`;
      const started = new Date(Date.now() - (r + 1) * 86400_000).toISOString();
      await turso.execute({
        sql: `INSERT INTO gmail_sync_runs (id, user_id, status, started_at, completed_at, total_emails, processed, accepted, rejected, skipped, failed)
              VALUES (?, ?, 'completed', ?, ?, ?, ?, ?, ?, ?, 0)`,
        args: [runId, seedUserId, started, new Date(Date.now() - r * 86400_000).toISOString(), G_TOTAL, G_TOTAL, G_ACCEPTED, 0, G_SKIP_REJECT + G_NEEDS_REVIEW],
      });
      runIds.push(runId);
    }

    let logSeq = 0;
    const insertLog = async (status, finalStatus) => {
      const id = `e2e-log-${seedUserId.slice(0, 8)}-${String(++logSeq).padStart(5, '0')}`;
      const daysAgo = logSeq % 90;
      const date = new Date(Date.now() - daysAgo * 86400_000).toISOString().split('T')[0];
      await turso.execute({
        sql: `INSERT INTO gmail_sync_logs (id, user_id, message_id, subject, sender, sender_domain, email_date, status, final_status, confidence_score, sync_run_id, scanned_at)
              VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        args: [
          id, seedUserId,
          `msg-${logSeq}`,
          `Transaksi Berhasil #${logSeq}`,
          'no-reply@bca.co.id',
          'bca.co.id',
          date,
          status,
          finalStatus,
          status === 'auto_accepted' ? 0.92 : 0.5,
          runIds[logSeq % 2],
          new Date(Date.now() - daysAgo * 86400_000).toISOString(),
        ],
      });
    };

    for (let i = 0; i < G_ACCEPTED; i++) await insertLog('auto_accepted', 'auto_accepted');
    for (let i = 0; i < G_NEEDS_REVIEW; i++) await insertLog('needs_review', 'needs_review');
    for (let i = 0; i < G_SKIP_REJECT; i++) {
      if (i % 3 === 0) await insertLog('auto_rejected', 'auto_rejected');
      else await insertLog('auto_skipped', 'auto_skipped');
    }

    // ==== Budgets & Notifications (untuk halaman budgets/notifications) ====
    const month = new Date().getMonth() + 1;
    const year = new Date().getFullYear();
    for (const cat of EXPENSE_CATEGORIES) {
      await turso.execute({
        sql: `INSERT INTO budgets (id, user_id, category_id, category_name, amount, used_amount, month, year, status, created_at, updated_at)
              VALUES (?, ?, ?, ?, ?, 0, ?, ?, 'safe', ?, ?)`,
        args: [`e2e-budget-${cat[0]}`, seedUserId, catIds[cat[0]], cat[1], rpAmount(rng, 500000, 3000000), month, year, nowIso, nowIso],
      });
    }
    for (let i = 0; i < 3; i++) {
      await turso.execute({
        sql: `INSERT INTO notifications (id, user_id, type, priority, title, message, read, created_at)
              VALUES (?, ?, 'system', 'normal', ?, ?, 0, ?)`,
        args: [`e2e-notif-${i}`, seedUserId, `Notifikasi seed ${i + 1}`, 'Contoh notifikasi untuk CI', nowIso],
      });
    }

    // ==== Ringkasan ====
    const counts = {};
    for (const [label, table, col] of [
      ['transactions', 'transactions', 'user_id'],
      ['gmail_logs', 'gmail_sync_logs', 'user_id'],
      ['gmail_runs', 'gmail_sync_runs', 'user_id'],
      ['budgets', 'budgets', 'user_id'],
      ['notifications', 'notifications', 'user_id'],
    ]) {
      const r = await turso.execute({ sql: `SELECT COUNT(*) AS c FROM ${table} WHERE ${col} = ?`, args: [seedUserId] });
      counts[label] = Number(r.rows[0].c);
    }

    console.log(`[seedE2e] ✅ Dataset deterministik siap untuk user ${seedEmail} (id ${seedUserId.slice(0, 8)}…)`);
    console.log(`[seedE2e]    transaksi: ${counts.transactions} (income ${T_INCOME} / expense ${T_EXPENSE} / other ${T_OTHER})`);
    console.log(`[seedE2e]    gmail_logs: ${counts.gmail_logs} (auto_accepted ${G_ACCEPTED} / needs_review ${G_NEEDS_REVIEW} / skip-reject ${G_SKIP_REJECT})`);
    console.log(`[seedE2e]    gmail_runs: ${counts.gmail_runs} · budgets: ${counts.budgets} · notifications: ${counts.notifications}`);
    console.log(`[seedE2e]    ADMIN_EMAILS harus memuat: ${seedEmail}`);
  } finally {
    // sengaja TIDAK memanggil turso.close() di sini: pada Windows, close()
    // koneksi native sqlite3 (file: DB) bisa hang intermittent; untuk one-shot
    // script, OS melepas handle saat process.exit (deterministik). CI memakai
    // remote libsql (HTTP) yang tidak terpengaruh, dan exit dipaksa di bawah.
    try {
      turso.close();
    } catch {
      /* no-op — exit deterministik tetap jalan */
    }
  }
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error('[seedE2e] Gagal:', err.message);
    process.exit(1);
  });
