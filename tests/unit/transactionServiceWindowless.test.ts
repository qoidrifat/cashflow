/**
 * Unit tests — src/services/transactionService.ts getAllTransactions
 * (migrasi windowless-complete, 2026-08-09) + cache in-memory (2026-08-09).
 *
 * Me-lock kontrak paginasi penuh: loop GET /api/transactions/paginated sampai
 * hasNextPage=false — agregasi selalu atas SELURUH transaksi, BUKAN window
 * `limit=2000` lama (yang diam-diam memotong data user >2000 baris → kelas
 * bug insiden 2026-08-08). Juga me-lock fallback localStorage bila API gagal
 * dan cache in-memory (hit → tanpa request; invalidasi SSE/mutasi/TTL).
 */
import { describe, expect, it, vi, beforeEach } from 'vitest';

const apiGetMock = vi.fn();
const apiPostMock = vi.fn();
const apiPutMock = vi.fn();

/** Kumpulan handler SSE yang didaftarkan oleh invalidator cache (dipicu manual).
 *  Harus vi.hoisted — factory vi.mock dieksekusi saat import (sebelum const
 *  di bawah), referensi luar di sana → TDZ tanpa ini. */
const { sseHandlers } = vi.hoisted(() => ({
  sseHandlers: [] as Array<{ event: string; handler: (data?: unknown) => void }>,
}));

vi.mock('../../src/lib/sse', () => ({
  onSSE: (event: string, handler: (data?: unknown) => void) => {
    sseHandlers.push({ event, handler });
    return () => {};
  },
}));

vi.mock('../../src/config/api', () => ({
  apiGet: (path: string) => apiGetMock(path),
  apiPost: (path: string, body: unknown, headers?: Record<string, string>) => apiPostMock(path, body, headers),
  apiPut: (path: string, body: unknown) => apiPutMock(path, body),
  apiDelete: vi.fn(),
  getApiBaseUrl: () => 'http://localhost',
  isSessionExpiryExemptPath: () => false,
  handleUnauthorizedResponse: () => {},
}));

/** Ekstrak header Idempotency-Key dari call apiPost ke-n. */
function idempotencyKeyOf(n: number): string | undefined {
  const call = apiPostMock.mock.calls[n];
  return call?.[2] ? (call[2] as Record<string, string>)['Idempotency-Key'] : undefined;
}

// eslint-disable-next-line import/first
import {
  addTransaction,
  calculateBalance,
  DuplicateTransactionError,
  getAllTransactions,
  getTransaction,
  getTransactionsByDateRange,
  invalidateAllTransactionsCache,
  updateTransaction,
} from '../../src/services/transactionService';
// eslint-disable-next-line import/first
import type { TransactionFormData } from '../../src/types';

function rows(start: number, count: number): Array<Record<string, unknown>> {
  return Array.from({ length: count }, (_, i) => ({
    id: `t-${start + i}`,
    type: 'expense',
    amount: 1000,
    category_id: 'cat-1',
    category_name: 'Makanan',
  }));
}

function pageNumber(path: string): number {
  const m = path.match(/[?&]page=(\d+)/);
  return m ? Number(m[1]) : 1;
}

beforeEach(() => {
  apiGetMock.mockReset();
  apiPostMock.mockReset();
  apiPutMock.mockReset();
  // Cache in-memory getAllTransactions harus bersih antar test (kalau tidak,
  // kasus yang memakai userId sama saling mencemari hit/miss).
  invalidateAllTransactionsCache();
  // CATATAN: sseHandlers TIDAK di-reset — invalidator SSE terdaftar SEKALI per
  // modul (guard sseInvalidatorsRegistered) pada panggilan getAllTransactions
  // pertama di file ini; menghapus daftarnya akan memutus test SSE berikutnya.
});

