/**
 * Unit test: dedup telemetry anti-double-count (audit P10.2 — StrictMode).
 *
 * Mengunci perilaku guard ref sekali-per-mount di 3 komponen yang mem-fetch
 * telemetry saat render:
 *   - AiHubPage        : ai_hub_view + ai_result_shown feature-level
 *                        (insight/health/simulation) → fire TEPAT SEKALI per
 *                        mount (StrictMode dev double-mount tidak menginflasi).
 *   - TimelineSection  : ai_result_shown/recommendation_shown per item → fire
 *                        sekali per item per mount; filter berganti & pagination
 *                        TIDAK re-fire item yang sudah tampil; item baru fire.
 *   - AiTimelinePage   : sama (guard trackedIdsRef persisten lintas filter).
 *   - ConversationAnswer: ai_result_shown conversation → sekali per mount.
 *
 * Semantik (dokumentasi P10.2e): remount = exposure baru yang SAH → fire ulang.
 *
 * Pola test: @testing-library/react + jest-dom dengan environment happy-dom
 * (ditetapkan di level PROJECT `unit-dom` di vitest.config.ts — bukan docblock
 * per-file; jest-dom matcher + afterEach(cleanup) via setup project
 * tests/unit/setup.ts). Service modules di-mock penuh; recharts di-stub agar
 * ResponsiveContainer tidak butuh ResizeObserver (env DOM).
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { StrictMode, type ReactNode } from 'react';
import { MemoryRouter } from 'react-router-dom';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import AiHubPage from '../../src/features/ai-product/AiHubPage';
import AiTimelinePage from '../../src/features/ai-product/timeline/AiTimelinePage';
import ConversationAnswer from '../../src/features/ai-product/chat/ConversationAnswer';
import {
  trackAiProductEvent,
  listTimeline,
  listMemory,
  addTimelineEntry,
  getTimelineEvent,
  updateTimelineStatus,
  type TimelineRecord,
  type TimelineDetail,
} from '../../src/services/aiProductService';
import { getCurrentMonth, getCurrentYear } from '../../src/lib/utils';
import type { ConversationAnswer as ConversationAnswerData } from '../../src/services/conversationService';

// ── Mocks (hoisted) ──────────────────────────────────────────────────────────

vi.mock('../../src/services/aiProductService', () => ({
  listTimeline: vi.fn(),
  getTimelineEvent: vi.fn(),
  updateTimelineStatus: vi.fn(),
  addTimelineEntry: vi.fn(),
  listMemory: vi.fn(),
  upsertMemory: vi.fn(),
  updateMemory: vi.fn(),
  deleteMemory: vi.fn(),
  // Wajib resolve Promise — komponen meng-chain .catch() (fire-and-forget).
  trackAiProductEvent: vi.fn().mockResolvedValue(undefined),
  submitFeedback: vi.fn().mockResolvedValue({ id: 'fb' }),
  listFeedback: vi.fn().mockResolvedValue([]),
}));

// authUser ter-set agar AiHubPage memuat data penuh (bukan EmptyState) dan
// Header merender ProfileDropdown (tidak ada efek jaringan saat mount).
//
// PENTING (2026-08-09 — fix flake 60%): objek authUser HARUS identity-stable
// lintas render, persis perilaku zustand asli. Jika dibuat literal inline per
// pemanggilan selector, setiapa render menghasilkan referensi authUser BARU →
// loadData (useCallback([authUser])) berganti identitas → useEffect AiHubPage
// jalan ulang → setLoading(true) → skeleton → TimelineSection REMOUNT dengan
// trackedIdsRef baru (kosong) → telemetry item ai_result_shown/recommendation_shown
// fire ULANG 2-3× (remount loop, bukan StrictMode double-effect). Test jadi
// flaky bergantung timing; konstanta modul menutup loop itu.
const STABLE_AUTH_USER = { uid: 'user-1', id: 'user-1', email: 'demo@cashflow.test', displayName: 'Dafa', photoURL: null };

vi.mock('../../src/store/useAuthStore', () => ({
  useAuthStore: (selector: (s: unknown) => unknown) =>
    selector({
      authUser: STABLE_AUTH_USER,
      logout: vi.fn(),
      setLogoutAnimationActive: vi.fn(),
      logoutAnimationActive: false,
    }),
}));

// Callback listener WAJIB async (queueMicrotask) — fetchOnce di AiHubPage
// mereferensikan `unsub` (TDZ) dari dalam callback; pemanggilan sinkron akan
// melempar ReferenceError. Listener asli juga mengirim data async.
const deliverAsync = (cb: (data: unknown[]) => void, data: unknown[]) => {
  queueMicrotask(() => cb(data));
  return () => {};
};

// Migrasi 2026-08-09: AiHubPage memakai getAllTransactions (windowless-complete),
// BUKAN listenToTransactions (50 baris) — mock menyesuaikan. Fixture dibungkus
// vi.hoisted (factory vi.mock di-hoist ke atas deklarasi const → TDZ tanpa ini).
const { TX_FIXTURES } = vi.hoisted(() => ({
  TX_FIXTURES: [
    { id: 'tx-1', type: 'income', amount: 5000000, categoryId: 'c1', categoryName: 'Gaji', merchant: '', date: '2026-08-01' },
    { id: 'tx-2', type: 'expense', amount: 1200000, categoryId: 'c2', categoryName: 'Makanan', merchant: 'GoFood', date: '2026-08-03' },
  ],
}));

vi.mock('../../src/services/transactionService', () => ({
  getAllTransactions: vi.fn().mockResolvedValue(TX_FIXTURES),
}));

vi.mock('../../src/services/budgetService', () => ({
  listenToBudgets: vi.fn((_uid: string, cb: (data: unknown[]) => void) => deliverAsync(cb, [])),
}));

vi.mock('../../src/services/professionalSuiteService', () => ({
  getWalletAccounts: vi.fn().mockResolvedValue([]),
  getSavingGoals: vi.fn().mockResolvedValue([]),
  getSubscriptions: vi.fn().mockResolvedValue([]),
}));

// Recharts stub — ConversationAnswer memakai ResponsiveContainer yang butuh
// ResizeObserver (disediakan happy-dom, TAPI stub tetap dipakai untuk render
// deterministik tanpa pengukuran layout). Stub murni presentasi.
vi.mock('recharts', () => {
  const make = () => () => <div />;
  return {
    Bar: make(),
    BarChart: make(),
    CartesianGrid: make(),
    Legend: make(),
    ResponsiveContainer: make(),
    Tooltip: make(),
    XAxis: make(),
    YAxis: make(),
  };
});

// ── Fixtures ─────────────────────────────────────────────────────────────────

const month = getCurrentMonth();
const year = getCurrentYear();
const monthStr = `${year}-${String(month).padStart(2, '0')}`;

const EV_INSIGHT: TimelineRecord = {
  id: 'ev-insight',
  feature: 'insight',
  event_type: 'insight',
  status: 'new',
  title: 'Insight A',
  body: 'Pengeluaran naik',
  created_at: `${monthStr}-09T01:00:00Z`,
};

const EV_RECO: TimelineRecord = {
  id: 'ev-reco',
  feature: 'advisor',
  event_type: 'recommendation',
  status: 'new',
  title: 'Rekomendasi B',
  body: 'Kurangi GoFood',
  confidence: 0.8,
  created_at: `${monthStr}-08T01:00:00Z`,
};

const EV_NEW: TimelineRecord = {
  id: 'ev-new',
  feature: 'advisor',
  event_type: 'recommendation',
  status: 'new',
  title: 'Rekomendasi Baru',
  body: 'Tabung 500rb',
  created_at: `${monthStr}-07T01:00:00Z`,
};

const CHAT_ANSWER = {
  period: { days: 7, label: '7 hari terakhir', startDate: `${monthStr}-01`, endDate: `${monthStr}-07` },
  stats: { income: 0, expense: 0, net: 0, transactionCount: 0, incomeDeltaPct: null, expenseDeltaPct: null },
  narrative: { summary: 'Ringkasan', insights: [], recommendations: [] },
  chart: { daily: [] },
  categories: [],
  topMerchants: [],
  topTransactions: [],
  trust: undefined,
} as unknown as ConversationAnswerData;

// ── Helpers ──────────────────────────────────────────────────────────────────

const trackCalls = () => vi.mocked(trackAiProductEvent).mock.calls;
const callsFor = (event: string) => trackCalls().filter((c) => c[0] === event);

/** Mount dengan StrictMode (meniru dev double-effect) + Router (Header merender
 * ProfileDropdown yang memakai useNavigate — butuh konteks react-router). */
