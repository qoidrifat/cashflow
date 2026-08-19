# Quality Review

> **Status:** Approved · **Version:** 1.1 · **Owner:** Qoid Rif'at
> **Last Updated:** 2026-08-09 · **Related:** [REPOSITORY_AUDIT](REPOSITORY_AUDIT.md), [DOCUMENTATION_REVIEW](DOCUMENTATION_REVIEW.md)
> **Audience:** Maintainers

---

## 1. Overall Quality Score: **9.0 / 10**

> **Δ 8.5 → 9.0 (2026-08-09, milestone P1):** quality system diperkuat — component tests +94 (1021 → 1115), E2E DB isolation (local SQLite, 2× 88/88 hijau), Gemini mock boundary (offline deterministik), a11y gate (0 critical, 8 icon buttons diberi accessible name), visual regression 10 → 16 snapshot, `npm test` alias hadir. Lihat [P1 section](#4-p1-testing-improvements-2026-08-09) + [TESTING_STRATEGY §9](../ci/TESTING_STRATEGY.md#9-p1-testing-improvements-2026-08-09).

| Dimension | Score | Notes |
|---|---|---|
| Naming consistency | 9 | Docs follow `docs/meta/NAMING_CONVENTION.md` (UPPER_SNAKE for audit docs, kebab for assets); src/server follow React/Node conventions |
| Duplicate configs | 10 | None — single root config set + `server/package.json` (legitimate) |
| Unused scripts | 6 | 4 one-off `verify-*.mjs` superseded by E2E (see Clutter Report) |
| Unused assets | 6 | `public/logout-debug-viewport.png` debug leftover; no unused images otherwise |
| Repository size | 8 | 11.9 MB tracked — dominated by PNGs (screenshots + visual baselines), acceptable for a repo with visual regression |
| Documentation quality | 10 | 192 files, 0 broken links, indexed, governed |
| Developer experience | 9 | 26 npm scripts, README quick-start, `.env.example` placeholders, LF normalization |

---

## 2. Findings

### 2.1 Naming consistency

- **Good:** `docs/` follows the documented convention; commit messages use conventional prefixes; env vars are `UPPER_SNAKE`.
- **Minor:** `agent.md` should be `AGENTS.md` to follow the emerging standard; `task-list.md` is not a doc-convention file.

### 2.2 Scripts

- 26 npm scripts — well organized (`test:*`, `e2e:*`, build, dev).
- No bare `test` script (only `test:unit` / `test:e2e` / `test:all`) — consider adding `"test": "npm run test:unit"` for contributor friendliness (README documents the actual scripts, so this is cosmetic).

### 2.3 Repository size

| Component | Size |
|---|---|
| `docs/assets/screenshots/` | ~2.5 MB (21 PNG) |
| `e2e/visual/*-snapshots/` | ~2.5 MB (10 PNG) |
| `public/fonts/` | ~0.5 MB (2 variable TTFs + OFL) |
| Everything else (src, server, tests, docs text) | ~6 MB |
| **Total tracked** | **11.9 MB** |

No action required; if size becomes an issue, Git LFS for baselines/screenshots is the standard answer.

### 2.4 Developer experience highlights

- `npm run dev:all` boots Vite + Express concurrently.
- `npm run test:e2e:stability` runs the 3× stability gate.
- `test:e2e:typecheck` validates Playwright specs' types.
- `.env.example` files document every required variable with safe placeholders.

---

## 3. Recommendations

1. ~~Add `"test": "npm run test:unit"` alias~~ — ✅ done (2026-08-09, P1.11).
2. Rename `agent.md` → `AGENTS.md`.
3. Remove `verify-*.mjs` superseded scripts (after CI reference check — verified none).
4. ~~Remove `public/logout-debug-viewport.png` from tracking~~ — ✅ done (2026-08-04).

---

## 4. P1 Testing Improvements (2026-08-09)

Ringkasan milestone P1 (detail lengkap: [TESTING_STRATEGY §9](../ci/TESTING_STRATEGY.md#9-p1-testing-improvements-2026-08-09)).

### 4.1 Yang ditambahkan

- **Component testing** (P1.1–P1.6): TransactionItem, ErrorState, EmptyState, AiTrustMeta, AiConfidenceBadge, CategoryIcon, BudgetCard + pure helpers (timelineGroup, budgetStatus) — +94 test. Infra project vitest `unit-dom` (happy-dom) terpisah dari `unit-node`.
- **E2E DB isolation** (P1.7): `playwright.e2e-local.config.mjs` + `scripts/prepare-e2e-local-db.mjs` — DB libSQL lokal fresh per run (seed CI deterministik + demo Dafa), guard produksi fail-fast, `npm run test:e2e:isolated`.
- **Gemini mock boundary** (P1.8): `server/lib/aiMock.js`, `GEMINI_MOCK=1`, prod fail-fast `assertGeminiMockSafe`, 23 unit test.
- **Accessibility** (P1.9): `e2e/accessibility.spec.ts` (axe, 5 halaman, gate 0 critical) + 8 icon button aria-label.
- **Visual regression** (P1.10): +reports, ai-timeline (seed deterministik), admin-monitoring (seed metrics) — 16 snapshot light+dark, mask data-driven regions.
- **Commands** (P1.11): `npm test`, `test:component`, `test:a11y`; CI jobs `e2e-isolated` (tanpa secrets) + `a11y`.

### 4.2 Bug produk yang ditemukan & diperbaiki

| Bug | Root cause | Fix | Regression guard |
|---|---|---|---|
| POST /api/transactions 500 `19 values for 18 columns` | regresi idempotency_key: VALUES kelebihan `?` | placeholder disamakan | `assertInsertShape` di transactionIdempotency.test.ts + E2E isolated jalur nyata |
| SQLITE_BUSY writer-vs-writer (E2E local DB) | dua proses (API + helper) tanpa busy_timeout | `PRAGMA busy_timeout` di getTurso + factory `createE2eTursoClient` (file: URL saja) | 2× run 88/88 hijau |
| AiTrustMeta `"Sumber: "` kosong saat metadata `{}` | fallback missing | fallback "—" | aiTrustMeta.test.tsx |

### 4.3 Debt tersisa

- ~~Kontras serious di 5 halaman~~ → **RESOLVED P2.1** (0 serious contrast, light+dark; opacity scale fix `/12` dkk).
- ~~Per-worker DB~~ → **RESOLVED P2.2** (shard-based per-worker isolation: DB file + port per worker; constraint webServer per-process didokumentasikan di TESTING_STRATEGY §10.2).
- Unit harness mem-mock `execute` — integration SQL nyata ada di E2E isolated.
- E2E parallel <1.5 mnt belum tercapai di dev hardware (CPU-bound; 2 shard = 3m18s, 4 shard = 3m05s) — CI runner lebih besar mendekati target.
- vite 5.4.21 HIGH (dev-only) di-exception sampai upgrade major 6/7 (review 2026-09-09, DEPENDENCY_AUDIT.md).

## 5. P2.2 Accessibility & UI Hardening (2026-08-09)

Pasca P2.1 (contrast serious = 0, light+dark), P2.2 menutup kategori yang belum
di-scan: focus visible, reduced motion, typography floor, chart a11y, touch
target, heading semantics.

- **P1 → fixed**: AiSearchBox input tanpa indikator fokus → `focus-within:ring-2`
  di wrapper label; pola border-only lemah (AiConversationPage, AiSearchPage,
  AiFeedbackButtons) diperkuat dengan `focus:ring-2`.
- **Reduced motion**: `<MotionConfig reducedMotion="user">` di root — CSS reduce
  block sebelumnya tidak meng-gate animasi framer (default `"never"`).
- **Typography**: 9px dilarang (3 → 10px); nav/table/interactive/section-label
  10px → 11px; 10px tersisa hanya meta non-esensial (kebijakan terdokumentasi di
  `docs/ui/DESIGN_TOKENS_AND_CONTRAST.md` §6.3).
- **Chart a11y**: 7 chart diberi `role="img"` + aria-label deskriptif; Legend
  ditambahkan ke dashboard line chart (multi-seri).
- **Touch target**: AiFeedbackButtons 👍/👎 24px → 32px (44px coarse via
  `.app-icon-button`).
- **Heading semantics**: panel sejajar h3→h2 (MonitoringPage 12, ReportsPage 4);
  metric label tetap `<p>`; axe `heading-order` = 0 di semua halaman scan.
- **Bukti**: a11y 18/18, visual 16/16 (deterministik — reports flake root-caused:
  AI Monthly Report async → mock route fixed), unit 1162, build PASS.

---

## 6. P2.3 Quality Hardening (2026-08-10)

Lanjutan P2.2 — verifikasi menyeluruh + penutup gap, TANPA perubahan perilaku
produk (tidak ada baseline visual yang diubah, tidak ada ambang a11y diturunkan).

### 6.1 Audit temuan (semua berbasis evidence, bukan asumsi)

| Area | Temuan | Severity | Status |
|---|---|---|---|
| Unit flake auth ×2 | `importOriginal()` memuat better-auth 3MB di tiap worker fork → timeout 5s di full suite | P1 | FIX — mock sinkron; **1188 passed** |
| Keyboard "trap" dashboard | 3 tombol "Lihat" berbeda (fraud widget) dikira stuck — guard key `tag:name` | P1 (spec) | FIX — guard identitas elemen; **4/4 PASS** |
| A11y targeted chart | `networkidle` di /reports tak pernah settle (pagination ribuan tx) | P1 (spec) | FIX — `domcontentloaded` + gate konten; **22/22 PASS** |
| Typography arbitrary values | 260× `text-[10px]`/`text-[11px]` tersebar (semua legal per floor) | P2 | Token `text-meta`/`text-label` + guard lint `text-meta` interaktif |
| Chart a11y | 7 chart sudah `role="img"` + aria-label (P2.2) — diverifikasi ulang | P2 | PASS (tanpa perubahan) |
| Focus consistency | 13 file `outline-none` — SEMUA punya pengganti `focus-visible:ring-2`/`focus:ring-2`/`.app-field:focus` | P2 | PASS (tanpa perubahan) |
| Reduced motion | `MotionConfig reducedMotion="user"` + CSS media query + unit test | P2 | PASS (tanpa perubahan) |
| Visual regression | 16 snapshot light/dark — 2× run berturut-turut stabil | P2 | PASS |
| Performance | Entry 106 kB gzip 33 · recharts ter-split · lazy halaman terverifikasi | P2 | PASS (guard `bundleEntryGuard` existing) |
| Dependency audit | 0 critical · 0 blocking · 2 moderate dev-only (warning) | P2 | PASS |
| CI gates | lint/typecheck/unit/build/audit/gitleaks/e2e/a11y/visual — semua ada di e2e.yml | P2 | PASS (tanpa perubahan) |

### 6.2 Bug spec vs produk

Seluruh kegagalan yang ditemukan selama P2.3 adalah **bug di spec test**
(guard lemah / wait strategy), bukan bug produk — dibuktikan lewat probe DOM
sebelum perbaikan (prinsip evidence-first; tidak ada asumsi). Produk tidak
berubah selain penambahan token typography (additive, non-visual).

### 6.3 Bukti baseline (angka aktual, 2026-08-10)

```text
Unit        : 1188 passed | 5 skipped | 0 failed
Component   : 17 file · 168 test (test:component)
A11y        : 22/22 (9 halaman × 2 tema + 4 targeted) · serious/critical = 0
Keyboard    : 4/4 (tab-walk + reachability)
Visual      : 16/16 × 2 run berturut-turut (tanpa update baseline)
E2E typecheck: PASS · Typecheck PASS · Lint PASS · Build PASS
Audit deps  : PASS (0 blocking) · Gitleaks: PASS (CI gate)
```

### 6.4 Sisa debt (jujur)

- Migrasi 260 arbitrary `text-[10px]`/`text-[11px]` ke token semantic TIDAK
dilakukan — keputusan no-change: sudah ter-guard floor (lint), migrasi massal
= risiko visual tanpa nilai fungsional. Kode baru wajib memakai token.
- E2E parallel <1.5 mnt belum tercapai di dev hardware (CPU-bound) — dari P2.2.
- `agent.md` → `AGENTS.md` rename masih terbuka (rekomendasi P1).

---

## 7. P0 Gmail Data Integrity (2026-08-11)

Kontrak lengkap: `docs/gmail/GMAIL_DEDUPLICATION_CONTRACT.md`;
audit forensik & hardening: `docs/financial/FINANCIAL_CALCULATION_INTEGRITY.md` §10.

### 7.1 Temuan (semua berbasis evidence)

- **Root cause duplikat legacy** (confirmed, bukan asumsi): `findDuplicateTransaction`
  window 100 → pesan lama di luar window di-import ulang tiap sync → 631 baris
  duplikat (253 pesan) di dataset dev; 0 pesan multi-transaksi sah.
- **Kalkulator finansial BENAR** — yang tercemar lapisan data, bukan formula.
- **DB dev pasca-cleanup** (re-verified 2026-08-11): **0 grup duplikat**
  `(user_id, gmail_message_id)` · unique index `idx_transactions_gmail_msg_unique`
  terpasang · migration 0003 applied · `db:migrate:check` PASS.

### 7.2 Yang diperbaiki / di-hardening

- Dedupe server-side penuh (pre-SELECT gmail_message_id + replay) — §10.8.
- Unique partial index (user_id, gmail_message_id) + contract + verify script — §10.8.
- Fallback offline (localStorage) + registry cross-tab per-key + normalisasi
  `isAlreadyImportedLocal` — §10.9–§10.10.
- Cleanup tool ber-guard (dry-run/backup/atomik/audit `admin_audit_log`)
  + npm command `db:audit:gmail-duplicates` / `db:cleanup:gmail-duplicates` — §10.11.

### 7.3 Sisa debt (jujur)

- Incremental sync (historyId) belum ada — rescan rentang + dedupe membuat sync
  idempoten (P2).
- E2E "sync penuh dua kali" belum ada (butuh mock Gmail API) — di-cover unit +
  E2E API-level (P2).
- Tool cleanup tanpa unit test permanen — QA temp-DB + dokumentasi (P2).
- Restore otomatis dari backup belum ada — backup JSON lengkap, restore manual (P2).

### 7.4 Transfer internal = netral — `own_accounts` (2026-08-11)

Keputusan produk user (Skr A): transfer ke **akun milik sendiri** tidak
mengurangi saldo — balance lifetime dev −6.400.610,92 → **+2.624.551,08**.
Implementasi + bukti forensik: `docs/financial/FINANCIAL_CALCULATION_INTEGRITY.md`
§10.13; matriks test: `docs/ci/TESTING_STRATEGY.md` §13b. Kalkulator TIDAK
berubah (hanya agregasi expense yang memakai konfigurasi `own_accounts`);
auth/OAuth/Gmail sync tidak tersentuh; data transaksi tidak dimodifikasi.

## 8. P2.5 — Account-Based Real Balance (2026-08-11)

### 8.1 Temuan audit (evidence-based)

- `Total Saldo` selama ini = **Lifetime Net Cash Flow** (Mode B Skr A/B),
  bukan current balance — per definisi `computeFinancialSummary` (tidak ada
  opening balance / account linkage di schema).
- `wallet_accounts` = 0 baris untuk user dev walau `own_accounts` memuat 6
  nama → UI sudah punya konsep akun, ledger belum account-aware.
- Semua 391 transaksi user dev tanpa account_id → unclassified (bukan
  di-assign otomatis — anti fabricasi).

### 8.2 Yang dibangun

| Komponen | Implementasi |
| -------- | ------------- |
| Migrations 0005-0007 | `opening_balance`/`opening_balance_date`/`currency` (wallet_accounts) · `account_id` (transactions) · `transfer_group_id` (transactions) — additive, NULL-safe, tanpa DROP/DELETE |
| Ledger kanonik | `server/lib/financialLedger.js` — currentBalance known/partial/unknown, per-akun movements, unclassified, reconciliationStatus; transfer internal netral, eksternal mengurangi balance |
| API | `/api/transactions/summary` + `ledger` (append-only, backward-compat); wallet endpoints menerima openingBalance/date/currency; transaction create/update menerima accountId/transferGroupId |
| UI | Dashboard: kartu "Saldo Saat Ini" status-aware + rename "Total Saldo" → "Arus Kas Bersih"; Settings: section "Saldo Awal Rekening" |
| Test | `financialLedger.test.ts` (20) · `dashboardPage.test.tsx` (+3) · `e2e/account-ledger.spec.ts` (6) |

### 8.3 Verifikasi real DB (read-only)

SQL oracle ≡ ledger engine ≡ API: Skr A 2.624.551,08 ✓ · Skr B 996.193,08 ✓ ·
external 287.000 ✓ · paired 1.628.358 ✓ · `ledger.currentBalance` =
unknown/no_accounts (user dev belum punya wallet) + unclassified 391.

### 8.4 Sisa debt (jujur)

- **P1**: user dev belum mengisi opening balance / wallet_accounts — saldo
  saat ini UNKNOWN by design (perlu tindakan user: tambah rekening + saldo
  awal). Transaksi legacy belum ter-link ke akun (perlu peninjauan akun).
- **P2**: pasangan transfer tanpa `transfer_group_id` legacy tidak ditebak
  arahnya (unresolved) — migrasi data eksplisit ke group id adalah kerja
  lanjutan; tidak dilakukan otomatis (anti fabricasi).
- **Informational**: `wallet_accounts.balance` (snapshot manual Professional
  Suite) tetap terpisah dari opening_balance — dua kolom dengan semantik
  berbeda, didokumentasikan di migration 0005.

## 9. P2.6 — Assisted Reconciliation & Real-Balance Verification (2026-08-11)

### 9.1 Temuan audit (PHASE B, read-only)

- 0 wallet_accounts · 391 transaksi tanpa account_id · 75 transfer tanpa
  transfer_group_id (semua ungrouped) — konsisten dengan P2.5.
- 6 kandidat akun dari `own_accounts` (LINE Bank, blu, Bank Jago, DANA,
  ShopeePay, Krom Bank). Merchant overlap: blu/LINE Bank/Bank Jago/DANA =
  sinyal HIGH; ShopeePay medium; 40 transaksi tanpa sinyal.
- Golden regression: legacy −6.400.610,92 · Skr A 2.624.551,08 ·
  Skr B 996.193,08 — TIDAK berubah.

### 9.2 Yang dibangun

| Komponen | Implementasi |
| -------- | ------------- |
| Migration 0008 | `real_balance`/`real_balance_date`/`real_balance_verified_at` + `account_review_status` (transactions) + tabel `reconciliation_audit_log` — additive |
| Engine | `server/lib/reconciliationEngine.js` — suggest (HIGH/MED/LOW), classify + bulk by suggestion (deterministik, idempoten), transfer pairing min-pair 1:1, verify balance (tanpa auto-fix), buildReconciliationState/Summary, status + confidence rule |
| API | 6 endpoint /api/reconciliation/* + `reconciliation` block di summary — requireAuth, user-scoped, validasi fail-closed |
| UI | Halaman `/reconciliation` (progress 5 langkah, statistik, saran + konfirmasi dampak, pairing, verifikasi) · banner status di Dashboard · CTA di Settings |
| Test | engine 26 · routes 9 · komponen 7 · E2E reconciliation-flow 8 — unit total 1342 PASS |

### 9.3 Verifikasi live (read-only, user dev)

`GET /api/reconciliation/state` (sesi dev): status unknown (jujur), 391
unclassified, 75 ungrouped transfers, 22 kandidat pasangan, suggestions:
blu 178×/18,9jt (HIGH), LINE Bank 112×/16,4jt (HIGH), Bank Jago 36×/6,1jt
(HIGH), ShopeePay 23× (medium), DANA 2× (HIGH), 40 tanpa sinyal — semua
accountId null (perlu buat akun dulu). `netCashFlow` 996.193,08 tidak
berubah; `reconciliation` block hadir di summary.

### 9.4 Sisa debt (jujur)

- **P1**: user dev harus menyelesaikan onboarding (buat 6 rekening + opening
  balance, tinjau saran HIGH, pasangkan transfer, verifikasi saldo nyata) —
  sistem menyediakan semua alat, keputusan finansial tetap di tangan user.
- **P2**: 40 transaksi tanpa sinyal (LOW) menunggu mapping manual; pasangan
  transfer legacy tetap unresolved sampai user confirm (anti fabricasi).
- **Informational**: saran berbasis `own_accounts` bukan truth — hanya
  evidence untuk mempercepat review; normalisasi merchant tidak mengubah
  merchant asli.

## 10. P2.7 — Verified Balance Anchor (2026-08-11)

### 10.1 Temuan audit

- P2.6 meninggalkan 0 akun / 391 unlinked / 75 transfer unresolved → Current
  Balance UNKNOWN. Mekanisme ada, jalur ke VERIFIED belum: user tidak boleh
  dipaksa tahu saldo Januari (opening) — butuh anchor saldo AKTUAL.
- Field `real_balance/date/verified_at` (0008) secara semantik ADALAH anchor —
  dipakai ulang (mandate: jangan buat struktur paralel). Yang kurang hanya
  outcome verifikasi yang persisten (live derivation salah setelah
  post-anchor movements) → migration 0009 `balance_anchor_status`.

### 10.2 Yang dibangun

| Komponen | Implementasi |
| -------- | ------------- |
| Migration 0009 | `wallet_accounts.balance_anchor_status` (additive) — outcome verifikasi tersimpan |
| Ledger | anchor-based roll-forward (`transaction_date > anchor_date`, END-of-day) + status machine unknown/partial/verified/stale/mismatch + fallback opening P2.5; cross-currency ditolak; unclassified post-anchor dihitung terpisah |
| Engine | verify-balance menerima anchor TANPA baseline (kebenaran user); audit balance_anchor_created/updated; reconciliationStatus/balanceConfidence anchor-aware |
| API | `ledger.currentBalance.anchorDate`, per-akun `anchor` + `verificationStatus`, `reconciliation.anchoredAccounts` (append-only) |
| UI | Dashboard: badge Terverifikasi/Sebagian/Belum terverifikasi/Perlu pembaruan/Perlu pemeriksaan + CTA sesuai status; halaman /reconciliation: "Saldo aktual" + "Tandai terverifikasi" |
| Test | ledger +15 · engine +3 · dashboardPage +1 · E2E balance-anchor 7 — unit total 1362 PASS |

### 10.3 Verifikasi live (read-only, user dev)

`ledger.currentBalance` = unknown/no_accounts + `anchorDate: null` (jujur),
`reconciliation.anchoredAccounts: 0`, `netCashFlow` 996.193,08 TIDAK berubah.
SQL oracle ≡ ledger ≡ API (E2E golden di DB isolasi; dev user belum punya
anchor — membutuhkan aksi user).

### 10.4 Sisa debt (jujur)

- **P1**: dev user harus mengonfirmasi akun + memasukkan saldo aktual per akun
  (anchor) untuk berpindah dari UNKNOWN → VERIFIED. Semua alat sudah live dan
tested — keputusan finansial tetap di tangan user.
- **P2**: 391 transaksi legacy tetap unclassified (tidak dipaksa ke akun);
  anchor mencakup riwayat sebelum anchor sehingga tidak merusak balance.
- **Informational**: `balance_anchor_status` adalah outcome SAAT verifikasi;
  re-verifikasi menimpa dengan audit `balance_anchor_updated` (histori di
  audit log, bukan overwrite diam-diam).

## 11. P2.8 — Real-World Account Activation (2026-08-11)

### Ringkasan

Melengkapi jalur UNKNOWN → VERIFIED yang dibangun P2.7 dengan tiga gap yang
benar-benar belum ada:

1. **Aktivasi akun**: `state.accountCandidates` (own_accounts yang belum
   dibuat) + CTA "Tambahkan Rekening" per kandidat di `/reconciliation`
   (pembuatan eksplisit via `POST /api/wallets` — TIDAK pernah auto-create).
2. **Tolak saran**: `classify-reject` (audit `account_rejected`, transaksi
   tetap unassigned, idempoten) dan `transfer-reject` (migration 0010
   `transfer_review_status`; transfer tetap ungrouped — jujur).
3. **Idempotensi pairing**: `pairTransfer` pada transfer ter-pair mengembalikan
   group sama tanpa mutasi/audit duplikat (§35/§36).

Plus: input tanggal anchor di baris verifikasi (§10), dashboard CTA "Aktifkan
Saldo" saat tanpa rekening (§27), ringkasan "Saldo Aktual" per rekening di
Settings (§29), dan SQL-oracle parity test independen (§63/§64).

### Keputusan desain

- Reject BUKAN auto-fix: transaksi tidak di-assign, tidak diubah nominalnya;
  saran hanya berhenti muncul (Suggestion ≠ Truth).
- Transfer yang ditolak TETAP dihitung ungrouped/unresolved — coverage rendah
  tidak disembunyikan oleh sugesti yang berhenti.
- Rekening baru lahir tanpa saldo awal; tipe di-inferensi hanya sebagai
  default yang bisa diubah user.
- `transfer_review_status` default 'pending' (migration 0010, additive);
  schemaContract + migrationRunner test diperbarui.

### Evidence gates

Unit 1381 PASS · E2E reconciliation-flow 12/12 · balance-anchor 15/15 · a11y
22/22 · visual 16/16 · lint + tsc + build PASS · migrate 0001-0010 · drift
guard PASS · Net Cash Flow golden 996.193,08 unchanged.

### Remaining risks

- Reject berkelompok (grup suggestion) — konsisten dengan accept berkelompok;
  review per-transaksi belum ada (sesuai mandat "jangan membuat onboarding
  terlalu kompleks").
- Anchor masih UNKNOWN untuk dev user (aksi user nyata belum dilakukan) —
  mekanisme lengkap, hasil jujur.
- `transfer_review_status` tidak menghitung transfer rejected sebagai
  resolved — sengaja (kejujuran); dokumentasikan agar tidak disalahartikan.

## 12. P2.9 — Real-World Reconciliation Completion (2026-08-11)

### Gap yang ditutup (root cause, bukan kosmetik)

1. **Tidak ada ukuran kemajuan** — onboarding berhenti di boolean steps;
   P2.9 menambahkan `completionScore` deterministik (bobot akun 20%, anchor
   20%, transaksi 35%, transfer 25%) + rincian angka dari DB di UI.
2. **Transaksi LOW tanpa jalur assign** — 40 transaksi tanpa sinyal akun kini
   punya checklist manual bulk-assign dengan dialog dampak finansial
   (jumlah + total) sebelum commit; TIDAK pernah auto-assign.
3. **`transfers.rejected` tak terlihat** — count ditambahkan ke state + summary.
4. **Aktivasi akun bisa double-create** — `POST /api/wallets` kini idempoten
   per (user, nama, tipe) → satu rekening, tanpa duplikat audit.
5. **Saldo negatif tanpa policy** — verify kini fail-closed 400 untuk
   cash/bank/e-wallet; negatif hanya sah untuk credit/investment.
6. **Transaksi list buta terhadap penautan** — badge "Belum ditautkan" di
   TransactionItem untuk `account_id IS NULL` (§31).

### Bukti integritas

- `netCashFlow` golden 996.193,08 TIDAK berubah; Skr A/B untouched.
- Tidak ada transaksi dihapus/diubah; tidak ada auto-adjustment.
- Ledger anchor P2.7 (END-of-day `transaction_date > anchor_date`) untouched.
- Fixture §50: 3-akun anchor + post-anchor → 3,5/3,75/1,35 jt (total 8,6 jt),
  transfer internal netral, same-day anchor excluded — dikunci unit test.

### Hasil gate

```text
Unit 1389 · E2E 15/15 + 5/5 + 7/7 · A11y 22/22 · Visual 16/16
Build/TSC/Lint/Migration PASS — tanpa regenerasi baseline visual
```

### Infra test fix (determinisme)

`prepare-e2e-local-db.mjs` men-seed `gmail_sync_settings`
(`auto_sync_enabled=1`) untuk seed admin — gate a11y gmail-sync ("Interval"
hanya dirender saat auto-sync aktif) sebelumnya hanya lolos karena state sisa
run lama di DB persisten; pada DB fresh selalu gagal. Kini deterministik.

## 13. P3.0 — Real-World Activation: kelengkapan UX siklus nyata (2026-08-11)

### Gap yang ditutup (evidence-first; P2.9 capability sudah benar)

1. **Checklist LOW tanpa filter** — 37+ transaksi tanpa sinyal akun kini bisa
   difilter `Semua/Pemasukan/Pengeluaran/Refund` (engine menambah field `type`;
   transfer tetap dikecualikan — jalurnya pairing). Pilihan ter-reset saat
   filter berganti sehingga "Terapkan (N)" hanya menghitung item yang tampil.
2. **Mismatch tanpa panduan investigasi** — panel "Kemungkinan penyebab"
   (§18) yang DIFILTER evidence nyata (unlinked + nominal, transfer belum
   dipasangkan, rekening terdeteksi belum aktif, dst.) — dijaga sebagai
   kemungkinan, bukan kepastian; tanpa auto-fix.
3. **Progress onboarding tanpa angka** — indikator eksplisit `Langkah N / 5`
   + label langkah berikutnya (deterministik dari `onboardingProgress`).

### A11y hardening ikutan (determinisme scan, bukan penurunan threshold)

- Gate a11y gmail-sync menunggu indikator jumlah email sebelum scan — kartu
  email lazy-mount ter-scan saat fade opacity<1 → axe meng-blend warna →
  color-contrast false-positive. Memperkuat determinisme.
- Badge status email light-mode `-500/-600` pada bg `-50` (gagal 4.5:1 untuk
  teks 10px) → `-700` (pola app `text-amber-700 bg-amber-50`). Perbaikan
  kontras nyata yang ter-expose oleh determinisme scan.

### Hasil gate

```text
Unit 1394 · E2E reconciliation 15/15 · A11y 22/22 · Visual 16/16
balance-anchor 7/7 · dashboard 5/5 · transactions 3/3
Build/TSC/Lint/Migration PASS — tanpa regenerasi baseline visual
```

### Diketahui (pre-existing, di luar scope P3.0)

- `e2e/fraud-detection.spec.ts` gagal konsisten: test mem-POST `gmailMessageId`
  sama dua kali TANPA `source:'gmail'`. Sejak P0/P1 menambahkan unique index
  `(user_id, gmail_message_id)`, insert kedua kena `SQLITE_CONSTRAINT` → 500.
  Konflik antara rule fraud L1 (flag duplikat Gmail) dan dedupe server-side
  Gmail (cegah duplikat saat insert) — butuh keputusan produk, di luar mandat
  finansial P3.0. `worker-isolation` flaky (pass saat di-run terpisah).

## 13. P3 — Google OAuth `state_mismatch` (2026-08-11)

### Root cause (dibuktikan, bukan dugaan)

State OAuth tersimpan di COOKIE jar browser yang menginisiasi login. Alur
Freebuff Preview: inisiasi di webview (`http://127.0.0.1:5180`), redirect
Google + callback selesai di TAB CHROME EKSTERNAL — dua cookie jar terpisah
→ cookie `better-auth.state` tidak pernah sampai callback → `state_mismatch`
(error persis yang dilaporkan user). Reproduksi deterministik
(`.test-data/oauth-repro2.mjs`): same-jar → state PASS; other-jar →
`state_mismatch`. Tidak ada atribut cookie yang bisa menembus jar berbeda.

### Fix (minimal, tanpa melemahkan security)

- `account.storeStateStrategy = 'database'` — state di tabel `verification`
  (migration 0001, TANPA migration baru); callback divalidasi via parameter
  `state` itu sendiri.
- `account.skipStateCookieCheck = true` — menghapus HANYA lapisan cookie
  yang mustahil lintas-jar (pola plugin resmi oauth-proxy). Validasi state
  tetap eksak: tampered/missing/expired/replay → REJECTED (E2E mengunci).
- Temuan forensik: `advanced.storeStateStrategy` TIDAK dibaca runtime
  (create-context membaca `options.account.storeStateStrategy`) — konfigurasi
  lama di `advanced` adalah no-op yang menyesatkan; kini jujur di `account`.

### Bukti

```text
Unit      1390 PASS (authConfig +1 kontrak account.*)
E2E       oauth-state 6/6 (A same-jar · B other-jar · C tampered · D missing
          · E replay · F expired) · Auth E2E 6/6
Typecheck/Lint/Build PASS
```

### Batas kejujuran

Google OAuth asli (account selection → code exchange → session) tidak bisa
otomasi tanpa kredensial Google nyata; seluruh lifecycle STATE terotomasi,
penyelesaian login nyata diverifikasi manual (lihat
`docs/auth/GOOGLE_OAUTH_LOCALHOST_TROUBLESHOOTING.md`).

## 14. P3.1 — Reconciliation Completion & Ledger Certification (2026-08-12)

### Gap nyata (audit forensik baseline P3.0 — capability inti sudah benar)

1. **§21 Correction flow** — transaksi `confirmed` TIDAK bisa dikoreksi
   (classify biasa skip confirmed). Ditutup dengan reassign EKSPLISIT:
   `classifyTransactions(..., { reassign: true })` via
   `POST /api/reconciliation/classify-reassign`; idempoten (akun sama →
   no-op tanpa audit), audit `account_reassigned` dengan old/new account,
   anti-IDOR (akun target divalidasi `user_id`). UI: bagian "Perbaiki
   penautan" (state baru `linkedTransactions`) + dialog reassign per baris.
2. **§19 Mismatch waterfall kuantitatif** — response `verify-balance` memuat
   `breakdown` (unclassifiedAmount · unresolvedTransferAmount ·
   postAnchorMovements) — non-overlapping, evidence-only, tanpa angka palsu;
   dirender di panel MISMATCH setelah "Kemungkinan penyebab".
3. **§31/§32 Coverage** — E2E completion journey (VERIFIED → STALE →
   reverify → MISMATCH −100.000 → waterfall → koreksi → VERIFIED final) dan
   golden fixture 3jt + 500k/−100k/−150k/+200k/+50k = 3,5jt dengan SQL oracle
   independen == ledger == verify.

### Semantik yang dikunci test

- Anchor END-OF-DAY (`transaction_date > anchor_date`; transaksi PADA tanggal
  anchor tidak dihitung dua kali).
- Setiap `verify-balance` meng-re-anchor ke actual user (P2.7 anchor =
  kebenaran user); `verified` hanya |diff| < 0,01; mismatch TIDAK pernah
  mengubah systemBalance / membuat adjustment; transaksi baru setelah
  verifikasi → `stale`.
- Net Cash Flow golden `Rp996.193,08` TIDAK berubah (Skr A/B untouched).

### Hasil gate

```text
Unit 1402 (+8) · reconciliation-flow E2E 21/21 · financial E2E batch 45/45
(termasuk oauth-state 6/6 — auth tidak regresi) · migration check PASS
Build/TSC/Lint PASS — tanpa migration baru (0001–0010 tetap)
```

### Diketahui (di luar scope P3.1)

- `e2e/fraud-detection.spec.ts` gagal konsisten (pre-existing dari P3.0):
  POST `gmailMessageId` sama dua kali tanpa `source:'gmail'` → unique index
  P0/P1 menolak → 500. Konflik rule fraud L1 vs dedupe server-side — butuh
  keputusan produk. **TELAH DIPERBAIKI di P3.2 §12** (lihat bawah).

## 15. P3.2 — Production Hardening & Zero-Regression Audit (2026-08-12)

### Verdict baseline: production-grade, 2 defect nyata ditemukan & diperbaiki

#### §12 — Fraud vs Gmail-dedupe: kontrak 500 → replay deterministik

Konflik terbukti (bukan dugaan): rule fraud L1 `gmail_message_id` tidak bisa
lagi dipicu via API karena dedupe P0/P1 (unique index) mengembalikan replay.
Reproduksi live: POST non-gmail duplikat → 500 UNIQUE; source='gmail' → 200
`replayed`. Fix minimal di `transactionRoutes.js`: gate `source === 'gmail'`
dihapus dari dedupe (pre-SELECT + TOCTOU catch) → SEMUA transaksi dengan
gmailMessageId yang sudah ada → `200 { id, replayed: true }`; index tetap
unconditional (invariant "Gmail duplicates = 0" dipertahankan). Fraud E2E
beralih ke basis duplikat reachable `amount_merchant_window`; rule
`gmail_message_id` tetap di-lock unit.

#### §13 — Worker-isolation flake: assertion salah scope (bukan leak)

Assertion GLOBAL count pada DB bersama gagal saat spec lain (account-ledger,
balance-anchor) menambah baris user mereka sendiri dalam satu process →
count 284 → 291 tergantung urutan. Bukan leak; fix: assert scope user seed
(count seed admin tetap 284 dalam urutan kontaminasi yang sebelumnya gagal —
14/14). Bukan retry/sleep.

#### Hasil gate

```text
Unit 1403 · E2E 51/51 · A11y 22/22 · Visual 16/16 (tanpa regenerasi)
Build/TSC/Lint/Migration PASS · Golden 996193.08 (oracle SQL independen
== engine, delta 0.0000) · Current Balance UNKNOWN (jujur, tanpa anchor)
```

#### Sisa risiko

- Real Google OAuth (account selection → session): NOT VERIFIED — butuh akun
  Google nyata (lihat P0.2 report).
- Live dev user masih 0 anchor → Current Balance UNKNOWN sampai user mengisi
  saldo aktual (mandate: user = authority).

## P3.x — Visual Regression Baseline Consolidation & CI Hardening (2026-08-17)

### Root cause (dev-DB drift, bukan UI regression)

6 snapshot visual (dashboard desktop ×2, transactions mobile ×2, admin-monitoring
×2) gagal karena baseline lama di-generate dari **dev DB** yang berubah: seed admin
memperoleh 1 account + 1 anchor + 430 tx dari run E2E P3.x, sedangkan baseline
mewakili 391 tx / 0 account. Bukti: test desktop yang tidak pernah disentuh gagal
identik; diff full-page padahal layout identik (band histogram + render ASCII).

### Isolasi database — visual-local runner (baru)

- `playwright.visual-local.config.mjs` + `e2e/globalSetup-visual-local.mjs`:
  suite `@visual` terhadap DB libSQL file lokal fresh per run (`.test-data/
  e2e-visual.db`, delete-first) dengan seed CI-equivalent deterministik (284 tx /
  519 gmail logs / 0 accounts — `scripts/seedE2eDataset.mjs`, mulberry32). Port
  5192/5193 terpisah dari stack dev (5180/5181). Baseline di-verify/regenerate
  dari DB bersih → identik dengan render CI.
- globalSetup DEDICATED (bukan `globalSetup-local-db.mjs` yang fallback ke
  `e2e-shard-<i>.db` → sesi di-mint ke DB salah → dashboard redirect landing).
- CI visual job sudah isolated-deterministik (Turso seed per run, serial setelah
  e2e); kebijakan: dev DB tidak boleh menjadi snapshot source (lihat
  DESIGN_TOKENS_AND_CONTRAST §5.1).

### Baseline regenerasi (8 file, scoped)

dashboard desktop ×2 · dashboard mobile ×2 · transactions mobile ×2 ·
admin-monitoring ×2 — dari clean CI-equivalent DB, setelah setiap diff diinspeksi
dan terbukti data-driven. Determinism dibuktikan: destroy → fresh DB → seed →
check tanpa update = 22/22 PASS (repeatable).

### A11y — small-text contrast (fix)

- `gmailSyncHelpers.ts` STATUS_CONFIG: seluruh badge -500/soft-* → -700 +
  `dark:-300` (badge 10px 4.5:1; -500 2.x–3.95:1 GAGAL).
- `EmailCard.tsx`: confidence badge mint-500→mint-700, "Parsed by Fallback"
  soft-purple→purple-700.
- `GmailSyncEtaCard.tsx` (baru): breakdown counts `text-sm font-semibold`
  (14px, non-large-text) -500 → -700 + `dark:-300` (evidence kontras: 2.00–3.95
  → 4.69–6.52:1). Sisa `text-soft-*` hanya icon non-text (3:1, PASS).

### Coverage visual (dipertahankan + baru)

AI Hub mobile light/dark (dedicated user + seed bulan berjalan deterministik +
mask tabular/summary/timestamp) 2/2 · overflow guard
`expectNoPageHorizontalOverflow` di dashboard/transactions/AI Hub mobile ·
admin-monitoring, ai-timeline, reports baseline dari clean DB.

### Sisa risiko (jujur)

- Real Google OAuth (account selection → session): **NOT VERIFIED** — butuh akun
  Google nyata; automated OAuth security tests PASS ≠ real E2E Google.
- Live dev user masih 0 anchor → Current Balance UNKNOWN sampai user mengisi
  saldo aktual (mandate: user = authority). Golden Net Cash Flow Rp996.193,08
  tidak berubah (oracle delta 0.0000).
- Flake cold-start gmail-sync visual (run pertama stack fresh) — lulus pada
  seluruh run berikutnya (7× beruntun); tidak dilemahkan, dipantau.

## 16. P4.0 — Component Test Coverage Expansion (2026-08-19)

### 16.1 Temuan

Audit test coverage P3.x mengidentifikasi 3 komponen UI kritis yang belum di-test:

| Komponen | Prioritas | Alasan |
|----------|-----------|--------|
| `SessionExpiredDialog` | Tinggi | Komponen auth flow kritis dengan countdown timer dan auto-logout |
| `Button` | Tinggi | Komponen UI fundamental yang digunakan di seluruh aplikasi |
| `Card` | Sedang | Komponen container serbaguna dengan beberapa varian |

### 16.2 Yang dibangun

| Komponen | File Test | Jumlah Test | Cakupan |
|----------|-----------|-------------|--------|
| SessionExpiredDialog | `sessionExpiredDialog.test.tsx` | 6 | Conditional rendering, countdown, auto-logout, A11y |
| Button | `button.test.tsx` | 18 | Variants, sizes, states, icons, accessibility |
| Card | `card.test.tsx` | 9 | Variants, click, keyboard, role, aria-label |

### 16.3 Hasil gate

```text
Unit        : 1484 passed (+33 dari P3.x) | 5 skipped | 110 test files
Typecheck   : PASS
Lint        : PASS (typography guard)
Build       : PASS
A11y        : 22/22 PASS (0 serious/critical)
Visual      : 22/22 PASS (isolated deterministic DB)
```

### 16.4 Keputusan desain

- **Mocking pattern**: Menggunakan `vi.hoisted` untuk Zustand stores (pola yang sudah established di project).
- **Behavior over implementation**: Test berfokus pada user-visible behavior, bukan implementation detail.
- **Accessibility-first**: Setiap test memverifikasi A11y attributes (role, aria-label, tabIndex).
- **No breaking changes**: Semua test existing tetap hijau; tidak ada perubahan kode produksi.

### 16.5 Sisa gap (jujur)

- Komponen layout (AppLayout, BottomNav, Header, Sidebar) tidak di-unit-test karena sudah ter-cover oleh E2E tests.
- Komponen visual simple (Skeleton, Loading) tidak di-unit-test karena sudah ter-cover oleh visual regression tests.
- Rekomendasi: coverage saat ini sudah memadai untuk risk-based testing strategy.

---

## 17. P4.1 — E2E Test Coverage Expansion (2026-08-19)

### 17.1 Temuan

Audit E2E coverage P3.x mengidentifikasi 4 halaman yang belum memiliki E2E smoke test:

| Halaman | Route | Kompleksitas | Alasan Prioritas |
|---------|-------|-------------|------------------|
| SettingsPage | `/settings` | Tinggi | Theme toggle, Gmail sync, export, delete data modal, own accounts |
| PrivacyPage | `/privacy` | Sedang | Privacy sections, export data, delete account dengan konfirmasi |
| NotFoundPage | `/*` | Rendah | 404 handling, error boundary |
| ProfilePage | `/profile` | Sedang | Profile header, financial summary, quick actions, logout |

### 17.2 Yang dibangun

| File Spec | Route | Jumlah Test | Cakupan |
|-----------|-------|-------------|--------|
| `settings.spec.ts` | `/settings` | 5 | Render, theme toggle, Gmail automation, delete modal, own accounts |
| `privacy.spec.ts` | `/privacy` | 4 | Render, 5 privacy sections, export/delete buttons, delete modal |
| `not-found.spec.ts` | `/*` | 2 | 404 handling untuk path invalid & admin invalid |
| `profile.spec.ts` | `/profile` | 5 | Profile header, financial summary, quick actions, logout modal, version |

**Total baru: 16 E2E tests** (dari 0 ke 16 untuk halaman-halaman ini)

### 17.3 Hasil gate

```text
E2E (4 specs)   : 16/16 PASS (isolated local DB)
E2E typecheck   : PASS
Unit            : 1484 passed | 5 skipped | 110 test files
Typecheck       : PASS
Lint            : PASS (typography guard)
```

### 17.4 Keputusan desain

- **Pattern konsisten**: Menggunakan `mintSessionCookie()` + `setupAuthContext()` + `collectPageErrors()` — pola yang sama dengan `core-pages.spec.ts`.
- **Smoke test approach**: Memverifikasi halaman render tanpa JS error + elemen kunci tampil + interaksi dasar (toggle, modal buka/tutup).
- **No production data dependency**: Test berjalan terhadap isolated DB seeded deterministik.
- **Strict mode safety**: Menggunakan `.first()` untuk elemen yang muncul di banyak tempat (header + sidebar).

### 17.5 Coverage akhir E2E

Dengan P4.1, semua halaman utama aplikasi kini memiliki E2E coverage:

| Halaman | Spec | Status |
|---------|------|--------|
| Dashboard | `dashboard.spec.ts` | ✅ |
| Transactions | `transactions.spec.ts` | ✅ |
| Categories | `categories.spec.ts` | ✅ |
| Budgets | `core-pages.spec.ts` | ✅ |
| Reports | `core-pages.spec.ts` | ✅ |
| Notifications | `core-pages.spec.ts` + `notifications-*.spec.ts` | ✅ |
| Gmail Sync | `gmail-sync.spec.ts` + `gmail-review-*.spec.ts` | ✅ |
| AI Hub/Conversation | `ai-conversation.spec.ts` + `ai-dogfood.spec.ts` | ✅ |
| AI Knowledge | `knowledge-assistant.spec.ts` | ✅ |
| Admin Monitoring | `admin-monitoring-*.spec.ts` | ✅ |
| Fraud Detection | `fraud-detection.spec.ts` | ✅ |
| Wallet Onboarding | `wallet-onboarding.spec.ts` | ✅ |
| Account Ledger | `account-ledger.spec.ts` | ✅ |
| Balance Anchor | `balance-anchor.spec.ts` | ✅ |
| Reconciliation | `reconciliation-flow.spec.ts` | ✅ |
| OAuth | `oauth-state.spec.ts` + `oauth-session-host-consistency.spec.ts` | ✅ |
| **Settings** | **`settings.spec.ts`** | **✅ NEW** |
| **Privacy** | **`privacy.spec.ts`** | **✅ NEW** |
| **NotFound** | **`not-found.spec.ts`** | **✅ NEW** |
| **Profile** | **`profile.spec.ts`** | **✅ NEW** |

---

## References

- [REPOSITORY_AUDIT.md](REPOSITORY_AUDIT.md)
- [CLUTTER_REPORT.md](CLUTTER_REPORT.md)
- [docs/meta/NAMING_CONVENTION.md](../meta/NAMING_CONVENTION.md)
- [docs/meta/DOCUMENTATION_QUALITY_REPORT.md](../meta/DOCUMENTATION_QUALITY_REPORT.md)
