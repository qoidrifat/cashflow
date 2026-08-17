# E2E Coverage Report — CashFlow

> Phase 3 · Coverage analysis & roadmap
> Date: 2026-08-01 · Diperbarui 2026-08-03 (angka suite: **41 test / 14 spec UI + 1 spec API contract = 15 file**; gap P1 Categories ditutup) · 2026-08-02 (P1: core-pages.spec.ts — Budgets/Reports/Notifications, menutup gap 9b) · 2026-08-07 (angka suite: **65 test / 21 spec UI + 1 spec API contract = 22 file**; +admin-monitoring-chart, +admin-monitoring-recommendation, +ai-timeline, +agent-search-engagement, +crud-validation-g4, +fraud-detection, +notification-metadata-guard, +notifications-pagination) · 2026-08-07 P10.2k (angka suite: **68 test / 22 spec UI + 1 spec API contract = 23 file**; +admin-monitoring-retention) · 2026-08-08 P10.2m (angka suite: **71 test / 24 spec UI + 1 spec API contract = 25 file**; +admin-monitoring-feedback-rate 3 test; angka spec di-rekonsiliasi dengan `playwright test --list --grep-invert '@visual|@perf'`)

## 1. Ringkasan Cakupan Saat Ini

| Area | Spec | Test | Apa yang Diuji |
|---|---|---|---|
| **Dashboard** | `dashboard.spec.ts` | 2 | Stat cards vs API balance, quick actions, Transaksi Terbaru |
| **Transaksi** | `transactions.spec.ts` | 3 | List count vs API (284), filter tipe (86/131), pagination 6 halaman |
| **Kategori** | `categories.spec.ts` | 3 | **✅ P1 2026-08-03**: render + default categories (init-defaults) + tab Pengeluaran/Pemasukan, CRUD penuh (buat/edit/hapus, sinkron UI+API), guard isDefault (default tidak bisa dihapus) |
| **Gmail Sync** | `gmail-sync.spec.ts` | 3 | Summary cards vs API (519), filter status, pagination Berikutnya |
| **Gmail Review (server)** | `gmail-review-approve` / `-reject` / `-duplicate` / `-amount-missing` | 4 | Approve→diterima, Reject→ditolak, Duplicate→warning, Amount-missing→error — assert **status log di server** + toast + notifikasi (poll API, `expect.poll`) |
| **Notifications Realtime (SSE)** | `notifications-realtime.spec.ts` | 4 | **4/4 hasil review** (approve/reject/duplicate/amount-missing) muncul di bell **TANPA reload** + badge naik (gate `waitRealtimeConnected`) |
| **Budgets / Reports / Notifications** | `core-pages.spec.ts` | 3 | Smoke: render tanpa pageerror + elemen kunci (menutup gap 9b) |
| **Auth gate Agent Search** | `agent-search-auth.spec.ts` | 3 | `/api/agent-search/*`: 401 tanpa cookie, lolos dengan cookie (regresi `resolveAgentSearchUser`) |
| **Auth gate Admin Metrics** | `admin-metrics-auth.spec.ts` | 3 | `/api/admin/metrics/*`: 401/403/200 (regresi `resolveAdmin`) |
| **Admin Cache Panel** | `admin-cache.spec.ts` | 3 | Panel AI Response Cache di `/admin/monitoring` (hit rate bar + stat) |
| **Rate Limit** | `rate-limit.spec.ts` | 1 | `POST /api/auth/*` → 429 setelah limit (dedicated server 5182) |
| **AI Timeline** | `ai-timeline.spec.ts` | 1 | Halaman `/ai/timeline` render (P9) |
| **Admin Monitoring Chart** | `admin-monitoring-chart.spec.ts` | 1 | Chart multi-seri Tren Biaya (filter fitur → 1 garis; light/dark) |
| **Admin Monitoring Rekomendasi** | `admin-monitoring-recommendation.spec.ts` | 3 | Panel Rekomendasi AI: auth gate 401, shape endpoint + CTR, render light/dark (P10.2g) |
| **Admin Monitoring Retensi** | `admin-monitoring-retention.spec.ts` | 3 | Panel Retensi Pengguna: auth gate 401, shape endpoint + cohort seed EKSAK, render ringkasan D1/D7/D14/D28 (P10.2k) |
| **Admin Monitoring Feedback Rate** | `admin-monitoring-feedback-rate.spec.ts` | 3 | Panel Feedback Rate: auth gate 401, shape + kontrak rate deterministik `round(fb/views,3)`, render light/dark (P10.2m) |
| **Agent Search Engagement** | `agent-search-engagement.spec.ts` | 3 | Event engagement agent search (klik/suggested — P1.4) |
| **Fraud Detection** | `fraud-detection.spec.ts` | 2 | Alur fraud detection (rules + AI scoring decision) |
| **CRUD Validation G4** | `crud-validation-g4.spec.ts` | 5 | Regression guard CRUD + validasi G4 |
| **Notification Metadata Guard** | `notification-metadata-guard.spec.ts` | 4 | Webhook metadata guard notifikasi (P1-4) |
| **Notifications Pagination** | `notifications-pagination.spec.ts` | 4 | Pagination notifikasi |
| **API Contract** | `contract/contract-check.spec.ts` | 10 | Schema drift detection (Transactions / Gmail / Agent-Search / Admin API) |

