/**
 * Timeline grouping (P9 §15) — pengelompokan kronologis event per tanggal:
 *   Hari Ini → Kemarin → Minggu Ini (sejak Senin) → Sebelumnya.
 * MURNI (tanpa I/O) — unit-testable. `now` di-inject untuk determinisme.
 */

export type TimelineGroupKey = 'today' | 'yesterday' | 'thisWeek' | 'earlier';

export interface TimelineGroup<T> {
  key: TimelineGroupKey;
  label: string;
  items: T[];
}

const GROUP_LABELS: Record<TimelineGroupKey, string> = {
  today: 'Hari Ini',
  yesterday: 'Kemarin',
  thisWeek: 'Minggu Ini',
  earlier: 'Sebelumnya',
};

/** Awal hari (00:00) untuk tanggal lokal. */
function startOfDay(d: Date): Date {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate());
}

/** Senin pada minggu `day` (ISO minggu mulai Senin). */
function startOfWeek(d: Date): Date {
  const day = startOfDay(d);
  const dow = day.getDay(); // 0 = Minggu
  const diff = dow === 0 ? 6 : dow - 1; // mundur ke Senin
  day.setDate(day.getDate() - diff);
  return day;
}

/** Key group untuk satu tanggal (lokal). */
export function groupKeyForDate(date: Date, now: Date): TimelineGroupKey {
  if (!(date instanceof Date) || Number.isNaN(date.getTime())) return 'earlier';
  const today = startOfDay(now);
  const target = startOfDay(date);

  const diffDays = Math.round((today.getTime() - target.getTime()) / 86_400_000);
  if (diffDays <= 0) return 'today'; // tanggal >= hari ini → Hari Ini
  if (diffDays === 1) return 'yesterday';
  if (target >= startOfWeek(today)) return 'thisWeek';
  return 'earlier';
}

/**
 * Parse created_at DB (UTC space-format 'YYYY-MM-DD HH:MM:SS' TANPA zone)
 * sebagai UTC — konsisten dengan konvensi AiHubPage (append 'Z'). ISO dengan
 * zone (Z/offset) dibiarkan apa adanya. Invalid → null.
 */
function parseTimelineDate(value: string): Date | null {
  const hasZone = /(Z|[+-]\d{2}:?\d{2})$/.test(value);
  const normalized = value.includes('T') ? value : value.replace(' ', 'T');
  const d = new Date(hasZone ? normalized : `${normalized}Z`);
  return Number.isNaN(d.getTime()) ? null : d;
}

/**
 * Kelompokkan event (dengan `created_at` string, format DB space-format atau
 * ISO) menjadi seksi terurut: Hari Ini → Kemarin → Minggu Ini → Sebelumnya.
 * Item tanpa tanggal valid masuk ke 'Sebelumnya'. Urutan item per seksi
 * dipertahankan (server sudah DESC).
 */
export function groupTimeline<T extends { created_at?: string }>(
  items: T[],
  now: Date = new Date(),
): Array<TimelineGroup<T>> {
  const sections: Array<TimelineGroup<T>> = [
    { key: 'today', label: GROUP_LABELS.today, items: [] },
    { key: 'yesterday', label: GROUP_LABELS.yesterday, items: [] },
    { key: 'thisWeek', label: GROUP_LABELS.thisWeek, items: [] },
    { key: 'earlier', label: GROUP_LABELS.earlier, items: [] },
  ];

  for (const item of items) {
    let date: Date | null = null;
    if (typeof item.created_at === 'string') {
      date = parseTimelineDate(item.created_at);
    }
    const key = date ? groupKeyForDate(date, now) : 'earlier';
    sections.find((s) => s.key === key)?.items.push(item);
  }

  return sections.filter((s) => s.items.length > 0);
}
