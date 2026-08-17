/**
 * Unit test: src/features/ai-product/components/AiConfidenceBadge.tsx (P1.3).
 *
 * Kontrak yang di-lock (interpretasi dari backend score 0-1 — frontend TIDAK
 * membuat confidence baru, hanya menampilkan):
 *   - ≥0.90 → "Sangat yakin" (very_high)
 *   - ≥0.70 → "Yakin"        (high)
 *   - ≥0.50 → "Cukup yakin"  (medium)
 *   - <0.50 → "Perlu verifikasi" (low)
 *   - null/undefined/NaN → tidak render (null-safe)
 *   - hidePercent → tanpa angka %
 *   - showExplanation → tombol info; klik menampilkan penjelasan
 */
import { describe, it, expect } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import AiConfidenceBadge from '../../src/features/ai-product/components/AiConfidenceBadge';

describe('AiConfidenceBadge — ambang interpretasi', () => {
  it('0.95 → "Sangat yakin" + 95%', () => {
    render(<AiConfidenceBadge score={0.95} />);
    expect(screen.getByText('Sangat yakin')).toBeInTheDocument();
    expect(screen.getByText('95%')).toBeInTheDocument();
  });

  it('0.90 → masih "Sangat yakin" (boundary ≥ 0.90)', () => {
    render(<AiConfidenceBadge score={0.9} />);
    expect(screen.getByText('Sangat yakin')).toBeInTheDocument();
  });

  it('0.75 → "Yakin"', () => {
    render(<AiConfidenceBadge score={0.75} />);
    expect(screen.getByText('Yakin')).toBeInTheDocument();
    expect(screen.getByText('75%')).toBeInTheDocument();
  });

  it('0.50 → "Cukup yakin" (boundary ≥ 0.50)', () => {
    render(<AiConfidenceBadge score={0.5} />);
    expect(screen.getByText('Cukup yakin')).toBeInTheDocument();
  });

  it('0.30 → "Perlu verifikasi"', () => {
    render(<AiConfidenceBadge score={0.3} />);
    expect(screen.getByText('Perlu verifikasi')).toBeInTheDocument();
    expect(screen.getByText('30%')).toBeInTheDocument();
  });
});

describe('AiConfidenceBadge — null-safe & opsi', () => {
  it('score null → tidak render', () => {
    const { container } = render(<AiConfidenceBadge score={null} />);
    expect(container).toBeEmptyDOMElement();
  });

  it('score undefined → tidak render', () => {
    const { container } = render(<AiConfidenceBadge />);
    expect(container).toBeEmptyDOMElement();
  });

  it('score NaN → tidak render (interpretConfidence null-safe)', () => {
    const { container } = render(<AiConfidenceBadge score={Number.NaN} />);
    expect(container).toBeEmptyDOMElement();
  });

  it('hidePercent → tanpa angka persen, label tetap', () => {
    render(<AiConfidenceBadge score={0.85} hidePercent />); // 0.85 → "Yakin"
    expect(screen.getByText('Yakin')).toBeInTheDocument();
    expect(screen.queryByText('85%')).toBeNull();
  });
});

describe('AiConfidenceBadge — penjelasan (showExplanation)', () => {
  it('klik tombol info → penjelasan interpretasi muncul; klik lagi → tertutup', () => {
    render(<AiConfidenceBadge score={0.3} showExplanation />);
    const info = screen.getByRole('button', { name: 'Penjelasan confidence' });
    expect(screen.queryByText(/memerlukan verifikasi manual/i)).toBeNull();
    fireEvent.click(info);
    expect(screen.getByText(/memerlukan verifikasi manual/i)).toBeInTheDocument();
    fireEvent.click(info);
    expect(screen.queryByText(/memerlukan verifikasi manual/i)).toBeNull();
  });

  it('tanpa showExplanation → tanpa tombol info', () => {
    render(<AiConfidenceBadge score={0.3} />);
    expect(screen.queryByRole('button', { name: 'Penjelasan confidence' })).toBeNull();
  });
});
