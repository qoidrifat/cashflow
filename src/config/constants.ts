/**
 * Application-wide constants
 */

export const APP_NAME = 'CashFlow';
export const APP_TAGLINE = 'Kelola uangmu lebih sat-set, rapi, dan pintar.';

// Navigation items
export const NAV_ITEMS = [
  { label: 'Beranda', path: '/dashboard', icon: 'LayoutDashboard', mobile: true },
  { label: 'Transaksi', path: '/transactions', icon: 'ArrowLeftRight', mobile: true },
  { label: 'Budget', path: '/budgets', icon: 'PiggyBank', mobile: true },
  { label: 'Laporan', path: '/reports', icon: 'BarChart3', mobile: true },
  { label: 'Suite', path: '/professional', icon: 'BriefcaseBusiness', mobile: true },
  { label: 'Gmail Sync', path: '/gmail-sync', icon: 'Mail', mobile: true },
  { label: 'Profil', path: '/profile', icon: 'UserCircle', mobile: false },
];

// Expense categories
export const EXPENSE_CATEGORIES = [
  { id: 'makanan-minuman', name: 'Makanan & Minuman', icon: 'UtensilsCrossed', color: '#f59e0b' },
  { id: 'transportasi', name: 'Transportasi', icon: 'Car', color: '#3b82f6' },
  { id: 'belanja', name: 'Belanja', icon: 'ShoppingBag', color: '#ec4899' },
  { id: 'tagihan', name: 'Tagihan', icon: 'Receipt', color: '#ef4444' },
  { id: 'hiburan', name: 'Hiburan', icon: 'Gamepad2', color: '#8b5cf6' },
  { id: 'pendidikan', name: 'Pendidikan', icon: 'BookOpen', color: '#6366f1' },
  { id: 'kesehatan', name: 'Kesehatan', icon: 'HeartPulse', color: '#10b981' },
  { id: 'langganan', name: 'Langganan', icon: 'Repeat', color: '#06b6d4' },
  { id: 'keluarga', name: 'Keluarga', icon: 'Users', color: '#84cc16' },
  { id: 'investasi', name: 'Investasi', icon: 'TrendingUp', color: '#14b8a6' },
  { id: 'lainnya-expense', name: 'Lainnya', icon: 'MoreHorizontal', color: '#6b7280' },
];

// Income categories
export const INCOME_CATEGORIES = [
  { id: 'gaji', name: 'Gaji', icon: 'Briefcase', color: '#10b981' },
  { id: 'freelance', name: 'Freelance', icon: 'Laptop', color: '#6366f1' },
  { id: 'bisnis', name: 'Bisnis', icon: 'Building2', color: '#f59e0b' },
  { id: 'hadiah', name: 'Hadiah', icon: 'Gift', color: '#ec4899' },
  { id: 'cashback', name: 'Cashback', icon: 'Banknote', color: '#06b6d4' },
  { id: 'investasi-income', name: 'Investasi', icon: 'TrendingUp', color: '#14b8a6' },
  { id: 'refund', name: 'Refund', icon: 'Undo2', color: '#8b5cf6' },
  { id: 'lainnya-income', name: 'Lainnya', icon: 'MoreHorizontal', color: '#6b7280' },
];

// Payment methods
export const PAYMENT_METHODS = [
  { id: 'cash', name: 'Cash', icon: 'Banknote' },
  { id: 'transfer-bank', name: 'Transfer Bank', icon: 'Building2' },
  { id: 'qris', name: 'QRIS', icon: 'QrCode' },
  { id: 'e-wallet', name: 'E-Wallet', icon: 'Wallet' },
  { id: 'kartu-debit', name: 'Kartu Debit', icon: 'CreditCard' },
  { id: 'kartu-kredit', name: 'Kartu Kredit', icon: 'CreditCard' },
  { id: 'lainnya-payment', name: 'Lainnya', icon: 'MoreHorizontal' },
];

// Budget status
export const BUDGET_STATUS = {
  SAFE: 'safe',
  WARNING: 'warning',
  OVERBUDGET: 'overbudget',
} as const;

// Transaction types
export const TRANSACTION_TYPES = {
  INCOME: 'income',
  EXPENSE: 'expense',
  TRANSFER: 'transfer',
  REFUND: 'refund',
} as const;

// Transaction sources
export const TRANSACTION_SOURCES = {
  MANUAL: 'manual',
  GMAIL: 'gmail',
} as const;

// Currency
export const CURRENCY = 'IDR';
export const CURRENCY_SYMBOL = 'Rp';

