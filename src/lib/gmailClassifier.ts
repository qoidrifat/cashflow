/**
 * Gmail Email Classifier
 * 
 * Prefilter logic sebelum email dikirim ke AI extractor.
 * Membedakan email transaksi vs promo/newsletter/non-transaksi.
 */

import {
  getPromoCashbackMatch,
  PROMO_CASHBACK_ERROR_CODE,
  PROMO_CASHBACK_REASON,
} from './promoCashbackClassifier';

// ===================== Types =====================

export type PrefilterDecision = 'send_to_ai' | 'auto_rejected' | 'skipped';

export interface ClassificationResult {
  decision: PrefilterDecision;
  reason: string;
  confidence: 'high' | 'medium' | 'low';
  errorCode?: string;
  skipReason?: string;
  matchedRule?: string;
  detectedPromoAmount?: number | null;
  amountIgnored?: boolean;
}

export const NON_TRANSACTION_SKIPPED_ERROR_CODE = 'NON_TRANSACTION_SKIPPED';
export const BLU_NON_TRANSACTION_REASON = 'Notifikasi aktivasi/pengaturan blu, bukan transaksi aktual';

// ===================== Transaction Keywords =====================

/** Keywords/subjek yang sangat mungkin transaksi — kirim ke AI */
const TRANSACTION_PATTERNS: RegExp[] = [
  /bukti\s*pembayaran/i,
  /bukti\s*pemesanan/i,
  /pembayaran\s*berhasil/i,
  /transaksi\s*berhasil/i,
  /transaksimu.*berhasil/i,
  /informasi\s*transaksi/i,
  /transfer\s*berhasil/i,
  /transaksi\s*masuk/i,
  /transaksi\s*keluar/i,
  /invoice/i,
  /e-?receipt/i,
  /receipt/i,
  /struk/i,
  /e-tiket|etiket/i,
  /tiket\s*(elektronik|pesawat|kereta|bioskop)?/i,
  /order\s*confirmed/i,
  /payment\s*confirmation/i,
  /refund\s*berhasil/i,
  /cashback\s*diterima/i,
  /top\s*up\s*berhasil/i,
  /qris\s*berhasil/i,
  /virtual\s*account/i,
  /tagihan\s*berhasil\s*dibayar/i,
  /pembelian\s*berhasil/i,
  /pesanan\s*(dikonfirmasi|berhasil|diproses)/i,
  /pembayaran\s*diterima/i,
  /dana\s*masuk/i,
  /penarikan\s*berhasil/i,
  /withdrawal\s*success/i,
  /transaction\s*(success|complete|confirmed)/i,
  /purchase\s*(receipt|confirmation)/i,
  /payment\s*(received|success)/i,
  /dikenakan\s*biaya/i,
  /\b(total|nominal)\b/i,
  /\bRp\b/i,
  /\bIDR\b/i,
];

