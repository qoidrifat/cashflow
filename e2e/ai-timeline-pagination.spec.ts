/**
 * E2E: Pagination "Muat lebih" AI Timeline (P9 §18) + dedup telemetry (P10.2e)
 * memakai seed user Dafa (demo@cashflow.test) — repeatable di CI.
 *
 * Yang di-dogfood (dan di-lock):
 *   1. Halaman 1 (/ai/timeline) menampilkan PAGE_SIZE=20 event terbaru + tombol
 *      "Muat lebih" (hasMore=true).
 *   2. Klik "Muat lebih" → halaman 2 via keyset (created_at, id) `before` →
 *      total 25 event tampil, TIDAK ADA duplikat (tiap title tepat 1×).
 *   3. Dedup telemetry: ai_result_shown fire TEPAT SEKALI per item (guard
 *      trackedIdsRef persisten per mount) — item halaman 1 TIDAK dihitung ulang
 *      saat halaman 2 dimuat; item baru (halaman 2) fire sekali.
 *   4. recommendation_shown HANYA untuk event_type recommendation (5 dari 25).
 *   5. "Bandingkan dengan sistem tracking": jumlah baris system_metrics per
 *      itemId = 1 (bukan 0 / bukan 2) — pipeline POST /track → system_metrics
 *      konsisten dengan apa yang UI nyatakan dirender.
 *
 * Seed: 25 event langsung ke ai_timeline (20 insight + 5 recommendation) dengan
 * created_at = now − N detik (N=0..24) → urutan DESC deterministik & keyset
 * tie-free; SEMUA masuk grup "Hari Ini". StrictMode dev double-mount + guard
 * loadSeqRef → telemetry tetap tepat 1×/item (diverifikasi eksplisit).
 *
 * Hanya data MILIK spec ini yang dibersihkan (event title 'E2E Page %' +
 * system_metrics itemId terkait + sesi) — dataset demo Dafa tidak disentuh.
 *
 * Menjalankan:
 *   npx playwright test e2e/ai-timeline-pagination.spec.ts
 *   npm run test:e2e:ai-timeline-pagination
 */
import { test, expect } from 'playwright/test';
import fs from 'node:fs';
import path from 'node:path';
import { createClient } from '@libsql/client';
import { mintSessionCookieForEmail, cleanupTestSessions, createE2eTursoClient, type MintedSession } from './helpers/mintSession';
import { setupAuthContext } from './helpers/authContext';
import { collectPageErrors } from './helpers/errors';

/** Email seed user Dafa (scripts/seedDemoData.mjs — DEMO_EMAIL). */
const DEMO_EMAIL = 'demo@cashflow.test';
/** Jumlah event seed: halaman 1 (20) + halaman 2 (5). */
const TOTAL = 25;
/** 5 recommendation (fire recommendation_shown) sisanya insight. */
const RECO_COUNT = 5;
/** Marker title — dasar cleanup & asersi unik. */
const TITLE_PREFIX = 'E2E Page';
const titleOf = (i: number) => `${TITLE_PREFIX} Event ${String(i).padStart(2, '0')}`;

/** Baca server/.env untuk koneksi Turso (pola helpers/mintSession). */
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

/** Bungkus koneksi Turso dengan loadEnv + close (pola ai-timeline.spec). */
async function withTurso<T>(fn: (turso: ReturnType<typeof createClient>) => Promise<T>): Promise<T> {
  loadEnv();
  const turso = await createE2eTursoClient();
  try {
    return await fn(turso);
  } finally {
    turso.close();
  }
}

/** id ai_timeline untuk title persis — dipakai verifikasi system_metrics per item. */
async function eventIdByTitle(userId: string, title: string): Promise<string | null> {
  return withTurso(async (turso) => {
    const res = await turso.execute({
      sql: 'SELECT id FROM ai_timeline WHERE user_id = ? AND title = ?',
      args: [userId, title],
    });
    return (res.rows[0]?.id as string) || null;
  });
}

/** Jumlah baris system_metrics untuk satu itemId + event (via metadata JSON). */
async function countMetricForItem(userId: string, itemId: string, metricName: string): Promise<number> {
  return withTurso(async (turso) => {
    const res = await turso.execute({
      sql: `SELECT COUNT(*) AS n FROM system_metrics
            WHERE user_id = ? AND metric_name = ? AND metadata LIKE ?`,
      // metadata = JSON.stringify PLAIN (tanpa backslash): {"itemId":"X"}
      // (\" tidak ditambahkan — template literal tanpa escape; sebelumnya pola
      // `%\\\"itemId...` berisi backslash literal → TIDAK pernah match → 0).
      args: [userId, metricName, `%"itemId":"${itemId}"%`],
    });
    return Number(res.rows[0]?.n) || 0;
  });
}

/**
 * Self-heal (idempoten): hapus sisa run sebelumnya (event 'E2E Page %' +
 * system_metrics itemId terkait + feedback) — repeatability tanpa residu.
 */
async function cleanupStaleRows(userId: string): Promise<void> {
  await withTurso(async (turso) => {
    // system_metrics dikaitkan via metadata.itemId — id seed deterministik
    // 'e2e-page-XX' → hapus berdasarkan itemId (bukan title yang tidak ada
    // di metadata).
    await turso.execute({
      sql: `DELETE FROM system_metrics WHERE user_id = ? AND metadata LIKE '%e2e-page-%'`,
      args: [userId],
    });
    await turso.execute({
      sql: `DELETE FROM ai_feedback WHERE item_id IN (
              SELECT id FROM ai_timeline WHERE user_id = ? AND title LIKE '${TITLE_PREFIX} %'
            )`,
      args: [userId],
    });
    await turso.execute({
      sql: `DELETE FROM ai_timeline WHERE user_id = ? AND title LIKE '${TITLE_PREFIX} %'`,
      args: [userId],
    });
  });
}

