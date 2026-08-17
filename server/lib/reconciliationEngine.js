/**
 * reconciliationEngine.js — Assisted Ledger Reconciliation (P2.6)
 *
 * Misi: mengubah `Current Balance = UNKNOWN` menjadi dapat diisi secara AMAN
 * melalui onboarding rekening → klasifikasi transaksi → pairing transfer →
 * verifikasi saldo nyata. PRINSIP (mandate P2.6):
 *
 *   - Semua klasifikasi DETERMINISTIK + user-confirmed. AI/LLM TIDAK pernah
 *     menjadi financial authority.
 *   - Jangan pernah menebak opening balance / real balance.
 *   - Merchant normalization HANYA evidence, bukan truth; merchant asli
 *     tidak pernah diubah.
 *   - Setiap aksi klasifikasi di-audit (reconciliation_audit_log) dengan
 *     actor = userId dari sesi (TANPA token/secret/body Gmail).
 *   - WINDOWLESS + user-scoped (`WHERE user_id = ?` dari req.user.id).
 *   - Idempoten: menjalankan klasifikasi dua kali → state identik (batch
 *     transaksional per aksi; `account_review_status` mencegah re-suggest).
 */
import crypto from 'node:crypto';
import { round2 } from './financialSummary.js';
import { getLedgerAccounts, computeAccountLedger } from './financialLedger.js';

export const REVIEW_PENDING = 'pending';
export const REVIEW_CONFIRMED = 'confirmed';
export const REVIEW_REJECTED = 'rejected';

/** Normalisasi merchant untuk PENCARIAN (evidence) — merchant asli di DB
 *  TIDAK pernah diubah. Lowercase + trim + kolaps whitespace + buang
 *  tanda baca pembatas ('.' '-' '/' '_' ',') agar "blu", "BLU",
 *  "blu by BCA Digital" → "blu by bca digital". */
