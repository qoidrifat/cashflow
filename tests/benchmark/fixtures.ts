/**
 * AI Benchmark Fixtures — Sprint 1 · Phase 1.6+ (Product Intelligence Refinement).
 *
 * Data bersama untuk:
 *  - tests/benchmark/aiQualityBenchmark.spec.ts  (deterministik, offline — CI)
 *  - tests/benchmark/aiLiveBenchmark.spec.ts     (integration Gemini nyata — --live)
 *
 * Bagian 1: HAND-CRAFTED edge cases (bukan generator) per kategori — tiap kasus
 *           bernama + alasan edge-nya (auditable, bukan angka acak).
 * Bagian 2: LIVE cases — subset kecil untuk dibuktikan terhadap Gemini nyata.
 *
 * Ground truth ditulis dari perilaku engine/normalizer YANG TERBACA (fraudEngine.js,
 * normalizeReceiptResult, prompt builders) — bukan asumsi.
 */
import type { AdvisorInput, Transaction } from '../../src/types';
import { buildReceipt } from './receiptImage';

// ════════════════════════════════════════════════════════════════════════════
// 1. FRAUD L1 — hand-crafted edge cases (20)
// Threshold engine (fraudEngine.js DEFAULT_THRESHOLDS): velocity > 5 transaksi/24h;
// amount outlier > 1.5×p99 (medium) / > 3×p99 (high); new_merchant > 2×median &
// median > 0; duplicate via gmailMessageId (critical) atau recentDuplicateCount > 0.
// ════════════════════════════════════════════════════════════════════════════
export interface HandCraftedFraudCase {
  name: string;
  reason: string;
  tx: Record<string, unknown>;
  ag: Record<string, unknown>;
  exp: string[];
}

export const HAND_CRAFTED_FRAUD: HandCraftedFraudCase[] = [
  {
    name: 'duplicate_gmail_id',
    reason: 'gmailMessageId yang sama sudah tercatat = duplikat sinkronisasi (severity critical).',
    tx: { id: 'hc-f1', type: 'expense', amount: 50000, merchant: 'Indomaret', gmailMessageId: 'msg-hc1' },
    ag: { gmailMessageIdExists: true },
    exp: ['duplicate'],
  },
  {
    name: 'duplicate_amount_merchant_window',
    reason: 'Nominal + merchant sama dalam 7 hari (recentDuplicateCount > 0) tanpa gmail id.',
    tx: { id: 'hc-f2', type: 'expense', amount: 75000, merchant: 'Kopi Senja' },
    ag: { recentDuplicateCount: 2 },
    exp: ['duplicate'],
  },
  {
    name: 'duplicate_count_needs_merchant',
    reason: 'Edge: recentDuplicateCount > 0 TAPI merchant kosong — hasMerchant=false, duplicate TIDAK ter-flag.',
    tx: { id: 'hc-f3', type: 'expense', amount: 75000, merchant: '' },
    ag: { recentDuplicateCount: 2 },
    exp: [],
  },
  {
    name: 'velocity_at_threshold_6',
    reason: 'Tepat di ambang: 6 > 5 (velocityMaxPerMerchant) → ter-flag.',
    tx: { id: 'hc-f4', type: 'expense', amount: 40000, merchant: 'Minimarket' },
    ag: { merchantSeen: true, merchantCount24h: 6 },
    exp: ['velocity'],
  },
  {
    name: 'velocity_below_threshold_5',
    reason: 'Edge negatif: 5 transaksi (tidak > 5) → bersih.',
    tx: { id: 'hc-f5', type: 'expense', amount: 40000, merchant: 'Minimarket' },
    ag: { merchantSeen: true, merchantCount24h: 5 },
    exp: [],
  },
  {
    name: 'amount_outlier_medium_1_6x',
    reason: '1.6× p99 (> 1.5×) → amount_outlier severity medium.',
    tx: { id: 'hc-f6', type: 'expense', amount: 160000, merchant: 'Toko B' },
    ag: { p99Amount: 100000, merchantSeen: true, medianAmount: 50000, merchantCount24h: 1 },
    exp: ['amount_outlier'],
  },
  {
    name: 'amount_outlier_high_3_5x',
    reason: '3.5× p99 (> 3×) → severity high (getFraudFlagLabel → review).',
    tx: { id: 'hc-f7', type: 'expense', amount: 350000, merchant: 'Toko C' },
    ag: { p99Amount: 100000, merchantSeen: true, medianAmount: 50000, merchantCount24h: 1 },
    exp: ['amount_outlier'],
  },
  {
    name: 'amount_outlier_just_below_1_4x',
    reason: 'Edge negatif: 1.4× p99 (di bawah 1.5×) → tidak ter-flag.',
    tx: { id: 'hc-f8', type: 'expense', amount: 140000, merchant: 'Toko D' },
    ag: { p99Amount: 100000, merchantSeen: true, medianAmount: 50000, merchantCount24h: 1 },
    exp: [],
  },
  {
    name: 'new_merchant_above_2x_median',
    reason: 'Merchant belum pernah terlihat + nominal > 2× median → new_merchant.',
    tx: { id: 'hc-f9', type: 'expense', amount: 150000, merchant: 'Toko Baru' },
    ag: { merchantSeen: false, medianAmount: 50000, p99Amount: 100000, merchantCount24h: 0 },
    exp: ['new_merchant'],
  },
  {
    name: 'new_merchant_below_2x_median',
    reason: 'Edge negatif: merchant baru tapi nominal < 2× median → bersih.',
    tx: { id: 'hc-f10', type: 'expense', amount: 90000, merchant: 'Toko Baru 2' },
    ag: { merchantSeen: false, medianAmount: 50000, p99Amount: 100000, merchantCount24h: 0 },
    exp: [],
  },
  {
    name: 'new_merchant_needs_median',
    reason: 'Edge: medianAmount 0 → syarat median > 0 gagal, new_merchant tidak ter-flag.',
    tx: { id: 'hc-f11', type: 'expense', amount: 500000, merchant: 'Toko Besar' },
    ag: { merchantSeen: false, medianAmount: 0, p99Amount: 0, merchantCount24h: 0 },
    exp: [],
  },
  {
    name: 'category_anomaly_expense_in_income_cat',
    reason: 'Pengeluaran tercatat di kategori ber-type income → category_anomaly (low).',
    tx: { id: 'hc-f12', type: 'expense', amount: 25000, merchant: 'Z', categoryId: 'c-inc' },
    ag: { categoryType: 'income', merchantSeen: true },
    exp: ['category_anomaly'],
  },
  {
    name: 'category_anomaly_only_expense',
    reason: 'Edge negatif: type income + kategori income → BUKAN anomali (rule hanya untuk expense).',
    tx: { id: 'hc-f13', type: 'income', amount: 1000000, merchant: 'Gaji', categoryId: 'c-inc' },
    ag: { categoryType: 'income', merchantSeen: true },
    exp: [],
  },
  {
    name: 'clean_normal_expense',
    reason: 'Transaksi normal: di bawah semua ambang → bersih (tidak crash, tidak false positive).',
    tx: { id: 'hc-f14', type: 'expense', amount: 45000, merchant: 'Warung' },
    ag: { merchantSeen: true, merchantCount24h: 2, p99Amount: 150000, medianAmount: 40000 },
    exp: [],
  },
  {
    name: 'clean_transfer_type',
    reason: 'Jenis transfer dengan merchant kosong → bersih.',
    tx: { id: 'hc-f15', type: 'transfer', amount: 500000, merchant: '' },
    ag: {},
    exp: [],
  },
  {
    name: 'duplicate_plus_velocity',
    reason: 'Kombinasi: gmail duplikat + velocity 8 → dua flag sekaligus.',
    tx: { id: 'hc-f16', type: 'expense', amount: 60000, merchant: 'Minimarket', gmailMessageId: 'msg-hc16' },
    ag: { gmailMessageIdExists: true, merchantSeen: true, merchantCount24h: 8 },
    exp: ['duplicate', 'velocity'],
  },
  {
    name: 'velocity_plus_amount_outlier',
    reason: 'Kombinasi: velocity 7 + nominal 2.5× p99.',
    tx: { id: 'hc-f17', type: 'expense', amount: 250000, merchant: 'Elektronik' },
    ag: { merchantSeen: true, merchantCount24h: 7, p99Amount: 100000, medianAmount: 80000 },
    exp: ['velocity', 'amount_outlier'],
  },
  {
    name: 'duplicate_plus_new_merchant',
    reason: 'Kombinasi: duplikat via count + merchant baru sekaligus.',
    tx: { id: 'hc-f18', type: 'expense', amount: 120000, merchant: 'Toko Hibrida' },
    ag: { recentDuplicateCount: 1, merchantSeen: false, medianAmount: 50000, p99Amount: 100000 },
    exp: ['duplicate', 'new_merchant'],
  },
  {
    name: 'amount_zero_with_high_p99',
    reason: 'Data korup: amount 0 dengan p99 besar → tidak ter-flag (0 tidak > p99×faktor).',
    tx: { id: 'hc-f19', type: 'expense', amount: 0, merchant: 'Toko E' },
    ag: { p99Amount: 100000, merchantSeen: true, medianAmount: 50000, merchantCount24h: 1 },
    exp: [],
  },
  {
    name: 'negative_amount_corrupt',
    reason: 'Data korup: amount negatif → engine tidak crash, tetap bersih.',
    tx: { id: 'hc-f20', type: 'expense', amount: -5000, merchant: 'Toko F' },
    ag: { p99Amount: 100000, merchantSeen: true, medianAmount: 50000, merchantCount24h: 1 },
    exp: [],
  },
];