function renderStrict(node: ReactNode) {
  return render(
    <StrictMode>
      <MemoryRouter>{node}</MemoryRouter>
    </StrictMode>,
  );
}

// cleanup per test otomatis via setup project (tests/unit/setup.ts).
beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(listTimeline).mockResolvedValue({ items: [EV_INSIGHT, EV_RECO], hasMore: false });
  vi.mocked(listMemory).mockResolvedValue([]);
  vi.mocked(addTimelineEntry).mockResolvedValue({ id: 'seeded' });
  vi.mocked(getTimelineEvent).mockResolvedValue({
    ...EV_RECO,
    feedback: [],
  } as TimelineDetail);
  vi.mocked(updateTimelineStatus).mockResolvedValue({ success: true, status: 'viewed' });
});

// ── AiHubPage ────────────────────────────────────────────────────────────────

describe('AiHubPage — guard telemetry sekali-per-mount', () => {
  it('StrictMode double-mount → ai_hub_view + ai_result_shown feature-level fire TEPAT SEKALI', async () => {
    renderStrict(<AiHubPage />);
    // Hero penuh (bukan EmptyState) → loadData selesai.
    await screen.findByText('Dashboard keuangan cerdas kamu');

    // Self-verifikasi: StrictMode double-mount BENAR-BENAR terjadi (Timeline-
    // Section effect jalan 2×) — kalau environment berhenti double-invoke,
    // seluruh asersi dedup di bawah jadi vakum, jadi ini diverifikasi eksplisit.
    await waitFor(() => expect(vi.mocked(listTimeline)).toHaveBeenCalledTimes(2));

    expect(callsFor('ai_hub_view')).toHaveLength(1);

    // Feature-level ai_result_shown (tanpa itemId) — sekali per feature.
    for (const feature of ['insight', 'health', 'simulation']) {
      const featureCalls = callsFor('ai_result_shown').filter(
        (c) => c[1]?.feature === feature && c[1]?.itemId === undefined,
      );
      expect(featureCalls).toHaveLength(1);
    }

    // Item-level dari TimelineSection — sekali per item (StrictMode double-load).
    // Effect TimelineSection menyala beberapa microtask SETELAH hero render —
    // tunggu sampai telemetry item mendarat (pola waitFor, bukan hard assert).
    await waitFor(() => {
      expect(callsFor('ai_result_shown').filter((c) => typeof c[1]?.itemId === 'string')).toHaveLength(2);
    });
    const shownByItem = callsFor('ai_result_shown').filter((c) => typeof c[1]?.itemId === 'string');
    expect(shownByItem.filter((c) => c[1]?.itemId === EV_INSIGHT.id)).toHaveLength(1);
    expect(shownByItem.filter((c) => c[1]?.itemId === EV_RECO.id)).toHaveLength(1);

    // recommendation_shown hanya untuk item recommendation — sekali.
    expect(callsFor('recommendation_shown')).toHaveLength(1);
    expect(callsFor('recommendation_shown')[0][1]?.itemId).toBe(EV_RECO.id);
  });

  it('remount → exposure baru yang SAH (fire ulang, bukan sekali global)', async () => {
    const first = renderStrict(<AiHubPage />);
    await screen.findByText('Dashboard keuangan cerdas kamu');
    expect(callsFor('ai_hub_view')).toHaveLength(1);

    first.unmount();
    renderStrict(<AiHubPage />);
    await screen.findByText('Dashboard keuangan cerdas kamu');

    // 2 mount terpisah → 2 exposure (bukan 1, bukan 4).
    expect(callsFor('ai_hub_view')).toHaveLength(2);
    expect(callsFor('ai_result_shown').filter((c) => c[1]?.feature === 'insight' && c[1]?.itemId === undefined)).toHaveLength(2);
  });
});