export function normalizeMerchant(name) {
  if (!name) return '';
  return String(name)
    .toLowerCase()
    .replace(/[.\-/_,]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/** Bandingkan dua nama akun secara ternormalisasi (eksak). */
export function merchantMatches(name, accountName) {
  const a = normalizeMerchant(name);
  const b = normalizeMerchant(accountName);
  return a.length > 0 && a === b;
}

/** Bandingkan substring ternormalisasi (varian brand: "blu by BCA Digital"
 *  mengandung "blu"). Hanya untuk evidence MEDIUM, bukan auto-assign. */
export function merchantContains(name, accountName) {
  const a = normalizeMerchant(name);
  const b = normalizeMerchant(accountName);
  return a.length > 0 && b.length > 0 && a !== b && (a.includes(b) || b.includes(a));
}

/**
 * Klasifikasi SATU transaksi (deterministik).
 *
 * @param {{ transaction: object, accounts: Array, ownAccounts: string[] }} args
 * @returns {{
 *   suggestedAccountId: string|null,
 *   suggestedAccountName: string|null,
 *   confidence: 'high'|'medium'|'low',
 *   reason: string,
 *   evidence: string[],
 *   requiresReview: boolean,
 * }}
 *
 * Rule signal (dokumentasi §12 P2.6):
 *   HIGH   — merchant eksak dengan akun milik sendiri (normalized match),
 *            ATAU account_id sudah ter-set (re-confirm).
 *   MEDIUM — substring brand / payment_method cocok dengan nama akun.
 *   LOW    — tanpa sinyal → suggestedAccountId null.
 */
export function suggestTransactionAccount({ transaction, accounts = [], ownAccounts = [] }) {
  const merchant = String(transaction.merchant || '').trim();
  const paymentMethod = String(transaction.payment_method || '').trim();
  const evidence = [];

  // Sinyal terkuat: account_id eksplisit (sudah diklasifikasi).
  if (transaction.account_id) {
    const acct = accounts.find((a) => String(a.id) === String(transaction.account_id));
    return {
      suggestedAccountId: transaction.account_id,
      suggestedAccountName: acct?.name ?? null,
      confidence: 'high',
      reason: 'account_id sudah ter-set',
      evidence: [`account_id=${transaction.account_id}`],
      requiresReview: false,
    };
  }

  // HIGH: merchant eksak dengan own account (normalized).
  const own = (ownAccounts || []).map((n) => String(n).trim()).filter(Boolean);
  for (const account of accounts) {
    if (merchantMatches(merchant, account.name)) {
      return {
        suggestedAccountId: account.id,
        suggestedAccountName: account.name,
        confidence: 'high',
        reason: 'Merchant cocok dengan rekening terkonfigurasi',
        evidence: [`merchant=${merchant}`, `account=${account.name}`],
        requiresReview: false,
      };
    }
  }
  // HIGH tetapi akun belum dibuat di wallet_accounts → usulkan NAMA akun
  // (UI: "Buat akun dulu"), bukan assign.
  for (const name of own) {
    if (merchantMatches(merchant, name)) {
      return {
        suggestedAccountId: null,
        suggestedAccountName: name,
        confidence: 'high',
        reason: 'Merchant cocok dengan akun milik sendiri (belum dibuat sebagai rekening)',
        evidence: [`merchant=${merchant}`, `ownAccount=${name}`],
        requiresReview: true, // butuh akun dibuat dulu — bukan auto-assign
      };
    }
  }

  // MEDIUM: substring brand / payment method.
  for (const account of accounts) {
    if (merchantContains(merchant, account.name)) {
      return {
        suggestedAccountId: account.id,
        suggestedAccountName: account.name,
        confidence: 'medium',
        reason: 'Merchant mengandung nama rekening (varian brand)',
        evidence: [`merchant=${merchant}`, `account=${account.name}`],
        requiresReview: true,
      };
    }
  }
  for (const name of own) {
    if (merchantContains(merchant, name)) {
      return {
        suggestedAccountId: null,
        suggestedAccountName: name,
        confidence: 'medium',
        reason: 'Merchant mengandung akun milik sendiri (varian brand)',
        evidence: [`merchant=${merchant}`, `ownAccount=${name}`],
        requiresReview: true,
      };
    }
  }
  for (const account of accounts) {
    if (paymentMethod && merchantMatches(paymentMethod, account.name)) {
      return {
        suggestedAccountId: account.id,
        suggestedAccountName: account.name,
        confidence: 'medium',
        reason: 'Metode pembayaran cocok dengan rekening',
        evidence: [`paymentMethod=${paymentMethod}`, `account=${account.name}`],
        requiresReview: true,
      };
    }
  }

  // LOW — tanpa sinyal; jangan menebak dari nominal/tanggal saja.
  return {
    suggestedAccountId: null,
    suggestedAccountName: null,
    confidence: 'low',
    reason: 'Tidak ada sinyal akun yang cukup',
    evidence: [],
    requiresReview: true,
  };
}

/** Kandidat pasangan transfer ↔ income (MIN-pair 1:1, deterministik).
 *  HANYA kandidat — pairing diterapkan hanya setelah user confirm. */
export function suggestTransferPairs(transfers, incomes) {
  const used = new Set();
  const pairs = [];
  for (const tr of transfers) {
    const cand = incomes.filter(
      (i) => i.transaction_date === tr.transaction_date
        && round2(Number(i.amount)) === round2(Number(tr.amount))
        && !used.has(i.id),
    );
    if (cand.length === 0) continue;
    // Pilih kandidat pertama (deterministik id ASC) — MIN-pair.
    cand.sort((a, b) => String(a.id).localeCompare(String(b.id)));
    const pick = cand[0];
    used.add(pick.id);
    const confidence = merchantMatches(tr.merchant, pick.merchant) ? 'high' : 'medium';
    pairs.push({
      transferId: tr.id,
      transferMerchant: tr.merchant,
      amount: round2(Number(tr.amount)),
      date: tr.transaction_date,
      incomeId: pick.id,
      incomeMerchant: pick.merchant,
      confidence,
      requiresReview: confidence === 'medium',
    });
  }
  return pairs;
}

/**
 * Status verifikasi akun — OUTCOME yang DI-SIMPAN saat verifikasi anchor
 * (migration 0009 balance_anchor_status; P2.7). TIDAK diturunkan ulang dari
 * closing balance karena pergerakan post-anchor membuat selisih itu wajar.
 * Tanpa anchor → 'not_verified'.
 */
export function accountVerificationStatus(account) {
  if (!account.real_balance_date && !account.real_balance_verified_at) return 'not_verified';
  return account.balance_anchor_status === 'mismatch' ? 'mismatch' : 'verified';
}

/** Balance confidence (rule deterministik, P2.6 §26 + P2.7 anchor-aware). */
export function balanceConfidence(state) {
  const { accounts, unclassifiedCount, unresolvedTransfers } = state;
  if (accounts.length === 0) return 'unknown';
  const withOpening = accounts.filter((a) => a.openingBalance !== null).length;
  const anchored = accounts.filter((a) => a.realBalance !== null && a.realBalanceDate).length;
  const allVerified = accounts.every((a) => a.verificationStatus === 'verified');
  // Basis lengkap: SEMUA akun ber-anchor (P2.7) ATAU semua ber-opening (P2.5).
  const baseComplete = anchored === accounts.length || (anchored === 0 && withOpening === accounts.length);
  if (baseComplete && unclassifiedCount === 0 && unresolvedTransfers === 0) {
    return allVerified && anchored === accounts.length ? 'verified' : 'high';
  }
  if (anchored > 0 || withOpening > 0) return 'medium';
  return 'low';
}

/**
 * Status rekonsiliasi agregat (P2.6 §6 + P2.7 anchor-aware, deterministic):
 *   unknown    — belum ada akun / belum ada basis saldo (opening ATAU anchor)
 *   partial    — basis tidak lengkap / masih ada unclassified atau transfer
 *   reconciled — semua ter-link + transfer resolved (basis opening penuh)
 *   verified   — SEMUA akun ber-anchor terverifikasi + resolved (P2.7)
 */
export function reconciliationStatus({ accounts, openingConfigured, anchoredCount, unclassifiedCount, unresolvedTransfers }) {
  if (accounts.length === 0 || (openingConfigured === 0 && anchoredCount === 0)) return 'unknown';
  const complete = anchoredCount === accounts.length || (anchoredCount === 0 && openingConfigured === accounts.length);
  if (!complete || unclassifiedCount > 0 || unresolvedTransfers > 0) return 'partial';
  const allVerified = accounts.every((a) => a.verificationStatus === 'verified');
  return allVerified && anchoredCount > 0 ? 'verified' : 'reconciled';
}

/**
 * Completion score rekonsiliasi (P2.9 §28) — DETERMINISTIK, bukan kosmetik.
 * Skor dihitung dari rasio aktual state, bukan dari klik user:
 *
 *   score = 100 × (0.20·accRatio + 0.20·anchorRatio + 0.35·txRatio + 0.25·transferRatio)
 *
 *   accRatio      = accounts / max(1, accounts + accountCandidates)
 *   anchorRatio   = accounts > 0 ? anchored / accounts : 0
 *   txRatio       = linked / max(1, total transactions)
 *   transferRatio = resolved / max(1, total transfers)
 *
 * Bobot mendokumentasikan prioritas: klasifikasi transaksi paling menentukan
 * (35%), lalu transfer (25%), lalu aktivasi & anchor akun (masing-masing
 * 20%). User tanpa data → 0 (belum dimulai) — TIDAK pernah 100 karena
 * "tidak ada yang harus dikerjakan".
 */
export function completionScore(state) {
  const { accounts, accountCandidates, anchoredCount, unclassifiedCount, unresolvedTransfers, totalTransactions, totalTransfers } = state;
  const detected = accounts.length + (accountCandidates || []).length;
  const accRatio = detected > 0 ? accounts.length / detected : 0;
  const anchorRatio = accounts.length > 0 ? anchoredCount / accounts.length : 0;
  const txRatio = totalTransactions > 0 ? (totalTransactions - unclassifiedCount) / totalTransactions : 0;
  const transferRatio = totalTransfers > 0 ? (totalTransfers - unresolvedTransfers) / totalTransfers : 0;
  const score = Math.round((accRatio * 0.2 + anchorRatio * 0.2 + txRatio * 0.35 + transferRatio * 0.25) * 100);
  return {
    score: Math.max(0, Math.min(100, score)),
    accounts: { activated: accounts.length, detected },
    anchors: { anchored: anchoredCount, total: accounts.length },
    transactions: { linked: totalTransactions - unclassifiedCount, total: totalTransactions },
    transfers: { resolved: totalTransfers - unresolvedTransfers, total: totalTransfers },
  };
}

/**
 * Ringkasan rekonsiliasi ringan (untuk GET /api/transactions/summary):
 * hanya agregat counts + status — TANPA suggestions/pairing candidates
 * (yang mahal dan hanya diperlukan halaman rekonsiliasi). Windowless,
 * user-scoped, 4 query paralel (sama dengan state penuh).
 */
export async function buildReconciliationSummary(client, userId) {
  const [accountsRes, txAgg, transferAgg, ledger] = await Promise.all([
    client.execute({
      sql: `SELECT id, name, opening_balance, real_balance, real_balance_date, real_balance_verified_at, balance_anchor_status
            FROM wallet_accounts WHERE user_id = ? AND archived = 0`,
      args: [userId],
    }),
    client.execute({
      sql: `SELECT
              COUNT(*) AS total,
              COALESCE(SUM(CASE WHEN account_id IS NULL THEN 1 ELSE 0 END), 0) AS unlinked,
              COALESCE(SUM(CASE WHEN account_id IS NULL THEN amount ELSE 0 END), 0) AS unlinkedAmount,
              MIN(transaction_date) AS earliest,
              MAX(transaction_date) AS latest
            FROM transactions WHERE user_id = ?`,
      args: [userId],
    }),
    client.execute({
      sql: `SELECT COUNT(*) AS total,
              COALESCE(SUM(CASE WHEN transfer_group_id IS NULL THEN 1 ELSE 0 END), 0) AS ungrouped,
              COALESCE(SUM(CASE WHEN transfer_review_status = 'rejected' THEN 1 ELSE 0 END), 0) AS rejected
            FROM transactions WHERE user_id = ? AND type = 'transfer'`,
      args: [userId],
    }),
    computeAccountLedger(client, userId),
  ]);

  const accounts = (accountsRes.rows || []).map((r) => {
    const systemBalance = ledger.accounts.find((a) => String(a.id) === String(r.id))?.closingBalance ?? null;
    return {
      id: String(r.id),
      name: String(r.name),
      openingBalance: r.opening_balance === null || r.opening_balance === undefined ? null : Number(r.opening_balance),
      realBalance: r.real_balance === null || r.real_balance === undefined ? null : Number(r.real_balance),
      realBalanceDate: r.real_balance_date || null,
      balanceAnchorStatus: r.balance_anchor_status || null,
      systemBalance,
      verificationStatus: accountVerificationStatus(r),
    };
  });

  const tx = txAgg.rows?.[0] || {};
  const tr = transferAgg.rows?.[0] || {};
  const openingConfigured = accounts.filter((a) => a.openingBalance !== null).length;
  const anchoredCount = accounts.filter((a) => a.realBalance !== null && a.realBalanceDate).length;
  const unclassifiedCount = Number(tx.unlinked || 0);
  const unresolvedTransfers = Number(tr.ungrouped || 0);
  const transferRejected = Number(tr.rejected || 0);

  return {
    accounts: accounts.length,
    openingBalancesConfigured: openingConfigured,
    anchoredAccounts: anchoredCount,
    transactions: {
      total: Number(tx.total || 0),
      classified: Number(tx.total || 0) - unclassifiedCount,
      unclassified: unclassifiedCount,
      unclassifiedAmount: round2(tx.unlinkedAmount || 0),
    },
    transfers: {
      total: Number(tr.total || 0),
      resolved: Number(tr.total || 0) - unresolvedTransfers,
      unresolved: unresolvedTransfers,
      rejected: transferRejected,
    },
    dateCoverage: { earliest: tx.earliest || null, latest: tx.latest || null },
    status: reconciliationStatus({ accounts, openingConfigured, anchoredCount, unclassifiedCount, unresolvedTransfers }),
    balanceConfidence: balanceConfidence({ accounts, unclassifiedCount, unresolvedTransfers }),
  };
}

/**
 * Klasifikasi bulk berbasis saran (P2.6 §15 "Accept all high confidence").
 *
 * Bukan auto-assign: setiap transaksi di-re-evaluasi deterministik lewat
 * `suggestTransactionAccount`, dan HANYA yang suggestion-nya cocok persis
 * dengan (accountId, confidence) yang diminta masuk batch. Idempoten
 * (delegasi ke classifyTransactions). Transaksi dengan saran berbeda atau
 * confidence lebih rendah TIDAK tersentuh.
 */
export async function classifyBySuggestion(client, userId, { accountId, confidence }) {
  const accId = String(accountId || '').trim();
  if (!accId) return { applied: 0, skipped: 0 };
  const want = confidence === 'high' || confidence === 'medium' ? confidence : 'high';

  const [accountsRes, settingsRes, pending] = await Promise.all([
    client.execute({
      sql: `SELECT id, name FROM wallet_accounts WHERE user_id = ? AND archived = 0`,
      args: [userId],
    }),
    client.execute({
      sql: 'SELECT own_accounts FROM user_financial_settings WHERE user_id = ?',
      args: [userId],
    }),
    listPendingTransactions(client, userId),
  ]);
  const accounts = (accountsRes.rows || []).map((r) => ({ id: String(r.id), name: String(r.name) }));
  let ownAccounts = [];
  const raw = settingsRes.rows?.[0]?.own_accounts;
  if (raw && typeof raw === 'string') ownAccounts = JSON.parse(raw);
  else if (Array.isArray(raw)) ownAccounts = raw;

  const pairs = [];
  for (const t of pending) {
    const s = suggestTransactionAccount({ transaction: t, accounts, ownAccounts });
    if (s.suggestedAccountId === accId && s.confidence === want) {
      pairs.push({ transactionId: String(t.id), accountId: accId });
    }
  }
  return classifyTransactions(client, userId, pairs);
}

/**
 * Tolak klasifikasi BULK berbasis saran (P2.8 §13 [Abaikan]) — mirror
 * deterministik dari `classifyBySuggestion`: engine re-evaluasi setiap
 * transaksi pending dan HANYA yang suggestion-nya cocok persis dengan
 * (accountId, confidence) yang ditandai `rejected`. Idempoten (delegasi ke
 * rejectTransactions). Transaksi lain TIDAK tersentuh; nominal TIDAK pernah
 * diubah. Audit `account_rejected` per baris (tanpa payload sensitif).
 */
export async function rejectBySuggestion(client, userId, { accountId, confidence }) {
  const accId = String(accountId || '').trim();
  if (!accId) return { rejected: 0, skipped: 0 };
  const want = confidence === 'high' || confidence === 'medium' ? confidence : 'high';

  const [accountsRes, settingsRes, pending] = await Promise.all([
    client.execute({
      sql: `SELECT id, name FROM wallet_accounts WHERE user_id = ? AND archived = 0`,
      args: [userId],
    }),
    client.execute({
      sql: 'SELECT own_accounts FROM user_financial_settings WHERE user_id = ?',
      args: [userId],
    }),
    listPendingTransactions(client, userId),
  ]);
  const accounts = (accountsRes.rows || []).map((r) => ({ id: String(r.id), name: String(r.name) }));
  let ownAccounts = [];
  const raw = settingsRes.rows?.[0]?.own_accounts;
  if (raw && typeof raw === 'string') ownAccounts = JSON.parse(raw);
  else if (Array.isArray(raw)) ownAccounts = raw;

  const ids = [];
  for (const t of pending) {
    const s = suggestTransactionAccount({ transaction: t, accounts, ownAccounts });
    if (s.suggestedAccountId === accId && s.confidence === want) {
      ids.push(String(t.id));
    }
  }
  return rejectTransactions(client, userId, ids);
}

/** Tandai transaksi `rejected` (user-scoped, audited, IDEMPOTEN: baris yang
 *  sudah rejected/confirmed di-skip; run kedua → no-op). */
export async function rejectTransactions(client, userId, transactionIds) {
  if (!Array.isArray(transactionIds) || transactionIds.length === 0) return { rejected: 0, skipped: 0 };
  let rejected = 0;
  let skipped = 0;
  for (const rawId of transactionIds) {
    const txId = String(rawId || '').trim();
    if (!txId) continue;
    const cur = await client.execute({
      sql: `SELECT account_id, account_review_status FROM transactions WHERE id = ? AND user_id = ?`,
      args: [txId, userId],
    });
    const row = cur.rows?.[0];
    if (!row) continue; // bukan milik user / tidak ada
    if (String(row.account_review_status) === REVIEW_REJECTED) {
      skipped += 1;
      continue;
    }
    if (String(row.account_review_status) === REVIEW_CONFIRMED) {
      skipped += 1;
      continue; // transaksi sudah diklasifikasi — jangan tolak tanpa sadar
    }
    await client.batch([
      {
        sql: `UPDATE transactions SET account_review_status = ?, updated_at = datetime('now')
              WHERE id = ? AND user_id = ?`,
        args: [REVIEW_REJECTED, txId, userId],
      },
      {
        sql: `INSERT INTO reconciliation_audit_log
              (id, user_id, action, transaction_id, old_account_id, new_account_id, reason, created_at)
              VALUES (?, ?, 'account_rejected', ?, NULL, NULL, 'user rejected suggestion', datetime('now'))`,
        args: [crypto.randomUUID(), userId, txId],
      },
    ]);
    rejected += 1;
  }
  return { rejected, skipped };
}

/** Tolak kandidat pasangan transfer (P2.8 §17 [Reject]) — transfer TETAP
 *  ungrouped/unresolved (kejujuran), hanya sugesti yang berhenti muncul.
 *  User-scoped, audited (`transfer_rejected`), IDEMPOTEN (sudah rejected →
 *  no-op). */
export async function rejectTransferCandidate(client, userId, { transferId }) {
  const tId = String(transferId || '').trim();
  if (!tId) return { ok: false, reason: 'transferId wajib' };
  const cur = await client.execute({
    sql: `SELECT id, transfer_review_status FROM transactions
          WHERE id = ? AND user_id = ? AND type = 'transfer'`,
    args: [tId, userId],
  });
  const row = cur.rows?.[0];
  if (!row) return { ok: false, reason: 'transfer tidak ditemukan' };
  if (String(row.transfer_review_status) === 'rejected') return { ok: true, alreadyRejected: true };

  await client.batch([
    {
      sql: `UPDATE transactions SET transfer_review_status = 'rejected', updated_at = datetime('now')
            WHERE id = ? AND user_id = ?`,
      args: [tId, userId],
    },
    {
      sql: `INSERT INTO reconciliation_audit_log
            (id, user_id, action, transaction_id, reason, created_at)
            VALUES (?, ?, 'transfer_rejected', ?, 'user rejected transfer candidate', datetime('now'))`,
      args: [crypto.randomUUID(), userId, tId],
    },
  ]);
  return { ok: true, alreadyRejected: false };
}

/** Baca transaksi unclassified + pending (windowless, user-scoped). */
export async function listPendingTransactions(client, userId) {
  const res = await client.execute({
    sql: `SELECT id, type, amount, merchant, payment_method, transaction_date,
                 account_id, transfer_group_id, account_review_status
          FROM transactions
          WHERE user_id = ? AND account_id IS NULL AND account_review_status = 'pending'
          ORDER BY transaction_date ASC, id ASC`,
    args: [userId],
  });
  return res.rows || [];
}

/** Klasifikasi BULK (batch transaksional per aksi — rollback otomatis bila
 *  satu statement gagal), user-scoped, audit per baris. IDEMPOTEN:
 *  `account_review_status='confirmed'` membuat run kedua no-op.
 *
 * P3.1 §21 — REASSIGN eksplisit (correction flow): transaksi yang SUDAH
 *  confirmed TIDAK pernah di-overwrite diam-diam oleh classify biasa;
 *  reassign hanya terjadi saat pemanggil mengirim `reassign: true` (jalur
 *  eksplisit dari user). Semantik:
 *    - confirmed + akun SAMA  → no-op (idempotent, tanpa audit baru)
 *    - confirmed + akun BEDA  → reassign + audit `account_reassigned`
 *    - pending                → assign biasa (audit `account_assigned`)
 *  Audit selalu menyimpan old_account_id + new_account_id (tanpa payload
 *  sensitif). */
export async function classifyTransactions(client, userId, pairs, opts = {}) {
  const { reassign = false } = opts;
  if (!Array.isArray(pairs) || pairs.length === 0) return { applied: 0, skipped: 0 };
  let applied = 0;
  let skipped = 0;
  for (const { transactionId, accountId } of pairs) {
    const txId = String(transactionId || '').trim();
    const accId = String(accountId || '').trim();
    if (!txId || !accId) continue;

    // Ambil state lama (untuk audit + idempotency check).
    const cur = await client.execute({
      sql: `SELECT account_id, account_review_status FROM transactions WHERE id = ? AND user_id = ?`,
      args: [txId, userId],
    });
    const row = cur.rows?.[0];
    if (!row) continue; // bukan milik user / tidak ada
    const oldAccountId = row.account_id ? String(row.account_id) : null;
    if (String(row.account_review_status) === REVIEW_CONFIRMED) {
      // P3.1 §21 — tanpa reassign eksplisit: skip seperti sebelumnya.
      if (!reassign || (oldAccountId !== null && oldAccountId === accId)) {
        skipped += 1;
        continue;
      }
    }

    // Validasi account milik user (anti IDOR: assign ke akun user lain ditolak).
    const acc = await client.execute({
      sql: `SELECT id FROM wallet_accounts WHERE id = ? AND user_id = ?`,
      args: [accId, userId],
    });
    if (!acc.rows?.[0]) continue;

    await client.batch([
      {
        sql: `UPDATE transactions SET account_id = ?, account_review_status = ?, updated_at = datetime('now')
              WHERE id = ? AND user_id = ?`,
        args: [accId, REVIEW_CONFIRMED, txId, userId],
      },
      {
        sql: `INSERT INTO reconciliation_audit_log
              (id, user_id, action, transaction_id, old_account_id, new_account_id, reason, created_at)
              VALUES (?, ?, ?, ?, ?, ?, ?, datetime('now'))`,
        args: [
          crypto.randomUUID(),
          userId,
          oldAccountId ? 'account_reassigned' : 'account_assigned',
          txId,
          oldAccountId,
          accId,
          'user-confirmed classification',
        ],
      },
    ]);
    applied += 1;
  }
  return { applied, skipped };
}

/** Pair transfer eksplisit (user confirm): transfer = leg out, income = leg
 *  in, satu transfer_group_id. Additive + audited + idempoten. */
export async function pairTransfer(client, userId, { transferId, incomeId }) {
  const tId = String(transferId || '').trim();
  const iId = String(incomeId || '').trim();
  if (!tId || !iId) return { ok: false, reason: 'transferId dan incomeId wajib' };

  const rows = await client.execute({
    sql: `SELECT id, type, transfer_group_id, metadata FROM transactions
          WHERE user_id = ? AND id IN (?, ?)`,
    args: [userId, tId, iId],
  });
  const byId = new Map((rows.rows || []).map((r) => [String(r.id), r]));
  const tr = byId.get(tId);
  const inc = byId.get(iId);
  if (!tr || !inc) return { ok: false, reason: 'transaksi tidak ditemukan' };
  if (String(tr.type) !== 'transfer' || String(inc.type) !== 'income') {
    return { ok: false, reason: 'pairing membutuhkan 1 transfer + 1 income' };
  }

  // §35/§36 P2.8 — idempotency: transfer yang SUDAH dipasangkan tidak boleh
  // dibuatkan group kedua (double-click / retry / network replay). Kembalikan
  // group existing TANPA mutasi dan TANPA audit duplikat.
  if (tr.transfer_group_id) {
    return { ok: true, transferGroupId: String(tr.transfer_group_id), idempotent: true };
  }

  const groupId = `grp-${crypto.randomUUID()}`;
  const mergeMeta = (raw, role) => {
    let meta = {};
    if (raw && typeof raw === 'object') meta = { ...raw };
    else if (raw) {
      try { meta = JSON.parse(String(raw)); } catch { meta = {}; }
    }
    return { ...meta, transferRole: role };
  };

  await client.batch([
    {
      sql: `UPDATE transactions SET transfer_group_id = ?, metadata = ?, updated_at = datetime('now')
            WHERE id = ? AND user_id = ?`,
      args: [groupId, JSON.stringify(mergeMeta(tr.metadata, 'out')), tId, userId],
    },
    {
      sql: `UPDATE transactions SET transfer_group_id = ?, metadata = ?, updated_at = datetime('now')
            WHERE id = ? AND user_id = ?`,
      args: [groupId, JSON.stringify(mergeMeta(inc.metadata, 'in')), iId, userId],
    },
    {
      sql: `INSERT INTO reconciliation_audit_log
            (id, user_id, action, transaction_id, old_transfer_group_id, new_transfer_group_id, reason, created_at)
            VALUES (?, ?, 'transfer_paired', ?, ?, ?, 'user-confirmed internal transfer', datetime('now'))`,
      args: [crypto.randomUUID(), userId, tId, tr.transfer_group_id || null, groupId],
    },
  ]);
  return { ok: true, transferGroupId: groupId };
}

/** Verifikasi saldo nyata (system vs actual) — TIDAK membuat adjustment.
 *  Set real_balance/date/verified_at + audit; status diturunkan dari diff. */
export async function verifyAccountBalance(client, userId, { accountId, actualBalance, date }) {
  const accId = String(accountId || '').trim();
  if (!accId) return { ok: false, reason: 'accountId wajib' };
  if (actualBalance === null || actualBalance === undefined || !Number.isFinite(Number(actualBalance))) {
    return { ok: false, reason: 'actualBalance wajib angka' };
  }

  const acc = await client.execute({
    sql: `SELECT id, type, real_balance, real_balance_date FROM wallet_accounts WHERE id = ? AND user_id = ?`,
    args: [accId, userId],
  });
  if (!acc.rows?.[0]) return { ok: false, reason: 'rekening tidak ditemukan' };

  const anchorDate = date || new Date().toISOString().slice(0, 10);
  const hadAnchor = acc.rows[0].real_balance !== null && acc.rows[0].real_balance !== undefined
    && acc.rows[0].real_balance_date != null;
  const actual = round2(Number(actualBalance));

  // P2.9 §19 — kebijakan saldo negatif: hanya tipe credit/investment yang
  // sah memiliki saldo aktual negatif (kartu kredit / posisi investasi short).
  // cash/bank/e-wallet/other → tolak fail-closed (400) — TIDAK pernah
  // menebak "overdraft" tanpa policy yang jelas.
  const accType = String(acc.rows[0].type || 'other');
  if (actual < 0 && accType !== 'credit' && accType !== 'investment') {
    return {
      ok: false,
      reason: `Saldo aktual negatif hanya didukung untuk rekening credit/investment (tipe "${accType}" tidak diizinkan).`,
    };
  }

  // P2.7 anchor semantic: real_balance = saldo AKTUAL user pada END-OF-DAY
  // anchorDate. System balance = nilai LEDGER saat ini (opening- atau
  // anchor-based). Baseline mungkin belum ada (user TIDAK dipaksa tahu saldo
  // historis) → anchor diterima sebagai kebenaran user (status 'verified',
  // difference null). Bila baseline ada → bandingkan (verified/mismatch).
  const ledger = await computeAccountLedger(client, userId);
  const account = ledger.accounts.find((a) => String(a.id) === accId);
  const systemBalance = account?.closingBalance ?? null;
  let status;
  let difference = null;
  if (systemBalance === null) {
    // Tanpa baseline — anchor adalah kebenaran (REAL MONEY > derived).
    status = 'verified';
  } else {
    difference = round2(actual - systemBalance);
    status = Math.abs(difference) < 0.01 ? 'verified' : 'mismatch';
  }
  const now = new Date().toISOString();
  // §27 audit: balance_anchor_created (pertama) / balance_anchor_updated.
  const action = hadAnchor ? 'balance_anchor_updated' : 'balance_anchor_created';

  await client.batch([
    {
      sql: `UPDATE wallet_accounts
            SET real_balance = ?, real_balance_date = ?, real_balance_verified_at = ?,
                balance_anchor_status = ?, updated_at = datetime('now')
            WHERE id = ? AND user_id = ?`,
      args: [actual, anchorDate, now, status, accId, userId],
    },
    {
      sql: `INSERT INTO reconciliation_audit_log
            (id, user_id, action, transaction_id, reason, created_at)
            VALUES (?, ?, ?, NULL, ?, datetime('now'))`,
      args: [
        crypto.randomUUID(),
        userId,
        action,
        `status=${status} anchor_date=${anchorDate} actual=${actual}`
          + (systemBalance !== null ? ` system=${systemBalance} diff=${difference}` : ' no_baseline'),
      ],
    },
  ]);

  // P3.1 §19 — MISMATCH WATERFALL kuantitatif (forensic, non-overlapping,
  // semua dari evidence nyata; TIDAK mengarang kontribusi yang tidak bisa
  // dihitung — yang tak terukur dibiarkan kosong, bukan angka palsu).
  const [unlinkedAgg, unpairedAgg] = await Promise.all([
    client.execute({
      sql: `SELECT COALESCE(SUM(amount), 0) AS amount FROM transactions
            WHERE user_id = ? AND account_id IS NULL`,
      args: [userId],
    }),
    client.execute({
      sql: `SELECT COALESCE(SUM(amount), 0) AS amount FROM transactions
            WHERE user_id = ? AND type = 'transfer' AND transfer_group_id IS NULL`,
      args: [userId],
    }),
  ]);
  const breakdown = {
    unclassifiedAmount: round2(Number(unlinkedAgg.rows?.[0]?.amount || 0)),
    unresolvedTransferAmount: round2(Number(unpairedAgg.rows?.[0]?.amount || 0)),
    postAnchorMovements: account?.movements
      ? {
          inflow: round2(Number(account.movements.inflow || 0)),
          expense: round2(Number(account.movements.expense || 0)),
          incomingTransfer: round2(Number(account.movements.incomingTransfer || 0)),
          outgoingTransfer: round2(Number(account.movements.outgoingTransfer || 0)),
        }
      : null,
  };

  return { ok: true, systemBalance, actualBalance: actual, difference, status, breakdown };
}

/**
 * State rekonsiliasi lengkap (windowless, user-scoped, tanpa N+1):
 * account inventory, opening coverage, klasifikasi, transfer, coverage
 * tanggal, suggestions terkelompok, onboarding progress (resume).
 */
export async function buildReconciliationState(client, userId) {
  const [accountsRes, txAgg, transferAgg, ledger] = await Promise.all([
    client.execute({
      sql: `SELECT id, name, type, currency, opening_balance, opening_balance_date,
                   real_balance, real_balance_date, real_balance_verified_at, balance_anchor_status
            FROM wallet_accounts WHERE user_id = ? AND archived = 0 ORDER BY created_at ASC, id ASC`,
      args: [userId],
    }),
    client.execute({
      sql: `SELECT
              COUNT(*) AS total,
              COALESCE(SUM(CASE WHEN account_id IS NOT NULL THEN 1 ELSE 0 END), 0) AS linked,
              COALESCE(SUM(CASE WHEN account_id IS NULL THEN 1 ELSE 0 END), 0) AS unlinked,
              COALESCE(SUM(CASE WHEN account_id IS NULL AND account_review_status = 'pending' THEN 1 ELSE 0 END), 0) AS pending,
              COALESCE(SUM(CASE WHEN account_review_status = 'confirmed' THEN 1 ELSE 0 END), 0) AS confirmed,
              COALESCE(SUM(CASE WHEN account_review_status = 'rejected' THEN 1 ELSE 0 END), 0) AS rejected,
              COALESCE(SUM(CASE WHEN account_id IS NULL THEN amount ELSE 0 END), 0) AS unlinkedAmount,
              MIN(transaction_date) AS earliest,
              MAX(transaction_date) AS latest
            FROM transactions WHERE user_id = ?`,
      args: [userId],
    }),
    client.execute({
      sql: `SELECT COUNT(*) AS total,
              COALESCE(SUM(CASE WHEN transfer_group_id IS NOT NULL THEN 1 ELSE 0 END), 0) AS grouped,
              COALESCE(SUM(CASE WHEN transfer_group_id IS NULL THEN 1 ELSE 0 END), 0) AS ungrouped,
              COALESCE(SUM(CASE WHEN transfer_review_status = 'rejected' THEN 1 ELSE 0 END), 0) AS rejected
            FROM transactions WHERE user_id = ? AND type = 'transfer'`,
      args: [userId],
    }),
    computeAccountLedger(client, userId),
  ]);

  const accounts = (accountsRes.rows || []).map((r) => {
    const systemBalance = ledger.accounts.find((a) => String(a.id) === String(r.id))?.closingBalance ?? null;
    const realBalance = r.real_balance === null || r.real_balance === undefined ? null : Number(r.real_balance);
    const openingBalance = r.opening_balance === null || r.opening_balance === undefined ? null : Number(r.opening_balance);
    return {
      id: String(r.id),
      name: String(r.name),
      type: String(r.type),
      currency: String(r.currency || 'IDR'),
      openingBalance,
      openingBalanceDate: r.opening_balance_date || null,
      realBalance,
      realBalanceDate: r.real_balance_date || null,
      realBalanceVerifiedAt: r.real_balance_verified_at || null,
      balanceAnchorStatus: r.balance_anchor_status || null,
      systemBalance,
      verificationStatus: accountVerificationStatus(r),
    };
  });

  // own_accounts (untuk sinyal HIGH yang butuh pembuatan akun).
  let ownAccounts = [];
  try {
    const settings = await client.execute({
      sql: 'SELECT own_accounts FROM user_financial_settings WHERE user_id = ?',
      args: [userId],
    });
    const raw = settings.rows?.[0]?.own_accounts;
    if (raw && typeof raw === 'string') ownAccounts = JSON.parse(raw);
    else if (Array.isArray(raw)) ownAccounts = raw;
  } catch { ownAccounts = []; }

  // P2.8 §4/§9 — account activation: kandidat akun milik sendiri (own_accounts)
  // yang BELUM dibuat sebagai rekening. User TIDAK pernah di-create otomatis;
  // daftar ini hanya untuk CTA "Tambahkan Rekening" yang eksplisit.
  const accountNames = new Set(accounts.map((a) => a.name.trim().toLowerCase()));
  const accountCandidates = (ownAccounts || [])
    .map((n) => String(n).trim())
    .filter((n) => n.length > 0 && !accountNames.has(n.toLowerCase()));

  // Suggestions per transaksi pending (satu query, klasifikasi JS).
  // P2.9 §12 — transaksi LOW (tanpa sinyal akun) dikumpulkan terpisah untuk
  // bulk-assign manual (UI: checkbox + pilih rekening + Terapkan). Hanya
  // id/merchant/amount/date — tanpa payload sensitif; TIDAK pernah di-assign
  // otomatis.
  const pendingTx = await listPendingTransactions(client, userId);
  const suggestionMap = new Map(); // `${accountName}|${confidence}` -> { count, totalAmount }
  const suggestibleByAccount = new Map(); // accountName -> count
  const lowPending = [];
  for (const t of pendingTx) {
    const s = suggestTransactionAccount({ transaction: t, accounts, ownAccounts });
    const key = `${s.suggestedAccountName || 'none'}|${s.confidence}`;
    const entry = suggestionMap.get(key) || { accountName: s.suggestedAccountName, accountId: s.suggestedAccountId, confidence: s.confidence, count: 0, totalAmount: 0 };
    entry.count += 1;
    entry.totalAmount = round2(entry.totalAmount + Number(t.amount));
    suggestionMap.set(key, entry);
    if (s.suggestedAccountName) {
      suggestibleByAccount.set(s.suggestedAccountName, (suggestibleByAccount.get(s.suggestedAccountName) || 0) + 1);
    }
    // P2.9 §12 — LOW untuk KLASIFIKASI (income/expense/refund). Transfer punya
    // alur pairing sendiri (§14–17) — memasukkannya ke checklist "pilih
    // rekening" justru menyesatkan (bukan jalur resolusi transfer).
    if (s.confidence === 'low' && String(t.type) !== 'transfer') {
      lowPending.push({
        id: String(t.id),
        merchant: String(t.merchant || ''),
        amount: round2(Number(t.amount)),
        date: String(t.transaction_date || ''),
        // P3.0 §12 — filter UI All/Income/Expense/Refund (transfer sudah
        // dikecualikan di atas; jalur resolusi transfer = pairing, bukan assign).
        type: String(t.type || ''),
      });
    }
  }
  const suggestions = [...suggestionMap.values()].sort((a, b) => b.count - a.count);

  // Kandidat pairing transfer (ungrouped transfer ↔ income same date/amount).
  // P2.8 §17: transfer yang user TOLAK (transfer_review_status='rejected')
  // tidak disarankan ulang — tetap ungrouped/unresolved, hanya sugesti yang
  // berhenti (jujur, bukan auto-pair).
  const [transferRows, incomeRows] = await Promise.all([
    client.execute({
      sql: `SELECT id, type, amount, merchant, transaction_date FROM transactions
            WHERE user_id = ? AND type = 'transfer' AND transfer_group_id IS NULL
              AND transfer_review_status != 'rejected' ORDER BY id ASC`,
      args: [userId],
    }),
    client.execute({
      sql: `SELECT id, type, amount, merchant, transaction_date FROM transactions
            WHERE user_id = ? AND type = 'income' ORDER BY id ASC`,
      args: [userId],
    }),
  ]);
  const transferPairSuggestions = suggestTransferPairs(transferRows.rows || [], incomeRows.rows || []);

  // P3.1 §20/§21 — daftar transaksi TERTAUT (confirmed + account_id) untuk
  // section "Perbaiki penautan" (reassign eksplisit). UI list terbatas (bukan
  // agregasi finansial — agregasi tetap windowless): 100 terbaru oleh tanggal.
  const linkedAgg = await client.execute({
    sql: `SELECT t.id, t.type, t.amount, t.merchant, t.transaction_date, t.account_id,
                 COALESCE(w.name, '') AS account_name
          FROM transactions t LEFT JOIN wallet_accounts w ON w.id = t.account_id AND w.user_id = t.user_id
          WHERE t.user_id = ? AND t.account_id IS NOT NULL AND t.account_review_status = 'confirmed'
          ORDER BY t.transaction_date DESC, t.id DESC
          LIMIT 100`,
    args: [userId],
  });
  const linkedTransactions = (linkedAgg.rows || []).map((t) => ({
    id: String(t.id),
    merchant: String(t.merchant || ''),
    amount: round2(Number(t.amount)),
    date: String(t.transaction_date || ''),
    type: String(t.type || ''),
    accountId: String(t.account_id || ''),
    accountName: String(t.account_name || ''),
  }));

  const tx = txAgg.rows?.[0] || {};
  const transfers = transferAgg.rows?.[0] || {};
  const openingConfigured = accounts.filter((a) => a.openingBalance !== null).length;
  const anchoredCount = accounts.filter((a) => a.realBalance !== null && a.realBalanceDate).length;
  const unclassifiedCount = Number(tx.unlinked || 0);
  const unresolvedTransfers = Number(transfers.ungrouped || 0);
  const totalTransactions = Number(tx.total || 0);
  const totalTransfers = Number(transfers.total || 0);

  // P2.9 §28 — completion score deterministik (lihat completionScore).
  const score = completionScore({
    accounts,
    accountCandidates,
    anchoredCount,
    unclassifiedCount,
    unresolvedTransfers,
    totalTransactions,
    totalTransfers,
  });

  const state = {
    status: reconciliationStatus({ accounts, openingConfigured, anchoredCount, unclassifiedCount, unresolvedTransfers }),
    accounts,
    // P2.8: kandidat aktivasi akun (own_accounts yang belum dibuat) — UI
    // merender CTA "Tambahkan Rekening" per kandidat; pembuatan TETAP aksi
    // eksplisit user (TIDAK pernah auto-create).
    accountCandidates,
    openingBalancesConfigured: openingConfigured,
    anchoredAccounts: anchoredCount,
    transactions: {
      total: totalTransactions,
      linked: Number(tx.linked || 0),
      unlinked: unclassifiedCount,
      unlinkedAmount: round2(tx.unlinkedAmount || 0),
      pending: Number(tx.pending || 0),
      confirmed: Number(tx.confirmed || 0),
      rejected: Number(tx.rejected || 0),
    },
    transfers: {
      total: totalTransfers,
      grouped: Number(transfers.grouped || 0),
      ungrouped: unresolvedTransfers,
      rejected: Number(transfers.rejected || 0),
    },
    transferPairSuggestions,
    suggestions,
    // P2.9 §12 — daftar transaksi LOW untuk bulk-assign manual (checklist UI).
    unassignedTransactions: lowPending,
    // P3.1 §20/§21 — daftar transaksi tertaut untuk section "Perbaiki penautan".
    linkedTransactions,
    // P2.9 §28 — skor penyelesaian + rincian (deterministik dari state).
    completionScore: score,
    dateCoverage: { earliest: tx.earliest || null, latest: tx.latest || null },
    currentBalance: ledger.currentBalance,
    balanceConfidence: balanceConfidence({
      accounts,
      unclassifiedCount,
      unresolvedTransfers,
    }),
    onboardingProgress: {
      accountsConfigured: accounts.length > 0,
      openingBalancesConfigured: openingConfigured === accounts.length && accounts.length > 0,
      transactionsReconciled: unclassifiedCount === 0,
      transfersReconciled: unresolvedTransfers === 0,
      realBalanceVerified: accounts.length > 0 && accounts.every((a) => a.verificationStatus === 'verified'),
      // Progress hanya bermakna jika onboarding akun sudah dimulai — tanpa
      // akun, step 3–5 bersifat vacuous (0 unclassified / 0 transfer).
      completedSteps: accounts.length > 0
        ? [
            true,
            openingConfigured === accounts.length,
            unclassifiedCount === 0,
            unresolvedTransfers === 0,
            accounts.every((a) => a.verificationStatus === 'verified'),
          ].filter(Boolean).length
        : 0,
      totalSteps: 5,
    },
  };
  return state;
}
