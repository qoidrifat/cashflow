/**
 * Receipt Image Fixture Generator — live vision benchmark (Sprint 1.6+).
 *
 * Menghasilkan gambar struk PNG secara PROGRAMATIK (tanpa dependency biner):
 *   - PNG encoder murni (zlib built-in + CRC32) — RGB, 8-bit, filter 0.
 *   - Font bitmap 5x7 (5 kolom × 7 baris, bit per kolom) untuk teks.
 *   - Layout struk sederhana: header merchant, item, TOTAL, tanggal, metode.
 *
 * Mengapa generate, bukan file biner? deterministik (hash byte identik antar
 * run — tidak ada diff), 0 byte aset di repo, ground-truth diketahui persis
 * (kita yang menggambar). Gemini vision membaca teks bitmap ini dengan baik
 * (font 5x7 diskalakan 3-4×).
 */
import zlib from 'node:zlib';

// ── Font bitmap 5x7 (public-domain classic) — A-Z, 0-9, simbol dasar ──
// Setiap glyph = 7 byte; bit ke-(5 kolom) dari MSB: bit5 di posisi kolom 0.
const FONT: Record<string, number[]> = {
  ' ': [0, 0, 0, 0, 0, 0, 0],
  A: [0x0e, 0x11, 0x11, 0x1f, 0x11, 0x11, 0x11],
  B: [0x1e, 0x11, 0x11, 0x1e, 0x11, 0x11, 0x1e],
  C: [0x0e, 0x11, 0x10, 0x10, 0x10, 0x11, 0x0e],
  D: [0x1e, 0x11, 0x11, 0x11, 0x11, 0x11, 0x1e],
  E: [0x1f, 0x10, 0x10, 0x1e, 0x10, 0x10, 0x1f],
  F: [0x1f, 0x10, 0x10, 0x1e, 0x10, 0x10, 0x10],
  G: [0x0e, 0x11, 0x10, 0x17, 0x11, 0x11, 0x0f],
  H: [0x11, 0x11, 0x11, 0x1f, 0x11, 0x11, 0x11],
  I: [0x0e, 0x04, 0x04, 0x04, 0x04, 0x04, 0x0e],
  J: [0x07, 0x02, 0x02, 0x02, 0x02, 0x12, 0x0c],
  K: [0x11, 0x12, 0x14, 0x18, 0x14, 0x12, 0x11],
  L: [0x10, 0x10, 0x10, 0x10, 0x10, 0x10, 0x1f],
  M: [0x11, 0x1b, 0x15, 0x15, 0x11, 0x11, 0x11],
  N: [0x11, 0x19, 0x15, 0x13, 0x11, 0x11, 0x11],
  O: [0x0e, 0x11, 0x11, 0x11, 0x11, 0x11, 0x0e],
  P: [0x1e, 0x11, 0x11, 0x1e, 0x10, 0x10, 0x10],
  Q: [0x0e, 0x11, 0x11, 0x11, 0x15, 0x12, 0x0d],
  R: [0x1e, 0x11, 0x11, 0x1e, 0x14, 0x12, 0x11],
  S: [0x0f, 0x10, 0x10, 0x0e, 0x01, 0x01, 0x1e],
  T: [0x1f, 0x04, 0x04, 0x04, 0x04, 0x04, 0x04],
  U: [0x11, 0x11, 0x11, 0x11, 0x11, 0x11, 0x0e],
  V: [0x11, 0x11, 0x11, 0x11, 0x11, 0x0a, 0x04],
  W: [0x11, 0x11, 0x11, 0x15, 0x15, 0x1b, 0x11],
  X: [0x11, 0x11, 0x0a, 0x04, 0x0a, 0x11, 0x11],
  Y: [0x11, 0x11, 0x0a, 0x04, 0x04, 0x04, 0x04],
  Z: [0x1f, 0x01, 0x02, 0x04, 0x08, 0x10, 0x1f],
  '0': [0x0e, 0x11, 0x13, 0x15, 0x19, 0x11, 0x0e],
  '1': [0x04, 0x0c, 0x04, 0x04, 0x04, 0x04, 0x0e],
  '2': [0x0e, 0x11, 0x01, 0x02, 0x04, 0x08, 0x1f],
  '3': [0x1e, 0x01, 0x01, 0x0e, 0x01, 0x01, 0x1e],
  '4': [0x02, 0x06, 0x0a, 0x12, 0x1f, 0x02, 0x02],
  '5': [0x1f, 0x10, 0x1e, 0x01, 0x01, 0x01, 0x1e],
  '6': [0x0e, 0x10, 0x10, 0x1e, 0x11, 0x11, 0x0e],
  '7': [0x1f, 0x01, 0x02, 0x04, 0x08, 0x08, 0x08],
  '8': [0x0e, 0x11, 0x11, 0x0e, 0x11, 0x11, 0x0e],
  '9': [0x0e, 0x11, 0x11, 0x0f, 0x01, 0x01, 0x0e],
  '.': [0, 0, 0, 0, 0, 0x06, 0x06],
  ',': [0, 0, 0, 0, 0x06, 0x06, 0x04],
  '/': [0x01, 0x02, 0x02, 0x04, 0x08, 0x08, 0x10],
  ':': [0, 0x06, 0x06, 0, 0x06, 0x06, 0],
  '-': [0, 0, 0, 0x1f, 0, 0, 0],
};