// ── AiTimelinePage ───────────────────────────────────────────────────────────

describe('AiTimelinePage — dedup lintas StrictMode/filter/pagination', () => {
  it('StrictMode double-mount → fire sekali per item; filter berganti TIDAK re-fire item yang sudah tampil', async () => {
    renderStrict(<AiTimelinePage />);
    await screen.findByText('Insight A');

    // Self-verifikasi StrictMode double-mount: effect load(true) jalan 2×.
    expect(vi.mocked(listTimeline)).toHaveBeenCalledTimes(2);

    // Double-mount → listTimeline dipanggil 2×, tapi item fire sekali.
    expect(callsFor('ai_result_shown')).toHaveLength(2);
    expect(callsFor('ai_result_shown').filter((c) => c[1]?.itemId === EV_INSIGHT.id)).toHaveLength(1);
    expect(callsFor('ai_result_shown').filter((c) => c[1]?.itemId === EV_RECO.id)).toHaveLength(1);
    expect(callsFor('recommendation_shown')).toHaveLength(1);

    // Ganti filter → load(true) lagi (listTimeline dipanggil dengan eventType)
    // → item yang sama TIDAK re-fire (guard persisten lintas filter).
    fireEvent.click(screen.getByRole('button', { name: 'Insights' }));
    await waitFor(() => {
      expect(vi.mocked(listTimeline)).toHaveBeenLastCalledWith(
        expect.objectContaining({ eventType: 'insight' }),
      );
    });
    expect(callsFor('ai_result_shown')).toHaveLength(2);
    expect(callsFor('recommendation_shown')).toHaveLength(1);
  });

  it('pagination "Muat lebih" → item BARU fire; item lama TIDAK re-fire', async () => {
    vi.mocked(listTimeline).mockImplementation(async (opts) => {
      if (opts?.before) return { items: [EV_NEW], hasMore: false };
      return { items: [EV_INSIGHT, EV_RECO], hasMore: true };
    });

    renderStrict(<AiTimelinePage />);
    await screen.findByText('Insight A');
    // StrictMode double-mount → 2× panggilan awal; Muat lebih menambah 1.
    expect(vi.mocked(listTimeline)).toHaveBeenCalledTimes(2);
    expect(callsFor('ai_result_shown')).toHaveLength(2);

    fireEvent.click(screen.getByRole('button', { name: /Muat lebih/ }));
    await screen.findByText('Rekomendasi Baru');
    expect(vi.mocked(listTimeline)).toHaveBeenCalledTimes(3);

    // ev-new (recommendation) fire ai_result_shown + recommendation_shown;
    // ev-insight/ev-reco TIDAK dihitung ulang.
    expect(callsFor('ai_result_shown')).toHaveLength(3);
    expect(callsFor('ai_result_shown').filter((c) => c[1]?.itemId === EV_NEW.id)).toHaveLength(1);
    expect(callsFor('ai_result_shown').filter((c) => c[1]?.itemId === EV_INSIGHT.id)).toHaveLength(1);
    expect(callsFor('ai_result_shown').filter((c) => c[1]?.itemId === EV_RECO.id)).toHaveLength(1);
    expect(callsFor('recommendation_shown')).toHaveLength(2); // ev-reco + ev-new
  });

  it('remount → item fire ulang (exposure baru per page view)', async () => {
    const first = renderStrict(<AiTimelinePage />);
    await screen.findByText('Insight A');
    expect(callsFor('ai_result_shown')).toHaveLength(2);

    first.unmount();
    renderStrict(<AiTimelinePage />);
    await screen.findByText('Insight A');

    expect(callsFor('ai_result_shown')).toHaveLength(4);
    expect(callsFor('ai_result_shown').filter((c) => c[1]?.itemId === EV_INSIGHT.id)).toHaveLength(2);
  });

  it('response STALE (load lama tiba belakangan) TIDAK menimpa state request terbaru', async () => {
    // Race nyata (ditemukan e2e/ai-status-machine): StrictMode double-mount
    // memicu load() 2× (filter 'all'); response PERTAMA yang LAMBAT bisa tiba
    // SETELAH response kedua → tanpa guard, data basi menimpa list. Lebih parah:
    // response basi yang tiba setelah optimistic update status (tombol Selesai)
    // menimpa 'completed' kembali ke 'new' — tombol aksi muncul lagi walau PATCH
    // sukses. Guard loadSeqRef harus membuang response yang bukan request terbaru.
    let resolveStale!: (v: { items: TimelineRecord[]; hasMore: boolean }) => void;
    const staleGate = new Promise<{ items: TimelineRecord[]; hasMore: boolean }>((res) => {
      resolveStale = res;
    });
    const STALE: TimelineRecord = {
      id: 'ev-stale',
      feature: 'insight',
      event_type: 'insight',
      status: 'new',
      title: 'Event Basi',
      body: 'Data lama dari response pertama',
      created_at: `${monthStr}-06T01:00:00Z`,
    };
    // Call 1 (seq 1) = lambat; call 2 (seq 2) = cepat dengan data benar.
    let callNo = 0;
    vi.mocked(listTimeline).mockImplementation(async () => {
      callNo += 1;
      return callNo === 1 ? staleGate : { items: [EV_INSIGHT, EV_RECO], hasMore: false };
    });

    renderStrict(<AiTimelinePage />);
    await screen.findByText('Insight A');
    // Response terbaru sudah diterapkan — data basi BELUM boleh muncul.
    expect(screen.queryByText('Event Basi')).toBeNull();

    // Response basi (seq 1) tiba belakangan → HARUS dibuang oleh guard.
    resolveStale({ items: [STALE], hasMore: false });
    await waitFor(() => expect(vi.mocked(listTimeline)).toHaveBeenCalledTimes(2));
    await new Promise((r) => setTimeout(r, 20)); // beri kesempatan setState stale bila ada bug

    expect(screen.queryByText('Event Basi')).toBeNull();
    expect(screen.getByText('Insight A')).toBeInTheDocument();
    expect(screen.getByText('Rekomendasi B')).toBeInTheDocument();
    // Telemetry TIDAK boleh fire untuk item basi (exposure yang tidak pernah tampil).
    expect(callsFor('ai_result_shown').filter((c) => c[1]?.itemId === 'ev-stale')).toHaveLength(0);
  });
});

// ── ConversationAnswer ───────────────────────────────────────────────────────

describe('ConversationAnswer — guard ai_result_shown conversation', () => {
  it('StrictMode double-mount → ai_result_shown conversation fire TEPAT SEKALI', async () => {
    renderStrict(<ConversationAnswer answer={CHAT_ANSWER} />);
    await waitFor(() => {
      expect(callsFor('ai_result_shown').length).toBeGreaterThan(0);
    });
    expect(callsFor('ai_result_shown')).toHaveLength(1);
    expect(callsFor('ai_result_shown')[0][1]?.feature).toBe('conversation');
  });

  it('remount (jawaban baru = instance baru) → fire ulang (exposure per jawaban)', async () => {
    const first = renderStrict(<ConversationAnswer answer={CHAT_ANSWER} />);
    await waitFor(() => expect(callsFor('ai_result_shown')).toHaveLength(1));
    first.unmount();

    renderStrict(<ConversationAnswer answer={CHAT_ANSWER} />);
    await waitFor(() => expect(callsFor('ai_result_shown')).toHaveLength(2));
    expect(callsFor('ai_result_shown').every((c) => c[1]?.feature === 'conversation')).toBe(true);
  });
});
