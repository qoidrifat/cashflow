/**
 * VISUAL REGRESSION TERISOLASI — DB lokal fresh per run (baseline drift guard).
 *
 * Menyelesaikan debt "visual baseline vs dev DB drift" (root cause: seed admin
 * dev memperoleh wallet_accounts/reconciliation data dari run E2E P3.x → kartu
 * ledger dashboard berubah → 6 snapshot dashboard/transactions gagal padahal
 * bukan UI regression). Config ini menjalankan HANYA suite @visual terhadap
 * database libSQL FILE lokal yang dibuat fresh tiap run (P1.7 pattern, SAMA
 * dengan playwright.e2e-local.config.mjs) dengan dataset deterministik CI
 * (284 tx / 519 gmail logs — seedE2eDataset.mjs, mulberry32(20260802)).
 *
 * Hasilnya: baseline yang di-generate/di-verify TIDAK bergantung pada data
 * developer DB; render identik dengan CI (yang men-seed Turso dengan dataset
 * yang sama persis).
 *
 *   .test-data/e2e-visual.db   ← dibuat & di-seed sebelum API boot (self-heal
 *                                delete-first bila run sebelumnya mati).
 *
 * Port terpisah dari stack dev (5180/5181) dan isolated (5190/5191):
 *   Vite 5192 · API 5193.
 *
 * Menjalankan:
 *   npx playwright test -c playwright.visual-local.config.mjs            (check)
 *   npx playwright test -c playwright.visual-local.config.mjs --update-snapshots
 */
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { defineConfig } from 'playwright/test';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)));

const LOCAL_DB_PATH = path.join(ROOT, '.test-data', 'e2e-visual.db');
// libsql menerima file: dengan forward slashes (backslash Windows ditolak).
const LOCAL_DB_URL = `file:${LOCAL_DB_PATH.replace(/\\/g, '/')}`;
const VITE_PORT = 5192;
const API_PORT = 5193;

export default defineConfig({
  testDir: './e2e',
  testMatch: '**/visual/visual-regression.spec.ts',
  // HANYA suite visual — @visual tag (semua test di spec ini).
  grep: /@visual/,
  fullyParallel: false,
  workers: 1,
  retries: 1,
  timeout: 60_000,
  expect: { timeout: 20_000 },
  reporter: [['list'], ['html', { outputFolder: 'playwright-report-visual-local', open: 'never' }]],
  forbidOnly: !!process.env.CI,
  // Template snapshot TANPA suffix platform — HARUS identik dengan main config
  // (playwright.config.ts) agar baseline ter-commit portabel lintas OS dan
  // SHARED antara run dev (5180/5181) dan run visual-local ini.
  snapshotPathTemplate: '{snapshotDir}/{testFileDir}/{testFileName}-snapshots/{arg}{ext}',
  // globalSetup: arahkan env process test ke DB LOKAL — workers mewarisi
  // process.env → mintSession & helper seed memakai DB yang sama dengan API.
  // DEDICATED (bukan globalSetup-local-db.mjs): DB path HARDCODED ke
  // .test-data/e2e-visual.db — config env TIDAK dijamin ter-propagasi ke
  // globalSetup (fallback globalSetup-local-db = e2e-shard-<i>.db ≠ API DB →
  // sesi di-mint ke DB yang salah → dashboard redirect landing — terbukti).
  globalSetup: './e2e/globalSetup-visual-local.mjs',
  env: {
    E2E_LOCAL_DB_URL: LOCAL_DB_URL,
    // Dataset = seed CI (284 tx / 519 gmail logs) — PINNED fixtures override.
    E2E_PINNED_TRANSACTIONS_TOTAL: '284',
    E2E_PINNED_TRANSACTIONS_INCOME: '86',
    E2E_PINNED_TRANSACTIONS_EXPENSE: '131',
    E2E_PINNED_GMAIL_LOGS_TOTAL: '519',
  },
  use: {
    baseURL: `http://localhost:${VITE_PORT}`,
    headless: true,
    viewport: { width: 1440, height: 900 },
    screenshot: 'only-on-failure',
    trace: 'retain-on-failure',
    video: 'retain-on-failure',
    actionTimeout: 15_000,
    navigationTimeout: 30_000,
  },
  webServer: [
    {
      // Chain: siapkan DB lokal fresh (schema + migrasi + seed CI-equivalent)
      // SEBELUM API boot (pola playwright.e2e-local.config.mjs).
      command: `node scripts/prepare-e2e-local-db.mjs && node server/index.js`,
      url: `http://localhost:${API_PORT}/api/health`,
      reuseExistingServer: false,
      timeout: 90_000,
      env: {
        ...process.env,
        PORT: String(API_PORT),
        TURSO_DATABASE_URL: LOCAL_DB_URL,
        TURSO_AUTH_TOKEN: 'local-e2e',
        RATE_LIMIT_ENABLED: 'false',
        GEMINI_MOCK: '1',
        NODE_ENV: 'development',
        // Admin email seed (harus sama dengan globalSetup + prepare-e2e-local-db)
        // — tanpa ini server membaca server/.env (admin dev) → seed admin 403.
        ADMIN_EMAILS: process.env.ADMIN_EMAILS || 'e2e-seed-admin@cashflow.test',
        // Origin app di port Vite ini — default ALLOWED_ORIGINS server hanya
        // 5180/4173; tanpa ini fetch langsung app ke API di-blok CORS.
        ALLOWED_ORIGINS: `http://localhost:${VITE_PORT},http://127.0.0.1:${VITE_PORT}`,
      },
    },
    {
      command: `npx vite --host localhost --port ${VITE_PORT} --strictPort`,
      url: `http://localhost:${VITE_PORT}`,
      reuseExistingServer: false,
      timeout: 60_000,
      env: {
        ...process.env,
        VITE_API_BASE_URL: `http://localhost:${API_PORT}`,
        // Vite proxy /api → API worker ini (spec page.request relatif).
        VITE_API_PROXY_TARGET: `http://localhost:${API_PORT}`,
      },
    },
  ],
});
