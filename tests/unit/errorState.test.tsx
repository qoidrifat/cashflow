/**
 * Unit test: src/components/ui/ErrorState.tsx (P1.2).
 *
 * Kontrak yang di-lock:
 *   - title default "Terjadi Kesalahan"; title kustom dirender
 *   - error mentah → pesan ramah (friendlyErrorMessage) — bukan pesan mentah
 *   - requestId/code → baris diagnostik (font-mono)
 *   - onRetry → tombol "Coba Lagi"; klik memanggil callback
 *   - tanpa onRetry → tanpa tombol retry
 *   - className diteruskan ke container
 */
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import ErrorState from '../../src/components/ui/ErrorState';

describe('ErrorState — title & pesan ramah', () => {
  it('title default "Terjadi Kesalahan" dirender', () => {
    render(<ErrorState />);
    expect(screen.getByRole('heading', { name: 'Terjadi Kesalahan' })).toBeInTheDocument();
  });

  it('title kustom dirender', () => {
    render(<ErrorState title="Gagal Memuat Data" />);
    expect(screen.getByRole('heading', { name: 'Gagal Memuat Data' })).toBeInTheDocument();
  });

  it('error network → pesan ramah koneksi (bukan pesan mentah)', () => {
    render(<ErrorState error={new Error('Network Error')} />);
    expect(screen.getByText(/Tidak bisa terhubung ke server/i)).toBeInTheDocument();
    expect(screen.queryByText('Network Error')).toBeNull();
  });

  it('error tanpa pola dikenal → pesan default yang tidak pernah throw', () => {
    render(<ErrorState error={new Error('sesuatu yang aneh terjadi')} />);
    expect(screen.getByText(/sesuatu yang aneh terjadi/)).toBeInTheDocument();
  });
});

describe('ErrorState — diagnostik', () => {
  it('error dengan requestId + code → baris diagnostik "Request ... · code"', () => {
    render(<ErrorState error={{ message: 'Gagal', requestId: 'req_123', code: 'FETCH_FAILED' }} />);
    expect(screen.getByText(/Request req_123/)).toBeInTheDocument();
    expect(screen.getByText(/FETCH_FAILED/)).toBeInTheDocument();
  });

  it('error tanpa requestId/code → tanpa baris diagnostik', () => {
    render(<ErrorState error={new Error('Network Error')} />);
    expect(screen.queryByText(/^Request /)).toBeNull();
  });
});

describe('ErrorState — retry', () => {
  it('onRetry → tombol "Coba Lagi"; klik memanggil callback', () => {
    const onRetry = vi.fn();
    render(<ErrorState onRetry={onRetry} />);
    const button = screen.getByRole('button', { name: 'Coba Lagi' });
    fireEvent.click(button);
    expect(onRetry).toHaveBeenCalledTimes(1);
  });

  it('tanpa onRetry → tidak ada tombol retry (mencegah aksi tanpa handler)', () => {
    render(<ErrorState />);
    expect(screen.queryByRole('button', { name: 'Coba Lagi' })).toBeNull();
  });
});

describe('ErrorState — className', () => {
  it('className diteruskan ke container', () => {
    const { container } = render(<ErrorState className="custom-state" />);
    expect(container.firstElementChild).toHaveClass('custom-state');
  });
});
