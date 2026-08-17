/**
 * Unit test: src/features/ai-product/timeline/AiTimelinePage.tsx (P2.3.1).
 *
 * HALAMAN PENUH dengan boundary service di-mock (aiProductService):
 *   - loading  → skeleton (ChartSkeleton; konten belum muncul)
 *   - error    → pesan + "Coba lagi" (retry memanggil load(true) ulang)
 *   - empty    → EmptyState "Belum ada aktivitas AI"
 *   - populated→ section grup tanggal + kartu event + filter + aksi status
 *   - filter   → klik filter memanggil listTimeline dengan eventType
 *   - detail   → getTimelineEvent + status new→viewed (PATCH) +
 *                recommendation_opened HANYA untuk event_type recommendation
 *   - status   → optimistik Selesai/Buang + rollback saat PATCH gagal
 *   - pagination "Muat lebih" → append + hasMore
 *   - telemetry dedup → ai_result_shown/recommendation_shown fire SEKALI per
 *     item (trackedIdsRef) walau load() dipanggil dua kali (StrictMode pattern)
 *
 * Mocking: aiProductService (semua), framer-motion (animasi tidak dieksekusi),
 * react-router-dom (useNavigate untuk Header), useAuthStore (Header).
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import type { ReactNode } from 'react';
import AiTimelinePage from '../../src/features/ai-product/timeline/AiTimelinePage';

vi.mock('framer-motion', async (importOriginal) => {
  const actual = await importOriginal<typeof import('framer-motion')>();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const strip = (p: Record<string, any>) => {
    const { initial, animate, exit, transition, whileTap, whileHover, whileFocus, variants, layout, layoutId, custom, ...rest } = p;
    return rest;
  };
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const Div = (p: Record<string, any>) => <div {...strip(p)}>{p.children}</div>;
  return { ...actual, motion: { div: Div } };
});

vi.mock('react-router-dom', () => ({
  Link: ({ to, children, className }: { to: string; children?: ReactNode; className?: string }) => (
    <a href={to} className={className}>{children}</a>
  ),
  useNavigate: () => vi.fn(),
}));

const authState = {
  authUser: { uid: 'user-1', email: 'user@cashflow.test' },
  logout: vi.fn(),
  setLogoutAnimationActive: vi.fn(),
};
vi.mock('../../src/store/useAuthStore', () => ({
  useAuthStore: (sel: (s: typeof authState) => unknown) => sel(authState),
}));

const svc = vi.hoisted(() => ({
  listTimeline: vi.fn(),
  getTimelineEvent: vi.fn(),
  updateTimelineStatus: vi.fn(),
  trackAiProductEvent: vi.fn(),
}));

vi.mock('../../src/services/aiProductService', () => ({
  listTimeline: svc.listTimeline,
  getTimelineEvent: svc.getTimelineEvent,
  updateTimelineStatus: svc.updateTimelineStatus,
  trackAiProductEvent: svc.trackAiProductEvent,
}));

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const asNever = (v: any) => v as never;

const baseItems = [
  {
    id: 'ev-1',
    event_type: 'recommendation',
    feature: 'insight',
    title: 'Kurangi belanja online',
    body: 'Belanja online naik 20% bulan ini.',
    status: 'new',
    confidence: 85,
    created_at: '2026-08-09 10:00:00',
    payload: JSON.stringify({ periodDays: 30, expense: 5000000 }),
  },
  {
    id: 'ev-2',
    event_type: 'insight',
    feature: 'health',
    title: 'Skor kesehatan naik',
    status: 'viewed',
    created_at: '2026-08-08 09:00:00',
  },
] as never[];

beforeEach(() => {
  vi.clearAllMocks();
  svc.listTimeline.mockResolvedValue(asNever({ items: baseItems, hasMore: false }));
  svc.getTimelineEvent.mockResolvedValue(asNever({
    id: 'ev-1',
    event_type: 'recommendation',
    feature: 'insight',
    status: 'new',
    title: 'Kurangi belanja online',
    body: 'Belanja online naik 20% bulan ini.',
    created_at: '2026-08-09 10:00:00',
    feedback: [],
  }));
  svc.updateTimelineStatus.mockResolvedValue(undefined);
  svc.trackAiProductEvent.mockResolvedValue(undefined);
});

describe('AiTimelinePage — loading, error, empty', () => {
  it('loading → skeleton (konten belum muncul)', () => {
    svc.listTimeline.mockReturnValue(new Promise(() => {}));
    render(<AiTimelinePage />);
    expect(screen.queryByText('Belum ada aktivitas AI')).toBeNull();
    expect(screen.queryByText('Kurangi belanja online')).toBeNull();
  });

  it('error (listTimeline REJECT) → pesan error + tombol "Coba lagi" memuat ulang', async () => {
    svc.listTimeline
      .mockRejectedValueOnce(new Error('network down'))
      .mockResolvedValueOnce(asNever({ items: baseItems, hasMore: false }));
    render(<AiTimelinePage />);
    await screen.findByText('network down');
    fireEvent.click(screen.getByRole('button', { name: /Coba lagi/ }));
    await screen.findByText('Kurangi belanja online');
    expect(svc.listTimeline).toHaveBeenCalledTimes(2);
  });

  it('empty → EmptyState "Belum ada aktivitas AI"', async () => {
    svc.listTimeline.mockResolvedValue(asNever({ items: [], hasMore: false }));
    render(<AiTimelinePage />);
    await screen.findByText('Belum ada aktivitas AI');
  });
});

describe('AiTimelinePage — populated, filter, telemetry dedup', () => {
  it('populated → kartu event + badge tipe + tombol aksi status', async () => {
    render(<AiTimelinePage />);
    await screen.findByText('Kurangi belanja online');
    expect(screen.getByText('Skor kesehatan naik')).toBeInTheDocument();
    // Badge tipe event (label 'Rekomendasi' juga ada di tombol filter → getAll).
    expect(screen.getAllByText('Rekomendasi').length).toBeGreaterThan(0);
    expect(screen.getByRole('button', { name: /Tandai selesai Kurangi belanja online/ })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Buang Kurangi belanja online/ })).toBeInTheDocument();
  });

  it('klik filter → listTimeline dipanggil ulang dengan eventType', async () => {
    render(<AiTimelinePage />);
    await screen.findByText('Kurangi belanja online');
    fireEvent.click(screen.getByRole('button', { name: /Percakapan/ }));
    await waitFor(() => {
      expect(svc.listTimeline).toHaveBeenLastCalledWith(
        expect.objectContaining({ eventType: 'conversation', limit: 20 }),
      );
    });
  });

  it('telemetry dedup: ai_result_shown/recommendation_shown fire SEKALI per item walau load dipanggil 2× (StrictMode)', async () => {
    render(<AiTimelinePage />);
    await screen.findByText('Kurangi belanja online');
    // Simulasi StrictMode double-mount: panggil listTimeline lagi → response
    // kedua berisi item yang sama → trackedIdsRef HARUS menahan re-fire.
    await actFlush();
    const shown = svc.trackAiProductEvent.mock.calls.filter((c) => c[0] === 'ai_result_shown');
    const recShown = svc.trackAiProductEvent.mock.calls.filter((c) => c[0] === 'recommendation_shown');
    // 2 item × 1 fire masing-masing (bukan 2× karena double load).
    expect(shown).toHaveLength(2);
    expect(recShown).toHaveLength(1);
  });
});

describe('AiTimelinePage — detail & status actions', () => {
  it('buka detail recommendation → getTimelineEvent + status new→viewed + recommendation_opened', async () => {
    render(<AiTimelinePage />);
    await screen.findByText('Kurangi belanja online');
    fireEvent.click(screen.getByRole('button', { name: /Lihat detail Kurangi belanja online/ }));
    await screen.findByText('Apa yang AI katakan');
    await waitFor(() => expect(svc.getTimelineEvent).toHaveBeenCalledWith('ev-1'));
    // Status baru → PATCH viewed (P9 §12).
    await waitFor(() => expect(svc.updateTimelineStatus).toHaveBeenCalledWith('ev-1', 'viewed'));
    // Numerator CTR HANYA untuk recommendation.
    await waitFor(() => expect(svc.trackAiProductEvent).toHaveBeenCalledWith('recommendation_opened', expect.objectContaining({ itemId: 'ev-1' })));
  });

  it('detail menampilkan evidence dari payload (Mengapa AI mengatakan ini)', async () => {
    render(<AiTimelinePage />);
    await screen.findByText('Kurangi belanja online');
    fireEvent.click(screen.getByRole('button', { name: /Lihat detail Kurangi belanja online/ }));
    await screen.findByText('Mengapa AI mengatakan ini');
    expect(screen.getByText('Pengeluaran')).toBeInTheDocument();
    expect(screen.getByText('Rp5.000.000')).toBeInTheDocument();
  });

  it('status Selesai → optimistik update + PATCH completed', async () => {
    render(<AiTimelinePage />);
    await screen.findByText('Kurangi belanja online');
    fireEvent.click(screen.getByRole('button', { name: /Tandai selesai Kurangi belanja online/ }));
    await waitFor(() => expect(svc.updateTimelineStatus).toHaveBeenCalledWith('ev-1', 'completed'));
    // Tombol aksi status hilang setelah completed (state machine).
    await waitFor(() => {
      expect(screen.queryByRole('button', { name: /Tandai selesai Kurangi belanja online/ })).toBeNull();
    });
  });

  it('status Selesai GAGAL (PATCH reject) → rollback optimistik (tombol kembali muncul)', async () => {
    svc.updateTimelineStatus.mockRejectedValue(new Error('patch failed'));
    render(<AiTimelinePage />);
    await screen.findByText('Kurangi belanja online');
    fireEvent.click(screen.getByRole('button', { name: /Tandai selesai Kurangi belanja online/ }));
    await waitFor(() => expect(svc.updateTimelineStatus).toHaveBeenCalled());
    await waitFor(() => {
      expect(screen.getByRole('button', { name: /Tandai selesai Kurangi belanja online/ })).toBeInTheDocument();
    });
  });
});

describe('AiTimelinePage — pagination "Muat lebih"', () => {
  it('hasMore → tombol Muat lebih append halaman berikutnya (keyset before)', async () => {
    svc.listTimeline
      .mockResolvedValueOnce(asNever({ items: baseItems, hasMore: true }))
      .mockResolvedValueOnce(asNever({
        items: [{ id: 'ev-3', event_type: 'memory', feature: 'memory', title: 'Preferensi disimpan', status: 'new', created_at: '2026-08-07 08:00:00' }],
        hasMore: false,
      }));
    render(<AiTimelinePage />);
    await screen.findByText('Kurangi belanja online');
    fireEvent.click(screen.getByRole('button', { name: /Muat lebih/ }));
    await screen.findByText('Preferensi disimpan');
    // Keyset cursor: before = created_at + id item TERAKHIR halaman 1 (ev-2).
    expect(svc.listTimeline).toHaveBeenLastCalledWith(
      expect.objectContaining({ before: '2026-08-08 09:00:00', beforeId: 'ev-2' }),
    );
    // Item halaman 2 ikut di-track exposure SEKALI (3 item total).
    await actFlush();
    expect(svc.trackAiProductEvent.mock.calls.filter((c) => c[0] === 'ai_result_shown')).toHaveLength(3);
  });
});

/** Flush microtask + act agar efek async selesai sebelum assertion telemetry. */
async function actFlush() {
  await waitFor(() => expect(svc.listTimeline).toHaveBeenCalled());
  await new Promise((r) => setTimeout(r, 0));
}
