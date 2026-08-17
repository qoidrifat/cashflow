/**
 * Helper render bersama untuk komponen test (project `unit-dom`).
 *
 * Tujuan: komponen test berikutnya cukup import dari sini — pola renderCard /
 * valueElement dipusatkan di SATU tempat, bukan diduplikasi per file test.
 *
 * Infrastruktur yang TIDAK perlu di-import lagi di file test (disediakan
 * otomatis oleh setup project — `tests/unit/setup.ts`, didaftarkan via
 * `test.setupFiles` di project `unit-dom` vitest.config.ts):
 *   - jest-dom matchers (toBeInTheDocument, toHaveClass, ...)
 *   - afterEach(() => cleanup()) — unmount manual wajib karena vitest
 *     menonaktifkan globals (RTL tidak bisa auto-register).
 */
import { render } from '@testing-library/react';
import StatCard from '../../../src/components/ui/StatCard';

/** Render StatCard dengan default ("Total Saldo" / 1.500.000 / ikon test) +
 * overrides — pemanggil cukup override prop yang relevan per test. */
export function renderCard(overrides: Partial<Parameters<typeof StatCard>[0]> = {}) {
  return render(
    <StatCard
      title="Total Saldo"
      value={1500000}
      icon={<span data-testid="card-icon" />}
      {...overrides}
    />,
  );
}

/** Elemen <p> nilai StatCard (kelas text-xl) — kueri container-scoped,
 * deterministik. Melempar bila tidak ditemukan (assert di helper, bukan
 * expect di tiap test — pesan error eksplisit). */
export function valueElement(container: HTMLElement): HTMLElement {
  const el = container.querySelector('p.text-xl');
  if (!el) throw new Error('Nilai StatCard (p.text-xl) tidak ditemukan di container');
  return el as HTMLElement;
}