/** Keywords/subjek yang bukan transaksi — auto reject sebelum AI */
const NON_TRANSACTION_PATTERNS: RegExp[] = [
  /promo/i,
  /cashback\s*hingga/i,
  /cashback\s*(s\/d|sampai|up\s*to)/i,
  /kupon/i,
  /voucher/i,
  /diskon/i,
  /penawaran/i,
  /ajukan\s*(kta|kredit|pinjaman)/i,
  /buka\s*deposito.*cashback/i,
  /harga\s*(sedang|kini|sekarang)\s*(lebih\s*)?(murah|mahal)/i,
  /newsletter/i,
  /legal\s*terms/i,
  /login\s*dari\s*perangkat\s*baru/i,
  /security\s*warning/i,
  /rekomendasi/i,
  /survei/i,
  /survey/i,
  /lowongan/i,
  /event\s*marketing/i,
  /buletin/i,
  /iklan/i,
  /rating\s*your\s*stay/i,
  /waspada/i,
  /tautan\s*palsu/i,
  /kartu\s*telah\s*aktif/i,
  /request\s*card\s*berhasil/i,
  /virtual\s*card\s*berhasil/i,
  /pesanan\s*telah\s*dikirim/i,
  /status\s*pesanan\s*dikirim/i,
  /sudahkah\s*kamu\s*menerima\s*pesanan/i,
  /rating|review|ulasan/i,
  /info\s*produk/i,
  /save\s*up\s*to/i,
  /\bdeal\b/i,
  /\bmission\b/i,
  /misi\s*spesial/i,
  /hadiah\s*transaksi\s*pertamamu/i,
  /siap\s*liburan/i,
  /pesan\s*tempat\s*nginep/i,
  /hanya\s*hari\s*ini/i,
  /investasi\s*(rendah\s*risiko|modal\s*kecil)/i,
  /artikel/i,
  /digest/i,
  /share\s*their\s*thoughts/i,
  /new\s*delivery\s*of\s*surveys/i,
  /selamat!?\s*(kamu|anda)\s*(mendapat|memperoleh)/i,
  /cashback\s*s\.?d/i,
  /dapatkan\s*(cashback|diskon|promo)/i,
  /yang\s*ke\s*(sekian|berapakali)/i,
  /special\s*offer/i,
  /you.ve\s*been\s*selected/i,
  /exclusive\s*(deal|offer)/i,
  /limited\s*time/i,
  /flash\s*sale/i,
  /payday\s*sale/i,
  /harbolnas/i,
  /big\s*sale/i,
  /mid\s*mouth\s*sale/i,
  /clearance\s*sale/i,
  /wtsapp/i,
  /whatsapp\s*.*\d+/i,
  /follow\s*(ig|instagram|tiktok)/i,
  /invitasi|undangan/i,
  /pemberitahuan\s*(penting|keamanan)/i,
  /pembaruan\s*kebijakan/i,
  /update\s*(produk|fitur)/i,
  /tips\s*keuangan/i,
  /panduan|tutorial/i,
  /selamat\s*(ulang\s*tahun|hari\s*raya)/i,
  /tahun\s*baru/i,
  /ramadhan|lebaran|natal/i,
];

const BLU_NON_TRANSACTION_PATTERNS: RegExp[] = [
  /card kamu telah aktif/i,
  /bluvirtual card kamu telah aktif/i,
  /request bluvirtual.*berhasil/i,
  /request.*bludebit card.*berhasil/i,
  /bluspending.*berhasil dibuat/i,
  /welcome to blu/i,
  /let'?s make your move/i,
];

// ===================== Trusted Senders =====================

/** Domain/sender yang diketahui mengirim email transaksi */
const TRUSTED_TRANSACTION_DOMAINS: RegExp[] = [
  // Bank Indonesia
  /bca\.co\.id/i,
  /klikbca\.com/i,
  /mandiri\.co\.id/i,
  /livin\.mandiri/i,
  /bni\.co\.id/i,
  /bri\.co\.id/i,
  /brimo/i,
  /bsi\.co\.id/i,
  /cimb\.co\.id/i,
  /cimbniaga\.com/i,
  /permata\.co\.id/i,
  /maybank\.co\.id/i,
  /danamon\.co\.id/i,
  /ocbc\.co\.id/i,
  /uob\.co\.id/i,
  /seabank\.co\.id/i,
  /jago\.com/i,
  /jenius\.com/i,
  /blubybcadigital\.id/i,
  /linebank\.co\.id/i,
  /bank\.+[a-z]/i,

  // E-Wallet & Payment
  /gopay\.co\.id/i,
  /gojek\.com/i,
  /ovo\.id/i,
  /dana\.id/i,
  /linkaja\.co\.id/i,
  /shopeepay\.co\.id/i,
  /flip\.id/i,
  /xendit\.co/i,
  /midtrans\.com/i,
  /doku\.com/i,
  /grab\.com/i,

  // E-Commerce & Marketplace
  /shopee\.co\.id/i,
  /tokopedia\.com/i,
  /lazada\.co\.id/i,
  /blibli\.com/i,
  /bukalapak\.com/i,
  /zalora\.co\.id/i,

  // Travel & Hotel & Transport
  /traveloka\.com/i,
  /tiket\.com/i,
  /agoda\.com/i,
  /booking\.com/i,
  /pegipegi\.com/i,
  /reddoorz\.com/i,
  /airyrooms\.com/i,
  /kai\.id/i,
  /trip\.com/i,

  // Subscription services
  /netflix\.com/i,
  /spotify\.com/i,
  /youtube\.com/i,
  /google\.com/i,
  /apple\.com/i,
  /microsoft\.com/i,
  /adobe\.com/i,
  /canva\.com/i,
];

