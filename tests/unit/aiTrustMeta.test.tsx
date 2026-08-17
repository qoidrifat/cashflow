/**
 * Unit test: src/features/ai-product/components/AiTrustMeta.tsx (P1.3).
 *
 * Kontrak yang di-lock (murni presentasi — tidak membuat confidence baru di
 * frontend; hanya menampilkan data ExplainabilityModel dari backend):
 *   - model undefined → null (tidak render)
 *   - model kosong → null
 *   - source 'gemini' → "Didukung Gemini AI" (tanpa fallback warning)
 *   - source 'rule-based' → "Aturan lokal (deterministik)" + fallback warning amber
 *   - source 'local' → "Diproses lokal" + fallback warning
 *   - model/dataCoverage/processingTimeMs/lastUpdated → item baris tampil
 *   - long text → tetap render (tidak crash)
 *   - evidence TIDAK dirender sebagai raw HTML (komponen hanya menampilkan
 *     teks polos; tidak ada dangerouslySetInnerHTML di komponen)
 */
import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import AiTrustMeta from '../../src/features/ai-product/components/AiTrustMeta';
import type { ExplainabilityModel } from '../../src/lib/explainability';

describe('AiTrustMeta — null-safe', () => {
  it('model undefined → tidak render apa pun', () => {
    const { container } = render(<AiTrustMeta />);
    expect(container).toBeEmptyDOMElement();
  });

  it('model kosong → tidak render apa pun', () => {
    const { container } = render(<AiTrustMeta model={{}} />);
    expect(container).toBeEmptyDOMElement();
  });
});

describe('AiTrustMeta — source & fallback', () => {
  it('source gemini → "Didukung Gemini AI", tanpa fallback warning', () => {
    render(<AiTrustMeta model={{ source: 'gemini' }} />);
    expect(screen.getByText('Didukung Gemini AI')).toBeInTheDocument();
    expect(screen.queryByText(/AI tidak tersedia/i)).toBeNull();
  });

  it('source rule-based → label + fallback warning (transparansi fallback)', () => {
    render(<AiTrustMeta model={{ source: 'rule-based' }} />);
    expect(screen.getByText('Aturan lokal (deterministik)')).toBeInTheDocument();
    expect(screen.getByText(/AI tidak tersedia saat ini/i)).toBeInTheDocument();
  });

  it('source local → "Diproses lokal" + fallback', () => {
    render(<AiTrustMeta model={{ source: 'local' }} />);
    expect(screen.getByText('Diproses lokal')).toBeInTheDocument();
    expect(screen.getByText(/Diproses lokal tanpa AI/i)).toBeInTheDocument();
  });
});

describe('AiTrustMeta — metadata lengkap & parsial', () => {
  const FULL: ExplainabilityModel = {
    source: 'gemini',
    model: 'gemini-2.5-flash',
    dataCoverage: '3 bulan transaksi',
    processingTimeMs: 400,
    lastUpdated: '2026-08-09T10:00:00Z',
    reason: 'Pengeluaran naik 12%',
    confidence: 0.85,
  };

  it('metadata lengkap → source, model, dataCoverage, processing, updated tampil', () => {
    render(<AiTrustMeta model={FULL} />);
    expect(screen.getByText('Didukung Gemini AI')).toBeInTheDocument();
    expect(screen.getByText('gemini-2.5-flash')).toBeInTheDocument();
    expect(screen.getByText('3 bulan transaksi')).toBeInTheDocument();
    expect(screen.getByText('400 ms')).toBeInTheDocument();
    expect(screen.getByText(/Diperbarui/)).toBeInTheDocument();
  });

  it('metadata parsial (hanya source) → hanya source tampil', () => {
    render(<AiTrustMeta model={{ source: 'gemini' }} />);
    expect(screen.getByText('Didukung Gemini AI')).toBeInTheDocument();
    expect(screen.queryByText(/Diperbarui/)).toBeNull();
    expect(screen.queryByText(/ms|dtk/)).toBeNull();
  });

  it('processingTimeMs < 1000 → format ms; >= 1000 → detik', () => {
    const { unmount } = render(<AiTrustMeta model={{ source: 'gemini', processingTimeMs: 1500 }} />);
    expect(screen.getByText('1.5 dtk')).toBeInTheDocument();
    unmount();
    render(<AiTrustMeta model={{ source: 'gemini', processingTimeMs: 250 }} />);
    expect(screen.getByText('250 ms')).toBeInTheDocument();
  });
});

describe('AiTrustMeta — confidence & long text', () => {
  it('confidence TIDAK dirender sebagai angka mentah (hanya interpretasi via komponen lain)', () => {
    render(<AiTrustMeta model={{ source: 'gemini', confidence: 0.85 }} />);
    // AiTrustMeta tidak menampilkan confidence — itu tanggung jawab
    // AiConfidenceBadge. Asersi: tidak ada angka persen yang bocor di sini.
    expect(screen.queryByText(/85%/)).toBeNull();
  });

  it('long text (reason/evidence panjang) → tetap render tanpa crash', () => {
    const longText = 'x'.repeat(5000);
    render(
      <AiTrustMeta
        model={{ source: 'rule-based', reason: longText, evidence: [longText, longText] }}
      />,
    );
    expect(screen.getByText(/AI tidak tersedia saat ini/i)).toBeInTheDocument();
  });

  it('evidence tidak pernah menjadi raw HTML (tidak ada dangerouslySetInnerHTML)', () => {
    const { container } = render(
      <AiTrustMeta model={{ source: 'gemini', evidence: ['<img src=x onerror=alert(1)>'] }} />,
    );
    // Jika evidence di-inject sebagai HTML, container akan berisi elemen <img>.
    expect(container.querySelector('img')).toBeNull();
  });
});
