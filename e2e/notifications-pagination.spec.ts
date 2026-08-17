/**
 * E2E: Paginasi halaman Notifikasi ("Muat lebih banyak") — regression P0-4.
 *
 * Bug lama: fetchNotifications hanya mengirim `?limit=` (offset dibuang) dan
 * server mengabaikan limit/offset (hardcoded LIMIT 100) → setiap klik "Muat
 * lebih banyak" menampilkan ulang baris yang sama (duplikat).
 *
 * Alur:
 *   1. Seed 25 notifikasi test via POST /api/notifications (dedupeKey unik
 *      berprefiks 'e2e-page-' agar deterministik & aman dibersihkan).
 *   2. UI: buka /notifications → halaman 1 = 20 item terbaru (semua seed,
 *      urutan menurun). Klik "Muat lebih banyak" sampai halaman terakhir:
 *      tombol hilang (loading berhenti), total item = jumlah baris user,
 *      TIDAK ada judul duplikat, urutan created_at tetap menurun.
 *   3. API: halaman 1 & 2 (limit=20) tidak overlap ID; offset melewati
 *      jumlah total mengembalikan [] (perilaku halaman kosong).
 *   4. Cleanup data test di afterAll.
 *
 * Menjalankan:
 *   npx playwright test e2e/notifications-pagination.spec.ts
 */
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { test, expect, type APIRequestContext } from 'playwright/test';
import { mintSessionCookie, mintSessionCookieForEmail, cleanupTestSessions, createE2eTursoClient } from './helpers/mintSession';
import { setupAuthContext } from './helpers/authContext';
import { collectPageErrors } from './helpers/errors';

const PAGE_SIZE = 20; // harus sinkron dengan PAGE_SIZE di NotificationsPage.tsx
const SEED_COUNT = 25; // > 1 halaman (20) agar "Muat lebih banyak" teruji
const RUN_ID = crypto.randomBytes(4).toString('hex');
const DEDUPE_PREFIX = 'e2e-page-';
// Fix 8 (regression filtered pagination): seed mix read/unread berprefiks
// 'e2e-page-f-*' — dibersihkan oleh cleanup yang sama (prefix e2e-page-%).
const FILTER_PREFIX = 'e2e-page-f-';
const FILTER_SEED_TOTAL = 24; // > 1 halaman unread (12 unread dari 24)
const FILTER_UNREAD_COUNT = FILTER_SEED_TOTAL / 2;

