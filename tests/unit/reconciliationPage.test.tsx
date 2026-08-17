/**
 * Unit test: src/features/reconciliation/ReconciliationPage.tsx — halaman
 * assisted reconciliation P2.6. Environment `unit-dom` (happy-dom); helper
 * render + cleanup dari setup project (tests/unit/setup.ts).
 *
 * Kontrak yang di-lock:
 *   - Loading → spinner; error → ErrorState dengan retry.
 *   - Status unknown (tanpa akun) → badge "Belum dimulai", progress 0, CTA
 *     ke Pengaturan; TIDAK pernah menampilkan nominal karangan.
 *   - Saran HIGH dengan accountId → tombol "Terima semua (N)"; klik membuka
 *     dialog konfirmasi yang menampilkan dampak nominal sebelum bulk.
 *   - Konfirmasi → classifyBySuggestion dipanggil TEPAT SEKALI dengan
 *     (accountId, confidence); state di-refresh (refetch getReconciliationState).
 *   - Saran tanpa accountId → pesan "Buat rekening ... dulu" (bukan auto-assign).
 *   - Verifikasi saldo: isi actual == system → status verified tampil.
 *   - Pasangan transfer: klik "Pasangkan" → pairTransfer dipanggil.
 *
 * Service di-mock penuh — tanpa fetch nyata (pola aiFeedbackButtons.test.tsx).
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import ReconciliationPage from '../../src/features/reconciliation/ReconciliationPage';
import * as reconService from '../../src/services/reconciliationService';
import * as proSuiteService from '../../src/services/professionalSuiteService';

vi.mock('../../src/services/reconciliationService', () => ({
  getReconciliationState: vi.fn(),
  classifyBySuggestion: vi.fn(),
  classifyTransactionsBulk: vi.fn(),
  rejectBySuggestion: vi.fn(),
  pairTransfer: vi.fn(),
  rejectTransferCandidate: vi.fn(),
  verifyAccountBalance: vi.fn(),
  reassignTransaction: vi.fn(),
}));

vi.mock('../../src/services/professionalSuiteService', () => ({
  saveWalletAccount: vi.fn(),
}));

vi.mock('../../src/store/useAuthStore', () => ({
  useAuthStore: (sel: (s: unknown) => unknown) => sel({ authUser: { uid: 'user-a', displayName: 'User A' } }),
}));

const svc = () => vi.mocked(reconService);
const walletSvc = () => vi.mocked(proSuiteService);

function baseState(over: Partial<Record<string, unknown>> = {}) {
  return {
    status: 'unknown',
    accountCandidates: [],
    accounts: [],
    openingBalancesConfigured: 0,
    transactions: { total: 0, linked: 0, unlinked: 0, unlinkedAmount: 0, pending: 0, confirmed: 0, rejected: 0 },
    transfers: { total: 0, grouped: 0, ungrouped: 0 },
    transferPairSuggestions: [],
    suggestions: [],
    dateCoverage: { earliest: null, latest: null },
    currentBalance: { status: 'unknown', amount: null, message: 'Belum ada rekening', reason: 'no_accounts' },
    balanceConfidence: 'unknown',
    onboardingProgress: { accountsConfigured: false, openingBalancesConfigured: false, transactionsReconciled: false, transfersReconciled: false, realBalanceVerified: false, completedSteps: 0, totalSteps: 5 },
    ...over,
  };
}

function renderPage() {
  return render(
    <MemoryRouter>
      <ReconciliationPage />
    </MemoryRouter>,
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  svc().getReconciliationState.mockResolvedValue(baseState() as never);
  svc().classifyBySuggestion.mockResolvedValue({ applied: 2, skipped: 0 } as never);
  svc().classifyTransactionsBulk.mockResolvedValue({ applied: 2, skipped: 0 } as never);
  svc().rejectBySuggestion.mockResolvedValue({ rejected: 2, skipped: 0 } as never);
  svc().pairTransfer.mockResolvedValue({ ok: true } as never);
  svc().rejectTransferCandidate.mockResolvedValue({ ok: true } as never);
  svc().verifyAccountBalance.mockResolvedValue({ ok: true, status: 'verified', difference: 0 } as never);
  svc().reassignTransaction.mockResolvedValue({ applied: 1, skipped: 0 } as never);
  walletSvc().saveWalletAccount.mockResolvedValue({ id: 'acc-new' } as never);
});

describe('ReconciliationPage — loading / error / empty', () => {
  it('loading → spinner (aria busy) sebelum state dimuat', () => {
    svc().getReconciliationState.mockReturnValue(new Promise(() => {}) as never);
    renderPage();
    // lucide-react v1.21: Loader2 → loader-circle; text sr-only lebih robust.
    expect(screen.getByText('Memuat data rekonsiliasi…')).toBeInTheDocument();
    expect(document.querySelector('.animate-spin')).not.toBeNull();
  });

  it('error → ErrorState dengan tombol Coba Lagi (retry refetch)', async () => {
    svc().getReconciliationState.mockRejectedValueOnce(new Error('db down'));
    renderPage();
    expect(await screen.findByText('Gagal memuat rekonsiliasi')).toBeInTheDocument();
    svc().getReconciliationState.mockResolvedValue(baseState() as never);
    fireEvent.click(screen.getByRole('button', { name: 'Coba Lagi' }));
    await waitFor(() => expect(svc().getReconciliationState).toHaveBeenCalledTimes(2));
  });

  it('tanpa akun → badge "Belum dimulai", progress 0/5, CTA ke Pengaturan, tanpa Rp0', async () => {
    renderPage();
    expect(await screen.findByRole('heading', { name: 'Rekonsiliasi Rekening' })).toBeInTheDocument();
    expect(screen.getByText('Belum dimulai')).toBeInTheDocument();
    // P2.9 §28 — progress kini skor penyelesaian deterministik (tanpa data → 0%).
    expect(screen.getByLabelText('Skor penyelesaian 0 persen')).toHaveTextContent('0%');
    // CTA Settings ada; tanpa akun → bagian rekening kosong (bukan saldo Rp0
    // karangan) dan saldo sistem per akun tidak dirender sama sekali.
    expect(screen.getByRole('link', { name: /Atur rekening/i })).toBeInTheDocument();
    // P2.8: tanpa kandidat → panduan ke Pengaturan (copy baru); tetap tanpa Rp0.
    expect(screen.getByText(/Belum ada kandidat akun terdeteksi/)).toBeInTheDocument();
    expect(screen.queryByText('Belum dapat dihitung')).toBeNull();
  });
});

describe('ReconciliationPage — suggestion + bulk confirm', () => {
  it('saran HIGH dengan accountId → dialog konfirmasi dampak nominal → classifyBySuggestion sekali', async () => {
    const state = baseState({
      status: 'partial',
      balanceConfidence: 'medium',
      accounts: [{ id: 'acc-blu', name: 'blu', type: 'e-wallet', currency: 'IDR', openingBalance: 1000000, openingBalanceDate: '2026-01-01', realBalance: null, realBalanceDate: null, realBalanceVerifiedAt: null, systemBalance: 1000000, verificationStatus: 'not_verified' }],
      transactions: { total: 2, linked: 0, unlinked: 2, unlinkedAmount: 150000, pending: 2, confirmed: 0, rejected: 0 },
      suggestions: [{ accountName: 'blu', accountId: 'acc-blu', confidence: 'high', count: 2, totalAmount: 150000 }],
      onboardingProgress: { accountsConfigured: true, openingBalancesConfigured: true, transactionsReconciled: false, transfersReconciled: true, realBalanceVerified: false, completedSteps: 3, totalSteps: 5 },
    });
    svc().getReconciliationState.mockResolvedValue(state as never);
    renderPage();

    expect(await screen.findByRole('button', { name: /Terima semua \(2\)/ })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /Terima semua \(2\)/ }));

    // Dialog konfirmasi menampilkan dampak finansial (mandate §23).
    const dialog = await screen.findByRole('dialog');
    expect(dialog).toHaveTextContent('Klasifikasikan 2 transaksi ke "blu"?');
    expect(dialog).toHaveTextContent('Rp150.000');
    fireEvent.click(screen.getByRole('button', { name: 'Konfirmasi' }));

    await waitFor(() => expect(svc().classifyBySuggestion).toHaveBeenCalledTimes(1));
    expect(svc().classifyBySuggestion).toHaveBeenCalledWith('acc-blu', 'high');
    // State di-refresh setelah mutasi.
    await waitFor(() => expect(svc().getReconciliationState.mock.calls.length).toBeGreaterThanOrEqual(2));
  });

  it('saran tanpa accountId → instruksi buat rekening, BUKAN tombol assign', async () => {
    const state = baseState({
      status: 'partial',
      suggestions: [{ accountName: 'LINE Bank', accountId: null, confidence: 'high', count: 3, totalAmount: 500000 }],
      transactions: { total: 3, linked: 0, unlinked: 3, unlinkedAmount: 500000, pending: 3, confirmed: 0, rejected: 0 },
    });
    svc().getReconciliationState.mockResolvedValue(state as never);
    renderPage();

    // Nama akun yang disarankan tampil (judul grup + instruksi create); tanpa tombol assign.
    expect((await screen.findAllByText('LINE Bank')).length).toBeGreaterThanOrEqual(2);
    expect(screen.queryByRole('button', { name: /Terima semua/ })).toBeNull();
  });
});

describe('ReconciliationPage — verifikasi saldo & pairing', () => {
  it('verifikasi: isi saldo nyata = saldo sistem → status verified tampil', async () => {
    const state = baseState({
      status: 'reconciled',
      balanceConfidence: 'high',
      accounts: [{ id: 'acc-a', name: 'blu', type: 'e-wallet', currency: 'IDR', openingBalance: 1000000, openingBalanceDate: '2026-01-01', realBalance: null, realBalanceDate: null, realBalanceVerifiedAt: null, systemBalance: 850000, verificationStatus: 'not_verified' }],
      transactions: { total: 1, linked: 1, unlinked: 0, unlinkedAmount: 0, pending: 0, confirmed: 1, rejected: 0 },
      onboardingProgress: { accountsConfigured: true, openingBalancesConfigured: true, transactionsReconciled: true, transfersReconciled: true, realBalanceVerified: false, completedSteps: 4, totalSteps: 5 },
    });
    svc().getReconciliationState.mockResolvedValue(state as never);
    renderPage();

    const input = await screen.findByRole('spinbutton', { name: 'Saldo aktual blu' });
    fireEvent.change(input, { target: { value: '850000' } });
    fireEvent.click(screen.getByRole('button', { name: 'Tandai terverifikasi' }));

    await waitFor(() => expect(svc().verifyAccountBalance).toHaveBeenCalledTimes(1));
    expect(svc().verifyAccountBalance).toHaveBeenCalledWith('acc-a', 850000, expect.any(String));
    expect(await screen.findByText(/Cocok dengan saldo sistem/)).toBeInTheDocument();
  });

  it('pasangan transfer: klik Pasangkan → pairTransfer dipanggil dengan id', async () => {
    const state = baseState({
      status: 'partial',
      transfers: { total: 1, grouped: 0, ungrouped: 1 },
      transferPairSuggestions: [
        { transferId: 'tr-1', incomeId: 'in-1', transferDate: '2026-08-01', incomeDate: '2026-08-01', amount: 100000, merchant: 'blu', confidence: 'high', reason: 'same date/amount' },
      ],
    });
    svc().getReconciliationState.mockResolvedValue(state as never);
    renderPage();

    fireEvent.click(await screen.findByRole('button', { name: 'Pasangkan' }));
    await waitFor(() => expect(svc().pairTransfer).toHaveBeenCalledWith('tr-1', 'in-1'));
  });

  it('P2.8 §17: klik Abaikan pada kandidat transfer → konfirmasi → rejectTransferCandidate(transferId)', async () => {
    const state = baseState({
      status: 'partial',
      transfers: { total: 1, grouped: 0, ungrouped: 1 },
      transferPairSuggestions: [
        { transferId: 'tr-1', incomeId: 'in-1', transferDate: '2026-08-01', incomeDate: '2026-08-01', amount: 100000, merchant: 'blu', confidence: 'high', reason: 'same date/amount' },
      ],
    });
    svc().getReconciliationState.mockResolvedValue(state as never);
    renderPage();

    fireEvent.click(await screen.findByRole('button', { name: 'Abaikan' }));
    const dialog = await screen.findByRole('dialog');
    expect(dialog).toHaveTextContent('Abaikan kandidat transfer');
    fireEvent.click(screen.getByRole('button', { name: 'Abaikan Kandidat' }));
    await waitFor(() => expect(svc().rejectTransferCandidate).toHaveBeenCalledWith('tr-1'));
  });
});

describe('ReconciliationPage P2.8 — aktivasi akun kandidat', () => {
  it('kandidat terdeteksi dirender dengan CTA "Tambahkan Rekening"; konfirmasi → saveWalletAccount', async () => {
    const state = baseState({
      status: 'unknown',
      accountCandidates: ['LINE Bank', 'blu', 'DANA'],
    });
    svc().getReconciliationState.mockResolvedValue(state as never);
    renderPage();

    // Kandidat tampil; tombol aktivasi per baris.
    const buttons = await screen.findAllByRole('button', { name: /Tambahkan Rekening/ });
    expect(buttons).toHaveLength(3);

    fireEvent.click(buttons[0]); // LINE Bank
    const dialog = await screen.findByRole('dialog');
    expect(dialog).toHaveTextContent('Aktifkan rekening');
    // Nama ter-prefill dari kandidat (nilai input, bukan text node).
    const nameInput = dialog.querySelector('input[aria-label="Nama rekening"]') as HTMLInputElement;
    expect(nameInput.value).toBe('LINE Bank');
    fireEvent.click(within(dialog).getByRole('button', { name: 'Tambahkan Rekening' }));

    await waitFor(() => expect(walletSvc().saveWalletAccount).toHaveBeenCalledTimes(1));
    const [, data] = walletSvc().saveWalletAccount.mock.calls[0];
    expect(data.name).toBe('LINE Bank');
    expect(data.type).toBe('bank'); // inferensi dari nama
    expect(data.currency).toBe('IDR');
    // State di-refresh setelah aktivasi.
    await waitFor(() => expect(svc().getReconciliationState.mock.calls.length).toBeGreaterThanOrEqual(2));
  });

  it('inferensi tipe: DANA → e-wallet; blu → bank', async () => {
    const state = baseState({ status: 'unknown', accountCandidates: ['DANA', 'blu'] });
    svc().getReconciliationState.mockResolvedValue(state as never);
    renderPage();
    const buttons = await screen.findAllByRole('button', { name: /Tambahkan Rekening/ });
    fireEvent.click(buttons[0]); // DANA
    const dialog = await screen.findByRole('dialog');
    const select = dialog.querySelector('select') as HTMLSelectElement;
    expect(select.value).toBe('e-wallet');
  });
});

describe('ReconciliationPage P2.8 — tanggal anchor & tolak saran', () => {
  it('verifikasi: input tanggal saldo aktual tersedia dan dikirim ke verifyAccountBalance', async () => {
    const state = baseState({
      status: 'reconciled',
      balanceConfidence: 'high',
      accounts: [{ id: 'acc-a', name: 'blu', type: 'e-wallet', currency: 'IDR', openingBalance: 1000000, openingBalanceDate: '2026-01-01', realBalance: null, realBalanceDate: null, realBalanceVerifiedAt: null, systemBalance: 850000, verificationStatus: 'not_verified' }],
      transactions: { total: 1, linked: 1, unlinked: 0, unlinkedAmount: 0, pending: 0, confirmed: 1, rejected: 0 },
      onboardingProgress: { accountsConfigured: true, openingBalancesConfigured: true, transactionsReconciled: true, transfersReconciled: true, realBalanceVerified: false, completedSteps: 4, totalSteps: 5 },
    });
    svc().getReconciliationState.mockResolvedValue(state as never);
    renderPage();

    const dateInput = await screen.findByLabelText('Tanggal saldo aktual blu');
    expect(dateInput).toBeInstanceOf(HTMLInputElement);
    fireEvent.change(dateInput, { target: { value: '2026-08-10' } });
    fireEvent.change(screen.getByRole('spinbutton', { name: 'Saldo aktual blu' }), { target: { value: '850000' } });
    fireEvent.click(screen.getByRole('button', { name: 'Tandai terverifikasi' }));

    await waitFor(() => expect(svc().verifyAccountBalance).toHaveBeenCalledWith('acc-a', 850000, '2026-08-10'));
  });

  it('P2.8 §13: tombol Abaikan per grup saran → konfirmasi → rejectBySuggestion(accountId, confidence)', async () => {
    const state = baseState({
      status: 'partial',
      balanceConfidence: 'medium',
      accounts: [{ id: 'acc-blu', name: 'blu', type: 'e-wallet', currency: 'IDR', openingBalance: 1000000, openingBalanceDate: '2026-01-01', realBalance: null, realBalanceDate: null, realBalanceVerifiedAt: null, systemBalance: 1000000, verificationStatus: 'not_verified' }],
      transactions: { total: 2, linked: 0, unlinked: 2, unlinkedAmount: 150000, pending: 2, confirmed: 0, rejected: 0 },
      suggestions: [{ accountName: 'blu', accountId: 'acc-blu', confidence: 'high', count: 2, totalAmount: 150000 }],
      onboardingProgress: { accountsConfigured: true, openingBalancesConfigured: true, transactionsReconciled: false, transfersReconciled: true, realBalanceVerified: false, completedSteps: 3, totalSteps: 5 },
    });
    svc().getReconciliationState.mockResolvedValue(state as never);
    renderPage();

    fireEvent.click(await screen.findByRole('button', { name: 'Abaikan (2)' }));
    const dialog = await screen.findByRole('dialog');
    expect(dialog).toHaveTextContent('Abaikan 2 saran untuk "blu"?');
    fireEvent.click(screen.getByRole('button', { name: 'Abaikan Saran' }));
    await waitFor(() => expect(svc().rejectBySuggestion).toHaveBeenCalledWith('acc-blu', 'high'));
  });

  it('jumlah transaksi ditolak ditampilkan transparan', async () => {
    const state = baseState({
      status: 'partial',
      transactions: { total: 5, linked: 0, unlinked: 3, unlinkedAmount: 90000, pending: 3, confirmed: 0, rejected: 2 },
    });
    svc().getReconciliationState.mockResolvedValue(state as never);
    renderPage();
    expect(await screen.findByText(/2 transaksi telah Anda tandai/)).toBeInTheDocument();
  });
});

describe('ReconciliationPage P2.9 — skor penyelesaian & assign manual transaksi LOW (§12/§28)', () => {
  it('skor completion deterministik dirender (progressbar + angka)', async () => {
    const state = baseState({
      completionScore: {
        score: 45,
        accounts: { activated: 1, detected: 6 },
        anchors: { anchored: 0, total: 1 },
        transactions: { linked: 0, total: 391 },
        transfers: { resolved: 0, total: 75 },
      },
    });
    svc().getReconciliationState.mockResolvedValue(state as never);
    renderPage();
    const bar = await screen.findByRole('progressbar');
    expect(bar).toHaveAttribute('aria-valuenow', '45');
    expect(screen.getByLabelText('Skor penyelesaian 45 persen')).toHaveTextContent('45%');
    // Rincian skor (textContent utuh — label dipisah elemen <strong>).
    const breakdown = screen.getByText((_content, el) => el?.textContent === 'Rekening: 1/6 aktif');
    expect(breakdown).toBeInTheDocument();
    expect(screen.getByText((_content, el) => el?.textContent === 'Transaksi terhubung: 0/391')).toBeInTheDocument();
  });

  it('transaksi LOW dirender dengan checkbox; Terapkan → konfirmasi dampak → classifyTransactionsBulk', async () => {
    const state = baseState({
      status: 'partial',
      accounts: [{ id: 'acc-blu', name: 'blu', type: 'e-wallet', currency: 'IDR', openingBalance: null, openingBalanceDate: null, realBalance: null, realBalanceDate: null, realBalanceVerifiedAt: null, systemBalance: null, verificationStatus: 'not_verified' }],
      unassignedTransactions: [
        { id: 'tx-1', merchant: 'Merchant Acak', amount: 45000, date: '2026-08-01' },
        { id: 'tx-2', merchant: 'Lainnya', amount: 20000, date: '2026-08-02' },
      ],
    });
    svc().getReconciliationState.mockResolvedValue(state as never);
    renderPage();

    // Bagian LOW tampil dengan jumlah transaksi & tombol pilih.
    expect(await screen.findByText('Belum dapat ditentukan')).toBeInTheDocument();
    expect(screen.getByText('2 transaksi')).toBeInTheDocument();

    // Pilih rekening + pilih semua → Terapkan → dialog konfirmasi dampak.
    fireEvent.change(screen.getByLabelText('Pilih rekening:'), { target: { value: 'acc-blu' } });
    fireEvent.click(screen.getByRole('button', { name: 'Pilih semua' }));
    const applyBtn = screen.getByRole('button', { name: /Terapkan \(2\)/ });
    expect(applyBtn).toBeEnabled();
    fireEvent.click(applyBtn);

    const dialog = await screen.findByRole('dialog');
    expect(dialog).toHaveTextContent('Hubungkan 2 transaksi secara manual?');
    expect(dialog).toHaveTextContent('Rp65.000'); // total dampak 45.000 + 20.000
    fireEvent.click(within(dialog).getByRole('button', { name: 'Konfirmasi' }));

    await waitFor(() =>
      expect(svc().classifyTransactionsBulk).toHaveBeenCalledWith([
        { transactionId: 'tx-1', accountId: 'acc-blu' },
        { transactionId: 'tx-2', accountId: 'acc-blu' },
      ])
    );
  });

  it('Terapkan dinonaktifkan tanpa rekening terpilih (tidak pernah blind-assign)', async () => {
    const state = baseState({
      accounts: [{ id: 'acc-blu', name: 'blu', type: 'e-wallet', currency: 'IDR', openingBalance: null, openingBalanceDate: null, realBalance: null, realBalanceDate: null, realBalanceVerifiedAt: null, systemBalance: null, verificationStatus: 'not_verified' }],
      unassignedTransactions: [{ id: 'tx-1', merchant: 'Merchant Acak', amount: 45000, date: '2026-08-01' }],
    });
    svc().getReconciliationState.mockResolvedValue(state as never);
    renderPage();
    await screen.findByText('Belum dapat ditentukan');
    fireEvent.click(screen.getByRole('button', { name: 'Pilih semua' }));
    // Tanpa pilihan rekening → tombol Terapkan tetap disabled.
    expect(screen.getByRole('button', { name: /Terapkan \(1\)/ })).toBeDisabled();
  });
});

describe('ReconciliationPage P3.0 — filter LOW (§12), mismatch hints (§18), step indicator (§28)', () => {
  const accB = () => ({ id: 'acc-blu', name: 'blu', type: 'e-wallet', currency: 'IDR', openingBalance: null, openingBalanceDate: null, realBalance: null, realBalanceDate: null, realBalanceVerifiedAt: null, systemBalance: null, verificationStatus: 'not_verified' });

  it('filter jenis: klik "Pengeluaran" → hanya transaksi expense yang tampil & Terapkan menghitung item ter-filter', async () => {
    const state = baseState({
      status: 'partial',
      accounts: [accB()],
      unassignedTransactions: [
        { id: 'tx-inc', merchant: 'Masuk A', amount: 50000, date: '2026-08-01', type: 'income' },
        { id: 'tx-exp', merchant: 'Keluar A', amount: 30000, date: '2026-08-02', type: 'expense' },
        { id: 'tx-exp2', merchant: 'Keluar B', amount: 20000, date: '2026-08-03', type: 'expense' },
        { id: 'tx-ref', merchant: 'Refund A', amount: 10000, date: '2026-08-04', type: 'refund' },
      ],
    });
    svc().getReconciliationState.mockResolvedValue(state as never);
    renderPage();

    await screen.findByText('Belum dapat ditentukan');
    const group = screen.getByRole('group', { name: 'Filter jenis transaksi' });
    expect(within(group).getByRole('button', { name: 'Semua' })).toHaveAttribute('aria-pressed', 'true');

    // Filter ke Pengeluaran → hanya 2 item expense; pilihan ter-reset (no hidden action).
    fireEvent.change(screen.getByLabelText('Pilih rekening:'), { target: { value: 'acc-blu' } });
    fireEvent.click(screen.getByRole('button', { name: 'Pilih semua' }));
    expect(screen.getByRole('button', { name: /Terapkan \(4\)/ })).toBeEnabled();
    fireEvent.click(within(group).getByRole('button', { name: 'Pengeluaran' }));

    expect(screen.getByText('Keluar A')).toBeInTheDocument();
    expect(screen.getByText('Keluar B')).toBeInTheDocument();
    expect(screen.queryByText('Masuk A')).toBeNull();
    expect(screen.queryByText('Refund A')).toBeNull();
    // Selection ter-reset saat filter berubah → hanya hitung item yang tampil.
    expect(screen.getByRole('button', { name: /Terapkan \(0\)/ })).toBeDisabled();
    fireEvent.click(screen.getByRole('button', { name: 'Pilih semua' }));
    expect(screen.getByRole('button', { name: /Terapkan \(2\)/ })).toBeEnabled();
  });

  it('mismatch → panel "Kemungkinan penyebab" ter-filter evidence nyata (unlinked + transfer belum dipasangkan)', async () => {
    const state = baseState({
      status: 'reconciled',
      balanceConfidence: 'high',
      accounts: [{ id: 'acc-a', name: 'blu', type: 'e-wallet', currency: 'IDR', openingBalance: 1000000, openingBalanceDate: '2026-01-01', realBalance: null, realBalanceDate: null, realBalanceVerifiedAt: null, systemBalance: 850000, verificationStatus: 'not_verified' }],
      transactions: { total: 5, linked: 3, unlinked: 2, unlinkedAmount: 120000, pending: 2, confirmed: 3, rejected: 0 },
      transfers: { total: 2, grouped: 1, ungrouped: 1 },
      accountCandidates: ['LINE Bank'],
    });
    svc().getReconciliationState.mockResolvedValue(state as never);
    svc().verifyAccountBalance.mockResolvedValue({ ok: true, status: 'mismatch', difference: -50000 } as never);
    renderPage();

    const input = await screen.findByRole('spinbutton', { name: 'Saldo aktual blu' });
    fireEvent.change(input, { target: { value: '800000' } });
    fireEvent.click(screen.getByRole('button', { name: 'Tandai terverifikasi' }));

    const panel = await screen.findByText('Kemungkinan penyebab');
    expect(panel).toBeInTheDocument();
    // Selisih tampil; klaim dijaga sebagai kemungkinan, bukan kepastian.
    expect(screen.getByText(/Tidak cocok — selisih -Rp50.000/)).toBeInTheDocument();
    expect(screen.getByText((_c, el) => el?.textContent === '· 2 transaksi belum terhubung ke rekening (Rp120.000) — belum ikut dalam saldo sistem.')).toBeInTheDocument();
    expect(screen.getByText((_c, el) => el?.textContent === '· 1 transfer belum dipasangkan — bisa mengubah saldo antar rekening.')).toBeInTheDocument();
    expect(screen.getByText((_c, el) => el?.textContent === '· 1 rekening terdeteksi belum diaktifkan — transaksinya belum dapat dihitung.')).toBeInTheDocument();
    // Tidak ada auto-fix: verifyAccountBalance tidak mengembalikan adjustment.
    expect(svc().verifyAccountBalance).toHaveBeenCalledTimes(1);
  });

  it('step indicator eksplisit "Langkah N / 5" + label langkah berikutnya', async () => {
    const state = baseState({
      onboardingProgress: { accountsConfigured: true, openingBalancesConfigured: true, transactionsReconciled: false, transfersReconciled: true, realBalanceVerified: false, completedSteps: 3, totalSteps: 5 },
    });
    svc().getReconciliationState.mockResolvedValue(state as never);
    renderPage();
    expect(await screen.findByText('Langkah 4 / 5')).toBeInTheDocument();
    // completedSteps=3 → langkah ke-4 (indeks 3) yang berikutnya: Transfer.
    expect(screen.getByText('Berikutnya: Transfer')).toBeInTheDocument();
  });
});

describe('ReconciliationPage P3.1 — perbaiki penautan (§21) & waterfall mismatch (§19)', () => {
  const accA = () => ({ id: 'acc-a', name: 'blu', type: 'e-wallet', currency: 'IDR', openingBalance: null, openingBalanceDate: null, realBalance: null, realBalanceDate: null, realBalanceVerifiedAt: null, systemBalance: 850000, verificationStatus: 'not_verified' });
  const accB = () => ({ id: 'acc-b', name: 'DANA', type: 'e-wallet', currency: 'IDR', openingBalance: null, openingBalanceDate: null, realBalance: null, realBalanceDate: null, realBalanceVerifiedAt: null, systemBalance: null, verificationStatus: 'not_verified' });

  it('transaksi tertaut dirender; pilih rekening baru → konfirmasi → reassignTransaction(id, akun)', async () => {
    const state = baseState({
      status: 'partial',
      accounts: [accA(), accB()],
      linkedTransactions: [
        { id: 'tx-1', merchant: 'Warung A', amount: 25000, date: '2026-08-02', type: 'expense', accountId: 'acc-a', accountName: 'blu' },
      ],
    });
    svc().getReconciliationState.mockResolvedValue(state as never);
    renderPage();

    expect(await screen.findByRole('heading', { name: 'Perbaiki penautan transaksi' })).toBeInTheDocument();
    expect(screen.getByText('Warung A')).toBeInTheDocument();
    // Dropdown tujuan mengecualikan rekening asal (blu); DANA tersedia.
    const select = screen.getByLabelText('Pindahkan Warung A ke rekening');
    fireEvent.change(select, { target: { value: 'acc-b' } });
    fireEvent.click(screen.getByRole('button', { name: 'Ubah rekening' }));

    const dialog = await screen.findByRole('dialog');
    expect(dialog).toHaveTextContent('Pindahkan "Warung A" (Rp25.000)?');
    expect(dialog).toHaveTextContent('Dari blu ke DANA');
    fireEvent.click(within(dialog).getByRole('button', { name: 'Konfirmasi' }));

    await waitFor(() => expect(svc().reassignTransaction).toHaveBeenCalledWith('tx-1', 'acc-b'));
    await waitFor(() => expect(svc().getReconciliationState.mock.calls.length).toBeGreaterThanOrEqual(2));
  });

  it('tanpa transaksi tertaut → section tidak dirender (tidak menambah noise)', async () => {
    svc().getReconciliationState.mockResolvedValue(baseState() as never);
    renderPage();
    await screen.findByRole('heading', { name: 'Rekonsiliasi Rekening' });
    expect(screen.queryByRole('heading', { name: 'Perbaiki penautan transaksi' })).toBeNull();
  });

  it('mismatch → panel waterfall "Rincian selisih" menampilkan kontribusi kuantitatif', async () => {
    const state = baseState({
      status: 'reconciled',
      balanceConfidence: 'high',
      accounts: [{ id: 'acc-a', name: 'blu', type: 'e-wallet', currency: 'IDR', openingBalance: 1000000, openingBalanceDate: '2026-01-01', realBalance: null, realBalanceDate: null, realBalanceVerifiedAt: null, systemBalance: 850000, verificationStatus: 'not_verified' }],
      transactions: { total: 5, linked: 3, unlinked: 2, unlinkedAmount: 120000, pending: 2, confirmed: 3, rejected: 0 },
      transfers: { total: 2, grouped: 1, ungrouped: 1 },
    });
    svc().getReconciliationState.mockResolvedValue(state as never);
    svc().verifyAccountBalance.mockResolvedValue({
      ok: true, status: 'mismatch', difference: -50000,
      breakdown: { unclassifiedAmount: 120000, unresolvedTransferAmount: 0, postAnchorMovements: { inflow: 0, expense: 0, incomingTransfer: 0, outgoingTransfer: 0 } },
    } as never);
    renderPage();

    const input = await screen.findByRole('spinbutton', { name: 'Saldo aktual blu' });
    fireEvent.change(input, { target: { value: '800000' } });
    fireEvent.click(screen.getByRole('button', { name: 'Tandai terverifikasi' }));

    const waterfall = (await screen.findByText('Rincian selisih (waterfall)')).closest('div');
    expect(waterfall).not.toBeNull();
    expect(screen.getByText('Transaksi belum tertaut (semua rekening)')).toBeInTheDocument();
    expect(within(waterfall as HTMLElement).getByText('Rp120.000')).toBeInTheDocument();
  });
});
