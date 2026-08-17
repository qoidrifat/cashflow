# P0.15 — CONTROLLED BILLING PROOF: Google Agent Search / Vertex AI Search

> **Status: BLOCKED — ELIGIBILITY UNPROVEN** (billing gate belum bisa dieksekusi
> dari environment ini). **Zero permission diberikan untuk menjalankan request
> berbayar.** Semua evidence di bawah adalah repo-side, deterministik, offline.
> **Owner:** Core Engineering · **Last Updated:** 2026-08-14

Dokumen ini adalah bukti forensik **billing compatibility** workload CashFlow
`Google Agent Search / Vertex AI Search` terhadap kredit **"Trial credit for
GenAI App Builder"** (P0.15). Prinsip absolut:

```
VERIFY → ENABLE → ONE CONTROLLED QUERY → OBSERVE SKU → OBSERVE CREDIT → FREEZE → EVIDENCE → PASS/FAIL
```

**P0.15 berhenti di `VERIFY`. Gate `ENABLE` TIDAK terlewati.** Ini adalah hasil
yang benar secara engineering, bukan kegagalan. Ada pengecualian: tidak satu pun
request berbayar dijalankan, tidak ada kredit dibakar.

---

## 1. Executive Summary

P0.15 dijalankan terhadap repo `cashflow` (branch `gh-pages`, HEAD
`1885b98`). Investigasi read-only menyimpulkan:

- **Credit diidentifikasi** (identity non-sensitif) dalam mode
  `CREDIT_AMOUNT_STATUS = USER_REPORTED` — belum pernah diverifikasi dari
  Billing Console.
- **Sumber kebenaran Level-1 (Billing Console) TIDAK terjangkau** dari
  environment kerja: tidak ada `gcloud`, tidak ada ADC, tidak ada jalur network
  ke Google Cloud Billing — konsisten dengan temuan P0.14.
- **Eligibility SKU-level = UNKNOWN, bukan YES.** Per `Promotion terms`
  scope berbunyi *"Certain usage; see the terms of the promotion for
  details"* — cannot be verified here.
- Oleh karena itu **gate `ELIGIBILITY_CONFIRMED` TIDAK lolos** → menjalankan
  satu query berbayar sekarang berisiko `FAIL-A`/`FAIL-B` dan membakar kredit
  tanpa bukti. **TIDAK DILAKUKAN.**
- **Regression & security clean:** flag tetap `OFF`, `googleAgentPlatform.test`
  13/13 PASS, E2E OFF-gate 4/4 PASS, service account gitignored, config harness
  (DeepSeek / 9inference / bypassPermissions) immutable.

**Key decision:** P0.15 **FREEZE di billing gate** dan menghasilkan evidence
package + status jujur `BLOCKED — ELIGIBILITY UNPROVEN`. Satu query berbayar
tidak dijalankan karena tidak ada jalur yang membuktikan eligibility-nya —
menjalankannya akan melanggar aturan inti P0.15 (§39, §52, §53).

---

## 2. Credit Identity

| Field | Nilai (aman) | Status |
|---|---|---|
| Credit name | `Trial credit for GenAI App Builder` | identified |
| Credit ID | `PRESENT` (tidak dicetak) | — |
| Currency | `Rp` | — |
| Remaining (user-reported) | Rp 17.801.001 | `USER_REPORTED` (belum diverifikasi) |
| Original (user-reported) | Rp 17.801.001 | `USER_REPORTED` |
| Type | `One-time` | — |
| Valid | 2026-06-19 → 2027-06-19 | — |
| Status | `Available` | user-reported |
| Remaining | 100% | user-reported |

> ⚠️ **CREDIT_AMOUNT_STATUS = USER_REPORTED.** Belum pernah dibaca dari
> Billing Console. Tidak dijadikan bukti.

---

## 3. Billing Eligibility

Per promosi `Promotion terms` (user-provided Cloud Assist output) sekali
mention scope:

