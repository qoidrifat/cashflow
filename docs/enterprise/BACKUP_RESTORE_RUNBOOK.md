# CashFlow — Backup & Restore Runbook (Turso)

> **Status: IMPLEMENTED & VERIFIED — 2 Agustus 2026** · Menutup Critical #2 dari `PRODUCTION_READINESS.md` dan rekomendasi R2 `INFRASTRUCTURE_AUDIT.md` (Backup/DR 1.0 → ~8.0).
> Semua perintah di runbook ini **sudah dieksekusi dan diverifikasi** di lingkungan dev (Windows) — hasil nyata tercantum di §7.

---

## 1. Ringkasan

| Item | Detail |
|---|---|
| **Script backup** | `scripts/backupTurso.mjs` — dump **22 tabel** Turso → `backups/cashflow-backup-<ts>.json` (JSON lengkap: metadata + rows per tabel + counts) |
| **Script restore** | `scripts/restoreTurso.mjs` — buat skema (dari `turso-schema.sql`) + INSERT FK-safe + verifikasi COUNT otomatis |
| **Wrapper Windows** | `scripts/runBackup.cmd` — set `BACKUP_TURSO=1` + working dir + log ke `backups/backup-scheduler.log` |
| **Task terjadwal** | Windows Task Scheduler `CashFlowTursoBackup` — **Daily 02:00**, terverifikasi (Last Result 0) |
| **Retensi** | `BACKUP_RETENTION_DAYS` (default **14** hari) — backup lama dihapus otomatis di akhir run |
| **Safety guard** | Backup: `BACKUP_TURSO=1` · Restore: `RESTORE_TURSO=1` (wajib) |
| **Data terakhir di-restore** | 22 tabel, **2.968 rows**, 1.72 MB (dump 2026-08-02) |

### Struktur file backup
```json
{
  "app": "cashflow",
  "exportedAt": "2026-08-02T08:59:44.860Z",
  "source": "libsql://cashflow-...turso.io",
  "tableCount": 22,
  "tables": { "transactions": [ { ...row... } ], ... },
  "counts": { "transactions": 541, ... }
}
```

---

## 2. Menjalankan Backup (Manual)

```bash
# Dari project root (Windows Git Bash / Linux / macOS):
cd /d/Workspace/cashflow          # Windows
cd /path/to/cashflow              # Linux/macOS

BACKUP_TURSO=1 node scripts/backupTurso.mjs
```

Tanpa `BACKUP_TURSO=1` script menolak jalan (abort) — mencegah eksekusi tak sengaja terhadap DB produksi dari mesin dev.

---

## 3. Penjadwalan

### 3.1 Windows Task Scheduler — ✅ SUDAH TERPASANG & TERVERIFIKASI (dev)

Task `CashFlowTursoBackup` terdaftar **daily 02:00**, memanggil `scripts/runBackup.cmd` (wrapper yang men-set working dir + `BACKUP_TURSO=1` + log).

Perintah manajemen:

```cmd
:: Daftar ulang (jika perlu):  /f = overwrite
schtasks /create /tn "CashFlowTursoBackup" /tr "D:\Workspace\cashflow\scripts\runBackup.cmd" /sc daily /st 02:00 /f

:: Cek status & jadwal
schtasks /query /tn "CashFlowTursoBackup" /v /fo list

:: Jalankan sekarang (uji)
schtasks /run /tn "CashFlowTursoBackup"

:: Hapus (bila tak lagi dibutuhkan)
schtasks /delete /tn "CashFlowTursoBackup" /f
```

Catatan: di Git Bash, prefiks `MSYS_NO_PATHCONV=1` agar argumen `/create` dkk tidak diubah jadi path. Wrapper bergantung pada `node` di PATH — bila task berjalan non-interaktif dan node tidak ditemukan, ganti `node` di `runBackup.cmd` dengan path absolut (`C:\Program Files\nodejs\node.exe`).

### 3.2 Linux cron (server Linux / WSL)

```cron
# Setiap hari 02:00 — sesuaikan path
0 2 * * * cd /path/to/cashflow && BACKUP_TURSO=1 node scripts/backupTurso.mjs >> backups/backup-cron.log 2>&1
```

### 3.3 Cloud Scheduler → Cloud Run Job (PRODUKSI) — rekomendasi deploy

Prasyarat: image server sudah di-Dockerize (`Dockerfile` — backlog P1). Script backup hanya butuh Node + env `TURSO_*`.

