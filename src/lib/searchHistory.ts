/**
 * Search History — recent searches untuk AI Search (Sprint 1.4).
 * Pure helpers, diuji unit tanpa DOM/API. Persistensi localStorage
 * per-user (key menyertakan userId hash → tidak bocor antar akun).
 */

const STORAGE_PREFIX = 'cashflow:ai-search:recent:';
export const MAX_RECENT_SEARCHES = 8;

export interface RecentSearchEntry {
  query: string;
  tab: string;
  at: string; // ISO timestamp
}

function safeLocalStorage(): Storage | null {
  try {
    if (typeof window === 'undefined') return null;
    return window.localStorage;
  } catch {
    return null; // privacy mode / disabled storage
  }
}

/** Key per user — pakai id user (sudah non-PII identifier internal). */
function storageKey(userId: string | null | undefined): string {
  return `${STORAGE_PREFIX}${userId || 'anon'}`;
}

export function readRecentSearches(userId: string | null | undefined): RecentSearchEntry[] {
  const storage = safeLocalStorage();
  if (!storage) return [];
  try {
    const raw = storage.getItem(storageKey(userId));
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed
      .filter(
        (entry): entry is RecentSearchEntry =>
          Boolean(entry) &&
          typeof entry === 'object' &&
          typeof entry.query === 'string' &&
          typeof entry.tab === 'string' &&
          typeof entry.at === 'string',
      )
      .slice(0, MAX_RECENT_SEARCHES);
  } catch {
    return [];
  }
}

/**
 * Tambah pencarian ke riwayat. Normalisasi: query di-trim + collapse whitespace,
 * dedupe case-insensitive (entri lama dibuang, yang baru naik ke atas), cap 8.
 * Return array baru (immutable) — atau null bila storage tidak tersedia.
 */
export function addRecentSearch(
  userId: string | null | undefined,
  query: string,
  tab: string,
  now: Date = new Date(),
): RecentSearchEntry[] | null {
  const normalized = query.trim().replace(/\s+/g, ' ');
  if (normalized.length < 2) return readRecentSearches(userId);

  const entry: RecentSearchEntry = { query: normalized, tab, at: now.toISOString() };
  const withoutDuplicate = readRecentSearches(userId).filter(
    (existing) => existing.query.toLowerCase() !== normalized.toLowerCase(),
  );
  const updated = [entry, ...withoutDuplicate].slice(0, MAX_RECENT_SEARCHES);

  const storage = safeLocalStorage();
  if (!storage) return null;
  try {
    storage.setItem(storageKey(userId), JSON.stringify(updated));
    return updated;
  } catch {
    return null;
  }
}

export function clearRecentSearches(userId: string | null | undefined): void {
  const storage = safeLocalStorage();
  if (!storage) return;
  try {
    storage.removeItem(storageKey(userId));
  } catch {
    // ignore
  }
}
