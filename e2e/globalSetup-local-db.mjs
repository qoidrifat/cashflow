/**
 * globalSetup untuk config E2E terisolasi (playwright.e2e-local.config.mjs).
 *
 * Berjalan SEKALI di process utama Playwright — env yang di-set di sini
 * diwarisi oleh worker test → mintSession & helper seed membaca DB LOKAL
 * (bukan server/.env development), dan PINNED fixtures memakai dataset seed
 * CI (284 tx / 519 gmail logs) yang sama dengan DB lokal. Ini KUNCI agar
 * cookie sesi di-mint ke DB yang sama dengan server API (port 5191).
 *
 * Jalur DB diambil dari env `E2E_LOCAL_DB_URL` yang di-set config (bila tidak
 * ada, fallback ke .test-data/e2e-local.db relatif project root).
 */
import fs from 'node:fs';
import path from 'node:path';

// P2.2: DB default mengikuti worker (shard) — setiap worker memakai DB
// miliknya sendiri (playwright.e2e-local.config.mjs menghitung path yang sama
// dari E2E_SHARD_INDEX). Fallback ini hanya dipakai bila config env tidak
// ter-propagasi (lihat catatan di config — globalSetup memang source of truth).
const SHARD = Number(process.env.E2E_SHARD_INDEX || 0);
const DEFAULT_DB = path.resolve('.test-data', `e2e-shard-${SHARD}.db`).replace(/\\/g, '/');

// ── P0.13 — SINGLE-WRITER LOCK (DB COLLISION GUARD, Objective 6/19) ──
// Root cause yang ditemukan: dua `npm run test:e2e:isolated` yang berjalan
// sekaligus (atau sisa run yang menggantung) memakai E2E_SHARD_INDEX yang sama
// → keduanya menarget `.test-data/e2e-shard-<i>.db` + port yang sama, saling
// delete-first dan saling menimpa. Konsekuensinya: worker DB collision dan
// full-suite hang/timeout yang sulit direproduksi.
//
// globalSetup berjalan SEKALI per process runner dan hidup selama run → ia
// pemilik lock yang tepat (prepare-e2e-local-db hanya one-shot, keluar sebelum
// API boot, jadi MENCABUT lock di sana tidak cukup). Guard fail-closed: bila
// lock berisi PID proses yang MASIH HIDUP → ada runner lain memegang shard ini
// → ABORT (jangan saling merusak). Lock versi write+readback memastikan dua
// proses tidak menimpa satu sama lain di window sempit. Lock di .test-data/
// (gitignored), dibersihkan di exit process runner.
const dbPath = process.env.E2E_LOCAL_DB_URL
  ? String(process.env.E2E_LOCAL_DB_URL).replace(/^file:/, '')
  : DEFAULT_DB;
const LOCK_PATH = `${dbPath}.lock`;
function pidAlive(pid) {
  try {
    if (!pid || !Number.isInteger(Number(pid)) || Number(pid) <= 0) return false;
    return process.kill(Number(pid), 0);
  } catch {
    return false;
  }
}
function acquireLockOrAbort() {
  const held = fs.existsSync(LOCK_PATH) ? fs.readFileSync(LOCK_PATH, 'utf8').trim() : '';
  if (held && pidAlive(held)) {
    throw new Error(
      `[e2e-local] ⛔ DB ${dbPath} sedang dipakai runner PID ${held} (lock ${LOCK_PATH}) — ` +
      'ada run E2E lain dengan shard yang sama. Set E2E_SHARD_INDEX berbeda atau hentikan run lama.',
    );
  }
  fs.writeFileSync(LOCK_PATH, String(process.pid), 'utf8');
  const readback = fs.readFileSync(LOCK_PATH, 'utf8').trim();
  if (readback !== String(process.pid)) {
    throw new Error(`[e2e-local] ⛔ Lock ${LOCK_PATH} diambil proses lain (${readback}) — abort.`);
  }
}
function releaseLock() {
  try {
    if (fs.readFileSync(LOCK_PATH, 'utf8').trim() === String(process.pid)) {
      fs.rmSync(LOCK_PATH, { force: true });
    }
  } catch { /* non-blocking cleanup */ }
}

export default function globalSetup() {
  acquireLockOrAbort();
  // Bersihkan lock saat proses runner selesai (sukses/gagal/minum).
  process.on('exit', releaseLock);
  process.env.TURSO_DATABASE_URL = process.env.E2E_LOCAL_DB_URL || `file:${DEFAULT_DB}`;
  process.env.TURSO_AUTH_TOKEN = 'local-e2e';
  process.env.ADMIN_EMAILS = process.env.ADMIN_EMAILS || 'e2e-seed-admin@cashflow.test';
  // Dataset = seed CI (284/519) — override PINNED (fixtures.ts default = dev 541/611).
  process.env.E2E_PINNED_TRANSACTIONS_TOTAL = process.env.E2E_PINNED_TRANSACTIONS_TOTAL || '284';
  process.env.E2E_PINNED_TRANSACTIONS_INCOME = process.env.E2E_PINNED_TRANSACTIONS_INCOME || '86';
  process.env.E2E_PINNED_TRANSACTIONS_EXPENSE = process.env.E2E_PINNED_TRANSACTIONS_EXPENSE || '131';
  process.env.E2E_PINNED_GMAIL_LOGS_TOTAL = process.env.E2E_PINNED_GMAIL_LOGS_TOTAL || '519';
}