// ════════════════════════════════════════════════════════════════════════════
// 2. OCR RECEIPT normalizer — hand-crafted edge cases (20)
// Perilaku normalizeReceiptResult (vertexContext.js): amount Number()>0 else null;
// date hanya format-check ^\d{4}-\d{2}-\d{2}$; payment method lowercase + [_ \s]→'-'
// dengan fallback 'cash'; decision valid set else needs_review; is_transaction=false → type null.
// ════════════════════════════════════════════════════════════════════════════
export interface HandCraftedOcrCase {
  name: string;
  reason: string;
  payload: Record<string, unknown>;
  expect: Record<string, unknown>;
}

export const HAND_CRAFTED_OCR: HandCraftedOcrCase[] = [
  {
    name: 'valid_full_payload',
    reason: 'Payload lengkap & valid — semua field dinormalisasi tanpa perubahan.',
    payload: { decision: 'auto_accept', is_transaction: true, transaction_type: 'expense', amount: 150000, currency: 'IDR', date: '2026-08-01', merchant: 'Indomaret', category: 'Makanan', payment_method: 'qris', note: 'Struk belanja', confidence_score: 0.92 },
    expect: { amount: 150000, payment_method: 'qris', decision: 'auto_accept', date: '2026-08-01', transaction_type: 'expense' },
  },
  {
    name: 'amount_as_string',
    reason: 'Edge: amount dikirim string "250000" oleh Gemini — Number() harus menangkap.',
    payload: { decision: 'auto_accept', is_transaction: true, transaction_type: 'expense', amount: '250000', date: '2026-08-02', payment_method: 'cash' },
    expect: { amount: 250000 },
  },
  {
    name: 'amount_with_rp_prefix',
    reason: 'Edge: "Rp 12.000" bukan angka murni → NaN → amount null (bukan crash).',
    payload: { decision: 'auto_accept', is_transaction: true, transaction_type: 'expense', amount: 'Rp 12.000', date: '2026-08-02', payment_method: 'cash' },
    expect: { amount: null },
  },
  {
    name: 'amount_thousands_dot',
    reason: 'Dokumentasi batas: "150.000" diparse JS sebagai 150 (pemisah ribuan tidak ditangani).',
    payload: { decision: 'auto_accept', is_transaction: true, transaction_type: 'expense', amount: '150.000', date: '2026-08-02', payment_method: 'cash' },
    expect: { amount: 150 },
  },
  {
    name: 'date_dmy_format',
    reason: 'Edge: format DD/MM/YYYY ditolak (hanya ISO YYYY-MM-DD yang diterima).',
    payload: { decision: 'auto_accept', is_transaction: true, transaction_type: 'expense', amount: 50000, date: '12/08/2026', payment_method: 'cash' },
    expect: { date: null },
  },
  {
    name: 'date_semantic_invalid',
    reason: 'Dokumentasi batas: "2026-13-45" lolos regex format-only (validasi semantik tidak ada).',
    payload: { decision: 'auto_accept', is_transaction: true, transaction_type: 'expense', amount: 50000, date: '2026-13-45', payment_method: 'cash' },
    expect: { date: '2026-13-45' },
  },
  {
    name: 'date_leap_valid',
    reason: 'Tanggal kabisat valid tetap diterima format regex.',
    payload: { decision: 'auto_accept', is_transaction: true, transaction_type: 'expense', amount: 50000, date: '2024-02-29', payment_method: 'cash' },
    expect: { date: '2024-02-29' },
  },
  {
    name: 'payment_kartu_kredit_spasi',
    reason: 'Edge: "kartu kredit" (spasi) → "kartu-kredit" (spasi diganti dash).',
    payload: { decision: 'auto_accept', is_transaction: true, transaction_type: 'expense', amount: 50000, date: '2026-08-02', payment_method: 'kartu kredit' },
    expect: { payment_method: 'kartu-kredit' },
  },
  {
    name: 'payment_qris_whitespace',
    reason: 'Dokumentasi batas: spasi tidak di-trim — " qris " → "--qris--" (spasi→dash) → tidak match → fallback "cash".',
    payload: { decision: 'auto_accept', is_transaction: true, transaction_type: 'expense', amount: 50000, date: '2026-08-02', payment_method: ' qris ' },
    expect: { payment_method: 'cash' },
  },
  {
    name: 'payment_unknown_fallback_cash',
    reason: 'Edge: "OVO" tidak dikenal → fallback default "cash".',
    payload: { decision: 'auto_accept', is_transaction: true, transaction_type: 'expense', amount: 50000, date: '2026-08-02', payment_method: 'OVO' },
    expect: { payment_method: 'cash' },
  },
  {
    name: 'payment_bank_transfer_spasi',
    reason: 'Edge: "bank transfer" (spasi) → "bank-transfer" → dikenali sebagai transfer-bank.',
    payload: { decision: 'auto_accept', is_transaction: true, transaction_type: 'expense', amount: 50000, date: '2026-08-02', payment_method: 'bank transfer' },
    expect: { payment_method: 'transfer-bank' },
  },
  {
    name: 'payment_ewallet',
    reason: 'e-wallet dikenali tanpa perubahan.',
    payload: { decision: 'auto_accept', is_transaction: true, transaction_type: 'expense', amount: 50000, date: '2026-08-02', payment_method: 'e-wallet' },
    expect: { payment_method: 'e-wallet' },
  },
  {
    name: 'decision_garbage',
    reason: 'Edge: decision "maybe" di luar set valid → needs_review (fail-safe, bukan crash).',
    payload: { decision: 'maybe', is_transaction: true, transaction_type: 'expense', amount: 50000, date: '2026-08-02', payment_method: 'cash' },
    expect: { decision: 'needs_review' },
  },
  {
    name: 'not_a_transaction',
    reason: 'is_transaction=false → transaction_type dinull-kan (walau payload berisi expense).',
    payload: { decision: 'auto_skip', is_transaction: false, transaction_type: 'expense', amount: null, date: null, payment_method: 'cash' },
    expect: { transaction_type: null, is_transaction: false },
  },
  {
    name: 'income_transfer_bank',
    reason: 'Penerimaan (income) via transfer-bank — kedua field dipertahankan.',
    payload: { decision: 'auto_accept', is_transaction: true, transaction_type: 'income', amount: 1000000, date: '2026-08-02', payment_method: 'transfer-bank' },
    expect: { transaction_type: 'income', payment_method: 'transfer-bank' },
  },
  {
    name: 'empty_payload_defaults',
    reason: 'Edge: payload kosong {} → default aman (needs_review, expense, cash, null amount) — normalizer tidak boleh crash.',
    payload: {},
    expect: { decision: 'needs_review', transaction_type: 'expense', amount: null, payment_method: 'cash', is_transaction: true },
  },
  {
    name: 'amount_zero_and_negative',
    reason: 'Edge: amount 0 / negatif → null (syarat > 0).',
    payload: { decision: 'auto_accept', is_transaction: true, transaction_type: 'expense', amount: -5000, date: '2026-08-02', payment_method: 'cash' },
    expect: { amount: null },
  },
  {
    name: 'huge_amount',
    reason: 'Edge: nominal sangat besar tetap diterima (bukan overflow).',
    payload: { decision: 'auto_accept', is_transaction: true, transaction_type: 'expense', amount: 999999999, date: '2026-08-02', payment_method: 'cash' },
    expect: { amount: 999999999 },
  },
  {
    name: 'unknown_transaction_type_fallback',
    reason: 'Edge: transaction_type "investment" di luar set → fallback "expense".',
    payload: { decision: 'auto_accept', is_transaction: true, transaction_type: 'investment', amount: 50000, date: '2026-08-02', payment_method: 'cash' },
    expect: { transaction_type: 'expense' },
  },
  {
    name: 'long_note_truncated',
    reason: 'Edge: note > 240 karakter di-truncate (proteksi panjang).',
    payload: { decision: 'auto_accept', is_transaction: true, transaction_type: 'expense', amount: 50000, date: '2026-08-02', payment_method: 'cash', note: 'x'.repeat(400) },
    expect: { note: 'x'.repeat(240) },
  },
];