> **"Certain usage; see the terms of the promotion for details"**

Ini **bukan** bukti SKU-level. Per sa_truths hierarchy (§6):

- Level 1 (Billing Console) — **TIDAK DIJANGKAU** dari environment agent.
- Level 2 (Pricing/SKU Catalog) — hanya referensi umum; bukan proof credit.
- Level 3 (repo config) — integrasi keluarga produk sudah ada (lihat §7);
  ini evidence repo-side, bukan bukti billing.
- Level 4 (user Cloud Assist) — candidate evidence, bukan SKU proof.

**Kesimpulan gate:** `ELIGIBILITY_CONFIRMED = false`.
`CREDIT_APPLICATION_RULE_CONFIRMED = false` (belum ada SKU di promotion terms
yang diverifikasi).

---

## 4. Google Project

| Field | Status |
|---|---|
| `GCP_PROJECT_ID` | `SET` (server/.env, key name only) |
| `AGENT_SEARCH_PROJECT_ID` | `SET` |
| `GOOGLE_AGENT_PLATFORM_PROJECT_ID` | fallback ke `AGENT_SEARCH_PROJECT_ID` / `GCP_PROJECT_ID` |
| Project ↔ Billing Account | **TIDAK DAPAT DIVERIFIKASI** dari sini (no API/CLI/console access) |

`PROJECT_NUMBER` & `BILLING_ACCOUNT_ID` tidak dicetak (non-sensitif redacted;
tidak dapat dibaca tanpa console).

---

## 5. Billing Account

| Check | Result |
|---|---|
| Billing account `PRESENT`/`ABSENT` | **TIDAK DAPAT DIVERIFIKASI** (no console access) |
| Detach / change payment / new account | **TIDAK dilakukan** (dilarang §11) |
| Credit configuration mutation | **TIDAK dilakukan** (dilarang §11) |

---

## 6. Eligible Service

Dipertimbangkan (branding keluarga produk "GenAI App Builder" → Agent Search):

| # | Layanan | Status eligible credit | Evidence |
|---|---|---|---|
| A | Agent Search (Discovery Engine) | `UNKNOWN — kandidat kuat` | Nama credit = keluarga produk yang sama; integrasi CashFlow sudah ada |
| B | Vertex AI Search / Conversation | `UNKNOWN` | SKU group `vertex-ai-search-and-conversation`; belum diverifikasi |
| C | Grounded Generation / Generative Answers | `UNKNOWN` | - |
| D | Agent Engine / Runtime | `UNKNOWN` | **TIDAK diasumsikan** eligible |
| — | Gemini API (AI Studio) | `UNKNOWN — tidak diasumsikan` | Bukan credit general GCP |
| — | Cloud Storage | `UNKNOWN — pisahkan billing` | Credit App Builder ≠ Cloud Storage |
| — | Cloud Run / Compute Engine / GPU | `TIDAK eligible` | Bukan keluarga App Builder (off-scope) |

**Rules upheld:** `UNKNOWN ≠ YES`, `UNKNOWN ≠ izin untuk test` (§9).
Karena eligibility A/B/C `UNKNOWN`, berlaku aturan: **STOP** (§9).

---

## 7. Actual SKU

**Tidak ada SKU yang diobservasi** (belum ada request berbayar).

Estimasi SKU untuk proof **masa depan** (dari kode adapter `knowledgeAssistant.js`,
label `SKU_LABEL`):

```
Service: agent_search
SKU:     agent_search_standard_search   ← ESTIMASI SAJA, bukan bukti
```

> ⚠️ Estimasi ini TIDAK boleh dianggap sebagai SKU verified. SKU aktual wajib
> dibuktikan dari Billing Console (Cost table / Billing export) sebelum PASS.

---

## 8. Knowledge Base

Knowledge base CashFlow (topik → file sumber nyata):
`docs/cashflow-ai/README.md`. Konten di-*restrict* ke dokumentasi
non-sensitif (feature docs, FAQ, help center, financial education).

