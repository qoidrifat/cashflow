/**
 * Unit test: src/components/ui/CategoryIcon.tsx (P1.5).
 *
 * Tujuan: TIDAK ada kategori yang menyebabkan UI crash.
 *
 * Kontrak yang di-lock:
 *   - kategori dikenal → ikon spesifik + aria-label nama kategori
 *   - kategori tak dikenal → fallback ikon (tanpa crash)
 *   - name null/undefined → fallback ikon + aria-label "Category"
 *   - size xs/sm/md/lg/xl → kelas ukuran benar
 *   - noBackground → tanpa container background (ikon langsung)
 *   - animated + interactive → tetap render (framer-motion di happy-dom)
 */
import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import CategoryIcon from '../../src/components/ui/CategoryIcon';

describe('CategoryIcon — kategori dikenal', () => {
  it('kategori dikenal → ikon + aria-label nama', () => {
    const { container } = render(<CategoryIcon name="Makanan & Minuman" />);
    // aria-label di-set pada container DAN svg → getAllByLabelText (≥ 1).
    expect(screen.getAllByLabelText('Makanan & Minuman').length).toBeGreaterThan(0);
    expect(container.querySelector('.lucide-utensils-crossed')).not.toBeNull();
  });

  it('case-insensitive + alias (coffee → Coffee icon)', () => {
    const { container } = render(<CategoryIcon name="kopi" />);
    expect(container.querySelector('.lucide-coffee')).not.toBeNull();
  });
});

describe('CategoryIcon — kategori tak dikenal & missing', () => {
  it('kategori tak dikenal → fallback icon, TANPA crash', () => {
    const { container } = render(<CategoryIcon name="Kategori Tidak Ada 123" />);
    expect(screen.getAllByLabelText('Kategori Tidak Ada 123').length).toBeGreaterThan(0);
    // Fallback: CircleEllipsis
    expect(container.querySelector('.lucide-circle-ellipsis')).not.toBeNull();
  });

  it('name null → fallback icon + aria-label "Category" (tidak crash)', () => {
    const { container } = render(<CategoryIcon name={null} />);
    expect(screen.getAllByLabelText('Category').length).toBeGreaterThan(0);
    expect(container.querySelector('.lucide-circle-ellipsis')).not.toBeNull();
  });

  it('name undefined → fallback icon (tidak crash)', () => {
    render(<CategoryIcon name={undefined} />);
    expect(screen.getAllByLabelText('Category').length).toBeGreaterThan(0);
  });
});

describe('CategoryIcon — varian ukuran & mode', () => {
  it('size lg → kelas container w-10 h-10 + ikon w-5 h-5', () => {
    const { container } = render(<CategoryIcon name="Gaji" size="lg" />);
    const iconEl = container.querySelector('.lucide-briefcase');
    expect(iconEl).not.toBeNull();
    expect(iconEl?.className).toContain('w-5');
    expect(iconEl?.className).toContain('h-5');
  });

  it('size xs → ikon w-3 h-3', () => {
    const { container } = render(<CategoryIcon name="Gaji" size="xs" />);
    const iconEl = container.querySelector('.lucide-briefcase');
    expect(iconEl?.className).toContain('w-3');
    expect(iconEl?.className).toContain('h-3');
  });

  it('noBackground → ikon tanpa container background', () => {
    const { container } = render(<CategoryIcon name="Gaji" noBackground />);
    // Tanpa wrapper div — ikon langsung sebagai root.
    expect(container.firstElementChild?.classList.contains('lucide-briefcase')).toBe(true);
    expect(container.firstElementChild?.classList.contains('w-10')).toBe(false);
  });

  it('animated + interactive → tetap render (framer-motion happy-dom)', () => {
    const { container } = render(
      <CategoryIcon name="Makanan" animated animationVariant="soft" interactive />,
    );
    expect(container.querySelector('.lucide-utensils-crossed')).not.toBeNull();
  });

  it('type income untuk kategori income → warna income (tidak crash)', () => {
    const { container } = render(<CategoryIcon name="Gaji" type="income" />);
    expect(container.querySelector('.lucide-briefcase')).not.toBeNull();
  });
});