// ════════════════════════════════════════════════════════════════════════════
// 3. GMAIL L0 local parser — hand-crafted (10)
// Ground truth mengikuti template yang sudah terbukti di benchmark (buildGmailCase)
// + edge dari prompt buildExtractionPrompt (promo/welcome/otp bukan transaksi).
// ════════════════════════════════════════════════════════════════════════════
export interface HandCraftedGmailCase {
  name: string;
  reason: string;
  email: { subject: string; from: string; body: string; date: string };
  decision: string;
  amount?: number;
}

export const HAND_CRAFTED_GMAIL: HandCraftedGmailCase[] = [
  {
    name: 'promo_discount',
    reason: 'Promo/diskon murni → auto_reject (bukan transaksi).',
    email: { subject: 'Promo Diskon 50%', from: 'promo@tokopedia.com', body: 'Dapatkan diskon besar-besaran untuk semua produk pilihan, hanya hari ini. Klik untuk melihat penawaran.', date: '2026-08-05' },
    decision: 'auto_reject',
  },
  {
    name: 'promo_cashback_up_to',
    reason: 'Cashback promo "hingga" (belum diterima) → auto_reject.',
    email: { subject: 'Cashback hingga 20%', from: 'promo@shopee.co.id', body: 'Cashback s/d 20% untuk transaksi menggunakan ShopeePay hari ini.', date: '2026-08-05' },
    decision: 'auto_reject',
  },
  {
    name: 'payment_success_shopee',
    reason: 'Pembayaran berhasil dengan nominal jelas → auto_accept + amount.',
    email: { subject: 'Pembayaran Berhasil', from: 'notif@shopee.co.id', body: 'Pembayaran berhasil. Anda membayar Rp 150.000 untuk pesanan #12345 menggunakan ShopeePay.', date: '2026-08-05' },
    decision: 'auto_accept',
    amount: 150000,
  },
  {
    name: 'payment_success_qris_variant',
    reason: 'Variasi pembayaran QRIS: L0 ragu (send_to_ai) walau amount diekstrak benar — kasus ini mendokumentasikan keputusan parser lokal.',
    email: { subject: 'Pembayaran QRIS Berhasil', from: 'notif@indomaret.co.id', body: 'Pembayaran berhasil. Anda membayar Rp 75.000 untuk pesanan #9999 menggunakan QRIS.', date: '2026-08-05' },
    decision: 'send_to_ai',
    amount: 75000,
  },
  {
    name: 'payment_success_different_amount',
    reason: 'Variasi nominal 250.000 — amount parsing harus ikut.',
    email: { subject: 'Pembayaran Berhasil', from: 'notif@blu.com', body: 'Pembayaran berhasil. Anda membayar Rp 250.000 untuk pesanan #AB12 menggunakan kartu debit.', date: '2026-08-05' },
    decision: 'auto_accept',
    amount: 250000,
  },
  {
    name: 'security_login_alert',
    reason: 'Notifikasi keamanan (bukan finansial transaksional) → auto_skip.',
    email: { subject: 'Login dari perangkat baru', from: 'security@bankjago.com', body: 'Login dari perangkat baru terdeteksi. Jika bukan Anda, segera hubungi kami.', date: '2026-08-05' },
    decision: 'auto_skip',
  },
  {
    name: 'otp_code',
    reason: 'Kode OTP/2FA → auto_skip (bukan transaksi).',
    email: { subject: 'Kode OTP Anda', from: 'no-reply@bankbni.co.id', body: 'Kode OTP Anda adalah 123456. Jangan bagikan kode ini kepada siapa pun.', date: '2026-08-05' },
    decision: 'auto_skip',
  },
  {
    name: 'welcome_card',
    reason: 'Aktivasi/welcome kartu → auto_reject (bukan transaksi, per aturan prompt).',
    email: { subject: 'Selamat datang di kartu kredit Anda', from: 'welcome@bankmandiri.co.id', body: 'Kartu kredit Anda aktif. Nikmati kemudahan bertransaksi. Dapatkan cashback hingga Rp 100.000.', date: '2026-08-05' },
    decision: 'auto_reject',
  },
  {
    name: 'ambiguous_thanks',
    reason: 'Email ambigu tanpa transaksi eksplisit → auto_skip (fail-safe).',
    email: { subject: 'Terima kasih', from: 'info@blu.com', body: 'Terima kasih telah menggunakan layanan kami. Semoga harimu menyenangkan.', date: '2026-08-05' },
    decision: 'auto_skip',
  },
  {
    name: 'promo_with_nominal',
    reason: 'Promo berisi nominal besar tapi belum transaksi → auto_reject.',
    email: { subject: 'Dapatkan cashback Rp 1.000.000', from: 'promo@tokopedia.com', body: 'Dapatkan cashback hingga Rp 1.000.000 untuk pembelian produk pilihan minggu ini. Syarat & ketentuan berlaku.', date: '2026-08-05' },
    decision: 'auto_reject',
  },
];

