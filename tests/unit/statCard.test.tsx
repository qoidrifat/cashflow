/**
 * Unit test: src/components/ui/StatCard.tsx — indikasi nilai negatif (balance < 0).
 *
 * Komponen test (environment: happy-dom — ditetapkan di level PROJECT
 * `unit-dom` di vitest.config.ts, bukan docblock per-file; 2026-08-09).
 * Render helper (renderCard + valueElement) diimpor dari ./helpers/render.tsx;
 * jest-dom matcher + afterEach(cleanup) disediakan setup project
 * (tests/unit/setup.ts) — file test cukup import helper, tidak perlu
 * @testing-library/react cleanup / jest-dom / afterEach sendiri.
 *
 * Kontrak yang terdokumentasi di StatCard:
 *   - negative=true  → prefix '-' + kelas merah (text-red-600 dark:text-red-400)
 *   - negative=false → tanpa prefix, text-app-text
 *   - sign?: 'plus' | 'minus' | 'none' → prefix MURNI tanpa warna (pengganti
 *     prop `positive` yang DIHAPUS 2026-08-09; warna mint = tanggung jawab
 *     variant="income"). Prioritas: `negative` selalu menang atas `sign`.
 *   - formatCurrency TIDAK diubah (Math.abs di dalamnya) — nilai tampil persis
 *     `${negative ? '-' : sign === 'plus' ? '+' : sign === 'minus' ? '-' : ''}${formatCurrency(value)}`;
 *     indikasi negatif sepenuhnya tanggung jawab pemakai prop `negative`.
 */
import { describe, it, expect } from 'vitest';
import { screen } from '@testing-library/react';
import { renderCard, valueElement } from './helpers/render';
import { formatCurrency } from '../../src/lib/utils';

describe('negative=false (default)', () => {
  it('menampilkan nilai positif tanpa prefix minus', () => {
    const { container } = renderCard();
    expect(screen.getByText(formatCurrency(1500000))).toBeInTheDocument();
    // Tidak ada tanda '-' di mana pun pada nilai
    expect(valueElement(container).textContent).not.toContain('-');
  });

  it('memakai kelas netral text-app-text (bukan merah)', () => {
    renderCard();
    const el = screen.getByText(formatCurrency(1500000));
    expect(el).toHaveClass('text-app-text');
    expect(el).not.toHaveClass('text-red-600', 'dark:text-red-400');
  });

  it('nilai negatif TANPA negative prop → tetap tampil positif (Math.abs di formatCurrency)', () => {
    // Menegaskan: formatCurrency memakai Math.abs; tanpa negative=true, nilai
    // negatif tidak punya indikasi apa pun — oleh karena itu pemanggil WAJIB
    // mengirim negative={value < 0} (pola StatCard di DashboardPage).
    const { container } = renderCard({ value: -750 });
    expect(screen.getByText('Rp750')).toBeInTheDocument();
    expect(valueElement(container).textContent).toBe('Rp750');
  });
});

describe('negative=true', () => {
  it('memberi prefix minus di depan formatCurrency', () => {
    renderCard({ value: 1500000, negative: true });
    expect(screen.getByText(`-${formatCurrency(1500000)}`)).toBeInTheDocument();
  });

  it('nilai berkelas merah text-red-600 dark:text-red-400 (bukan netral)', () => {
    renderCard({ value: 1500000, negative: true });
    const el = screen.getByText(`-${formatCurrency(1500000)}`);
    expect(el).toHaveClass('text-red-600', 'dark:text-red-400');
    expect(el).not.toHaveClass('text-app-text');
  });

  it('title & ikon tetap dirender', () => {
    renderCard({ value: 750, negative: true });
    expect(screen.getByText('Total Saldo')).toBeInTheDocument();
    expect(screen.getByTestId('card-icon')).toBeInTheDocument();
  });
});