describe('calculateBalance — paritas semantik transfer internal = netral (own_accounts §10.13)', () => {
  const tx = (over: Partial<import('../../src/types').Transaction>) =>
    ({
      id: 't',
      userId: 'u-1',
      type: 'expense',
      amount: 0,
      categoryId: 'c',
      categoryName: 'Kategori',
      merchant: '',
      paymentMethod: 'cash',
      note: '',
      date: '2026-08-01',
      source: 'manual',
      gmailMessageId: null,
      createdAt: new Date(),
      updatedAt: new Date(),
      ...over,
    }) as import('../../src/types').Transaction;

  it('default (ownAccounts kosong) = LEGACY: semua transfer = expense (perilaku lama)', () => {
    const r = calculateBalance([
      tx({ type: 'income', amount: 100000 }),
      tx({ type: 'expense', amount: 25000 }),
      tx({ type: 'transfer', amount: 10000, merchant: 'LINE Bank' }),
    ]);
    expect(r.totalIncome).toBe(100000);
    expect(r.totalExpense).toBe(35000); // expense + transfer
    expect(r.balance).toBe(65000);
  });

  it('transfer ke akun milik sendiri TIDAK masuk expense (paritas server SQL NOT IN)', () => {
    const r = calculateBalance(
      [
        tx({ type: 'income', amount: 100000 }),
        tx({ type: 'expense', amount: 25000 }),
        tx({ type: 'transfer', amount: 10000, merchant: 'LINE Bank' }),
        tx({ type: 'transfer', amount: 5000, merchant: 'blu' }),
      ],
      ['LINE Bank', 'blu'],
    );
    expect(r.totalExpense).toBe(25000); // transfer internal netral
    expect(r.balance).toBe(75000);
  });

  it('transfer ke pihak LAIN tetap expense walau ada ownAccounts (Skr A)', () => {
    const r = calculateBalance(
      [
        tx({ type: 'income', amount: 100000 }),
        tx({ type: 'transfer', amount: 10000, merchant: 'LINE Bank' }),
        tx({ type: 'transfer', amount: 5000, merchant: 'M. Zuhri Alfiandi' }),
      ],
      ['LINE Bank'],
    );
    expect(r.totalExpense).toBe(5000); // hanya transfer pihak lain
    expect(r.balance).toBe(95000);
  });

  it('refund = income, tidak berubah oleh ownAccounts', () => {
    const r = calculateBalance(
      [tx({ type: 'refund', amount: 4200 })],
      ['LINE Bank'],
    );
    expect(r.totalIncome).toBe(4200);
    expect(r.totalExpense).toBe(0);
    expect(r.balance).toBe(4200);
  });

  it('matching merchant EXACT (case-sensitive) — paritas dengan SQL NOT IN', () => {
    // Server SQL `merchant NOT IN (...)` juga case-sensitive → "line bank"
    // (lowercase) BUKAN "LINE Bank" → transfer TETAP expense. Client harus
    // identik (Set.has tanpa normalisasi) agar angka server == client.
    const r = calculateBalance(
      [tx({ type: 'transfer', amount: 10000, merchant: 'line bank' })],
      ['LINE Bank'],
    );
    expect(r.totalExpense).toBe(10000); // tidak netral (beda case)
  });

  it('Skr B: income pasangan transfer internal (same day+amount+merchant) dinetralkan dari income', () => {
    const r = calculateBalance(
      [
        tx({ id: 'inc-1', type: 'income', amount: 100000, merchant: 'LINE Bank' }),
        tx({ id: 'tr-1', type: 'transfer', amount: 100000, merchant: 'LINE Bank' }),
        tx({ id: 'inc-2', type: 'income', amount: 50000, merchant: 'blu' }),
      ],
      ['LINE Bank', 'blu'],
    );
    expect(r.totalIncome).toBe(50000); // inc-1 dinetralkan (pasangan tr-1)
    expect(r.totalExpense).toBe(0); // transfer internal netral
    expect(r.balance).toBe(50000);
  });

  it('Skr B: merchant BERBEDA → income TIDAK dinetralkan (paritas rule sama-merchant server)', () => {
    const r = calculateBalance(
      [
        tx({ id: 'inc-1', type: 'income', amount: 100000, merchant: 'blu' }),
        tx({ id: 'tr-1', type: 'transfer', amount: 100000, merchant: 'LINE Bank' }),
      ],
      ['LINE Bank', 'blu'],
    );
    expect(r.totalIncome).toBe(100000); // tidak ada pasangan same-merchant
    expect(r.totalExpense).toBe(0);
    expect(r.balance).toBe(100000);
  });

  it('Skr B: bucket tidak seimbang → min-pair (1 transfer, 2 income → 1 dinetralkan, tie-break id ASC)', () => {
    const r = calculateBalance(
      [
        tx({ id: 'tr-1', type: 'transfer', amount: 200000, merchant: 'LINE Bank' }),
        tx({ id: 'inc-a', type: 'income', amount: 200000, merchant: 'LINE Bank' }),
        tx({ id: 'inc-b', type: 'income', amount: 200000, merchant: 'LINE Bank' }),
      ],
      ['LINE Bank'],
    );
    expect(r.totalIncome).toBe(200000); // inc-a dinetralkan (id ASC), inc-b tetap
    expect(r.balance).toBe(200000);
  });

  it('Skr B: ownAccounts kosong → income pasangan TIDAK dinetralkan (legacy)', () => {
    const r = calculateBalance([
      tx({ id: 'inc-1', type: 'income', amount: 100000, merchant: 'LINE Bank' }),
      tx({ id: 'tr-1', type: 'transfer', amount: 100000, merchant: 'LINE Bank' }),
    ]);
    expect(r.totalIncome).toBe(100000);
    expect(r.totalExpense).toBe(100000); // legacy: transfer = expense
    expect(r.balance).toBe(0);
  });

  it('Skr B: refund TIDAK pernah dipasangkan (hanya type=income)', () => {
    const r = calculateBalance(
      [
        tx({ id: 'rf-1', type: 'refund', amount: 100000, merchant: 'LINE Bank' }),
        tx({ id: 'tr-1', type: 'transfer', amount: 100000, merchant: 'LINE Bank' }),
      ],
      ['LINE Bank'],
    );
    expect(r.totalIncome).toBe(100000); // refund tetap income
    expect(r.totalExpense).toBe(0);
    expect(r.balance).toBe(100000);
  });
});

describe('getAllTransactions (windowless-complete)', () => {
  it('mem-merge seluruh halaman sampai hasNextPage=false (250 baris = 3 halaman)', async () => {
    apiGetMock.mockImplementation((path: string) => {
      const page = pageNumber(path);
      const pages: Record<number, { data: unknown[]; total: number; hasNextPage: boolean }> = {
        1: { data: rows(0, 100), total: 250, hasNextPage: true },
        2: { data: rows(100, 100), total: 250, hasNextPage: true },
        3: { data: rows(200, 50), total: 250, hasNextPage: false },
      };
      return Promise.resolve(pages[page] || { data: [], total: 250, hasNextPage: false });
    });

    const all = await getAllTransactions('u-1');

    expect(all).toHaveLength(250);
    // Kontrak: pageSize 100 berurutan — BUKAN `limit=2000` (window lama).
    expect(apiGetMock).toHaveBeenCalledTimes(3);
    for (const [page, url] of apiGetMock.mock.calls.entries()) {
      expect(String(url)).toContain(`page=${page + 1}`);
      expect(String(url)).toContain('pageSize=100');
      expect(String(url)).not.toContain('limit=');
    }
    // Urutan halaman dipertahankan (global date DESC dari server).
    expect(all[0].id).toBe('t-0');
    expect(all[249].id).toBe('t-249');
  });

  it('satu halaman saja (hasNextPage=false langsung) — 1 panggilan', async () => {
    apiGetMock.mockResolvedValue({
      data: rows(0, 3),
      total: 3,
      totalPages: 1,
      hasNextPage: false,
    });

    const all = await getAllTransactions('u-1');
    expect(all).toHaveLength(3);
    expect(apiGetMock).toHaveBeenCalledTimes(1);
  });

  it('dataset kosong → [] tanpa loop tak berujung', async () => {
    apiGetMock.mockResolvedValue({
      data: [],
      total: 0,
      totalPages: 1,
      hasNextPage: false,
    });

    const all = await getAllTransactions('u-1');
    expect(all).toHaveLength(0);
    expect(apiGetMock).toHaveBeenCalledTimes(1);
  });

  it('API gagal total → fallback localStorage (kontrak lama dipertahankan)', async () => {
    apiGetMock.mockRejectedValue(new Error('network down'));

    const all = await getAllTransactions('u-1');
    // Node env tanpa localStorage → readLocalTransactions mengembalikan [].
    expect(all).toEqual([]);
  });
});

