#!/usr/bin/env node
/**
 * CashFlow — Gmail Duplicate Transaction Cleanup
 * (Tindak lanjut temuan P0 dari docs/financial/FINANCIAL_CALCULATION_INTEGRITY.md §10.8)
 *
 * Menghapus baris transaksi DUPLIKAT hasil import Gmail: untuk setiap
 * `gmail_message_id`, jika ada >1 baris dengan business key IDENTIK
 * (type + amount + transaction_date + merchant), hanya baris TERTUA
 * (created_at ASC, id ASC) yang dipertahankan; sisanya dihapus.
 *
 * AMAN:
 *  - Default = DRY-RUN (read-only). Tidak ada baris yang diubah.
 *  - Grup pesan dengan business key BERBEDA (multi-transaksi sah dari satu
 *    email) TIDAK disentuh — dilaporkan sebagai "legit multi-transaction".
 *  - Eksekusi butuh: (1) flag --execute, (2) env GM_DUP_CLEANUP_EXECUTE=1
 *    (pola safety guard backupTurso.mjs), (3) konfirmasi interaktif / --yes.
 *  - Semua baris yang akan dihapus di-backup ke JSON (backups/, sudah
 *    .gitignore) sebelum eksekusi, dan dihapus dalam SATU transaksi tulis.
 *  - Laporan dampak saldo per user (before → after) dicetak di dry-run.
 *
 * USAGE (WAJIB pakai pemisah `--` karena Node.js v24 menolak flag custom yang
 * tidak dikenal tanpa pemisah — lihat https://nodejs.org/api/cli.html):
 *   node -- scripts/gmailDuplicateCleanup.mjs                          # dry-run semua user
 *   node -- scripts/gmailDuplicateCleanup.mjs --user <id>              # dry-run satu user
 *   node -- scripts/gmailDuplicateCleanup.mjs --execute --yes          # eksekusi (guard + backup)
 *   node -- scripts/gmailDuplicateCleanup.mjs --limit 500 --execute --yes
 *   node -- scripts/gmailDuplicateCleanup.mjs --message-id-any --dry-run
 *   node -- scripts/gmailDuplicateCleanup.mjs --report-file /tmp/report.json
 *
 * OPTIONS:
 *   --execute          Jalankan penghapusan (default: dry-run read-only)
 *   --yes              Lewati prompt konfirmasi (untuk non-TTY/CI)
 *   --user <id>        Batasi ke satu user_id
 *   --limit <n>        Maksimal baris yang dihapus per run (default 5000)
 *   --message-id-any   Perlakukan SETIAP gmail_message_id dengan >1 baris sebagai
 *                      duplikat (keep tertua, hapus sisanya) tanpa mencocokkan
 *                      business key — sesuai semantik literal "duplikat
 *                      gmail_message_id". Default (tanpa flag) hanya menghapus
 *                      baris dengan business key IDENTIK (type+amount+date+
 *                      merchant); baris beda-key dalam pesan sama dilaporkan
 *                      untuk review manual dan TIDAK dihapus.
 *   --backup-dir <p>   Direktori backup JSON (default backups/gmail-cleanup)
 *   --dotenv-file <p>  File env (default server/.env). Hindari --env-file karena
 *                      konflik dengan flag resmi Node.js.
 *   --report <p>       Tulis ringkasan JSON ke file
 *   --help             Tampilkan bantuan
 *
 * TIDAK mengubah: data yang sah, schema, auth, AI, Gmail sync. Read-only
 * terhadap produksi kecuali dijalankan dengan guard lengkap di atas.
 */
import fs from 'node:fs';
import path from 'node:path';
import readline from 'node:readline/promises';
import { createClient } from '@libsql/client';

