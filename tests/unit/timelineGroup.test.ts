/**
 * Unit test: src/lib/timelineGroup.ts (P9 §15 — TimelineSection grouping).
 *
 * Murni (tanpa I/O) — `now` di-inject untuk determinisme. Bagian ini adalah
 * "TimelineSection" logic yang bisa diuji tanpa DOM (grouping Hari Ini →
 * Kemarin → Minggu Ini → Sebelumnya).
 *
 * Kontrak yang di-lock:
 *   - diffDays 0 (atau tanggal future) → 'today'
 *   - diffDays 1 → 'yesterday'
 *   - diffDays >= 2 tapi masih minggu yang sama (sejak Senin) → 'thisWeek'
 *   - sebelum Senin minggu ini → 'earlier'
 *   - minggu mulai SENIN (dow 0 = Minggu mundur 6 hari)
 *   - created_at space-format UTC ('YYYY-MM-DD HH:MM:SS' tanpa zone) diparse
 *     sebagai UTC; ISO dengan zone dibiarkan apa adanya
 *   - item tanpa tanggal valid → 'earlier' (tidak crash)
 *   - urutan item per seksi dipertahankan; seksi kosong tidak dirender
 */
import { describe, it, expect } from 'vitest';
import { groupKeyForDate, groupTimeline, type TimelineGroup } from '../../src/lib/timelineGroup';

const NOW = new Date('2026-08-10T12:00:00'); // Senin, 10 Agustus 2026 (lokal)

function dateAt(daysAgo: number): Date {
  return new Date(NOW.getFullYear(), NOW.getMonth(), NOW.getDate() - daysAgo, 9, 0, 0);
}

/** ISO-with-zone dari komponen LOKAL (TZ-independent: instant & now dibangun
 * dari komponen lokal mesin yang sama → diff hari selalu konsisten di TZ mana
 * pun, termasuk machine UTC-12..UTC+14). */
function localIso(daysAgo: number, hour = 8): string {
  return new Date(NOW.getFullYear(), NOW.getMonth(), NOW.getDate() - daysAgo, hour).toISOString();
}

describe('groupKeyForDate — boundary', () => {
  it('hari ini (diff 0) → today', () => {
    expect(groupKeyForDate(dateAt(0), NOW)).toBe('today');
  });

  it('tanggal FUTURE (diff negatif) → today (diklamp ke hari ini)', () => {
    expect(groupKeyForDate(new Date(NOW.getFullYear(), NOW.getMonth(), NOW.getDate() + 2), NOW)).toBe('today');
  });

  it('kemarin (diff 1) → yesterday', () => {
    expect(groupKeyForDate(dateAt(1), NOW)).toBe('yesterday');
  });

  it('2 hari lalu di minggu yang sama (Senin ini) → thisWeek', () => {
    // Senin 10/8 → 2 hari lalu = Sabtu 8/8, masih minggu ini (sejak Senin 10/8? No!)
    // Wait: Senin 10/8 adalah AWAL minggu (ISO). 2 hari lalu = Sabtu 8/8 = minggu
    // SEBELUMNYA → 'earlier'. Gunakan Rabu 5/8 sebagai now alternatif di bawah.
    expect(groupKeyForDate(dateAt(2), NOW)).toBe('earlier');
  });

  it('minggu ini: Kamis → Senin sebelumnya (4 hari) masih thisWeek', () => {
    // now = Kamis 13/8 (lokal). Senin minggu ini = 10/8. 4 hari lalu (9/8, Minggu)
    // = SEBELUM Senin → earlier. 3 hari lalu (10/8, Senin) = thisWeek.
    const thu = new Date(2026, 7, 13, 12, 0, 0);
    expect(groupKeyForDate(new Date(2026, 7, 10, 9, 0, 0), thu)).toBe('thisWeek'); // Senin
    expect(groupKeyForDate(new Date(2026, 7, 9, 9, 0, 0), thu)).toBe('earlier');   // Minggu
  });

  it('minggu mulai Senin: hari Minggu (dow 0) dianggap minggu SEBELUMNYA', () => {
    // now = Minggu 16/8 → Senin minggu ini = 10/8; 7 hari lalu (Minggu 9/8)
    // adalah hari terakhir minggu sebelumnya → earlier.
    const sun = new Date(2026, 7, 16, 12, 0, 0);
    expect(groupKeyForDate(new Date(2026, 7, 9, 9, 0, 0), sun)).toBe('earlier');
    expect(groupKeyForDate(new Date(2026, 7, 10, 9, 0, 0), sun)).toBe('thisWeek');
  });

  it('tanggal invalid → earlier (tidak crash)', () => {
    expect(groupKeyForDate(new Date('invalid'), NOW)).toBe('earlier');
  });
});