describe('getAllTransactions cache in-memory + invalidasi (2026-08-09)', () => {
  function mockThreePages() {
    apiGetMock.mockImplementation((path: string) => {
      const page = pageNumber(path);
      const pages: Record<number, { data: unknown[]; total: number; hasNextPage: boolean }> = {
        1: { data: rows(0, 100), total: 250, hasNextPage: true },
        2: { data: rows(100, 100), total: 250, hasNextPage: true },
        3: { data: rows(200, 50), total: 250, hasNextPage: false },
      };
      return Promise.resolve(pages[page] || { data: [], total: 250, hasNextPage: false });
    });
  }

  it('panggilan kedua dalam TTL → hit cache (TANPA request baru) — nav antar halaman', async () => {
    mockThreePages();

    const first = await getAllTransactions('u-cache');
    expect(apiGetMock).toHaveBeenCalledTimes(3);

    const second = await getAllTransactions('u-cache');
    expect(apiGetMock).toHaveBeenCalledTimes(3); // tidak refetch
    expect(second).toHaveLength(250);
    expect(second[0].id).toBe('t-0');
    expect(second).toEqual(first);
  });

  it('hasil cache disalin (slice) — mutasi array oleh caller tidak mencemari cache', async () => {
    mockThreePages();
    const first = await getAllTransactions('u-cache');

    first.sort(() => -1); // mutasi sembarang oleh caller
    const second = await getAllTransactions('u-cache');
    expect(second[0].id).toBe('t-0'); // urutan asli server dipertahankan
  });

  it('user berbeda → cache terpisah (tidak saling menelan)', async () => {
    mockThreePages();
    await getAllTransactions('u-a');
    expect(apiGetMock).toHaveBeenCalledTimes(3);

    await getAllTransactions('u-b');
    expect(apiGetMock).toHaveBeenCalledTimes(6); // miss → refetch penuh
  });

  it('invalidasi SSE transaction:created dengan payload userId → refetch penuh berikutnya', async () => {
    mockThreePages();
    await getAllTransactions('u-sse');
    expect(apiGetMock).toHaveBeenCalledTimes(3);

    const createdHandler = sseHandlers.find((h) => h.event === 'transaction:created');
    expect(createdHandler).toBeDefined();
    // Kontrak H-4 (audit 2026-09-04): invalidator HANYA menyapu cache user
    // yang di-payload event — bukan seluruh cache (cross-user data leak).
    createdHandler!.handler({ userId: 'u-sse' });

    await getAllTransactions('u-sse');
    expect(apiGetMock).toHaveBeenCalledTimes(6); // cache dibersihkan → refetch
  });

  it('invalidasi SSE tanpa userId TIDAK menyapu cache user lain (privacy)', async () => {
    mockThreePages();
    await getAllTransactions('u-private');
    const before = apiGetMock.mock.calls.length;

    const createdHandler = sseHandlers.find((h) => h.event === 'transaction:created');
    createdHandler!.handler({}); // payload tanpa userId (event lama/abnormal)

    await getAllTransactions('u-private');
    expect(apiGetMock.mock.calls.length).toBe(before); // cache TETAP terpakai
  });

  it('invalidasi SSE transaction:updated & transaction:deleted juga terdaftar', async () => {
    mockThreePages();
    const events = sseHandlers.map((h) => h.event);
    expect(events).toContain('transaction:updated');
    expect(events).toContain('transaction:deleted');

    await getAllTransactions('u-sse2');
    const before = apiGetMock.mock.calls.length;
    sseHandlers.find((h) => h.event === 'transaction:deleted')!.handler({ userId: 'u-sse2' });
    await getAllTransactions('u-sse2');
    expect(apiGetMock.mock.calls.length).toBe(before + 3);
  });

  it('invalidateAllTransactionsCache(userId) eksplisit → refetch berikutnya', async () => {
    mockThreePages();
    await getAllTransactions('u-exp');
    expect(apiGetMock).toHaveBeenCalledTimes(3);

    invalidateAllTransactionsCache('u-exp');
    await getAllTransactions('u-exp');
    expect(apiGetMock).toHaveBeenCalledTimes(6);
  });

  it('TTL kedaluwarsa → refetch (data basi tidak disajikan > TTL)', async () => {
    mockThreePages();
    await getAllTransactions('u-ttl');
    expect(apiGetMock).toHaveBeenCalledTimes(3);

    // Majukan waktu melewati TTL 60s — Date.now() harus bisa di-stub.
    const nowSpy = vi.spyOn(Date, 'now').mockReturnValue(Date.now() + 61_000);
    try {
      await getAllTransactions('u-ttl');
      expect(apiGetMock).toHaveBeenCalledTimes(6);
    } finally {
      nowSpy.mockRestore();
    }
  });

  it('in-flight dedup: dua caller bersamaan → SATU loop paginasi', async () => {
    mockThreePages();
    const [a, b] = await Promise.all([
      getAllTransactions('u-par'),
      getAllTransactions('u-par'),
    ]);
    expect(apiGetMock).toHaveBeenCalledTimes(3); // bukan 6
    expect(a).toHaveLength(250);
    expect(b).toHaveLength(250);
  });

  it('kegagalan TIDAK di-cache — refetch berikutnya mencoba API lagi', async () => {
    apiGetMock.mockRejectedValueOnce(new Error('network down'));
    await getAllTransactions('u-fail');
    expect(apiGetMock).toHaveBeenCalledTimes(1);

    // API pulih → panggilan berikutnya fetch penuh (cache kosong karena gagal).
    mockThreePages();
    const all = await getAllTransactions('u-fail');
    expect(apiGetMock).toHaveBeenCalledTimes(4);
    expect(all).toHaveLength(250);
  });

  it('mutasi (updateTransaction) meng-invalidate cache user tsb — tanpa SSE pun konsisten', async () => {
    mockThreePages();
    await getAllTransactions('u-mut');
    expect(apiGetMock).toHaveBeenCalledTimes(3);

    apiPutMock.mockResolvedValue({ success: true });
    await updateTransaction('u-mut', 't-0', { merchant: 'Ubah' });

    const all = await getAllTransactions('u-mut');
    expect(apiGetMock).toHaveBeenCalledTimes(6); // cache dibersihkan → refetch
    expect(all).toHaveLength(250);
  });

  it('RACE: invalidasi saat fetch in-flight → fetch lama TIDAK menulis ulang cache (anti repopulation)', async () => {
    // Halaman 1 ditahan (gate) — fetch masih berjalan saat invalidasi datang.
    let releasePage1!: (v: { data: unknown[]; total: number; hasNextPage: boolean }) => void;
    const page1Gate = new Promise<{ data: unknown[]; total: number; hasNextPage: boolean }>((res) => {
      releasePage1 = res;
    });
    let callNo = 0;
    apiGetMock.mockImplementation((path: string) => {
      callNo += 1;
      if (callNo === 1) return page1Gate;
      // Sisa halaman (jika ada) — tidak dipakai dalam test ini.
      return Promise.resolve({ data: [], total: 250, hasNextPage: false });
    });

    const pending = getAllTransactions('u-race');
    // Invalidasi terjadi SELAGAI fetch pertama masih berjalan.
    invalidateAllTransactionsCache('u-race');

    releasePage1({ data: rows(0, 100), total: 250, hasNextPage: true });
    await pending;

    // Fetch lama selesai TAPI tidak boleh mengisi cache (guard identity).
    // Panggilan berikutnya → refetch penuh (3 halaman), bukan hit basi.
    mockThreePages();
    const before = apiGetMock.mock.calls.length; // 1 (page1 yang ditahan)
    const all = await getAllTransactions('u-race');
    expect(all).toHaveLength(250);
    // +3 halaman refetch — fetch lama (basi) tidak tersaji dari cache.
    expect(apiGetMock.mock.calls.length).toBe(before + 3);
  });
});

