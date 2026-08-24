/**
 * E2E TERISOLASI — DB lokal fresh per run (P1.7).
 *
 * Menyelesaikan debt "shared dev DB + workers:1" untuk run LOKAL: suite tidak
 * lagi menyentuh DB Turso development (data drift = sumber flake pin spec,
 * mis. transaksi 541 → 778), melainkan database libSQL FILE lokal yang dibuat
 * fresh tiap run (scripts/prepare-e2e-local-db.mjs) dengan dataset deterministik
 * YANG SAMA dengan CI (284 tx / 519 gmail logs — PINNED di fixtures.ts cocok).
 *
 *   .test-data/e2e-local.db   ← dibuat & di-seed sebelum API boot; self-heal
 *                              (delete-first) bila run sebelumnya mati di tengah.
 *
 * Port terpisah dari stack dev (5180-5184) agar tidak membajak server yang
 * sedang berjalan: Vite 5190 · API 5191.
 *
 * RATE_LIMIT_ENABLED=false → limiter tidak mengganggu (spec rate-limit memakai
 * server uji 5182 sendiri).
 * GEMINI_MOCK=1 → AI deterministik & offline (boundary mock P1.8) sehingga
 * spec AI (ai-dogfood, ai-conversation) berjalan tanpa kredensial Vertex.
 *
 * Menjalankan:
 *   npm run test:e2e:isolated
 *   npx playwright test -c playwright.e2e-local.config.mjs e2e/dashboard.spec.ts
 */
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { defineConfig } from 'playwright/test';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)));

// ── P2.2 — PER-WORKER (per-shard) ISOLASI ──
// Playwright `webServer` berjalan SEKALI per process test — TIDAK ada hook
// server per-worker. Isolasi DB per-worker karena itu = isolasi per-PROCESS
// via shard: satu process (satu worker) = satu DB file + satu pasang port
// sendiri. `E2E_SHARD_INDEX` memilih worker (default 0 = perilaku lama
// single-run). Setiap worker: DB .test-data/e2e-shard-<i>.db, Vite
// 5190+2i, API 5191+2i (rentang non-tumpang-tindih antar worker).
const SHARD = Number(process.env.E2E_SHARD_INDEX || 0);
if (!Number.isInteger(SHARD) || SHARD < 0 || SHARD > 7) {
  throw new Error(`E2E_SHARD_INDEX wajib integer 0..7 (diterima: ${process.env.E2E_SHARD_INDEX})`);
}
const LOCAL_DB_PATH = path.join(ROOT, '.test-data', `e2e-shard-${SHARD}.db`);
// libsql menerima file: dengan forward slashes (backslash Windows ditolak).
const LOCAL_DB_URL = `file:${LOCAL_DB_PATH.replace(/\\/g, '/')}`;
const VITE_PORT = 5190 + SHARD * 2;
const API_PORT = 5191 + SHARD * 2;

// P4.1: E2E specs (account-ledger, balance-anchor, etc.) call the API directly
// via process.env.API_BASE_URL. Set at module scope so test workers inherit it.
if (!process.env.API_BASE_URL) process.env.API_BASE_URL = `http://127.0.0.1:${API_PORT}`;

export default defineConfig({
  testDir: './e2e',
  testMatch: '**/*.spec.ts',
  // Suite FUNGSIONAL saja — semantik sama dengan `npm run test:e2e` (main
  // config meng-invert @visual|@perf). Spec yang di-ignore di sini TIDAK
  // kehilangan guard: mereka tetap jalan di main config (playwright.config.ts)
  // yang menyediakan server khusus mereka:
  //   - rate-limit*.spec.ts      → butuh server uji 5182 (RATE_LIMIT_ENABLED=true)
  //   - notification-metadata-guard.spec.ts → butuh server 5183 + webhook sink 5184
  //   - oauth-session-host-consistency.spec.ts → hard-codes host/port dev stack
  //     localhost:5180/5181 (main config) bukan port isolasi 5190/5191 → di
  //     isolated config PASTI gagal. Guard jalan di main config (5180/5181) yang
  //     menyediakan stack yang tepat (precedent sama dgn rate-limit/notification).
  //   - @perf (performance.spec.ts)         → budget timing machine-sensitive
  //     (bukan DB-isolation concern; punya command sendiri npm run test:e2e:perf)
  //   - @visual (visual-regression.spec.ts) → gate tersendiri dengan baseline
  //     committed terhadap dataset dev; di-main config di-invert dari suite
  //     default (`npm run test:e2e`) — di sini ikut di-invert agar isolasi DB
  //     tidak bergantung pada baseline dataset dev.
  grepInvert: /@visual|@perf/,
  testIgnore: [
    '**/rate-limit.spec.ts',
    '**/rate-limit-ai-general.spec.ts',
    '**/notification-metadata-guard.spec.ts',
    '**/oauth-session-host-consistency.spec.ts',
  ],
  // P2.2: SATU worker per process (shard) — DB & port worker ini EKSKLUSIF
  // (Playwright webServer per-process; per-worker server tidak didukung).
  // Paralelisme = banyak process shard berjalan bersamaan (scripts/run-e2e-shards.mjs
  // atau CI matrix) → kontaminasi lintas-worker mustahil: DB terpisah total.
  fullyParallel: false,
  workers: 1,
  retries: 1,
  timeout: 60_000,
  expect: { timeout: 20_000 },
  reporter: [['list'], ['html', { outputFolder: 'playwright-report-local', open: 'never' }]],
  forbidOnly: !!process.env.CI,
  // globalSetup (file path, bukan function): arahkan env process test ke DB
  // LOKAL — workers mewarisi process.env → mintSession & helper seed memakai
  // DB yang sama dengan server API.
  globalSetup: './e2e/globalSetup-local-db.mjs',
  env: {
    E2E_LOCAL_DB_URL: LOCAL_DB_URL,
    // Dataset = seed CI (284 tx / 519 gmail logs) — PINNED fixtures default
    // adalah dataset dev (541/611); override SAMA dengan e2e.yml CI.
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
      // Chain: siapkan DB lokal worker ini (fresh + seed) SEBELUM API boot.
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
        // Origin app di port Vite worker ini — default ALLOWED_ORIGINS server
        // hanya 5180/4173; tanpa ini fetch langsung app ke API di-blok CORS.
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
