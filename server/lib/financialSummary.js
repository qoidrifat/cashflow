/**
 * Financial summary — agregasi keuangan WINDOWLESS (server-side).
 *
 * ROOT CAUSE (insiden 2026-08-08, lihat docs/financial/FINANCIAL_CALCULATION_INTEGRITY.md):
 * Dashboard menghitung "Total Saldo" dari array transaksi client-side yang
 * hanya memuat 50 baris terbaru (listenToTransactions → GET /api/transactions?limit=50).
 * Menambahkan transaksi baru menggeser window 50 → baris lama keluar window →
 * saldo melompat tidak konsisten (insiden: -109.415 → -489.415 = tampil 489.415
 * padahal delta transaksi hanya -83.500).
 *
 * Modul ini memindahkan agregasi ke SQL di server atas SELURUH transaksi user
 * (tanpa LIMIT), dengan konvensi tanda yang SAMA PERSIS dengan client
 * calculateBalance (src/services/transactionService.ts):
 *   - income  = SUM(amount) WHERE type IN ('income','refund')
 *   - expense = SUM(amount) WHERE type IN ('expense','transfer')
 *   - balance = income - expense
 *
 * Konvensi tanggal bulanan: half-open range [YYYY-MM-01, YYYY-MM+1-01) pada
 * kolom transaction_date (string YYYY-MM-DD → perbandingan leksikografis sama
 * dengan semantik tanggal). Mengubah definisi ini MEMBUTUHKAN bukti product
 * requirement — jangan edit tanpa bukti.
 */
/** Konvensi bulanan konsisten dengan filter client (getCurrentMonth/getCurrentYear).
 *  - month ABSEN (undefined/null) → bulan berjalan (bukan Januari) — angka salah
 *    lebih berbahaya daripada clamp.
 *  - month hadir tapi di luar 1-12 → di-clamp (0→Januari, 13→Desember). */
export function monthRange(month, year) {
  const m = month === undefined || month === null
    ? new Date().getMonth() + 1
    : Math.max(1, Math.min(12, Number(month) || 1));
  const y = Number(year) || new Date().getFullYear();
  const pad = (n) => String(n).padStart(2, '0');
  const start = `${y}-${pad(m)}-01`;
  const end = m === 12 ? `${y + 1}-01-01` : `${y}-${pad(m + 1)}-01`;
  return { start, end };
}

/** Bulatkan ke 2 desimal (presisi Rupiah; hindari drift float SUM REAL).
 *  Number.EPSILON menetralkan representasi biner (1.005 * 100 = 100.49999…). */
export function round2(n) {
  return Math.round(((Number(n) || 0) + Number.EPSILON) * 100) / 100;
}

export const LIFETIME_SUMMARY_SQL = `
  SELECT
    COALESCE(SUM(CASE WHEN type IN ('income','refund') THEN amount ELSE 0 END), 0) AS total_income,
    COALESCE(SUM(CASE WHEN type IN ('expense','transfer') THEN amount ELSE 0 END), 0) AS total_expense,
    COUNT(*) AS count
  FROM transactions
  WHERE user_id = ?`;

export const MONTHLY_SUMMARY_SQL = `
  SELECT
    COALESCE(SUM(CASE WHEN type IN ('income','refund') THEN amount ELSE 0 END), 0) AS total_income,
    COALESCE(SUM(CASE WHEN type IN ('expense','transfer') THEN amount ELSE 0 END), 0) AS total_expense,
    COUNT(*) AS count
  FROM transactions
  WHERE user_id = ? AND transaction_date >= ? AND transaction_date < ?`;

/**
 * Normalisasi daftar nama akun milik sendiri — terima JSON string
 * (user_financial_settings.own_accounts, migration 0004) ATAU array string
 * langsung (caller API/test). Robust: non-string/non-array/korup → []; tiap
 * elemen di-trim, kosong dibuang, duplikat dibuang (deterministik, urutan
 * dipertahankan).
 */