// ════════════════════════════════════════════════════════════════════════════
// 4. INSIGHT fallback — hand-crafted (8)
// Health/score mengikuti buildFallbackMonthlyReport: sehat (surplus), kritis
// (defisit), waspada (rasio tinggi), stabil, empty (skor 70).
// ════════════════════════════════════════════════════════════════════════════
export interface HandCraftedInsightCase {
  name: string;
  reason: string;
  input: { transactions: Transaction[]; month: number; year: number };
  health: string;
  score: [number, number];
  contains: string[];
}

function tx(id: string, type: Transaction['type'], amount: number, date: string, merchant: string, categoryName: string): Transaction {
  return { id, type, amount, date, merchant, categoryId: categoryName, categoryName } as Transaction;
}

function incomeTx(id: string, amount: number): Transaction {
  return tx(id, 'income', amount, '2026-08-05', 'Gaji', 'Gaji');
}

function expenseTx(id: string, amount: number, day: number, merchant: string): Transaction {
  return tx(id, 'expense', amount, `2026-08-${10 + day}`, merchant, 'Makanan & Minuman');
}

export const HAND_CRAFTED_INSIGHT: HandCraftedInsightCase[] = [
  {
    name: 'healthy_surplus',
    reason: 'Pengeluaran 40% dari pendapatan → sehat, skor 75-100, mengandung sinyal surplus.',
    input: { transactions: [incomeTx('hc-i1-inc', 10000000), expenseTx('hc-i1-e1', 2000000, 1, 'Indomaret'), expenseTx('hc-i1-e2', 2000000, 2, 'Gojek')], month: 8, year: 2026 },
    health: 'sehat',
    score: [75, 100],
    contains: ['surplus'],
  },
  {
    name: 'savings_good_30pct',
    reason: 'Rasio 30% (sangat hemat) → sehat.',
    input: { transactions: [incomeTx('hc-i2-inc', 8000000), expenseTx('hc-i2-e1', 1200000, 1, 'Warung'), expenseTx('hc-i2-e2', 1200000, 2, 'Gojek')], month: 8, year: 2026 },
    health: 'sehat',
    score: [75, 100],
    contains: ['surplus'],
  },
  {
    name: 'critical_deficit',
    reason: 'Pengeluaran > pendapatan → kritis, skor 0-50, sinyal negatif.',
    input: { transactions: [incomeTx('hc-i3-inc', 5000000), expenseTx('hc-i3-e1', 3000000, 1, 'Mall'), expenseTx('hc-i3-e2', 3000000, 2, 'Elektronik')], month: 8, year: 2026 },
    health: 'kritis',
    score: [0, 50],
    contains: ['negatif'],
  },
  {
    name: 'watch_high_ratio',
    reason: 'Rasio 90% → waspada, skor 55-75, sinyal "di atas batas".',
    input: { transactions: [incomeTx('hc-i4-inc', 10000000), expenseTx('hc-i4-e1', 4500000, 1, 'Mall'), expenseTx('hc-i4-e2', 4500000, 2, 'Restoran')], month: 8, year: 2026 },
    health: 'waspada',
    score: [55, 75],
    contains: ['di atas batas'],
  },
  {
    name: 'stable_70pct',
    reason: 'Rasio 70% → stabil, skor 70-90.',
    input: { transactions: [incomeTx('hc-i5-inc', 10000000), expenseTx('hc-i5-e1', 3500000, 1, 'Indomaret'), expenseTx('hc-i5-e2', 3500000, 2, 'Bensin')], month: 8, year: 2026 },
    health: 'stabil',
    score: [70, 90],
    contains: [],
  },
  {
    name: 'empty_no_data',
    reason: 'Tanpa transaksi → fallback stabil skor 70 (tidak crash).',
    input: { transactions: [], month: 8, year: 2026 },
    health: 'stabil',
    score: [70, 70],
    contains: [],
  },
  {
    name: 'merchant_concentration',
    reason: '≥6 transaksi merchant sama (90% rasio pengeluaran) → sinyal "Frekuensi tinggi" + waspada.',
    input: {
      transactions: [
        incomeTx('hc-i7-inc', 10000000),
        expenseTx('hc-i7-e1', 1500000, 1, 'Toko Rutin'),
        expenseTx('hc-i7-e2', 1500000, 2, 'Toko Rutin'),
        expenseTx('hc-i7-e3', 1500000, 3, 'Toko Rutin'),
        expenseTx('hc-i7-e4', 1500000, 4, 'Toko Rutin'),
        expenseTx('hc-i7-e5', 1500000, 5, 'Toko Rutin'),
        expenseTx('hc-i7-e6', 1500000, 6, 'Toko Rutin'),
      ],
      month: 8,
      year: 2026,
    },
    health: 'waspada',
    score: [55, 75],
    contains: ['Frekuensi tinggi'],
  },
  {
    name: 'watch_borderline_88',
    reason: 'Rasio 88% (batas atas rentang waspada 85-97%) → waspada.',
    input: { transactions: [incomeTx('hc-i8-inc', 10000000), expenseTx('hc-i8-e1', 4400000, 1, 'Mall'), expenseTx('hc-i8-e2', 4400000, 2, 'Travel')], month: 8, year: 2026 },
    health: 'waspada',
    score: [55, 75],
    contains: ['di atas batas'],
  },
];

