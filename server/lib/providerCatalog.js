/**
 * Provider Catalog (P0.11) — Sumber tunggal daftar institusi keuangan yang
 * didukung app. Server-side registry (bukan tabel eksternal) agar ringan dan
 * anti-duplikasi; di-expose ke frontend via GET /api/wallet-providers.
 *
 * SEMANTIK P0.11 (jangan dicampur aduk):
 *   - Account Registered  ≠  Balance Verified  ≠  Provider Integrated  ≠  Ownership Verified.
 *   - `integration` mengungkapkan KEMAMPUAN integrasi otomatis provider.
 *     Saat ini TIDAK ada integrasi API resmi → semua `manual` (verifikasi
 *     saldo manual via balance anchor, P2.7). BUKAN klaim koneksi palsu.
 *
 * Jangan menyimpan secret/credential apa pun di sini.
 */
export const PROVIDER_CATALOG = [
  { code: 'line_bank',  name: 'LINE Bank',  type: 'bank',    icon: 'line_bank',  enabled: true, integration: 'manual' },
  { code: 'blu',        name: 'blu',        type: 'bank',    icon: 'blu',        enabled: true, integration: 'manual' },
  { code: 'bank_jago',  name: 'Bank Jago',  type: 'bank',    icon: 'bank_jago',  enabled: true, integration: 'manual' },
  { code: 'shopeepay',  name: 'ShopeePay',  type: 'e_wallet', icon: 'shopeepay', enabled: true, integration: 'manual' },
  { code: 'dana',       name: 'DANA',       type: 'e_wallet', icon: 'dana',      enabled: true, integration: 'manual' },
];

/** Kode provider yang dikenal (untuk validasi enum). */
export const PROVIDER_CODES = PROVIDER_CATALOG.map((p) => p.code);

/** Cek apakah kode provider dikenal & aktif. */
export function isProviderEnabled(code) {
  return PROVIDER_CATALOG.some((p) => p.code === code && p.enabled);
}

/** Ambil metadata provider (tanpa field sensitif). */
export function getProvider(code) {
  return PROVIDER_CATALOG.find((p) => p.code === code) || null;
}

/** Kode provider yang dikenal & aktif (untuk validasi enum). */
export function isValidProviderCode(code) {
  return isProviderEnabled(code);
}

/**
 * P0.11 — cocokkan wallet row lama (belum ber-provider_code) ke katalog via
 * institution ATAU name (case/pre-space insensitive), lalu kembalikan
 * provider_code. Murni derived di respons, TANPA mutasi DB.
 */
export function matchProviderByInstitutionOrName(row) {
  const hay = [
    String(row?.institution || ''),
    String(row?.name || ''),
  ].map((s) => s.trim().toLowerCase()).filter(Boolean);
  if (hay.length === 0) return null;
  for (const p of PROVIDER_CATALOG) {
    const keys = [p.name, p.code].map((s) => s.toLowerCase());
    if (hay.some((h) => keys.some((k) => h === k || h.includes(k)))) return p.code;
  }
  return null;
}

/**
 * Salinan aman untuk respons API — selalu hanya field publik, mencegah
 * field internal masa depan ikut bocor secara tidak sengaja.
 */
export function publicProviderList() {
  return PROVIDER_CATALOG.map(({ code, name, type, icon, enabled, integration }) => ({
    code, name, type, icon, enabled, integration,
  }));
}
