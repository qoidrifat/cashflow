# Documentation Consistency Audit — CashFlow

> Audit READ-ONLY · Tanggal: 1 Agustus 2026
> Rantai verifikasi: **Implementation Summary → Actual Code → Documentation → Specs**

## 1. Inventaris Dokumentasi

| Sumber | Lokasi | Status |
|---|---|---|
| E2E modernisasi (10 doc) | `docs/e2e/*.md` | ✅ Lengkap & akurat (ditulis bersama implementasi) |
| Audit sistem 21 Juni 2026 | `../architecture/CASHFLOW_SYSTEM_AUDIT_REPORT.md` | ⚠️ **Usang sebagian** — mendeskripsikan "Supabase Auth + RLS properly implemented" dan "Gmail Sync memakai provider_token dari session Supabase" padahal stack kini Better Auth + Turso |
| Spec Kiro (7) | `.kiro/specs/` (auth, monitoring, agent-search, notification-system, dll) | ⚠️ **Usang sebagian** — terutama `auth.md` (arsitektur Supabase) dan `monitoring.md` (RLS Supabase) |
| Docs domain | `docs/gmail-sync/`, `docs/supabase-migration/`, `docs/google-cloud/`, `docs/implementation/`, `docs/mobile/`, dll | Beragam — mayoritas dokumen migrasi/feature historical |
| README | ❌ **TIDAK ADA** | `ls README.md` → not found |

## 2. Perbandingan Kunci: Dokumentasi vs Kode Aktual

### 2.1 Spec Auth (`auth.md`) vs Kode Aktual

| Klaim spec | Kode aktual | Konsisten? |
|---|---|---|
| "Supabase Auth (Google OAuth) sebagai autentikasi utama" | Better Auth (`server/lib/auth.js`) + Turso | ❌ **TIDAK** |
| "`signInWithGoogle` / `onAuthStateChanged` di `authService.ts`" | Wrapper auth Better Auth / session API | ❌ **TIDAK** |
| "Client Supabase `persistSession`, `flowType: 'pkce'`" | `src/config/supabase.ts` = **stub** (tidak ada client riil) | ❌ **TIDAK** |
| "Provider token Gmail dari session Supabase" | Gmail OAuth scope di Better Auth Google provider | ⚠️ Perlu verifikasi jalur token aktual |

**Kesimpulan**: `.kiro/specs/auth.md` mendeskripsikan arsitektur **sebelum migrasi**. Kode aktual sudah migrasi penuh ke Better Auth + Turso. Spec tidak diperbarui — **dokumentasi out-of-date** (severity Medium: spec adalah kontrak yang mengikat, developer baru akan salah arah).

### 2.2 Spec Monitoring (`monitoring.md`) vs Kode Aktual

- Klaim "Metrics tables RLS dengan NO permissive policy — hanya service role" mengacu pada Supabase; aktual memakai Turso + `metricsService.js`. ⚠️ Usang parsial.
- Klaim "Admin = email di `ADMIN_EMAILS`, verified via Supabase JWT" — kode `resolveAdmin` berkomentar Supabase JWT; konsistensi aktual perlu verifikasi runtime.

### 2.3 Audit Sistem 21 Juni vs Kode Aktual

- Audit lama mencatat "Supabase Auth + RLS properly implemented" — sekarang RLS Supabase tidak relevan (Turso). Temuan lama (53 `any`, vite chunk "firebase") masih relevan sebagian.
- **Kesimpulan**: dokumen audit lama valid untuk snapshot 21 Juni, tidak untuk snapshot 1 Agustus.

### 2.4 docs/e2e vs Implementasi Aktual

| Klaim di docs/e2e | Kode aktual | Konsisten? |
|---|---|---|
| 8 test, 3 spec | `gmail-sync.spec.ts` (3), `transactions.spec.ts` (3), `dashboard.spec.ts` (2) = 8 | ✅ |
| Stability 3× 0 flaky 43.1/41.7/42.6s | Bukti run sesi | ✅ |
| Pinned 284/519/86/131 | Spec benar-benar mem-pin nilai tsb + fetch API | ✅ |
| CI workflow dengan concurrency global, server npm ci, secrets guard | `.github/workflows/e2e.yml` match deskripsi | ✅ |
| Helper: mintSession/authContext/pagination/errors | File aktual match | ✅ |

**docs/e2e adalah dokumentasi paling akurat** — ditulis paralel dengan implementasi.

## 3. Gap & Inkonsistensi (dirangkum)

| # | Gap | Severity | Lokasi |
|---|---|---|---|
| 1 | **README.md tidak ada** — tidak ada entry point dokumentasi proyek | High | root |
| 2 | `.kiro/specs/auth.md` usang (Supabase → Better Auth) | High (kontrak) | `.kiro/specs/auth.md` |
| 3 | `.kiro/specs/monitoring.md` usang (RLS Supabase → Turso) | Medium | `.kiro/specs/monitoring.md` |
| 4 | `CASHFLOW_SYSTEM_AUDIT_REPORT.md` snapshot usang (21 Juni) | Medium | `docs/architecture/` |
| 5 | Komentar `resolveAdmin` "Supabase JWT" di kode | Low-Medium | `server/index.js` L1545 |
| 6 | Naming `firebaseUser`/`setFirebaseReady` (label legacy) | Low | `useAuthStore`/`App.tsx` |
| 7 | `.env.example` masih menyebut Supabase untuk auth client | Low | root `.env.example` |
| 8 | `docs/e2e/*` | ✅ Konsisten | — |

## 4. Skor Konsistensi Dokumentasi

| Dimensi | Skor |
|---|---|
| docs/e2e (implementasi E2E) | 9.5/10 |
| Spec .kiro | 4/10 (auth/monitoring usang) |
| Audit lama | 5/10 (snapshot usang, masih berguna historis) |
| README & entry docs | 2/10 (tidak ada README) |
| **Overall** | **5.5/10** |

## 5. Rekomendasi (TIDAK dieksekusi)

1. **High**: Buat `README.md` (arsitektur, stack aktual Better Auth+Turso+Vite+Express, cara run dev, cara run e2e).
2. **High**: Perbarui `.kiro/specs/auth.md` ke arsitektur Better Auth (atau tandai "superseded by migration").
3. **Medium**: Tandai `CASHFLOW_SYSTEM_AUDIT_REPORT.md` sebagai snapshot historis (tanggal) dan rujuk audit terbaru.
4. **Low**: Bersihkan komentar/naming legacy di kode baru.