// ════════════════════════════════════════════════════════════════════════════
// 5. ADVISOR fallback — hand-crafted (8)
// Teks sinyal mengikuti template yang sudah terbukti di benchmark (buildAdvisorInput).
// ════════════════════════════════════════════════════════════════════════════
export interface HandCraftedAdvisorCase {
  name: string;
  reason: string;
  input: AdvisorInput;
  contains: string[];
}

function advisorInput(partial: Partial<AdvisorInput>): AdvisorInput {
  return {
    transactions: [],
    budgets: [],
    subscriptions: [],
    wallets: [{ id: 'w1', name: 'Utama', balance: 30000000 }],
    goals: [{ id: 'g1', name: 'Liburan', targetAmount: 12000000, currentAmount: 3000000 }],
    month: 8,
    year: 2026,
    ...partial,
  } as unknown as AdvisorInput;
}

export const HAND_CRAFTED_ADVISOR: HandCraftedAdvisorCase[] = [
  {
    name: 'high_ratio_95',
    reason: 'Rasio pengeluaran 95% → saran pengeluaran (sinyal "Pengeluaran sudah").',
    input: advisorInput({ transactions: [incomeTx('hc-a1-inc', 10000000), expenseTx('hc-a1-e1', 4750000, 1, 'Mall'), expenseTx('hc-a1-e2', 4750000, 2, 'Restoran')] }),
    contains: ['Pengeluaran sudah'],
  },
  {
    name: 'high_ratio_98',
    reason: 'Rasio 98% — variasi ekstrem tetap memicu sinyal pengeluaran.',
    input: advisorInput({ transactions: [incomeTx('hc-a2-inc', 10000000), expenseTx('hc-a2-e1', 4900000, 1, 'Mall'), expenseTx('hc-a2-e2', 4900000, 2, 'Travel')] }),
    contains: ['Pengeluaran sudah'],
  },
  {
    name: 'low_emergency_fund',
    reason: 'Saldo 2jt → sinyal dana darurat.',
    input: advisorInput({ wallets: [{ id: 'w1', name: 'Utama', balance: 2000000 }], transactions: [incomeTx('hc-a3-inc', 10000000), expenseTx('hc-a3-e1', 3000000, 1, 'Sewa')] }),
    contains: ['dana darurat'],
  },
  {
    name: 'very_low_emergency_fund',
    reason: 'Saldo 1jt — variasi ekstrem tetap dana darurat.',
    input: advisorInput({ wallets: [{ id: 'w1', name: 'Utama', balance: 1000000 }], transactions: [incomeTx('hc-a4-inc', 10000000), expenseTx('hc-a4-e1', 4000000, 1, 'Sewa')] }),
    contains: ['dana darurat'],
  },
  {
    name: 'subscription_heavy',
    reason: 'Langganan 2,5jt/bulan → sinyal optimasi langganan ("Total langganan").',
    input: advisorInput({
      subscriptions: [
        { id: 's1', name: 'Netflix', amount: 1500000, cycle: 'monthly' },
        { id: 's2', name: 'Spotify', amount: 1000000, cycle: 'monthly' },
      ],
      transactions: [incomeTx('hc-a5-inc', 10000000), expenseTx('hc-a5-e1', 3000000, 1, 'Toko')],
    }),
    contains: ['Total langganan'],
  },
  {
    name: 'over_budget_category',
    reason: 'Pengeluaran melebihi budget kategori → sinyal kategori budget.',
    input: advisorInput({
      budgets: [{ id: 'b1', categoryId: 'Makanan & Minuman', categoryName: 'Makanan & Minuman', amount: 4000000, month: 8, year: 2026 }],
      transactions: [incomeTx('hc-a6-inc', 10000000), expenseTx('hc-a6-e1', 4500000, 1, 'Indomaret')],
    }),
    contains: ['Makanan & Minuman'],
  },
  {
    name: 'healthy_profile',
    reason: 'Profil sehat → sinyal auto-transfer & surplus.',
    input: advisorInput({ transactions: [incomeTx('hc-a7-inc', 10000000), expenseTx('hc-a7-e1', 3000000, 1, 'Indomaret'), expenseTx('hc-a7-e2', 3000000, 2, 'Gojek')] }),
    contains: ['auto-transfer', 'Surplus'],
  },
  {
    name: 'empty_profile',
    reason: 'Tanpa data → fallback laporan (tidak crash).',
    input: advisorInput({ transactions: [] }),
    contains: ['Laporan'],
  },
];

