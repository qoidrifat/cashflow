/**
 * E2E fixtures — SATU-SATUNYA tempat untuk angka dataset yang di-pin (gap 9d).
 *
 * Sebelumnya angka hardcode tersebar di tiap spec (`toBe(284)`, `toBe(519)`,
 * `toBe(86)`, `toBe(131)`), sehingga bila dataset berubah harus diedit di banyak
 * tempat dan rawan tidak konsisten. Sekarang semua angka dataset yang dipin
 * terpusat di file ini.
 *
 * Catatan penting (regression guard):
 *  - Angka-angka ini adalah REGRESSION GUARD: menegaskan bahwa dataset migrasi
 *    tidak berubah secara tidak sengaja (mis. migrasi ulang menghilangkan data,
 *    sync ganda menambah duplikat). Bila dataset berubah SECARA INTENTIONAL
 *    (scan Gmail baru, migrasi baru), update angka di file ini — bukan di spec.
 *  - Validasi utama tiap spec tetap DYNAMIC (membandingkan UI dengan ground
 *    truth API). Pin ini hanya lapisan ekstra untuk mendeteksi drift dataset.
 */
export const PINNED = {
  /** Total transaksi di dataset migrasi (Supabase → Turso). */
  transactionsTotal: 284,
  /** Total transaksi tipe income (query API `type=income`). */
  transactionsIncome: 86,
  /** Total transaksi tipe expense (query API `type=expense`). */
  transactionsExpense: 131,
  /** Total log Gmail Sync di dataset migrasi. */
  gmailLogsTotal: 519,
} as const;

/** Ulasan singkat untuk kenyamanan debugging bila assert pin gagal. */
export const PINNED_DESCRIPTION = {
  transactionsTotal: 'dataset migrasi transaksi',
  transactionsIncome: 'transaksi tipe income (query API)',
  transactionsExpense: 'transaksi tipe expense (query API)',
  gmailLogsTotal: 'log Gmail Sync dataset migrasi',
} as const;
