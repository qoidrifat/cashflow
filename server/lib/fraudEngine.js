/**
 * Fraud Detection — L1 Rule Engine (deterministic, pure, testable).
 *
 * Lapisan heuristik GRATIS yang berjalan pada SETIAP transaksi baru (tanpa AI).
 * Modul ini PURE — tidak menyentuh DB/network; semua input lewat parameter,
 * sehingga mudah di-unit-test dan kelak digantikan/dikombinasikan dengan L3 ML.
 *
 * Desain: docs/ai/FRAUD_DETECTION_DESIGN.md · ADR-011-fraud-detection.
 */

export const FRAUD_RULES = {
  duplicate: 'duplicate',
  velocity: 'velocity',
  amount_outlier: 'amount_outlier',
  new_merchant: 'new_merchant',
  category_anomaly: 'category_anomaly',
};

export const FRAUD_SEVERITIES = ['low', 'medium', 'high', 'critical'];

/** Label Bahasa Indonesia per rule (dipakai notifikasi + UI). */
export const FRAUD_RULE_LABELS = {
  duplicate: 'Duplikat',
  velocity: 'Aktivitas tinggi',
  amount_outlier: 'Nominal tidak wajar',
  new_merchant: 'Merchant baru',
  category_anomaly: 'Kategori anomali',
};

/** Threshold default (bisa di-override per panggilan via thresholds). */
export const DEFAULT_THRESHOLDS = {
  duplicateWindowDays: 7,
  velocityWindowHours: 24,
  velocityMaxPerMerchant: 5,
  amountOutlierP99Factor: 1.5,
  amountOutlierHighP99Factor: 3,
  newMerchantAmountFactor: 2,
};

/** Skor risiko deterministik per severity (dipakai sebelum L2 AI). */
export const SEVERITY_RISK_SCORE = {
  low: 0.3,
  medium: 0.55,
  high: 0.75,
  critical: 0.9,
};

/**
 * Evaluasi seluruh rule untuk satu transaksi.
 *
 * @param {object} params
 * @param {object} params.transaction  — { id, type, amount, merchant, gmailMessageId, categoryId }
 * @param {object} params.aggregates   — { gmailMessageIdExists, recentDuplicateCount,
 *        merchantCount24h, merchantSeen, p99Amount, medianAmount, categoryType }
 * @param {object} [params.thresholds] — override DEFAULT_THRESHOLDS
 * @returns {Array<{rule: string, severity: string, description: string, ruleData: object}>}
 */
