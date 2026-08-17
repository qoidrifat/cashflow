import { apiGet, apiPut } from '../config/api';

/**
 * Konfigurasi finansial per-user — daftar akun milik sendiri (transfer
 * internal netral). Lihat server/routes/financialSettingsRoutes.js dan
 * docs/financial/FINANCIAL_CALCULATION_INTEGRITY.md §10.13.
 */
export interface FinancialSettings {
  ownAccounts: string[];
}

/**
 * Ambil daftar akun milik sendiri (GET /api/financial/settings).
 * Gagal → { ownAccounts: [] } (perilaku legacy — semua transfer = expense).
 */
export async function getFinancialSettings(): Promise<FinancialSettings> {
  try {
    const res = await apiGet<{ ownAccounts?: string[] }>('/api/financial/settings');
    return { ownAccounts: Array.isArray(res?.ownAccounts) ? res.ownAccounts : [] };
  } catch {
    return { ownAccounts: [] };
  }
}

/**
 * Simpan daftar akun milik sendiri (PUT /api/financial/settings).
 * Error API dibiarkan menyebar (caller menampilkan toast).
 */
export async function updateFinancialSettings(ownAccounts: string[]): Promise<FinancialSettings> {
  const res = await apiPut<{ ownAccounts?: string[] }>('/api/financial/settings', { ownAccounts });
  return { ownAccounts: Array.isArray(res?.ownAccounts) ? res.ownAccounts : ownAccounts };
}
