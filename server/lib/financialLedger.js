/**
 * financialLedger.js — Account-Based Real Balance Engine (P2.5)
 *
 * Misi modul ini (docs/financial/FINANCIAL_CALCULATION_INTEGRITY.md P2.5):
 * MEMISAHKAN dengan tegas tiga angka yang selama ini dicampur:
 *
 *   1. Current Balance (per akun + aggregate)
 *        = opening_balance + inflow − expense − outgoing + incoming
 *        Status jujur: known | partial | unknown.
 *   2. Lifetime Net Cash Flow (Mode B — legacy heuristic Skr A/B)
 *        = Σ income + Σ refund − Σ expense − Σ transfer_eksternal
 *        − Σ income_pasangan_internal        (computeFinancialSummary)
 *   3. Monthly Income / Expense (half-open bulanan — tetap dari
 *        computeFinancialSummary)
 *
 * Aturan keras (mandate P2.5):
 *   - JANGAN menebak opening balance (0 pun TIDAK otomatis). Bila user belum
 *     mengisi → status "unknown", reason "opening_balance_missing" — jujur.
 *   - JANGAN assign transaksi ke akun secara otomatis dari merchant. Legacy
 *     transaction tanpa account_id → unclassified (account_id NULL), status
 *     "partial" — bukan tebakan.
 *   - Transfer internal (dua leg akun milik sendiri, transfer_group_id sama,
 *     role 'out' + 'in') → net effect 0 pada aggregate owned accounts.
 *   - Transfer eksternal (leg tunggal / tanpa pasangan) → mengurangi saldo.
 *   - Semua agregasi WINDOWLESS (tanpa LIMIT sebelum SUM) + user-scoped
 *     (userId = req.user.id, TIDAK pernah dari body/query).
 *   - Presisi: round2 (sama dengan financialSummary.js — 2 desimal Rupiah,
 *     Number.EPSILON; storage REAL tetap dibaca apa adanya).
 *
 * Semantik tanggal opening balance (konsisten, terdokumentasi):
 *   opening_balance = balance pada START-OF-DAY opening_balance_date.
 *   Transaksi dengan transaction_date >= opening_balance_date MASUK
 *   pergerakan (inclusive). Tanpa opening_balance_date → seluruh riwayat
 *   transaksi ter-link dihitung (nullable = pergerakan penuh).
 *
 * P2.7 — VERIFIED BALANCE ANCHOR (docs §13):
 *   real_balance + real_balance_date + real_balance_verified_at (migration
 *   0008, P2.6) dipakai ULANG sebagai anchor — TIDAK ada struktur paralel.
 *   Anchor = snapshot saldo AKTUAL yang diverifikasi user pada END-OF-DAY
 *   tanggal tersebut. Perhitungan current balance berbasis anchor:
 *
 *     current_balance = verified_anchor + Σ pergerakan dengan
 *                       transaction_date > anchor_date  (STRICTLY setelah)
 *
 *   Pergerakan PADA/SEBELUM anchor date TIDAK dihitung ulang (sudah
 *   tercakup dalam snapshot) — mencegah double counting. Bila akun belum
 *   punya anchor, fallback ke model opening balance P2.5 (backward-compat).
 *   User TIDAK pernah dipaksa tahu saldo historis — anchor cukup.
 */
import { round2, computeFinancialSummary } from './financialSummary.js';

/** status akun: opening balance tersedia → 'known'; NULL → 'unknown'. */
export function accountStatus(account) {
  return account.opening_balance === null || account.opening_balance === undefined
    ? 'unknown'
    : 'known';
}

/**
 * Anchor terverifikasi akun (P2.7): ada bila user pernah menyimpan saldo
 * aktual dengan tanggal. Amount + date WAJIB — tanpanya bukan anchor.
 */
export function accountAnchor(account) {
  const amount = account.real_balance === null || account.real_balance === undefined ? null : Number(account.real_balance);
  const date = account.real_balance_date || null;
  if (amount === null || date === null) return null;
  return {
    amount,
    date,
    verifiedAt: account.real_balance_verified_at || null,
  };
}