describe('sign — prefix murni (pengganti positive, API 2026-08-09)', () => {
  it('sign="plus" → prefix plus TANPA kelas mint (netral text-app-text)', () => {
    // sign MURNI display: warna mint TIDAK ikut — itu tanggung jawab variant.
    renderCard({ value: 750, sign: 'plus' });
    const el = screen.getByText('+Rp750');
    expect(el).toHaveClass('text-app-text');
    expect(el).not.toHaveClass('text-mint-600', 'dark:text-mint-300');
  });

  it('sign="minus" → prefix minus TANPA kelas merah (netral text-app-text)', () => {
    renderCard({ value: 750, sign: 'minus' });
    const el = screen.getByText('-Rp750');
    expect(el).toHaveClass('text-app-text');
    expect(el).not.toHaveClass('text-red-600', 'dark:text-red-400');
  });

  it('sign="none" → tanpa prefix (eksplisit)', () => {
    renderCard({ value: 750, sign: 'none' });
    expect(screen.getByText('Rp750')).toBeInTheDocument();
    expect(screen.queryByText('+Rp750')).not.toBeInTheDocument();
    expect(screen.queryByText('-Rp750')).not.toBeInTheDocument();
  });

  it('sign="plus" + variant="income" → "+" + mint variant (paritas pemasukan — warna dari variant)', () => {
    // Kasus nyata "Pemasukan Bulan Ini": menggantikan positive + variant income.
    renderCard({ value: 750, sign: 'plus', variant: 'income' });
    const el = screen.getByText('+Rp750');
    expect(el).toHaveClass('text-mint-600', 'dark:text-mint-300');
    expect(el).not.toHaveClass('text-app-text');
  });

  it('sign="minus" + variant="expense" → "-" + merah variant (paritas pengeluaran di dashboard)', () => {
    renderCard({ value: 750, sign: 'minus', variant: 'expense' });
    const el = screen.getByText('-Rp750');
    expect(el).toHaveClass('text-red-500', 'dark:text-red-300');
  });

  it('negative menang atas sign="plus" (peringatan mendominasi)', () => {
    renderCard({ value: 750, negative: true, sign: 'plus' });
    const el = screen.getByText('-Rp750');
    expect(el).toHaveClass('text-red-600', 'dark:text-red-400');
    expect(screen.queryByText('+Rp750')).not.toBeInTheDocument();
  });

  it('negative menang atas sign="none" (tidak bisa ditekan)', () => {
    renderCard({ value: 750, negative: true, sign: 'none' });
    const el = screen.getByText('-Rp750');
    expect(el).toHaveClass('text-red-600', 'dark:text-red-400');
  });

  it('sign TANPA kondisi → unconditional "+Rp0"/"-Rp0" untuk nilai 0 (guard di call-site)', () => {
    // Komponen bersifat apa adanya: tanda mengikuti prop — 'none' adalah cara
    // EKSPLISIT menghindari tanda pada 0. Guard kondisional (pola
    // sign={v > 0 ? 'plus' : 'none'}) adalah tanggung jawab call-site.
    renderCard({ value: 0, sign: 'plus' });
    expect(screen.getByText('+Rp0')).toBeInTheDocument();
    renderCard({ value: 0, sign: 'minus' });
    expect(screen.getByText('-Rp0')).toBeInTheDocument();
  });
});

describe('formatCurrency tidak diubah', () => {
  it('util masih memakai Math.abs (kontrak tidak berubah)', () => {
    expect(formatCurrency(-750)).toBe('Rp750');
    expect(formatCurrency(0)).toBe('Rp0');
  });

  it('output komponen persis komposisi `${negative ? "-" : sign === "plus" ? "+" : sign === "minus" ? "-" : ""}${formatCurrency(value)}`', () => {
    renderCard({ value: 2500, negative: false });
    expect(screen.getByText(formatCurrency(2500))).toBeInTheDocument();

    renderCard({ value: 2500, negative: true });
    expect(screen.getByText(`-${formatCurrency(2500)}`)).toBeInTheDocument();

    renderCard({ value: 2500, sign: 'plus' });
    expect(screen.getByText(`+${formatCurrency(2500)}`)).toBeInTheDocument();
  });
});

describe('variant kelas', () => {
  it('variant income → hijau mint (tidak terpengaruh negative)', () => {
    renderCard({ value: 750, variant: 'income', negative: true });
    // negative=true memberi prefix '-' untuk SEMUA variant (hanya kelas warna
    // yang di-scope ke variant) — fokus asersi adalah kelas, bukan tanda.
    const el = screen.getByText('-Rp750');
    expect(el).toHaveClass('text-mint-600', 'dark:text-mint-300');
    expect(el).not.toHaveClass('text-red-600');
  });

  it('variant expense → merah (tidak terpengaruh negative)', () => {
    renderCard({ value: 750, variant: 'expense' });
    const el = screen.getByText('Rp750');
    expect(el).toHaveClass('text-red-500', 'dark:text-red-300');
  });
});

describe('badge perubahan & label', () => {
  it('change positif → persen abs tanpa minus + ikon naik', () => {
    const { container } = renderCard({ value: 750, change: 12, changeLabel: 'vs bulan lalu' });
    expect(screen.getByText('12%')).toBeInTheDocument();
    expect(container.querySelector('.lucide-trending-up')).not.toBeNull();
  });

  it('change negatif → persen abs (Math.abs) + ikon turun', () => {
    const { container } = renderCard({ value: 750, change: -5 });
    expect(screen.getByText('5%')).toBeInTheDocument();
    expect(screen.queryByText('-5%')).not.toBeInTheDocument();
    expect(container.querySelector('.lucide-trending-down')).not.toBeNull();
  });

  it('changeLabel dirender di bawah nilai', () => {
    renderCard({ value: 750, change: 5, changeLabel: 'vs bulan lalu' });
    expect(screen.getByText('vs bulan lalu')).toBeInTheDocument();
  });
});
