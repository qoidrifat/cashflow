# Financial Calculation Integrity — Insiden & Invariant

> **Status**: Selesai (fix + regression tests + live validation) · **Tanggal**: 2026-08-08
> Dokumen ini mendefinisikan satu model perhitungan keuangan CashFlow dan
> mencatat root cause insiden `Rp109.415 → Rp489.415` beserta pencegahannya.

## 1. Insiden (2026-08-08)

User menambahkan **6 transaksi expense manual** (total **Rp83.500**) di bulan
Agustus 2026. Sebelumnya dashboard menampilkan:

| Metric | Before | Delta yang diharapkan | After (dilaporkan) | Benar? |
| ------ | ------: | ---------------------: | ------------------: | :----: |
| Total Saldo | 109.415 | −83.500 → 25.915 | **489.415** | ❌ |
| Pemasukan Bulan Ini | 135.394 | +0 | 135.394 | ✅ |
| Pengeluaran Bulan Ini | 261.326 | +83.500 → 344.826 | 344.826 | ✅ |

Pengeluaran bulanan benar (+83.500), tetapi Total Saldo **naik +380.000** —
padahal menambah expense harusnya **menurunkan** saldo.

## 2. Root Cause (dibuktikan, bukan tebakan)

**`Total Saldo` dihitung dari 50 transaksi terbaru (windowed), bukan seluruh
riwayat.**

Alur yang salah:

```
DashboardPage → listenToTransactions
  → getRecentTransactions(userId, 50)     ← HANYA 50 baris terbaru
  → GET /api/transactions?limit=50        (ORDER BY date DESC)
  → calculateBalance(50 baris)            ← saldo = SUM income − SUM expense (50 baris)
```

Menambahkan 6 transaksi Agustus membuat window 50 bergeser: **6 baris lama
keluar window** (net kontribusi **+296.500**: income 350.000+50.000 dikurangi
transfer/expense), 6 baris baru masuk (−83.500). Saldo window melompat:

```
−109.415 (window sebelum) − 83.500 + 296.500 = −489.415  →  tampil 489.415 (abs)
```

**Bukti numerik reproduksi eksak** (simulasi terhadap DB Turso nyata, Qoid):

| | Window-50 (bug) | Lifetime (benar) |
| --- | ---: | ---: |
| Sebelum 6 transaksi | −109.415 (tampil 109.415) | −6.312.241,62 |
| Sesudah 6 transaksi | −489.415 (tampil 489.415) | −6.395.741,62 |
| Delta | **+380.000** (salah) | **−83.500** (benar) |

Lapisan yang mulai salah: **Frontend state (DashboardPage)** — API
`/api/transactions?limit=50` dan database keduanya benar; yang salah adalah
menggunakan daftar "50 terbaru" (yang tujuannya untuk list UI) sebagai dasar
agregasi saldo.

## 3. Definisi Bisnis (source of truth — TIDAK diubah)

### Konvensi tanda (Model B — amount selalu positif, type membawa arah)

`transactions.amount` disimpan **selalu positif** (`CHECK (amount > 0)`):

| type | Arah | Formula |
| ---- | ---- | ------- |
| `income` | + | `SUM(amount)` |
| `refund` | + | `SUM(amount)` |
| `expense` | − | `SUM(amount)` |
| `transfer` | − | `SUM(amount)` |

```text
income  = SUM(amount WHERE type IN ('income','refund'))
expense = SUM(amount WHERE type IN ('expense','transfer'))
balance = income − expense
```

Ini **identik** dengan `calculateBalance()` di
`src/services/transactionService.ts` (dipertahankan — tidak membuat formula
baru, hanya memindahkan agregasi ke SQL atas SELURUH baris).

> **Perubahan disetujui user (2026-08-11, §10.13)** — "transfer internal =
> netral": bila user mengonfigurasi daftar **akun milik sendiri**
> (`user_financial_settings.own_accounts`, migration 0004), transfer yang
> merchant-nya ada di daftar itu TIDAK dihitung sebagai expense (uang
> berpindah antar-akun sendiri ≠ pengeluaran). **Skr B (2026-08-11)**: income
> yang merupakan pasangan transfer internal (same-day same-amount
> same-merchant, deteksi deterministik) juga TIDAK dihitung sebagai income —
> menutup risiko inflasi pendapatan. Default `[]` = perilaku legacy (semua
> transfer = expense, income tidak pernah dinetralkan).

### Total Saldo = lifetime net cash flow

`Total Saldo` adalah **net cash flow lifetime** = seluruh income lifetime −
seluruh expense lifetime (bukan saldo wallet, bukan opening balance — tidak ada
konsep opening balance di model transaksi CashFlow).

### Bulan Ini = half-open range pada `transaction_date`

```text
>= 'YYYY-MM-01' AND < 'YYYY-MM+1-01'     (transaction_date, string YYYY-MM-DD)
```

Timezone: tanggal transaksi adalah string tanggal lokal user (bukan UTC epoch),
jadi perbandingan leksikografis = semantik tanggal. Tidak ada konversi timezone
yang perlu dilakukan pada `transaction_date`.

## 4. Fix (minimal, source-of-truth, tanpa rewrite arsitektur)

Agregasi dipindah ke **server-side windowless SQL**:

| File | Perubahan |
| ---- | --------- |
| `server/lib/financialSummary.js` | **Baru** — `computeFinancialSummary(client, userId, {month, year})`: 3 query SQL (lifetime, monthly, monthlyExpenseByCategory) tanpa LIMIT; `monthRange` half-open; `round2` presisi 2 desimal |
| `server/routes/transactionRoutes.js` | **Baru** `GET /api/transactions/summary?month=&year=` (requireAuth, user-scoped; month 1-12 clamp, year 2000-2100 clamp; 400 VALIDATION_ERROR fail-closed) |
| `src/services/transactionService.ts` | **Baru** `getTransactionSummary()` + `listenToTransactionSummary()` (refetch SSE on created/updated/deleted) |
| `src/types/index.ts` | **Baru** `TransactionSummary`, `FinancialTotals`, `MonthlyCategoryTotal` |
| `src/features/dashboard/DashboardPage.tsx` | Stat cards & budget usage membaca **summary windowless**; `?limit=50` tetap dipakai HANYA untuk list "Transaksi Terbaru" & chart (bukan agregasi) |

### Invariant baru (dijaga regression test)

```text
Menambahkan 6 expense (83.500) → monthly expense +83.500, monthly income +0,
lifetime balance −83.500 — TANPA tergantung ukuran window.
```

## 5. Layer Reconciliation (live, 2026-08-08)

| Layer | Balance (Qoid) | Monthly income | Monthly expense |
| ----- | -------------: | -------------: | --------------: |
| Database (SQL) | −6.312.241,62 | 135.394 | 261.326 |
| API `/api/transactions/summary` | −6.312.241,62 | 135.394 | 261.326 |
| Frontend service (getTransactionSummary) | sama | sama | sama |
| UI `/dashboard` | Rp7.591.500 (demo user) | Rp10.900.000 | Rp3.082.500 |
| Match | ✅ | ✅ | ✅ |

Validasi live insiden (Qoid, transaksi sementara dibuat lalu dihapus):

```
BEFORE  monthly expense: 261326 | lifetime balance: -6312241.62
AFTER   monthly expense: 344826 | lifetime balance: -6395741.62
monthly expense delta: 83500 (expected +83500) ✅
monthly income delta : 0     (expected 0)       ✅
lifetime balance delta: -83500 (expected -83500) ✅
```

## 6. Test

| Test | Isi |
| ---- | --- |
| `tests/unit/financialSummary.test.ts` (16) | Golden reconciliation insiden (delta 83.500 windowless), konvensi tanda (refund=income, transfer=expense), monthRange half-open (Des→Jan rollover, clamp), round2 presisi, monthlyByCategory hanya `expense`, SQL tanpa LIMIT, data kosong → 0 |
| `tests/unit/transactionSummaryRoute.test.ts` (6) | Auth gate requireAuth, user-scoped (user_id autentikasi), response shape, month/year diteruskan, non-numeric → 400, out-of-range → clamp (semantik validateInt), 500 jujur |
| `e2e/dashboard.spec.ts` (2, diupdate) | Stat cards cocok dengan `/api/transactions/summary` (windowless) + **reload consistency** (nilai setelah reload identik dengan API — frontend state tidak menyimpang dari DB) |

Suite: **808 passed + 5 skipped** (sebelumnya 786) · typecheck 0 error · build OK.

## 7. Pencegahan (agar tidak kembali)

1. **Jangan pernah menghitung saldo/agregasi dari list terbatas** — `?limit=50`
   (atau limit apa pun) hanya untuk menampilkan daftar, bukan agregasi. Agregasi
   finansial wajib lewat `/api/transactions/summary` (windowless SQL).
2. **Satu sumber kebenaran**: DB = Backend = API = Frontend = UI. Setiap angka
   finansial harus bisa dilacak ke query SQL yang sama.
3. **Regression guard**: `financialSummary.test.ts` mengunci invariant delta
   eksak; `dashboard.spec.ts` mengunci UI ↔ API ↔ reload.
4. **Jangan menambal UI** (`setBalance(balance - x)` di frontend): jika angka
   salah, cari layer yang mulai salah (DB → service → API → state → render).
5. Tanda transaksi dikunci `CHECK (amount > 0)` + type enum — jangan ubah
   konvensi tanpa mengubah seluruh formula (calculateBalance, summary SQL,
   advisor, insight, reports) sekaligus.

## 7b. Catatan Display (SELESAI — 2026-08-09)

`formatCurrency` memakai `Math.abs` — saldo negatif tampil tanpa tanda minus.
**Sudah di-follow-up**: kartu Total Saldo di dashboard kini menampilkan
`-Rp6.312.241,62` merah (`text-red-600 dark:text-red-400`, pola ProfilePage)
via prop `negative` di `src/components/ui/StatCard.tsx` — tanpa mengubah
`formatCurrency` global.

## 8. Klasifikasi Root Cause

```text
[ ] Database data corruption
[ ] Duplicate transaction
[ ] Incorrect transaction sign
[ ] Incorrect balance formula
[x] Frontend optimistic update bug           ← saldo dihitung dari window 50 baris terbaru
[x] Frontend cache invalidation bug          ← refetch window bergeser → saldo melompat
[ ] API mapping bug
[ ] Backend service bug
[ ] SQL aggregation bug
[ ] Join multiplication
[ ] Mock/seed data contamination
[ ] Currency/numeric conversion bug
[ ] Transaction type classification bug
[ ] Opening balance logic bug
```

Alasan: database menyimpan 6 transaksi dengan benar (SUM expense = 83.500),
API `/api/transactions` mengembalikan baris dengan benar, dan monthly expense
dihitung benar. Yang salah: dashboard mengagregasi **daftar 50 terbaru** sebagai
"Total Saldo". Setelah agregasi dipindah ke SQL windowless, dashboard, API, dan
database menghasilkan angka identik (bagian 5).

## 9. Audit Windowed Aggregations (migrasi 2026-08-09)

Pola bug yang sama (agregasi dari fetch terbatas) teraudit di seluruh halaman:

| Halaman | Fetch lama (window) | Agregasi yang dihitung | Migrasi |
| ------- | ------------------- | ---------------------- | ------- |
| `ProfilePage` | `getTransactionsPaginated` pageSize 100/bulan | Pemasukan/Pengeluaran/Net bulan ini, top kategori, jumlah transaksi | ✅ `getTransactionSummary` (`summary.monthly` + `monthlyByCategory`) — agregasi SQL windowless |
| `ReportsPage` | `getAllTransactions` limit=2000 | Pemasukan/Pengeluaran/Net per periode, pie kategori, chart harian, forecast, AI report, PDF | ✅ via `getAllTransactions` → paginasi penuh (windowless-complete) |
| `AdvisorPage` | `listenToTransactions` 50 baris | Metrics coach (bulan ini, avg 3 bulan, top kategori/merchant, budget usage) + prompt Gemini | ✅ `getAllTransactions` (windowless-complete) |
| `SettingsPage` (CSV) | `getAllTransactions` limit=2000 | Export CSV seluruh transaksi | ✅ ikut membaik (fungsi yang sama diperbaiki) |
| `ProfessionalSuitePage` | `getAllTransactions` limit=2000 | Ringkasan suite | ✅ ikut membaik |
| `BudgetsPage` | `getAllTransactions` (limit) + `listenToTransactions` (50, list UI) | Budget usage & sisa | ✅ ikut membaik (getAllTransactions); list 50 = tampilan, bukan agregasi |
| `AiHubPage` | `listenToTransactions` 50 | Metrics kartu AI (bulan ini, avg 3 bulan, top kategori/merchant, budget usage) + insight bulanan | ✅ `getAllTransactions` (windowless-complete) — evaluasi: `/summary` TIDAK cukup (avg 3 bulan & `topMerchant.count` hanya dari list lengkap) |

### Sisa windowed lookup (bukan agregasi — roadmap, tidak blocking)

`findDuplicateTransaction` (100) sengaja windowed (dedupe berbasis transaksi
recent — mengubahnya ke full-scan akan mengubah semantik cek duplikat).

`getTransaction(id)` & `getTransactionsByDateRange` (sebelumnya window 500/1000)
**DITUTUP 2026-08-09** — keduanya kini query langsung server:
- `getTransaction(id)` → `GET /api/transactions?limit=1&id=<id>` (filter
  user-scoped `AND id = ?`; `[]` = tidak ada, tanpa ambiguitas 404; fallback
  localStorage hanya saat API gagal).
- `getTransactionsByDateRange` → paginasi `dateFrom/dateTo` server
  (windowless, loop sampai `hasNextPage=false`).

Unit test: `tests/unit/transactionListIdFilter.test.ts` (server id-filter +
400 fail-closed) & `transactionServiceWindowless.test.ts` (lookup point /
null / fallback / rentang berhalaman).

### Perubahan

| File | Perubahan |
| ---- | --------- |
| `src/services/transactionService.ts` | `getAllTransactions` → paginasi penuh `GET /api/transactions/paginated` (pageSize 100, loop sampai `hasNextPage=false`, guard konvergensi; fallback localStorage hanya saat API gagal total — kontrak lama dipertahankan) · **cache in-memory (2026-08-09)**: Map per-user TTL 60s + invalidasi SSE `transaction:created/updated/deleted` + invalidasi eksplisit di mutasi & resetService + in-flight dedup (guard identity anti repopulation race) — nav antar halaman tidak refetch loop penuh · `getTransaction(id)` → `?limit=1&id=` (query point) · `getTransactionsByDateRange` → paginasi `dateFrom/dateTo` (sengaja TIDAK ikut cache — query per-rentang) |
| `src/services/resetService.ts` | Reset data → `invalidateAllTransactionsCache(userId)` (cache in-memory ikut dibersihkan) |
| `server/routes/transactionRoutes.js` | `GET /api/transactions` menerima `id` OPSIONAL (validateClearableString max 191; `AND id = ?` user-scoped; `[]` = tidak ada; 400 VALIDATION_ERROR bila > 191) |
| `tests/unit/transactionListIdFilter.test.ts` (6) | Filter id: hadir/absen/kosong, >191 → 400, clamp limit bersama id, auth gate |
| `src/features/profile/ProfilePage.tsx` | Ringkasan bulan ini dari `getTransactionSummary` (windowless server) — hapus pageSize 100/bulan |
| `src/features/advisor/AdvisorPage.tsx` | Ganti `listenToTransactions` (50) → `getAllTransactions` (lengkap) |
| `src/features/ai-product/AiHubPage.tsx` | Ganti `listenToTransactions` (50) → `getAllTransactions` (lengkap) — pola sama AdvisorPage; `fetchOnce` tersisa untuk budgets |
| `tests/unit/transactionServiceWindowless.test.ts` (4) | Merge 3 halaman, satu halaman, kosong, fallback API gagal |

### Catatan pergeseran semantik (disengaja, didokumentasikan)

- **ProfilePage `Top Kategori`**: agregasi lama = kategori paling sering dicatat
  (semua tipe, by count); baru = kategori **pengeluaran terbesar** bulan ini
  (dari `monthlyByCategory` server, by amount) — konsisten dengan ReportsPage
  dan lebih bermakna untuk ringkasan keuangan.
- **ProfilePage rentang bulan**: lama `dateFrom=1st`..`dateTo=now`; baru
  half-open `[1st, bulan+1)` pada `transaction_date` — semantik bulan kanonik
  server (transaksi future-dated di bulan berjalan kini ikut terhitung, kasus
  langka).

## 10. Audit Rekonsiliasi 2026-08-10 (Balance Reconciliation & Duplikat Gmail)

> **Status**: Verifikasi forensik selesai — kalkulator PASS (windowless sudah
> benar); 1 temuan data-integrity P0 (duplikat import Gmail) dilaporkan, data
> TIDAK dihapus (sesuai mandat).

### 10.1 Verifikasi forensik — angka dashboard BENAR (bukan bug kalkulator)

SQL independen read-only (bukan fungsi aplikasi) terhadap DB Turso aktual,
user dev utama `pJV0r…3CCB` (1024 baris, 2026-08-10):

| Component | Count | Amount | Arah |
| --------- | ----: | -----: | ---- |
| Income | 303 | 67.574.053 | + |
| Refund | 44 | 944.380,56 | + |
| Expense | 462 | 47.923.143,03 | − |
| Transfer | 215 | 29.924.353 | − |
| Opening balance | 0 | 0 (tidak ada konsep — §3) | — |
| **Canonical balance** | **1024** | **−9.329.062,47** | income+refund−expense−transfer |

Bulan berjalan (Agustus 2026, half-open `[2026-08-01, 2026-09-01)`):

| Type | Count | Amount |
| ---- | ----: | -----: |
| Income | 4 | 565.551 |
| Expense | 10 | 230.282 |
| Transfer | 1 | 93.794 |
| Refund | 0 | 0 |

- **`-Rp6.312.241,62`** (dashboard saat insiden) = snapshot SAH 2026-08-08
  (778 baris; tercatat §2 & golden test `financialSummary.test.ts`) — angka
  benar untuk kondisi DB saat itu. Data terus bertambah → live 2026-08-10 =
  −9.329.062,47. Tidak ada yang perlu "diperbaiki" pada saldo itu sendiri.
- Verifikasi formula: `67.574.053 + 944.380,56 − 47.923.143,03 − 29.924.353 =
  −9.329.062,47` ✅ identik dengan `computeFinancialSummary` & `calculateBalance`
  (paritas tanda: income/refund +, expense/transfer −).
- Sumber: gmail 1012 baris (145.897.791,59) · manual 12 baris (468.138).

### 10.2 Temuan P0 — duplikat import Gmail (data-integrity, BUKAN kalkulator)

Klasifikasi eksak (read-only):

```text
253 pesan dengan >1 baris
  0 pesan berisi multi-transaksi sah          ← 100% confirmed duplicate
631 baris ekstra (dari 1024 = 61% baris)
Net dampak pada balance ≈ −2.720.451,55
  income   +45.081.478  (193 baris)
  refund   +642.535,42  (30 baris)
  expense  −27.832.273,97 (268 baris)
  transfer −20.612.191  (140 baris)
```

Contoh (baris identik persis, hanya `created_at` beda): income 111.824
2026-03-06 Bank Jago ×4, diimport di 4 batch sync (06-22, 08-02, 08-05, 08-09).

**Root cause (kode, bukan tebakan)**:

```text
dedupe klien findDuplicateTransaction → getRecentTransactions(100)
  → GET /api/transactions?limit=100   (ORDER BY date DESC)
  → pesan LAMA (mis. Maret) di luar window 100 terbaru → LOLOS cek
  → di-import ulang setiap sync ulang batch
```

Unique index `idx_transactions_user_idempotency` (user_id, idempotency_key)
+ Idempotency-Key server (2026-08-09) mencegah duplikat BARU identik, tetapi:
631 baris yang sudah terlanjur masuk TIDAK dibersihkan. Ini akumulasi historis
sebelum mekanisme idempotency penuh berlaku.

**Keputusan (sesuai mandat §2/§8)**: duplikat TIDAK dihapus. Cleanup data
ber-approval user + harden dedupe Gmail sync (cek `gmail_message_id` penuh
server-side / lastSync state) = rekomendasi terpisah, di luar scope audit
kalkulator ini.

### 10.3 Sisa Budget semantic — FIX

`Rp0` ambigu: bisa (a) budget habis/over atau (b) TIDAK ADA budget dikonfigurasi
bulan ini. Bukti: user dev punya **0 budget bulan berjalan** (hanya 2 budget
Juni 2026) → "Rp0" sebelumnya menyesatkan (seolah budget habis).

Fix minimal `src/features/dashboard/DashboardPage.tsx`:

```text
budgetConfigured = currentMonthBudgets.length > 0
Sisa Budget card → changeLabel "Belum ada budget" saat tidak dikonfigurasi
```

Value tetap dihitung dari `budgetsWithUsage` (windowless monthlyByCategory).

### 10.4 Observability — FIX

`GET /api/transactions/summary` kini mencatat (non-blocking, tanpa payload
finansial, hanya requestId + duration):

```text
financial_summary_requested · financial_summary_completed · financial_summary_failed
```

**Verifikasi runtime end-to-end (2026-08-11)** — 5× request ber-sesi Better
Auth ke backend dev (port 5181, DB Turso dev) lalu query `system_metrics`:

```text
Baseline (≥ T0)            : requested 0 · completed 0 · failed 0
Setelah 5 request (200)    : requested 5 · completed 5 · failed 0
Sampel metadata            : {"requestId":"req_…","durationMs":105} — feature=financial, user-scoped
All-time DB dev            : requested 19 · completed 19 · failed 0
```

Catatan: pada query yang dijalankan LANGSUNG setelah respons 200, completed
bisa tampil 4/5 — INSERT metric bersifat non-blocking (tidak di-await) dan
request terakhir masih in-flight saat `res.json()` kembali; re-query setelah
jeda singkat menunjukkan 5/5 lengkap. Ini perilaku telemetry yang diharapkan,
bukan kehilangan data. `failed=0` konsisten dengan 0 kegagalan request;
jalur `failed` (catch di route) ter-cover unit test
`transactionSummaryRoute.test.ts` (error → failed).

### 10.5 Test baru (rekonsiliasi DB nyata)

| File | Isi |
| ---- | --- |
| `tests/unit/financialSummaryReconciliation.test.ts` (13 blok `it` · mencakup 15 case wajib §22) | DB libsql file nyata di `os.tmpdir()` (bukan mock, tidak baca `.env`; cleanup `afterEach`): SQL independen ≡ `computeFinancialSummary` · no-transaction · income · expense · campuran · **>50 tx lifetime penuh + delta eksak (regresi LIMIT 50, §28)** · month boundary · refund=income · transfer sekali (tanpa double count) · decimal tanpa drift · user isolation · mutation insert/update/delete · persistence+reload |
| `tests/unit/transactionSummaryRoute.test.ts` (diperluas) | Observability metric tercatat (requested/completed; error → failed) |
| `tests/unit/dashboardPage.test.tsx` (+2) | Sisa Budget semantic: tanpa budget → label "Belum ada budget"; ada budget → sisa dihitung & label tidak muncul |