const createData: TransactionFormData = {
  type: 'expense',
  amount: 25000,
  categoryId: 'c1',
  categoryName: 'Makanan',
  merchant: 'Warung',
  paymentMethod: 'cash',
  note: '',
  date: '2026-08-09',
};

describe('getTransaction (lookup point windowless — migrasi 2026-08-09)', () => {
  it('query LANGSUNG server ?limit=1&id= → row ter-mapping', async () => {
    apiGetMock.mockResolvedValue([{
      id: 'tx-99',
      type: 'expense',
      amount: 15000,
      category_id: 'c1',
      category_name: 'Makanan',
      merchant: 'Warung',
      date: '2026-08-09',
      created_at: '2026-08-09T00:00:00Z',
      updated_at: '2026-08-09T00:00:00Z',
    }]);

    const tx = await getTransaction('u-1', 'tx-99');

    expect(tx?.id).toBe('tx-99');
    expect(tx?.categoryName).toBe('Makanan'); // ter-mapping (bukan snake_case mentah)
    // Kontrak: query point memakai id + limit=1 — BUKAN window 500.
    const url = String(apiGetMock.mock.calls[0][0]);
    expect(url).toContain('id=tx-99');
    expect(url).toContain('limit=1');
    expect(url).not.toContain('limit=500');
  });

  it('[] dari server (id tidak ada) → null, TANPA fallback lokal', async () => {
    apiGetMock.mockResolvedValue([]);
    // Server menjawab [] = definitif tidak ada → jangan menampilkan cache lokal basi.
    const tx = await getTransaction('u-1', 'tx-ghost');
    expect(tx).toBeNull();
  });

  it('API gagal (network) → fallback localStorage (kontrak offline-first)', async () => {
    const store = new Map<string, string>();
    (globalThis as Record<string, unknown>).localStorage = {
      getItem: (k: string) => store.get(k) ?? null,
      setItem: (k: string, v: string) => { store.set(k, v); },
      removeItem: (k: string) => { store.delete(k); },
    };
    try {
      apiGetMock.mockRejectedValue(new Error('network down'));
      const tx = await getTransaction('u-1', 'tx-local');
      expect(tx).toBeNull(); // tidak ada cache lokal → null
    } finally {
      delete (globalThis as Record<string, unknown>).localStorage;
    }
  });

  it('id di-encode saat query (aman untuk karakter khusus)', async () => {
    apiGetMock.mockResolvedValue([]);
    await getTransaction('u-1', 'tx with spaces/&');
    expect(String(apiGetMock.mock.calls[0][0])).toContain('id=tx%20with%20spaces%2F%26');
  });
});

describe('getTransactionsByDateRange (filter server dateFrom/dateTo — migrasi 2026-08-09)', () => {
  it('mem-merge seluruh halaman sampai hasNextPage=false (150 baris = 2 halaman)', async () => {
    apiGetMock.mockImplementation((path: string) => {
      const page = pageNumber(path);
      const pages: Record<number, { data: unknown[]; total: number; hasNextPage: boolean }> = {
        1: { data: rows(0, 100), total: 150, hasNextPage: true },
        2: { data: rows(100, 50), total: 150, hasNextPage: false },
      };
      return Promise.resolve(pages[page] || { data: [], total: 150, hasNextPage: false });
    });

    const all = await getTransactionsByDateRange('u-1', '2026-01-01', '2026-08-09');

    expect(all).toHaveLength(150);
    // Kontrak: filter dikirim KE SERVER (dateFrom/dateTo), bukan window 1000.
    for (const [page, url] of apiGetMock.mock.calls.entries()) {
      expect(String(url)).toContain('dateFrom=2026-01-01');
      expect(String(url)).toContain('dateTo=2026-08-09');
      expect(String(url)).toContain(`page=${page + 1}`);
      expect(String(url)).toContain('pageSize=100');
      expect(String(url)).not.toContain('limit=');
    }
  });

  it('rentang kosong → []', async () => {
    apiGetMock.mockResolvedValue({ data: [], total: 0, totalPages: 1, hasNextPage: false });
    expect(await getTransactionsByDateRange('u-1', '2026-01-01', '2026-01-02')).toEqual([]);
  });

  it('API gagal → fallback localStorage (filter rentang di cache lokal)', async () => {
    const store = new Map<string, string>();
    (globalThis as Record<string, unknown>).localStorage = {
      getItem: (k: string) => store.get(k) ?? null,
      setItem: (k: string, v: string) => { store.set(k, v); },
      removeItem: (k: string) => { store.delete(k); },
    };
    try {
      apiGetMock.mockRejectedValue(new Error('network down'));
      expect(await getTransactionsByDateRange('u-1', '2026-01-01', '2026-12-31')).toEqual([]);
    } finally {
      delete (globalThis as Record<string, unknown>).localStorage;
    }
  });
});

