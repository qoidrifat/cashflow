/**
 * Unit test P0.13 — canonical semantic verification state + provider catalog
 * source-of-truth contract (single source = backend, no silent production mirror).
 *
 *  - walletVerificationState(wallet): pure deterministic mapper.
 *    Kontrak: registration (caller), balance (unverified|verified|mismatch),
 *    integration (manual), identity (not_implemented), ownership (not_implemented).
 *  - getWalletProviders: backend source of truth; ok:false TIDAK fallback siluman
 *    ke mirror (providers:[] + error) — UI wajib error/retry.
 *  - TEST_ONLY_WALLET_PROVIDERS: fallback eksplisit hanya untuk test/dev, label
 *    jelas agar tidak dikira catalog produksi.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// Mock apiGet agar menguji jalur sukses/gagal/malformed secara deterministik.
const apiGetMock = vi.hoisted(() => vi.fn());
vi.mock('../../src/config/api', () => ({
  apiGet: apiGetMock,
  apiPost: vi.fn(),
  apiPut: vi.fn(),
  apiDelete: vi.fn(),
}));

import {
  walletVerificationState,
  getWalletProviders,
  TEST_ONLY_WALLET_PROVIDERS,
  type WalletProvider,
} from '../../src/services/professionalSuiteService';

describe('walletVerificationState — canonical semantic mapper (P0.13)', () => {
  it('nilai balance deterministic: verified | mismatch | unverified', () => {
    const base = { balanceAnchorStatus: null };
    // null / undefined / kosong → unverified (BUKAN verified).
    expect(walletVerificationState({ ...base, balanceAnchorStatus: null }).balance).toBe('unverified');
    expect(walletVerificationState({ balanceAnchorStatus: undefined } as never).balance).toBe('unverified');
    expect(walletVerificationState(undefined).balance).toBe('unverified');
    // verified → verified (balance anchor SUKSES).
    expect(walletVerificationState({ balanceAnchorStatus: 'verified' }).balance).toBe('verified');
    // mismatch → mismatch (tetap anchor, bukan "unverified").
    expect(walletVerificationState({ balanceAnchorStatus: 'mismatch' }).balance).toBe('mismatch');
  });

  it('SEMANTIC SEPARATION — balance ≠ integration ≠ identity ≠ ownership', () => {
    // Verified balance TIDAK membuat integration/identity/ownership ikut verified.
    const s = walletVerificationState({ balanceAnchorStatus: 'verified' });
    expect(s.balance).toBe('verified');
    expect(s.integration).toBe('manual'); // TIDAK connected/integrated.
    expect(s.identity).toBe('not_implemented'); // TIDAK dipalsukan.
    expect(s.ownership).toBe('not_implemented'); // TIDAK dipalsukan.
  });

  it('integration selalu manual (belum ada integrasi API; bukan fake connected)', () => {
    expect(walletVerificationState({ balanceAnchorStatus: null }).integration).toBe('manual');
    expect(walletVerificationState({ balanceAnchorStatus: 'verified' }).integration).toBe('manual');
    expect(walletVerificationState({ balanceAnchorStatus: 'mismatch' }).integration).toBe('manual');
  });

  it('tidak pernah menghasilkan identity/ownership = verified', () => {
    expect(walletVerificationState({ balanceAnchorStatus: 'verified' }).identity).toBe('not_implemented');
    expect(walletVerificationState({ balanceAnchorStatus: 'verified' }).ownership).toBe('not_implemented');
  });
});

describe('getWalletProviders — source of truth backend, NO silent mirror (P0.13)', () => {
  // CATATAN P0.13 (root-cause vitest 3.2.7): `beforeEach(apiGetMock.mockReset())`
  // + `mockRejectedValue` membuat runner meng-attribusi rejection mock yang
  // SUDAH di-handle (try/catch production + .then tinyspy) sebagai kegagalan
  // test — terbukti via bisection: hapus baris reset → 9/9 PASS; kembalikan →
  // 1 failed. Cleanup antar-test tetap aman via afterEach(vi.clearAllMocks())
  // dan tiap test men-set implementasinya sendiri sebelum memanggil mock.
  afterEach(() => vi.clearAllMocks());

  it('API success → ok:true + katalog backend', async () => {
    apiGetMock.mockResolvedValue([
      { code: 'blu', name: 'blu', type: 'bank', icon: 'blu', enabled: true, integration: 'manual' },
    ]);
    const res = await getWalletProviders();
    expect(res.ok).toBe(true);
    expect(res.providers.length).toBe(1);
    expect(apiGetMock).toHaveBeenCalledWith('/api/wallet-providers');
  });

  it('API 500 / error → ok:false + providers KOSONG (TIDAK fallback siluman)', async () => {
    apiGetMock.mockRejectedValue(new Error('boom'));
    const res = await getWalletProviders();
    expect(res.ok).toBe(false);
    expect(res.providers).toEqual([]);
    expect(res.error).toBe('boom');
    // Tidak ada produk mirror statis pada jalur produksi gagal.
    expect(res.providers).not.toEqual(expect.arrayContaining(TEST_ONLY_WALLET_PROVIDERS));
  });

  it('API mengembalikan list kosong → ok:false + providers []', async () => {
    apiGetMock.mockResolvedValue([]);
    const res = await getWalletProviders();
    expect(res.ok).toBe(false);
    expect(res.providers).toEqual([]);
  });

  it('API malformed/non-array → ok:false + []', async () => {
    apiGetMock.mockResolvedValue({ not: 'an array' } as never);
    const res = await getWalletProviders();
    expect(res.ok).toBe(false);
    expect(res.providers).toEqual([]);
  });
});

describe('TEST_ONLY_WALLET_PROVIDERS — explicit test fallback, not production SSOT', () => {
  it('memuat 5 provider dengan integration manual', () => {
    const list: WalletProvider[] = TEST_ONLY_WALLET_PROVIDERS;
    const codes = list.map((p) => p.code);
    for (const c of ['line_bank', 'blu', 'bank_jago', 'shopeepay', 'dana']) {
      expect(codes).toContain(c);
    }
    for (const p of list) {
      expect(p.integration).toBe('manual');
      expect(p.enabled).toBe(true);
    }
  });
});