### 10.6 Validasi

```text
Unit 1205 passed · 5 skipped (1203 + 2 test budget baru) · Typecheck 0 · Lint 0 · Build PASS · Visual 16/16 · E2E transactions isolated 3/3 PASS
```

### 10.7 Tool cleanup duplikat Gmail — `scripts/gmailDuplicateCleanup.mjs` (2026-08-11)

Tindak lanjut §10.2: skrip penghapus duplikat **ber-approval user** dengan
safety guard berlapis. Data TIDAK dihapus otomatis — eksekusi butuh
`--execute` + env `GM_DUP_CLEANUP_EXECUTE=1` + konfirmasi (interaktif
`DELETE` / `--yes`).

**Perilaku (dua mode matching):**

| Mode | Aturan | Dampak DB dev (dry-run 2026-08-11) |
| ---- | ------ | ---------------------------------- |
| Default (`exact-business-key`) | Hapus baris dengan business key IDENTIK dalam pesan sama (`type+amount+transaction_date+merchant`), keep **tertua** (`created_at ASC, id ASC`). Baris beda-key (multi-transaksi sah / type-drift) dilaporkan & TIDAK dihapus | **631 baris** dari 251 pesan; balance **−9.329.062,47 → −6.608.610,92** (+2.720.451,55) |
| `--message-id-any` | Semantik literal "duplikat gmail_message_id": seluruh baris dalam pesan = duplikat, keep tertua apapun business key | 631 + 2 baris type-drift = 633 baris |

**Safety guard (terverifikasi end-to-end di DB libsql file uji):**

```text
1. Default = DRY-RUN read-only (laporan dampak saldo per user sebelum eksekusi)
2. --execute tanpa GM_DUP_CLEANUP_EXECUTE=1 → exit 1 (pola backupTurso.mjs)
3. --execute tanpa --yes pada stdin non-TTY → exit 1
4. Backup JSON seluruh baris yang akan dihapus → backups/gmail-cleanup/ (gitignored)
5. Penghapusan dalam SATU transaksi tulis; rollback otomatis bila gagal
6. [verify] recount grup duplikat setelah eksekusi
7. --user <id> / --limit <n> / --report-file <path> / --dotenv-file <path>
```

**Pemakaian (wajib pemisah `--` karena Node.js v24 menolak flag custom tanpa
pemisah — `--env-file` juga konflik dengan flag resmi Node):**

```bash
# Dry-run + laporan dampak (read-only, aman)
node -- scripts/gmailDuplicateCleanup.mjs

# Eksekusi dengan guard lengkap
GM_DUP_CLEANUP_EXECUTE=1 node -- scripts/gmailDuplicateCleanup.mjs --execute --yes
```

**Terverifikasi (QA, DB file uji):** 4 baris duplikat dihapus dari 12 → 8
baris; keep-oldest benar (a1/a4/b1 bertahan); M3 (multi-transaksi sah) & M4
(type-drift) & baris manual tanpa `gmail_message_id` TIDAK tersentuh; backup
JSON berisi id baris yang dihapus; `--message-id-any` menghapus baris
type-drift non-tertua; recount `[verify]` = 0 setelah eksekusi.

**Catatan penting**: `--execute` TIDAK dijalankan terhadap DB dev pada audit
ini — dry-run read-only SAJA (sesuai mandat: cleanup butuh persetujuan user).

### 10.7a EKSEKSI CLEANUP DB DEV — SELESAI (2026-08-11, approval user)

Dengan persetujuan eksplisit user (perintah lengkap `GM_DUP_CLEANUP_EXECUTE=1
node -- scripts/gmailDuplicateCleanup.mjs --execute --yes`), cleanup dijalankan
terhadap DB dev Turso aktual, dua pass:

```text
Pass 1 (default exact-business-key) : 631 baris dihapus (251 pesan)
  backup  : backups/gmail-cleanup/gmail-dup-cleanup-2026-08-11T02-44-04-312Z.json (463 KB, seluruh kolom)
Pass 2 (--message-id-any, 2 grup type-drift) : 2 baris dihapus
  backup  : backups/gmail-cleanup/gmail-dup-cleanup-2026-08-11T02-45-25-186Z.json

Before → After (user dev utama pJV0r…):
  transaksi : 1024 → 393 (gmail) · saldo: -Rp9.329.062,47 → -Rp6.608.610,92 (+Rp2.720.451,55)
  total DB  : 1338 → 705 transaksi · grup duplikat (msg>1 baris): 253 → 0
  [verify]  : 0 grup duplikat tersisa ✓
```

Pass 2 type-drift diperlukan: 2 pesan (`19bc080efd1dec28`, `19d48a7af32d0412`)
masing-masing x2 baris (transfer + expense, pesan sama, konfirmasi forensik
duplikat import ulang) memblokir unique index §10.8 — dihapus dengan semantik
"keep tertua" sesuai spesifikasi tool. Semua baris yang dihapus dapat
direstore dari backup JSON di `backups/gmail-cleanup/` (gitignored).

### 10.8 Hardening dedupe Gmail server-side — FIX (2026-08-11)

Menutup root cause §10.2 di lapisan hulu (bukan hanya tool cleanup):

```text
Sebelum:  cek duplikat = klien findDuplicateTransaction (window 100 terbaru)
          → pesan LAMA di luar window LOLOS → di-import ulang tiap sync ulang batch
          → 631 baris duplikat historis.

Setelah:  POST /api/transactions kini pre-SELECT gmail_message_id PENUH
          (user-scoped, WHERE user_id = ? AND gmail_message_id = ?, via index
          idx_transactions_gmail_msg) saat source='gmail' && gmailMessageId
          → baris sudah ada → replay { id, replayed: true } TANPA INSERT kedua.
```

Melengkapi Idempotency-Key (2026-08-09): key hanya menutup request BARU
(baris lama punya `idempotency_key NULL`); cek gmail_message_id penuh menutup
baris lama juga. Urutan: idempotency dulu (short-circuit), lalu gmail.
TOCTOU antar request gmail identik tetap ditangani unique partial index
`(user_id, idempotency_key)` (klien selalu kirim key `gmail::uid::msgId`).

| File | Perubahan |
| ---- | --------- |
| `server/routes/transactionRoutes.js` | POST `/api/transactions`: pre-SELECT `gmail_message_id` penuh (user-scoped) → replay bila sudah ada; tanpa INSERT/SSE/fraud kedua |
| `tests/unit/transactionGmailDedupe.test.ts` (8) | Pesan lama → replay tanpa INSERT · pesan baru → INSERT · user isolation (gmail_message_id user lain tetap INSERT) · source=gmail tanpa msgId → perilaku lama · source≠gmail dengan msgId → cek tidak aktif · idempotency short-circuit mendominasi · race TOCTOU → replay via unique index · auth gate |

Verifikasi: 19 test PASS (8 baru + 11 idempotency existing) · typecheck 0 ·
lint 0 · E2E `transactions.spec.ts` isolated 3/3 PASS (tidak ada regresi
jalur create).

**Asumsi semantik (sengaja, didokumentasikan)**: cek ini memperlakukan satu
`gmail_message_id` = satu transaksi — replay baris kedua walau type/amount/
date/merchant berbeda. Konsisten dengan `isSameTransactionCandidate` klien
(same-id = duplicate) dan bukti forensik §10.2 (0 pesan multi-transaksi sah),
tetapi LEBIH agresif dari default tool cleanup §10.7 (exact business-key).
Bila nanti ada jenis email sah berisi MULTIPLE transaksi (mis. statement
bank bulanan), hanya transaksi pertama yang di-import — perlu validasi ulang
saat tipe email baru muncul.