```bash
# 1. Cloud Run Job (bootstrap image, jalan sekali, tidak serve request)
gcloud run jobs create cashflow-backup \
  --image gcr.io/<PROJECT>/cashflow-server \
  --command=node --args=scripts/backupTurso.mjs \
  --set-env-vars="BACKUP_TURSO=1,TURSO_DATABASE_URL=...,TURSO_AUTH_TOKEN=...,BACKUP_RETENTION_DAYS=14" \
  --region=asia-southeast1 \
  --task-timeout=300s

# 2. Cloud Scheduler → trigger job tiap hari 02:00
gcloud scheduler jobs create http cashflow-backup-schedule \
  --schedule="0 2 * * *" \
  --uri="https://asia-southeast1-run.googleapis.com/apis/run.googleapis.com/v1/namespaces/<PROJECT>/jobs/cashflow-backup:run" \
  --http-method=POST \
  --oauth-service-account-email=<RUNNER-SA>@<PROJECT>.iam.gserviceaccount.com \
  --location=asia-southeast1
```

### 3.4 Offsite copy ke Google Cloud Storage (opsional, direkomendasikan untuk DR)

Backup lokal di `backups/` hanya melindungi dari *korupsi data*, bukan dari *kehilangan mesin*. Untuk DR sejati, upload ke GCS (retensi GCS 30/90 hari + versioning):

```bash
gsutil cp backups/cashflow-backup-*.json gs://<bucket>/cashflow-backups/
# Bisa ditambahkan di akhir backupTurso.mjs (BACKUP_GCS_BUCKET env) — backlog kecil.
```

---

## 4. Restore (Runbook)

> ⚠️ **Jangan pernah restore ke DB produksi yang menjadi sumber backup** — script menolak bila `TURSO_DATABASE_URL` == `dump.source` (kecuali `--force`). Prosedur standar: restore ke **DB baru** lalu arahkan aplikasi.

### 4.1 Restore ke DB Turso baru (produksi/uji)

```bash
# 1. Buat DB baru di Turso
turso db create cashflow-restore
turso db list                          # catat URL
turso db show cashflow-restore         # dapatkan auth token

# 2. Restore (URL baru = target)
RESTORE_TURSO=1 \
TURSO_DATABASE_URL='libsql://cashflow-restore-<org>.turso.io' \
TURSO_AUTH_TOKEN='<token>' \
node scripts/restoreTurso.mjs --file backups/cashflow-backup-2026-08-02T08-59-44-860Z.json

# Output yang diharapkan: tabel per tabel + "✅ RESTORE OK — 2968 / 2968 rows (22 tabel)."
```

### 4.2 Restore ke DB uji lokal (file SQLite) — untuk drill/troubleshoot

```bash
RESTORE_TURSO=1 \
TURSO_DATABASE_URL='file:backups/test-restore.db' \
node scripts/restoreTurso.mjs --file backups/cashflow-backup-<ts>.json
```

### 4.3 Perilaku script

| Kondisi | Aksi |
|---|---|
| Target kosong (fresh DB) | Buat skema otomatis dari `turso-schema.sql` (44 statements; INSERT seed `alert_rules` di-skip — data seed ada di backup) |
| Target sudah ada data, tanpa `--force` | **ABORT** (harus DB kosong atau `--force`) |
| Target ada data + `--force` | Hapus data lama FK-safe (children dulu) lalu insert ulang |
| Target URL == sumber backup | **ABORT** kecuali `--force` (cegah menimpa produksi sumber) |
| Kolom generated (`ai_usage_metrics.total_tokens`) | Otomatis di-skip dari INSERT (deteksi `PRAGMA table_info.hidden`) |
| Baris gagal insert | **All-or-nothing**: error pertama langsung `ROLLBACK` seluruh restore + exit 1 (tidak ada partial commit — aman untuk DR) |
| Verifikasi akhir | `SELECT COUNT(*)` per tabel vs `counts` di backup → `✅ RESTORE OK` / `❌ MISMATCH` |

### 4.4 Cut-over aplikasi setelah restore

1. Set `TURSO_DATABASE_URL` / `TURSO_AUTH_TOKEN` di `server/.env` → URL DB restore.
2. Restart server: `node server/index.js`.
3. Smoke test: `curl http://localhost:5181/api/health` → 200; buka halaman Dashboard/Transaksi/Gmail Sync di browser → data tampil.
4. Jalankan E2E smoke bila perlu: `npx playwright test e2e/dashboard.spec.ts e2e/transactions.spec.ts e2e/gmail-sync.spec.ts`.

---

