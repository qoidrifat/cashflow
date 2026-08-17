# CI Pipeline — CashFlow E2E

> Phase 9 dari Enterprise E2E Modernization. Workflow: `.github/workflows/e2e.yml`## Arsitektur Pipeline

```
┌─────────────┐   ┌──────────────────────────────────────────┐   ┌──────────────────────┐   ┌──────────────────────┐
│  quality    │──▶│  e2e (Playwright, 61 test + 10 contract)│──▶│  visual-regression   │──▶│  performance         │
│  lint+tc+b   │   │  stability gate 3×: fail only on 3× flaky│   │  10 snapshot (theme) │   │  budget: load/API/   │
└─────────────┘   │  webServer: Vite 5180 + API 5181/5182   │   │  desktop+mobile      │   │  pagination          │
                  └──────────────────────────────────────────┘   └──────────────────────┘   └──────────────────────┘
                                          │  Artifacts: report + traces + diff screenshot + perf JSON
                                          └───────────────────────────────────────────────────────┘
```

- **4 job berantai (serial)** — `quality` (cepat, gagal duluan bila kode tidak valid) → `e2e` (`needs: quality`) → `visual-regression` (`needs: [quality, e2e]`) → `performance` (`needs: [quality, e2e, visual-regression]`).
- **Trigger**: push ke `main`/`gh-pages`, pull request, dan `workflow_dispatch` manual.
- **`concurrency` (global, `group: e2e`)**: serialisasi **semua** run E2E — bukan per-ref. E2E memakai `workers: 1`, webServer bersama (Vite+API), dan DB Turso bersama; dua run paralel (mis. push ke main + PR, yang punya ref berbeda) saling rebut resource → flaky (pola ini terkonfirmasi saat investigasi flake filter status).
- **Stability gate 3×**: suite dijalankan hingga 3 attempt; job GAGAL **hanya** bila 3× gagal berturut (regresi riil). Lihat seksi *Stability Gate 3×* di bawah.
- **Visual & perf sengaja serial setelah `e2e`** (bukan paralel): ketiganya memakai DB Turso yang sama (`mintSession`/`cleanup` menulis baris `session`) + webServer bersama — menjalankan 2 instance Playwright paralel pada DB yang sama = race session (aturan serialisasi proyek, terbukti saat investigasi flake).

## Quality Gates (job `quality`)

| Gate | Command | Tujuan |
|---|---|---|
| Lint | `npm run lint` (`tsc --noEmit`) | Error tipe di source app |
| Typecheck E2E | `npm run test:e2e:typecheck` (`tsc -p tsconfig.e2e.json`) | Error tipe di spec & helpers |
| Build | `npm run build` (`tsc + vite build`) | Produksi buildable |

Semua gate berjalan **berurutan dalam satu job** — build hanya dijalankan setelah lint & typecheck bersih (hemat biaya CI runner).

## E2E Job — Requirements

### Deps server (kritikal — CI-only failure)

`server/` punya `package.json` sendiri dengan dep ekstra yang **tidak ada** di root: `cookie-parser`, `@better-auth/infra`, `google-auth-library`, `@google-cloud/storage`. Karena webServer menjalankan `node server/index.js`, workflow menjalankan **`npm ci` kedua di `server/`** — tanpa ini server gagal boot (module-not-found) dan seluruh suite E2E gagal.

### Secret yang wajib diset di GitHub repository

| Secret | Dipakai | Diperlukan? |
|---|---|---|
| `TURSO_DATABASE_URL` | `server/index.js` (boot) → webServer auto-start | **YA** — tanpa ini API tidak boot, seluruh suite gagal |
| `TURSO_AUTH_TOKEN` | `server/lib/turso.js` | **YA** |
| `VITE_SUPABASE_URL` / `VITE_SUPABASE_ANON_KEY` | ~~Frontend boot~~ (legacy) | **Tidak diperlukan** — *catatan usang*: baris ini semula merujuk `src/config/supabase.ts` sebagai compatibility stub; stub tersebut sudah **dihapus** (Supabase di-decommission penuh 2026-08-02) dan variabel ini tidak dibaca oleh kode aktif mana pun |
| `GEMINI_API_KEY` | Fitur AI (server-side) | Opsional — server tidak memvalidasi key saat boot (komentar `server/index.js` L7), dan spec saat ini tidak memanggil AI riil (di-mock, lihat `AI_E2E_STRATEGY.md`) |

> ⚠️ Env server dibaca **langsung dari `process.env`** (dotenv hanya fallback dari `server/.env`), jadi menyetel secret di GitHub Actions cukup — tidak perlu commit `.env`.