export function parseOwnAccounts(value) {
  let parsed = value;
  if (typeof value === 'string') {
    if (!value.trim()) return [];
    try {
      parsed = JSON.parse(value);
    } catch {
      return [];
    }
  }
  if (!Array.isArray(parsed)) return [];
  const seen = new Set();
  const out = [];
  for (const item of parsed) {
    if (typeof item !== 'string') continue;
    const trimmed = item.trim();
    if (!trimmed || seen.has(trimmed)) continue;
    seen.add(trimmed);
    out.push(trimmed);
  }
  return out;
}

/**
 * SQL deteksi pasangan transfer↔income internal (Skr B, §10.13).
 *
 * Rule (2026-08-11, hasil audit forensik yang mereproduksi PERSIS angka
 * terdokumentasi 13 pasangan / Rp1.628.358): income (`type='income'`)
 * dianggap "pasangan internal" bila ada transfer (`type='transfer'`) dengan:
 *   - merchant SAMA (keduanya di daftar akun milik sendiri),
 *   - transaction_date SAMA,
 *   - amount SAMA.
 * Pairing 1:1 MIN-pair per grup (type, transaction_date, amount, merchant)
 * dengan tie-break deterministik `id ASC` (ROW_NUMBER) — bila grup punya
 * 1 transfer & 2 income, HANYA 1 income dinetralkan (income legit sisa tetap
 * dihitung; lihat bucket 2026-05-01 Rp200.000 di dataset dev).
 *
 * WINDOWLESS + user-scoped. `merchant IN (...)` membatasi KEDUA sisi ke akun
 * milik sendiri (transfer internal per Skr A; income yang masuk ke akun
 * sendiri). Refund TIDAK pernah masuk pairing (hanya type='income').
 */
export function internalIncomePairsSql(placeholders) {
  return `
    WITH cand AS (
      SELECT id, type, amount, transaction_date AS d, merchant,
             ROW_NUMBER() OVER (PARTITION BY type, transaction_date, amount, merchant ORDER BY id) AS rn
      FROM transactions
      WHERE user_id = ? AND type IN ('income','transfer') AND merchant IN (${placeholders})
    )
    SELECT i.id AS id
    FROM cand i
    JOIN cand t
      ON t.type = 'transfer'
     AND t.d = i.d
     AND t.amount = i.amount
     AND t.merchant = i.merchant
     AND t.rn = i.rn
    WHERE i.type = 'income'`;
}

/**
 * Deteksi id income yang merupakan pasangan transfer internal (Skr B).
 * ownAccounts KOSONG → [] (legacy: income tidak pernah dinetralkan).
 * Return: array id income yang harus DIKECUALIKAN dari agregasi income.
 */
export async function findInternalIncomePairIds(client, userId, ownAccounts) {
  const accounts = (ownAccounts || [])
    .map((s) => String(s).trim())
    .filter((s) => s.length > 0);
  if (accounts.length === 0) return [];
  const placeholders = accounts.map(() => '?').join(', ');
  const res = await client.execute({
    sql: internalIncomePairsSql(placeholders),
    args: [userId, ...accounts],
  });
  return (res.rows || []).map((r) => String(r.id));
}

/**
 * Bangun SQL summary + args. Bila `ownAccounts` KOSONG → konstanta legacy
 * (semua transfer = expense, income tidak pernah dinetralkan —
 * backward-compat §10.12). Bila TIDAK kosong → transfer yang merchant-nya ada
 * di daftar akun milik sendiri TIDAK dihitung sebagai expense (semantik
 * "transfer internal = netral", §10.13 Skr A).
 *
 * `excludeIncomeIds` (Skr B): id income pasangan transfer internal — baris
 * tersebut DIKECUALIKAN dari agregasi income (dimasukkan ke WHERE, sehingga
 * TIDAK ikut SUM income maupun COUNT). Kosong (default) → perilaku Skr A.
 */
