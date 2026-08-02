export const PROMO_CASHBACK_ERROR_CODE = 'PROMO_CASHBACK_SKIPPED';
export const PROMO_CASHBACK_REASON = 'Email promo cashback, bukan transaksi cashback aktual';

export interface PromoCashbackMatch {
  isPromo: boolean;
  isActualCashback: boolean;
  matchedRule?: string;
  detectedPromoAmount?: number | null;
  amountIgnored?: boolean;
}

const ACTUAL_CASHBACK_PATTERNS: Array<[string, RegExp]> = [
  ['cashback_berhasil', /cashback\s+(?:rp\s?[\d.,]+\s*)?berhasil/i],
  ['cashback_telah_diterima', /cashback\s+(?:telah\s+|sudah\s+)?diterima/i],
  ['cashback_masuk', /cashback\s+(?:telah\s+|sudah\s+)?masuk/i],
  ['cashback_dikreditkan', /cashback\s+(?:telah\s+|berhasil\s+)?dikreditkan/i],
  ['cashback_cair', /cashback\s+cair/i],
  ['saldo_cashback_bertambah', /saldo\s+cashback\s+bertambah/i],
  ['menerima_cashback', /(?:kamu|anda)\s+menerima\s+cashback/i],
  ['cashback_masuk_rekening', /cashback\s+telah\s+masuk\s+ke\s+(?:rekening|saldo)/i],
  ['reward_cashback_diterima', /reward\s+cashback\s+(?:telah\s+)?diterima/i],
];

const PROMO_CASHBACK_PATTERNS: Array<[string, RegExp]> = [
  ['cashback_hingga', /cashback\s+(?:hingga|s\.?d\.?|s\/d|sd|sampai|maksimal|max|up\s*to)\s*rp?\s*[\d.,]+/i],
  ['dapatkan_cashback', /(?:dapatkan|dapet|raih|nikmati|klaim|ambil)\s+cashback/i],
  ['promo_cashback', /promo\s+cashback/i],
  ['cashback_marketing', /cashback\s+(?:menanti|buat\s+kamu|spesial|khusus)/i],
  ['ajukan_kta', /ajukan\s+kta/i],
  ['deposito_cashback', /buka\s+deposito.*cashback/i],
  ['hawanya_cashback', /hawanya\s+cocok\s+buat\s+dapet\s+cashback/i],
];

function normalizeText(value: string): string {
  return value
    .toLowerCase()
    .replace(/\bs\s*[./]\s*d\.?\b/g, 's/d')
    .replace(/\bsampai dengan\b/g, 's/d')
    .replace(/\s+/g, ' ')
    .trim();
}

function parseRupiahAmount(value: string): number | null {
  const cleaned = value.replace(/\./g, '').replace(/,/g, '.').trim();
  const amount = Number.parseFloat(cleaned);
  return Number.isFinite(amount) && amount > 0 ? amount : null;
}

export function extractPromoCashbackAmount(subject: string, body = ''): number | null {
  const text = `${subject} ${body}`;
  const match = text.match(/cashback\s+(?:hingga|s\.?d\.?|s\/d|sd|sampai|maksimal|max|up\s*to)\s*rp?\s*([0-9][0-9.,]*)/i)
    || text.match(/(?:dapatkan|dapet|raih|nikmati|klaim|ambil)\s+cashback[^r]{0,80}rp\s?([0-9][0-9.,]*)/i);

  return match?.[1] ? parseRupiahAmount(match[1]) : null;
}

export function isActualCashbackEmail(subject: string, body = ''): boolean {
  const text = normalizeText(`${subject} ${body}`);
  return ACTUAL_CASHBACK_PATTERNS.some(([, pattern]) => pattern.test(text));
}

export function getPromoCashbackMatch(subject: string, body = ''): PromoCashbackMatch {
  const text = normalizeText(`${subject} ${body}`);
  const isActualCashback = isActualCashbackEmail(subject, body);

  if (isActualCashback) {
    return { isPromo: false, isActualCashback };
  }

  const matched = PROMO_CASHBACK_PATTERNS.find(([, pattern]) => pattern.test(text));
  if (!matched) {
    return { isPromo: false, isActualCashback: false };
  }

  return {
    isPromo: true,
    isActualCashback: false,
    matchedRule: matched[0],
    detectedPromoAmount: extractPromoCashbackAmount(subject, body),
    amountIgnored: true,
  };
}

export function isPromoCashbackEmail(subject: string, body = ''): boolean {
  return getPromoCashbackMatch(subject, body).isPromo;
}
