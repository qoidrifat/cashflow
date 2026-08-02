# Code Quality Audit — CashFlow

> Audit READ-ONLY · Tanggal: 1 Agustus 2026 · Fokus: duplication, complexity, maintainability, readability, modularity, naming, consistency.

## 1. Duplication

| Lokasi | Temuan | Severity |
|---|---|---|
| `src/config/api.ts` | `apiGet/apiPost/apiPut/apiDelete` hampir identik (template fetch + error) — 4 fungsi duplikatif | Low (diterima sebagai abstraksi tipis) |
| `e2e/*.spec.ts` | Boilerplate `beforeAll mint + afterAll cleanup + beforeEach setupAuthContext` diduplikasi di 3 spec | **Medium** — kandidat ekstraksi ke helper `withAuth`/fixture kustom |
| `e2e/helpers/pagination.ts` | ✅ Sudah di-dedup (refactor keyword-based, `counterRegexFor`) | ✅ Resolved |
| `e2e/helpers/errors.ts` | ✅ `page.on('pageerror')` boilerplate sudah di-dedup ke `collectPageErrors` (8 call site) | ✅ Resolved |
| `server/index.js` | Pola try/catch handler + `requireAuth` diulang ~20× inline | Low-Medium (monolit, bukan duplikasi literal) |
| `server/lib/turso.js` vs `server/lib/auth.js` | Dua `createClient` Turso terpisah (turso singleton + auth dialect client) | Low (auth perlu client sendiri untuk dialect) |

## 2. Complexity

- **`server/index.js` ~1600+ baris** dengan ~20 endpoint inline (AI extract, gemini, agent-search, admin metrics, health, SSE). Ini titik kompleksitas tertinggi proyek.
  - Risiko: konflik merge, sulit unit-test per handler, "god file".
  - Rekomendasi (tidak dieksekusi — audit): ekstrak ke `server/routes/aiRoutes.js`, `agentSearchRoutes.js`, `adminMetricsRoutes.js`.
- **`GmailSyncPage.tsx`** — halaman besar (fitur: filter, pagination, summary, run history, auto-sync, retry). Kompleksitas tinggi tapi kini memiliki stale-response guard (`paginatedRequestIdRef`) — logika race yang benar.
- **Frontend service**: `gmailService.ts`, `gmailClassifier.ts`, `geminiParser.ts` dkk — modular, tanggung jawab sempit. ✅

## 3. Naming & Consistency

| Temuan | Contoh | Severity |
|---|---|---|
| **Naming legacy Firebase** | `firebaseUser`, `setFirebaseReady` di `useAuthStore`/`App.tsx` — padahal stack Better Auth | **Medium** (misleading) |
| **Naming legacy Supabase** | `src/services/supabaseMappers.ts`, komentar "Supabase JWT" di `resolveAdmin` | Medium |
| Naming konsisten lainnya | routes/services/helpers menggunakan kebab/lowercase konsisten; spec `.spec.ts` konsisten | ✅ |

## 4. Maintainability & Readability

- **Komentar kontekstual kuat** di kode E2E (alasan anti-networkidle, kenapa cookie eksplisit, kenapa pinned) — nilai tambah nyata. ✅
- **Helper E2E terdokumentasi** dengan contoh pemakaian (`errors.ts`, `pagination.ts`). ✅
- **TypeScript strictness**: `any` dipakai di beberapa tempat (`getSupabaseClient(): any`, stubs) — audit sistem 21 Juni mencatat 53 `any`; sebagian kini sudah menjadi stub yang disengaja. Low-Medium.
- **`tsconfig.e2e.json`** terpisah — typecheck e2e tidak mencemari src. ✅

## 5. Modularity

- Frontend: ✅ fitur terisolasi per `src/features/*`.
- Backend: ⚠️ routes domain terpisah tetapi handler AI/admin masih inline.
- E2E: ✅ helper layer yang jelas (auth/session/pagination/errors).

## 6. Skor Code Quality

| Aspek | Skor |
|---|---|
| Duplication | 7.5/10 (boilerplate spec duplikat; api client tipis) |
| Complexity | 6.5/10 (monolit index.js) |
| Maintainability | 7.5/10 |
| Readability | 8/10 |
| Modularity | 7/10 |
| Naming & Consistency | 6.5/10 (legacy firebase/supabase naming) |
| **Overall** | **7.2/10** |

## 7. Prioritas Perbaikan (rekomendasi, TIDAK dieksekusi)

1. **High**: Ekstrak handler AI/admin/agent-search dari `server/index.js` ke route module.
2. **Medium**: Ganti naming legacy `firebaseUser` → `user`/`sessionUser` (refactor menyeluruh, dampak luas).
3. **Medium**: Ekstrak boilerplate spec E2E (`beforeAll/afterAll/beforeEach` + cookie) ke fixture Playwright kustom.
4. **Low**: Envelope respons API seragam (opsional).
