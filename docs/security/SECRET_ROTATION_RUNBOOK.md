# Runbook Rotasi Secret (Deploy Gate Audit 2026-09-04)

Konteks: hasil audit end-to-end (`file.md`) menemukan secret terekspos di
plaintext (`server/.env` lokal, log). Halaman ini adalah langkah rotasi
presisi per secret. Semua file `.env` TIDAK pernah di-commit (`gitignore`).

## Status ringkas

| Secret | Pemakaian di runtime | Status | Biaya |
|---|---|---|---|
| `BETTER_AUTH_SECRET` | `server/lib/auth.js` — menandatangani cookie sesi | ✅ SUDAH dirotasi (64-char crypto-random, di `server/.env`) | Gratis |
| `GEMINI_API_KEY` | **TIDAK ADA** (dead config; AI via service-account Vertex) | ✅ DIHAPUS dari `server/.env` | Gratis |
| `BETTER_AUTH_API_KEY` | **TIDAK ADA** (dead config, 0 reader) | ✅ DIHAPUS dari `server/.env` | Gratis |
| `TURSO_AUTH_TOKEN` | `server/lib/turso.js`, `server/lib/auth.js` | ✅ SUDAH dirotasi 16:52 2026-09-04 — token baru exp **2027-09-04** (365 hari); helper fail-closed sukses; boot + health + schema verify OK | Done |
| `GOOGLE_CLIENT_SECRET` | `server/lib/auth.js` (OAuth Google) | ⏳ Wajib akses GCP Console — lihat §2 | Gratis |

Efek samping yang DIHARAPKAN setelah rotasi `BETTER_AUTH_SECRET`: semua sesi
lama tidak valid (cookie ditandatangani secret lama) → user harus login ulang.
Ini perilaku benar, bukan bug.

---

## 1. TURSO_AUTH_TOKEN

**Kendala otomatisasi:** CLI `turso` tidak terpasang di mesin ini, dan pembuatan
token butuh akun Turso. Helper sudah disiapkan agar setelah token baru didapat,
sisanya satu perintah.

**Langkah:**

1. Install CLI (sekali): `npm i -g @turso/turso`
2. Login: `turso auth login` (buka browser, gratis)
3. Buat token baru berbatas waktu (disarankan 90 hari):
   ```bash
   turso db tokens create cashflow-ryukinoir --expiration 90d
   ```
   Salin output (JWT `eyJ...`).
4. Swap + uji otomatis (fail-closed: token diuji ke DB dulu, `.env` hanya
   diganti bila valid):
   ```bash
   node scripts/rotate-turso-token.mjs <TOKEN_BARU>
   ```
5. Revoke token lama (WAJIB — kalau tidak, secret bocor masih hidup):
   ```bash
   turso db tokens list cashflow-ryukinoir     # lihat nama token lama
   turso db tokens invalidate cashflow-ryukinoir <nama-token-lama>
   ```
   Bila memakai platform API: `POST https://api.turso.tech/v1/databases/
   cashflow-ryukinoir/tokens` dengan Platform API token (Dashboard →
   Account → API Tokens → Create).
6. Verifikasi: `npm run dev:server` → `curl http://localhost:5181/api/health`
   → `"ok":true`.

## 2. GOOGLE_CLIENT_SECRET

1. Buka https://console.cloud.google.com → pilih project
   `snappy-weft-479506-h5` → **APIs & Services → Credentials**.
2. **OAuth 2.0 Client IDs** → klik client
   `128646662860-6u58ieif5u5fl1e473744ns4co1jupcb...`.
3. Klik **Reset secret** (atau "Regenerate") → salin secret baru
   (`GOCSPX-...`).
4. Edit `server/.env` → ganti nilai `GOOGLE_CLIENT_SECRET=` dengan yang baru.
5. Verifikasi: restart server → buka `http://localhost:5180/login` →
   "Masuk dengan Google" → login sukses.
6. (Disarankan) Kunci konfigurasi: pastikan *Authorized redirect URIs* hanya
   memuat `http://localhost:5181/api/auth/callback/google` (dev) + domain
   produksi — hapus URI yang tidak dikenal.

Catatan: Google mempertahankan secret lama selama masih dipakai sampai
direset kedua kali — cukup reset sekali, simpan nilai baru, lalu reset lagi
bila ingin memastikan nilai lama benar-benar mati.

## 3. BETTER_AUTH_SECRET (sudah selesai — untuk arsip)

```bash
node -e "console.log(require('crypto').randomBytes(48).toString('base64url'))"
```
Nilai 64-char sudah ditulis ke `server/.env` sebagai `BETTER_AUTH_SECRET=`.
Rotasi berikutnya cukup ulangi perintah ini + ganti nilainya + restart server.
PANJANG MINIMAL 32 char dipaksa fail-fast di produksi (`server/lib/auth.js`).

## 4. Dead config yang dihapus (arsip)

- `GEMINI_API_KEY` — 0 reader runtime (`process.env.GEMINI_API_KEY` tidak pernah
  dibaca; AI memakai service-account Vertex AI). Dua nilai lama yang terekspos
  dihapus, bukan dirotasi.
- `BETTER_AUTH_API_KEY` — 0 reader di `server/`, `scripts/`, `e2e/`.
- `GEMINI_HTTP_REFERER` — 0 reader runtime.

## Checklist selesai

- [x] `BETTER_AUTH_SECRET` dirotasi & terpasang
- [x] Dead config dihapus (permukaan bocor berkurang)
- [x] Helper rotasi Turso siap (`scripts/rotate-turso-token.mjs`, fail-closed)
- [x] TURSO_AUTH_TOKEN dirotasi 2026-09-04 (exp 2027-09-04) — sisa: revoke token lama bila masih listed di CLI (`turso db tokens invalidate`), atau biarkan mati sendiri
- [ ] GOOGLE_CLIENT_SECRET: reset di GCP Console → update `.env` → verifikasi login
- [x] Semua langkah: `git status` tetap bersih (`.env` gitignored, tidak pernah ter-commit)