// ════════════════════════════════════════════════════════════════════════════
// 6. SEARCH re-rank — hand-crafted (8)
// ════════════════════════════════════════════════════════════════════════════
export interface HandCraftedSearchCase {
  name: string;
  reason: string;
  results: Array<Record<string, unknown>>;
  query: string;
  tab: string;
  filters?: Record<string, unknown>;
  expectedTopId?: string;
}

function searchResult(id: string, overrides: Record<string, unknown>): Record<string, unknown> {
  return {
    id,
    title: 'Merch',
    merchant: 'Merch',
    category: 'lainnya',
    amount: 20000,
    transaction_date: '2026-08-05',
    ...overrides,
  };
}

export const HAND_CRAFTED_SEARCH: HandCraftedSearchCase[] = [
  {
    name: 'exact_merchant',
    reason: 'Query = nama merchant persis → hasil itu harus top-1.',
    results: [
      searchResult('s1', { title: 'Indomaret Rp50.000', merchant: 'Indomaret', amount: 50000, category: 'makanan-minuman' }),
      searchResult('s2', { title: 'Alfamart Rp30.000', merchant: 'Alfamart', amount: 30000 }),
      searchResult('s3', { title: 'Gojek Rp25.000', merchant: 'Gojek', amount: 25000 }),
    ],
    query: 'Indomaret',
    tab: 'transactions',
    expectedTopId: 's1',
  },
  {
    name: 'partial_merchant',
    reason: 'Query parsial "Indo" → hasil merchant terdekat top-1.',
    results: [
      searchResult('s1', { title: 'Indomaret Rp50.000', merchant: 'Indomaret', amount: 50000 }),
      searchResult('s2', { title: 'Indie Mart Rp30.000', merchant: 'Indie Mart', amount: 30000 }),
      searchResult('s3', { title: 'Gojek Rp25.000', merchant: 'Gojek', amount: 25000 }),
    ],
    query: 'Indo',
    tab: 'transactions',
    expectedTopId: 's1',
  },
  {
    name: 'amount_in_query',
    reason: 'Query nominal "150000" → hasil dengan amount itu top-1.',
    results: [
      searchResult('s1', { title: 'Toko A Rp150.000', merchant: 'Toko A', amount: 150000 }),
      searchResult('s2', { title: 'Toko B Rp15.000', merchant: 'Toko B', amount: 15000 }),
      searchResult('s3', { title: 'Toko C Rp1.500', merchant: 'Toko C', amount: 1500 }),
    ],
    query: '150000',
    tab: 'transactions',
    expectedTopId: 's1',
  },
  {
    name: 'date_in_range',
    reason: 'Filter rentang tanggal — hasil dalam rentang dinaikkan ke top-1.',
    results: [
      searchResult('s1', { title: 'Toko A Rp50.000', merchant: 'Toko A', amount: 50000, transaction_date: '2026-08-05' }),
      searchResult('s2', { title: 'Toko B Rp60.000', merchant: 'Toko B', amount: 60000, transaction_date: '2026-09-01' }),
      searchResult('s3', { title: 'Toko C Rp40.000', merchant: 'Toko C', amount: 40000, transaction_date: '2026-08-03' }),
    ],
    query: 'Toko',
    tab: 'transactions',
    filters: { dateFrom: '2026-08-01', dateTo: '2026-08-10' },
    expectedTopId: 's1',
  },
  {
    name: 'date_out_of_range',
    reason: 'Dokumentasi batas: filter rentang tanggal TIDAK menghapus hasil di luar rentang (hanya boosting) — urutan aktual dipertahankan.',
    results: [
      searchResult('s1', { title: 'Toko A Rp50.000', merchant: 'Toko A', amount: 50000, transaction_date: '2026-09-01' }),
      searchResult('s2', { title: 'Toko B Rp60.000', merchant: 'Toko B', amount: 60000, transaction_date: '2026-08-05' }),
    ],
    query: 'Toko',
    tab: 'transactions',
    filters: { dateFrom: '2026-08-01', dateTo: '2026-08-10' },
    expectedTopId: 's1',
  },
  {
    name: 'category_boost',
    reason: 'Query kategori "Makanan" → hasil kategori makanan top-1.',
    results: [
      searchResult('s1', { title: 'Indomaret Rp50.000', merchant: 'Indomaret', amount: 50000, category: 'makanan-minuman' }),
      searchResult('s2', { title: 'SPBU Rp100.000', merchant: 'SPBU', amount: 100000, category: 'transportasi' }),
    ],
    query: 'Makanan',
    tab: 'transactions',
    expectedTopId: 's1',
  },
  {
    name: 'merchant_not_found',
    reason: 'Query tidak cocok merchant mana pun → tidak crash; hasil tetap ter-return (urutan stabil).',
    results: [
      searchResult('s1', { title: 'Indomaret Rp50.000', merchant: 'Indomaret', amount: 50000 }),
      searchResult('s2', { title: 'Gojek Rp25.000', merchant: 'Gojek', amount: 25000 }),
    ],
    query: 'zzz-tidak-ada',
    tab: 'transactions',
    expectedTopId: 's1',
  },
  {
    name: 'empty_results',
    reason: 'Tanpa hasil → array kosong (tidak crash).',
    results: [],
    query: 'Indomaret',
    tab: 'transactions',
    expectedTopId: undefined,
  },
];