// Date formats
export const DATE_FORMAT = 'dd/MM/yyyy';
export const DISPLAY_DATE_FORMAT = 'dd MMM yyyy';
export const DISPLAY_MONTH_FORMAT = 'MMMM yyyy';

// Storage keys
export const STORAGE_KEYS = {
  THEME: 'cashflow-theme',
  ONBOARDING_DONE: 'cashflow-onboarding-done',
  GMAIL_SYNC_ENABLED: 'cashflow-gmail-sync-enabled',
  GMAIL_AUTO_CONFIRM: 'cashflow-gmail-auto-confirm',
  DEFAULT_CURRENCY: 'cashflow-default-currency',
} as const;

// Supabase tables
export const SUPABASE_TABLES = {
  PROFILES: 'profiles',
  TRANSACTIONS: 'transactions',
  CATEGORIES: 'categories',
  BUDGETS: 'budgets',
  GMAIL_SYNC_LOGS: 'gmail_sync_logs',
  NOTIFICATIONS: 'notifications',
} as const;

// Error messages
export const ERROR_MESSAGES = {
  SUPABASE_CONFIG: 'Supabase belum dikonfigurasi. Isi VITE_SUPABASE_URL dan VITE_SUPABASE_ANON_KEY.',
  NOT_LOGGED_IN: 'Anda belum login. Silakan login terlebih dahulu.',
  GMAIL_PERMISSION_DENIED: 'Akses ke Gmail ditolak. Berikan izin untuk melanjutkan.',
  NO_DATA: 'Belum ada data untuk ditampilkan.',
  NETWORK_ERROR: 'Terjadi masalah koneksi. Periksa koneksi internet Anda.',
  GEMINI_API_KEY: 'Gemini API key belum dikonfigurasi di server.',
} as const;

// Gemini prompt for transaction extraction (server uses its own version in server/index.js)
// This copy is kept for reference/backwards compatibility
export const GEMINI_EXTRACTION_PROMPT_KEEP = `Kamu adalah AI financial transaction extractor untuk aplikasi CashFlow Indonesia.

Tugas: Baca email pengguna dan tentukan apakah email berisi transaksi keuangan nyata.
Keluarkan SATU JSON OBJECT VALID SAJA. Tidak ada teks lain.

DEFINISI TRANSAKSI VALID:
- Pembayaran aktual (invoice, receipt, struk, e-ticket)
- Transfer masuk/keluar aktual
- Pembelian berhasil
- Top up berhasil
- Refund/pengembalian dana berhasil
- Cashback yang benar-benar diterima
- QRIS/VA/kartu/e-wallet/bank berhasil
- Informasi transaksi bank yang memuat aktivitas finansial aktual

BUKAN TRANSAKSI (is_transaction = false):
- Promo, diskon, kupon, newsletter
- Iklan, rekomendasi produk, survei
- Login alert, notifikasi keamanan
- Artikel, digest, lowongan kerja
- Cashback promosi yang belum diterima
- Email promo cashback seperti "cashback hingga", "cashback s/d", "cashback sampai", "cashback up to", "dapatkan cashback", "promo cashback", "ajukan KTA", atau "buka deposito, cashback"
- Nominal yang muncul sebagai nilai maksimum promo cashback, bukan uang yang sudah diterima

ATURAN OUTPUT WAJIB:
1. Output hanya SATU JSON OBJECT. Tidak ada markdown, tidak ada code block, tidak ada teks lain.
2. Jangan gunakan tanda | dalam value. Pilih satu value, misalnya "expense" bukan "income | expense".
3. Jangan gunakan trailing comma.
4. Jangan gunakan undefined. Gunakan null jika data tidak ditemukan.
5. Jangan gunakan NaN. Gunakan null.
6. Semua key WAJIB ada.
7. amount: number (tanpa Rp, titik, koma) atau null jika tidak ditemukan.
8. date: format YYYY-MM-DD. Jika tanggal tidak ditemukan, gunakan {{EMAIL_DATE}}.
9. confidence_score: number antara 0.0 dan 1.0.
10. Jika is_transaction = false, reason WAJIB menjelaskan kenapa.
11. Jika email promo cashback, output wajib amount null dan reason "Email promo cashback, bukan transaksi cashback aktual".
12. Cashback aktual boleh transaksi hanya jika email menyatakan cashback berhasil diterima, masuk, cair, atau dikreditkan.

Sender: {{SENDER}}
Subject: {{SUBJECT}}
Email Text:
{{EMAIL_TEXT}}`;
