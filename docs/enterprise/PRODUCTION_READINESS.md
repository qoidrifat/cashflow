# CashFlow — Production Readiness Assessment

> Audit READ-ONLY · 2 Agustus 2026 · Evidence-based · Skor konsisten dengan `docs/audit/IMPLEMENTATION_AUDIT_REPORT.md` (sebelumnya 80/100 "with conditions", kondisi P2 terpenuhi 2026-08-02 → layak dievaluasi ulang).

---

## 1. Matriks Production Readiness

| Dimensi | Skor /10 | Bukti & Catatan |
|---|---|---|
| **Scalability** | 5.0 | Single Express process; SSE in-memory (`Map<userId, Set<Response>>`) → tidak survive restart/multi-instance; AI sync sequential; Turso mendukung scaling vertikal/horizontal tapi server tidak stateless |
| **Availability** | 5.5 | Health endpoints ada (`/api/health`, `/api/gemini/health`, `/api/agent-search/health`); tidak ada multi-instance/load balancer; fail-fast auth mencegah misconfig produksi |
| **Reliability** | 7.0 | authMiddleware retry+500 jujur; AI timeout race + model fallback; E2E 25 test 0 flaky; contract tests anti-drift; unit 57; tapi tanpa retry-backoff AI, tanpa circuit breaker |
| **Maintainability** | 8.0 | Route modules (P4.14), services terpisah, fixtures terpusat, README, docs audit; minus naming legacy + dual SDK |
| **Disaster Recovery** | 1.5 | ❌ Tidak ada backup Turso terjadwal, tidak ada restore runbook, tidak ada region strategy |
| **Backup** | 1.5 | ❌ Tidak ada (`*.db` di-gitignore; Turso snapshot tidak dijadwalkan) |
| **Rate Limiting** | 2.0 | ❌ Tidak ada `express-rate-limit`; hanya klasifikasi 429 dari Vertex (client-side) |
| **Secrets** | 8.5 | `.gitignore` ketat, audit staging 0 secret, fail-fast BETTER_AUTH_SECRET; minus `AGENT_SEARCH_USER_HASH_SALT` fallback dev + `VITE_TURSO_*` dead config |
| **Health Checks** | 7.5 | `/api/health` + AI health; tanpa healthcheck config container/load-balancer |
| **Graceful Shutdown** | 1.0 | ❌ Tidak ada handler SIGTERM/SIGINT (0 match) |
| **Retry Policy** | 5.5 | Model fallback + timeout; tanpa exponential backoff retry |
| **Circuit Breaker** | 2.0 | ❌ Tidak ada (fallback model adalah mini-circuit, bukan breaker stateful) |
| **Caching** | 2.5 | Hanya session cookieCache Better Auth (5m) + localStorage frontend; tanpa cache API/AI |
| **Horizontal Scaling** | 2.0 | Server stateful (SSE in-memory, vertexContext in-memory) → butuh refactor untuk scale out |
| **Cold Start** | 6.0 | Express boot cepat; Vertex init di boot (lazy konfigurasi warning); Turso HTTP serverless-friendly |
| **Cloud Cost** | 4.5 | Cost AI di-estimasi & dimonitor; tanpa budget cap/alert channel; Agent Search cost 0 (under-report) |

**Production Readiness Score: 4.4 / 10** (weighted; konsisten dengan kondisi-kondisi yang belum terpenuhi).

> **Konteks skor 80/100 (audit sebelumnya)**: skor itu untuk *implementasi plan* E2E + hardening auth yang selesai 100%. Skor ini berbeda dimensi — menilai *kesiapan operasional produksi* secara utuh (infra, backup, scale, observability), di mana gap besar justru di area non-kode: container, backup, rate-limit, graceful shutdown.

---

## 2. Kritikalitas Temuan

### 🔴 Critical (harus sebelum production launch)
1. **Tidak ada rate limiting** pada endpoint auth/AI/Gmail sync — risiko abuse & biaya (Vertex quota shared).
2. **Tidak ada backup Turso** — kehilangan data = kehilangan seluruh riwayat finansial user.
3. **Tidak ada graceful shutdown** — restart/deply memutus SSE & request in-flight tanpa drain.
4. **`AGENT_SEARCH_USER_HASH_SALT` fallback dev hardcoded** — bila produksi lupa set, hash user bisa direkonstruksi (pola `sha256(userId:salt)`), dan berubah bila salt di-set → data store jadi tidak match.

