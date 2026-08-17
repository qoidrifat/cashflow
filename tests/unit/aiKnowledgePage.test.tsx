/**
 * Unit test: src/features/ai-knowledge/KnowledgeAssistantPage.tsx (P0.14)
 *
 * Project `unit-dom` (happy-dom + RTL + jest-dom; setup tests/unit/setup.ts).
 * Service knowledgeClient di-mock penuh — tanpa fetch nyata, tanpa kredensial.
 *
 * Kontrak yang di-lock (P0.14 UX):
 *   1. Config server `enabled:false` → state "Fitur AI Knowledge belum
 *      diaktifkan" dirender; input pertanyaan TIDAK dirender.
 *   2. Config `enabled:true` → input + suggested questions dirender.
 *   3. Ask sukses → jawaban grounded + daftar sumber (title/section) tampil.
 *   4. Ask noInfo (ok, tanpa jawaban) → pesan "belum tersedia dalam knowledge
 *      base CashFlow." — anti-hallucination, bukan error.
 *   5. Ask gagal (ok:false, code UNAVAILABLE) → state "tidak tersedia" +
 *      tombol "Coba lagi" (graceful fallback).
 *   6. Query < 2 karakter → askCashflowKnowledge TIDAK dipanggil.
 *   7. Loading: saat ask in-flight, tombol Tanyakan disabled + teks loading.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import KnowledgeAssistantPage from '../../src/features/ai-knowledge/KnowledgeAssistantPage';
import { askCashflowKnowledge, fetchKnowledgeConfig } from '../../src/features/ai-knowledge/services/knowledgeClient';

// ── Mock (hoisted) ──────────────────────────────────────────────────────────

vi.mock('../../src/features/ai-knowledge/services/knowledgeClient', () => ({
  fetchKnowledgeConfig: vi.fn(),
  askCashflowKnowledge: vi.fn(),
  DEFAULT_SUGGESTED_QUESTIONS: [
    'Bagaimana cara menambahkan wallet?',
    'Apa saja fitur AI di CashFlow?',
    'Bagaimana cara mengaktifkan sync Gmail?',
    'Bagaimana cara mengekspor data akun?',
  ],
}));

const mockConfig = () => vi.mocked(fetchKnowledgeConfig);
const mockAsk = () => vi.mocked(askCashflowKnowledge);

beforeEach(() => {
  vi.clearAllMocks();
  mockConfig().mockResolvedValue({ enabled: false });
  mockAsk().mockResolvedValue({
    ok: true,
    answer: 'Untuk menambahkan wallet, buka halaman Wallet lalu pilih Tambah Akun.',
    sources: [{ title: 'Cara Menambahkan Wallet', section: 'Wallet' }],
  });
});

// ── Render & config gating ──────────────────────────────────────────────────

describe('KnowledgeAssistantPage — gating config server', () => {
  it('config enabled:false → state "belum diaktifkan", input TIDAK dirender', async () => {
    mockConfig().mockResolvedValue({ enabled: false });
    render(<KnowledgeAssistantPage />);

    await screen.findByText('Fitur AI Knowledge belum diaktifkan');
    expect(screen.queryByRole('textbox')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Tanyakan' })).not.toBeInTheDocument();
  });

  it('config enabled:true → input + tombol Tanyakan + suggested questions dirender', async () => {
    mockConfig().mockResolvedValue({ enabled: true, service: 'agent_search', dataStoreConfigured: true });
    render(<KnowledgeAssistantPage />);

    await waitFor(() => expect(screen.getByRole('textbox')).toBeInTheDocument());
    expect(screen.getByRole('button', { name: 'Tanyakan' })).toBeInTheDocument();
    expect(screen.getByText('Coba tanyakan')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Bagaimana cara menambahkan wallet?' })).toBeInTheDocument();
  });

  it('config fetch gagal (server tidak merespons) → fail-closed: state belum aktif', async () => {
    mockConfig().mockRejectedValue(new Error('network down'));
    render(<KnowledgeAssistantPage />);

    await screen.findByText('Fitur AI Knowledge belum diaktifkan');
    expect(screen.queryByRole('textbox')).not.toBeInTheDocument();
  });
});

// ── Ask flow ────────────────────────────────────────────────────────────────

describe('KnowledgeAssistantPage — grounded answer', () => {
  beforeEach(() => {
    mockConfig().mockResolvedValue({ enabled: true });
  });

  it('ask sukses → jawaban grounded + sumber (title/section) tampil', async () => {
    render(<KnowledgeAssistantPage />);
    await waitFor(() => expect(screen.getByRole('textbox')).toBeInTheDocument());

    fireEvent.change(screen.getByRole('textbox'), { target: { value: 'bagaimana menambahkan wallet?' } });
    fireEvent.click(screen.getByRole('button', { name: 'Tanyakan' }));

    await screen.findByText('Untuk menambahkan wallet, buka halaman Wallet lalu pilih Tambah Akun.');
    expect(mockAsk()).toHaveBeenCalledWith('bagaimana menambahkan wallet?');
    expect(screen.getByText('Sumber')).toBeInTheDocument();
    expect(screen.getByText('Cara Menambahkan Wallet')).toBeInTheDocument();
    expect(screen.getByText('Wallet')).toBeInTheDocument();
  });

  it('suggested question diklik → query terisi & ask langsung dijalankan', async () => {
    mockAsk().mockResolvedValue({ ok: true, answer: 'Fitur AI: advisor, insight, timeline, memory.', sources: [] });
    render(<KnowledgeAssistantPage />);
    await waitFor(() => expect(screen.getByRole('textbox')).toBeInTheDocument());

    fireEvent.click(screen.getByRole('button', { name: 'Apa saja fitur AI di CashFlow?' }));

    await screen.findByText('Fitur AI: advisor, insight, timeline, memory.');
    expect(mockAsk()).toHaveBeenCalledWith('Apa saja fitur AI di CashFlow?');
  });

  it('noInfo (ok tanpa jawaban) → pesan anti-hallucination, bukan error', async () => {
    mockAsk().mockResolvedValue({
      ok: true,
      noInfo: true,
      message: 'Informasi tersebut belum tersedia dalam knowledge base CashFlow.',
      sources: [],
    });
    render(<KnowledgeAssistantPage />);
    await waitFor(() => expect(screen.getByRole('textbox')).toBeInTheDocument());

    fireEvent.change(screen.getByRole('textbox'), { target: { value: 'hal yang tidak ada' } });
    fireEvent.click(screen.getByRole('button', { name: 'Tanyakan' }));

    await screen.findByText('Informasi tersebut belum tersedia dalam knowledge base CashFlow.');
    expect(screen.getByText('Belum ada jawaban di knowledge base')).toBeInTheDocument();
  });

  it('gagal (ok:false, UNAVAILABLE) → state tidak tersedia + tombol Coba lagi', async () => {
    mockAsk().mockResolvedValue({
      ok: false,
      code: 'GOOGLE_AGENT_PLATFORM_UNAVAILABLE',
      message: 'AI knowledge service temporarily unavailable',
      statusCode: 503,
    });
    render(<KnowledgeAssistantPage />);
    await waitFor(() => expect(screen.getByRole('textbox')).toBeInTheDocument());

    fireEvent.change(screen.getByRole('textbox'), { target: { value: 'fitur cashflow' } });
    fireEvent.click(screen.getByRole('button', { name: 'Tanyakan' }));

    await screen.findByText('AI knowledge service tidak tersedia');
    expect(screen.getByRole('button', { name: 'Coba lagi' })).toBeInTheDocument();
  });

  it('query < 2 karakter → askCashflowKnowledge TIDAK dipanggil', async () => {
    render(<KnowledgeAssistantPage />);
    await waitFor(() => expect(screen.getByRole('textbox')).toBeInTheDocument());

    fireEvent.change(screen.getByRole('textbox'), { target: { value: 'a' } });
    fireEvent.click(screen.getByRole('button', { name: 'Tanyakan' }));

    expect(mockAsk()).not.toHaveBeenCalled();
  });

  it('loading: saat ask in-flight tombol disabled + teks loading tampil', async () => {
    let resolveFn!: (v: Awaited<ReturnType<typeof askCashflowKnowledge>>) => void;
    mockAsk().mockReturnValue(new Promise((res) => { resolveFn = res; }));
    render(<KnowledgeAssistantPage />);
    await waitFor(() => expect(screen.getByRole('textbox')).toBeInTheDocument());

    fireEvent.change(screen.getByRole('textbox'), { target: { value: 'fitur cashflow' } });
    fireEvent.click(screen.getByRole('button', { name: 'Tanyakan' }));

    expect(screen.getByRole('button', { name: 'Tanyakan' })).toBeDisabled();
    expect(screen.getByText('CashFlow sedang mencari jawaban dari knowledge base…')).toBeInTheDocument();

    resolveFn({ ok: true, answer: 'ok', sources: [] });
    await waitFor(() => expect(screen.queryByText('CashFlow sedang mencari jawaban dari knowledge base…')).not.toBeInTheDocument());
  });
});
