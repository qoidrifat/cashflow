# Gap Analysis — CashFlow

> Audit READ-ONLY · Tanggal: 1 Agustus 2026 · Hanya rekomendasi — tidak ada implementasi yang dieksekusi.

## 1. Missing Features

| # | Feature | Dampak | Prioritas |
|---|---|---|---|
| 1 | **E2E coverage halaman lain** — Budgets, Reports, Notifications, Settings, Categories, AI Search, Receipt OCR, Insight, Auth, Monitoring, Admin, Profile | Hanya 3 halaman kritis ter-cover (dashboard, transactions, gmail-sync). Regresi di halaman lain tidak terdeteksi otomatis | **High** (roadmap ada di `docs/e2e/E2E_COVERAGE_REPORT.md`) |
| 2 | **README.md** | Tidak ada entry point dokumentasi proyek | High |
| 3 | **API contract tests** (schema drift detection) | Strategi sudah didokumentasikan (`docs/e2e/API_CONTRACT_STRATEGY.md`) tetapi belum diimplementasikan | Medium |
| 4 | **Visual regression tests** | Strategi siap (`VISUAL_REGRESSION_PLAN.md`), belum ada implementasi | Medium |
| 5 | **CI DB isolation** — Turso `file:` seed | Test menulis sesi ke DB yang sama dengan server; CI workflow siap tapi belum ada isolated DB | Medium |
| 6 | **Unit tests** (frontend/backend) | Tidak ada unit test sama sekali; hanya E2E | Medium |
| 7 | **Stability gate otomatis 3× di CI** | Dilakukan manual di sesi; belum otomatis di workflow | Low |

## 2. Partial Implementations

| # | Item | Status Saat Ini | Gap |
|---|---|---|---|
| 1 | **Dynamic assertions** — penghapusan pinned values | Pinned 284/519/86/131 masih ada sebagai regression guard (total tetap di-fetch dari API) | Pelepasan pinned penuh belum dilakukan (direncanakan saat dataset dinamis) |
| 2 | **`npm run typecheck` script** | Tidak ada script `typecheck`; hanya `test:e2e:typecheck` + `tsc --noEmit` | Alias script kecil hilang |
| 3 | **`resolveAdmin()`** | Komentar masih "Supabase JWT" — mekanisme aktual perlu verifikasi runtime | Berpotensi dependensi legacy |
| 4 | **Monitoring/observability** | `metricsService.js` + tabel monitoring ada; dokumentasi spec masih menyebut RLS Supabase | Spec usang vs implementasi Turso |

## 3. Outdated Documentation

| # | Dokumen | Masalah |
|---|---|---|
| 1 | `.kiro/specs/auth.md` | Mendeskripsikan arsitektur Supabase Auth; aktual Better Auth + Turso |
| 2 | `.kiro/specs/monitoring.md` | Klaim RLS/service-role Supabase; aktual Turso + metrics service |
| 3 | `docs/architecture/CASHFLOW_SYSTEM_AUDIT_REPORT.md` | Snapshot 21 Juni 2026 — arsitektur auth & storage sudah berubah |
| 4 | `.env.example` | Masih menyebut Supabase untuk auth client; naming legacy |

## 4. Dead Code / Legacy

| # | Item | Bukti | Risiko |
|---|---|---|---|
| 1 | `@supabase/supabase-js` di dependencies | `src/config/supabase.ts` = stub; tidak ada `createClient` riil di src | Bundle bloat bila ter-import; membingungkan |
| 2 | Naming `firebaseUser`, `setFirebaseReady`, `supabaseMappers.ts` | `useAuthStore`, `App.tsx`, `src/services/supabaseMappers.ts` | Misleading untuk developer baru; bukan runtime issue |
| 3 | `@google/generative-ai` vs `@google/genai` duplikat | Root `package.json` punya keduanya (`^0.24.1` dan `^2.9.0`); server juga punya versi beda (`^0.21.0` di server/package.json) | Versi ganda menambah ukuran install; risiko perilaku beda |
| 4 | **Express version split** — root `^5.2.1` vs server `^4.21.0` | Server resolve dep dari `server/node_modules` → runtime Express 4, sedangkan root menyatakan Express 5 | API Express 4 vs 5 berbeda (routing/error); inkonsistensi deklarasi vs runtime — konsolidasi ke satu versi |
| 5 | Vite chunk "firebase" reference (dari audit 21 Juni) | `vite.config.ts` | Konfigurasi legacy tidak berdampak runtime |

## 5. Technical Debt (dirangkum dari seluruh audit)

| Debt | Severity | Estimasi Effort |
|---|---|---|
| `server/index.js` monolit ~1600+ baris (20 endpoint inline) | Medium | S (ekstrak ke route modules) |
| Naming legacy firebase/supabase di store & services | Medium | M (refactor menyeluruh) |
| Spec .kiro usang (auth/monitoring) | Medium | S (update dokumen) |
| Boilerplate spec E2E duplikat (beforeAll/afterAll/beforeEach) | Low | S (fixture kustom) |
| Default `limit 2000` di `/api/gmail/logs` | Low | S |
| Error envelope mentah ke client (`api.ts` melempar errorText) | Medium | S |
| Dep ganda @google/* | Low | S |
| Express version split (root ^5 vs server ^4) | Medium | S (konsolidasi versi) |

## 6. Rekomendasi Prioritas (TIDAK dieksekusi)

### Immediate (sebelum commit pertama)
1. Audit staging `git add .` — pastikan service accounts (`server/*.json`) & `.env` tidak ter-track (`.gitignore` sudah benar, tinggal dihormati).
2. Buat `README.md` dengan arsitektur aktual (Better Auth + Turso + Vite + Express).

### Short-term (1–2 sprint)
3. Ekstrak handler AI/admin/agent-search dari `server/index.js` → `routes/aiRoutes.js`, `adminMetricsRoutes.js`, `agentSearchRoutes.js`.
4. Perbarui `.kiro/specs/auth.md` & `monitoring.md` ke stack aktual.
5. Verifikasi runtime `resolveAdmin()` — apakah benar masih Supabase JWT atau sudah Better Auth; sesuaikan kode/komentar.

### Medium-term
6. Tambah spec E2E: Budgets → Reports → Notifications (pola cookie-login + pagination helper siap).
7. Implementasi API contract tests (`API_CONTRACT_STRATEGY.md`).
8. CI-isolated DB seed (Turso `file:` + fixture) agar test tidak menulis ke DB bersama.

### Long-term
9. Unit tests untuk service & helper.
10. Visual regression (snapshot dark/light/responsive) saat UI stabil.
11. Refactor naming legacy `firebaseUser` → `user`.
