/**
 * Unit tests — guard in-flight updateTransaction / deleteTransaction
 * (src/services/transactionService.ts, 2026-08-09).
 *
 * Menutup double-fire klik ganda Edit-Save (dua PUT) / Delete (dua DELETE)
 * dengan pola busy-per-transactionId + promise sharing (sama seperti
 * pendingCreates untuk create). Keputusan desain:
 *  - Busy per transactionId (BUKAN content fingerprint): identity resource
 *    sudah transactionId; fingerprint konten justru membiarkan dua edit BEDA
 *    data pada tx sama berjalan bersamaan (race last-write-wins).
 *  - Caller kedua BERBAGI promise op pertama (satu request, satu settle).
 *  - Update & delete independen (prefix kind di key) — tidak saling menelan.
 *  - Entry dibersihkan setelah settle → retry setelah gagal tetap sah.
 */
import { describe, expect, it, vi, beforeEach } from 'vitest';

const apiPutMock = vi.fn();
const apiDeleteMock = vi.fn();

vi.mock('../../src/config/api', () => ({
  apiGet: vi.fn().mockResolvedValue([]),
  apiPost: vi.fn().mockResolvedValue({ id: 'tx-1' }),
  apiPut: (path: string, body?: unknown) => apiPutMock(path, body),
  apiDelete: (path: string) => apiDeleteMock(path),
  getApiBaseUrl: () => 'http://localhost',
  isSessionExpiryExemptPath: () => false,
  handleUnauthorizedResponse: () => {},
}));

// eslint-disable-next-line import/first
import { updateTransaction, deleteTransaction } from '../../src/services/transactionService';

beforeEach(() => {
  vi.clearAllMocks();
  apiPutMock.mockReset();
  apiDeleteMock.mockReset();
  apiPutMock.mockResolvedValue({ success: true });
  apiDeleteMock.mockResolvedValue({ success: true });
});

const UPDATE_DATA = { merchant: 'Warung Baru', note: 'edit' };

describe('updateTransaction — double-fire guard (klik ganda Edit-Save)', () => {
  it('dua update identik berjalan bersamaan (tx sama) → SATU PUT, keduanya settle', async () => {
    const [a, b] = await Promise.all([
      updateTransaction('u-1', 'tx-1', UPDATE_DATA),
      updateTransaction('u-1', 'tx-1', UPDATE_DATA),
    ]);

    expect(apiPutMock).toHaveBeenCalledTimes(1); // bukan dua PUT
    expect(a).toBeUndefined();
    expect(b).toBeUndefined();
  });

  it('dua update data BEDA pada tx sama yang bersamaan → tetap SATU PUT (busy, bukan fingerprint)', async () => {
    // Kunci keputusan desain: edit berbeda pada tx yang sama TIDAK boleh
    // double-fire — busy-per-tx menggabungkannya ke op pertama.
    const [a, b] = await Promise.all([
      updateTransaction('u-1', 'tx-1', { merchant: 'A' }),
      updateTransaction('u-1', 'tx-1', { merchant: 'B' }),
    ]);

    expect(apiPutMock).toHaveBeenCalledTimes(1);
    expect(a).toBeUndefined();
    expect(b).toBeUndefined();
  });

  it('update tx BERBEDA → dua PUT terpisah (granularity per transaksi)', async () => {
    await Promise.all([
      updateTransaction('u-1', 'tx-1', UPDATE_DATA),
      updateTransaction('u-1', 'tx-2', UPDATE_DATA),
    ]);

    expect(apiPutMock).toHaveBeenCalledTimes(2);
    const paths = apiPutMock.mock.calls.map(([p]) => String(p));
    expect(paths).toContain('/api/transactions/tx-1');
    expect(paths).toContain('/api/transactions/tx-2');
  });

  it('setelah settle, retry (sequential) → PUT dijalankan lagi (map dibersihkan)', async () => {
    await updateTransaction('u-1', 'tx-1', UPDATE_DATA);
    await updateTransaction('u-1', 'tx-1', UPDATE_DATA);

    expect(apiPutMock).toHaveBeenCalledTimes(2);
  });

  it('gagal → fallback localStorage SATU kali; retry setelah settle → PUT baru', async () => {
    const store = new Map<string, string>();
    (globalThis as Record<string, unknown>).localStorage = {
      getItem: (k: string) => store.get(k) ?? null,
      setItem: (k: string, v: string) => { store.set(k, v); },
      removeItem: (k: string) => { store.delete(k); },
    };
    try {
      apiPutMock.mockRejectedValueOnce(new Error('network down'));

      // Dua panggilan bersamaan saat PUT gagal → SATU fallback write.
      await Promise.all([
        updateTransaction('u-1', 'tx-1', UPDATE_DATA),
        updateTransaction('u-1', 'tx-1', UPDATE_DATA),
      ]);
      expect(apiPutMock).toHaveBeenCalledTimes(1);

      // Retry setelah settle → PUT dijalankan lagi.
      await updateTransaction('u-1', 'tx-1', UPDATE_DATA);
      expect(apiPutMock).toHaveBeenCalledTimes(2);
    } finally {
      delete (globalThis as Record<string, unknown>).localStorage;
    }
  });

  it('user berbeda tx sama → dua PUT (map tidak saling menelan antar-user)', async () => {
    await Promise.all([
      updateTransaction('u-1', 'tx-1', UPDATE_DATA),
      updateTransaction('u-2', 'tx-1', UPDATE_DATA),
    ]);

    expect(apiPutMock).toHaveBeenCalledTimes(2);
  });
});