/** Baca akun ledger (wallet_accounts, non-archived, user-scoped). */
export async function getLedgerAccounts(client, userId) {
  const res = await client.execute({
    sql: `SELECT id, user_id, name, type, institution, balance, color, archived,
                 opening_balance, opening_balance_date, currency,
                 real_balance, real_balance_date, real_balance_verified_at, balance_anchor_status
          FROM wallet_accounts
          WHERE user_id = ? AND archived = 0
          ORDER BY created_at ASC, id ASC`,
    args: [userId],
  });
  return (res.rows || []).map((r) => ({
    id: String(r.id),
    name: String(r.name),
    type: String(r.type || 'other'),
    institution: String(r.institution || ''),
    currency: String(r.currency || 'IDR'),
    opening_balance: r.opening_balance === null || r.opening_balance === undefined ? null : Number(r.opening_balance),
    opening_balance_date: r.opening_balance_date || null,
    real_balance: r.real_balance === null || r.real_balance === undefined ? null : Number(r.real_balance),
    real_balance_date: r.real_balance_date || null,
    real_balance_verified_at: r.real_balance_verified_at || null,
    balance_anchor_status: r.balance_anchor_status || null,
  }));
}

/**
 * WHERE pergerakan (P2.7 anchor-aware):
 *   - akun DENGAN anchor → HANYA transaksi transaction_date > anchor_date
 *     (post-anchor roll-forward; END-of-day semantics — anchor sudah
 *     mencakup seluruh transaksi s.d. tanggal tersebut).
 *   - akun TANPA anchor → fallback P2.5: transaction_date >= opening_date
 *     (start-of-day, inclusive) atau seluruh riwayat bila opening NULL.
 */
const MOVEMENT_JOIN_SQL = `
  FROM transactions t
  JOIN wallet_accounts w ON w.id = t.account_id AND w.user_id = t.user_id
  WHERE t.user_id = ?
    AND t.account_id IS NOT NULL
    AND (
      (w.real_balance_date IS NOT NULL AND t.transaction_date > w.real_balance_date)
      OR
      (w.real_balance_date IS NULL AND (w.opening_balance_date IS NULL OR t.transaction_date >= w.opening_balance_date))
    )`;

/** Agregat inflow/expense per akun (windowless, user-scoped, SQL murni). */
export async function computeAccountMovements(client, userId) {
  const aggRes = await client.execute({
    sql: `SELECT t.account_id,
                 COALESCE(SUM(CASE WHEN t.type IN ('income','refund') THEN t.amount ELSE 0 END), 0) AS inflow,
                 COALESCE(SUM(CASE WHEN t.type = 'expense' THEN t.amount ELSE 0 END), 0) AS expense,
                 COUNT(*) AS count
          ${MOVEMENT_JOIN_SQL}
          GROUP BY t.account_id`,
    args: [userId],
  });

  // Leg transfer dipisah ke query sendiri: arah leg (in/out) TIDAK bisa
  // ditentukan dari SUM saja — perlu metadata.transferRole + pairing grup.
  const transferRes = await client.execute({
    sql: `SELECT t.id, t.account_id, t.amount, t.transfer_group_id, t.metadata
          ${MOVEMENT_JOIN_SQL}
            AND t.type = 'transfer'
          ORDER BY t.account_id, t.id`,
    args: [userId],
  });

  return { aggregates: aggRes.rows || [], transfers: transferRes.rows || [] };
}

/** parse metadata JSON transaksi (robust: korup/non-string → {}). */
export function parseTransactionMetadata(raw) {
  if (!raw) return {};
  if (typeof raw === 'object' && !Array.isArray(raw)) return raw;
  try {
    return JSON.parse(String(raw));
  } catch {
    return {};
  }
}

/**
 * Klasifikasi arah leg transfer (rule terdokumentasi, lihat header modul):
 *   - metadata.transferRole === 'out'   → outgoing (uang keluar dari akun leg)
 *   - metadata.transferRole === 'in'    → incoming (uang masuk ke akun leg)
 *   - leg transfer_group_id sama & 2 leg & keduanya punya account_id &
 *     TIDAK ada role → internal pair (net 0 aggregate; arah per-akun
 *     unresolved — TIDAK ditebak).
 *   - leg TANPA role dan TANPA pasangan → outgoing eksternal (uang keluar
 *     dari akun ke pihak luar) — konservatif, bukan tebakan internal.
 */