// ════════════════════════════════════════════════════════════════════════════
// 7. LIVE — kasus untuk integration Gemini nyata (subset kecil, biaya terkontrol)
// ════════════════════════════════════════════════════════════════════════════
export interface LiveFraudCase {
  name: string;
  tx: Record<string, unknown>;
  ag: Record<string, unknown>;
  /** flags L1 yang diharapkan (dipakai untuk menilai agree L2 vs L1). */
  exp: string[];
}

export const LIVE_FRAUD: LiveFraudCase[] = [
  { name: 'live_fraud_duplicate', tx: { id: 'lf1', type: 'expense', amount: 150000, merchant: 'Kopi Senja', gmailMessageId: 'msg-live1' }, ag: { gmailMessageIdExists: true }, exp: ['duplicate'] },
  { name: 'live_fraud_velocity', tx: { id: 'lf2', type: 'expense', amount: 40000, merchant: 'Minimarket' }, ag: { merchantSeen: true, merchantCount24h: 9 }, exp: ['velocity'] },
  { name: 'live_fraud_amount_outlier', tx: { id: 'lf3', type: 'expense', amount: 320000, merchant: 'Elektronik' }, ag: { p99Amount: 100000, medianAmount: 50000, merchantSeen: true, merchantCount24h: 1 }, exp: ['amount_outlier'] },
  { name: 'live_fraud_new_merchant', tx: { id: 'lf4', type: 'expense', amount: 150000, merchant: 'Toko Baru' }, ag: { merchantSeen: false, medianAmount: 50000, p99Amount: 100000, merchantCount24h: 0 }, exp: ['new_merchant'] },
  { name: 'live_fraud_clean', tx: { id: 'lf5', type: 'expense', amount: 45000, merchant: 'Warung' }, ag: { merchantSeen: true, merchantCount24h: 2, p99Amount: 150000, medianAmount: 40000 }, exp: [] },
];

export interface LiveGmailCase {
  name: string;
  email: { subject: string; from: string; body: string; date: string };
  expected: { isTransaction: boolean; amount?: number; transactionType?: string };
}