// ===================== Classification Functions =====================

/**
 * Klasifikasi awal email sebelum dikirim ke AI.
 * Menentukan apakah email layak diproses AI atau harus auto_rejected/skipped.
 */
export function classifyEmail(
  subject: string,
  body: string,
  sender: string
): ClassificationResult {
  const subjectLower = subject.toLowerCase();
  const bodyLower = body.toLowerCase();
  const senderLower = sender.toLowerCase();
  const combined = `${subjectLower} ${bodyLower}`;
  const promoCashback = getPromoCashbackMatch(subject, body);

  if (promoCashback.isPromo) {
    return {
      decision: 'skipped',
      reason: PROMO_CASHBACK_REASON,
      confidence: 'high',
      errorCode: PROMO_CASHBACK_ERROR_CODE,
      skipReason: 'promo_cashback',
      matchedRule: promoCashback.matchedRule,
      detectedPromoAmount: promoCashback.detectedPromoAmount,
      amountIgnored: true,
    };
  }

  const bluSkipRule = getBluNonTransactionRule(subject, body, sender);
  if (bluSkipRule) {
    return {
      decision: 'skipped',
      reason: BLU_NON_TRANSACTION_REASON,
      confidence: 'high',
      errorCode: NON_TRANSACTION_SKIPPED_ERROR_CODE,
      skipReason: 'non_transaction_blu',
      matchedRule: bluSkipRule,
      amountIgnored: false,
    };
  }

  // ===================== PRIORITAS 1: Cek non-transaction patterns =====================
  // Cek subject dulu (lebih kuat sinyalnya)
  for (const pattern of NON_TRANSACTION_PATTERNS) {
    if (pattern.test(subject)) {
      // Exception: jika subject mengandung promo TAPI body mengandung bukti transaksi aktual
      if (hasActualTransactionProof(combined)) {
        return {
          decision: 'send_to_ai',
          reason: 'Subject mengandung promo/kupon tetapi body memiliki bukti transaksi aktual',
          confidence: 'medium',
        };
      }
      return {
        decision: 'auto_rejected',
        reason: `Ditolak otomatis: email mengandung konten non-transaksi (${pattern.source.replace(/[\\^$.*+?()|[\]{}]/g, '').substring(0, 40)})`,
        confidence: 'high',
      };
    }
  }

  // Cek body untuk non-transaction signals
  for (const pattern of NON_TRANSACTION_PATTERNS) {
    if (pattern.test(combined)) {
      // Jika ada bukti transaksi juga, kirim ke AI (ambiguous case)
      if (hasActualTransactionProof(combined)) {
        return {
          decision: 'send_to_ai',
          reason: 'Konten campuran (promo & transaksi), perlu AI untuk verifikasi',
          confidence: 'medium',
        };
      }
      return {
        decision: 'auto_rejected',
        reason: `Ditolak otomatis: email mengandung konten non-transaksi (${pattern.source.replace(/[\\^$.*+?()|[\]{}]/g, '').substring(0, 40)})`,
        confidence: 'high',
      };
    }
  }

  // ===================== PRIORITAS 2: Cek transaction patterns =====================
  for (const pattern of TRANSACTION_PATTERNS) {
    if (pattern.test(subject)) {
      return {
        decision: 'send_to_ai',
        reason: `Subject mengandung pola transaksi: ${pattern.source.replace(/[\\^$.*+?()|[\]{}]/g, '').substring(0, 40)}`,
        confidence: 'high',
      };
    }
  }

  for (const pattern of TRANSACTION_PATTERNS) {
    if (pattern.test(combined)) {
      return {
        decision: 'send_to_ai',
        reason: `Body mengandung pola transaksi: ${pattern.source.replace(/[\\^$.*+?()|[\]{}]/g, '').substring(0, 40)}`,
        confidence: 'medium',
      };
    }
  }

  // ===================== PRIORITAS 3: Cek sender domain terpercaya =====================
  const isTrustedSender = TRUSTED_TRANSACTION_DOMAINS.some((pattern) =>
    pattern.test(senderLower)
  );

  if (isTrustedSender) {
    // Trusted sender: cek apakah ada nominal uang di body
    if (hasMonetaryAmount(combined)) {
      return {
        decision: 'send_to_ai',
        reason: 'Sender terpercaya dengan nominal transaksi',
        confidence: 'medium',
      };
    }

    // Trusted sender tapi tidak ada nominal — masih bisa jadi transaksi (e.g., "Pembayaran Gagal")
    if (hasTransactionContext(combined)) {
      return {
        decision: 'send_to_ai',
        reason: 'Sender terpercaya dengan konteks transaksi',
        confidence: 'medium',
      };
    }

    return {
      decision: 'skipped',
      reason: 'Dilewati: sender terpercaya tetapi tidak ditemukan bukti transaksi atau nominal',
      confidence: 'medium',
    };
  }

  // ===================== PRIORITAS 4: Unknown sender =====================
  // Cek apakah ada nominal uang + konteks transaksi
  if (hasMonetaryAmount(combined) && hasTransactionContext(combined)) {
    return {
      decision: 'send_to_ai',
      reason: 'Ditemukan nominal dan konteks transaksi dari sender tidak dikenal',
      confidence: 'low',
    };
  }

  // Tidak ada bukti transaksi yang cukup
  return {
    decision: 'skipped',
    reason: 'Dilewati: tidak cukup bukti transaksi keuangan',
    confidence: 'low',
  };
}