// ── PNG encoder murni (RGB 8-bit, filter 0 per baris) ──
let crcTable: Int32Array | null = null;
function crc32(buf: Buffer): number {
  if (!crcTable) {
    crcTable = new Int32Array(256);
    for (let n = 0; n < 256; n++) {
      let c = n;
      for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
      crcTable[n] = c;
    }
  }
  let crc = -1;
  for (let i = 0; i < buf.length; i++) crc = (crc >>> 8) ^ crcTable[(crc ^ buf[i]) & 0xff];
  return (crc ^ -1) >>> 0;
}

function chunk(type: string, data: Buffer): Buffer {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const typeBuf = Buffer.from(type, 'ascii');
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(Buffer.concat([typeBuf, data])));
  return Buffer.concat([len, typeBuf, data, crc]);
}

/** Encode buffer RGB (width×height×3) menjadi PNG. */
export function encodePng(width: number, height: number, rgb: Buffer): Buffer {
  const sig = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 2; // color type RGB
  const raw = Buffer.alloc(height * (1 + width * 3));
  for (let y = 0; y < height; y++) {
    raw[y * (1 + width * 3)] = 0; // filter: None
    rgb.copy(raw, y * (1 + width * 3) + 1, y * width * 3, (y + 1) * width * 3);
  }
  const idat = zlib.deflateSync(raw, { level: 9 });
  return Buffer.concat([sig, chunk('IHDR', ihdr), chunk('IDAT', idat), chunk('IEND', Buffer.alloc(0))]);
}

// ── Renderer teks bitmap ──
export interface ReceiptCanvas {
  width: number;
  height: number;
  /** buffer RGB width*height*3 (latar putih). */
  data: Buffer;
}

export function createCanvas(width: number, height: number): ReceiptCanvas {
  return { width, height, data: Buffer.alloc(width * height * 3, 255) };
}

function setPixel(c: ReceiptCanvas, x: number, y: number, value: number): void {
  if (x < 0 || y < 0 || x >= c.width || y >= c.height) return;
  const i = (y * c.width + x) * 3;
  c.data[i] = value;
  c.data[i + 1] = value;
  c.data[i + 2] = value;
}

/** Gambar teks (uppercase) mulai (x,y); scale multiplier; mengembalikan x akhir. */
export function drawText(c: ReceiptCanvas, text: string, x: number, y: number, scale = 3, value = 0): number {
  for (const raw of text.toUpperCase()) {
    const ch = FONT[raw] ? raw : ' ';
    const glyph = FONT[ch];
    for (let row = 0; row < 7; row++) {
      const bits = glyph[row];
      for (let col = 0; col < 5; col++) {
        if (bits & (0x10 >> col)) {
          for (let dy = 0; dy < scale; dy++) {
            for (let dx = 0; dx < scale; dx++) {
              setPixel(c, x + col * scale + dx, y + row * scale + dy, value);
            }
          }
        }
      }
    }
    x += (5 + 1) * scale;
  }
  return x;
}

/** Garis horizontal (putus-putus seperti struk). */
export function drawDashedLine(c: ReceiptCanvas, x0: number, x1: number, y: number): void {
  for (let x = x0; x < x1; x += 12) {
    for (let dx = 0; dx < 6 && x + dx < x1; dx++) setPixel(c, x + dx, y, 0);
  }
}