describe('addTransaction create-once (idempotensi klik ganda / retry serentak)', () => {
  it('dua create identik yang berjalan bersamaan → SATU POST, dua caller dapat id sama', async () => {
    // findDuplicateTransaction (GET /api/transactions?limit=100) → tidak ada duplikat
    apiGetMock.mockResolvedValue([]);
    apiPostMock.mockResolvedValue({ id: 'tx-1' });

    // Klik ganda: kedua panggilan start sebelum ada yang settle.
    const [a, b] = await Promise.all([
      addTransaction('u-1', createData),
      addTransaction('u-1', createData),
    ]);

    expect(apiPostMock).toHaveBeenCalledTimes(1); // create-once: bukan 2 baris
    expect(a).toBe('tx-1');
    expect(b).toBe('tx-1');
  });

  it('gmail approve ganda (messageId sama) → SATU POST', async () => {
    apiGetMock.mockResolvedValue([]);
    apiPostMock.mockResolvedValue({ id: 'tx-g' });

    const [a, b] = await Promise.all([
      addTransaction('u-1', { ...createData, merchant: '' }, 'gmail', 'msg-42', 0.95),
      addTransaction('u-1', { ...createData, merchant: '' }, 'gmail', 'msg-42', 0.95),
    ]);

    expect(apiPostMock).toHaveBeenCalledTimes(1);
    expect(a).toBe('tx-g');
    expect(b).toBe('tx-g');
  });

  it('setelah settle, retry identik menjalankan cek duplikat LAGI (map dibersihkan) → DuplicateTransactionError', async () => {
    // Create pertama sukses (tidak ada duplikat saat itu).
    apiGetMock.mockResolvedValueOnce([]);
    apiPostMock.mockResolvedValueOnce({ id: 'tx-1' });
    await addTransaction('u-1', createData);

    // Retry setelah settle: cek duplikat dijalankan ulang → kini menemukan baris.
    apiGetMock.mockResolvedValueOnce([{
      id: 'tx-1',
      type: 'expense',
      amount: 25000,
      category_id: 'c1',
      category_name: 'Makanan',
      merchant: 'Warung',
      date: '2026-08-09',
      created_at: '2026-08-09T00:00:00Z',
      updated_at: '2026-08-09T00:00:00Z',
    }]);

    await expect(addTransaction('u-1', createData)).rejects.toBeInstanceOf(DuplicateTransactionError);
    expect(apiPostMock).toHaveBeenCalledTimes(1); // tetap satu POST total
  });

  it('create berbeda (merchant berbeda) → dua POST terpisah', async () => {
    apiGetMock.mockResolvedValue([]);
    apiPostMock.mockResolvedValue({ id: 'tx-1' });

    const [a, b] = await Promise.all([
      addTransaction('u-1', createData),
      addTransaction('u-1', { ...createData, merchant: 'Kantin' }),
    ]);

    expect(apiPostMock).toHaveBeenCalledTimes(2);
    expect(a).toBe('tx-1');
    expect(b).toBe('tx-1');
  });

  it('user berbeda dengan data sama → dua POST terpisah (map tidak saling menelan antar-user)', async () => {
    apiGetMock.mockResolvedValue([]);
    apiPostMock.mockResolvedValue({ id: 'tx-1' });

    const [a, b] = await Promise.all([
      addTransaction('u-1', createData),
      addTransaction('u-2', createData),
    ]);

    expect(apiPostMock).toHaveBeenCalledTimes(2);
    expect(a).toBe('tx-1');
    expect(b).toBe('tx-1');
  });

  it('mengirim Idempotency-Key stabil (fingerprint) — retry identik memakai key yang sama → server create-once', async () => {
    apiGetMock.mockResolvedValue([]);
    apiPostMock.mockResolvedValue({ id: 'tx-1' });

    // Sequential: create pertama settle, lalu create identik lagi (cek duplikat
    // mock kosong → lolos). Kedua POST harus membawa key YANG SAMA.
    await addTransaction('u-1', createData);
    await addTransaction('u-1', createData);

    expect(apiPostMock).toHaveBeenCalledTimes(2);
    const k1 = idempotencyKeyOf(0);
    const k2 = idempotencyKeyOf(1);
    expect(k1).toBeDefined();
    expect(k2).toBe(k1); // key sama → server mengembalikan transaksi existing, bukan insert baru
  });

  it('create berbeda (merchant berbeda) → Idempotency-Key berbeda', async () => {
    apiGetMock.mockResolvedValue([]);
    apiPostMock.mockResolvedValue({ id: 'tx-1' });

    await addTransaction('u-1', createData);
    await addTransaction('u-1', { ...createData, merchant: 'Kantin' });

    expect(idempotencyKeyOf(0)).not.toBe(idempotencyKeyOf(1));
  });

  it('gmail approve retry (messageId sama) → Idempotency-Key sama', async () => {
    apiGetMock.mockResolvedValue([]);
    apiPostMock.mockResolvedValue({ id: 'tx-g' });

    await addTransaction('u-1', { ...createData, merchant: '' }, 'gmail', 'msg-42', 0.95);
    await addTransaction('u-1', { ...createData, merchant: '' }, 'gmail', 'msg-42', 0.95);

    expect(apiPostMock).toHaveBeenCalledTimes(2);
    expect(idempotencyKeyOf(0)).toBe(idempotencyKeyOf(1));
    expect(idempotencyKeyOf(0)).toContain('msg-42'); // key gmail berbasis messageId
  });

  it('setelah create GAGAL (API down → fallback lokal), retry menjalankan POST baru (map dibersihkan setelah settle)', async () => {
    // Stub localStorage untuk jalur fallback doAddTransaction (node env).
    const store = new Map<string, string>();
    (globalThis as Record<string, unknown>).localStorage = {
      getItem: (k: string) => store.get(k) ?? null,
      setItem: (k: string, v: string) => { store.set(k, v); },
      removeItem: (k: string) => { store.delete(k); },
    };
    try {
      apiGetMock.mockResolvedValue([]); // cek duplikat: kosong

      // POST pertama gagal → doAddTransaction fallback ke localStorage (1 baris lokal)
      apiPostMock.mockRejectedValueOnce(new Error('network down'));
      const firstId = await addTransaction('u-1', createData);
      expect(firstId).toMatch(/^local-/); // fallback lokal
      expect(apiPostMock).toHaveBeenCalledTimes(1);

      // Retry setelah settle: map sudah dibersihkan → POST dijalankan lagi
      apiPostMock.mockResolvedValueOnce({ id: 'tx-2' });
      const secondId = await addTransaction('u-1', createData);
      expect(apiPostMock).toHaveBeenCalledTimes(2);
      expect(secondId).toBe('tx-2');
    } finally {
      delete (globalThis as Record<string, unknown>).localStorage;
    }
  });
});