export function classifyTransferLegs(transfers) {
  const byGroup = new Map();
  const singles = [];
  for (const t of transfers) {
    const gid = t.transfer_group_id ? String(t.transfer_group_id) : null;
    const meta = parseTransactionMetadata(t.metadata);
    const role = meta.transferRole === 'out' || meta.transferRole === 'in' ? meta.transferRole : null;
    const leg = {
      id: String(t.id),
      accountId: String(t.account_id),
      amount: Number(t.amount),
      groupId: gid,
      role,
    };
    if (gid) {
      if (!byGroup.has(gid)) byGroup.set(gid, []);
      byGroup.get(gid).push(leg);
    } else {
      singles.push(leg);
    }
  }

  const out = new Map(); // accountId -> { incoming, outgoing, pair, unresolved }
  const get = (id) => {
    if (!out.has(id)) out.set(id, { incoming: 0, outgoing: 0, pair: 0, unresolved: 0, legs: 0 });
    return out.get(id);
  };

  for (const leg of singles) {
    const bucket = get(leg.accountId);
    bucket.legs += 1;
    if (leg.role === 'in') bucket.incoming = round2(bucket.incoming + leg.amount);
    else bucket.outgoing = round2(bucket.outgoing + leg.amount); // out / no-role tunggal = eksternal out
  }

  for (const [, legs] of byGroup) {
    for (const leg of legs) {
      const bucket = get(leg.accountId);
      bucket.legs += 1;
    }
    const withRole = legs.filter((l) => l.role);
    const noRole = legs.filter((l) => !l.role);
    if (withRole.length === legs.length && withRole.length > 0) {
      // Semua leg punya role eksplisit → arah pasti.
      for (const leg of legs) {
        const bucket = get(leg.accountId);
        if (leg.role === 'in') bucket.incoming = round2(bucket.incoming + leg.amount);
        else bucket.outgoing = round2(bucket.outgoing + leg.amount);
      }
    } else if (noRole.length === 2 && legs.every((l) => l.accountId)) {
      // Internal pair klasik (2 leg, tanpa role): net 0 pada aggregate.
      for (const leg of noRole) {
        const bucket = get(leg.accountId);
        bucket.pair = round2(bucket.pair + leg.amount);
      }
    } else if (noRole.length > 0) {
      // Campuran tidak lengkap → unresolved (jangan ditebak).
      for (const leg of noRole) {
        const bucket = get(leg.accountId);
        bucket.unresolved = round2(bucket.unresolved + leg.amount);
      }
    }
  }
  return out;
}

/**
 * Transaksi yang TIDAK ter-attribusi ke akun milik user: account_id NULL
 * (legacy/belum ter-link) ATAU account_id mengarah ke akun yang bukan milik
 * user (data korup/cross-user — TIDAK di-assign, di-flag). Windowless +
 * user-scoped; subquery `wallet_accounts` membatasi ownership.
 */
export async function computeUnclassified(client, userId) {
  const res = await client.execute({
    sql: `SELECT COUNT(*) AS count, COALESCE(SUM(amount), 0) AS amount
          FROM transactions
          WHERE user_id = ?
            AND (account_id IS NULL
                 OR account_id NOT IN (SELECT id FROM wallet_accounts WHERE user_id = ?))`,
    args: [userId, userId],
  });
  const row = res.rows?.[0] || {};
  return { count: Number(row.count || 0), amount: round2(row.amount || 0) };
}

/**
 * Hitung ledger per akun + current balance aggregate + status jujur.
 *
 * @param {*} client Turso client
 * @param {string} userId
 * @returns {Promise<{
 *   currentBalance: { status: 'known'|'partial'|'unknown', amount: number|null, reason: string|null, message: string },
 *   accounts: Array<{...}>,
 *   unclassified: { count, amount },
 *   reconciliationStatus: 'balanced'|'warning'|'unknown'
 * }>}
 */