/** Muat env server/.env (pola sama dengan helpers/mintSession.ts). */
function loadEnv(): void {
  const envPath = path.resolve(process.cwd(), 'server', '.env');
  if (!fs.existsSync(envPath)) return;
  for (const line of fs.readFileSync(envPath, 'utf8').split(/\r?\n/)) {
    const t = line.trim();
    if (t && !t.startsWith('#') && t.includes('=')) {
      const i = t.indexOf('=');
      const k = t.slice(0, i).trim();
      const v = t.slice(i + 1).trim().replace(/^["']|["']$/g, '');
      if (k && !process.env[k]) process.env[k] = v;
    }
  }
}

async function openTurso() {
  loadEnv();
  return await createE2eTursoClient();
}

/** Judul seed deterministik: index 2-digit, urut naik saat dibuat. */
function seedTitle(index: number): string {
  return `E2E Paginasi ${RUN_ID} ${String(index).padStart(2, '0')}`;
}

/** Judul seed filtered-pagination (prefix F, index 2-digit). */
function filterSeedTitle(index: number): string {
  return `E2E Filter Paginasi ${RUN_ID} ${String(index).padStart(2, '0')}`;
}

/** Ambil index seed filtered dari judul (atau -1 bila bukan item test). */
function filterSeedIndexOf(title: string): number {
  const m = title.match(new RegExp(`^E2E Filter Paginasi ${RUN_ID} (\\d{2})$`));
  return m ? Number(m[1]) : -1;
}

/** Ambil index seed dari judul (atau -1 bila bukan item test). */
function seedIndexOf(title: string): number {
  const m = title.match(new RegExp(`^E2E Paginasi ${RUN_ID} (\\d{2})$`));
  return m ? Number(m[1]) : -1;
}

async function seedNotifications(request: APIRequestContext, cookie: string): Promise<void> {
  for (let i = 1; i <= SEED_COUNT; i++) {
    const resp = await request.post('/api/notifications', {
      headers: { Cookie: `better-auth.session_token=${cookie}` },
      data: {
        type: 'system',
        title: seedTitle(i),
        message: 'Data test paginasi notifikasi (E2E P0-4).',
        dedupeKey: `${DEDUPE_PREFIX}${RUN_ID}-${i}`,
      },
    });
    expect(resp.ok(), `seed notifikasi #${i} via API`).toBeTruthy();
  }
}

/** Seed mix read/unread untuk uji filtered pagination (index ganjil = unread). */
async function seedFilteredNotifications(request: APIRequestContext, cookie: string): Promise<void> {
  for (let i = 1; i <= FILTER_SEED_TOTAL; i++) {
    const unread = i % 2 === 1;
    const resp = await request.post('/api/notifications', {
      headers: { Cookie: `better-auth.session_token=${cookie}` },
      data: {
        type: 'system',
        title: filterSeedTitle(i),
        message: 'Data test paginasi terfilter (E2E Fix 8).',
        dedupeKey: `${FILTER_PREFIX}${RUN_ID}-${i}`,
        read: !unread,
      },
    });
    expect(resp.ok(), `seed filtered notifikasi #${i} via API`).toBeTruthy();
  }
}

/** Hapus semua notifikasi test berprefiks 'e2e-page-' (termasuk sisa run lama). */
async function cleanupSeededNotifications(): Promise<void> {
  const turso = await openTurso();
  try {
    await turso.execute({
      sql: `DELETE FROM notifications WHERE dedupe_key LIKE ?`,
      args: [`${DEDUPE_PREFIX}%`],
    });
  } finally {
    turso.close();
  }
}

/**
 * Pastikan user test ada di tabel legacy `users` juga — notifications.user_id
 * punya FOREIGN KEY REFERENCES users(id), sedangkan mintSessionCookieForEmail
 * hanya menulis ke tabel `user` (Better Auth). Tanpa ini POST /api/notifications
 * gagal SQLITE_CONSTRAINT untuk user sementara.
 */
async function ensureLegacyUserRow(userId: string, email: string): Promise<void> {
  const turso = await openTurso();
  try {
    await turso.execute({
      sql: `INSERT OR IGNORE INTO users (id, email, name) VALUES (?, ?, ?)`,
      args: [userId, email, 'E2E Filtered Pagination'],
    });
  } finally {
    turso.close();
  }
}

/** Hapus baris user test dari tabel legacy `users` (email prefiks 'e2e-page-f-'). */
async function cleanupLegacyTestUser(): Promise<void> {
  const turso = await openTurso();
  try {
    await turso.execute({
      sql: `DELETE FROM users WHERE email LIKE 'e2e-page-f-%@e2e.local'`,
      args: [],
    });
  } finally {
    turso.close();
  }
}

/** Hitung total notifikasi user (untuk ekspektasi halaman terakhir). */
async function countUserNotifications(userId: string): Promise<number> {
  const turso = await openTurso();
  try {
    const res = await turso.execute({
      sql: `SELECT COUNT(*) AS total FROM notifications WHERE user_id = ?`,
      args: [userId],
    });
    return Number(res.rows[0]?.total ?? 0);
  } finally {
    turso.close();
  }
}

/** Ekstrak judul dari aria-label item (format: "<title>, <tipe>, <status baca>"). */
function titleFromAriaLabel(label: string): string {
  return label.split(',')[0].trim();
}

test.describe('Notifications page — pagination (e2e)', () => {
  let session: { cookie: string; userId: string };
  let totalForUser: number;

  test.beforeAll(async ({ request }) => {
    session = await mintSessionCookie();
    // Bersihkan sisa run lama dulu agar hitungan total deterministik.
    await cleanupSeededNotifications();
    await seedNotifications(request, session.cookie);
    totalForUser = await countUserNotifications(session.userId);
    expect(totalForUser, 'total notifikasi user setelah seed').toBeGreaterThanOrEqual(SEED_COUNT);
  });

  test.afterAll(async () => {
    await cleanupSeededNotifications();
    await cleanupTestSessions();
  });

  test.beforeEach(async ({ context }) => {
    await setupAuthContext(context, session);
  });

  test('UI: halaman 1 & 2 tanpa duplikat, urut terbaru dulu, tombol hilang di halaman terakhir', async ({ page }) => {
    const pageErrors = collectPageErrors(page);

    await page.goto('/notifications');
    const items = page.locator('section[aria-label="Daftar notifikasi"] [role="menuitem"]');
    const loadMoreButton = page.getByRole('button', { name: 'Muat lebih banyak' });

    // ===== Halaman 1: tepat PAGE_SIZE item terbaru =====
    await expect(items).toHaveCount(PAGE_SIZE);
    const collectTitles = async () => {
      const labels = await items.evaluateAll((els) =>
        els.map((el) => el.getAttribute('aria-label') ?? ''),
      );
      return labels.map(titleFromAriaLabel);
    };

    // Seed adalah notifikasi TERBARU → item seed run ini harus tampil di
    // halaman 1 dalam urutan menurun (created_at DESC). TIDAK diassert
    // "seluruhnya seed" karena notifikasi lain (sisa run lain / alert sistem)
    // bisa terselip — yang diuji adalah konsistensi paginasi, bukan dataset.
    const firstPageSeedIndexes = (await collectTitles()).map(seedIndexOf).filter((i) => i !== -1);
    expect(firstPageSeedIndexes.length, 'item seed tampil di halaman 1').toBeGreaterThan(0);
    for (let i = 1; i < firstPageSeedIndexes.length; i++) {
      expect(firstPageSeedIndexes[i], 'halaman 1 terurut menurun').toBeLessThan(firstPageSeedIndexes[i - 1]);
    }

    // ===== Klik "Muat lebih banyak" sampai halaman terakhir =====
    // Jumlah klik deterministik dari total baris user (dihitung di beforeAll).
    const expectedClicks = Math.max(0, Math.ceil(totalForUser / PAGE_SIZE) - 1);
    for (let click = 1; click <= expectedClicks; click++) {
      await expect(loadMoreButton).toBeVisible();
      await loadMoreButton.click();
      const expectedCount = Math.min(totalForUser, PAGE_SIZE * (click + 1));
      await expect(items).toHaveCount(expectedCount);
    }

    // Halaman terakhir tercapai → loading berhenti (tombol hilang).
    await expect(loadMoreButton).toBeHidden();
    await expect(items).toHaveCount(totalForUser);

    // ===== Tidak ada duplikat & urutan tetap menurun =====
    const allTitles = await collectTitles();
    expect(allTitles).toHaveLength(totalForUser);
    // Identitas unik diassert lewat item seed (judul mengandung RUN_ID, pasti
    // unik). Dataset asli bisa punya judul kembar (mis. "Transaksi ditolak"),
    // jadi Set-global tidak dipakai. Bug lama (offset dibuang) akan memuat
    // ulang baris sama → tiap judul seed muncul > 1 kali → assert ini gagal.
    const seedTitles = allTitles.filter((title) => seedIndexOf(title) !== -1);
    expect(seedTitles, 'tiap item seed tampil tepat sekali (tanpa duplikat)').toHaveLength(SEED_COUNT);

    const seedIndexes = seedTitles.map(seedIndexOf);
    for (let i = 1; i < seedIndexes.length; i++) {
      expect(seedIndexes[i], `urutan menurun di posisi ${i}`).toBeLessThan(seedIndexes[i - 1]);
    }

    pageErrors.expectClean();
  });

  test('API: halaman 1 & 2 tidak overlap ID; offset melewati total mengembalikan []', async ({ request }) => {
    const cookieHeader = { Cookie: `better-auth.session_token=${session.cookie}` };

    const fetchPage = async (limit: number, offset: number) => {
      const resp = await request.get(`/api/notifications?limit=${limit}&offset=${offset}`, {
        headers: cookieHeader,
      });
      expect(resp.ok(), `GET /api/notifications?limit=${limit}&offset=${offset}`).toBeTruthy();
      return (await resp.json()) as Array<{ id: string; created_at: string }>;
    };

    // Halaman 1 penuh (seed menjamin >= 20 baris).
    const page1 = await fetchPage(PAGE_SIZE, 0);
    expect(page1).toHaveLength(PAGE_SIZE);

    // Halaman 2 tidak boleh memuat ID halaman 1 (inti bug P0-4).
    const page2 = await fetchPage(PAGE_SIZE, PAGE_SIZE);
    const page1Ids = new Set(page1.map((row) => row.id));
    const overlap = page2.filter((row) => page1Ids.has(row.id));
    expect(overlap, 'tidak ada ID duplikat antara halaman 1 dan 2').toEqual([]);

    // Urutan global newest-first (created_at menurun antar halaman).
    if (page2.length > 0) {
      expect(page1[page1.length - 1].created_at >= page2[0].created_at, 'batas halaman terurut').toBeTruthy();
    }

    // Halaman kosong setelah data habis.
    const beyond = await fetchPage(PAGE_SIZE, totalForUser);
    expect(beyond, 'offset melewati total mengembalikan []').toEqual([]);

    // Offset negatif/invalid di-clamp ke 0 (bukan error).
    const clamped = await request.get('/api/notifications?limit=5&offset=-3', { headers: cookieHeader });
    expect(clamped.ok(), 'offset negatif di-clamp, bukan 4xx/5xx').toBeTruthy();
    const clampedRows = (await clamped.json()) as Array<{ id: string }>;
    expect(clampedRows.map((row) => row.id), 'offset ter-clamp sama dengan offset 0').toEqual(
      page1.slice(0, 5).map((row) => row.id),
    );
  });
});

/**
 * Fix 8 (regression): filter unreadOnly harus diterapkan server SEBELUM
 * LIMIT/OFFSET. Bug lama: filter client-side setelah paging → halaman berisi
 * potongan acak & duplikat antar halaman saat filter aktif.
 */
test.describe('Notifications page — filtered pagination (e2e)', () => {
  let session: { cookie: string; userId: string };

  test.beforeAll(async ({ request }) => {
    // User sementara (email 'e2e-*') → dataset notifikasi deterministik kosong;
    // mintSessionCookie() memakai user asli yang punya notifikasi existing.
    const email = `e2e-page-f-${RUN_ID}@e2e.local`;
    session = await mintSessionCookieForEmail(email);
    await ensureLegacyUserRow(session.userId, email);
    await cleanupSeededNotifications();
    await seedFilteredNotifications(request, session.cookie);
  });

  test.afterAll(async () => {
    await cleanupSeededNotifications();
    await cleanupTestSessions();
    await cleanupLegacyTestUser();
  });

  test('API: unreadOnly paging tanpa duplikat antar halaman, semua unread, urut menurun', async ({ request }) => {
    const cookieHeader = { Cookie: `better-auth.session_token=${session.cookie}` };
    const PAGE = 7; // 12 unread seed → 2 halaman (7 + 5)

    const fetchPage = async (offset: number) => {
      const resp = await request.get(`/api/notifications?limit=${PAGE}&offset=${offset}&unreadOnly=1`, {
        headers: cookieHeader,
      });
      expect(resp.ok(), `GET unreadOnly offset=${offset}`).toBeTruthy();
      return (await resp.json()) as Array<{ id: string; read: number; dedupe_key: string; created_at: string }>;
    };

    const page1 = await fetchPage(0);
    const page2 = await fetchPage(PAGE);
    const allRows = [...page1, ...page2];

    // Semua baris unread (filter diterapkan di SQL, bukan dipotong client).
    for (const row of allRows) {
      expect(row.read, `baris ${row.id} harus unread`).toBe(0);
    }

    // Tepat seluruh seed unread run ini, tidak kurang (inti bug lama: halaman
    // terfilter hanya berisi sisa-sisa LIMIT 20 → total < jumlah unread).
    const seeded = allRows.filter((row) => String(row.dedupe_key || '').startsWith(`${FILTER_PREFIX}${RUN_ID}`));
    expect(seeded, 'semua unread seed tertangkap paging terfilter').toHaveLength(FILTER_UNREAD_COUNT);

    // Nol duplikat antar halaman.
    const page1Ids = new Set(page1.map((row) => row.id));
    const overlap = page2.filter((row) => page1Ids.has(row.id));
    expect(overlap, 'tidak ada ID duplikat antara halaman 1 dan 2').toEqual([]);

    // Urutan global newest-first (created_at menurun antar halaman).
    for (let i = 1; i < allRows.length; i++) {
      expect(
        allRows[i - 1].created_at >= allRows[i].created_at,
        `urutan menurun di posisi ${i}`,
      ).toBeTruthy();
    }

    // Halaman kosong setelah data unread habis.
    const beyond = await fetchPage(page1.length + page2.length);
    expect(beyond, 'offset melewati total unread mengembalikan []').toEqual([]);
  });

  test('UI: filter "Hanya belum dibaca" menampilkan tepat unread seed tanpa duplikat', async ({ page }) => {
    const pageErrors = collectPageErrors(page);
    await setupAuthContext(page.context(), session);

    await page.goto('/notifications');
    const items = page.locator('section[aria-label="Daftar notifikasi"] [role="menuitem"]');

    // User sementara → seluruh barisnya adalah seed (24: 12 read + 12 unread).
    // Halaman pertama berisi PAGE_SIZE (20) — klik "Muat lebih banyak" dulu.
    await expect(items).toHaveCount(PAGE_SIZE);
    await page.getByRole('button', { name: 'Muat lebih banyak' }).click();
    await expect(items).toHaveCount(FILTER_SEED_TOTAL);

    await page.getByLabel('Hanya belum dibaca').check();
    // Setelah filter server-side: tepat 12 unread, tanpa potongan/duplikat.
    await expect(items).toHaveCount(FILTER_UNREAD_COUNT);

    const labels = await items.evaluateAll((els) =>
      els.map((el) => el.getAttribute('aria-label') ?? ''),
    );
    const titles = labels.map((label) => label.split(',')[0].trim());
    const seedIndexes = titles.map(filterSeedIndexOf);
    // Semua item adalah seed unread (index ganjil) & unik (tanpa duplikat).
    expect(new Set(titles).size, 'tanpa judul duplikat').toBe(FILTER_UNREAD_COUNT);
    for (const index of seedIndexes) {
      expect(index, 'item adalah seed').not.toBe(-1);
      expect(index % 2, `seed #${index} harus unread (index ganjil)`).toBe(1);
    }
    // Urutan menurun (terbaru dulu).
    for (let i = 1; i < seedIndexes.length; i++) {
      expect(seedIndexes[i], `urutan menurun di posisi ${i}`).toBeLessThan(seedIndexes[i - 1]);
    }

    pageErrors.expectClean();
  });
});
