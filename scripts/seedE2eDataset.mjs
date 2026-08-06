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
 * ⚠️ STABILITAS CI (Sprint 0.7): versi lama menjalankan ±870 INSERT sekuensial
 * via execute() — 1 request HTTP per baris → 100+ detik lokal, dan SATU error
 * transient (network/TLS/429 Turso di runner shared) langsung mematikan job
 * (terbukti: flake CI di step Seed, artifacts kosong, pola sama di commit
 * 60ab972 & c1f2054). Versi ini:
 *   1. BATCHING — client.batch() dalam chunk 100 → ~870 round-trip → ~10 batch
 *      (mode write transaction, atomic; DELETE+INSERT independent).
 *   2. RETRY — exponential backoff (4 attempt) HANYA untuk error transient
 *      (network/timeout/429/5xx); error constraint (UNIQUE dsb.) TIDAK di-retry
 *      dan langsung gagal (diagnosable, bukan di-masking).
 *   3. TIMEOUT EKSPLISIT — custom fetch dengan AbortSignal.timeout (default 30s,
 *      env SEED_TURSO_TIMEOUT_MS). Tanpa ini, request Turso yang HANG (network
 *      blackhole, TLS stall) menggantung tanpa batas sampai timeout job GitHub
 *      — jauh lebih buruk daripada error transien yang bisa di-retry. Timeout
 *      menghasilkan DOMException 'TimeoutError' yang cocok TRANSIENT_RE →
 *      denganRetry menanganinya (tidak membuang attempt).
 *   4. ON CONFLICT(id) DO NOTHING di semua INSERT deterministik (defensif —
 *      DELETE pendahulu tetap penjaga utama idempotensi).
 *   5. ERROR CONTEXT — setiap fase berlabel; failure melaporkan fase + pesan
 *      penuh agar failure CI bisa di-root-cause dari log.
 *
 * Penggunaan:
 *   SEED_E2E=1 TURSO_DATABASE_URL=libsql://... TURSO_AUTH_TOKEN=... node scripts/seedE2eDataset.mjs
 *   (server/.env juga dibaca bila env tidak di-set)
 */
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { createClient } from '@libsql/client';
// Retry/timeout single source of truth (dipakai server + scripts CI).
// Re-export di bawah menjaga unit test seed tetap meng-import dari file ini.
import { withRetry, createTimedFetch, TRANSIENT_RE } from '../server/lib/retry.js';
export { withRetry, createTimedFetch, TRANSIENT_RE };

// Hanya jalankan guard + main() saat file DIEKSEKUSI LANGSUNG — bukan saat
// di-import oleh unit test (tests/unit/seedE2eDataset.test.ts meng-import
// fungsi murni buildSeedStatements/withRetry/createTimedFetch tanpa DB).
const IS_MAIN = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;