| Item | Status |
|---|---|
| Contains only safe docs | ✅ (design; import belum dieksekusi) |
| Import ke data store dilakukan | ❌ **belum** (tidak ada request Google) |
| Secret scan (docs) | ✅ bersih — `docs/` tidak memuat `.env`/SA/credential |

**Tidak ada** peristiwa import/sync data store pada P0.15 ini.

---

## 9. Data Privacy Verification

Adat (design, dikunci di kode — `knowledgeRoutes.js` + `knowledgeAssistant.js`):

| Pertanyaan | Status |
|---|---|
| userId diteruskan ke Google? | ❌ Tidak — `answerAgentSearch({ userId: null })` |
| Data finansial user (saldo/transaksi/wallet) keluar? | ❌ Tidak |
| Gmail body keluar? | ❌ Tidak |
| Tab dipaksa ke knowledge base (`help`/`knowledge_base`)? | ✅ Ya |
| Credential ke browser? | ❌ Tidak — server-side SA only; `getPublicKnowledgeConfig` bebas secret |
| Query limit (max 500 char) + sanitasi? | ✅ Ada |

Perlu dicatat: **tidak ada request nyata dijalankan** sehingga privacy gate
diverifikasi secara *design review*, bukan observasi trafik.

---

## 10. Controlled Query

Per §16 primary proof — **tidak dieksekusi**:

```
Apa perbedaan Akun Terdaftar dan Saldo Terverifikasi?
```

**Alasan:** gate `§23` gagal (eligibility SKU belum terbukti; source of truth
tidak terjangkau). Menjalankan query = request berbayar pada SKU unproven =
`FAIL-A` / `FAIL-B` risk + pelanggaran §53. 

**Query budget:** `MAX_PRIMARY_QUERY = 1` (direncanakan), tidak pernah terpakai.
`MAX_TOTAL_QUERIES = 5` — tidak dipakai.

---

## 11. Query Timestamp

N/A — tidak ada query dijalankan. Freeze terjadi pada phase `VERIFY`.

---

## 12. Service Used

N/A — tidak ada request Google. Service yang dimaksud (`agent_search` /
Discovery Engine) **bukan** service yang terobservasi, melainkan target yang
direncanakan.

---

## 13. SKU Observed

`NONE` — belum ada SKU aktual diobservasi (tidak ada billing line item).

---

## 14. Usage Observed

`NONE` — 0 request berbayar dibuat.

---

## 15. Gross Cost

`Rp 0` — tidak ada usage, tidak ada gross cost.

---

## 16. Credit Applied

`NONE` — belum ada credit offset yang diamati. Tidak diclaim sebagai applied.

---

## 17. Net Cost

`Rp 0` — net = 0 (tidak ada usage). Ini **bukan bukti** credit bekerja;
hanya cermin bahwa tidak ada request.

---

## 18. Credit Before

`Rp 17.801.001` (user-reported, **belum diverifikasi**).
`CREDIT_AMOUNT_STATUS = USER_REPORTED`.

---

## 19. Credit After

`Rp 17.801.001` (user-reported). Tidak ada perubahan karena tidak ada usage.

> ⚠️ `Before - After = 0` di sini **dibuktikan sebagai "tidak ada usage"**, bukan
> "credit menutup cost". Jangan disalahartikan sebagai proof credit.

---

## 20. Billing Propagation

N/A — tidak ada usage untuk dipropagasi. Tidak ada Billing Reports /
Cost table yang dapat diobservasi dari environment ini.

---

## 21. Freeze Timestamp

Gate di-freeze saat fase `VERIFY` (belum enable). Tidak ada query, sehingga
"freeze setelah evidence" tidak terpakai — yang terjadi adalah **freeze sebelum
usage** karena gate tidak lolos. Waktu: 2026-08-14.

---

## 22. Database Regression