// ---------------------------------------------------------------------------
// CLI parsing (tanpa dependency)
// ---------------------------------------------------------------------------
const argv = process.argv.slice(2);
/** Terima nama flag dengan/tanpa prefix `--` (mis. 'execute' atau '--execute'). */
const stripDash = (name) => name.replace(/^--?/, '');
const hasFlag = (name) => argv.includes(`--${stripDash(name)}`);
const flagValue = (name) => {
  const i = argv.indexOf(`--${stripDash(name)}`);
  return i >= 0 && argv[i + 1] !== undefined ? argv[i + 1] : null;
};

if (hasFlag('help') || hasFlag('h')) {
  console.log(fs.readFileSync(new URL(import.meta.url), 'utf8').split('USAGE:')[0]);
  process.exit(0);
}

const EXECUTE = hasFlag('execute');
const YES = hasFlag('yes');
const MESSAGE_ID_ANY = hasFlag('message-id-any');
const USER_FILTER = flagValue('user');
const RAW_LIMIT = flagValue('limit');
// Default 5000; --limit 0 eksplisit = tanpa batas.
const LIMIT =
  RAW_LIMIT === '0'
    ? Number.MAX_SAFE_INTEGER
    : Math.max(1, Number.parseInt(RAW_LIMIT || '5000', 10) || 5000);
const BACKUP_DIR = flagValue('backup-dir') || path.join('backups', 'gmail-cleanup');
const ENV_FILE = flagValue('dotenv-file') || path.join('server', '.env');
const ENV_FILE_EXPLICIT = flagValue('dotenv-file') !== null;
const REPORT_PATH = flagValue('report-file');