export interface ReceiptFixture {
  /** Nama unik kasus (untuk report). */
  name: string;
  /** MIME type gambar. */
  mimeType: string;
  /** Data base64 untuk inlineData Gemini vision. */
  data: string;
  /** Ground truth (apa yang kita gambar). */
  expected: {
    isTransaction: boolean;
    transactionType?: 'expense' | 'income';
    amount?: number;
    paymentMethod?: string;
    date?: string;
  };
}

/**
 * Bangun gambar struk + ground truth.
 * `lines`: array baris teks (center-aligned via width). `total`/`payment`/
 * `date` opsional — bila ada, digambar lebih tebal untuk membantu OCR.
 */
export function buildReceipt(
  name: string,
  opts: {
    header: string;
    items?: string[];
    total?: string;
    payment?: string;
    date?: string;
    notTransaction?: string;
    /**
     * Tipe transaksi eksplisit. Bila diisi, MENGALAHKAN heuristic header.
     * Heuristic (tanpa opsi ini): header yang diawali 'TRANSFER' dianggap income
     * — AMAN hanya untuk fixture saat ini; struk 'TRANSFER KELUAR' (expense)
     * WAJIB memakai opsi ini agar ground-truth tidak salah label.
     */
    transactionType?: 'expense' | 'income';
  },
): ReceiptFixture {
  const W = 560;
  const H = 760;
  const c = createCanvas(W, H);
  let y = 60;
  const scale = 4;

  // Header (tengah).
  const header = opts.header.toUpperCase();
  const headerWidth = header.length * (6 * scale);
  drawText(c, header, Math.max(20, (W - headerWidth) / 2), y, scale);
  y += 16 * scale;

  drawDashedLine(c, 40, W - 40, y);
  y += 12 * scale;

  if (opts.notTransaction) {
    // Bukan transaksi: teks besar di tengah (mis. "FOTO KTP").
    const t = opts.notTransaction.toUpperCase();
    const tw = t.length * (6 * scale);
    drawText(c, t, Math.max(20, (W - tw) / 2), y, scale);
    y += 20 * scale;
    const t2 = 'BUKAN TRANSAKSI';
    const tw2 = t2.length * (6 * scale);
    drawText(c, t2, Math.max(20, (W - tw2) / 2), y, scale);
    y += 20 * scale;
  } else {
    for (const item of opts.items || []) {
      drawText(c, item, 60, y, 3);
      y += 12 * 3;
    }
    drawDashedLine(c, 40, W - 40, y);
    y += 12 * scale;
    if (opts.total) {
      drawText(c, opts.total, 60, y, scale);
      y += 14 * scale;
    }
  }

  if (opts.date) {
    drawText(c, `TANGGAL: ${opts.date.toUpperCase()}`, 60, y, 3);
    y += 12 * 3;
  }
  if (opts.payment) {
    drawText(c, `METODE: ${opts.payment.toUpperCase()}`, 60, y, 3);
    y += 12 * 3;
  }

  const png = encodePng(W, H, c.data);
  return {
    name,
    mimeType: 'image/png',
    data: png.toString('base64'),
    expected: {
      isTransaction: !opts.notTransaction,
      transactionType: opts.notTransaction
        ? undefined
        : opts.transactionType ?? (opts.header.startsWith('TRANSFER') ? 'income' : 'expense'),
      amount: opts.total ? parseAmount(opts.total) : undefined,
      paymentMethod: opts.payment ? normalizePayment(opts.payment) : undefined,
      date: opts.date ? normalizeDate(opts.date) : undefined,
    },
  };
}

/** Parse "RP 150.000" → 150000. */
function parseAmount(text: string): number | undefined {
  const digits = text.replace(/[^\d]/g, '');
  const n = Number(digits);
  return Number.isFinite(n) && n > 0 ? n : undefined;
}

/** "QRIS" → 'qris'; "TUNAI" → 'cash'; "BANK BNI" → 'transfer-bank'. */
function normalizePayment(text: string): string | undefined {
  const t = text.toUpperCase();
  if (t.includes('QRIS')) return 'qris';
  if (t.includes('TUNAI') || t.includes('CASH')) return 'cash';
  if (t.includes('BANK') || t.includes('TRANSFER')) return 'transfer-bank';
  if (t.includes('KARTU')) return 'kartu-kredit';
  return undefined;
}

/** "01/08/2026" → '2026-08-01'. */
function normalizeDate(text: string): string | undefined {
  const m = text.match(/(\d{2})\/(\d{2})\/(\d{4})/);
  return m ? `${m[3]}-${m[2]}-${m[1]}` : undefined;
}