/**
 * Cek apakah teks mengandung bukti transaksi aktual (nominal + kata kunci transaksi)
 */
function hasActualTransactionProof(text: string): boolean {
  if (getPromoCashbackMatch(text).isPromo) return false;
  return hasMonetaryAmount(text) && hasTransactionContext(text);
}

/**
 * Cek apakah teks mengandung nominal uang (Rp, IDR, angka dengan format Rupiah)
 * Hanya match pola dengan prefiks Rp atau IDR untuk menghindari false positive.
 */
function hasMonetaryAmount(text: string): boolean {
  return /rp\s*[\d.,]+\s*(?:,-)?/i.test(text) ||
    /idr\s*[\d.,]+/i.test(text) ||
    /\b(?:total|amount|nominal|sebesar|senilai)\s*rp\s*[\d.,]+/i.test(text);
}

/**
 * Cek apakah teks mengandung konteks transaksi
 */
function hasTransactionContext(text: string): boolean {
  return /(?:pembayaran|pembelian|transfer|tagihan|transaksi|top\s*up|refund|invoice|receipt|e-?receipt|struk|order|payment|subscription|langganan|belanja|checkout|total|nominal|dikenakan\s*biaya)/i.test(text);
}

/**
 * Ekstrak domain dari alamat email sender
 */
export function extractDomain(sender: string): string {
  const match = sender.match(/@([^\s>]+)/);
  return match ? match[1].toLowerCase() : sender.toLowerCase();
}

/**
 * Cek apakah sender dari domain yang terpercaya untuk transaksi
 */
export function isTrustedTransactionDomain(sender: string): boolean {
  return TRUSTED_TRANSACTION_DOMAINS.some((pattern) => pattern.test(sender));
}

export function isBluNonTransactionEmail(subject: string, body: string, sender: string): boolean {
  return Boolean(getBluNonTransactionRule(subject, body, sender));
}

function getBluNonTransactionRule(subject: string, body: string, sender: string): string | null {
  const senderLower = sender.toLowerCase();
  if (!senderLower.includes('blubybcadigital.id') && !senderLower.includes('blu')) {
    return null;
  }

  const combined = `${subject}\n${body}`;
  const matched = BLU_NON_TRANSACTION_PATTERNS.find((pattern) => pattern.test(combined));
  return matched ? matched.source : null;
}