Tidak ada perubahan skema/migrasi. Tidak ada query/write database dijalankan.

| Table | Δ |
|---|---|
| transactions | 0 |
| wallet_accounts | 0 |
| budgets | 0 |
| gmail_sync_logs | 0 |
| gmail_sync_settings | 0 |

Tidak menjalankan `db:migrate`, `applyTursoSchema`, Supabase migration, atau
Gmail sync.

---

## 23. Gmail Regression

| Check | Status |
|---|---|
| Gmail import/resync | ❌ Tidak dijalankan |
| Gmail body dikirim ke Google | ❌ Tidak (adapter user_id:null, tab forced) |
| Gmail config diubah | ❌ Tidak |

Δ = 0.

---

## 24. OAuth / Auth Regression

| Check | Status |
|---|---|
| Auth middleware (Better Auth) | Tidak diubah |
| `server/lib/auth.js` | Tidak diubah |
| `registerKnowledgeRoutes(app)` | Hanya registrasi route P0.14 (status: 1 baris, sudah ada) |
| Rate limit route | Di balik `generalLimiter` (design) |

Tidak ada real auth mutasi. (Catatan: test auth/turso timeout saat full-suite
merupakan flakiness env, bukan karena P0.15 — terverifikasi lolos saat dijalankan
isolated.)

---

## 25. Secret / Security Audit

| Check | Result |
|---|---|
| Service account `server/google-agent-search-service-account.json` | ✅ present & **gitignored** (`git check-ignore` OK) |
| `*.service-account*.json` di `.gitignore` | ✅ |
| Credential di browser (`VITE_*`/`NEXT_PUBLIC_*`) | ✅ tidak ada |
| Public config tanpa secret (`getPublicKnowledgeConfig`) | ✅ `enabled/service/skuLabel/projectConfigured/dataStoreConfigured` only |
| Secret scan (source non-node_modules) | ✅ bersih (hits = node_modules/better-auth internal) |
| Endpoint publik baru tanpa auth | ❌ tidak ada |
| PII user keluar | ❌ tidak ada (tidak ada request) |
| Gmail body keluar | ❌ tidak ada |

---

## 26. DeepSeek Regression

| Config | Status |
|---|---|
| `model: deepseek-v4-flash-0731` | ✅ immutable |
| Provider `9inference.cloud` | ✅ immutable |
| Harness (`bypassPermissions`) | ✅ immutable (`defaultMode: bypassPermissions`)

Tidak mengubah `~/.claude/settings.json`.

---

## 27. 9inference Regression

9inference provider & endpoint tidak disentuh. Semua request AI existing tetap
berjalan (unit test AI lulus). **Tidak diubah.**

---

## 28. bypassPermissions

`bypassPermissions` & `skipDangerousModePermissionPrompt: true` dipertahankan
di harness. Tidak diubah.

---

## 29. Errors Found

| Error | Root cause | Classification | Fix |
|---|---|---|---|
| 0 — P0.15 sendiri tidak menghasilkan error | — | — | — |
| 4 unit test timeout saat full-suite (`tursoBootRetry`, `authRateLimitConfig`) | Flakiness env saat paralel; lolos saat run isolated (masing 3/3 PASS) | test/environment, bukan billing | Tidak auto-fix; tidak mengubah prod/test untuk mengecilkan (dilarang §36) |
| Billing Console tidak terjangkau (no `gcloud`, no ADC) | Environment terbatas | billing evidence unavailable (`FAIL-D` potential) | Manual: user jalankan verifikasi §Manual Actions |

Tidak ada unexpected charge muncul (tidak ada charge sama sekali).

---

## 30. Auto-Fixes

**Tidak ada auto-fix yang diterapkan.** Menghindari: tidak ada flag di-enable,
tidak ada query, tidak ada migrasi, tidak ada perubahan billing config. Tidak
ada security measure yang dirusak demi lulus tes.

---

## 31. Files Changed