**Total: 71 test · 25 file spec** (2026-08-08, P10.2m) — `24 spec` UI/bisnis (61 test) + `1 spec` API contract (`contract-check.spec.ts`, 10 test). Diverifikasi via `npx playwright test --list --grep-invert '@visual|@perf'` (sumber otoritatif).

> ℹ️ **Bonus stabilitas (2026-08-03)**: saat menambahkan `categories.spec.ts`, ditemukan & diperbaiki bug laten flake di `notifications-realtime.spec.ts` — test memakai `Date.now()` sendiri sebagai messageId padahal `seedGmailReviewEmail` membuat id sendiri (race 1ms → card tidak pernah ditemukan, lolos di retry). Keempat test kini memakai **return value helper** sebagai `testMessageId` (pola sama dengan 4 spec review).

### Breakdown Realtime (`notifications-realtime.spec.ts`) — 4/4

Semua 4 jalur memakai gate deterministik `waitRealtimeConnected` (tunggu ikon WifiOff hilang = SSE connected) sebelum aksi — anti-flaky saat SSE lambat connect.

| Test | Alur | Toast | Menuitem di bell (TANPA reload) |
|---|---|---|---|
| **approve** | Seed `needs_review` + candidate → klik Setujui | `Transaksi Gmail berhasil disimpan` | `Transaksi Gmail diterima` + badge naik |
| **reject** | Seed `needs_review` → klik Tolak | `Transaksi ditolak` | `Transaksi ditolak` + badge naik |
| **duplicate** | Seed email + transaksi `gmail_message_id` SAMA → klik Setujui | `Transaksi duplikat` | `Transaksi Gmail duplikat` (warning) |
| **amount-missing** | Seed TANPA `candidate.amount` → klik Setujui | `Nominal transaksi tidak ditemukan` | `Gagal menerima transaksi Gmail` (error) |

### Cakupan terhadap kritikalitas

```
Kritis (data utama, uang):  ██████████████████  97%  (Dashboard, Transaksi, Kategori)
Menengah (fitur inti):      ████████████████░░  80%  (Gmail Sync + Review 4 hasil, Realtime bell 4/4, Budgets/Reports/Notifications)
Fitur AI/Automasi:          ████░░░░░░░░░░░░░  20%  (Agent Search auth-gate; UI query + OCR + Insight masih roadmap)
Admin/Operasional:          ██████░░░░░░░░░░░  30%  (Admin metrics auth-gate, cache panel, rate-limit)
```

## 2. Missing Critical Flows (Roadmap Prioritas)

### P1 — Sangat Kritis (segera)