export const LIVE_GMAIL: LiveGmailCase[] = [
  {
    name: 'live_gmail_payment_success',
    email: { subject: 'Pembayaran Berhasil', from: 'notif@shopee.co.id', body: 'Pembayaran berhasil. Anda membayar Rp 150.000 untuk pesanan #12345 menggunakan ShopeePay.', date: '2026-08-05' },
    expected: { isTransaction: true, amount: 150000, transactionType: 'expense' },
  },
  {
    name: 'live_gmail_promo_discount',
    email: { subject: 'Promo Diskon 50%', from: 'promo@tokopedia.com', body: 'Dapatkan diskon besar-besaran untuk semua produk pilihan, hanya hari ini. Klik untuk melihat penawaran.', date: '2026-08-05' },
    expected: { isTransaction: false },
  },
  {
    name: 'live_gmail_promo_cashback',
    email: { subject: 'Cashback hingga 20%', from: 'promo@shopee.co.id', body: 'Cashback s/d 20% untuk transaksi menggunakan ShopeePay hari ini.', date: '2026-08-05' },
    expected: { isTransaction: false },
  },
  {
    name: 'live_gmail_security_login',
    email: { subject: 'Login dari perangkat baru', from: 'security@bankjago.com', body: 'Login dari perangkat baru terdeteksi. Jika bukan Anda, segera hubungi kami.', date: '2026-08-05' },
    expected: { isTransaction: false },
  },
  {
    name: 'live_gmail_refund_received',
    reason: 'Refund diterima = transaksi nyata; schema prompt mengizinkan transaction_type "refund" (bukan income).',
    email: { subject: 'Dana refund masuk', from: 'no-reply@tokopedia.com', body: 'Dana refund sebesar Rp 200.000 telah kami kirim ke rekening Anda. Terima kasih.', date: '2026-08-05' },
    expected: { isTransaction: true, transactionType: 'refund' },
  },
];

export interface LiveInsightCase {
  name: string;
  input: { transactions: Transaction[]; month: number; year: number };
  health: string;
}

export const LIVE_INSIGHT: LiveInsightCase[] = [
  {
    name: 'live_insight_healthy',
    input: { transactions: [incomeTx('li1-inc', 10000000), expenseTx('li1-e1', 2000000, 1, 'Indomaret'), expenseTx('li1-e2', 2000000, 2, 'Gojek')], month: 8, year: 2026 },
    health: 'sehat',
  },
  {
    name: 'live_insight_critical',
    input: { transactions: [incomeTx('li2-inc', 5000000), expenseTx('li2-e1', 3000000, 1, 'Mall'), expenseTx('li2-e2', 3000000, 2, 'Elektronik')], month: 8, year: 2026 },
    health: 'kritis',
  },
  {
    name: 'live_insight_watch',
    // Catatan: kasus data-kosong sengaja TIDAK dipakai di live — Gemini cenderung
    // non-deterministik pada input kosong (teramati: "sehat 88" vs "stabil 70"
    // antar run). Fallback deterministik offline tetap menguji kasus itu.
    input: { transactions: [incomeTx('li3-inc', 10000000), expenseTx('li3-e1', 4500000, 1, 'Mall'), expenseTx('li3-e2', 4500000, 2, 'Restoran')], month: 8, year: 2026 },
    health: 'waspada',
  },
];

export interface LiveAdvisorCase {
  name: string;
  input: AdvisorInput;
  /** Key wajib pada output JSON advisor (schema prompt). */
  requiredKeys: string[];
}

export const LIVE_ADVISOR: LiveAdvisorCase[] = [
  {
    name: 'live_advisor_high_ratio',
    input: advisorInput({ transactions: [incomeTx('la1-inc', 10000000), expenseTx('la1-e1', 4750000, 1, 'Mall'), expenseTx('la1-e2', 4750000, 2, 'Restoran')] }),
    requiredKeys: ['summary', 'spendingAdvice', 'savingStrategy', 'budgetStrategy', 'emergencyFund', 'subscriptionOptimization', 'actionList'],
  },
  {
    name: 'live_advisor_subscription_heavy',
    input: advisorInput({
      subscriptions: [
        { id: 's1', name: 'Netflix', amount: 1500000, cycle: 'monthly' },
        { id: 's2', name: 'Spotify', amount: 1000000, cycle: 'monthly' },
      ],
      transactions: [incomeTx('la2-inc', 10000000), expenseTx('la2-e1', 3000000, 1, 'Toko')],
    }),
    requiredKeys: ['summary', 'spendingAdvice', 'savingStrategy', 'budgetStrategy', 'emergencyFund', 'subscriptionOptimization', 'actionList'],
  },
  {
    name: 'live_advisor_empty',
    input: advisorInput({ transactions: [] }),
    requiredKeys: ['summary', 'actionList'],
  },
];

// ════════════════════════════════════════════════════════════════════════════
// 8. LIVE OCR RECEIPT — gambar struk digenerate programatik (receiptImage.ts)
//    Ground truth = persis apa yang kita gambar (bukan asumsi model).
// ════════════════════════════════════════════════════════════════════════════
export const LIVE_RECEIPT = [
  buildReceipt('live_receipt_expense_qris', {
    header: 'TOKO MAKMUR',
    items: ['NASI GORENG        RP 35.000', 'ES TEH             RP 15.000'],
    total: 'TOTAL RP 150.000',
    payment: 'QRIS',
    date: '01/08/2026',
  }),
  buildReceipt('live_receipt_expense_cash', {
    header: 'WARUNG BU TINI',
    items: ['BAKSO              RP 25.000'],
    total: 'TOTAL RP 25.000',
    payment: 'TUNAI',
    date: '02/08/2026',
  }),
  buildReceipt('live_receipt_income_transfer', {
    header: 'TRANSFER MASUK',
    items: ['DARI: BUDI           RP 500.000'],
    total: 'JUMLAH RP 500.000',
    payment: 'BANK BNI',
    date: '03/08/2026',
  }),
  buildReceipt('live_receipt_not_transaction', {
    header: 'CONTOH DOKUMEN',
    notTransaction: 'FOTO KTP',
  }),
] as ReturnType<typeof buildReceipt>[];