describe('addTransaction fallback lokal — dedupe gmail_message_id (2026-08-11, menutup §10.8)', () => {
  const localKey = (userId: string) => `cashflow-local-transactions-${userId}`;

  function stubLocalStorage(store: Map<string, string>) {
    (globalThis as Record<string, unknown>).localStorage = {
      getItem: (k: string) => store.get(k) ?? null,
      setItem: (k: string, v: string) => { store.set(k, v); },
      removeItem: (k: string) => { store.delete(k); },
    };
  }

  function storedRows(store: Map<string, string>, userId: string): Array<Record<string, unknown>> {
    const raw = store.get(localKey(userId));
    return raw ? (JSON.parse(raw) as Array<Record<string, unknown>>) : [];
  }

  /** Baris transaksi lokal berbentuk seperti yang ditulis doAddTransaction (jalur fallback). */
  function localGmailTx(id: string, userId: string, gmailMessageId: string): Record<string, unknown> {
    return {
      id,
      userId,
      type: 'expense',
      amount: 25000,
      categoryId: 'c1',
      categoryName: 'Makanan',
      merchant: 'Warung',
      paymentMethod: 'cash',
      note: '',
      date: '2026-08-09',
      source: 'gmail',
      gmailMessageId,
      confidenceScore: null,
      metadata: {},
      createdAt: '2026-08-09T00:00:00.000Z',
      updatedAt: '2026-08-09T00:00:00.000Z',
    };
  }

  it('pesan sudah ada di store lokal → DuplicateTransactionError SEBELUM POST (normalisasi isAlreadyImportedLocal), TANPA baris kedua', async () => {
    const store = new Map<string, string>();
    store.set(localKey('u-1'), JSON.stringify([localGmailTx('local-1', 'u-1', 'msg-77')]));
    stubLocalStorage(store);
    try {
      // Normalisasi (2026-08-11): findDuplicateTransaction memakai helper yang
      // SAMA dengan cabang fallback (isAlreadyImportedLocal) → pesan yang
      // SUDAH ada di store lokal terdeteksi SEBELUM POST → DuplicateTransactionError
      // (bukan replay) — hasil konsisten untuk kondisi logis yang sama. Ini juga
      // menutup duplikat lintas-lapisan: import ulang saat online dari pesan yang
      // hanya ada di store lokal tidak lagi menghasilkan baris server baru.
      apiGetMock.mockResolvedValue([]); // window cek duplikat server: kosong

      await expect(
        addTransaction('u-1', { ...createData, merchant: '' }, 'gmail', 'msg-77', 0.95),
      ).rejects.toBeInstanceOf(DuplicateTransactionError);
      expect(apiPostMock).not.toHaveBeenCalled(); // tidak ada POST
      const rows = storedRows(store, 'u-1');
      expect(rows).toHaveLength(1); // tidak ada duplikat lokal
      expect(rows[0].gmailMessageId).toBe('msg-77');
    } finally {
      delete (globalThis as Record<string, unknown>).localStorage;
    }
  });

  it('pesan BARU + POST gagal → tetap menulis 1 baris lokal (perilaku fallback normal)', async () => {
    const store = new Map<string, string>();
    stubLocalStorage(store);
    try {
      apiGetMock.mockResolvedValue([]);
      apiPostMock.mockRejectedValueOnce(new Error('network down'));

      const id = await addTransaction('u-1', { ...createData, merchant: '' }, 'gmail', 'msg-new', 0.95);

      expect(id).toMatch(/^local-/);
      const rows = storedRows(store, 'u-1');
      expect(rows).toHaveLength(1);
      expect(rows[0].gmailMessageId).toBe('msg-new');
    } finally {
      delete (globalThis as Record<string, unknown>).localStorage;
    }
  });

  it('user isolation: msg sama di user A TIDAK memblokir import user B (store per-user)', async () => {
    const store = new Map<string, string>();
    store.set(localKey('u-1'), JSON.stringify([localGmailTx('local-1', 'u-1', 'msg-77')]));
    stubLocalStorage(store);
    try {
      apiGetMock.mockResolvedValue([]);
      apiPostMock.mockRejectedValueOnce(new Error('network down'));

      const idB = await addTransaction('u-2', { ...createData, merchant: '' }, 'gmail', 'msg-77', 0.95);

      expect(idB).toMatch(/^local-/); // user B menulis barisnya sendiri
      expect(storedRows(store, 'u-1')).toHaveLength(1); // store user A tidak berubah
      expect(storedRows(store, 'u-2')).toHaveLength(1);
      expect(storedRows(store, 'u-2')[0].gmailMessageId).toBe('msg-77');
    } finally {
      delete (globalThis as Record<string, unknown>).localStorage;
    }
  });

  it('deteksi duplikat lokal (DuplicateTransactionError) TIDAK meng-invalidate cache getAllTransactions (tidak ada mutasi data)', async () => {
    const store = new Map<string, string>();
    store.set(localKey('u-cache-replay'), JSON.stringify([localGmailTx('local-1', 'u-cache-replay', 'msg-r')]));
    stubLocalStorage(store);
    try {
      apiGetMock.mockImplementation((path: string) => {
        if (String(path).includes('paginated')) {
          return Promise.resolve({ data: [], total: 0, totalPages: 1, hasNextPage: false });
        }
        return Promise.resolve([]); // window cek duplikat server: kosong
      });

      await getAllTransactions('u-cache-replay'); // seed cache (1 GET pagination)
      const afterSeed = apiGetMock.mock.calls.length;

      // Normalisasi: pesan sudah di store lokal → DuplicateTransactionError
      // SEBELUM POST — tanpa mutasi data apa pun (cache TIDAK perlu invalidate).
      await expect(
        addTransaction('u-cache-replay', { ...createData, merchant: '' }, 'gmail', 'msg-r', 0.95),
      ).rejects.toBeInstanceOf(DuplicateTransactionError);

      // Cache TIDAK di-invalidate → getAllTransactions berikutnya HIT cache.
      // (bahkan TANPA GET tambahan: isAlreadyImportedLocal short-circuit
      // sebelum window server 100 — deteksi duplikat tidak butuh request).
      const all = await getAllTransactions('u-cache-replay');
      expect(apiGetMock.mock.calls.length).toBe(afterSeed);
      expect(all).toEqual([]);
    } finally {
      delete (globalThis as Record<string, unknown>).localStorage;
    }
  });

  it('non-gmail (manual) TIDAK terpengaruh — fallback tetap menulis baris baru (perilaku lama)', async () => {
    const store = new Map<string, string>();
    // Baris manual identik sudah ada di store lokal; server window kosong (cek
    // klien lolos). Dedupe baru hanya menyasar source gmail + gmailMessageId.
    store.set(
      localKey('u-1'),
      JSON.stringify([{ ...localGmailTx('local-1', 'u-1', 'msg-77'), source: 'manual', gmailMessageId: null }]),
    );
    stubLocalStorage(store);
    try {
      apiGetMock.mockResolvedValue([]);
      apiPostMock.mockRejectedValueOnce(new Error('network down'));

      const id = await addTransaction('u-1', createData); // manual

      expect(id).toMatch(/^local-/);
      expect(storedRows(store, 'u-1')).toHaveLength(2); // perilaku lama dipertahankan
    } finally {
      delete (globalThis as Record<string, unknown>).localStorage;
    }
  });
});

