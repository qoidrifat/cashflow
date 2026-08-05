/**
 * Search History — recent searches untuk AI Search (Sprint 1.4, refactor 1.9).
 *
 * Factory `createSearchHistory(storage)` — storage DI-inject sehingga unit test
 * memakai mock storage langsung (tanpa stub `window`). Default instance
 * `searchHistory` dibind ke `window.localStorage` (dengan fallback aman).
 * Persistensi per-user: key menyertakan userId → tidak bocor antar akun.
 */

const STORAGE_PREFIX = 'cashflow:ai-search:recent:';
export const MAX_RECENT_SEARCHES = 8;

export interface RecentSearchEntry {
  query: string;
  tab: string;
  at: string; // ISO timestamp
}

/** Kontrak storage minimal — cukup get/set/remove per key. */
export interface SearchHistoryStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

export interface SearchHistoryApi {
  read(userId: string | null | undefined): RecentSearchEntry[];
  add(
    userId: string | null | undefined,
    query: string,
    tab: string,
    now?: Date,
  ): RecentSearchEntry[] | null;
  remove(userId: string | null | undefined, index: number): RecentSearchEntry[] | null;
  clear(userId: string | null | undefined): void;
}

/** Key per user — pakai id user (sudah non-PII identifier internal). */
function storageKey(userId: string | null | undefined): string {
  return `${STORAGE_PREFIX}${userId || 'anon'}`;
}

/**
 * Factory utama. `storage = null` → semua operasi no-op aman (SSR / storage
 * diblokir), `read` selalu `[]`, `add`/`remove` return `null` (tanda gagal).
 */
export function createSearchHistory(storage: SearchHistoryStorage | null): SearchHistoryApi {
  function read(userId: string | null | undefined): RecentSearchEntry[] {
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

  function add(
    userId: string | null | undefined,
    query: string,
    tab: string,
    now: Date = new Date(),
  ): RecentSearchEntry[] | null {
    const normalized = query.trim().replace(/\s+/g, ' ');
    if (normalized.length < 2) return read(userId);

    const entry: RecentSearchEntry = { query: normalized, tab, at: now.toISOString() };
    const withoutDuplicate = read(userId).filter(
      (existing) => existing.query.toLowerCase() !== normalized.toLowerCase(),
    );
    const updated = [entry, ...withoutDuplicate].slice(0, MAX_RECENT_SEARCHES);

    if (!storage) return null;
    try {
      storage.setItem(storageKey(userId), JSON.stringify(updated));
      return updated;
    } catch {
      return null;
    }
  }

  /**
   * Hapus SATU entri per index (urutan = array terbaru: 0 = paling baru).
   * Index di luar rentang → array tidak berubah (tetap di-persist & dikembalikan).
   */
  function remove(userId: string | null | undefined, index: number): RecentSearchEntry[] | null {
    const current = read(userId);
    if (index < 0 || index >= current.length) return current;
    const updated = [...current.slice(0, index), ...current.slice(index + 1)];
    if (!storage) return null;
    try {
      storage.setItem(storageKey(userId), JSON.stringify(updated));
      return updated;
    } catch {
      return null;
    }
  }

  function clear(userId: string | null | undefined): void {
    if (!storage) return;
    try {
      storage.removeItem(storageKey(userId));
    } catch {
      // ignore
    }
  }

  return { read, add, remove, clear };
}

/** Cari storage default dengan fallback aman (privacy mode / SSR). */
function safeLocalStorage(): SearchHistoryStorage | null {
  try {
    if (typeof window === 'undefined') return null;
    return window.localStorage;
  } catch {
    return null;
  }
}

/** Instance default app — dipakai AiSearchPage. */
export const searchHistory = createSearchHistory(safeLocalStorage());

// ===== Convenience named exports (delegasi ke instance default) =====
/** Baca riwayat user (default instance). */
export function readRecentSearches(userId: string | null | undefined): RecentSearchEntry[] {
  return searchHistory.read(userId);
}

/** Tambah pencarian (default instance) — return array baru atau null. */
export function addRecentSearch(
  userId: string | null | undefined,
  query: string,
  tab: string,
  now: Date = new Date(),
): RecentSearchEntry[] | null {
  return searchHistory.add(userId, query, tab, now);
}

/** Hapus satu entri per index (default instance). */
export function removeRecentSearch(
  userId: string | null | undefined,
  index: number,
): RecentSearchEntry[] | null {
  return searchHistory.remove(userId, index);
}

/** Hapus seluruh riwayat user (default instance). */
export function clearRecentSearches(userId: string | null | undefined): void {
  searchHistory.clear(userId);
}