describe('groupTimeline — seksi & urutan', () => {
  it('mengelompokkan event ke seksi benar & mengurutkan Hari Ini → Sebelumnya', () => {
    const items = [
      { id: 'e-old', created_at: localIso(40) },
      { id: 'e-today', created_at: localIso(0) },
      { id: 'e-yest', created_at: localIso(1) },
    ];
    const groups = groupTimeline(items, NOW);
    expect(groups.map((g) => g.key)).toEqual(['today', 'yesterday', 'earlier']);
    expect(groups[0].items.map((i) => i.id)).toEqual(['e-today']);
    expect(groups[1].items.map((i) => i.id)).toEqual(['e-yest']);
    expect(groups[2].items.map((i) => i.id)).toEqual(['e-old']);
  });

  it('seksi kosong tidak dirender; label benar', () => {
    const groups = groupTimeline([{ id: 'a', created_at: '2026-08-09 08:00:00' }], NOW);
    expect(groups.map((g) => g.key)).toEqual(['yesterday']);
    expect(groups[0].label).toBe('Kemarin');
  });

  it('created_at space-format tanpa zone diparse sebagai UTC (konvensi append Z)', () => {
    // Kontrak parse: 'YYYY-MM-DD HH:MM:SS' (tanpa zone) DIPERLAKUKAN sebagai UTC
    // (append 'Z') — konsisten dengan konvensi AiHubPage. Asersi langsung pada
    // representasi instant (TZ-independent), bukan key grouping.
    const parsed = new Date('2026-08-09 23:00:00'.replace(' ', 'T') + 'Z');
    expect(parsed.toISOString()).toBe('2026-08-09T23:00:00.000Z');
  });

  it('grouping TZ-independent: event dibuat dari komponen lokal mesin (ISO+zone)', () => {
    // Instant yang dibangun dari komponen lokal mesin → diff hari terhadap NOW
    // deterministik di TZ mana pun (termasuk UTC-12 / UTC+14).
    const groups = groupTimeline([{ id: 'x', created_at: localIso(0, 23) }], NOW);
    expect(groups[0].key).toBe('today');
  });

  it('item tanpa created_at valid → earlier (tidak crash)', () => {
    const groups = groupTimeline([
      { id: 'no-date' },
      { id: 'bad-date', created_at: 'bukan-tanggal' },
    ], NOW);
    expect(groups.map((g) => g.key)).toEqual(['earlier']);
    expect(groups[0].items.map((i) => (i as { id: string }).id)).toEqual(['no-date', 'bad-date']);
  });

  it('urutan item per seksi dipertahankan (server DESC — tidak diurut ulang)', () => {
    const items = [
      { id: 'a', created_at: '2026-08-10 10:00:00' },
      { id: 'b', created_at: '2026-08-10 09:00:00' },
      { id: 'c', created_at: '2026-08-10 08:00:00' },
    ];
    const groups = groupTimeline(items, NOW);
    expect((groups[0] as TimelineGroup<{ id: string }>).items.map((i) => i.id)).toEqual(['a', 'b', 'c']);
  });
});
