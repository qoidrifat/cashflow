# CI Pipeline — CashFlow E2E

> Phase 9 dari Enterprise E2E Modernization. Workflow: `.github/workflows/e2e.yml`

## Arsitektur Pipeline

```
┌─────────────┐   ┌──────────────────────────────┐   ┌──────────────────┐
│  quality    │──▶│  e2e (Playwright, 8 tests)   │──▶│  Artifacts       │
│  lint+tc+b  │   │  webServer: Vite 5180 + API  │   │  report + traces │
└─────────────┘   │  5181 (auto-start)            │   └──────────────────┘
                  └──────────────────────────────┘
```

- **2 job terpisah** — `quality` (cepat, gagal duluan bila kode tidak valid) lalu `e2e` yang bergantung padanya (`needs: quality`).
- **Trigger**: push ke `main`/`gh-pages`, pull request, dan `workflow_dispatch` manual.
- **`concurrency` (global, `group: e2e`)**: serialisasi **semua** run E2E — bukan per-ref. E2E memakai `workers: 1`, webServer bersama (Vite+API), dan DB Turso bersama; dua run paralel (mis. push ke main + PR, yang punya ref berbeda) saling rebut resource → flaky (pola ini terkonfirmasi saat investigasi flake filter status).

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
| `VITE_SUPABASE_URL` / `VITE_SUPABASE_ANON_KEY` | Frontend boot | Opsional — **terbukti aman kosong**: `src/config/supabase.ts` adalah *compatibility stub* (tidak pernah memanggil `createClient`), satu-satunya referensi lain hanya string pesan di `src/config/constants.ts` L108 (bukan throw), dan semua `import.meta.env` lain memakai fallback aman |
| `GEMINI_API_KEY` | Fitur AI (server-side) | Opsional — server tidak memvalidasi key saat boot (komentar `server/index.js` L7), dan spec saat ini tidak memanggil AI riil (di-mock, lihat `AI_E2E_STRATEGY.md`) |

> ⚠️ Env server dibaca **langsung dari `process.env`** (dotenv hanya fallback dari `server/.env`), jadi menyetel secret di GitHub Actions cukup — tidak perlu commit `.env`.

> 🛡️ Workflow punya **fail-fast guard**: bila `TURSO_DATABASE_URL`/`TURSO_AUTH_TOKEN` kosong, job `e2e` berhenti dengan pesan error yang jelas (bukan gagal di `/api/health` probe setelah 60s).

### Playwright browsers

`npx playwright install --with-deps chromium` — hanya Chromium yang diinstal (spec memakai Chromium default; `--with-deps` menyiapkan pustaka sistem Ubuntu).

## Artifacts

| Artifact | Kondisi | Isi |
|---|---|---|
| `playwright-report/` | `always()` | HTML report interaktif (reporter `html`, `open: never`) |
| `test-results/` | `failure()` | Trace (.zip), screenshot (error-context.png), video (retain-on-failure), error-context.md |

Retensi 14 hari. Trace Playwright diaktifkan per-test via `trace: 'retain-on-failure'` di config — berguna untuk debug race di CI yang tidak bisa direproduksi lokal.

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

1. **`npm run test:e2e` sebanyak 3× di CI** (stability gate) — bisa jadi job `stability` dengan loop shell; tambah saat suite > 20 test.
2. **Seed data CI-isolasi** — jalankan E2E terhadap Turso DB `file:` lokal (SQLite) yang di-seed dari `turso-schema.sql` + fixture, agar tidak menulis sesi test ke DB produksi. (Catatan: `mintSession` menulis baris `session` ke Turso; `cleanupTestSessions()` membersihkannya di akhir.)
3. **Visual regression + API contract** — setelah strategi di `VISUAL_REGRESSION_PLAN.md` / `API_CONTRACT_STRATEGY.md` diimplementasikan, tambah job terpisah (mis. `visual` dan `api-contract`) agar tidak memperlambat pipeline inti.
4. **`schedule` cron** — nightly full regression terhadap staging.