// ---------------------------------------------------------------------------
// Env + client (pola backupTurso.mjs)
// ---------------------------------------------------------------------------
function loadEnv(filePath, override) {
  const resolved = path.resolve(process.cwd(), filePath);
  if (!fs.existsSync(resolved)) return;
  for (const line of fs.readFileSync(resolved, 'utf8').split(/\r?\n/)) {
    const t = line.trim();
    if (!t || t.startsWith('#') || !t.includes('=')) continue;
    const i = t.indexOf('=');
    const k = t.slice(0, i).trim();
    const v = t.slice(i + 1).trim().replace(/^["']|["']$/g, '');
    // File dotenv eksplisit = sumber kebenaran (override); server/.env default
    // hanya mengisi yang belum ter-set (pola backupTurso.mjs).
    if (k && (override || !process.env[k])) process.env[k] = v;
  }
}
loadEnv(ENV_FILE, ENV_FILE_EXPLICIT);

const url = process.env.TURSO_DATABASE_URL;
if (!url) {
  console.error('[gmail-dup-cleanup] TURSO_DATABASE_URL tidak ditemukan di ' + ENV_FILE + '. Abort.');
  process.exit(1);
}  // Safety guard eksekusi — pola env-guard backupTurso.mjs
  if (EXECUTE && process.env.GM_DUP_CLEANUP_EXECUTE !== '1') {
    console.error(
      '[gmail-dup-cleanup] SAFETY: eksekusi butuh env GM_DUP_CLEANUP_EXECUTE=1\n' +
      '  (mencegah hapus data tidak sengaja. Contoh: GM_DUP_CLEANUP_EXECUTE=1 node -- scripts/gmailDuplicateCleanup.mjs --execute --yes)'
    );
    process.exit(1);
  }

const db = createClient({ url, authToken: process.env.TURSO_AUTH_TOKEN || undefined });

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
const rupiah = (n) =>
  new Intl.NumberFormat('id-ID', { minimumFractionDigits: 0, maximumFractionDigits: 2 }).format(n);

/** Format saldo konsisten dashboard: -Rp9.329.062,47 (minus di depan Rp). */
const idrBalance = (n) => (n < 0 ? '-Rp' : 'Rp') + rupiah(Math.abs(n));

/** Kontribusi baris terhadap balance (amount DB selalu positif). */
function contribution(type, amount) {
  return type === 'income' || type === 'refund' ? amount : -amount;
}

/** Business key duplikat: baris = duplikat hanya bila SEMUA field identik. */
function businessKey(row) {
  return [row.type, String(row.amount), row.transaction_date, row.merchant ?? ''].join('|');
}

const whereScope = USER_FILTER ? 'AND user_id = ?' : '';
const scopeArgs = USER_FILTER ? [USER_FILTER] : [];

// ---------------------------------------------------------------------------
// Analisis (murni read-only)
// ---------------------------------------------------------------------------
async function analyze() {
  // 1. Saldo per user saat ini (lifetime, windowless, SQL aggregation)
  const { rows: nets } = await db.execute({
    sql: `SELECT user_id, COUNT(*) AS total,
                 COALESCE(SUM(CASE WHEN type IN ('income','refund') THEN amount ELSE -amount END), 0) AS net
          FROM transactions ${USER_FILTER ? 'WHERE user_id = ?' : ''}
          GROUP BY user_id`,
    args: scopeArgs,
  });
  const balanceByUser = new Map(nets.map((r) => [r.user_id, { total: Number(r.total), net: Number(r.net) }]));

  // 2. Grup pesan dengan >1 baris (kandidat duplikat)
  const { rows: groups } = await db.execute({
    sql: `SELECT user_id, gmail_message_id, COUNT(*) AS c
          FROM transactions
          WHERE gmail_message_id IS NOT NULL AND gmail_message_id != '' ${whereScope}
          GROUP BY user_id, gmail_message_id
          HAVING c > 1
          ORDER BY user_id, gmail_message_id`,
    args: scopeArgs,
  });

  // 3. Ambil SELURUH kolom baris milik grup kandidat (chunk IN) — urutkan
  //    created_at,id. SELECT * penting agar backup JSON restorable penuh.
  const candidateIds = groups.map((g) => g.gmail_message_id);
  const rows = [];
  const CHUNK = 200;
  for (let i = 0; i < candidateIds.length; i += CHUNK) {
    const chunk = candidateIds.slice(i, i + CHUNK);
    const placeholders = chunk.map(() => '?').join(',');
    const { rows: chunkRows } = await db.execute({
      sql: `SELECT *
            FROM transactions
            WHERE gmail_message_id IN (${placeholders}) ${USER_FILTER ? 'AND user_id = ?' : ''}
            ORDER BY user_id, gmail_message_id, created_at ASC, id ASC`,
      args: USER_FILTER ? [...chunk, USER_FILTER] : chunk,
    });
    rows.push(...chunkRows);
  }

  // 4. Klasifikasi per (user, message): kelompokkan business key identik
  const byMessage = new Map(); // key `${userId}|${messageId}` -> row[]
  for (const r of rows) {
    const k = `${r.user_id}|${r.gmail_message_id}`;
    if (!byMessage.has(k)) byMessage.set(k, []);
    byMessage.get(k).push(r);
  }

  const toDelete = [];
  const driftMessages = []; // pesan dgn beberapa business key beda — direview, default TIDAK dihapus
  for (const [key, msgRows] of byMessage) {
    const [userId, messageId] = key.split('|');
    // msgRows sudah urut created_at ASC, id ASC → [0] = tertua
    if (MESSAGE_ID_ANY) {
      // Semantik literal: seluruh baris pesan = duplikat, keep tertua
      for (const dup of msgRows.slice(1)) toDelete.push(dup);
      if (msgRows.length > 1) {
        const uniqueKeys = new Set(msgRows.map((r) => businessKey(r)));
        if (uniqueKeys.size > 1) {
          driftMessages.push({ userId, messageId, rows: msgRows.length, keys: uniqueKeys.size });
        }
      }
      continue;
    }
    const byKey = new Map();
    for (const r of msgRows) {
      const bk = businessKey(r);
      if (!byKey.has(bk)) byKey.set(bk, []);
      byKey.get(bk).push(r);
    }
    const dupGroups = [...byKey.values()].filter((g) => g.length > 1);
    if (dupGroups.length === 0) {
      // Semua key beda → kemungkinan multi-transaksi / type-drift — review manual
      driftMessages.push({ userId, messageId, rows: msgRows.length, keys: byKey.size });
      continue;
    }
    for (const group of dupGroups) {
      // group sudah urut created_at ASC, id ASC → [0] = tertua, sisanya duplikat
      for (const dup of group.slice(1)) toDelete.push(dup);
    }
    if (byKey.size > dupGroups.length) {
      // Campuran: duplikat + baris key lain — baris key lain TIDAK dihapus
      driftMessages.push({ userId, messageId, rows: msgRows.length, keys: byKey.size });
    }
  }

  // Urutkan toDelete deterministik: user, created_at, id
  toDelete.sort((a, b) => a.user_id.localeCompare(b.user_id) || a.created_at.localeCompare(b.created_at) || a.id.localeCompare(b.id));

  // Terapkan limit (laporan & eksekusi selalu konsisten dengan set yang sama)
  const truncated = toDelete.length > LIMIT;
  if (truncated) toDelete.length = LIMIT;

  // 5. Agregasi per user (termasuk breakdown by month & by source — P0 §12)
  const perUser = new Map();
  for (const r of toDelete) {
    if (!perUser.has(r.user_id)) {
      perUser.set(r.user_id, { count: 0, byType: {}, byMonth: {}, bySource: {}, sumContribution: 0, messages: new Set() });
    }
    const u = perUser.get(r.user_id);
    u.count += 1;
    u.byType[r.type] = (u.byType[r.type] || 0) + Number(r.amount);
    const month = String(r.transaction_date || '').slice(0, 7) || 'unknown';
    u.byMonth[month] = (u.byMonth[month] || 0) + 1;
    u.bySource[r.source || 'unknown'] = (u.bySource[r.source || 'unknown'] || 0) + 1;
    u.sumContribution += contribution(r.type, Number(r.amount));
    u.messages.add(r.gmail_message_id);
  }

  return { groups, toDelete, perUser, balanceByUser, driftMessages, truncated };
}

// ---------------------------------------------------------------------------
// Audit trail (admin_audit_log — reuse tabel existing, P0 §18)
// ---------------------------------------------------------------------------
// Mencatat jalur cleanup ke `admin_audit_log` (tabel ops, bukan data user):
//   action = gmail_duplicate_cleanup
//   result = dry_run | success | failure
//   metadata = { scope, limit, matchingMode, groupsDetected, rowsDeleted,
//                driftMessages, affectedUsers, financialImpact }
// TIDAK menyimpan payload transaksi penuh / body Gmail / token — hanya
// agregat (jumlah + dampak saldo per user). Kolom verified live: id, action,
// target_user_id, target_email, actor_user_id, actor_email, metadata,
// created_at, result, request_id (0001 + 0002).
function auditRecordId() {
  return `gmail-cleanup-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

async function recordCleanupAudit({ result, a, rowsDeleted = 0, error = null }) {
  const perUser = a?.perUser || new Map();
  const financialImpact = [...perUser.entries()].map(([userId, u]) => ({
    userId,
    rows: u.count,
    byType: u.byType,
    // Dampak saldo = hapus kontribusi baris duplikat (balance naik saat
    // duplikat expense/transfer dihapus; turun saat duplikat income/refund).
    balanceDelta: -u.sumContribution,
  }));
  const metadata = {
    scope: USER_FILTER || 'all-users',
    limit: LIMIT,
    matchingMode: MESSAGE_ID_ANY ? 'message-id-any' : 'exact-business-key',
    groupsDetected: a?.groups?.length ?? 0,
    rowsDeleted,
    driftMessages: a?.driftMessages?.length ?? 0,
    truncated: a?.truncated ?? false,
    affectedUsers: [...perUser.keys()],
    financialImpact,
  };
  if (error) metadata.error = String(error.message || error);
  try {
    await db.execute({
      sql: `INSERT INTO admin_audit_log
              (id, action, target_user_id, target_email, actor_user_id, actor_email, metadata, result, request_id)
            VALUES (?, 'gmail_duplicate_cleanup', NULL, NULL, 'cli', 'cli@internal', ?, ?, ?)`,
      args: [auditRecordId(), JSON.stringify(metadata), result, `cleanup-${new Date().toISOString()}`],
    });
  } catch (err) {
    // Caller menentukan respons: dry-run → warning best-effort (read-only);
    // execute → pre-flight probe memastikan insert audit bekerja SEBELUM
    // aksi destruktif (gagal → abort, stop condition P0 §31.7); post-commit
    // → warning + backup path (recovery).
    throw err;
  }
}

// ---------------------------------------------------------------------------
// Laporan
// ---------------------------------------------------------------------------
function printReport(a) {
  const mode = EXECUTE ? 'EXECUTE' : 'DRY-RUN';
  console.log(`\n=== GMAIL DUPLICATE CLEANUP — ${mode} ===`);
  console.log(`DB          : ${url}`);
  console.log(`Scope       : ${USER_FILTER ? `user ${USER_FILTER}` : 'semua user'}`);
  console.log(`Limit       : ${LIMIT} baris/run`);
  console.log(`Waktu       : ${new Date().toISOString()}`);

  if (a.groups.length === 0) {
    console.log('\nTidak ada grup gmail_message_id dengan >1 baris. Tidak ada duplikat.');
    return false;
  }

  console.log(`\nGrup pesan kandidat (gmail_message_id > 1 baris): ${a.groups.length}`);
  console.log(`Baris DUPLIKAT yang akan dihapus                : ${a.toDelete.length}${a.truncated ? ` (terpotong oleh --limit ${LIMIT}; jalankan ulang untuk sisanya)` : ''}`);
  console.log(`Mode matching                               : ${MESSAGE_ID_ANY ? 'gmail_message_id (keep tertua, apapun business key)' : 'business key identik (type+amount+date+merchant)'}`);
  if (a.driftMessages.length) {
    console.log(`Pesan dengan beberapa business key (review)    : ${a.driftMessages.length} pesan — TIDAK dihapus ${MESSAGE_ID_ANY ? '(kecuali baris non-tertua pada --message-id-any)' : '(lihat daftar di bawah)'}`);
  }

  console.log('\n--- LAPORAN DAMPAK SALDO PER USER ---');
  let grandBefore = 0;
  let grandAfter = 0;
  for (const [userId, u] of a.perUser) {
    const bal = a.balanceByUser.get(userId) || { total: 0, net: 0 };
    const before = bal.net;
    const after = before - u.sumContribution; // hapus kontribusi duplikat
    grandBefore += before;
    grandAfter += after;
    console.log(`\nUSER ${userId}`);
    console.log(`  Total transaksi user      : ${bal.total}`);
    console.log(`  Baris duplikat dihapus    : ${u.count} (dari ${u.messages.size} pesan)`);
    console.log(`  Rincian amount dihapus    : ${
      Object.entries(u.byType)
        .map(([t, s]) => `${t} Rp${rupiah(s)}`)
        .join(' · ') || '(kosong)'
    }`);
    console.log(`  Saldo BEFORE              : ${idrBalance(before)}`);
    console.log(`  Saldo AFTER (proyeksi)    : ${idrBalance(after)}`);
    console.log(`  Dampak                    : ${after - before >= 0 ? '+' : ''}${idrBalance(after - before)}`);
  }
  if (a.driftMessages.length && !MESSAGE_ID_ANY) {
    console.log('\n--- PESAN DENGAN BUSINESS KEY BEDA (perlu review manual, TIDAK dihapus) ---');
    for (const m of a.driftMessages.slice(0, 20)) {
      console.log(`  user ${m.userId.slice(0, 8)}… · msg ${m.messageId} · ${m.rows} baris · ${m.keys} key unik`);
    }
    if (a.driftMessages.length > 20) console.log(`  …dan ${a.driftMessages.length - 20} pesan lainnya`);
    console.log('  (Pola umum: import ulang dengan klasifikasi type berbeda, mis. transfer vs expense.)');
  }

  if (a.perUser.size > 1) {
    console.log(`\n  TOTAL (semua user) BEFORE : ${idrBalance(grandBefore)}`);
    console.log(`  TOTAL (semua user) AFTER  : ${idrBalance(grandAfter)}`);
    console.log(`  Dampak total              : ${grandAfter - grandBefore >= 0 ? '+' : ''}${idrBalance(grandAfter - grandBefore)}`);
  }

  // Breakdown duplikat by month & by source (P0 §12 — audit matrix)
  if (a.toDelete.length) {
    const byMonth = new Map();
    const bySource = new Map();
    for (const [, u] of a.perUser) {
      for (const [m, c] of Object.entries(u.byMonth)) byMonth.set(m, (byMonth.get(m) || 0) + c);
      for (const [s, c] of Object.entries(u.bySource)) bySource.set(s, (bySource.get(s) || 0) + c);
    }
    console.log('\n--- DUPLICATE BY MONTH (baris) ---');
    for (const [m, c] of [...byMonth.entries()].sort((x, y) => String(x[0]).localeCompare(String(y[0])))) {
      console.log(`  ${m}: ${c}`);
    }
    console.log('--- DUPLICATE BY SOURCE (baris) ---');
    for (const [s, c] of [...bySource.entries()].sort((x, y) => String(x[0]).localeCompare(String(y[0])))) {
      console.log(`  ${s}: ${c}`);
    }
  }

  console.log('\nCatatan: amount DB selalu positif; balance = Σincome+Σrefund − Σexpense−Σtransfer.');
  if (!EXECUTE) console.log('\n[DRY-RUN] Tidak ada data yang diubah. Jalankan dengan --execute untuk mengeksekusi.');
  return true;
}

// ---------------------------------------------------------------------------
// Eksekusi (guard ganda + backup + transaksi)
// ---------------------------------------------------------------------------
async function confirmAndExecute(a) {
  if (a.toDelete.length === 0) {
    console.log('[gmail-dup-cleanup] Tidak ada baris untuk dihapus. Selesai.');
    return;
  }

  // Konfirmasi interaktif (atau --yes untuk non-TTY)
  if (!YES) {
    if (!process.stdin.isTTY) {
      console.error('[gmail-dup-cleanup] stdin bukan TTY — butuh flag --yes untuk konfirmasi non-interaktif. Abort.');
      process.exit(1);
    }
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
    const answer = await rl.question(
      `\nHapus ${a.toDelete.length} baris duplikat PERMANEN? Ketik 'DELETE' untuk lanjut: `
    );
    rl.close();
    if (answer.trim() !== 'DELETE') {
      console.log('[gmail-dup-cleanup] Dibatalkan oleh user. Tidak ada perubahan.');
      process.exit(0);
    }
  }

  // Backup semua baris yang akan dihapus (JSON, backups/ sudah .gitignore).
  // Gagal backup = stop condition P0 §31.6 → audit failure + abort, nol mutasi.
  const ts = new Date().toISOString().replace(/[:.]/g, '-');
  const backupFile = path.join(BACKUP_DIR, `gmail-dup-cleanup-${ts}.json`);
  try {
    fs.mkdirSync(BACKUP_DIR, { recursive: true });
    fs.writeFileSync(
      backupFile,
      JSON.stringify(
        {
          createdAt: new Date().toISOString(),
          mode: 'delete',
          scope: USER_FILTER || 'all-users',
          count: a.toDelete.length,
          rows: a.toDelete.map((r) => ({ ...r })), // seluruh kolom — restore penuh
        },
        null,
        2
      )
    );
  } catch (backupErr) {
    try {
      await recordCleanupAudit({ result: 'failure', a, rowsDeleted: 0, error: backupErr });
    } catch (auditErr) {
      console.warn(`[gmail-dup-cleanup] ⚠ gagal mencatat audit failure: ${auditErr.message}`);
    }
    console.error('[gmail-dup-cleanup] BACKUP GAGAL — abort (stop condition P0 §31.6). Tidak ada baris dihapus.');
    console.error(backupErr);
    process.exit(1);
  }
  console.log(`[backup] ${a.toDelete.length} baris disimpan ke ${backupFile}`);

  // Pre-flight audit probe (P0 §31 stop condition #7): pastikan insert
  // admin_audit_log bekerja SEBELUM aksi destruktif — gagal → abort, nol
  // mutasi (bukan warning post-commit).
  try {
    await recordCleanupAudit({ result: 'dry_run', a });
  } catch (auditErr) {
    console.error('[gmail-dup-cleanup] ⚠ AUDIT TRAIL GAGAL — abort sebelum eksekusi (stop condition P0 §31.7).');
    console.error(`[gmail-dup-cleanup]   detail: ${auditErr.message}`);
    process.exit(1);
  }

  // Hapus dalam SATU transaksi tulis (catatan: db.transaction() ASYNC → wajib
  // await) dengan OPTIMISTIC VERIFICATION (P0 §17): baris hanya dihapus bila
  // MASIH cocok dengan fingerprint hasil dry-run — row yang diedit/diubah
  // setelah dry-run → rowsAffected 0 → throw → rollback (stop condition §31.5).
  // `IS ?` dipakai agar NULL transaction_date tetap match (SQLite `= NULL`
  // tidak pernah true).
  const deleteSql = MESSAGE_ID_ANY
    ? 'DELETE FROM transactions WHERE id = ? AND user_id = ? AND gmail_message_id IS ?'
    : 'DELETE FROM transactions WHERE id = ? AND user_id = ? AND type IS ? AND amount IS ? AND transaction_date IS ? AND merchant IS ?';
  let tx;
  try {
    tx = await db.transaction('write');
    for (const r of a.toDelete) {
      const args = MESSAGE_ID_ANY
        ? [r.id, r.user_id, r.gmail_message_id]
        : [r.id, r.user_id, r.type, Number(r.amount), r.transaction_date, r.merchant ?? ''];
      const res = await tx.execute({ sql: deleteSql, args });
      if (Number(res.rowsAffected) !== 1) {
        throw new Error(`fingerprint mismatch saat eksekusi: ${r.id} (diubah setelah dry-run?)`);
      }
    }
    await tx.commit();
  } catch (err) {
    try {
      if (tx) await tx.rollback();
    } catch {
      /* noop */
    }
    // Audit trail FAILURE (best-effort setelah rollback — tidak ada data berubah).
    try {
      await recordCleanupAudit({ result: 'failure', a, rowsDeleted: 0, error: err });
    } catch (auditErr) {
      console.warn(`[gmail-dup-cleanup] ⚠ gagal mencatat audit failure: ${auditErr.message}`);
    }
    console.error('[gmail-dup-cleanup] Transaksi GAGAL — rollback. Tidak ada baris dihapus.');
    console.error(err);
    process.exit(1);
  }

  // Verifikasi ulang: tidak boleh ada grup duplikat tersisa dalam scope
  const { rows: remain } = await db.execute({
    sql: `SELECT user_id, gmail_message_id, COUNT(*) AS c
          FROM transactions
          WHERE gmail_message_id IS NOT NULL AND gmail_message_id != '' ${whereScope}
          GROUP BY user_id, gmail_message_id
          HAVING c > 1`,
    args: scopeArgs,
  });
  console.log(`[verify] grup duplikat tersisa: ${remain.length}`);
  if (remain.length > 0) {
    const why = a.truncated
      ? ' run ini terpotong oleh --limit — jalankan ulang untuk sisa baris'
      : ' kemungkinan multi-transaksi sah / type-drift yang sengaja dipertahankan';
    console.warn(`[verify] ⚠ MASIH ada grup duplikat tersisa (${why}).`);
  }

  // Audit trail SUCCESS (P0 §18) — reuse admin_audit_log. Gagal mencatat
  // SETELAH commit → warning eksplisit + backup path (recovery tetap mungkin
  // dari backup JSON). Keberhasilan insert audit sudah dipastikan di dry-run
  // (jalur normal: dry-run selalu dijalankan sebelum execute).
  try {
    await recordCleanupAudit({ result: 'success', a, rowsDeleted: a.toDelete.length });
  } catch (auditErr) {
    console.warn(`[gmail-dup-cleanup] ⚠ AUDIT TRAIL GAGAL SETELAH EKSEKUSI — recovery via backup: ${backupFile}`);
    console.warn(`[gmail-dup-cleanup]   detail: ${auditErr.message}`);
  }
  console.log(`[done] ${a.toDelete.length} baris duplikat dihapus. Lihat backup: ${backupFile}`);
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------
async function main() {
  const a = await analyze();
  const hasWork = printReport(a);

  const byMonth = new Map();
  const bySource = new Map();
  for (const [, u] of a.perUser) {
    for (const [m, c] of Object.entries(u.byMonth)) byMonth.set(m, (byMonth.get(m) || 0) + c);
    for (const [s, c] of Object.entries(u.bySource)) bySource.set(s, (bySource.get(s) || 0) + c);
  }
  const summary = {
    mode: EXECUTE ? 'execute' : 'dry-run',
    timestamp: new Date().toISOString(),
    scope: USER_FILTER || 'all-users',
    limit: LIMIT,
    candidateMessages: a.groups.length,
    rowsToDelete: a.toDelete.length,
    truncated: a.truncated,
    matchingMode: MESSAGE_ID_ANY ? 'message-id-any' : 'exact-business-key',
    driftMessages: a.driftMessages.length,
    byMonth: [...byMonth.entries()].map(([m, c]) => ({ month: m, rows: c })),
    bySource: [...bySource.entries()].map(([s, c]) => ({ source: s, rows: c })),
    perUser: [...a.perUser.entries()].map(([userId, u]) => ({
      userId,
      rowsToDelete: u.count,
      byType: u.byType,
      byMonth: u.byMonth,
      bySource: u.bySource,
      balanceBefore: a.balanceByUser.get(userId)?.net ?? 0,
      balanceAfter: (a.balanceByUser.get(userId)?.net ?? 0) - u.sumContribution,
    })),
  };
  if (REPORT_PATH) {
    fs.writeFileSync(REPORT_PATH, JSON.stringify(summary, null, 2));
    console.log(`[report] ${REPORT_PATH}`);
  }

  // Audit trail DRY-RUN (P0 §18) — best-effort: kegagalan hanya warning
  // (run read-only, tidak ada risiko data). Hanya dicatat bila ada pekerjaan
  // (hasWork) — audit no-op (0 duplikat) tidak membanjiri admin_audit_log.
  if (!EXECUTE && hasWork) {
    try {
      await recordCleanupAudit({ result: 'dry_run', a });
    } catch (auditErr) {
      console.warn(`[gmail-dup-cleanup] ⚠ gagal mencatat audit dry_run: ${auditErr.message}`);
    }
  }

  if (EXECUTE && hasWork) {
    await confirmAndExecute(a);
  }
}

main().catch((err) => {
  console.error('[gmail-dup-cleanup] Fatal:', err);
  process.exit(1);
});