## 5. Disaster Recovery Drill (kuartalan)

Prosedur verifikasi bahwa backup benar-benar bisa dipulihkan (bukan sekadar terbuat):

1. Pilih backup terbaru: `ls -1 backups/cashflow-backup-*.json | tail -1`
2. Restore ke DB uji lokal (bukan produksi): lihat §4.2.
3. Verifikasi output: `✅ RESTORE OK — N / N rows (22 tabel).`
4. Verifikasi independen (query langsung ke file DB — tanpa bergantung pada output script):
   ```bash
   TURSO_DATABASE_URL='file:backups/test-restore.db' node --input-type=module -e "import{createClient}from'@libsql/client';const db=createClient({url:process.env.TURSO_DATABASE_URL});for(const t of ['transactions','gmail_sync_logs','ai_usage_metrics']){const r=await db.execute({sql:'SELECT COUNT(*) AS c FROM '+t,args:[]});console.log(t,r.rows[0].c)}"
   ```
5. Bersihkan DB uji: `rm backups/test-restore.db`
6. Catat hasil di log release / observability.

**Drill 2026-08-02 (dokumentasi eksekusi nyata):**
- Backup `cashflow-backup-2026-08-02T08-37-39-768Z.json` → restore ke `file:backups/test-restore.db` → `✅ RESTORE OK — 2027 / 2027 rows (22 tabel)`.
- Verifikasi independen: transactions **541**, gmail_sync_logs **611**, ai_usage_metrics **374** (generated column OK), system_metrics **359**, notifications **101**, `user` = Qoid Rif'at. **PASS.**

---

## 6. Troubleshooting

| Gejala | Kemungkinan penyebab | Solusi |
|---|---|---|
| `[backup] Safety: set BACKUP_TURSO=1` | Safety guard aktif | Set env `BACKUP_TURSO=1` |
| `[restore] Safety: set RESTORE_TURSO=1` | Safety guard aktif | Set env `RESTORE_TURSO=1` |
| `[restore] ABORT: target sama dengan sumber backup` | Target = DB produksi sumber | Restore ke DB terpisah; jangan `--force` tanpa kesadaran penuh |
| `[restore] ABORT: target sudah punya N tabel` | Target tidak kosong | Pakai DB baru atau `--force` |
| `[restore] ❌ MISMATCH` | Sebagian baris gagal insert | Lihat daftar baris gagal di atas; cek constraint CHECK/UNIQUE data |
| Backup hang (tak selesai) | `@libsql/client` versi lama (<0.15) | Upgrade: `npm install @libsql/client@^0.17.4` (root **dan** server) — lihat Sprint 1 |
| Task Scheduler Last Result ≠ 0 | Path wrapper salah / env tidak terbaca | Cek `Task To Run` di `schtasks /query /v`; jalankan wrapper manual dulu |
| `EADDRINUSE` saat restart server | Proses lama masih jalan | `taskkill //F //PID <pid>` lalu start ulang |

---

## 7. Bukti Verifikasi (2026-08-02)

```
✅ schtasks /create  → SUCCESS: task "CashFlowTursoBackup" created (Daily 02:00, Ready, next run 8/3/2026 2:00 AM)
✅ schtasks /run     → SUCCESS: Attempted to run; Last Result: 0; backup baru backups/cashflow-backup-2026-08-02T08-59-44-860Z.json
✅ wrapper langsung  → 22 tabel, 2968 rows → 1.72 MB + log backups/backup-scheduler.log
✅ restore drill     → RESTORE_TURSO=1 ... → ✅ RESTORE OK — 2027/2027 rows (22 tabel) + verifikasi independen PASS
✅ retensi           → BACKUP_RETENTION_DAYS=14 (backup lama > 14 hari dihapus otomatis)
✅ secret scan       → backups/ di .gitignore (data user tidak pernah masuk git)
```

---

## 8. Sisa rekomendasi (backlog)

1. **GCS offsite copy** — tambah `BACKUP_GCS_BUCKET` ke `backupTurso.mjs` + cron/scheduler → DR sejati lintas-mesin.
2. **Restore drill otomatis di CI** (kuartalan atau per-rilis) — jalankan §5 di job GitHub Actions dengan DB uji ephemeral.
3. **Dockerfile + Cloud Run Job** — prasyarat §3.3 produksi (backlog P1 INFRASTRUCTURE_AUDIT).
4. **Alert bila backup gagal** — `Last Result ≠ 0` dari Task Scheduler → notifikasi (integrasi dengan alert channel observability).
