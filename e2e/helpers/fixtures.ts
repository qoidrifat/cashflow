/**
 * E2E fixtures — SATU-SATUNYA tempat untuk angka dataset yang di-pin (gap 9d).
 *
 * Sebelumnya angka hardcode tersebar di tiap spec (`toBe(284)`, `toBe(519)`,
 * `toBe(86)`, `toBe(131)`), sehingga bila dataset berubah harus diedit di banyak
 * tempat dan rawan tidak konsisten. Sekarang semua angka dataset yang dipin
 * terpusat di file ini.
 *
 * P4.15 (CI-isolated DB): angka kini bisa di-override via env (mis.
 * E2E_PINNED_TRANSACTIONS_TOTAL) agar CI yang memakai DB seed terisolasi
 * (scripts/seedE2eDataset.mjs) tidak bergantung pada angka DB development.
 * Default tetap nilai dataset migrasi (284/86/131/519) — regression guard.
 *
 * UPDATE 2026-08-02 (audit enterprise, build validation): dataset user dev
 * (qoidrifat23@gmail.com) drift secara intentional — scan Gmail & pencatatan
 * berlanjut setelah migrasi: 284 → 541 transaksi (income 86→162, expense
 * 131→244) dan 519 → 611 gmail logs. Angka di bawah disinkronkan ke ground
 * truth aktual per audit (regression guard tetap aktif untuk drift berikutnya).
 *
 * VERIFIKASI 2026-08-04 (Task #33): total gmail logs diverifikasi ulang = 611
 * (COUNT gmail_sync_logs Turso & GET /api/gmail/logs?includeSummary=1 sama-sama
 * 611; summary 308/23/180/0). Nilai 612 yang sempat terlapor QA ternyata log
 * seed 'e2e-review-*' sementara dari spec gmail-review yang belum ter-cleanup
 * pada saat pengukuran — bukan drift dataset permanen. Pin tetap 611.
 *
 * Catatan penting (regression guard):
 *  - Angka-angka ini adalah REGRESSION GUARD: menegaskan bahwa dataset migrasi
 *    tidak berubah secara tidak sengaja (mis. migrasi ulang menghilangkan data,
 *    sync ganda menambah duplikat). Bila dataset berubah SECARA INTENTIONAL
 *    (scan Gmail baru, migrasi baru), update angka di file ini — bukan di spec.
 *  - Validasi utama tiap spec tetap DYNAMIC (membandingkan UI dengan ground
 *    truth API). Pin ini hanya lapisan ekstra untuk mendeteksi drift dataset.
 */
function envNum(key: string, fallback: number): number {
  const v = Number(process.env[key]);
  return Number.isFinite(v) && v >= 0 ? v : fallback;
}

export const PINNED = {
  /** Total transaksi di dataset migrasi (Supabase → Turso) / seed CI. */
  transactionsTotal: envNum('E2E_PINNED_TRANSACTIONS_TOTAL', 541),
  /** Total transaksi tipe income (query API `type=income`). */
  transactionsIncome: envNum('E2E_PINNED_TRANSACTIONS_INCOME', 162),
  /** Total transaksi tipe expense (query API `type=expense`). */
  transactionsExpense: envNum('E2E_PINNED_TRANSACTIONS_EXPENSE', 244),
  /** Total log Gmail Sync di dataset migrasi / seed CI. */
  gmailLogsTotal: envNum('E2E_PINNED_GMAIL_LOGS_TOTAL', 611),
} as const;

/** Ulasan singkat untuk kenyamanan debugging bila assert pin gagal. */
export const PINNED_DESCRIPTION = {
  transactionsTotal: 'dataset migrasi/seed transaksi',
  transactionsIncome: 'transaksi tipe income (query API)',
  transactionsExpense: 'transaksi tipe expense (query API)',
  gmailLogsTotal: 'log Gmail Sync dataset migrasi/seed',
} as const;
