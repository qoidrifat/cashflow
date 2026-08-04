import { defineConfig } from 'playwright/test';

/**
 * Playwright E2E config untuk CashFlow.
 *
 * Test membutuhkan kedua server (Vite dev + Express API) yang sudah berjalan
 * atau akan otomatis di-start oleh webServer. Port: Vite 5180, API 5181.
 */
export default defineConfig({
  testDir: './e2e',
  timeout: 60_000,
  expect: {
    // Dinaikkan dari 15s → 20s: expect.poll untuk filter/pagination bisa kena
    // beban sistem (CI paralel) — timeout lebih longgar = anti-flaky.
    timeout: 20_000,
  },
  fullyParallel: false,
  // workers:1 — test memakai sesi DB Turso bersama (mint cookie + cleanup),
  // paralelisme antar test bisa saling timpa session/state.
  workers: 1,
  retries: 1,
  // Visual regression: template path snapshot = lokasi default Playwright
  // (e2e/visual/visual-regression.spec.ts-snapshots/) TANPA token platform
  // (`{-snapshotSuffix}` = win32/linux) agar baseline ter-commit portabel
  // lintas OS — CI (ubuntu) & dev (windows) memakai nama file yang sama.
  // Hanya toHaveScreenshot yang memakai snapshot (spec visual); aman untuk
  // matcher lain.
  snapshotPathTemplate: '{snapshotDir}/{testFileDir}/{testFileName}-snapshots/{arg}{ext}',
  reporter: [
    ['list'],
    ['html', { outputFolder: 'playwright-report', open: 'never' }],
  ],
  forbidOnly: !!process.env.CI,
  use: {
    baseURL: 'http://localhost:5180',
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
      // `node server/index.js` langsung (BUKAN `npm run dev:server`): dev:server
      // memakai --watch → restart API di tengah suite = sumber flake. Mode watch
      // tetap tersedia untuk penggunaan interaktif.
      command: 'node server/index.js',
      url: 'http://localhost:5181/api/health',
      reuseExistingServer: true,
      timeout: 60_000,
      // PORT dipin eksplisit: server membaca process.env.PORT SEBELUM dotenv
      // (env luar menang atas server/.env) — pola sama dengan server 5182.
      env: {
        ...process.env,
        PORT: '5181',
      },
    },
    {
      command: 'npm run dev',
      url: 'http://localhost:5180',
      reuseExistingServer: true,
      timeout: 60_000,
    },
    // Server uji KHUSUS untuk rate-limit spec (e2e/rate-limit.spec.ts).
    // RATE_LIMIT_AUTH_MAX=25 → test cepat (≤26 request, bukan 121) & deterministik.
    // Terpisah dari 5181 karena authLimiter di-key per-IP: tanpa isolasi, spec ini
    // menguras budget IP bersama yang dipakai seluruh suite (dan sebaliknya).
    // RATE_LIMIT_ENABLED=true dipaksa eksplisit (anti inherited 'false' dari CI).
    {
      command: 'node server/index.js',
      url: 'http://localhost:5182/api/health',
      reuseExistingServer: true,
      timeout: 60_000,
      env: {
        ...process.env,
        PORT: '5182',
        RATE_LIMIT_ENABLED: 'true',
        RATE_LIMIT_AUTH_MAX: '25',
        RATE_LIMIT_GENERAL_MAX: '1000',
      },
    },
    // Webhook sink (P1-4 notification-metadata-guard.spec.ts): penerima webhook
    // gmail review agar side effect operator bisa di-assert deterministik.
    {
      command: 'node e2e/helpers/webhookSinkServer.mjs',
      url: 'http://localhost:5184/sink-health',
      reuseExistingServer: true,
      timeout: 30_000,
      env: {
        ...process.env,
        WEBHOOK_SINK_PORT: '5184',
      },
    },
    // Server uji KHUSUS untuk notification-metadata-guard spec (P1-4):
    // GMAIL_WEBHOOK_URL diarahkan ke sink 5184 sehingga trigger webhook dari
    // POST /api/notifications teramati. Terpisah dari 5181 agar env webhook
    // tidak memengaruhi spec lain.
    {
      command: 'node server/index.js',
      url: 'http://localhost:5183/api/health',
      reuseExistingServer: true,
      timeout: 60_000,
      env: {
        ...process.env,
        PORT: '5183',
        GMAIL_WEBHOOK_URL: 'http://127.0.0.1:5184/hook',
      },
    },
  ],
});