export async function computeAccountLedger(client, userId) {
  const accounts = await getLedgerAccounts(client, userId);
  const unclassified = await computeUnclassified(client, userId);

  if (accounts.length === 0) {
    return {
      currentBalance: {
        status: 'unknown',
        amount: null,
        reason: 'no_accounts',
        message: 'Belum ada rekening yang dikonfigurasi. Tambahkan rekening dan verifikasi saldo aktual untuk menghitung saldo.',
        anchorDate: null,
      },
      accounts: [],
      unclassified,
      reconciliationStatus: 'unknown',
    };
  }

  const { aggregates, transfers } = await computeAccountMovements(client, userId);
  const transferBuckets = classifyTransferLegs(transfers);
  const aggByAccount = new Map((aggregates || []).map((r) => [String(r.account_id), r]));

  const ledgerAccounts = accounts.map((a) => {
    const agg = aggByAccount.get(a.id);
    const tr = transferBuckets.get(a.id) || { incoming: 0, outgoing: 0, pair: 0, unresolved: 0, legs: 0 };
    const inflow = round2(Number(agg?.inflow || 0));
    const expense = round2(Number(agg?.expense || 0));
    const incomingTransfer = round2(tr.incoming);
    const outgoingTransfer = round2(tr.outgoing);
    const internalTransferPair = round2(tr.pair);
    const unresolvedTransfer = round2(tr.unresolved);
    const movementCount = Number(agg?.count || 0) + tr.legs;

    const anchor = accountAnchor(a);
    const opening = a.opening_balance;
    let closingBalance = null;
    let status;
    if (anchor) {
      // P2.7: anchor + pergerakan SETELAH anchor date (roll-forward).
      // Unresolved TIDAK ikut (arah tidak diketahui) — jujur, bukan tebakan.
      status = 'anchored';
      closingBalance = round2(
        anchor.amount + inflow + incomingTransfer - expense - outgoingTransfer,
      );
    } else {
      const st = accountStatus(a);
      status = st; // 'known' (opening) | 'unknown'
      if (st === 'known') {
        closingBalance = round2(
          opening + inflow + incomingTransfer - expense - outgoingTransfer,
        );
      }
    }
    // verificationStatus = OUTCOME verifikasi yang DI-SIMPAN (migration 0009):
    //   'verified' | 'mismatch' — TIDAK diturunkan ulang dari closing karena
    //   pergerakan post-anchor membuat selisih itu wajar (bukan mismatch).
    // 'verified' default saat anchor diterima tanpa baseline (kebenaran user).
    const verificationStatus = anchor
      ? (a.balance_anchor_status === 'mismatch' ? 'mismatch' : 'verified')
      : 'not_verified';
    return {
      id: a.id,
      name: a.name,
      type: a.type,
      currency: a.currency,
      openingBalance: opening,
      openingBalanceDate: a.opening_balance_date,
      anchor,
      verificationStatus,
      movements: {
        inflow,
        expense,
        incomingTransfer,
        outgoingTransfer,
        internalTransferPair,
        unresolvedTransfer,
        count: movementCount,
      },
      closingBalance,
      status,
    };
  });

  // ── Status machine P2.7 (§15) — anchor-first, fallback P2.5 — ────────────
  const anchoredAccounts = ledgerAccounts.filter((a) => a.anchor);
  const knownAccounts = ledgerAccounts.filter((a) => a.status === 'known');
  const unknownAccounts = ledgerAccounts.filter((a) => a.status === 'unknown');
  const postAnchorUnclassified = await computePostAnchorUnclassified(client, userId, anchoredAccounts);

  let status;
  let reason;
  let anchorDate = null;

  if (accounts.length === 0) {
    status = 'unknown';
    reason = 'no_accounts';
  } else if (anchoredAccounts.length === 0) {
    // Fallback P2.5 (opening-based) — backward-compat, tanpa anchor.
    if (knownAccounts.length === 0) {
      status = 'unknown';
      reason = 'opening_balance_missing';
    } else if (unknownAccounts.length > 0 || unclassified.count > 0) {
      status = 'partial';
      reason = unknownAccounts.length > 0 ? 'opening_balance_missing' : 'unclassified_transactions';
    } else {
      status = 'known';
      reason = null;
    }
  } else {
    // Ada ≥1 anchor → machine P2.7.
    const allAnchored = anchoredAccounts.length === accounts.length;
    // §32: tolak agregasi lintas mata uang — semua harus IDR untuk dijumlah.
    const foreignCurrency = accounts.some((a) => a.currency !== 'IDR');
    const hasPostAnchorGap = postAnchorUnclassified.count > 0
      || anchoredAccounts.some((a) => a.movements.unresolvedTransfer > 0);
    const mismatchAccounts = anchoredAccounts.filter((a) => a.verificationStatus === 'mismatch');

    if (foreignCurrency) {
      status = 'partial';
      reason = 'cross_currency';
    } else if (!allAnchored) {
      status = 'partial';
      reason = 'anchor_missing';
    } else if (mismatchAccounts.length > 0) {
      status = 'mismatch';
      reason = 'anchor_mismatch';
    } else if (hasPostAnchorGap) {
      status = 'stale';
      reason = 'post_anchor_activity_unresolved';
    } else {
      status = 'verified';
      reason = null;
    }
    anchorDate = anchoredAccounts.map((a) => a.anchor.date).sort().reverse()[0] || null;
  }

  // Aggregate amount: hanya akun yang saldonya dapat dihitung. Anchor-first
  // → jumlahkan akun anchored (anchor + post-anchor); fallback opening.
  // Cross-currency → null (ditolak, §32) — tidak pernah menjumlahkan USD+IDR.
  const countables = anchoredAccounts.length > 0 ? anchoredAccounts : knownAccounts;
  let amount = null;
  if (countables.length > 0 && !(status === 'partial' && reason === 'cross_currency')) {
    amount = round2(countables.reduce((s, a) => s + (a.closingBalance || 0), 0));
  }

  const messages = {
    no_accounts: 'Belum ada rekening yang dikonfigurasi. Tambahkan rekening dan verifikasi saldo aktual untuk menghitung saldo.',
    opening_balance_missing: 'Saldo awal beberapa rekening belum diisi — atau verifikasi saldo aktual (anchor) untuk menghitung tanpa data historis.',
    unclassified_transactions: 'Ada transaksi yang belum terhubung ke rekening. Tinjau transaksi untuk menghitung saldo secara lengkap.',
    anchor_missing: 'Sebagian rekening belum diverifikasi saldo aktualnya. Verifikasi semua rekening untuk status VERIFIED.',
    anchor_mismatch: 'Saldo aktual yang Anda masukkan berbeda dari perhitungan sistem. Periksa selisih dan penyebabnya — tidak ada koreksi otomatis.',
    post_anchor_activity_unresolved: 'Ada aktivitas setelah tanggal verifikasi yang belum terselesaikan (transaksi belum terhubung / transfer belum dipasangkan).',
    cross_currency: 'Rekening dengan mata uang berbeda tidak dapat dijumlahkan tanpa konversi — agregasi lintas mata uang ditolak.',
  };

  const message = status === 'known' || status === 'verified'
    ? (status === 'verified'
      ? `Saldo saat ini = saldo aktual terverifikasi per ${anchorDate} + pergerakan setelahnya.`
      : 'Saldo saat ini dihitung dari saldo awal + seluruh pergerakan transaksi yang terhubung ke rekening.')
    : messages[reason] || 'Saldo saat ini belum dapat dihitung karena data belum lengkap.';

  return {
    currentBalance: {
      status,
      amount,
      reason,
      message,
      anchorDate,
    },
    accounts: ledgerAccounts,
    unclassified,
    reconciliationStatus: status === 'verified' || status === 'known' ? 'balanced' : status === 'unknown' ? 'unknown' : 'warning',
  };
}

