# E2E Coverage Report — CashFlow

> Phase 3 · Coverage analysis & roadmap
> Date: 2026-08-01 · Diperbarui 2026-08-02 (P1: core-pages.spec.ts — Budgets/Reports/Notifications, menutup gap 9b)

## 1. Ringkasan Cakupan Saat Ini

| Halaman | Route | Test | Apa yang Diuji |
|---|---|---|---|
| **Dashboard** | `/dashboard` | 2 | Stat cards vs API balance, quick actions, Transaksi Terbaru |
| **Transaksi** | `/transactions` | 3 | List count vs API (284), filter tipe (86/131), pagination 6 halaman |
| **Gmail Sync** | `/gmail-sync` | 3 | Summary cards vs API (519), filter status, pagination Berikutnya |
| **Budgets** | `/budgets` | 1 | Smoke: render tanpa pageerror, summary cards, tombol Tambah Budget, Smart Budget Recommendation |
| **Reports** | `/reports` | 1 | Smoke: render tanpa pageerror, period selector, PDF, summary-vs-empty |
| **Notifications** | `/notifications` | 1 | Smoke: render tanpa pageerror, filter tabs, refresh, daftar notifikasi |

**Total: 17 test · 0 failure · 0 flaky (3× run, 2026-08-02)** — 11 test UI (tabel di atas: 2+3+3+1+1+1) + 6 test auth-gate API (`agent-search-auth.spec.ts` 3 + `admin-metrics-auth.spec.ts` 3). `core-pages.spec.ts` ditambahkan 2026-08-02 (menutup gap 9b).

### Cakupan terhadap kritikalitas

```
Kritis (data utama, uang):  ████████████████░  90%  (Dashboard, Transaksi)
Menengah (fitur inti):      ██████████░░░░░░  55%  (Gmail Sync, Budgets, Reports, Notifications)
Fitur AI/Automasi:          ░░░░░░░░░░░░░░░░  0%   (AI Search, OCR, Insight)
Admin/Operasional:          ░░░░░░░░░░░░░░░░  0%   (Monitoring, Admin)
```

## 2. Missing Critical Flows (Roadmap Prioritas)

### P1 — Sangat Kritis (segera)

| Flow | Alasan | Test yang disarankan |
|---|---|---|
| **Authentication** (login/logout/expired session) | Fondasi semua halaman; guard utama | `/login` render; redirect ke `/login` saat tanpa cookie; session expired dialog |
| ~~**Budgets** (`/budgets`)~~ | ~~Fitur inti pengelolaan uang; API sudah ada (`/api/budgets`)~~ | ~~List budget, create budget, edit, hapus; usage vs amount~~ — **✅ smoke 2026-08-02** via `core-pages.spec.ts` (render + summary + Tambah Budget); CRUD/usage penuh tetap roadmap |
| **Categories** (`/categories`) | Dependensi Transaksi & Budget | List 19 kategori, tambah/edit/hapus, init-defaults |

### P2 — Tinggi (segera setelah P1)

| Flow | Alasan | Test yang disarankan |
|---|---|---|
| ~~**Reports** (`/reports`)~~ | ~~Agregasi & ekspor CSV/PDF~~ | ~~Tampilan summary, filter tanggal, download CSV~~ — **✅ smoke 2026-08-02** via `core-pages.spec.ts` (render + period selector + PDF); ekspor/CSV penuh tetap roadmap |
| ~~**Notifications** (`/notifications`)~~ | ~~API sudah lengkap (CRUD + read-all)~~ | ~~List, mark-read, read-all, badge count~~ — **✅ smoke 2026-08-02** via `core-pages.spec.ts` (render + filter + daftar); mark-read/badge penuh tetap roadmap |
| **AI Search** (`/suite/ai-search`) | Fitur flagship AI | Input query, loading state, hasil tampil / error state (mock API) |

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
| **Monitoring/Admin** (`/admin/monitoring`) | Internal ops; perlu role admin + auth khusus |
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