| Flow | Alasan | Test yang disarankan |
|---|---|---|
| **Authentication** (login/logout/expired session) | Fondasi semua halaman; guard utama | `/login` render; redirect ke `/login` saat tanpa cookie; session expired dialog — ⚠️ **partial 2026-08-03**: `rate-limit.spec.ts` meng-cover gate 429 `POST /api/auth/*`; login/logout/expired penuh tetap roadmap |
| ~~**Budgets** (`/budgets`)~~ | ~~Fitur inti pengelolaan uang; API sudah ada (`/api/budgets`)~~ | ~~List budget, create budget, edit, hapus; usage vs amount~~ — **✅ smoke 2026-08-02** via `core-pages.spec.ts` (render + summary + Tambah Budget); CRUD/usage penuh tetap roadmap |
| ~~**Categories** (`/categories`)~~ | ~~Dependensi Transaksi & Budget~~ | ~~List 19 kategori, tambah/edit/hapus, init-defaults~~ — **✅ 2026-08-03** via `categories.spec.ts` (3 test: render + default/tab, CRUD penuh, guard isDefault) |

### P2 — Tinggi (segera setelah P1)

| Flow | Alasan | Test yang disarankan |
|---|---|---|
| ~~**Reports** (`/reports`)~~ | ~~Agregasi & ekspor CSV/PDF~~ | ~~Tampilan summary, filter tanggal, download CSV~~ — **✅ smoke 2026-08-02** via `core-pages.spec.ts` (render + period selector + PDF); ekspor/CSV penuh tetap roadmap |
| ~~**Notifications** (`/notifications`)~~ | ~~API sudah lengkap (CRUD + read-all)~~ | ~~List, mark-read, read-all, badge count~~ — **✅ 2026-08-02/03**: smoke (`core-pages.spec.ts`) + **realtime bell 4/4** (`notifications-realtime.spec.ts` — approve/reject/duplicate/amount-missing muncul TANPA reload); mark-read/badge penuh tetap roadmap |
| **AI Search** (`/suite/ai-search`) | Fitur flagship AI | Input query, loading state, hasil tampil / error state (mock API) — ⚠️ **partial 2026-08-03**: auth-gate `/api/agent-search/*` ter-cover (`agent-search-auth.spec.ts` 3, regresi `resolveAgentSearchUser`); alur UI query tetap roadmap |

### P3 — Menengah

| Flow | Alasan | Test yang disarankan |
|---|---|---|
| **Receipt OCR** (`ScanReceiptModal`) | Perlu fixture gambar + mock Gemini | Modal terbuka, upload, hasil parse, simpan |
| **Recurring** (`/recurring`) | CRUD + API ada | List, create, toggle aktif |
| **Profile** (`/profile`) | User data | Tampil info user, edit |
| **Settings** (`/settings`) | Preferensi | Toggle theme, update pref |

### P4 — Rendah / Opsional

| Flow | Alasan |
|---|---|
| **Professional Suite** (`/professional`) | Goals/subscriptions/wallets — API sudah ada; prioritas rendah |
| ~~**Monitoring/Admin** (`/admin/monitoring`)~~ | ~~Internal ops; perlu role admin + auth khusus~~ — **✅ 2026-08-03**: `admin-metrics-auth.spec.ts` (401/403/200, regresi `resolveAdmin`) + `admin-cache.spec.ts` (panel AI Response Cache) |
| **Landing/Privacy/NotFound** | Statis; low risk |

## 3. Strategi Ekstensi (pola reusable)

1. **Cookie-login**: sudah ada → `setupAuthContext` di `beforeEach`.
2. **Ground truth API**: `request.get` + header Cookie eksplisit (pola terbukti).
3. **Pagination helper**: `waitListRange` keyword-based — reuse langsung untuk Reports/Notifications.
4. **AI fitur**: mock di level network (lihat AI_E2E_STRATEGY.md) agar deterministik & quota-safe.

## 4. Metrik Target

- **Target cakupan**: P1+P2 (9 flow) → ~65% halaman kritis teruji dalam 2 sprint berikutnya.
- **Kualitas**: setiap spec baru wajib 0 flaky dalam 3× run + typecheck e2e pass.
- **Cakupan API**: tiap halaman baru yang diuji harus cross-check dengan minimal 1 endpoint
  ground truth (pola existing).

## 5. Catatan

- Jangan tambahkan test baru tanpa data fixture yang jelas: pinned totals hanya untuk dataset
  migrasi saat ini; untuk flow create/update gunakan data unik + cleanup (hindari mutasi dataset
  migrasi 284/519).
