# CashFlow — Technical Debt Report

> Audit READ-ONLY · 2 Agustus 2026 · **DOKUMENTASI SAJA — tidak ada penghapusan otomatis.** Setiap item diberi status & rekomendasi; eksekusi menunggu keputusan.
>
> **Update 2026-08-03 (cleanup debt kecil dieksekusi):** Item #1 (`supabase/` arsip), #2 (`firestore.*`), #7 (naming `firebaseUser` → `authUser`), #9/#10 (`@supabase/supabase-js`) telah **dihapus/dieksekusi** — lihat commit cleanup 2026-08-03 (25 file rename, dep & arsip dihapus, E2E 41/41 hijau). Item lain di laporan ini tetap berlaku.

---

## 1. Legacy Files & Remnants

| # | Item | Lokasi | Status | Rekomendasi |
|---|---|---|---|---|
| 1 | **`supabase/` arsip** (functions + migrations) | root `supabase/` | ⚠️ Arsip berlabel "jangan dipakai" di README, masih ada di repo | Pertahankan 1 commit sebagai arsip sejarah → pindah ke `archive/supabase/` atau hapus di commit khusus |
| 2 | **`firestore.indexes.json` + `firestore.rules`** | root | ❌ Legacy Firebase (3 generasi stack lalu) — 0 consumer | Hapus (berisiko membingungkan developer baru) |
| 3 | **`cashflow.db`** (SQLite lokal legacy) | root | ⚠️ Di-gitignore, masih ada di disk dev | Hapus dari disk dev (bukan dari git) |
| 4 | **Vite chunk `firebase`** reference | `vite.config.ts` L14 | ⚠️ `if (id.includes('firebase') ...) return 'vendor-supabase'` — legacy branch, 0 bundle aktual | Bersihkan: hapus branch firebase + rename `vendor-supabase` → `vendor-legacy` (atau hapus) |

---

## 2. Dead Code / Dead Config

| # | Item | Bukti | Rekomendasi |
|---|---|---|---|
| 5 | **`env.turso` di `src/config/env.ts`** | `VITE_TURSO_DATABASE_URL`/`VITE_TURSO_AUTH_TOKEN` — **0 consumer** (grep `env.turso` = 0) | Hapus blok — risiko token client (SECURITY M-1) |
| 6 | **`VITE_FUNCTIONS_BASE_URL`** | `.env.example` root, 0 referensi di src | Hapus dari template |
| 7 | **Naming `firebaseUser`/`firebaseReady`/`firebaseError`** | `useAuthStore`, `useAppStore`, ~15+ page/component (`DashboardPage`, `TransactionsPage`, `BudgetsPage`, dll) | Refactor menyeluruh → `user`/`authReady` (Medium, berdampak luas — jadwalkan) |
| 8 | **Dual Gemini SDK** | Server deps: `@google/genai` (dipakai) + `@google/generative-ai` (0 referensi runtime?) | Audit `grep -r '@google/generative-ai' server/ src/` → hapus bila 0 |
| 9 | **`@supabase/supabase-js` di root deps** | Dipertahankan untuk skrip migrasi legacy | Pertahankan sementara (skrip arsip); hapus setelah skrip migrasi dihapus |

---

## 3. Unused / Deprecated Packages

| # | Package | Status |
|---|---|---|
| 10 | `@supabase/supabase-js` (root) | Deprecated untuk runtime — hanya skrip legacy |
| 11 | `@google/generative-ai` (server) | Duplikasi SDK lama |
| 12 | `@google/generative-ai` (root deps?) | Perlu audit — check package.json root (`@google/genai` + `@google/generative-ai` keduanya ada di root deps) |

---

## 4. Unused Environment Variables

| # | Variabel | Status |
|---|---|---|
| 13 | `VITE_SUPABASE_URL` / `VITE_SUPABASE_ANON_KEY` | Sudah dihapus dari src/.env.example (matrix 10f) ✅ — verifikasi di `.env.local` user |
| 14 | `SUPABASE_URL` / `SUPABASE_SERVICE_ROLE_KEY` | Hanya di skrip migrasi legacy (LEGACY banner) |
| 15 | `GEMINI_API_KEY` | Disebut di `.env.example`/CI, tapi server pakai Vertex (`GOOGLE_APPLICATION_CREDENTIALS`) — **0 consumer di server** → hapus dari docs/CI atau tandai unused |
| 16 | `AUTH_SECRET` | Alias Better Auth (`BETTER_AUTH_SECRET || AUTH_SECRET`) — duplikasi, pilih satu |

