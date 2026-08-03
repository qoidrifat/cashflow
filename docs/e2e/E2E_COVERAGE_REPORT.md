# E2E Coverage Report — CashFlow

> Phase 3 · Coverage analysis & roadmap
> Date: 2026-08-01 · Diperbarui 2026-08-03 (angka suite: **38 test / 13 spec UI + 1 spec API contract = 14 file**; breakdown realtime **4/4**) · 2026-08-02 (P1: core-pages.spec.ts — Budgets/Reports/Notifications, menutup gap 9b)

## 1. Ringkasan Cakupan Saat Ini

| Area | Spec | Test | Apa yang Diuji |
|---|---|---|---|
| **Dashboard** | `dashboard.spec.ts` | 2 | Stat cards vs API balance, quick actions, Transaksi Terbaru |
| **Transaksi** | `transactions.spec.ts` | 3 | List count vs API (284), filter tipe (86/131), pagination 6 halaman |
| **Gmail Sync** | `gmail-sync.spec.ts` | 3 | Summary cards vs API (519), filter status, pagination Berikutnya |
| **Gmail Review (server)** | `gmail-review-approve` / `-reject` / `-duplicate` / `-amount-missing` | 4 | Approve→diterima, Reject→ditolak, Duplicate→warning, Amount-missing→error — assert **status log di server** + toast + notifikasi (poll API, `expect.poll`) |
| **Notifications Realtime (SSE)** | `notifications-realtime.spec.ts` | 4 | **4/4 hasil review** (approve/reject/duplicate/amount-missing) muncul di bell **TANPA reload** + badge naik (gate `waitRealtimeConnected`) |
| **Budgets / Reports / Notifications** | `core-pages.spec.ts` | 3 | Smoke: render tanpa pageerror + elemen kunci (menutup gap 9b) |
| **Auth gate Agent Search** | `agent-search-auth.spec.ts` | 3 | `/api/agent-search/*`: 401 tanpa cookie, lolos dengan cookie (regresi `resolveAgentSearchUser`) |
| **Auth gate Admin Metrics** | `admin-metrics-auth.spec.ts` | 3 | `/api/admin/metrics/*`: 401/403/200 (regresi `resolveAdmin`) |
| **Admin Cache Panel** | `admin-cache.spec.ts` | 3 | Panel AI Response Cache di `/admin/monitoring` (hit rate bar + stat) |
| **Rate Limit** | `rate-limit.spec.ts` | 1 | `POST /api/auth/*` → 429 setelah limit (dedicated server 5182) |
| **API Contract** | `contract/contract-check.spec.ts` | 9 | Schema drift detection (Transactions / Gmail / Agent-Search / Admin API) |

**Total: 38 test · 14 file spec · 0 failure · 0 flaky (3× run berurutan, 2026-08-03)** — `13 spec` UI/bisnis + `1 spec` API contract (`contract-check.spec.ts`, 9 test). Diverifikasi via `npx playwright test --list --grep-invert '@visual|@perf'` (sumber otoritatif).

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
Kritis (data utama, uang):  █████████████████░  95%  (Dashboard, Transaksi)
Menengah (fitur inti):      ███████████████░░░  75%  (Gmail Sync + Review 4 hasil, Realtime bell 4/4, Budgets/Reports/Notifications)
Fitur AI/Automasi:          ████░░░░░░░░░░░░░  20%  (Agent Search auth-gate; UI query + OCR + Insight masih roadmap)
Admin/Operasional:          ██████░░░░░░░░░░░  30%  (Admin metrics auth-gate, cache panel, rate-limit)
```

## 2. Missing Critical Flows (Roadmap Prioritas)

### P1 — Sangat Kritis (segera)

| Flow | Alasan | Test yang disarankan |
|---|---|---|
| **Authentication** (login/logout/expired session) | Fondasi semua halaman; guard utama | `/login` render; redirect ke `/login` saat tanpa cookie; session expired dialog — ⚠️ **partial 2026-08-03**: `rate-limit.spec.ts` meng-cover gate 429 `POST /api/auth/*`; login/logout/expired penuh tetap roadmap |
| ~~**Budgets** (`/budgets`)~~ | ~~Fitur inti pengelolaan uang; API sudah ada (`/api/budgets`)~~ | ~~List budget, create budget, edit, hapus; usage vs amount~~ — **✅ smoke 2026-08-02** via `core-pages.spec.ts` (render + summary + Tambah Budget); CRUD/usage penuh tetap roadmap |
| **Categories** (`/categories`) | Dependensi Transaksi & Budget | List 19 kategori, tambah/edit/hapus, init-defaults |

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