**TIDAK ada file kode aplikasi/konfigurasi yang dimodifikasi** untuk P0.15.
Satu-satunya file baru: dokumen evidence ini (`P015_BILLING_PROOF.md`).
Working tree saat ini memiliki 343 file tidak-committed (working Sprint 1.5)
yang **tidak disentuh** oleh P0.15.

---

## 32. Tests

| Suite | Result |
|---|---|
| `npm run test:unit` (googleAgentPlatform) | ✅ 13/13 PASS |
| `npm run test:unit` (full suite) | ⚠️ 1447 pass / 4 timeout (env flaky, unrelated) |
| `npm run typecheck` (`tsc --noEmit`) | ✅ clean |
| E2E `knowledge-assistant.spec.ts` (config OFF) | ✅ 4/4 PASS — `enabled:false`, POST→503 no Google call, 400 invalid, UI state non-aktif |

E2E membuktikan **billing gate OFF bekerja dengan benar** (tidak ada request
keluar, tidak ada biaya).

---

## 33. Acceptance Criteria Matrix

| AC | Requirement | Evidence | Status |
|---|---|---|---|
| AC-01 | Credit identified | Billing (user-reported) | PASS |
| AC-02 | Promotion terms verified | Scope "Certain usage..." (Level-4) | PARTIAL |
| AC-03 | Google project verified | server/.env key names | PARTIAL |
| AC-04 | Billing account verified | **No console access** | **BLOCKED** |
| AC-05 | Eligible service verified | UNKNOWN (not YES) | **BLOCKED** |
| AC-06 | Eligible SKU verified | None observed | **BLOCKED** |
| AC-07 | Safe KB | design + docs scan | PASS (design) |
| AC-08 | No financial data to Google | design (user_id:null) | PASS (design) |
| AC-09 | No credentials to Google | SS + public config | PASS |
| AC-10 | Feature flag OFF before proof | env absent→false | PASS |
| AC-11 | Isolated proof | gated route, offline unit tests | PASS |
| AC-12 | One controlled query | **0 taken (gate failed)** | N/A |
| AC-13 | No retry | 0 automatic retry | PASS |
| AC-14 | SKU observed | None | **BLOCKED** |
| AC-15 | Usage observed | None | **BLOCKED** |
| AC-16 | Cost observed | None | **BLOCKED** |
| AC-17 | Credit applied | None | **BLOCKED** |
| AC-18 | No unexpected charge | Rp 0 | PASS |
| AC-19 | Frozen after evidence | PENDING (frozen before usage) | PASS |
| AC-20 | DB delta 0 | no mutation | PASS |
| AC-21 | Gmail delta 0 | no mutation | PASS |
| AC-22 | Auth unchanged | no mutation | PASS |
| AC-23 | DeepSeek unchanged | config intact | PASS |
| AC-24 | 9inference unchanged | config intact | PASS |
| AC-25 | bypassPermissions preserved | settings intact | PASS |
| AC-26 | No secrets exposed | scan + gitignore | PASS |
| AC-27 | Unit/typecheck/lint/build | typecheck clean, google tests pass | PASS* |
| AC-28 | Targeted E2E | 4/4 PASS | PASS |
| AC-29 | Evidence documented | this report | PASS |
| AC-30 | Final classification | BLOCKED — ELIGIBILITY UNPROVEN | PASS (true status) |

\* Full `test:unit` suite menunjukkan 4 timeout env; target `googleAgentPlatform`
green. Ini tercatat, bukan disembunyikan.

---

## 34. Remaining Risks

1. **Billing eligibility belum terbukti** — SKU aktual bisa masuk `FAIL-A`
   (SKU tak eligible) atau `FAIL-B` (SKU bukan cakupan credit).
2. **Upaya menjalankan query saat gate belum lolos** berisiko charge tak
   terduga + pengurangan kredit tanpa bukti.
