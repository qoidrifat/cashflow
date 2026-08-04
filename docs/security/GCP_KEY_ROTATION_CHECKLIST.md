# GCP Key Rotation — Checklist (Blocker Critical Pra-Produksi)

> Status: **BELUM DIROTASI** (audit Phase-1, 2026-08-04) · Severity: **Critical** · Owner: pemilik akses GCP.
> Alasan: literal Google API key lama (format `AIzaSy…`, 39 karakter) pernah ada di git history (sebelum scrub). Tree sudah bersih + `.gitleaksignore` memfilter, **tapi key lama masih aktif** sebagai `GEMINI_API_KEY` di `server/.env` → siapa pun yang melihat history lama bisa menyalahgunakannya.

---

## Ringkasan apa yang sudah aman

| Aspek | Status |
|---|---|
| Tree git | ✅ 0 sisa key (`git grep` verified 2026-08-04) |
| Dokumen arsip | ✅ di-scrub → `<REDACTED>` (commit `6df3910`) |
| CI secret scan | ✅ Gitleaks full-history aktif (job `gitleaks`, v8.30.1) |
| **Key di server/.env** | ⚠️ **MASIH AKTIF — wajib rotasi** |
| History git | ⚠️ key lama tetap ada di history (hanya bisa dihapus via `git filter-repo` — opsional) |

---

## Langkah rotasi (lakukan di Google Cloud Console)

### 1. Buat key baru
1. Buka **Google Cloud Console** → project yang dipakai (`snappy-weft-479506-h5` — lihat `server/.env` `GCP_PROJECT_ID`).
2. Menu **APIs & Services → Credentials**.
3. **Create Credentials → API key** → **Restrict key**:
   - **API restrictions**: pilih *Generative Language API* (dan API lain yang dipakai).
   - **Website restrictions** (opsional): kosongkan **atau** pakai IP restriction — JANGAN referrer restriction (server-side call, akan kena "referer blocked", lihat `server/.env.example`).
4. Salin key baru (format `AIza...`).

### 2. Update `server/.env`
```
GEMINI_API_KEY=<KEY_BARU>
```
> ⚠️ JANGAN commit `server/.env` (sudah di-gitignore). Simpan key hanya di server.

### 3. Restart server & verifikasi
```bash
node server/index.js   # atau restart PM2/systemd
curl -s http://localhost:5181/api/gemini/health
# Harus: {"ok":true,"status":"ok","message":"Vertex AI Gemini model \"gemini-2.5-flash\" siap ..."}
```

### 4. Nonaktifkan key lama (paling penting!)
1. Kembali ke **Credentials** → klik key **lama**.
2. **Delete** key lama (jangan hanya edit). Verifikasi tombol hijau menjadi merah/"Deleted".

### 5. (Opsional) Ganti secret CI bila memakainya
- Jika `GEMINI_API_KEY` diset sebagai GitHub secret untuk spec AI → update di **Settings → Secrets → Actions** dengan key baru.

---

## Opsional: hapus key dari git history (`git filter-repo`)

Hanya bila ingin benar-benar membersihkan history (membutuhkan force-push, koordinasi kontributor):

```bash
pip install git-filter-repo   # atau brew install git-filter-repo
git filter-repo --replace-text <(echo 'AIzaSy<KEY_LAMA_PENUH>==>REDACTED')   # ganti dengan key penuh dari riwayat
# lalu: hapus entri terkait dari .gitleaksignore, push --force, dan re-run CI gitleaks
```
> Setelah filter-repo, **hapus entri `gcp-api-key` yang terkait dari `.gitleaksignore`** (yang tersisa 3 fingerprint key legacy di path lama `docs/review/*`, commit inisial `113563f2`) — komentar di `.gitleaksignore` sudah mencatat hal ini.

---

## Verifikasi akhir (setelah rotasi)

```bash
# 1. Tree bersih
git grep -l 'AIzaSy' -- '*.js' '*.ts' '*.tsx' '*.json' '*.md' || echo "OK: 0 sisa"

# 2. Health AI jalan dengan key baru
curl -s http://localhost:5181/api/gemini/health | grep '"ok":true'

# 3. CI gitleaks masih hijau (run workflow / re-run)
```

---

## Referensi
- Audit terkait: `docs/review/PHASE1_SECURITY_REVIEW.md` · `docs/review/PHASE1_PRODUCTION_READINESS.md` (PR-1)
- Setup Gemini: `SETUP_GEMINI_SERVER.md` · `server/.env.example`