export function evaluateFraudRules({ transaction, aggregates = {}, thresholds = {} }) {
  const t = { ...DEFAULT_THRESHOLDS, ...thresholds };
  const flags = [];

  const { type, gmailMessageId = null } = transaction || {};
  const amountNum = Number(transaction?.amount) || 0;
  const merchant = typeof transaction?.merchant === 'string' ? transaction.merchant.trim() : '';
  const hasMerchant = merchant.length > 0;

  // 1. Duplicate — ID email Gmail yang sama (indikasi kuat double-sync).
  if (gmailMessageId && aggregates.gmailMessageIdExists) {
    flags.push({
      rule: FRAUD_RULES.duplicate,
      severity: 'critical',
      description: 'Transaksi dengan ID email Gmail yang sama sudah tercatat — kemungkinan duplikat sinkronisasi.',
      ruleData: { basis: 'gmail_message_id' },
    });
  } else if (hasMerchant && Number(aggregates.recentDuplicateCount) > 0) {
    // Duplicate — nominal + merchant + jendela waktu sama.
    flags.push({
      rule: FRAUD_RULES.duplicate,
      severity: 'high',
      description: `Transaksi dengan nominal sama ke ${merchant} dalam ${t.duplicateWindowDays} hari terakhir — cek kemungkinan entri ganda.`,
      ruleData: { basis: 'amount_merchant_window', windowDays: t.duplicateWindowDays },
    });
  }

  // 2. Velocity — frekuensi transaksi per merchant dalam 24 jam.
  if (hasMerchant && Number(aggregates.merchantCount24h) > t.velocityMaxPerMerchant) {
    flags.push({
      rule: FRAUD_RULES.velocity,
      severity: 'medium',
      description: `${aggregates.merchantCount24h} transaksi ke ${merchant} dalam 24 jam terakhir — aktivitas tidak wajar.`,
      ruleData: { count: aggregates.merchantCount24h, windowHours: t.velocityWindowHours, max: t.velocityMaxPerMerchant },
    });
  }

  // 3. Amount outlier — nominal vs p99 historis user untuk tipe yang sama.
  const p99 = Number(aggregates.p99Amount) || 0;
  if (p99 > 0 && amountNum > p99 * t.amountOutlierHighP99Factor) {
    flags.push({
      rule: FRAUD_RULES.amount_outlier,
      severity: 'high',
      description: `Nominal jauh di atas pola transaksi ${type} (di atas 3× p99 pengguna sebesar ${Math.round(p99)}).`,
      ruleData: { p99, factor: t.amountOutlierHighP99Factor },
    });
  } else if (p99 > 0 && amountNum > p99 * t.amountOutlierP99Factor) {
    flags.push({
      rule: FRAUD_RULES.amount_outlier,
      severity: 'medium',
      description: `Nominal lebih tinggi dari pola transaksi ${type} biasanya (p99 pengguna ${Math.round(p99)}).`,
      ruleData: { p99, factor: t.amountOutlierP99Factor },
    });
  }

  // 4. New merchant — merchant belum pernah muncul + nominal di atas kebiasaan.
  const median = Number(aggregates.medianAmount) || 0;
  if (hasMerchant && !aggregates.merchantSeen && median > 0 && amountNum > median * t.newMerchantAmountFactor) {
    flags.push({
      rule: FRAUD_RULES.new_merchant,
      severity: 'medium',
      description: `${merchant} baru pertama kali muncul dengan nominal di atas kebiasaan kamu.`,
      ruleData: { median, factor: t.newMerchantAmountFactor },
    });
  }

  // 5. Category anomaly — pengeluaran tercatat di kategori ber-type income.
  if (type === 'expense' && aggregates.categoryType === 'income') {
    flags.push({
      rule: FRAUD_RULES.category_anomaly,
      severity: 'low',
      description: 'Transaksi pengeluaran tercatat di kategori yang biasanya berisi pemasukan — cek klasifikasi.',
      ruleData: { categoryType: aggregates.categoryType },
    });
  }

  return flags;
}

/** Severity tertinggi dari daftar flag (fallback 'low'). */
export function getHighestSeverity(flags) {
  let highest = FRAUD_SEVERITIES[0];
  for (const flag of flags || []) {
    if (FRAUD_SEVERITIES.indexOf(flag.severity) > FRAUD_SEVERITIES.indexOf(highest)) {
      highest = flag.severity;
    }
  }
  return highest;
}

/** Skor risiko deterministik 0..1 dari severity tertinggi (pra-AI). */
export function computeRuleRiskScore(flags) {
  if (!flags || flags.length === 0) return 0;
  return SEVERITY_RISK_SCORE[getHighestSeverity(flags)] ?? 0;
}

/**
 * Label kolom transactions.fraud_flag untuk level L1:
 *   'flagged' — ada flag, severity low/medium (advisory)
 *   'review'  — severity high/critical (wajib dicek user)
 * (L2 AI dapat menaikkan lewat kolom fraud_score/decision; write tidak pernah diblokir.)
 */
export function getFraudFlagLabel(flags) {
  const severity = getHighestSeverity(flags);
  return severity === 'high' || severity === 'critical' ? 'review' : 'flagged';
}

/** Ringkasan label rule untuk notifikasi (mis. "Duplikat, Nominal tidak wajar"). */
export function summarizeFlags(flags) {
  return (flags || []).map((f) => FRAUD_RULE_LABELS[f.rule] || f.rule).join(', ');
}
