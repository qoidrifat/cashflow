# CI Troubleshooting

> **Date:** 2026-08-06 · **Author:** DevOps audit (Sprint 0.7)
> **Scope:** diagnosis kegagalan CI berbasis evidence — bukan tebakan
> **Goal:** Setiap kegagalan bisa di-root-cause dari log/artifacts

---

## 0. Cara Diagnosis (umum)

1. **Job mana yang merah?** `curl -s https://api.github.com/repos/qoidrifat/cashflow/actions/runs/<RUN>/jobs` (public API, tanpa auth).
2. **Step mana?** Annotations check-run:
   ```bash
   curl -s https://api.github.com/repos/qoidrifat/cashflow/check-runs/<JOB_ID>/annotations
   ```
   Pola annotation berguna: *"Process completed with exit code 1"* + *"No files were found with the provided path: test-results/"*.
3. **Artifacts kosong (`playwright-report/` & `test-results/` tidak ada)?** → suite TIDAK pernah jalan — kegagalan di step SEBELUM Playwright (seed/setup/schema), bukan test. Cek step seed.
4. **Log API 403 (butuh admin)?** → lihat halaman run di browser (`github.com/…/actions/runs/<RUN>`) — step list + verdict terlihat; untuk log penuh butuh akses admin/`gh`.

## 1. Flake: Step "Seed E2E dataset" exit 1 (SEBELUM 2026-08-06)

**Gejala:** run E2E merah, artifacts kosong, gagal di step seed — intermittent (4/5 run hijau).

**Root cause (bukti):** seed versi lama = ±870 INSERT sekuensial via `execute()` (1 request HTTP per baris). Seed lokal 100s; di CI shared runner 2–4 menit. Satu error transient (network/TLS/429 Turso) → job mati, tanpa retry.

**Fix (Sprint 0.7, commit terpisah):** batching `client.batch()` chunk 100 → 10 batch (100s → 4.3s) + retry exponential backoff HANYA untuk error transient + `ON CONFLICT` defensif + error context. Detail: [SEED_DATABASE_GUIDE.md](SEED_DATABASE_GUIDE.md) §4.

**Jika masih terjadi setelah fix:** cek pesan error di log step seed. Bila constraint (`UNIQUE`) → bug data deterministik (jangan retry); bila network/429 → pastikan retry aktif & Turso sehat.

> **Retry juga aktif di jalur lain (sejak 2026-08):** step **'Apply Turso schema'** (commit `05cc914`) dan **boot server produksi** (`initTursoSchema({retry:true})`, commit `31c892e`) memakai retry transien dari satu sumber kebenaran `server/lib/retry.js`. Konsekuensi diagnosis: transient persisten di apply → **exit non-zero** (bukan sukses palsu); di boot → **log error** (bukan senyap). Runtime query sengaja TANPA retry (writes non-idempoten → risiko double-commit) — lihat [TURSO_RUNTIME_RETRY_AUDIT.md](../review/TURSO_RUNTIME_RETRY_AUDIT.md).

> **Selalu aman re-run seed dari state parsial apa pun** — seed idempoten (delete-then-insert untuk user seed). Bila seed gagal di tengah flush, job cukup di-re-run; tidak ada manual cleanup yang diperlukan.

## 2. Sejarah: `UNIQUE constraint failed: users.email` (commit 60ab972)

**Gejala:** seed gagal konsisten (14 run) setelah cleanup sesi lama menghapus & membuat ulang baris `user` (singular) dengan id baru, sementara `users` (plural) tetap id lama → INSERT `users` konflik email.

**Root cause:** desync id singular/plural. **Fix:** normalisasi user seed (pilih satu id, hapus baris desync + data bisnis kedua id, re-insert). Sudah tertutup.

## 3. E2E gagal massal setelah upgrade Playwright

**Gejala:** banyak test error "browser not found / executable doesn't exist", atau error context kosong.

**Root cause:** versi Playwright baru butuh binary browser baru; cache `actions/cache` key berbasis `package-lock.json` → seharusnya invalidate otomatis, tapi lokal/CI yang belum install akan gagal.

**Fix:**
```bash
npx playwright install chromium
```

## 4. Flake: Performance Budget (pagination/requests)

**Gejala:** `PERF_BUDGET_PAGINATION_HARD_MS` atau `PERF_BUDGET_MAX_REQUESTS` merah sekali-sekali.

**Root cause (bukti):** Vite DEV mode = 1 request per modul ESM (41–65 unique/page, fluktuasi module graph + HMR `?t=` revalidate di runner shared); pagination 3.0–5.1s lokal vs budget hard 12s. Budget dikalibrasi dari data nyata (margin ~3–15×), bukan tebakan.

**Aturan:** budget TIDAK dilemahkan tanpa persetujuan. Pola:
1. Re-run job (stability gate 3× sudah menoleransi 1–2 attempt gagal).
2. Bila 3× gagal berturut → regresi riil: cek bundle bloat, N+1 query, index hilang, latensi Turso.
3. Lihat artifact `perf-reports` (JSON) untuk trend historis.

## 5. Playwright E2E job merah tapi artifacts kosong

Sudah tercakup §1 — selalu cek dulu apakah suite benar-benar jalan:

| Temuan di annotations | Artinya | Aksi |
|---|---|---|
| `No files found: playwright-report/` + `test-results/` | suite tak pernah jalan | cek seed/setup/schema step |
| Ada report + traces | suite jalan, test gagal | baca error-context.md per test |
| `stability-attempt-*` ada | flake forensics tersimpan | bandingkan attempt gagal vs lulus |

## 6. Run di-cancel oleh PR dependabot

**Gejala:** run push di-cancel (concurrency group).

**Root cause (sejarah):** PR dependabot masuk group `e2e` yang sama + `cancel-in-progress` → membatalkan run push sah.

**Fix (sudah):** dependabot di-group terpisah (`e2e-dependabot`) + hanya quality/gitleaks (tanpa DB). JANGAN ubah group menjadi per-ref (push & PR normal tetap harus serial — DB bersama).

## 7. Troubleshooting workflow umum

- **YAML invalid:** validasi lokal `python -c "import yaml; yaml.safe_load(open('.github/workflows/e2e.yml'))"`.
- **Node 20 warnings:** harus 0 sejak migrasi v5/v6 (Node 24). Kalau muncul lagi → cek versi action tidak di-downgrade Dependabot.
- **Pages gagal (Liquid error):** pastikan `.nojekyll` ada di root.
- **Unit test timeout** (contoh: `storeSubscriptionGuard`): scan fs rekursif bisa >5s di FS dingin — timeout test sudah dilonggarkan ke 15s (bukan melemahkan guard).
