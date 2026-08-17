/**
 * Unit test: src/features/ai-product/components/AiFeedbackButtons.tsx — komponen
 * interaktif AI (feedback loop). Mengikuti pola tests/unit/statCard.test.tsx:
 * @testing-library/react. Environment happy-dom ditetapkan di level PROJECT
 * `unit-dom` (vitest.config.ts), bukan docblock per-file; jest-dom matcher +
 * afterEach(cleanup) disediakan setup project (tests/unit/setup.ts) — file
 * test cukup import komponen + service mock.
 *
 * Kontrak yang di-lock:
 *   - Render awal: label "Feedback:" + tombol 👍 (aria-label "Membantu") dan
 *     👎 ("Tidak membantu"), keduanya enabled.
 *   - Klik 👍 → submitFeedback({ feature, itemId?, rating:'helpful' }) dipanggil
 *     TEPAT SEKALI dengan argumen benar; sukses → teks "Membantu — terima kasih!".
 *   - Klik 👎 → menu rating lanjutan (4 opsi) muncul; pilih opsi → form alasan
 *     opsional; "Kirim feedback" → submitFeedback({ rating:'mismatched', reason }).
 *   - State loading: saat POST in-flight, tombol 👍/👎 disabled + spinner Loader2.
 *   - Gagal → pesan error tampil, tombol kembali enabled (bisa retry).
 *   - Auto-reset: teks sukses hilang setelah ~4s (timer diset via setTimeout).
 *   - itemId diteruskan apa adanya; tanpa itemId → undefined (tidak dikirim).
 *
 * Service submitFeedback di-mock penuh (pola aiShownTelemetryDedup) — tidak ada
 * fetch nyata. Komponen ini murni (tidak butuh Router/StrictMode).
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor, act } from '@testing-library/react';
import AiFeedbackButtons from '../../src/features/ai-product/components/AiFeedbackButtons';
import { submitFeedback } from '../../src/services/aiProductService';

// ── Mock (hoisted) ──────────────────────────────────────────────────────────

vi.mock('../../src/services/aiProductService', () => ({
  submitFeedback: vi.fn(),
}));

const mockedSubmit = () => vi.mocked(submitFeedback);

// cleanup per test otomatis via setup project (tests/unit/setup.ts).
beforeEach(() => {
  vi.clearAllMocks();
  mockedSubmit().mockResolvedValue({ id: 'fb-1' });
});

// ── Helpers ──────────────────────────────────────────────────────────────────

const thumbsUp = () => screen.getByRole('button', { name: 'Membantu' });
const thumbsDown = () => screen.getByRole('button', { name: 'Tidak membantu' });

// ── Render ──────────────────────────────────────────────────────────────────

describe('AiFeedbackButtons — render', () => {
  it('menampilkan label Feedback + dua tombol (👍/👎) enabled', () => {
    render(<AiFeedbackButtons feature="insight" />);
    expect(screen.getByText('Feedback:')).toBeInTheDocument();
    expect(thumbsUp()).toBeEnabled();
    expect(thumbsDown()).toBeEnabled();
    // Spinner TIDAK tampil saat idle.
    expect(document.querySelector('.lucide-loader-2')).toBeNull();
  });

  it('ariaLabel diteruskan ke role=group', () => {
    render(<AiFeedbackButtons feature="insight" ariaLabel="Feedback kartu insight" />);
    expect(screen.getByRole('group', { name: 'Feedback kartu insight' })).toBeInTheDocument();
  });

  it('className diteruskan ke kontainer', () => {
    const { container } = render(<AiFeedbackButtons feature="insight" className="mt-2" />);
    expect(container.querySelector('.mt-2')).not.toBeNull();
  });
});

// ── Klik 👍 (helpful) ────────────────────────────────────────────────────────

describe('AiFeedbackButtons — klik 👍', () => {
  it('memanggil submitFeedback({ feature, rating:"helpful" }) tanpa itemId', async () => {
    render(<AiFeedbackButtons feature="insight" />);
    fireEvent.click(thumbsUp());

    await waitFor(() => expect(mockedSubmit()).toHaveBeenCalledTimes(1));
    expect(mockedSubmit()).toHaveBeenCalledWith({
      feature: 'insight',
      rating: 'helpful',
      itemId: undefined,
      reason: undefined,
    });
  });

  it('itemId diteruskan apa adanya', async () => {
    render(<AiFeedbackButtons feature="advisor" itemId="demo-tl-1" />);
    fireEvent.click(thumbsUp());

    await waitFor(() => expect(mockedSubmit()).toHaveBeenCalledTimes(1));
    expect(mockedSubmit()).toHaveBeenCalledWith({
      feature: 'advisor',
      itemId: 'demo-tl-1',
      rating: 'helpful',
      reason: undefined,
    });
  });

  it('sukses → teks konfirmasi tampil + tombol diganti konfirmasi', async () => {
    render(<AiFeedbackButtons feature="insight" />);
    fireEvent.click(thumbsUp());

    await screen.findByText('Membantu — terima kasih!');
    expect(screen.queryByRole('button', { name: 'Membantu' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Tidak membantu' })).not.toBeInTheDocument();
  });

  it('klik ganda cepat → hanya SATU POST (disabled saat in-flight)', async () => {
    let resolveFn!: (v: { id: string }) => void;
    mockedSubmit().mockReturnValue(new Promise((res) => { resolveFn = res; }));
    render(<AiFeedbackButtons feature="insight" />);

    const btn = thumbsUp();
    fireEvent.click(btn);
    // In-flight: tombol disabled (mekanisme guard — send() tidak punya guard
    // saving internal; perlindungan SATU-SATUNYA adalah atribut disabled, jadi
    // di-assert eksplisit supaya test self-documenting).
    expect(btn).toBeDisabled();
    fireEvent.click(btn);

    expect(mockedSubmit()).toHaveBeenCalledTimes(1);
    resolveFn({ id: 'fb-1' });
    await screen.findByText('Membantu — terima kasih!');
    expect(mockedSubmit()).toHaveBeenCalledTimes(1);
  });
});

// ── Loading state ───────────────────────────────────────────────────────────

describe('AiFeedbackButtons — state loading', () => {
  it('saat POST in-flight: tombol disabled + spinner Loader2 tampil', async () => {
    let resolveFn!: (v: { id: string }) => void;
    mockedSubmit().mockReturnValue(new Promise((res) => { resolveFn = res; }));
    render(<AiFeedbackButtons feature="insight" />);

    fireEvent.click(thumbsUp());

    // Disabled segera setelah klik (sebelum promise resolve).
    expect(thumbsUp()).toBeDisabled();
    expect(thumbsDown()).toBeDisabled();
    // lucide 1.21 merender Loader2 dengan class lucide-loader-circle
    // (bukan lucide-loader-2) — query ke class nyata hasil render.
    expect(document.querySelector('.lucide-loader-circle')).not.toBeNull();

    resolveFn({ id: 'fb-1' });
    await waitFor(() => expect(document.querySelector('.lucide-loader-circle')).toBeNull());
  });
});

// ── Klik 👎 + rating lanjutan ────────────────────────────────────────────────

describe('AiFeedbackButtons — klik 👎 & rating lanjutan', () => {
  it('klik 👎 membuka menu 4 opsi lanjutan', () => {
    render(<AiFeedbackButtons feature="insight" />);
    expect(screen.queryByText('Apa yang kurang?')).not.toBeInTheDocument();

    fireEvent.click(thumbsDown());
    expect(screen.getByText('Apa yang kurang?')).toBeInTheDocument();
    for (const label of ['Kurang sesuai', 'Tidak relevan', 'Sudah saya lakukan', 'Lewati']) {
      expect(screen.getByRole('button', { name: label })).toBeInTheDocument();
    }
  });

  it('pilih opsi → form alasan → Kirim → submitFeedback({ rating, reason })', async () => {
    render(<AiFeedbackButtons feature="insight" itemId="demo-tl-2" />);

    fireEvent.click(thumbsDown());
    fireEvent.click(screen.getByRole('button', { name: 'Kurang sesuai' }));

    // Form alasan opsional.
    expect(screen.getByLabelText('Alasan feedback')).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText('Alasan feedback'), { target: { value: 'Saran terlalu generik' } });
    fireEvent.click(screen.getByRole('button', { name: 'Kirim feedback' }));

    await waitFor(() => expect(mockedSubmit()).toHaveBeenCalledTimes(1));
    expect(mockedSubmit()).toHaveBeenCalledWith({
      feature: 'insight',
      itemId: 'demo-tl-2',
      rating: 'mismatched',
      reason: 'Saran terlalu generik',
    });
    await screen.findByText('Kurang sesuai — terima kasih!');
  });

  it('tombol Batal membatalkan form alasan tanpa POST', () => {
    render(<AiFeedbackButtons feature="insight" />);
    fireEvent.click(thumbsDown());
    fireEvent.click(screen.getByRole('button', { name: 'Tidak relevan' }));
    expect(screen.getByLabelText('Alasan feedback')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Batal' }));
    expect(screen.queryByLabelText('Alasan feedback')).not.toBeInTheDocument();
    expect(mockedSubmit()).not.toHaveBeenCalled();
  });

  it('rating skip dikirim tanpa alasan bila form dibiarkan kosong', async () => {
    render(<AiFeedbackButtons feature="simulation" />);
    fireEvent.click(thumbsDown());
    fireEvent.click(screen.getByRole('button', { name: 'Lewati' }));
    fireEvent.click(screen.getByRole('button', { name: 'Kirim feedback' }));

    await waitFor(() => expect(mockedSubmit()).toHaveBeenCalledTimes(1));
    expect(mockedSubmit()).toHaveBeenCalledWith({
      feature: 'simulation',
      rating: 'skip',
      itemId: undefined,
      reason: undefined,
    });
  });
});

// ── Error & retry ───────────────────────────────────────────────────────────

describe('AiFeedbackButtons — error & retry', () => {
  it('POST gagal → pesan error tampil + tombol kembali enabled (retry)', async () => {
    mockedSubmit().mockRejectedValueOnce(new Error('HTTP 500'));
    render(<AiFeedbackButtons feature="insight" />);

    fireEvent.click(thumbsUp());
    await screen.findByText('HTTP 500');

    // Bisa retry — tombol enabled kembali.
    expect(thumbsUp()).toBeEnabled();
    expect(mockedSubmit()).toHaveBeenCalledTimes(1);

    fireEvent.click(thumbsUp());
    await waitFor(() => expect(mockedSubmit()).toHaveBeenCalledTimes(2));
    await screen.findByText('Membantu — terima kasih!');
  });

  it('error tanpa Error instance → fallback pesan default', async () => {
    mockedSubmit().mockRejectedValueOnce('plain string');
    render(<AiFeedbackButtons feature="insight" />);
    fireEvent.click(thumbsUp());
    await screen.findByText('Gagal mengirim feedback');
  });
});

// ── Auto-reset konfirmasi ───────────────────────────────────────────────────

describe('AiFeedbackButtons — auto-reset', () => {
  it('teks sukses hilang setelah ~4 detik (timer setTimeout)', async () => {
    vi.useFakeTimers();
    try {
      render(<AiFeedbackButtons feature="insight" />);
      fireEvent.click(thumbsUp());
      // PROMISE submitFeedback resolve via microtask — flush dengan
      // advanceTimersByTimeAsync(0) (TIDAK memakai findByText: waitFor
      // polling memakai timer → deadlock di bawah fake timers).
      // act(): setSubmitted/setSaving terjadi dari callback timer/microtask
      // di luar event — dibungkus act agar deterministik & bebas warning.
      await act(async () => { await vi.advanceTimersByTimeAsync(0); });
      expect(screen.getByText('Membantu — terima kasih!')).toBeInTheDocument();

      // Sebelum 4s → konfirmasi masih tampil.
      await act(async () => { await vi.advanceTimersByTimeAsync(3000); });
      expect(screen.getByText('Membantu — terima kasih!')).toBeInTheDocument();

      // Setelah 4s → kembali ke tombol semula.
      await act(async () => { await vi.advanceTimersByTimeAsync(1500); });
      expect(screen.queryByText('Membantu — terima kasih!')).not.toBeInTheDocument();
      expect(thumbsUp()).toBeInTheDocument();
    } finally {
      vi.useRealTimers();
    }
  });

  it('unmount saat timer aktif tidak melempar (cleanup timer di effect)', async () => {
    vi.useFakeTimers();
    try {
      const { unmount } = render(<AiFeedbackButtons feature="insight" />);
      fireEvent.click(thumbsUp());
      await act(async () => { await vi.advanceTimersByTimeAsync(0); });
      unmount(); // timer masih pending → cleanup effect membatalkannya.
      await act(async () => { await vi.advanceTimersByTimeAsync(5000); }); // tidak boleh throw/act warning
    } finally {
      vi.useRealTimers();
    }
  });
});