describe('deleteTransaction — double-fire guard (klik ganda Delete)', () => {
  it('dua delete bersamaan (tx sama) → SATU DELETE, keduanya settle', async () => {
    const [a, b] = await Promise.all([
      deleteTransaction('u-1', 'tx-1'),
      deleteTransaction('u-1', 'tx-1'),
    ]);

    expect(apiDeleteMock).toHaveBeenCalledTimes(1); // bukan dua DELETE
    expect(a).toBeUndefined();
    expect(b).toBeUndefined();
  });

  it('delete tx BERBEDA → dua DELETE terpisah', async () => {
    await Promise.all([
      deleteTransaction('u-1', 'tx-1'),
      deleteTransaction('u-1', 'tx-2'),
    ]);

    expect(apiDeleteMock).toHaveBeenCalledTimes(2);
  });

  it('setelah settle, retry → DELETE dijalankan lagi', async () => {
    await deleteTransaction('u-1', 'tx-1');
    await deleteTransaction('u-1', 'tx-1');

    expect(apiDeleteMock).toHaveBeenCalledTimes(2);
  });

  it('gagal → fallback localStorage; retry setelah settle → DELETE baru', async () => {
    const store = new Map<string, string>();
    (globalThis as Record<string, unknown>).localStorage = {
      getItem: (k: string) => store.get(k) ?? null,
      setItem: (k: string, v: string) => { store.set(k, v); },
      removeItem: (k: string) => { store.delete(k); },
    };
    try {
      apiDeleteMock.mockRejectedValueOnce(new Error('network down'));
      await Promise.all([
        deleteTransaction('u-1', 'tx-1'),
        deleteTransaction('u-1', 'tx-1'),
      ]);
      expect(apiDeleteMock).toHaveBeenCalledTimes(1);

      await deleteTransaction('u-1', 'tx-1');
      expect(apiDeleteMock).toHaveBeenCalledTimes(2);
    } finally {
      delete (globalThis as Record<string, unknown>).localStorage;
    }
  });
});

describe('update vs delete — independen (prefix kind)', () => {
  it('update + delete tx sama yang bersamaan → keduanya jalan (2 request, tidak saling menelan)', async () => {
    await Promise.all([
      updateTransaction('u-1', 'tx-1', UPDATE_DATA),
      deleteTransaction('u-1', 'tx-1'),
    ]);

    expect(apiPutMock).toHaveBeenCalledTimes(1);
    expect(apiDeleteMock).toHaveBeenCalledTimes(1);
  });
});