> 🛡️ Workflow punya **fail-fast guard**: bila `TURSO_DATABASE_URL`/`TURSO_AUTH_TOKEN` kosong, job `e2e` berhenti dengan pesan error yang jelas (bukan gagal di `/api/health` probe setelah 60s).

### Playwright browsers

`npx playwright install --with-deps chromium` — hanya Chromium yang diinstal (spec memakai Chromium default; `--with-deps` menyiapkan pustaka sistem Ubuntu).

## Artifacts

| Artifact | Kondisi | Isi |
|---|---|---|
| `playwright-report/` | `always()` | HTML report interaktif (reporter `html`, `open: never`) — state TERAKHIR (attempt final); job visual/perf mengunggah report-nya sendiri (`playwright-report-visual` / `playwright-report-perf`) |
| `stability-attempt-artifacts` | `always()` | Arsip **per-attempt** (`playwright-report-attempt-*` / `test-results-attempt-*`) dari SETIAP attempt yang gagal — termasuk attempt yang lalu sukses di retry (flake yang lolos gate) |
| `test-results/` | `failure()` | Trace (.zip), screenshot (error-context.png), video (retain-on-failure), error-context.md — attempt final |
| `visual-diffs` | `failure()` (job visual) | Screenshot diff (actual vs baseline) + snapshot dir untuk debug regresi visual |
| `perf-reports` | `always()` (job perf) | `test-results/perf/perf-*.json` — trend historis budget (retensi 30 hari, kalibrasi budget CI) |

Retensi 14 hari. Trace Playwright diaktifkan per-test via `trace: 'retain-on-failure'` di config — berguna untuk debug race di CI yang tidak bisa direproduksi lokal.

## Stability Gate 3×

> ✅ **Roadmap #1 SELESAI** (2026-08-03) — diterapkan saat suite > 20 test (kini 71 test — 61 UI + 10 contract).

**Tujuan**: membedakan **flake** (kegagalan sesaat, lalu lulus) dari **regresi riil** (kegagalan konsisten) tanpa menyerah pada flake — dan tanpa membiarkan regresi lolos.

### Semantik gate

| Skenario | Result | Job CI | Forensik |
|---|---|---|---|
| Attempt 1 lulus | `passed`, `failed_attempts=0` | 🟢 HIJAU | report final |
| 1–2 attempt gagal, lalu lulus | `passed`, `failed_attempts=1..2` | 🟢 HIJAU + `::warning::` | arsip per-attempt (flake) |
| Semua 3 attempt gagal | `failed`, `failed_attempts=3` | 🔴 MERAH + `::error::` | arsip per-attempt + report final |

### Cara kerja (`scripts/e2e-stability-gate.sh`, via `npm run test:e2e:stability`)

1. Loop hingga `MAX_ATTEMPTS` (default **3**), menjalankan `E2E_CMD` (default `npm run test:e2e`).
2. Attempt lulus → `exit 0`; bila ada attempt gagal sebelumnya, keluar warning flake.
3. Attempt gagal → arsip `playwright-report/` + `test-results/` ke folder ber-suffix attempt (sebelum run berikutnya menimpanya), lalu **re-seed DB** (`SEED_CMD`, default `scripts/seedE2eDataset.mjs` — idempoten, hanya menyentuh user seed, guard `SEED_E2E=1`) agar attempt berikutnya mulai dari state deterministik.
4. Semua attempt gagal → `::error::` + `exit 1` (job merah).

**Interplay dengan retries Playwright**: `playwright.config.ts` `retries: 1` menangani flake **per-test** di dalam satu run (test gagal → 1 retry); gate bekerja di level **suite** (run gagal → ulangi run). Total eksekusi terburuk = 3 run × 2 (test-level retry).

**Testable lokal** (tanpa menyentuh DB):

```bash
E2E_CMD="false" SEED_CMD="true" bash scripts/e2e-stability-gate.sh   # regresi: 3× gagal → exit 1
E2E_CMD="true"  SEED_CMD="true" bash scripts/e2e-stability-gate.sh   # stabil: attempt 1 → exit 0
```

### Catatan

- **Re-seed hanya berjalan antar attempt yang GAGAL** — attempt sukses tidak mengubah DB seed.
- Output `result` + `failed_attempts` ditulis ke `GITHUB_OUTPUT` bila tersedia (dipakai step upload artifact).
- Job `timeout-minutes: 45` (budget 3× suite ~3 menit/run + setup + seed + contract).

## Konfigurasi E2E yang CI-aware

`playwright.config.ts` sudah disetel untuk CI:

- `forbidOnly: !!process.env.CI` — test.only langsung gagal di CI
- `expect.timeout: 20_000` — headroom poll filter/pagination saat beban CI
- `timeout: 60_000`, `actionTimeout: 15_000`, `navigationTimeout: 30_000`
- `retries: 1` — attempt kedua sebelum dinyatakan gagal (flake sesekali akibat load CI)
- `workers: 1` — deterministik; suite ~45s
- `reuseExistingServer: true` — dev lokal memakai server yang sudah jalan

## Menjalankan di lokal (praktek yang sama dengan CI)

```bash
npm run lint && npm run test:e2e:typecheck && npm run build   # quality gates
npx playwright test                                            # full suite
npx playwright test e2e/gmail-sync.spec.ts                     # subset
npx playwright show-report                                     # lihat HTML report
```

## Roadmap CI (rekomendasi lanjutan)

1. ~~**`npm run test:e2e` sebanyak 3× di CI** (stability gate)~~ — ✅ **SELESAI**: `scripts/e2e-stability-gate.sh` + step `e2e-gate` di workflow; fail hanya bila 3× flaky (lihat seksi *Stability Gate 3×*).
2. **Seed data CI-isolasi** — jalankan E2E terhadap Turso DB `file:` lokal (SQLite) yang di-seed dari `turso-schema.sql` + fixture, agar tidak menulis sesi test ke DB produksi. (Catatan: `mintSession` menulis baris `session` ke Turso; `cleanupTestSessions()` membersihkannya di akhir. — Status saat ini: DB Turso **terpisah** untuk CI via secrets `TURSO_DATABASE_URL`/`TURSO_AUTH_TOKEN`.)
3. ~~**Visual regression + API contract**~~ — ✅ **SELESAI** (2026-08-03): contract sudah jalan di job `e2e` (step terpisah); visual kini job terpisah `visual-regression` (**10 snapshot**: landing ×4, dashboard ×2, transactions/gmail-sync ×2 — lihat `VISUAL_REGRESSION_PLAN.md`) + job `performance` terpisah untuk budget. Lihat seksi *Visual Regression & Performance Budget* di bawah.
4. **`schedule` cron** — nightly full regression terhadap staging.

## Visual Regression & Performance Budget (job terpisah)

> ✅ **Roadmap CI #3 SELESAI** (2026-08-03) — roadmap 4 item kini 3 tuntas (1, 3), sisa #2 (seed CI file:) & #4 (cron).

### Job `visual-regression` (`needs: [quality, e2e]`)

- Menjalankan `npm run test:e2e:visual:check` (mode **check**, tanpa `--update-snapshots`) — 6 test snapshot (`e2e/visual/visual-regression.spec.ts`).
- Baseline di-commit (`e2e/visual/visual-regression.spec.ts-snapshots/`) **tanpa suffix platform** (via `snapshotPathTemplate` di `playwright.config.ts`) → portabel Windows (dev) & Ubuntu (CI).
- **Font self-hosted** (`public/fonts/Manrope-Variable.ttf` + `Outfit-Variable.ttf`, OFL): baseline digenerate di Windows, check di Ubuntu — tanpa self-host, Ubuntu fallback ke font sistem → diff besar → job pasti gagal. Self-host = file identik di semua OS + bonus hapus request third-party Google Fonts (perf/privacy).
- Diff > 0.02 `maxDiffPixelRatio` → job merah + artifact `visual-diffs` (screenshot actual vs baseline).
- Kalibrasi pertama di CI: bila diff antar-OS masih muncul (hinting/antialiasing), naikkan `maxDiffPixelRatio` bertahap atau mask region teks — bukan hapus matcher.

### Job `performance` (`needs: [quality, e2e, visual-regression]`)

- Menjalankan `npm run test:e2e:perf` — 3 test: page load (domContentLoaded + requests), API latency (p50/p95), large-dataset pagination.
- Budget terpusat di `e2e/performance/performance.config.ts`; di CI di-override via env (`PERF_BUDGET_*` — lihat komentar job). **Kalibrasi v2 (2026-08-03)**: berbasis perf-reports nyata (DOM ≤261ms / LOAD ≤277ms / API p95 ≤549ms / 41 requests per page / pagination 3.0–5.1s) → budget = terukur × margin ~3–15× (`3000/4000/1800/60/6000/12000`; API p95 1800 karena p95 n=3 = maks dari 3 sampel). Angka masih akan di-tighten lanjut dari trend `perf-reports` (retensi 30 hari).
- Pagination: **soft** budget = warning (report + log, bukan fail), **hard** budget = fail (regresi orde-magnitudo seperti N+1 / index hilang). Detail di `PERFORMANCE_TEST_PLAN.md`.
