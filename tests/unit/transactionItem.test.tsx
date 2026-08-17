/**
 * Unit test: src/components/ui/TransactionItem.tsx — tanda, label source,
 * fraud flag, dan perilaku dengan field opsional (P1.1).
 *
 * Komponen test (environment happy-dom — project `unit-dom` di vitest.config.ts).
 * jest-dom matcher + afterEach(cleanup) via setup project (tests/unit/setup.ts).
 *
 * Kontrak yang di-lock:
 *   - expense/transfer  → prefix '-'  (warna merah — tipe expense)
 *   - income/refund     → prefix '+'  (warna mint)
 *   - source != 'manual' → badge label (Gmail/Fallback/AI/Import)
 *   - source 'manual'    → tanpa badge
 *   - fraudFlag 'flagged'/'review' → "Mencurigakan"; 'blocked' → "Risiko tinggi"
 *   - merchant kosong → fallback ke categoryName (tidak crash)
 *   - note kosong      → baris note tidak dirender
 *   - onClick dipanggil dengan objek transaksi penuh
 */
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import TransactionItem from '../../src/components/ui/TransactionItem';
import { formatCurrency } from '../../src/lib/utils';
import type { Transaction } from '../../src/types';

function makeTransaction(overrides: Partial<Transaction> = {}): Transaction {
  return {
    id: 'tx-1',
    userId: 'user-1',
    type: 'expense',
    amount: 10000,
    categoryId: 'cat-food',
    categoryName: 'Makanan',
    merchant: 'Warung',
    paymentMethod: 'qris',
    note: '',
    date: '2026-08-01',
    source: 'manual',
    createdAt: new Date('2026-08-01T00:00:00Z'),
    updatedAt: new Date('2026-08-01T00:00:00Z'),
    ...overrides,
  };
}

describe('TransactionItem — tanda (prefix) per tipe', () => {
  it('expense → prefix minus + label Pengeluaran', () => {
    render(<TransactionItem transaction={makeTransaction({ type: 'expense', amount: 10000 })} />);
    expect(screen.getByText(`-${formatCurrency(10000)}`)).toBeInTheDocument();
    expect(screen.getByText('Pengeluaran')).toBeInTheDocument();
  });

  it('income → prefix plus + label Pemasukan', () => {
    render(<TransactionItem transaction={makeTransaction({ type: 'income', amount: 5000000 })} />);
    expect(screen.getByText(`+${formatCurrency(5000000)}`)).toBeInTheDocument();
    expect(screen.getByText('Pemasukan')).toBeInTheDocument();
  });

  it('refund → prefix plus (diperlakukan sebagai pemasukan) + label Refund', () => {
    render(<TransactionItem transaction={makeTransaction({ type: 'refund', amount: 25000 })} />);
    expect(screen.getByText(`+${formatCurrency(25000)}`)).toBeInTheDocument();
    expect(screen.getByText('Refund')).toBeInTheDocument();
  });

  it('transfer → prefix minus + label Transfer (semantik aplikasi existing)', () => {
    // Semantik aplikasi: transfer tampil '-' (uang keluar dari saldo) —
    // mengunci perilaku existing, bukan mengarang behavior baru.
    render(<TransactionItem transaction={makeTransaction({ type: 'transfer', amount: 75000 })} />);
    expect(screen.getByText(`-${formatCurrency(75000)}`)).toBeInTheDocument();
    expect(screen.getByText('Transfer')).toBeInTheDocument();
  });
});

describe('TransactionItem — label source otomatis', () => {
  it('manual → TANPA badge (sumber manual bukan otomatis)', () => {
    const { container } = render(<TransactionItem transaction={makeTransaction({ source: 'manual' })} />);
    expect(screen.queryByText('Gmail')).toBeNull();
    expect(screen.queryByText('Fallback')).toBeNull();
    expect(screen.queryByText('AI')).toBeNull();
    expect(container.textContent).not.toContain('Import');
  });

  it.each([
    ['gmail', 'Gmail'],
    ['fallback', 'Fallback'],
    ['ai', 'AI'],
    ['import', 'Import'],
  ] as const)('source %s → badge "%s"', (source, label) => {
    render(<TransactionItem transaction={makeTransaction({ source })} />);
    expect(screen.getByText(label)).toBeInTheDocument();
  });
});

describe('TransactionItem — fraud flag', () => {
  it('fraudFlag "flagged" → indikator "Mencurigakan"', () => {
    render(<TransactionItem transaction={makeTransaction({ fraudFlag: 'flagged' })} />);
    expect(screen.getByText('Mencurigakan')).toBeInTheDocument();
  });

  it('fraudFlag "blocked" → indikator "Risiko tinggi"', () => {
    render(<TransactionItem transaction={makeTransaction({ fraudFlag: 'blocked' })} />);
    expect(screen.getByText('Risiko tinggi')).toBeInTheDocument();
  });

  it('tanpa fraudFlag → tidak ada indikator fraud', () => {
    render(<TransactionItem transaction={makeTransaction({ fraudFlag: null })} />);
    expect(screen.queryByText('Mencurigakan')).toBeNull();
    expect(screen.queryByText('Risiko tinggi')).toBeNull();
    expect(screen.queryByTitle(/berisiko tinggi|mencurigakan/i)).toBeNull();
  });
});

describe('TransactionItem — field opsional', () => {
  it('merchant kosong → fallback ke categoryName (tidak crash)', () => {
    render(<TransactionItem transaction={makeTransaction({ merchant: '' })} />);
    expect(screen.getByText('Makanan')).toBeInTheDocument();
  });

  it('note kosong → baris note tidak dirender', () => {
    const { container } = render(<TransactionItem transaction={makeTransaction({ note: '' })} />);
    expect(container.textContent).not.toContain('Keterangan');
  });

  it('note terisi → note dirender', () => {
    render(<TransactionItem transaction={makeTransaction({ note: 'Makan siang' })} />);
    expect(screen.getByText('Makan siang')).toBeInTheDocument();
  });

  it('kategori selalu dirender (categoryName di baris kedua) — tidak crash untuk kategori apa pun', () => {
    render(<TransactionItem transaction={makeTransaction({ categoryName: 'Kategori Aneh' })} />);
    // Teks kategori tergabung dengan tanggal di elemen yang sama
    // (`{categoryName} · {formatDate(date)}`) → regex substring.
    expect(screen.getByText(/Kategori Aneh/)).toBeInTheDocument();
  });
});

describe('TransactionItem — interaksi', () => {
  it('klik item → onClick dipanggil dengan objek transaksi penuh', () => {
    const onClick = vi.fn();
    const tx = makeTransaction({ id: 'tx-abc', merchant: 'GoFood' });
    render(<TransactionItem transaction={tx} onClick={onClick} />);
    fireEvent.click(screen.getByText('GoFood'));
    expect(onClick).toHaveBeenCalledTimes(1);
    expect(onClick).toHaveBeenCalledWith(tx);
  });

  it('tanpa onClick → item tetap dirender tanpa crash', () => {
    render(<TransactionItem transaction={makeTransaction()} />);
    expect(screen.getByText('Warung')).toBeInTheDocument();
  });
});