### 🟠 High
5. **Tidak ada structured logging / tracing** — debugging produksi sulit.
6. **SSE in-memory** — restart server putus koneksi semua client (EventSource reconnect, tapi state push hilang).
7. **Cloud Scheduler pengganti cron Gmail sync belum ada** — auto-sync hanya saat aplikasi aktif.
8. **Alert monitoring tanpa channel** — admin tidak tahu bila cost/error melonjak.

### 🟡 Medium
9. `VITE_TURSO_AUTH_TOKEN` deklarasi client (dead config, risiko bundle).
10. Dual Gemini SDK; envelope error heterogen.
11. Tidak ada SLO/SLI dashboard.
12. Dokumentasi lama Supabase/Firebase belum diarsip penuh.

---

## 3. Kondisi Wajib (Go/No-Go Checklist)

> **Update 2026-08-02 (Sprint 1 dieksekusi)**: 3 dari 4 Critical sudah ditutup — rate-limit + helmet (✅), graceful shutdown (✅), salt fail-fast (✅); backup (⚠️ script + dump 22 tabel berhasil, jadwal cron & restore drill belum).

| # | Kondisi | Status (2026-08-02) |
|---|---|---|
| 1 | `BETTER_AUTH_SECRET` kuat di produksi (fail-fast) | ✅ Terverifikasi (TEST A/B) |
| 2 | `useSecureCookies` true + HTTPS | ✅ Otomatis saat `NODE_ENV=production` |
| 3 | `trustedOrigins` berisi domain produksi | ⚠️ Ada env, perlu di-set |
| 4 | `AGENT_SEARCH_USER_HASH_SALT` di-set | ✅ **Fail-fast produksi + warning dev** (Sprint 1.4) |
| 5 | `TURSO_*` production credentials | ✅ |
| 6 | `ADMIN_EMAILS` production | ⚠️ Perlu di-set |
| 7 | Rate limiting aktif | ✅ **express-rate-limit**: general 5000/15m, auth POST 120/15m (GET session-read di-skip), AI 120/15m, receipt 30/15m — terverifikasi 429 (Sprint 1.1) |
| 8 | Backup terjadwal + restore test | ⚠️ **Script `backupTurso.mjs` + dump 22 tabel/1977 rows OK**; jadwal cron & restore drill belum (Sprint 1.3) |
| 9 | Healthcheck + graceful shutdown | ✅ **Graceful shutdown SIGTERM/SIGINT + drain SSE/Turso** (Sprint 1.2; terverifikasi di Linux/Cloud Run — Windows tidak mengirim POSIX signal); healthcheck container ❌ (belum ada Dockerfile) |
| 10 | Structured logging + error tracking | ❌ (Sprint 2 — observability) |

**Verdict: NOT READY penuh masih berlaku** (logging + Docker + backup jadwal tersisa), tapi 3/4 Critical telah ditutup — proyeksi skor 44 → ~58.

---

## 4. Roadmap Produksi (30/60/90 hari)

### 30 hari (P0–P1)
- express-rate-limit (auth + AI + sync endpoints) + helmet.
- Graceful shutdown (SIGTERM/SIGINT: stop SSE, tutup Turso client, drain 5s).
- Turso backup terjadwal (`turso db dump` → GCS, cron harian) + restore drill.
- Set salt produksi + verifikasi data store re-sync.

### 60 hari (P1–P2)
- pino structured logging + request-id middleware + sink Cloud Logging.
- Alert channel (email/webhook) dari `checkAlerts` + scheduler berkala.
- Cloud Run Job untuk background Gmail sync (pengganti cron Supabase).
- HTTP metrics middleware (4xx/5xx/p95) + SLO dashboard.

### 90 hari (P2–P3)
- Stateless server: SSE state → Redis/pub-sub (atau dokumenkan single-instance), AI gateway service terpisah.
- Container: Dockerfile multi-stage + docker-compose + deploy target (Cloud Run/GKE).
- Circuit breaker + cache layer AI.
- Horizontal scaling: 2+ instance server di belakang LB (Turso serverless siap).

---

## 5. Konklusi

Fondasi **kode** produksi kuat (auth hardened, testing 100%, modular, privacy-first metrics). Gap terbesar ada di **operasional**: container, backup, rate-limit, graceful shutdown, logging, dan cron sync pengganti. Dengan 4 fix Critical + 2 High, skor siap naik ke 7/10.