---

## 5. Legacy Supabase/Firebase Remnants (docs & kode)

| # | Item | Bukti | Rekomendasi |
|---|---|---|---|
| 17 | **Docs lama menyebut Supabase** | `docs/gmail-sync/*` (10+ file), `docs/transactions/*`, `docs/review-*/*`, `GMAIL_SYNC_SETUP_GUIDE.md`, `ANALISIS_FITUR_CASHFLOW.md`, `agent.md`, `PROJECT_AGENT_ALIGNMENT_AUDIT.md` | Tandai banner "LEGACY/ARSIP" atau pindah ke `docs/archive/`; mulai dari file root yang dibaca developer baru |
| 18 | **Docs lama menyebut Firebase** | `agent.md`, `ANALISIS_FITUR_CASHFLOW.md`, `GMAIL_SYNC_SETUP_GUIDE.md` (VITE_FIREBASE_*), `docs/review/*` | Sama — arsip |
| 19 | **`.kiro/specs/auth.md` + `monitoring.md`** | Sudah ditandai SUPERSEDED ✅ | Pertahankan |

---

## 6. Duplicate Services / Utilities / Prompts

| # | Item | Bukti | Rekomendasi |
|---|---|---|---|
| 20 | **Dua tabel user** | Better Auth `user` + legacy `users` (frontend legacy) | Konsolidasi bila frontend legacy sudah mati; dokumentasikan mapping |
| 21 | **Prompt builders vs duplikasi inline** | Semua di `vertexContext.js` (terpusat ✅); `geminiFallbackParser`/`geminiParser`/`gmailLocalParser` di frontend — **3 parser lokal** (fallback) + 1 server parser | Audit overlap: fallback lokal mungkin out-of-date vs server pipeline |
| 22 | **Envelope error heterogen** | `{success}` (AI), `{ok}` (admin), `{error}` (auth), `{success,ok}` (error middleware) | Standarisasi (lihat ARCHITECTURE rekomendasi) |
| 23 | **Two credential resolvers** | `resolveCredentialPath` di `server/index.js` + `server/services/agentSearchService.js` | Konsolidasi ke 1 util |

---

## 7. Unused AI Model / Config

| # | Item | Status |
|---|---|---|
| 24 | `AI_PRICING.gemini_pro` | Terdefinisi tapi tidak ada feature provider pakai gemini_pro — siap pakai (bukan debt, catatan) |
| 25 | `AGENT_SEARCH_*` env belum dipakai penuh | `servingConfigId` default_config; beberapa data store kosong di dev — feature-gated |

---

## 8. Prioritas Eksekusi (rekomendasi, TANPA auto-fix)

| Prioritas | Item | Effort | Risiko |
|---|---|---|---|
| P0 | #5 hapus `env.turso` (security) | S | Rendah |
| P0 | #4 bersihkan vite firebase chunk | S | Rendah |
| P1 | #7 rename `firebaseUser` → `user` | M–L | Sedang (refactor luas, E2E + typecheck guard) |
| P1 | #17–18 arsip docs legacy | M | Rendah |
| P2 | #8–12 dep cleanup (dual SDK, supabase-js) | S–M | Rendah (grep 0 referensi dulu) |
| P2 | #22 envelope standardisasi + contract enforcement | M | Sedang |
| P2 | #21 audit parser fallback | M | Sedang (perilaku AI) |
| P3 | #20 konsolidasi tabel user | L | Tinggi (migrasi data) |
| P3 | #1–3 arsip/hapus file legacy | S | Rendah |

---

## 9. Konklusi

Debt terbesar **bukan** arsitektur (sudah modular) melainkan **remnant sejarah** (3 generasi stack: Firebase → Supabase → Better Auth+Turso) yang tersisa di naming, deps, dan docs. Cleanup bertahap aman dilakukan karena quality gates lengkap (typecheck + 25 E2E + 57 unit + contract). Jangan eksekusi #20 (tabel user) tanpa migrasi terverifikasi.