**Batasan (dokumentasi jujur)**:
- ~~Jaminan TOCTOU penuh memerlukan unique partial index
  `(user_id, gmail_message_id)`~~ **RESOLVED 2026-08-11**: setelah cleanup
  §10.7a dieksekusi (0 grup duplikat), index dibuat di DB dev DAN di
  `turso-schema.sql`:
  `idx_transactions_gmail_msg_unique ON transactions(user_id, gmail_message_id)
  WHERE gmail_message_id IS NOT NULL AND gmail_message_id != ''` — terbukti
  menolak INSERT duplikat (`SQLITE_CONSTRAINT: UNIQUE constraint failed`,
  uji transaksi+rollback di DB dev). POST /api/transactions diperluas: race
  constraint error tanpa Idempotency-Key (request gmail langsung / importer
  batch) kini re-SELECT by gmail_message_id → replay, bukan 500 (test TOCTOU
  #8); `ORDER BY created_at,id` = keep-oldest deterministik; constraint error
  manual-source tanpa key tetap 500 jujur (test #9 — tidak ditelan).
  Lingkungan lain: seed E2E tidak memproduksi gmail_message_id duplikat →
  index terpasang bersih via initTursoSchema; `scripts/prepare-e2e-local-db.mjs`
  kini guard `PRAGMA index_list('transactions')` (exit non-zero bila index
  unik gmail absen — cegah hardening absen diam-diam di DB test).
  **Migration versioned**: `server/migrations/0003_gmail_message_id_unique_index.sql`
  (kanonik, fail-fast — GAGAL & tidak tercatat bila data masih duplikat;
  diverifikasi unit runner). Pre-flight read-only:
  `node -- scripts/verifyGmailUniqueIndex.mjs --check-only` (exit 1 bila
  kotor → cleanup §10.7a dulu). Daftar file & konvensi: `docs/database/MIGRATIONS.md`.

### 10.9 Hardening dedupe Gmail jalur fallback localStorage — FIX (2026-08-11)

Menutup batasan §10.8 di cabang `catch` `doAddTransaction`
(`src/services/transactionService.ts`): saat POST gagal (offline / network
drop) dan `source === 'gmail' && gmailMessageId`, dilakukan cek
`gmail_message_id` PENUH atas store lokal (`readLocalTransactions`) SEBELUM
menulis baris baru. Bila pesan sudah ada → **replay id existing** (semantik
server `{ id, replayed: true }` §10.8), tanpa baris kedua.

Skenario yang ditutup: cek duplikat klien `findDuplicateTransaction` hanya
menjangkau window 100 server (atau store lokal bila GET gagal) — pesan yang
SUDAH ada di store lokal (import offline sebelumnya / tab lain) bisa lolos
cek lalu POST gagal → sebelumnya cabang fallback menulis baris KEDUA. Kini
fallback idempoten per `gmail_message_id`.

| File | Perubahan |
| ---- | --------- |
| `src/services/transactionService.ts` | `doAddTransaction` cabang fallback: pre-check `gmail_message_id` atas store lokal (source gmail) → replay id existing + `logger.warn`; non-gmail tidak terpengaruh |
| `tests/unit/transactionServiceWindowless.test.ts` (+4) | Replay saat msg sudah di store lokal (tanpa baris kedua) · pesan baru tetap menulis 1 baris · user isolation (store per-user) · non-gmail tetap perilaku lama |

Catatan desain & batas (dokumentasi jujur, review 2026-08-11):

- **Replay TIDAK memanggil `invalidateAllTransactionsCache`** (tidak ada
  mutasi data) — di-pin unit test (cache HIT setelah replay).
- **Scope sengaja dibatasi** ke `source === 'gmail'` + `gmailMessageId`
  (permintaan: dedupe gmail_message_id di jalur offline) — duplikat
  business-key non-gmail di jalur offline tetap perilaku lama (cek
  `findDuplicateTransaction` atas store lokal penuh sudah mencakup kasus
  GET-gagal).
- ~~Race lintas-tab tetap tersisa (best-effort)~~ **DITUTUP 2026-08-11**:
  registry `gmail_message_id` per-user di localStorage
  (format per-key `cashflow-gmail-import-registry-<userId>-<msgId>::<nonce>`,
  sinkron antar tab via storage event) — di-claim SINCHRONOUS sebelum POST
  dan di-cek di jalur fallback SEBELUM menulis (detail di §10.10). Batas
  tersisa yang jujur: claim read-modify-write localStorage bukan atomic
  lintas-tab (tanpa Web Locks/BroadcastChannel — butuh worker/secure
  context); format per-key + claim-and-verify (nonce + timestamp) membuat
  semua tab berkonvergen pada pemenang yang sama dan mengecilkan window race
  ke urutan milidetik, dan server tetap sumber kebenaran final (unique
  partial index `(user_id, gmail_message_id)` menolak duplikat ENFORCED).
- **Divergensi semantik NORMALISASI (2026-08-11)**: `findDuplicateTransaction`
  dan cabang fallback kini memakai SATU helper yang sama —
  `isAlreadyImportedLocal(userId, gmailMessageId)` (cek store lokal +
  klaim registry confirmed, detail §10.10). Konsekuensi: pesan yang SUDAH
  diimport lokal (offline sebelumnya / tab lain confirmed) terdeteksi
  SEBELUM POST → `DuplicateTransactionError` → email ditandai *duplicate*
  — hasil KONSISTEN untuk kondisi logis yang sama di semua jalur (sebelumnya
  throw-vs-replay bisa berbeda tergantung jalur deteksi). Replay hanya
  tersisa di jendela race lintas-tab (cek dijalankan sebelum tab lain
  confirm — wait-loop §10.10). Bonus: menutup duplikat lintas-lapisan —
  import ulang saat online dari pesan yang hanya ada di store lokal tidak
  lagi menghasilkan baris server baru.

### 10.10 Registry gmail_message_id cross-tab — FIX (2026-08-11)

Menutup race lintas-tab §10.9: dua tab yang meng-import pesan gmail SAMA
secara offline bisa sama-sama lolos cek duplikat klien lalu sama-sama menulis
baris lokal → 2 baris (localStorage tanpa unique constraint).

**Registry** (`src/services/transactionService.ts`) — **revisi format per-key
(2026-08-11)**: SATU localStorage key PER KLAIM, bukan satu key berisi map.

```text
cashflow-gmail-import-registry-<userId>-<msgId>::<nonce>  →  { nonce, at, confirmedTxId? }
GmailRegistryClaim = { nonce, at, confirmedTxId? }
```

- **Satu key per klaim (kunci race)**: `localStorage.setItem` bersifat
  per-key — dua tab yang menulis KE KEY YANG SAMA saling menimpa
  (read-modify-write non-atomic → klaim hilang → keduanya bisa menganggap
  menang). Dengan key PER KLAIM (nonce unik), write tab A TIDAK PERNAH
  menimpa write tab B → semua tab selalu membaca HIMPUNAN klaim yang sama
  untuk satu msgId → aturan at-tertua meng-konvergenkan semua tab pada
  pemenang yang SAMA secara deterministik, bahkan saat dua tab membaca
  registry kosong BERSAMAAN (diverifikasi code review iteratif + test race
  simultan).
- **nonce**: identitas tab/klaim (random) — arbitrasi lintas-tab + key unik.
- **at**: timestamp claim — klaim dengan at TERTUA menang saat berlomba
  (tie: nonce terurut — deterministik).
- **confirmedTxId**: id transaksi final (server ATAU lokal) setelah import
  selesai — tab lain yang menemukan claim terkonfirmasi REPLAY id tsb, bukan
  menulis baris kedua.
- Backward-compat: format lama satu-key (`...-<userId>` berisi map
  msgId → klaim) tetap dibaca saat ditemukan (dibuat & tak pernah dirilis
  hari yang sama — dibaca untuk transisi aman). Bounded `GMAIL_REGISTRY_MAX_ENTRIES`
  (5000) — klaim terlama dibuang saat melewati cap.

**Alur (claim-and-verify)**: claim SINCHRONOUS sebelum POST — pass 1 tulis
klaim tab ini ke KEY SENDIRI (non-destruktif), pass 2 baca SEMUA klaim untuk
msgId dan pilih klaim at tertua sebagai pemenang (bukan sekadar
`registryWinner` in-memory) → POST sukses: `confirmGmailImport(id server)`
(key nonce tab ini — tab lain yang POST-nya gagal akan replay id ini, walau
baris hanya ada di server) → POST gagal (fallback):

1. Cek `isAlreadyImportedLocal` — helper SATU-SATUNYA untuk "sudah diimport
   lokal?" (store lokal + klaim registry confirmed), dipakai JUGA oleh
   `findDuplicateTransaction` (normalisasi divergensi §10.9): pesan yang
   sudah diimport lokal → `DuplicateTransactionError` SEBELUM POST.
2. Tab KALAH (klaim tab lain tertua) tanpa konfirmasi → tunda ≤800ms
   (`GMAIL_REGISTRY_WAIT_DEADLINE_MS`, diexport agar test bisa memendekkan)
   agar id final sempat tercatat → replay bila muncul, menulis bila orphan
   (tab ditutup saat POST). Inilah SATU-SATUNYA jalur replay yang tersisa
   setelah normalisasi — jendela race nyata lintas-tab.
3. Menang → tulis baris lokal + `confirmGmailImport(id lokal)`.

**Sinkronisasi lintas-tab**: storage event (`window.addEventListener('storage')`)
— tab lain menulis registry/transaksi lokal → cache `getAllTransactions` user
tsb di-invalidate (bukan hanya saat boot). Guard `typeof window !== 'undefined'`
untuk Node/SSR.

| File | Perubahan |
| ---- | --------- |
| `src/services/transactionService.ts` | Registry per-user per-klaim (key `...-<userId>-<msgId>::<nonce>`) + claim-and-verify + confirm + cek di fallback + storage event invalidator · `isAlreadyImportedLocal` helper tunggal dipakai `findDuplicateTransaction` DAN cabang fallback (normalisasi §10.9) · wait-loop deadline diexport |
| `tests/unit/transactionServiceWindowless.test.ts` (+8 registry + update ekspektasi normalisasi) | Tab lain confirmed → DuplicateTransactionError tanpa baris lokal · POST sukses → registry mencatat id server · fallback → registry mencatat id lokal · user isolation (registry per-user) · non-gmail tidak menyentuh registry · race claim (klaim lebih tua confirmed → DuplicateTransactionError, tanpa baris) · pemenang menulis baris tunggal · wait-loop → confirm tiba dalam window → replay · deteksi duplikat lokal → DuplicateTransactionError tanpa invalidate cache |

**Batas jujur**: claim read-modify-write localStorage tidak atomic lintas-tab
(tanpa Web Locks / BroadcastChannel — butuh worker/secure context); format
per-key + claim-and-verify (nonce + timestamp) membuat semua tab berkonvergen
pada pemenang yang sama secara deterministik dan mengecilkan window race ke
urutan milidetik, bukan menghilangkan 100%. Server tetap sumber kebenaran
final: unique partial index `(user_id, gmail_message_id)` (migration 0003)
menolak duplikat ENFORCED di sisi server — registry hanya mencegah duplikat
di jalur fallback lokal.

### 10.11 P0 Gmail Data Integrity — wrap-up (2026-08-11)

Kontrak lengkap: `docs/gmail/GMAIL_DEDUPLICATION_CONTRACT.md`. Menutup P0:

**npm commands (baru)**:

```bash
npm run db:audit:gmail-duplicates     # dry-run read-only = audit (default)
npm run db:cleanup:gmail-duplicates   # sama; eksekusi butuh --execute + env guard + konfirmasi
```

**Tool cleanup diperluas** (`scripts/gmailDuplicateCleanup.mjs`):
- Laporan audit kini memuat breakdown **by month & by source** + dampak saldo
  per user (matriks P0 §12: users · messages · duplicate rows · by month ·
  by source · by type · financial impact).
- **Audit trail ke `admin_audit_log`** (reuse tabel ops — tidak ada tabel
  baru): action `gmail_duplicate_cleanup`, result `dry_run`/`success`/`failure`,
  metadata agregat (scope, limit, matchingMode, groupsDetected, rowsDeleted,
  driftMessages, affectedUsers, financialImpact per user) — TANPA payload
  transaksi penuh / body Gmail / token.

**Verifikasi end-to-end (temp DB libsql, QA 2026-08-11)**:

```text
guard eksekusi tanpa GM_DUP_CLEANUP_EXECUTE → exit 1, nol mutasi
dry-run breakdown: by month (2026-03:2, 2026-06:1, 2026-08:1) + by source (gmail:4)
audit dry_run tercatat (groupsDetected=3, rowsDeleted=0)
execute: backup dibuat → delete 4 baris → verify recount 0 → keep-oldest (a1,b1,c1)
baris manual & multi-key TIDAK tersentuh · audit success tercatat (rowsDeleted=4)
rerun → "Tidak ada grup duplikat" (idempoten)
```

**DB dev live (re-verified)**: 0 grup duplikat `(user_id, gmail_message_id)`;
unique index `idx_transactions_gmail_msg_unique` terpasang; migration 0003
applied (checksum consistent); `db:migrate:check` PASS; audit `dry_run`
tercatat di `admin_audit_log` pada audit 2026-08-11T04:21Z.

**Debt tersisa (jujur)**: incremental sync (historyId) belum ada (rescan +
dedupe membuat sync idempoten — P2); E2E "sync penuh dua kali" butuh mock
Gmail API (di-cover unit + E2E API-level `fraud-detection.spec.ts` — P2);
restore otomatis dari backup belum ada (backup JSON lengkap — P2).

**Financial**: formula canonical TIDAK berubah. Cleanup dev (631+2 baris,
approval eksplisit §10.7a) mengubah balance eksak sesuai dampak duplikat
(−9.329.062,47 → −6.608.610,92); SQL ≡ `computeFinancialSummary` ≡ API ≡ UI.

### 10.12 Real Balance Reconciliation — CANONICAL LEDGER (2026-08-11)

Rekonsiliasi menyeluruh dari DB aktual (mandat "DB > API > service > UI",
range eksplisit `[2026-01-01, 2026-08-12)`), user dev utama
`pJV0rIAI6uTYP8JJa8VAGnrr3DcQ3CCB` (qoidrifat23@gmail.com).

**Forensic snapshot (read-only SQL, 2026-08-11):**

```text
Total rows (lifetime) : 391 · min 2025-11-10 · max 2026-08-09
  gmail 379 · manual 12 · lainnya 0
Range [2026-01-01, 2026-08-12): 390 baris
  income 110 × 22.492.575 · refund 14 × 301.845,14 · expense 191 × 19.754.869,06 · transfer 75 × 9.312.162
Lifetime: income 110 × 22.492.575 · refund 14 × 301.845,14 · expense 192 × 19.882.869,06 · transfer 75 × 9.312.162
  (selisih 1 baris = expense 128.000 tanggal 2025-11-10 — di luar range)
```

**Duplikat (re-audit ulang, bukan laporan lama):**

```text
Grup duplikat gmail_message_id (range & lifetime): 0  ← cleanup §10.7a BERTAHAN
Grup duplikat idempotency_key                     : 0
Fingerprint identik (audit only, bukan delete)    : 10 grup (mis. blu 10.000 ×7 di 2026-06-01
                                                    = transaksi berulang sah, bukan duplikat)
Canonical = raw (0 baris perlu dikeluarkan)        : 391 == 391
```

**Canonical balance (SQL oracle = Method A):**

```text
Range    [2026-01-01, 2026-08-12) : -6.272.610,92  (390 baris)
Lifetime (definisi bisnis §3)     : -6.400.610,92  (391 baris, termasuk 2025-11)
  = income 22.492.575 + refund 301.845,14 − expense 19.882.869,06 − transfer 9.312.162
```

**Method B — `computeFinancialSummary` (aplikasi) dijalankan atas DB yang sama:**

```text
lifetime : { totalIncome 22.794.420,14, totalExpense 29.195.031,06, balance -6.400.610,92, count 391 }
monthly 8 : { totalIncome 565.551, totalExpense 324.076, balance 241.475, count 15 }
Method A == Method B  ✅ (identik ke sen)
```

**Rekonsiliasi UI — angka dashboard 2026-08-11:**

| Kartu | UI | SQL/API | Status |
| ----- | --: | ------: | :----: |
| Total Saldo | −Rp6.400.610,92 | lifetime −6.400.610,92 | ✅ |
| Pemasukan Bulan Ini | +Rp565.551 | monthly income+refund 565.551 | ✅ |
| Pengeluaran Bulan Ini | −Rp324.076 | monthly expense+transfer 230.282+93.794 | ✅ |
| Sisa Budget | Rp0 / "Belum ada budget" | 0 budget Agustus dikonfigurasi → semantic "Belum ada budget" (§10.3) | ✅ |

**Catatan rentang (jujur)**: Total Saldo adalah **lifetime net cash flow**
(definisi bisnis §3, tidak diubah). Nilai range `[2026-01-01, 2026-08-12)` =
**−6.272.610,92** — selisih terhadap lifetime (−6.400.610,92) tepat = 1
transaksi expense Rp128.000 tanggal 2025-11-10 yang berada di luar range.
Menghapus transaksi tersebut dari saldo hanya karena batas rentang akan
mengubah definisi saldo yang terdokumentasi → TIDAK dilakukan (akurasi >
tampilan; DB adalah source of truth). Angka yang tampil di UI
**−6.400.610,92 adalah saldo lifetime canonical yang benar** berdasarkan
database aktual.

**Lapisan → angka (wajib identik):**

```text
SQL oracle          : -6.400.610,92
computeFinancialSummary : -6.400.610,92  (identik)
API /api/transactions/summary : meneruskan computeFinancialSummary (thin wrapper)  → identik
Frontend DashboardPage : summary.lifetime.balance (tanpa agregasi ulang)          → identik
UI (formatCurrency + negative prop) : "-Rp6.400.610,92" (tanda minus dipertahankan)  → identik
```

**Rantai verifikasi**: `DashboardPage` membaca `summary.lifetime.balance`
langsung (bukan `transactions.reduce`); `StatCard` menampilkan prefix `-`
merah via prop `negative={balance < 0}` (bukan `Math.abs` tanpa tanda);
summary windowless tanpa LIMIT (LIFETIME_SUMMARY_SQL); transaction list tetap
paginated (data terpisah — performance §30 tidak dilanggar). 47 test
rekonsiliasi PASS (financialSummary 16 + financialSummaryReconciliation 15 +
transactionSummaryRoute + transactionGmailDedupe).

**Kesimpulan**: kalkulator finansial CashFlow **benar dan tervalidasi**;
ledger kanonik **bebas duplikat Gmail** (0 grup, index unique terpasang);
**REAL BALANCE VERIFIED — PASS**.

### 10.13 Transfer internal = netral — `own_accounts` (2026-08-11, approval user)

#### Konteks

User melaporkan `−Rp6.400.610,92` terasa anomali karena kondisi finansial
nyata tidak minus. Rekonsiliasi forensik read-only (2026-08-11) menemukan
penyebabnya **bukan kalkulator** (semua lapisan identik, §10.12) melainkan
**klasifikasi data**: 72 dari 75 transfer (Rp9.025.162 dari Rp9.312.162 =
97%) mengarah ke merchant yang merupakan **akun milik user sendiri**
(LINE Bank, Bank Jago, blu) — uang berpindah antar-akun sendiri, dicatat
dua kali (transfer keluar −, income masuk +), bukan pengeluaran nyata.

Keputusan produk (user, 2026-08-11):

```text
Transfer internal (ke akun milik sendiri) = NETRAL
Skr A: transfer ke akun sendiri TIDAK mengurangi saldo; transfer ke pihak
      lain TETAP = expense.
Skr B: income PASANGAN transfer internal (same-day same-amount
      same-merchant) juga TIDAK menambah saldo — menutup inflasi pendapatan.
Akun milik sendiri: LINE Bank, blu, Bank Jago, DANA, ShopeePay, Krom Bank.
```

#### Formula baru (canonical, default backward-compat)

```text
balance = Σ income + Σ refund − Σ expense − Σ transfer_ke_pihak_lain
        − Σ income_pasangan_internal

transfer_ke_pihak_lain = SUM(amount WHERE type='transfer'
                              AND merchant NOT IN (own_accounts))

income_pasangan_internal = SUM(amount WHERE type='income' AND id IN (
    -- income + transfer, merchant SAMA di own_accounts, tanggal SAMA,
    -- amount SAMA; pairing 1:1 MIN-pair per grup (date, amount, merchant),
    -- tie-break id ASC (ROW_NUMBER) — deterministik & idempoten
    SELECT i.id FROM (income|transfer candidates) i
    JOIN ... ON t.merchant = i.merchant AND t.d = i.d
             AND t.amount = i.amount AND t.rn = i.rn
))

own_accounts KOSONG (default) → perilaku LEGACY persis (semua transfer =
expense; income TIDAK pernah dinetralkan)
```

Agregasi expense (Skr A) dan income (Skr B) berubah; refund TIDAK pernah
masuk pairing; monthly ByCategory (`type='expense'` saja) tidak tersentuh.
Konvensi tanda Model B tetap (amount selalu positif di DB). Deteksi pasangan
adalah **windowless lifetime SQL** (bukan window 100) dan diterapkan ke
query lifetime MAUPUN monthly (same-day ⇒ pasangan selalu dalam bulan yang
sama — set id yang sama aman untuk keduanya).

#### Implementasi

| File | Perubahan |
| ---- | --------- |
| `server/migrations/0004_user_financial_settings.sql` | **Baru** — tabel `user_financial_settings(user_id PK REFERENCES users(id), own_accounts TEXT JSON default '[]', created_at, updated_at)`; idempoten; TIDAK menyentuh data transaksi |
| `server/lib/schemaContract.js` | `user_financial_settings` + kolom wajib masuk REQUIRED_TABLES / REQUIRED_COLUMNS |
| `server/lib/financialSummary.js` | `parseOwnAccounts` (JSON robust) · `buildSummaryQuery(ownAccounts)` — SQL dinamis `merchant NOT IN (...)` hanya saat daftar non-kosong (empty = konstanta legacy) · **Skr B**: `internalIncomePairsSql` + `findInternalIncomePairIds` (CTE `ROW_NUMBER` min-pair, deterministic id ASC, user-scoped, tanpa LIMIT) → `excludeIncomeIds` disuntik sebagai `AND NOT (type='income' AND id IN (...))` di query lifetime & monthly · `computeFinancialSummary` menerima opsi `ownAccounts` |
| `server/routes/transactionRoutes.js` | `GET /api/transactions/summary` baca `own_accounts` dari DB settings SEKALI per request → diteruskan; tabel absent → `[]` (legacy) |
| `server/routes/financialSettingsRoutes.js` | **Baru** — `GET/PUT /api/financial/settings` (requireAuth + user-scoped + validasi fail-closed: array string ≤191 char/akun, ≤100 akun, duplikat dibuang; upsert `ON CONFLICT(user_id)`) |
| `server/index.js` | Register `financialSettingsRoutes` |
| `src/services/financialSettingsService.ts` | **Baru** — `getFinancialSettings()/putFinancialSettings()` (apiGet/apiPut) |
| `src/services/transactionService.ts` | `calculateBalance(transactions, ownAccounts?)` — paritas tanda client: transfer ke merchant di `ownAccounts` TIDAK masuk expense (Skr A) **+ income pasangan internal dinetralkan** (Skr B, helper `findInternalIncomePairIds` — rule sama persis server: same-day same-amount same-merchant, min-pair id ASC); default `[]` = perilaku lama |
| `src/features/reports/ReportsPage.tsx` | Muat `ownAccounts` (getFinancialSettings) → diteruskan ke `calculateBalance` |
| `src/features/settings/SettingsPage.tsx` | Section **"Akun Milik Sendiri"**: chip input tambah/hapus akun → `PUT /api/financial/settings` |

#### Verifikasi DB dev live (2026-08-11, user pJV0r…CCB, seed approval user)

```text
own_accounts (DB) : ["LINE Bank","blu","Bank Jago","DANA","ShopeePay","Krom Bank"]

Sebelum (legacy)  : income 22.794.420,14 · expense 29.195.031,06 · balance -6.400.610,92
                    monthly 8: income 565.551 · expense 324.076 · balance 241.475
Skr A (netral)    : income 22.794.420,14 · expense 20.169.869,06 · balance +2.624.551,08
                    monthly 8: income 565.551 · expense 230.282 · balance +335.269
Skr B (2026-08-11): income 21.166.062,14 · expense 20.169.869,06 · balance +996.193,08
                    monthly 8: income 565.551 · expense 230.282 · balance +335.269
                    (income lifetime −1.628.358 = 13 pasangan internal dinetralkan;
                     monthly TIDAK berubah — 0 pasangan di Agustus)

Delta Skr A        : +9.025.162 (transfer internal ke akun sendiri yang kini netral)
                     = 75 transfer lifetime − 3 transfer pihak lain (287.000)
Delta Skr B        : −1.628.358 (income pasangan transfer internal yang kini netral)
```

Hasil konsisten dengan keputusan **Skr B (+996.193,08**, positif — sejalan
dengan persepsi finansial user). Angka negatif/positif ditampilkan jujur:
StatCard `negative` prop + prefix `-`; tidak ada `Math.abs` penyembunyian.

#### Catatan jujur / risiko

- **Income pasangan transfer internal DINETRALKAN (Skr B, 2026-08-11)** —
  menutup risiko inflasi pendapatan Rp1.628.358 (13 pasangan same-day
  same-amount same-merchant, hasil audit forensik deterministik yang
  mereproduksi persis angka terdokumentasi; bucket tidak seimbang di-pair
  min-pair, tie-break id ASC). Balance: +2.624.551,08 → **+996.193,08**.
  Rule pairing (SAMA merchant) sengaja KONSERVATIF — pasangan merchant
  berbeda (mis. transfer ke LINE Bank + income di blu) TIDAK dinetralkan
  (konteks Gmail parse bisa ambigu); itu sisa risiko kecil yang jujur
  didokumentasikan, bukan di-overrule tanpa bukti.
- **Biaya pairing per request**: deteksi pasangan menjalankan SATU CTE scan
  windowless per panggilan summary (trivial di skala saat ini — 391 baris;
  untuk dataset 100k+ dapat di-cache per `(userId, ownAccounts)` bila
  diperlukan). Server-side indexed scan — bukan fetch seluruh transaksi ke
  browser.
- **Sumber kebenaran konfigurasi** = `own_accounts` per user; akun yang
  ditambahkan/dihapus user di Settings langsung mengubah agregasi summary
  (tanpa mengubah satu baris transaksi pun — DB transaksi tetap utuh).
- **Backward-compat**: tabel absent / `own_accounts` kosong → formula legacy
  identik; semua test lama tetap hijau.
- Transfer ke pihak lain (Zuhri, Budi, Tossa — Rp287.000) TETAP expense
  (bukan akun sendiri).

## 11. P2.5 — Account-Based Real Balance Engine (2026-08-11)

### 11.1 Masalah yang diselesaikan

Sebelum P2.5, `Total Saldo` dashboard = **Lifetime Net Cash Flow** (Mode B,
Skr A/B) — BUKAN saldo riil. Pertanyaan "berapa uang yang saya punya sekarang?"
dijawab dengan angka yang tidak pernah dirancang untuk itu:

```text
Total Saldo (lama)  = Σ income + Σ refund − Σ expense − Σ transfer_eksternal
                      − Σ income_pasangan_internal   (Skr A/B)
                    = +Rp996.193,08 untuk user dev
```

P2.5 membangun **ledger account-based** yang membedakan dengan tegas:

```text
1. Current Balance      = opening_balance + pergerakan per akun (status jujur)
2. Lifetime Net Cash Flow = Mode B (Skr A/B) — tetap, metrik terpisah
3. Monthly Income/Expense = half-open bulanan (tidak berubah)
4. Internal Transfer      = 2 leg akun milik sendiri → net 0 aggregate
5. External Transfer      = leg tunggal → mengurangi balance
6. Opening Balance        = input user per akun (TIDAK pernah ditebak)
7. Unclassified           = transaksi tanpa account_id / akun bukan milik user
8. Reconciliation         = balanced | warning | unknown
```

### 11.2 Definisi kanonik (semantik, bukan heuristik)

```text
current_balance (per akun) =
    opening_balance
  + income + refund + incoming_transfer
  − expense − outgoing_transfer
  (internal transfer pair → net 0 pada aggregate owned accounts)

net_cash_flow (lifetime, Mode B) =
    Σ income + Σ refund − Σ expense − Σ transfer_eksternal − Σ income_pasangan
```

Kedua metrik punya jalur hitung BERBEDA (`server/lib/financialLedger.js` vs
`server/lib/financialSummary.js`) dan TIDAK boleh dicampur. `Total Saldo` di
UI diganti label jujur: **Arus Kas Bersih** (net cash flow) + kartu baru
**Saldo Saat Ini** (ledger).

### 11.3 Status jujur — known / partial / unknown

| Status | Syarat | Contoh tampilan |
| ------ | ------ | --------------- |
| `known` | semua akun punya opening balance + 0 unclassified | angka |
| `partial` | ada akun tanpa opening ATAU ada transaksi unclassified | "Saldo sebagian" + angka akun known + penjelasan |
| `unknown` | belum ada akun ATAU tidak ada opening balance sama sekali | "Belum dapat dihitung" + reason + CTA |

**DILARANG menebak opening = 0** dan **DILARANG menampilkan Rp0** saat data
belum lengkap — status `unknown` adalah hasil yang benar.

### 11.4 Semantik opening balance date

`opening_balance` = saldo pada **START-of-day** `opening_balance_date`;
transaksi dengan `transaction_date >= opening_balance_date` MASUK pergerakan
(inclusive). Tanpa tanggal → seluruh riwayat ter-link dihitung. Konsisten &
terdokumentasi (tidak ada off-by-one).

### 11.5 Semantik transfer (ledger account-based)

- Leg eksplisit: `metadata.transferRole = 'out' | 'in'` — arah pasti.
- Pasangan klasik (2 leg, group sama, tanpa role) → `internalTransferPair`,
  net 0 aggregate; arah per-akun TIDAK ditebak (unresolved).
- Leg tunggal tanpa role → **outgoing eksternal** (mengurangi balance) —
  konservatif, bukan asumsi internal.
- Heuristik Skr A/B TETAP dipakai — tetapi HANYA untuk `netCashFlow`
  (Mode B), sebagai **legacy heuristic reconciliation**, bukan accounting
  truth. Ledger account-based TIDAK menebak pasangan tanpa group id.

### 11.6 Migration (versioned, additive)

| Migration | Perubahan |
| --------- | --------- |
| `0005_wallet_account_opening_balance.sql` | `wallet_accounts.opening_balance` (REAL nullable) · `opening_balance_date` (TEXT) · `currency` (TEXT default 'IDR') |
| `0006_transaction_account_linkage.sql` | `transactions.account_id` (nullable) + index `(user_id, account_id)` |
| `0007_transfer_group_id.sql` | `transactions.transfer_group_id` (nullable) + index `(user_id, transfer_group_id)` |

Tanpa DROP/DELETE/UPDATE data; legacy rows tetap NULL-safe (backward-compat).
Tidak ada FK enforced (libSQL lokal default off; NULL legacy aman).

### 11.7 Verifikasi real DB (2026-08-11, user pJV0r…CCB — read-only)

```text
SQL oracle (independen)        = ledger engine (computeLedgerSummary)
Skr A balance                  : 2.624.551,08 ✓
Skr B balance                  :   996.193,08 ✓
external transfer              :     287.000 ✓ (3 transfer pihak lain)
paired income (Skr B)          :   1.628.358 ✓ (13 pasangan)
ledger.netCashFlow === oracle  : true

ledger.currentBalance          : { status: 'unknown', reason: 'no_accounts' }
  → user dev BELUM punya wallet_accounts → SALDO SAAT INI = UNKNOWN (jujur)
  → unclassified: 391 transaksi / Rp51.989.451,20 (semua legacy tanpa akun)
```

Live API (`GET /api/transactions/summary`, sesi dev user) → HTTP 200,
field lama identik (backward-compat) + `ledger` baru.

### 11.8 Unclassified & partial (data quality jujur)

`account_id IS NULL` ATAU mengarah ke akun bukan milik user → dihitung
`unclassified.count` + `unclassified.amount` (windowless). Bila ada →
`currentBalance.status = 'partial'` — UI menampilkan "Saldo sebagian" +
peringatan + CTA "Tinjau transaksi". Tidak ada yang disembunyikan.

### 11.9 Invariant yang dijaga test

- opening = 0 / 1.000.000 / negatif (credit card) → closing yang benar.
- internal transfer (2 leg, role) → per-akun −/+ , aggregate netral.
- external transfer (leg tunggal) → balance menurun.
- transaksi sebelum opening date tidak dihitung; tanggal sama dihitung.
- unclassified → partial; tanpa opening → unknown; lengkap → known.
- user isolation + account_id cross-user tidak ter-attribusi (JOIN user-scoped).
- windowless (55+ baris ter-link → agregasi penuh); presisi 0.01/0.10/999999999.99.

---

## 12. P2.6 — Assisted Ledger Reconciliation & Real-Balance Verification (2026-08-11)

P2.5 membuktikan Current Balance = UNKNOWN untuk user development (0 rekening,
391 transaksi tanpa `account_id`). P2.6 membangun jembatan aman dari UNKNOWN ke
VERIFIED tanpa mengarang angka finansial.

### 12.1 Tujuan

- Onboarding rekening: nama, tipe, mata uang, `opening_balance`, `opening_balance_date`.
- Assisted classification: saran akun per transaksi (deterministik, bukan AI),
  user review → confirm → persist `account_id`.
- Transfer reconciliation: kandidat pasangan (tanggal + nominal + merchant,
  min-pair 1:1) → user confirm → `transfer_group_id` + role.
- Real-balance verification: bandingkan saldo sistem vs saldo nyata; mismatch
  ditampilkan, TIDAK ada adjustment otomatis.

### 12.2 Status model (deterministik, §6)

| Status | Syarat |
| ------ | ------ |
| `unknown` | belum ada akun ATAU belum ada opening balance sama sekali |
| `partial` | akun + opening ada, tapi masih ada unclassified / transfer unresolved |
| `reconciled` | opening lengkap + semua transaksi ter-link + transfer resolved |
| `verified` | reconciled + semua akun ter-verifikasi terhadap saldo nyata |

`balanceConfidence` (unknown/low/medium/high/verified) mengikuti rule yang sama
— TIDAK pernah dari judgment AI.

### 12.3 Suggestion engine (`server/lib/reconciliationEngine.js`)

`suggestTransactionAccount()` — deterministik:

- HIGH — merchant eksak cocok akun terkonfigurasi ATAU `account_id` ter-set
  (re-confirm). Bila merchant cocok `own_accounts` tapi akun belum dibuat di
  `wallet_accounts` → usulkan NAMA akun (accountId null, requiresReview) —
  UI menampilkan "Buat rekening dulu", BUKAN auto-assign.
- MEDIUM — substring brand / payment_method cocok (requiresReview).
- LOW — tanpa sinyal → null. **Tidak pernah menebak dari nominal/tanggal saja.**

Bulk "Terima semua HIGH": `classifyBySuggestion()` re-evaluasi TIDAK setiap
transaksi pending dan hanya mengklasifikasikan yang suggestion-nya cocok persis
(accountId + confidence). Idempoten (audit tidak duplikat).

### 12.4 Transfer pairing

`suggestTransferPairs()` — deterministik min-pair 1:1 (1 transfer + 2 kandidat
income → hanya 1 pasangan). Kandidat ≠ truth: pairing diterapkan HANYA setelah
user confirm via `POST /api/reconciliation/transfer-pair` (audit
`transfer_paired`). Transfer pair = netral terhadap total owned accounts.

### 12.5 Verifikasi saldo nyata

`POST /api/reconciliation/verify-balance` { accountId, actualBalance, date }:

- `systemBalance` dihitung dari ledger canonical (opening + movements).
- `actual == system` → `verified` (real_balance + tanggal tercatat).
- `actual != system` → `mismatch` — selisih ditampilkan + penyebab mungkin
  (transaksi hilang, saldo awal salah, transfer belum dipasangkan, duplikat,
  coverage gap). **Tidak ada adjustment otomatis; tidak ada transaksi baru dibuat.**

### 12.6 API (append-only, backward-compatible)

| Endpoint | Fungsi |
| -------- | ------ |
| `GET /api/reconciliation/state` | matriks lengkap + saran + progress (resume) |
| `POST /api/reconciliation/classify` | konfirmasi 1 klasifikasi |
| `POST /api/reconciliation/classify-bulk` | batch eksplisit (transactionId list) |
| `POST /api/reconciliation/classify-by-suggestion` | bulk by (accountId, confidence) — deterministic |
| `POST /api/reconciliation/transfer-pair` | konfirmasi pasangan transfer |
| `POST /api/reconciliation/verify-balance` | verifikasi saldo nyata |
| `GET /api/transactions/summary` | + field `reconciliation` (counts + status, ringan) |

Semua endpoint `requireAuth` + user-scoped (userId dari session); validasi
fail-closed (400 VALIDATION_ERROR). Observability: `reconciliation_started/
_completed/_failed`, `account_assignment_confirmed`, `transfer_pair_confirmed`,
`balance_verified`, `balance_mismatch` — hanya requestId/duration/counts,
tanpa nominal/payload.

### 12.7 Keamanan & integritas

- User A tidak dapat: assign transaksi ke akun user B, verifikasi akun user B,
  membaca state user B (semua query `WHERE user_id`).
- Audit trail `reconciliation_audit_log`: actor, timestamp, transaction_id,
  old/new account_id & transfer_group_id, reason, action — tanpa payload sensitif.
- Idempotensi: run ulang classify/pair/verify → no-op, tanpa duplikat.
- Migrasi 0008 (additive): `real_balance`, `real_balance_date`,
  `real_balance_verified_at`, `account_review_status`, tabel audit. Tidak ada
  kolom/baris lama yang diubah.

### 12.8 Invariant yang dijaga test

- classify deterministik + user-confirmed; tanpa accountId → "Buat rekening dulu".
- idempoten (2× run → 0 applied kedua, audit tidak dobel).
- cross-user ditolak (classify, verify, pair).
- GOLDEN: A=1jt, B=2jt, income 500k, expense 200k, transfer A→B 300k →
  A=1.000.000, B=2.300.000, total 3.300.000 (transfer netral).
- status: unknown/partial/reconciled/verified per §12.2 (deterministik).
- verify: verified diff 0; mismatch tanpa auto-fix (tidak ada transaksi baru).
- E2E live (e2e/reconciliation-flow.spec.ts): rantai onboarding → klasifikasi →
  idempotensi → reconciled → verified → IDOR → validasi 400.

### 12.9 Batasan (jujur)

- Selama `wallet_accounts` kosong dan `account_id` NULL, Current Balance tetap
  UNKNOWN — inilah hasil yang benar, bukan kegagalan.
- Suggestion HIGH berbasis `own_accounts` hanya *evidence*; pembuatan akun tetap
  keputusan user (tidak ada auto-create).
- Coverage tanggal (2025-11-10 → 2026-08-09 dev user) tidak sama dengan
  riwayat saldo nyata; verifikasi saldo nyata wajib dilakukan user.

---

## 13. P2.7 — Verified Balance Anchor & Post-Anchor Roll-Forward (2026-08-11)

P2.6 menyediakan *mekanisme* rekonsiliasi; P2.7 membangun **real-world balance
anchor**: sistem berpindah dari UNKNOWN ke VERIFIED berdasarkan saldo aktual
yang benar-benar diketahui user — tanpa memaksa user tahu saldo historis.

### 13.1 Definisi anchor

Anchor = snapshot saldo AKTUAL yang diverifikasi user pada tanggal tertentu:

```
wallet_accounts.real_balance          (saldo aktual — kebenaran user)
wallet_accounts.real_balance_date     (anchor date)
wallet_accounts.real_balance_verified_at (timestamp verifikasi)
wallet_accounts.balance_anchor_status ('verified' | 'mismatch' — outcome)
```

Field P2.6 (0008) dipakai ULANG — **TIDAK ada struktur paralel**. Migration
0009 hanya menambah `balance_anchor_status` (outcome verifikasi yang TIDAK
bisa diturunkan ulang: setelah anchor, pergerakan post-anchor membuat selisih
vs closing itu wajar, bukan mismatch).

### 13.2 Semantik tanggal (END-of-day, tegas)

```
balance_anchor_date = saldo pada END-OF-DAY tanggal tsb.
Pergerakan post-anchor: transaction_date > balance_anchor_date  (STRICTLY)
```

Transaksi PADA/SEBELUM anchor date TIDAK dihitung ulang (sudah tercakup dalam
snapshot) — mencegah double counting. Opening balance tetap START-of-day
(`>= opening_balance_date`) untuk jalur legacy tanpa anchor (backward-compat).

### 13.3 Formula

```
current_balance (per akun) = verified_anchor + Σ income/refund/incoming_transfer
                                           − Σ expense/outgoing_transfer
                                           (hanya transaction_date > anchor_date)
aggregate (IDR only)       = Σ per-akun   — cross-currency DITOLAK (§32)
```

### 13.4 Status machine (§15)

| Status | Syarat |
| ------ | ------ |
| `unknown` | tanpa akun / tanpa opening / tanpa anchor sama sekali |
| `known` | (fallback P2.5) opening-based, tanpa anchor |
| `partial` | sebagian akun ber-anchor (anchor_missing) ATAU cross-currency |
| `verified` | SEMUA akun aktif ber-anchor + tidak ada aktivitas post-anchor unresolved |
| `stale` | semua ber-anchor tapi ada transaksi unclassified post-anchor / transfer post-anchor unresolved |
| `mismatch` | outcome verifikasi tersimpan 'mismatch' (anchor ≠ sistem saat verifikasi) |

VERIFIED hanya jika SELURUH syarat §31 terpenuhi — tidak ada "pretended
precision". Anchor tanpa baseline diterima sebagai kebenaran user (REAL MONEY
> derived) dengan `difference = null`.

### 13.5 Verifikasi & audit (§23-28)

`POST /api/reconciliation/verify-balance` menyimpan anchor + outcome. Anchor
TIDAK pernah ditolak karena berbeda dari sistem — selisih ditampilkan + daftar
kemungkinan penyebab (transaksi hilang, saldo awal salah, transfer belum
terpasangkan, duplikat, coverage gap). TIDAK ada adjustment otomatis; TIDAK ada
transaksi koreksi dibuat. Audit per aksi:
`balance_anchor_created` / `balance_anchor_updated` (dengan nominal + tanggal
anchor lama → baru di reason; TANPA credential).

### 13.6 API & UI

- `GET /api/transactions/summary` → `ledger.currentBalance` + `anchorDate`;
  per-akun `anchor {amount,date,verifiedAt}` + `verificationStatus`;
  `reconciliation.anchoredAccounts` (append-only, backward-compat).
- Dashboard: kartu "Saldo Saat Ini" menampilkan amount hanya bila status
  verified/known/partial/stale/mismatch (bukan unknown) — unknown →
  "Belum terverifikasi" + CTA "Verifikasi Saldo" (TANPA Rp0/Rp996.193).
  Badge: Terverifikasi / Sebagian / Belum terverifikasi / Perlu pembaruan /
  Perlu pemeriksaan.
- Halaman /reconciliation: input "Saldo aktual (Rp) — per tanggal hari ini" +
  tombol "Tandai terverifikasi"; selisih sistem vs aktual ditampilkan.

### 13.7 Invariant yang dijaga test (golden §38 + matriks §37)

- Anchor tanpa opening → VERIFIED (bukan unknown); golden: blu 3jt + Jago 2jt
  + income 500k − expense 200k − transfer out 100k + refund 50k = 5.250.000.
- Transaksi sebelum/pada anchor date TIDAK dihitung; setelahnya dihitung.
- Transfer internal post-anchor netral (tidak double-count).
- Unclassified/unresolved post-anchor → STALE; unclassified HISTORIS tidak
  merusak status (anchor sudah mencakupnya).
- Mismatch tersimpan → status MISMATCH, tanpa auto-fix.
- Cross-currency → agregasi null/ditolak; cross-user → akun user lain tidak
  dijumlah; anchor user lain tidak bisa diverifikasi.
- Presisi: 0.1 + 0.2 = 0.3 (round2), bukan floating drift.

### 13.8 Net Cash Flow TIDAK berubah

Skr A/B legacy heuristic TIDAK tersentuh: `netCashFlow` dev user tetap
996.193,08 (golden regression PASS). `Arus Kas Bersih` ≠ `Saldo Saat Ini` —
keduanya boleh berbeda; perbedaan itu tanda semantic model benar, bukan error.

### 13.9 Batasan

- Anchor membutuhkan aksi user (masukkan saldo aktual + konfirmasi). Sampai
  dilakukan, Current Balance = UNKNOWN — jawaban yang benar.
- Pergerakan post-anchor hanya transaksi TER-LINK ke akun; transaksi legacy
  sebelum anchor tidak merusak balance (anchor mencakupnya).
- `balance_anchor_status` adalah outcome pada SAAT verifikasi; anchor TIDAK
  pernah ditimpa secara diam-diam (audit balance_anchor_updated).

## 14. P2.8 — Real-World Account Activation & Verified Ledger Activation (2026-08-11)

P2.7 membangun mesin anchor; P2.8 melengkapi jalur dari `UNKNOWN` ke
`VERIFIED` dengan tiga kemampuan yang belum ada: **aktivasi akun dari
kandidat terdeteksi**, **tolak saran** (klasifikasi & transfer), dan
**idempotensi pairing**.

### 14.1 Aktivasi Akun (Account Activation)

- `own_accounts` (kandidat: LINE Bank, blu, Bank Jago, DANA, ShopeePay, Krom
  Bank) TIDAK pernah dibuat otomatis — hanya di-expose sebagai
  `state.accountCandidates` (own_accounts yang belum jadi rekening).
- UI `/reconciliation` merender CTA "Tambahkan Rekening" per kandidat; dialog
  aktivasi meminta konfirmasi (nama ter-prefill, jenis bisa diubah, currency
  IDR). Pembuatan = keputusan eksplisit user via `POST /api/wallets`
  (endpoint existing, user-scoped).
- Inferensi tipe HANYA default (bank untuk LINE/Krom/blu, e-wallet untuk
  DANA/ShopeePay/Gopay/OVO) — bukan kebenaran; user boleh mengubah sebelum
  simpan. Rekening baru lahir tanpa saldo awal (jangan menebak 0).

### 14.2 Tolak Saran (Reject — Suggestion ≠ Truth)

- **Klasifikasi** (§13): `POST /api/reconciliation/classify-reject`
  (accountId + confidence) → engine re-evaluasi deterministik, transaksi
  pending yang cocok persis ditandai `account_review_status='rejected'`
  (audit `account_rejected`). Transaksi TIDAK di-assign dan TIDAK pernah
  diubah nominalnya; saran tidak muncul ulang. Idempoten; transaksi
  `confirmed` tidak pernah tersentuh.
- **Transfer** (§17): migration 0010 menambah `transfer_review_status`
  ('pending' | 'rejected'). `POST /api/reconciliation/transfer-reject` →
  transfer tetap `ungrouped/unresolved` (kejujuran), hanya sugesti pasangan
  yang berhenti muncul. Idempoten.

### 14.3 Idempotensi Pairing (§35/§36)

- `pairTransfer` memeriksa `transfer_group_id` existing: transfer yang sudah
  dipasangkan mengembalikan group yang sama TANPA mutasi dan TANPA audit
  duplikat (double-click / retry / network replay aman).

### 14.4 Tanggal Anchor Dipilih User (§10)

- Input `type="date"` di baris verifikasi menggantikan hardcode "hari ini".
  Semantik tetap END-OF-DAY (P2.7): `transaction_date > anchor_date`.

### 14.5 Status Machine & Dashboard (tidak berubah)

- Lima status P2.7 dipertahankan; dashboard CTA membedakan **tanpa rekening**
  ("Aktifkan Saldo" → /reconciliation) vs **ada rekening belum verified**
  ("Verifikasi Saldo").
- Settings menampilkan ringkasan "Saldo Aktual" per rekening (anchor status +
  link ke /reconciliation).

### 14.6 Keamanan & Integritas

- Semua endpoint user-scoped (`WHERE user_id = req.user.id`); body tidak
  pernah menjadi authority. IDOR E2E: user lain → state kosong, reject/pair
  → 400.
- Tidak ada auto-fix: reject tidak membuat adjustment; anchor tidak ditimpa
  diam-diam; transaksi legacy tidak diubah.
- Presisi round2 (2 desimal); SQL oracle independen (tanpa memanggil
  financialLedger) == engine hingga 2 desimal (test parity §63/§64).

### 14.7 Regresi

- `netCashFlow` golden 996.193,08 TIDAK berubah (Skr A/B untouched).
- Gmail duplicate protection untouched; migration 0009-0010 additive.
- Test: engine +16, routes +4, komponen +6, E2E +4 (total 12 dalam
  reconciliation-flow), SQL-oracle parity 1.

## 15. P2.9 — Real-World Reconciliation Completion (2026-08-11)

### 15.1 Tujuan

P2.8 menyediakan seluruh mekanisme (`UNKNOWN → PARTIAL → VERIFIED`) tetapi
belum ada *completion flow* yang membantu user menyelesaikan rekonsiliasi
dunia nyata. P2.9 menutup gap UX + hardening tanpa mengubah satu formula pun:

| Gap | Solusi P2.9 |
|-----|-------------|
| Tidak ada ukuran kemajuan jujur | `completionScore` deterministik dari state (§15.3) |
| 40 transaksi LOW tidak punya jalur assign | Checklist manual bulk-assign (§15.4) |
| `transfers.rejected` tidak terlihat | Count rejected di state + ringkasan |
| Aktivasi akun bisa double-create pada retry | Idempotensi `POST /api/wallets` (nama+type unik per user) |
| Saldo negatif diterima untuk semua tipe | Policy §19: negatif HANYA credit/investment (fail-closed) |
| Transaksi list tak tunjukkan penautan | Badge "Belum ditautkan" di TransactionItem (§31) |

### 15.2 Komponen Skor (deterministik, bukan klik user)

```text
score = round( akun_aktif/detected × 20%
             + anchor/akun            × 20%
             + linked/total_tx        × 35%
             + resolved/total_tr      × 25% )   ∈ [0, 100]
```

- Tanpa data → 0 (belum dimulai), TIDAK pernah 100 tanpa evidence.
- Rincian (accounts/anchors/transactions/transfers) ikut dirender di UI —
  angka dari DB, bukan hardcode.
- Skor hanya informasi; status finansial tetap dari state machine
  UNKNOWN/PARTIAL/VERIFIED/STALE/MISMATCH.

### 15.3 LOW manual bulk-assign (§12)

- Transaksi LOW (tanpa sinyal akun) di-expose via `state.unassignedTransactions`
  (id/merchant/amount/date — tanpa payload sensitif).
- **Tidak pernah auto-assign**: checkbox (select-all opsional) + pilih rekening
  + [Terapkan] → dialog dampak finansial (jumlah + total) → konfirmasi →
  `POST /api/reconciliation/classify-bulk` (pairs `{transactionId, accountId}`).
- Server memverifikasi ownership akun & transaksi per baris; idempoten
  (run kedua → applied 0).
- **Transfer TIDAK masuk daftar ini** — transfer punya alur pairing sendiri
  (§14–17); memasukkannya ke checklist klasifikasi justru menyesatkan.

### 15.4 Kebijakan saldo aktual negatif (§19)

- `credit` / `investment` → negatif sah (kartu kredit / posisi short).
- `cash` / `bank` / `e-wallet` / `other` → 400 fail-closed (tanpa menebak
  "overdraft"); alasan eksplisit di respons.
- `0` selalu sah (saldo valid). NaN/Infinity/decimal invalid ditolak.

### 15.5 Dampak angka

- `netCashFlow` golden **996.193,08 TIDAK berubah** (Skr A/B untouched).
- Tidak ada transaksi dihapus/diubah; hanya linkage/status/audit.
- Ledger anchor P2.7 tidak tersentuh (END-of-day tetap `transaction_date > anchor_date`).

### 15.6 Test

- Unit engine +5 (completionScore ×2, LOW/rejected state, policy negatif,
  fixture 3-akun §50: Bank A 3,5jt / Bank B 3,75jt / E-wallet C 1,35jt,
  total 8,6jt — transfer internal netral di aggregate, same-day anchor excluded).
- Komponen +3 (skor render, LOW assign → classifyTransactionsBulk, disabled
  tanpa rekening). E2E +3 (state expose, classify-bulk idempoten, policy negatif).
- A11y 22/22 · Visual 16/16 · Unit 1389 · Build/TSC/Lint PASS.
- Fix infra test: `prepare-e2e-local-db.mjs` kini men-seed
  `gmail_sync_settings (auto_sync_enabled=1)` → gate a11y gmail-sync
  deterministik pada DB fresh (sebelumnya bergantung state sisa run lama).

## 16. P3.0 — Real-World Activation: LOW filter, mismatch hints, step indicator (2026-08-11)

Melanjutkan P2.9 (capability lengkap) → P3.0 (kelengkapan UX siklus nyata). TIDAK ada
perubahan schema (0001–0010 tetap), TIDAK ada perubahan formula finansial, Net Cash Flow
golden `Rp996.193,08` tidak tersentuh. Semua gap diturunkan dari kolom existing.

### Gap yang diimplementasikan (minimal, evidence-driven)

1. **§12 — Filter jenis pada checklist transaksi LOW.** `unassignedTransactions` kini
   membawa field `type` (income/expense/refund; transfer sudah dikecualikan — jalur
   resolusinya pairing §14–17, bukan assign). UI menambah filter
   `Semua / Pemasukan / Pengeluaran / Refund` agar daftar 37+ item tidak menjadi
   dinding checkbox. Pilihan ter-reset saat filter berubah → "Terapkan (N)" hanya
   menghitung item yang benar-benar tampil (tidak ada aksi tersembunyi).
2. **§18 — Panel "Kemungkinan penyebab" saat mismatch.** Setelah verifikasi saldo
   menghasilkan `mismatch`, UI menampilkan daftar kemungkinan yang DIFILTER oleh
   evidence nyata dari state rekonsiliasi: jumlah transaksi belum terhubung (+ nominal),
   transfer belum dipasangkan, rekening terdeteksi belum diaktifkan — ditambah kandidat
   umum (saldo/tanggal anchor, transaksi di luar rentang, Gmail belum sinkron, cash tak
   tercatat). Dijaga sebagai *kemungkinan*, bukan kepastian (mandate §18). Tidak ada
   auto-fix / auto-adjustment.
3. **§28 — Indikator langkah eksplisit `N / 5`.** ProgressBar kini menampilkan
   `Langkah N / 5` + label langkah berikutnya (deterministik dari `onboardingProgress`),
   bukan hanya bar.

### State machine (tidak berubah dari P2.7–P2.9)

`UNKNOWN` (tanpa anchor) → `PARTIAL` (sebagian akun terverifikasi) → `VERIFIED`
(expected == actual) / `MISMATCH` (selisih ≠ 0, tanpa auto-fix) / `STALE` (aktivitas
post-anchor setelah verifikasi). `completionScore` tetap deterministik dari state.

### SQL oracle & parity

Oracle independen (raw SQL user-scoped) == Ledger == API == UI, exact 2-desimal.
Live: unlinked 391 · ungrouped 75 · accounts 0 → `completionScore 0` (jujur, belum ada
anchor). Net Cash Flow golden tidak berubah.

### Test

- Unit +4 (engine: field `type` + eksklusi transfer pada LOW; component: filter LOW,
  panel mismatch hints, step indicator). Total **1394 passed**.
- E2E reconciliation-flow **15/15** (test 13 kini juga mengunci field `type`).
- A11y **22/22** · Visual **16/16** · balance-anchor 7/7 · dashboard 5/5 ·
  transactions 3/3 · Build/TSC/Lint/Migration PASS.

### A11y hardening ikutan (determinisme scan, ter-expose saat gate diperkuat)

- Gate a11y gmail-sync kini menunggu indikator jumlah email (`Menampilkan X-Y dari Z
  email`) sebelum scan — kartu email (lazy chunk + fetch async) yang mount kemudian
  ter-scan saat fade opacity < 1 → axe meng-blend warna (bg #8d96a1 palsu, bukan token
  tema) → color-contrast false-positive. Ini MEMPERKUAT determinisme, tidak menurunkan
  threshold/aturan.
- Badge status email (STATUS_CONFIG + EmailCard confidence) light-mode `-500 on -50`
  (2.x:1) → `-700 on -50` (≥4.5:1, pola app: `text-amber-700 bg-amber-50`). Perbaikan
  kontras nyata yang ter-expose oleh determinisme scan.

## 17. P3.1 — Reconciliation Completion, Ledger Certification & Verified Balance Closure (2026-08-12)

Scope: completion + certification layer DI ATAS baseline P3.0. Tidak ada migration baru (0001–0010 tetap), tidak ada perubahan angka finansial, tidak ada perubahan Skr A/B (Net Cash Flow golden `Rp996.193,08` dipertahankan oleh test golden).

### Capability baru

1. **§21 Reassign eksplisit (correction flow)** — `classifyTransactions` menerima opsi `reassign`. Semantik:
   - transaksi `confirmed` + akun sama → no-op (idempoten, tanpa audit baru);
   - transaksi `confirmed` + akun beda → reassign + audit `account_reassigned` (old/new account tersimpan, tanpa payload sensitif);
   - transaksi `pending` → assign biasa (`account_assigned`).
   - classify biasa TIDAK pernah meng-overwrite akun confirmed secara diam-diam — hanya jalur eksplisit `POST /api/reconciliation/classify-reassign` yang bisa (user decision boundary §49 P3.0 tetap).
   - Anti-IDOR: akun target divalidasi `user_id = req.user.id` sebelum update.

2. **§19 Mismatch Waterfall kuantitatif** — response `POST /api/reconciliation/verify-balance` kini memuat `breakdown`:
   - `unclassifiedAmount` — SUM transaksi `account_id IS NULL` (user-scoped, windowless);
   - `unresolvedTransferAmount` — SUM transfer tanpa `transfer_group_id`;
   - `postAnchorMovements` — inflow/expense/incomingTransfer/outgoingTransfer akun (dari ledger account yang sama dengan yang diverifikasi).
   Komponen non-overlapping, semua dari evidence nyata; yang tak terukur TIDAK diisi angka palsu. UI menampilkan waterfall ini pada panel MISMATCH.

3. **UI "Perbaiki penautan"** — state rekonsiliasi kini mengekspos `linkedTransactions` (transaksi confirmed per akun); ReconciliationPage menampilkan bagian perbaikan dengan dialog reassign per baris (pilih rekening → konfirmasi). Amount/date/merchant/gmail_message_id TIDAK pernah diubah.

### Semantik yang DIVERIFIKASI (tidak diubah)

- Anchor = END-OF-DAY; hanya `transaction_date > anchor_date` yang dihitung sebagai post-anchor movement (transaksi PADA tanggal anchor tidak dihitung dua kali).
- Setiap `verify-balance` meng-re-anchor `real_balance` ke actual yang dimasukkan user (P2.7: anchor = kebenaran user). Status `verified` hanya ketika |actual − system| < 0,01; `mismatch` TIDAK pernah mengubah systemBalance dan TIDAK membuat adjustment/synthetic transaction.
- VERIFIED hanya jika: anchor ada + klasifikasi lengkap + transfer ambiguity ter-resolve + diff dalam toleransi + audit tercatat. Transaksi baru setelah verifikasi → `stale` (bukan verified tetap).

### Test hasil

- Unit: 1402 passed (baru: reassign idempotent/no-op/cross-user, golden §32, komponen waterfall/filter/step).
- E2E reconciliation-flow: 21/21 (termasuk Flow K→R: VERIFIED → STALE → reverify → MISMATCH −100.000 → waterfall → koreksi → VERIFIED final).
- Full financial E2E batch: 45/45. Migration check: PASS. Build/typecheck/lint: PASS.

### Known limitations

- Waterfall `postAnchorMovements` hanya mencakup akun yang diverifikasi; kontribusi lintas-akun (mis. misklasifikasi ke akun lain) hanya terlihat lewat selisih agregat dan panel investigasi kualitatif, bukan breakdown per-akun — sengaja (mencegah double-count).
- Setelah mismatch, anchor bergeser ke actual terakhir yang dimasukkan; koreksi dilakukan dengan memasukkan actual yang konsisten dengan ledger (bukan auto-adjust).