/** Seed 25 event (20 insight + 5 recommendation) — satu INSERT multi-VALUES ATOMIK. */
async function seedEvents(userId: string): Promise<void> {
  await withTurso(async (turso) => {
    const values = Array.from({ length: TOTAL }, (_, i) => {
      const reco = i >= TOTAL - RECO_COUNT;
      const feature = reco ? 'advisor' : 'insight';
      const eventType = reco ? 'recommendation' : 'insight';
      // created_at = now − i detik → i=0 TERBARU (ORDER DESC: i naik ke bawah);
      // halaman 1 = i 0..19, halaman 2 = i 20..24 (5 recommendation).
      return `('${'e2e-page-' + String(i).padStart(2, '0')}', ?, '${feature}', '${eventType}', 'new', ?, '', NULL, '{}', datetime('now', '-${i} seconds'))`;
    }).join(',\n');
    await turso.execute({
      sql: `INSERT INTO ai_timeline (id, user_id, feature, event_type, status, title, body, confidence, payload, created_at)
            VALUES\n${values}`,
      args: Array.from({ length: TOTAL }, (_, i) => [userId, titleOf(i)]).flat(),
    });
  });
}

test.describe('AI Timeline pagination Muat lebih (Dafa — P9 §18 + P10.2e)', () => {
  // Dua expect.poll (20s masing-masing) + expect 20s vs timeout default 60s —
  // margin tipis di bawah beban CI (shared Turso). Bump ke 90s (pola
  // ai-conversation.spec) sebagai anti-flake.
  test.setTimeout(90_000);
  let session: MintedSession;
  const ids: Record<string, string> = {};

  test.beforeAll(async () => {
    session = await mintSessionCookieForEmail(DEMO_EMAIL);
    await cleanupStaleRows(session.userId);
    await seedEvents(session.userId);
    // Ambil id untuk verifikasi system_metrics per item.
    for (let i = 0; i < TOTAL; i++) {
      const id = await eventIdByTitle(session.userId, titleOf(i));
      expect(id, `event ${titleOf(i)} harus tersedia`).not.toBeNull();
      ids[titleOf(i)] = id as string;
    }
  });

  test.afterAll(async () => {
    await cleanupStaleRows(session.userId);
    await cleanupTestSessions();
  });

  test.beforeEach(async ({ context }) => {
    await setupAuthContext(context, session);
  });

  test('halaman 1 → Muat lebih → 25 event tanpa duplikat + dedup telemetry per item', async ({ page }) => {
    const pageErrors = collectPageErrors(page);

    await page.goto('/ai/timeline', { waitUntil: 'domcontentloaded' });
    await expect(page.getByRole('heading', { name: /Perjalanan finansialmu bersama AI/ })).toBeVisible({ timeout: 20_000 });

    // ── 1. Halaman 1: 20 event (i=0..19, terbaru) + tombol "Muat lebih" ──
    const muatLebih = page.getByRole('button', { name: /Muat lebih/ });
    await expect(muatLebih).toBeVisible({ timeout: 20_000 });
    await expect(page.getByText(titleOf(0), { exact: true })).toBeVisible();
    await expect(page.getByText(titleOf(19), { exact: true })).toBeVisible();
    // Halaman 2 (i=20..24) BELUM tampil.
    await expect(page.getByText(titleOf(20), { exact: true })).toHaveCount(0);
    await expect(page.getByText(titleOf(24), { exact: true })).toHaveCount(0);

    // Telemetry halaman 1: 20 item fire ai_result_shown tepat 1× (poll — async recorder).
    await expect
      .poll(async () => {
        let n = 0;
        for (let i = 0; i < 20; i++) n += await countMetricForItem(session.userId, ids[titleOf(i)], 'ai_result_shown');
        return n;
      }, { timeout: 20_000 })
      .toBe(20);

    // ── 2. Muat lebih → halaman 2 (keyset before) ──
    await muatLebih.click();

    // 25 event tampil — tiap title TEPAT 1× (tidak ada duplikat halaman 1+2).
    await expect(page.getByText(titleOf(20), { exact: true })).toBeVisible({ timeout: 20_000 });
    for (let i = 0; i < TOTAL; i++) {
      await expect(page.getByText(titleOf(i), { exact: true })).toHaveCount(1);
    }
    // hasMore false → tombol hilang.
    await expect(muatLebih).toHaveCount(0);

    // ── 3. Bandingkan dengan sistem tracking: 25 item → 25× ai_result_shown,
    // tiap item TEPAT 1× (item halaman 1 TIDAK dihitung ulang oleh halaman 2). ──
    await expect
      .poll(async () => {
        let n = 0;
        for (let i = 0; i < TOTAL; i++) n += await countMetricForItem(session.userId, ids[titleOf(i)], 'ai_result_shown');
        return n;
      }, { timeout: 20_000 })
      .toBe(TOTAL);
    for (let i = 0; i < TOTAL; i++) {
      expect(await countMetricForItem(session.userId, ids[titleOf(i)], 'ai_result_shown')).toBe(1);
    }

    // recommendation_shown HANYA untuk 5 item recommendation (i=20..24 — halaman
    // 2): masing-masing TEPAT 1×; insight (i=0..19) 0×.
    for (let i = 0; i < TOTAL; i++) {
      const expected = i >= TOTAL - RECO_COUNT ? 1 : 0;
      expect(await countMetricForItem(session.userId, ids[titleOf(i)], 'recommendation_shown')).toBe(expected);
    }

    pageErrors.expectClean();
  });
});
