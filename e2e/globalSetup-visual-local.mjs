/**
 * globalSetup untuk config VISUAL terisolasi (playwright.visual-local.config.mjs).
 *
 * Analog globalSetup-local-db.mjs tapi dengan DB path yang HARDCODED ke
 * .test-data/e2e-visual.db (bukan fallback e2e-shard-<i>.db) — memastikan
 * mintSession & helper seed menulis ke DB yang SAMA dengan server API
 * (port 5193), terlepas dari propagasi env config ke globalSetup.
 *
 * Jalur DB HARUS identik dengan konstanta di playwright.visual-local.config.mjs
 * (LOCAL_DB_PATH) dan env webServer API (TURSO_DATABASE_URL).
 */
import fs from 'node:fs';
import path from 'node:path';

const DB_PATH = path.resolve('.test-data', 'e2e-visual.db').replace(/\\/g, '/');
const DB_URL = `file:${DB_PATH}`;
const LOCK_PATH = `${DB_PATH}.lock`;

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
      `[e2e-visual] ⛔ DB ${DB_PATH} sedang dipakai runner PID ${held} (lock ${LOCK_PATH}) — hentikan run visual lain.`,
    );
  }
  fs.writeFileSync(LOCK_PATH, String(process.pid), 'utf8');
  const readback = fs.readFileSync(LOCK_PATH, 'utf8').trim();
  if (readback !== String(process.pid)) {
    throw new Error(`[e2e-visual] ⛔ Lock ${LOCK_PATH} diambil proses lain (${readback}) — abort.`);
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
  process.on('exit', releaseLock);
  process.env.TURSO_DATABASE_URL = DB_URL;
  process.env.TURSO_AUTH_TOKEN = 'local-e2e';
  process.env.ADMIN_EMAILS = process.env.ADMIN_EMAILS || 'e2e-seed-admin@cashflow.test';
  // Dataset = seed CI (284 tx / 519 gmail logs) — PINNED fixtures override.
  process.env.E2E_PINNED_TRANSACTIONS_TOTAL = '284';
  process.env.E2E_PINNED_TRANSACTIONS_INCOME = '86';
  process.env.E2E_PINNED_TRANSACTIONS_EXPENSE = '131';
  process.env.E2E_PINNED_GMAIL_LOGS_TOTAL = '519';
}