/**
 * Transaksi unclassified yang terjadi SETELAH anchor terbaru (P2.7 §16):
 * transaksi historis sebelum anchor TIDAK boleh merusak current balance —
 * hanya aktivitas setelah anchor yang memengaruhi roll-forward. Tanpa anchor
 * → 0 (tidak relevan). Windowless + user-scoped.
 */
export async function computePostAnchorUnclassified(client, userId, anchoredAccounts) {
  if (!anchoredAccounts || anchoredAccounts.length === 0) return { count: 0, amount: 0 };
  const minAnchorDate = anchoredAccounts
    .map((a) => a.anchor.date)
    .sort()[0];
  if (!minAnchorDate) return { count: 0, amount: 0 };
  const res = await client.execute({
    sql: `SELECT COUNT(*) AS count, COALESCE(SUM(amount), 0) AS amount
          FROM transactions
          WHERE user_id = ? AND account_id IS NULL AND transaction_date > ?`,
    args: [userId, minAnchorDate],
  });
  const row = res.rows?.[0] || {};
  return { count: Number(row.count || 0), amount: round2(row.amount || 0) };
}

/**
 * Ringkasan ledger lengkap (Current Balance account-based + referensi
 * Net Cash Flow Mode B). Entry point canonical untuk seluruh konsumen
 * (API /api/transactions/summary, dashboard, reports, AI context).
 *
 * netCashFlow = computeFinancialSummary(client, userId, {ownAccounts}).lifetime.balance
 * — Mode B (Skr A/B legacy heuristic), DIPERTAHANKAN sebagai metrik terpisah
 * dari Current Balance (bukan pengganti, bukan "Total Saldo").
 */
export async function computeLedgerSummary(client, userId, { ownAccounts = [] } = {}) {
  const summary = await computeFinancialSummary(client, userId, { ownAccounts });
  const ledger = await computeAccountLedger(client, userId);
  return {
    ...ledger,
    netCashFlow: {
      amount: summary.lifetime.balance,
      totalIncome: summary.lifetime.totalIncome,
      totalExpense: summary.lifetime.totalExpense,
    },
  };
}