if (IS_MAIN && process.env.SEED_E2E !== '1') {
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
export function mulberry32(seed) {
  let a = seed >>> 0;
  return function () {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export const EXPENSE_CATEGORIES = [
  ['food', 'Makanan & Minuman', 'Utensils', '#f97316'],
  ['transport', 'Transportasi', 'Bus', '#3b82f6'],
  ['shopping', 'Belanja', 'ShoppingBag', '#ec4899'],
  ['bills', 'Tagihan', 'FileText', '#ef4444'],
  ['entertainment', 'Hiburan', 'Clapperboard', '#8b5cf6'],
];
export const INCOME_CATEGORIES = [
  ['salary', 'Gaji', 'Wallet', '#10b981'],
  ['freelance', 'Freelance', 'Briefcase', '#14b8a6'],
];

export function rpAmount(rng, min, max) {
  return Math.round((min + rng() * (max - min)) / 1000) * 1000;
}

// ===========================================================================
// BATCHING + RETRY (stabilitas CI — lihat header)
// ===========================================================================
// withRetry/TRANSIENT_RE kini hidup di server/lib/retry.js (single source of
// truth, dipakai juga oleh initTursoSchema & applyTursoSchema).

export const BATCH_SIZE = 100;

/**
 * Konstanta dataset deterministik — sumber kebenaran tunggal (dipakai
 * buildSeedStatements + ringkasan main + unit test regression guard).
 * Nilai harus sinkron dengan PINNED di e2e/helpers/fixtures.ts.
 */
export const SEED_DATASET = {
  T_TOTAL: 284, T_INCOME: 86, T_EXPENSE: 131, T_OTHER: 67,
  G_TOTAL: 519, G_ACCEPTED: 350, G_NEEDS_REVIEW: 30, G_SKIP_REJECT: 139,
};

/** Bagi array menjadi chunk berukuran `size` (murni — dipakai flushPending). */
export function chunkArray(arr, size) {
  if (!(size > 0)) return []; // guard: size <= 0 → tanpa chunk (hindari infinite loop i += 0)
  const out = [];
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
  return out;
}

// Timeout eksplisit per request Turso — konstanta lokal; wrapper createTimedFetch
// kini di server/lib/retry.js (single source of truth).
const SEED_TURSO_TIMEOUT_MS = Number(process.env.SEED_TURSO_TIMEOUT_MS) || 30_000;

// Fase aktif terakhir (untuk error context di level modul).
let sectionLabel = 'inserts';

async function main() {
  loadEnv();
  const url = process.env.TURSO_DATABASE_URL;
  const token = process.env.TURSO_AUTH_TOKEN;
  if (!url || !token) {
    console.error('[seedE2e] TURSO_DATABASE_URL / TURSO_AUTH_TOKEN wajib di-set (env atau server/.env).');
    process.exit(1);
  }

  const turso = createClient({
    url,
    authToken: token,
    // Timeout eksplisit per request (Sprint 0.7): request hang tidak lagi
    // menggantung sampai timeout job GitHub; TimeoutError masuk jalur retry.
    fetch: createTimedFetch(SEED_TURSO_TIMEOUT_MS),
  });
  const rng = mulberry32(20260802); // seed tetap → dataset deterministik

  // Kolektor statement: INSERT independent di-queue lalu di-flush ber-batch
  // (client.batch, write transaction). Urutan RNG dipertahankan persis seperti
  // versi sekuensial agar dataset deterministik TIDAK berubah.
  const pending = [];
  let batchCount = 0;

  async function flushPending(label = sectionLabel) {
    // chunkArray dipakai di sini (bukan splice inline) agar unit test batching
    // (tests/unit/seedE2eDataset.test.ts) meng-guard LOOP ASLI yang berjalan di
    // CI — chunking yang ditest = chunking yang dieksekusi. pending.splice(0)
    // mengambil semua sekaligus (sudah menyalin), lalu dibagi ber-batch.
    for (const chunk of chunkArray(pending.splice(0), BATCH_SIZE)) {
      batchCount += 1;
      await withRetry(() => turso.batch(chunk), { label: `${label} (batch ${batchCount})` });
    }
  }

  function pushStmt(sql, args) {
    pending.push({ sql, args });
  }

  const startTime = Date.now();

  try {
    const seedEmail = ADMIN_EMAIL;

    // ==== NORMALISASI user seed (singular + plural) ====
    // user (singular, Better Auth) & users (plural, tabel bisnis) harus berisi
    // user seed dengan id yang SAMA. Desync bisa terjadi bila baris singular
    // dihapus & dibuat ulang dengan id baru (mis. cleanupTestSessions versi
    // lama menghapus user seed) sementara plural tetap dengan id lama — state
    // tercemar ini membuat INSERT users berikutnya gagal: "UNIQUE constraint
    // failed: users.email" (ON CONFLICT(id) DO NOTHING tidak melindungi
    // konflik email). Normalisasi: pilih SATU id (prioritas singular), hapus
    // baris desync di kedua tabel + data bisnis terkait, lalu re-insert.
    const [sing] = (await withRetry(() => turso.execute({ sql: 'SELECT id FROM user WHERE email = ?', args: [seedEmail] }), { label: 'SELECT user' })).rows;
    const [plur] = (await withRetry(() => turso.execute({ sql: 'SELECT id FROM users WHERE email = ?', args: [seedEmail] }), { label: 'SELECT users' })).rows;
    const seedUserId = sing?.id || plur?.id || crypto.randomBytes(16).toString('hex');

    // Hapus data bisnis milik KEDUA id (sisa id lama yang desync juga dibersihkan).
    sectionLabel = 'cleanup';
    const staleIds = [...new Set([sing?.id, plur?.id, seedUserId].filter(Boolean))];
    for (const table of ['gmail_sync_logs', 'transactions', 'gmail_sync_runs', 'gmail_sync_settings', 'budgets', 'notifications', 'categories']) {
      for (const uid of staleIds) {
        pushStmt(`DELETE FROM ${table} WHERE user_id = ?`, [uid]);
      }
    }
    // Hapus baris desync di kedua tabel user (semua id yang bukan seedUserId).
    for (const uid of staleIds) {
      if (uid !== seedUserId) {
        pushStmt('DELETE FROM user WHERE id = ?', [uid]);
        pushStmt('DELETE FROM users WHERE id = ?', [uid]);
      }
    }
    await flushPending();

    // Insert user seed dengan id tunggal yang konsisten di kedua tabel.
    // ON CONFLICT(id) DO NOTHING → idempoten untuk id yang sudah benar.
    sectionLabel = 'user';
    await withRetry(() => turso.execute({
      sql: `INSERT INTO user (id, name, email, emailVerified) VALUES (?, ?, ?, 1) ON CONFLICT(id) DO NOTHING`,
      args: [seedUserId, 'E2E Seed Admin', seedEmail],
    }), { label: 'INSERT user' });
    await withRetry(() => turso.execute({
      sql: `INSERT INTO users (id, email, name, display_name) VALUES (?, ?, ?, ?) ON CONFLICT(id) DO NOTHING`,
      args: [seedUserId, seedEmail, 'E2E Seed Admin', 'E2E Seed Admin'],
    }), { label: 'INSERT users' });

    // ==== Bangun seluruh statement data (MURNI — buildSeedStatements) ====
    // Urutan pemanggilan RNG (income → expense → other → budgets) dipertahankan
    // persis agar dataset deterministik; nowMs tunggal → timestamp identik antar
    // run (versi lama memanggil Date.now() per-statement → bisa beda beberapa ms).
    sectionLabel = 'inserts';
    const nowMs = Date.now();
    const { stmts } = buildSeedStatements({ seedUserId, rng, nowMs });
    for (const stmt of stmts) pending.push(stmt);
    await flushPending();

    // ==== Ringkasan ====
    const counts = {};
    for (const [label, table, col] of [
      ['transactions', 'transactions', 'user_id'],
      ['gmail_logs', 'gmail_sync_logs', 'user_id'],
      ['gmail_runs', 'gmail_sync_runs', 'user_id'],
      ['budgets', 'budgets', 'user_id'],
      ['notifications', 'notifications', 'user_id'],
    ]) {
      const r = await withRetry(() => turso.execute({ sql: `SELECT COUNT(*) AS c FROM ${table} WHERE ${col} = ?`, args: [seedUserId] }), { label: `COUNT ${table}` });
      counts[label] = Number(r.rows[0].c);
    }

    const elapsedMs = Date.now() - startTime;
    console.log(`[seedE2e] ✅ Dataset deterministik siap untuk user ${seedEmail} (id ${seedUserId.slice(0, 8)}…)`);
    console.log(`[seedE2e]    transaksi: ${counts.transactions} (income ${SEED_DATASET.T_INCOME} / expense ${SEED_DATASET.T_EXPENSE} / other ${SEED_DATASET.T_OTHER})`);
    console.log(`[seedE2e]    gmail_logs: ${counts.gmail_logs} (auto_accepted ${SEED_DATASET.G_ACCEPTED} / needs_review ${SEED_DATASET.G_NEEDS_REVIEW} / skip-reject ${SEED_DATASET.G_SKIP_REJECT})`);
    console.log(`[seedE2e]    gmail_runs: ${counts.gmail_runs} · budgets: ${counts.budgets} · notifications: ${counts.notifications}`);
    console.log(`[seedE2e]    ADMIN_EMAILS harus memuat: ${seedEmail}`);
    console.log(`[seedE2e]    ⏱️ ${(elapsedMs / 1000).toFixed(1)}s · ${batchCount} batch (${BATCH_SIZE}/batch) · retry transien + timeout ${SEED_TURSO_TIMEOUT_MS}ms`);
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

/** Bangun statement INSERT gmail_sync_logs (deterministik; dipakai ber-batch). */
export function buildLogStmt(seedUserId, runIds, logSeq, status, finalStatus, nowMs) {
  const id = `e2e-log-${seedUserId.slice(0, 8)}-${String(logSeq).padStart(5, '0')}`;
  const daysAgo = logSeq % 90;
  const date = new Date(nowMs - daysAgo * 86400_000).toISOString().split('T')[0];
  return [(
    `INSERT INTO gmail_sync_logs (id, user_id, message_id, subject, sender, sender_domain, email_date, status, final_status, confidence_score, sync_run_id, scanned_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?) ON CONFLICT(id) DO NOTHING`
  ), [
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
    new Date(nowMs - daysAgo * 86400_000).toISOString(),
  ]];
}

/**
 * Bangun SELURUH statement data deterministik (MURNI — tanpa DB).
 *
 * Urutan pemanggilan RNG dipertahankan persis dari versi sekuensial agar
 * dataset CI identik: income (86) → expense (131) → other (67) → budgets (5).
 * `nowMs` tunggal membuat timestamp identik antar run (determinisme penuh —
 * dijamin oleh unit test tests/unit/seedE2eDataset.test.ts).
 *
 * @returns {{ stmts: Array<{sql: string, args: unknown[]}>, catIds: Record<string,string> }}
 */
export function buildSeedStatements({ seedUserId, rng, nowMs }) {
  const stmts = [];
  const pushStmt = (sql, args) => stmts.push({ sql, args });
  const nowIso = new Date(nowMs).toISOString();

  // ==== Kategori ====
  const catIds = {};
  for (const [id, name, icon, color] of EXPENSE_CATEGORIES) {
    const catId = `cat-${id}`;
    catIds[id] = catId;
    pushStmt(`INSERT INTO categories (id, user_id, name, type, icon, color, is_default) VALUES (?, ?, ?, 'expense', ?, ?, 1) ON CONFLICT(user_id, id) DO NOTHING`, [catId, seedUserId, name, icon, color]);
  }
  for (const [id, name, icon, color] of INCOME_CATEGORIES) {
    const catId = `cat-${id}`;
    catIds[id] = catId;
    pushStmt(`INSERT INTO categories (id, user_id, name, type, icon, color, is_default) VALUES (?, ?, ?, 'income', ?, ?, 1) ON CONFLICT(user_id, id) DO NOTHING`, [catId, seedUserId, name, icon, color]);
  }

  // ==== 284 transaksi: 86 income, 131 expense, 67 transfer/refund ====
  const { T_INCOME, T_EXPENSE, T_OTHER } = SEED_DATASET;
  let txSeq = 0;

  for (let i = 0; i < T_INCOME; i++) {
    const cat = INCOME_CATEGORIES[i % INCOME_CATEGORIES.length];
    txSeq += 1;
    const id = `e2e-tx-${seedUserId.slice(0, 8)}-${String(txSeq).padStart(5, '0')}`;
    const date = new Date(nowMs - (i % 90) * 86400_000).toISOString().split('T')[0];
    pushStmt(
      `INSERT INTO transactions (id, user_id, type, amount, category_id, category_name, merchant, payment_method, note, date, transaction_date, source, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, 'cash', ?, ?, ?, 'manual', ?, ?) ON CONFLICT(id) DO NOTHING`,
      [id, seedUserId, 'income', rpAmount(rng, 500000, 15000000), catIds[cat[0]], cat[1], `Income ${cat[1]}`, `income seed ${txSeq}`, date, date, nowIso, nowIso],
    );
  }
  for (let i = 0; i < T_EXPENSE; i++) {
    const cat = EXPENSE_CATEGORIES[i % EXPENSE_CATEGORIES.length];
    txSeq += 1;
    const id = `e2e-tx-${seedUserId.slice(0, 8)}-${String(txSeq).padStart(5, '0')}`;
    const date = new Date(nowMs - (i % 90) * 86400_000).toISOString().split('T')[0];
    pushStmt(
      `INSERT INTO transactions (id, user_id, type, amount, category_id, category_name, merchant, payment_method, note, date, transaction_date, source, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, 'cash', ?, ?, ?, 'manual', ?, ?) ON CONFLICT(id) DO NOTHING`,
      [id, seedUserId, 'expense', rpAmount(rng, 10000, 2000000), catIds[cat[0]], cat[1], `Merchant ${cat[1]}`, `expense seed ${txSeq}`, date, date, nowIso, nowIso],
    );
  }
  for (let i = 0; i < T_OTHER; i++) {
    txSeq += 1;
    const id = `e2e-tx-${seedUserId.slice(0, 8)}-${String(txSeq).padStart(5, '0')}`;
    const date = new Date(nowMs - (i % 60) * 86400_000).toISOString().split('T')[0];
    const isTransfer = i % 2 === 0;
    pushStmt(
      `INSERT INTO transactions (id, user_id, type, amount, category_id, category_name, merchant, payment_method, note, date, transaction_date, source, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, 'cash', ?, ?, ?, 'manual', ?, ?) ON CONFLICT(id) DO NOTHING`,
      [id, seedUserId, isTransfer ? 'transfer' : 'refund', rpAmount(rng, 50000, 5000000), catIds.food, isTransfer ? 'Transfer' : 'Refund', isTransfer ? 'Transfer Bank' : 'Refund Toko', `${isTransfer ? 'transfer' : 'refund'} seed ${txSeq}`, date, date, nowIso, nowIso],
    );
  }

  // ==== 519 gmail_sync_logs: 350 auto_accepted, 30 needs_review, 139 skipped/rejected ====
  const { G_ACCEPTED, G_NEEDS_REVIEW, G_SKIP_REJECT } = SEED_DATASET;
  const runIds = [];
  for (let r = 0; r < 2; r++) {
    const runId = `e2e-run-${seedUserId.slice(0, 8)}-${r + 1}`;
    const started = new Date(nowMs - (r + 1) * 86400_000).toISOString();
    pushStmt(
      `INSERT INTO gmail_sync_runs (id, user_id, status, started_at, completed_at, total_emails, processed, accepted, rejected, skipped, failed)
       VALUES (?, ?, 'completed', ?, ?, ?, ?, ?, ?, ?, 0) ON CONFLICT(id) DO NOTHING`,
      [runId, seedUserId, started, new Date(nowMs - r * 86400_000).toISOString(), SEED_DATASET.G_TOTAL, SEED_DATASET.G_TOTAL, G_ACCEPTED, 0, G_SKIP_REJECT + G_NEEDS_REVIEW],
    );
    runIds.push(runId);
  }

  let logSeq = 0;
  for (let i = 0; i < G_ACCEPTED; i++) {
    logSeq += 1;
    pushStmt(...buildLogStmt(seedUserId, runIds, logSeq, 'auto_accepted', 'auto_accepted', nowMs));
  }
  for (let i = 0; i < G_NEEDS_REVIEW; i++) {
    logSeq += 1;
    pushStmt(...buildLogStmt(seedUserId, runIds, logSeq, 'needs_review', 'needs_review', nowMs));
  }
  for (let i = 0; i < G_SKIP_REJECT; i++) {
    logSeq += 1;
    const status = i % 3 === 0 ? 'auto_rejected' : 'auto_skipped';
    pushStmt(...buildLogStmt(seedUserId, runIds, logSeq, status, status, nowMs));
  }

  // ==== Budgets & Notifications (untuk halaman budgets/notifications) ====
  const month = new Date(nowMs).getMonth() + 1;
  const year = new Date(nowMs).getFullYear();
  for (const cat of EXPENSE_CATEGORIES) {
    pushStmt(
      `INSERT INTO budgets (id, user_id, category_id, category_name, amount, used_amount, month, year, status, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, 0, ?, ?, 'safe', ?, ?) ON CONFLICT(id) DO NOTHING`,
      [`e2e-budget-${cat[0]}`, seedUserId, catIds[cat[0]], cat[1], rpAmount(rng, 500000, 3000000), month, year, nowIso, nowIso],
    );
  }
  for (let i = 0; i < 3; i++) {
    pushStmt(
      `INSERT INTO notifications (id, user_id, type, priority, title, message, read, created_at)
       VALUES (?, ?, 'system', 'normal', ?, ?, 0, ?) ON CONFLICT(id) DO NOTHING`,
      [`e2e-notif-${i}`, seedUserId, `Notifikasi seed ${i + 1}`, 'Contoh notifikasi untuk CI', nowIso],
    );
  }

  return { stmts, catIds };
}

if (IS_MAIN) {
  main()
    .then(() => process.exit(0))
    .catch((err) => {
      console.error(`[seedE2e] Gagal: ${err.message}`);
      console.error(`[seedE2e] (fase aktif terakhir: ${sectionLabel ?? 'unknown'})`);
      process.exit(1);
    });
}
