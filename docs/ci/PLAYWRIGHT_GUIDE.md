# Playwright Guide

> **Date:** 2026-08-06 · **Author:** QA audit (Sprint 0.7)
> **Scope:** `playwright.config.ts`, `e2e/`, stability gate
> **Goal:** Suite E2E stabil & deterministik — anti-flaky

---

## 1. Config (playwright.config.ts)

| Setting | Nilai | Alasan |
|---|---|---|
| `timeout` | 60s | suite default |
| `expect.timeout` | 20s | `expect.poll` filter/pagination butuh ruang di CI shared runner |
| `workers` | **1** | semua test memakai sesi DB Turso bersama → paralel = race session |
| `retries` | 1 | flake per-test ditangani 1× dalam run |
| `fullyParallel` | false | konsekuensi workers:1 |
| `snapshotPathTemplate` | tanpa suffix platform | baseline visual portabel lintas OS (Windows dev vs Ubuntu CI) |
| `forbidOnly` | `!!process.env.CI` | `.only` memblokir di CI |
| `actionTimeout` / `navigationTimeout` | 15s / 30s | anti-hang |

**WebServer topology (auto-start, `reuseExistingServer: true`):**

| Port | Server | Khusus |
|---|---|---|
| 5180 | Vite dev | frontend |
| 5181 | `node server/index.js` | API utama (PORT via env, bukan watch — watch = restart tengah suite = flake) |
| 5182 | `node server/index.js` | **rate-limit spec** (isolasi IP limiter: `RATE_LIMIT_AUTH_MAX=25`) |
| 5183 | `node server/index.js` | **notification webhook spec** (`GMAIL_WEBHOOK_URL` → sink 5184) |
| 5184 | `webhookSinkServer.mjs` | webhook sink (side-effect assert deterministik) |

## 2. Stability Gate (3×)

`scripts/e2e-stability-gate.sh` — suite dijalankan hingga `MAX_ATTEMPTS` (3):

- Lulus attempt pertama → hijau instan.
- 1–2 attempt gagal lalu lulus → **HIJAU** + `::warning::` + arsip per-attempt (`playwright-report-attempt-N/`, `test-results-attempt-N/`) untuk forensik flake.
- 3× gagal berturut → **MERAH** (regresi riil).
- Re-seed otomatis antar attempt gagal (`SEED_E2E=1`) → attempt berikutnya mulai dari state deterministik.

## 3. Pola Stabil (wajib)

```ts
// ✅ Web-first assertion
await expect(page.getByRole('button', { name: 'Simpan' })).toBeVisible();

// ✅ State async (pagination/filter) → poll, bukan sleep
await expect.poll(async () => {
  const resp = await request.get('/api/...');
  return (await resp.json()).total;
}, { timeout: 15_000 }).toBe(284);

// ✅ Tunggu elemen, bukan waktu
await page.getByText('Loading...').waitFor({ state: 'detached' });

// ✅ Selector via role/text stabil
page.getByPlaceholder('Cari transaksi…')
```

## 4. Anti-pattern

| ❌ | ✅ | Catatan |
|---|---|---|
| `await page.waitForTimeout(1000)` sembarangan | `expect.poll` / `waitFor` | Hard wait = race: terlalu cepat → false fail; terlalu lambat → suite lambat |
| `page.waitForSelector('.row')` | `expect(row).toBeVisible()` | CSS class rapuh; web-first auto-retry |
| Selector DOM berlapis (`#app > div > span:last-child`) | `getByRole`/`getByText`/`getByTestId` | struktur berubah = test patah |
| `toBe(284)` hardcode di spec | `PINNED` fixtures + env override | dataset seed berubah = edit 1 tempat |
| Test mengandalkan urutan eksekusi | self-contained (mint session + seed data) | `workers:1` bukan alasan untuk coupling |
| `.only` / `.skip` sengaja | hapus / `forbidOnly` CI | `.only` memblokir merge di CI |

## 5. Pengecualian Hard-wait yang Diizinkan

Audit Sprint 0.7 (2026-08-06): hanya 3 `waitForTimeout` di seluruh `e2e/`, semuanya justifiable:

1. `gmail-review-amount-missing.spec.ts` (~1s) — **negative-state verification**: menunggu jendela settle untuk meng-assert bahwa bug hipotetis (persist status salah) TIDAK mendarat. `expect.poll` resolusi seketika bisa "lolos vakum" tanpa jendela ini.
2. `visual-regression.spec.ts` (300ms) — stabilisasi swap font self-hosted sebelum snapshot.
3. `performance.config.ts` (500ms) — settle sebelum pengukuran timing.

**Jangan tambah hard-wait baru tanpa komentar alasan + justifikasi serupa.**

## 6. Menulis Spec Baru (checklist)

- [ ] Pakai `mintSession` helper untuk auth (bukan login OAuth manual).
- [ ] Data assert dari `PINNED` fixtures (bukan angka literal).
- [ ] Tidak ada `waitForTimeout` tanpa komentar justifikasi.
- [ ] Bisa jalan mandiri (`npx playwright test e2e/foo.spec.ts`) tanpa test lain.
- [ ] Typecheck e2e lolos (`npm run test:e2e:typecheck`).
