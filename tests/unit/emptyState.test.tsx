/**
 * Unit test: src/components/ui/EmptyState.tsx (P1.2).
 *
 * Kontrak yang di-lock:
 *   - title wajib & dirender (heading)
 *   - description opsional — dirender bila ada, tidak dirender bila kosong
 *   - action opsional (ReactNode) — dirender bila ada
 *   - ikon default Inbox; ikon kustom menggantikan
 */
import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import EmptyState from '../../src/components/ui/EmptyState';

describe('EmptyState — title & description', () => {
  it('title dirender sebagai heading', () => {
    render(<EmptyState title="Belum ada transaksi" />);
    expect(screen.getByRole('heading', { name: 'Belum ada transaksi' })).toBeInTheDocument();
  });

  it('description dirender bila disediakan', () => {
    render(<EmptyState title="Belum ada data" description="Mulai catat pengeluaran pertama kamu" />);
    expect(screen.getByText('Mulai catat pengeluaran pertama kamu')).toBeInTheDocument();
  });

  it('description TIDAK dirender bila kosong', () => {
    render(<EmptyState title="Belum ada data" />);
    expect(screen.queryByText('Mulai catat pengeluaran pertama kamu')).toBeNull();
  });
});

describe('EmptyState — action & ikon', () => {
  it('action (ReactNode) dirender bila disediakan', () => {
    render(
      <EmptyState
        title="Belum ada budget"
        action={<button type="button">Buat Budget</button>}
      />,
    );
    expect(screen.getByRole('button', { name: 'Buat Budget' })).toBeInTheDocument();
  });

  it('action TIDAK dirender bila tidak disediakan', () => {
    render(<EmptyState title="Belum ada budget" />);
    expect(screen.queryByRole('button')).toBeNull();
  });

  it('ikon default Inbox dirender', () => {
    const { container } = render(<EmptyState title="Kosong" />);
    expect(container.querySelector('.lucide-inbox')).not.toBeNull();
  });

  it('ikon kustom menggantikan default', () => {
    const { container } = render(
      <EmptyState title="Kosong" icon={<span data-testid="custom-icon" />} />,
    );
    expect(container.querySelector('.lucide-inbox')).toBeNull();
    expect(screen.getByTestId('custom-icon')).toBeInTheDocument();
  });
});