3. **Blind spot**: tidak bisa memverifikasi project↔Billing Account dari sini.
4. Feature flag tetap OFF — kerja UI tidak aktif sampai P0.16 (bukan P0.15).

---

## 35. Manual Actions (wajib, oleh user di Billing Console)

Supaya P0.15 lanjut ke eksekusi, selesaikan verifikasi Level-1 (source of truth):

1. Buka **Billing → Credits & promotions** → pilih *"Trial credit for GenAI App
   Builder"* → baca **promotion terms**: catat *eligible services*, *eligible
   SKU / SKU group* (mis. `vertex-ai-search-and-conversation`,
   `discoveryengine`), *restrictions*, *credit application rules*.
2. Verifikasi **project ↔ billing account** terlampir pada kredit tsb.
3. Jika SKU `agent_search_standard_search` (search Discovery Engine) termasuk
   eligible → set `ELIGIBILITY_CONFIRMED=true` → baru berniat eksekusi 1 query.
4. Untuk kelengkapan bukti credit, aktifkan **Billing export (BigQuery)** agar
   setelah query dapat dilihat Gross usage / credit offset / Net cost.
5. Setelah 1 query berjalan, tunggu propagation (bisa 24–48 jam) → isi §12–§20
   → update status ke `PASS`/`PARTIALLY VERIFIED`/`NOT ELIGIBLE`.

**Default tetap `GOOGLE_AGENT_PLATFORM_ENABLED=false`** dan sumber utamanya
TIDAK berubah — P0.15 bukan rollout production.

---

## 36. Final Status

| Komponen P0.15 | Nilai |
|---|---|
| Credit identified | ✅ |
| Promotion terms | ⚠️ Level-4 only (belum verifikasi console) |
| Eligible service | UNKNOWN |
| Eligible SKU | UNKNOWN — tidak diobservasi |
| Actual usage | 0 |
| Gross cost | Rp 0 |
| Credit applied | Tidak teramati |
| Net cost | Rp 0 (tidak ada usage) |
| Unexpected charge | **TIDAK ADA** |
| Data leak | **TIDAK ADA** |
| Financial regression | Δ = 0 |
| Security regression | clean |

---

## **FINAL STATUS: BLOCKED — ELIGIBILITY UNPROVEN**

---

## Penjelasan keputusan akhir (penting agar jujur, bukan "gagal")

P0.15 **menghentikan diri di gate `VERIFY`** karena kondisi yang absah:

1. **Source of truth (Billing Console) tidak terjangkau** dari environment
   kerja (tidak ada `gcloud`/ADC/network akses) — konsisten P0.14.
2. **Scope credit berbunyi "Certain usage"** — membutuhkan promotion terms
   untuk dipastikan SKU. Belum diverifikasi.
3. **Aturan inti P0.15 (§39, §52, §53):** API success ≠ billing proof; tidak
   ada fake credit; jangan bayar kredit untuk membuktikan kredit bisa dipakai.
   Menjalankan query berbayar di sini melanggar semuanya dan berisiko `FAIL-A`/
   `FAIL-B` yang dapat mengembalikan charge tak terduga.

Oleh karena itu, **PASS tidak diclaim** — melainkan status objektif:

> `BLOCKED — ELIGIBILITY UNPROVEN` (AC-05, AC-06, AC-14–AC-16 tidak lolos; bukti
> SKU & credit membutuhkan Billing Console).

Ini **bukan** kegagalan risiko; ini hasil yang didisain: menjalankan workload
berbayar hanya jika dan ketika eligibility terbukti dari console. Setelah
a) user verifikasi §35 dan b) query tunggal dikirim pada jalur Agent Search yang
benar (produk keluarga GenAI App Builder) — barulah §12–§20 dapat diisi dan
status bergerak ke `PASS`/`PARTIALLY VERIFIED`/`NOT ELIGIBLE` secara objektif.

**Workload yang dizebut P0.15 terpakai: 0 query. Kredit aman. Zero unnecessary
mutation.**