describe('addTransaction — registry gmail_message_id CROSS-TAB (2026-08-11, menutup race §10.9)', () => {
  const localKey = (userId: string) => `cashflow-local-transactions-${userId}`;
  // Registry per-key (revisi 2026-08-11): SATU localStorage key PER KLAIM
  // (`...-<userId>-<msgId>::<nonce>`) — write tab A tidak PERNAH menimpa klaim
  // tab B (key nonce berbeda) → semua tab membaca HIMPUNAN klaim yang SAMA →
  // aturan at-tertua meng-konvergenkan semua tab pada pemenang yang sama,
  // bahkan saat dua tab membaca registry kosong bersamaan.
  const registryPrefix = (userId: string) => `cashflow-gmail-import-registry-${userId}-`;
  const registryClaimKey = (userId: string, gmailMessageId: string, nonce: string) =>
    `${registryPrefix(userId)}${encodeURIComponent(gmailMessageId)}::${nonce}`;

  /** Stub localStorage yang memantulkan Object.keys ke store (per-key registry
   *  meng-iterasi SELURUH key localStorage untuk mengumpulkan klaim — stub
   *  plain `{getItem,setItem,removeItem}` tidak akan melihat klaim yang ditulis
   *  via setItem). Proxy dengan trap ownKeys + getOwnPropertyDescriptor. */
  function stubLocalStorage(store: Map<string, string>) {
    const proxy = new Proxy({} as Record<string, unknown>, {
      get: (_t, prop: string | symbol) => {
        if (typeof prop !== 'string') return undefined;
        if (prop === 'getItem') return (k: string) => store.get(k) ?? null;
        if (prop === 'setItem') return (k: string, v: string) => { store.set(k, v); };
        if (prop === 'removeItem') return (k: string) => { store.delete(k); };
        return store.get(prop) ?? null;
      },
      ownKeys: () => [...store.keys()],
      getOwnPropertyDescriptor: (_t, prop: string | symbol) => {
        if (typeof prop !== 'string' || !store.has(prop)) return undefined;
        return { enumerable: true, configurable: true, value: store.get(prop), writable: true };
      },
    });
    (globalThis as Record<string, unknown>).localStorage = proxy;
  }

  function storedRows(store: Map<string, string>, userId: string): Array<Record<string, unknown>> {
    const raw = store.get(localKey(userId));
    return raw ? (JSON.parse(raw) as Array<Record<string, unknown>>) : [];
  }

  /** Kumpulkan SEMUA klaim untuk user (format per-key) → map msgId → claim[]. */
  function registryOf(store: Map<string, string>, userId: string): Record<string, Array<{ nonce: string; at: number; confirmedTxId?: string }>> {
    const out: Record<string, Array<{ nonce: string; at: number; confirmedTxId?: string }>> = {};
    const prefix = registryPrefix(userId);
    for (const [key, raw] of store) {
      if (!key.startsWith(prefix)) continue;
      const rest = key.slice(prefix.length);
      const sep = rest.indexOf('::');
      if (sep < 0) continue;
      const msgId = decodeURIComponent(rest.slice(0, sep));
      try {
        const claim = JSON.parse(raw) as { nonce: string; at: number; confirmedTxId?: string };
        if (claim && typeof claim.nonce === 'string') (out[msgId] ??= []).push(claim);
      } catch {
        // key korup — abaikan (best-effort, sama dengan implementasi).
      }
    }
    return out;
  }

  function confirmedIdOf(store: Map<string, string>, userId: string, msgId: string): string | undefined {
    return registryOf(store, userId)[msgId]?.find((c) => c.confirmedTxId)?.confirmedTxId;
  }

  it('tab lain SUDAH import (registry confirmedTxId) → DuplicateTransactionError SEBELUM POST (normalisasi), TANPA baris lokal kedua', async () => {
    const store = new Map<string, string>();
    // Tab lain (nonce berbeda dari tab modul ini) sudah meng-import msg-99 via
    // server → registry berisi confirmedTxId server (format per-key).
    store.set(
      registryClaimKey('u-1', 'msg-99', 'tab-lain-nonce'),
      JSON.stringify({ nonce: 'tab-lain-nonce', at: 1, confirmedTxId: 'server-tx-99' }),
    );
    stubLocalStorage(store);
    try {
      apiGetMock.mockResolvedValue([]); // window cek duplikat server: kosong

      // Normalisasi (2026-08-11): findDuplicateTransaction memakai helper yang
      // SAMA (isAlreadyImportedLocal) → klaim tab lain yang SUDAH confirmed
      // terdeteksi SEBELUM POST → DuplicateTransactionError (email ditandai
      // duplikat), bukan replay — hasil konsisten untuk kondisi logis sama.
      await expect(
        addTransaction('u-1', { ...createData, merchant: '' }, 'gmail', 'msg-99', 0.95),
      ).rejects.toBeInstanceOf(DuplicateTransactionError);
      expect(apiPostMock).not.toHaveBeenCalled();
      expect(storedRows(store, 'u-1')).toHaveLength(0); // TIDAK menulis baris lokal kedua
    } finally {
      delete (globalThis as Record<string, unknown>).localStorage;
    }
  });

  it('POST SUKSES → registry mencatat id server (tab lain yang fallback akan replay, bukan menulis duplikat)', async () => {
    const store = new Map<string, string>();
    stubLocalStorage(store);
    try {
      apiGetMock.mockResolvedValue([]);
      apiPostMock.mockResolvedValue({ id: 'server-tx-1' });

      const id = await addTransaction('u-1', { ...createData, merchant: '' }, 'gmail', 'msg-1', 0.95);

      expect(id).toBe('server-tx-1');
      // Registry terisi dengan id server → tab lain yang POST-nya gagal untuk
      // pesan sama akan replay id ini (bukan menulis duplikat lokal).
      expect(confirmedIdOf(store, 'u-1', 'msg-1')).toBe('server-tx-1');
    } finally {
      delete (globalThis as Record<string, unknown>).localStorage;
    }
  });

  it('fallback lokal menulis → registry mencatat id lokal (dedupe lintas-tab untuk import offline sebelumnya)', async () => {
    const store = new Map<string, string>();
    stubLocalStorage(store);
    try {
      apiGetMock.mockResolvedValue([]);
      apiPostMock.mockRejectedValueOnce(new Error('network down'));

      const id = await addTransaction('u-1', { ...createData, merchant: '' }, 'gmail', 'msg-2', 0.95);

      expect(id).toMatch(/^local-/);
      expect(confirmedIdOf(store, 'u-1', 'msg-2')).toBe(id);
    } finally {
      delete (globalThis as Record<string, unknown>).localStorage;
    }
  });

  it('user isolation: registry per-user — msg yang diimport user A TIDAK memblokir user B', async () => {
    const store = new Map<string, string>();
    store.set(
      registryClaimKey('u-1', 'msg-77', 'tab-a'),
      JSON.stringify({ nonce: 'tab-a', at: 1, confirmedTxId: 'server-tx-77' }),
    );
    stubLocalStorage(store);
    try {
      apiGetMock.mockResolvedValue([]);
      apiPostMock.mockRejectedValueOnce(new Error('network down'));

      const idB = await addTransaction('u-2', { ...createData, merchant: '' }, 'gmail', 'msg-77', 0.95);

      expect(idB).toMatch(/^local-/); // user B tetap menulis barisnya sendiri
      expect(storedRows(store, 'u-2')).toHaveLength(1);
      // Registry user A tidak berubah (confirmedTxId tetap dari tab-a).
      expect(confirmedIdOf(store, 'u-1', 'msg-77')).toBe('server-tx-77');
    } finally {
      delete (globalThis as Record<string, unknown>).localStorage;
    }
  });

  it('non-gmail TIDAK menyentuh registry (source manual tanpa gmailMessageId)', async () => {
    const store = new Map<string, string>();
    stubLocalStorage(store);
    try {
      apiGetMock.mockResolvedValue([]);
      apiPostMock.mockRejectedValueOnce(new Error('network down'));

      await addTransaction('u-1', createData); // manual

      const hasRegistryKey = [...store.keys()].some((k) => k.startsWith(registryPrefix('u-1')));
      expect(hasRegistryKey).toBe(false); // registry tidak dibuat
    } finally {
      delete (globalThis as Record<string, unknown>).localStorage;
    }
  });

  it('race claim: klaim tab lain lebih tua & SUDAH confirmed → DuplicateTransactionError, TANPA baris kedua', async () => {
    const store = new Map<string, string>();
    // Tab lain (nonce beda) meng-claim msg-race lebih dulu (at=1 lebih kecil)
    // dan SUDAH meng-confirm id servernya → tab ini KALAH claim dan pesan
    // sudah diimport → terdeteksi normalisasi SEBELUM POST.
    store.set(
      registryClaimKey('u-1', 'msg-race', 'tab-lain-nonce'),
      JSON.stringify({ nonce: 'tab-lain-nonce', at: 1, confirmedTxId: 'server-tx-race' }),
    );
    stubLocalStorage(store);
    try {
      apiGetMock.mockResolvedValue([]);

      // claimGmailMessage: klaim tab lain (at=1) lebih tua → KALAH; lalu
      // findDuplicateTransaction (helper sama isAlreadyImportedLocal) menemukan
      // confirmedTxId tab lain → DuplicateTransactionError (bukan replay).
      await expect(
        addTransaction('u-1', { ...createData, merchant: '' }, 'gmail', 'msg-race', 0.95),
      ).rejects.toBeInstanceOf(DuplicateTransactionError);
      const rows = storedRows(store, 'u-1').filter((r) => r.gmailMessageId === 'msg-race');
      expect(rows).toHaveLength(0); // TIDAK ada duplikat lokal dari tab ini
    } finally {
      delete (globalThis as Record<string, unknown>).localStorage;
    }
  });

  it('klaim tab lain yang KALAH vs klaim tab ini YANG MENANG → baris tunggal ditulis', async () => {
    const store = new Map<string, string>();
    stubLocalStorage(store);
    try {
      apiGetMock.mockResolvedValue([]);
      apiPostMock.mockRejectedValueOnce(new Error('network down'));

      // Tab ini MENANG (registry kosong → klaim sendiri tertua) → fallback
      // menulis SATU baris + confirm id lokal di registry.
      const id = await addTransaction('u-1', { ...createData, merchant: '' }, 'gmail', 'msg-win', 0.95);

      expect(id).toMatch(/^local-/);
      const rows = storedRows(store, 'u-1').filter((r) => r.gmailMessageId === 'msg-win');
      expect(rows).toHaveLength(1); // SATU baris
      expect(confirmedIdOf(store, 'u-1', 'msg-win')).toBe(id);
    } finally {
      delete (globalThis as Record<string, unknown>).localStorage;
    }
  });

  it('tab KALAH menunggu id final: claim tab lain belum confirm saat cek → confirm tiba dalam wait window → REPLAY (tanpa baris kedua)', async () => {
    const store = new Map<string, string>();
    // Tab lain meng-claim msg-wait lebih dulu TAPI belum confirm — POST tab
    // lain masih in-flight saat tab ini masuk fallback (klaim tanpa
    // confirmedTxId → isAlreadyImportedLocal null → tab ini masuk wait-loop).
    store.set(
      registryClaimKey('u-1', 'msg-wait', 'tab-lain-nonce'),
      JSON.stringify({ nonce: 'tab-lain-nonce', at: 1 }),
    );
    stubLocalStorage(store);
    try {
      apiGetMock.mockResolvedValue([]);
      apiPostMock.mockRejectedValueOnce(new Error('network down'));

      const promise = addTransaction('u-1', { ...createData, merchant: '' }, 'gmail', 'msg-wait', 0.95);

      // Simulasi tab pemenang menyelesaikan import-nya: id final tercatat di
      // registry (key per-klaim) 150ms setelah tab ini mulai menunggu (di
      // dalam wait window 800ms) → tab kalah harus menemukannya dan REPLAY.
      const confirmTimer = setTimeout(() => {
        store.set(
          registryClaimKey('u-1', 'msg-wait', 'tab-lain-nonce'),
          JSON.stringify({ nonce: 'tab-lain-nonce', at: 1, confirmedTxId: 'server-tx-wait' }),
        );
      }, 150);

      try {
        const id = await promise;
        expect(id).toBe('server-tx-wait'); // replay id tab pemenang
        const rows = storedRows(store, 'u-1').filter((r) => r.gmailMessageId === 'msg-wait');
        expect(rows).toHaveLength(0); // TIDAK menulis baris lokal kedua
      } finally {
        clearTimeout(confirmTimer);
      }
    } finally {
      delete (globalThis as Record<string, unknown>).localStorage;
    }
  });
});