export function buildSummaryQuery(ownAccounts, { monthly = false, userId, start, end, excludeIncomeIds = [] } = {}) {
  const accounts = (ownAccounts || [])
    .map((s) => String(s).trim())
    .filter((s) => s.length > 0);
  const exclude = (excludeIncomeIds || [])
    .map((s) => String(s).trim())
    .filter((s) => s.length > 0);
  const baseArgs = monthly ? [userId, start, end] : [userId];

  // Legacy: tanpa daftar akun → konstanta asli (exclusion pun tidak berlaku).
  if (accounts.length === 0) {
    return {
      sql: monthly ? MONTHLY_SUMMARY_SQL : LIFETIME_SUMMARY_SQL,
      args: baseArgs,
    };
  }

  const placeholders = accounts.map(() => '?').join(', ');
  const where = monthly
    ? 'WHERE user_id = ? AND transaction_date >= ? AND transaction_date < ?'
    : 'WHERE user_id = ?';
  // Baris income pasangan internal dikeluarkan dari agregasi via WHERE
  // (bukan CASE) — konsisten untuk SUM income MAUPUN COUNT.
  const excludeClause = exclude.length > 0
    ? `\n    AND NOT (type = 'income' AND id IN (${exclude.map(() => '?').join(', ')}))`
    : '';
  const sql = `
    SELECT
      COALESCE(SUM(CASE WHEN type IN ('income','refund') THEN amount ELSE 0 END), 0) AS total_income,
      COALESCE(SUM(CASE WHEN type = 'expense' THEN amount
        WHEN type = 'transfer' AND merchant NOT IN (${placeholders}) THEN amount
        ELSE 0 END), 0) AS total_expense,
      COUNT(*) AS count
    FROM transactions
    ${where}${excludeClause}`;
  // Urutan args mengikuti posisi placeholder di SQL: merchant NOT IN (di
  // SELECT) → WHERE (baseArgs) → id income NOT IN (di akhir WHERE).
  return { sql, args: [...accounts, ...baseArgs, ...exclude] };
}

/** Pengeluaran bulanan per kategori — HANYA type='expense' (sama dengan filter
 *  budget usage di DashboardPage: transaction.type === 'expense'). */
export const MONTHLY_EXPENSE_BY_CATEGORY_SQL = `
  SELECT category_id, COALESCE(MAX(category_name), '') AS category_name, COALESCE(SUM(amount), 0) AS total
  FROM transactions
  WHERE user_id = ? AND type = 'expense' AND transaction_date >= ? AND transaction_date < ?
  GROUP BY category_id`;

/**
 * Hitung ringkasan keuangan untuk satu user (WINDOWLESS — seluruh transaksi,
 * tanpa LIMIT). Dipakai route GET /api/transactions/summary dan unit test
 * golden-reconciliation (real libsql).
 *
 * @param {*} client   Turso client ({ execute })
 * @param {string} userId
 * @param {{ month?: number, year?: number }} opts
 */
export async function computeFinancialSummary(client, userId, { month, year, ownAccounts = [] } = {}) {
  const norm = monthRange(month, year);
  const { start, end } = norm;
  const accounts = parseOwnAccounts(ownAccounts);
  // Skr B: deteksi income pasangan transfer internal (lifetime, deterministic
  // id ASC) — HANYA saat ownAccounts terkonfigurasi (legacy → tanpa pairing).
  const excludeIncomeIds = await findInternalIncomePairIds(client, userId, accounts);
  const [lifetimeRes, monthlyRes, byCategory] = await Promise.all([
    client.execute(buildSummaryQuery(accounts, { monthly: false, userId, excludeIncomeIds })),
    client.execute(buildSummaryQuery(accounts, { monthly: true, userId, start, end, excludeIncomeIds })),
    client.execute({ sql: MONTHLY_EXPENSE_BY_CATEGORY_SQL, args: [userId, start, end] }),
  ]);

  const toTotals = (row) => {
    const totalIncome = round2(row?.total_income);
    const totalExpense = round2(row?.total_expense);
    return {
      totalIncome,
      totalExpense,
      balance: round2(totalIncome - totalExpense),
      count: Number(row?.count || 0),
    };
  };

  return {
    month: Number(norm.start.slice(5, 7)),
    year: Number(norm.start.slice(0, 4)),
    lifetime: toTotals(lifetimeRes.rows[0]),
    monthly: toTotals(monthlyRes.rows[0]),
    monthlyByCategory: (byCategory.rows || []).map((r) => ({
      categoryId: r.category_id,
      categoryName: r.category_name || 'Lainnya',
      total: round2(r.total),
    })),
  };
}
