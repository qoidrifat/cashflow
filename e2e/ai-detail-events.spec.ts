/**
 * E2E: Dogfood buka detail untuk event INSIGHT & CONVERSATION (P9 §12/§23).
 *
 * Alur yang sama dengan ai-dogfood.spec.ts (yang menutup recommendation):
 * di halaman /ai/timeline, buka detail event insight (demo-tl-0) dan
 * conversation (demo-tl-2) dari seed Dafa, lalu verifikasi LANGSUNG di DB:
 *
 *   1. Event yang tepat menembak (server observability):
 *      - GET /api/ai-product/timeline/:id → `timeline_event_open` dengan
 *        feature = event_type (insight / conversation).
 *      - `recommendation_opened` TIDAK menembak untuk event non-recommendation
 *        (frontend track di-scope hanya event_type recommendation — P10.2).
 *   2. Status state machine (P9 §12): `new → viewed` di ai_timeline saat
 *      detail dibuka (PATCH /:id/status) → `timeline_status_update` dengan
 *      metadata { from: 'new', to: 'viewed' }.
 *
 * Spec memakai event DEMO (demo-tl-0/demo-tl-2) sesuai request QA — bukan
 * meng-seed event sendiri. Karena seed demo memberi status awal
 * 'viewed'/'completed' (bukan 'new'), spec me-RESET kedua event ke 'new' di
 * beforeAll (deterministik) dan me-RESTORE status asli di afterAll (dataset
 * demo dikembalikan ke kondisi seed — tidak ada mutasi permanen).
 *
 * Menjalankan:
 *   npx playwright test e2e/ai-detail-events.spec.ts
 *   npm run test:e2e:ai-detail-events
 */
import { test, expect } from 'playwright/test';
import fs from 'node:fs';
import path from 'node:path';
import { createClient } from '@libsql/client';
import { mintSessionCookieForEmail, cleanupTestSessions, createE2eTursoClient, type MintedSession } from './helpers/mintSession';
import { setupAuthContext } from './helpers/authContext';
import { collectPageErrors } from './helpers/errors';

const DEMO_EMAIL = 'demo@cashflow.test';
const EVENT_IDS = ['demo-tl-0', 'demo-tl-2'] as const;
/** Filter chips untuk membatasi list per event type (anti-flake pagination). */
const FILTER_INSIGHT = 'Insights';
const FILTER_CONVERSATION = 'Percakapan';

/** Baca server/.env untuk koneksi Turso (pola ai-dogfood.spec). */
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

async function withTurso<T>(fn: (turso: ReturnType<typeof createClient>) => Promise<T>): Promise<T> {
  loadEnv();
  const turso = await createE2eTursoClient();
  try {
    return await fn(turso);
  } finally {
    turso.close();
  }
}

async function userIdByEmail(email: string): Promise<string | null> {
  return withTurso(async (turso) => {
    const res = await turso.execute({ sql: 'SELECT id FROM user WHERE email = ?', args: [email] });
    return res.rows.length ? String(res.rows[0].id) : null;
  });
}

/** Status ai_timeline event demo (null bila event tidak ada). */
async function timelineStatus(eventId: string): Promise<string | null> {
  return withTurso(async (turso) => {
    const res = await turso.execute({ sql: 'SELECT status FROM ai_timeline WHERE id = ?', args: [eventId] });
    return res.rows.length ? String(res.rows[0].status) : null;
  });
}

async function setTimelineStatus(eventId: string, status: string): Promise<void> {
  await withTurso(async (turso) => {
    await turso.execute({ sql: 'UPDATE ai_timeline SET status = ? WHERE id = ?', args: [status, eventId] });
  });
}

/** Jumlah system_metrics user untuk (metric_name, feature) — feature = event_type. */
async function countOpenMetric(userId: string, feature: string): Promise<number> {
  return withTurso(async (turso) => {
    const res = await turso.execute({
      sql: 'SELECT COUNT(*) AS n FROM system_metrics WHERE user_id = ? AND metric_name = ? AND feature = ?',
      args: [userId, 'timeline_event_open', feature],
    });
    return Number(res.rows[0]?.n) || 0;
  });
}

/** Jumlah recommendation_opened yang metadata-nya menyebut itemId (harus 0 untuk insight/conversation). */
async function countOpenedForItem(userId: string, itemId: string): Promise<number> {
  return withTurso(async (turso) => {
    const res = await turso.execute({
      sql: `SELECT COUNT(*) AS n FROM system_metrics
            WHERE user_id = ? AND metric_name = 'recommendation_opened' AND metadata LIKE ?`,
      args: [userId, `%${itemId}%`],
    });
    return Number(res.rows[0]?.n) || 0;
  });
}

/** Jumlah timeline_status_update metadata {from:'new', to:'viewed'} untuk satu feature/event_type. */
async function countStatusNewToViewed(userId: string, feature: string): Promise<number> {
  return withTurso(async (turso) => {
    const res = await turso.execute({
      sql: `SELECT COUNT(*) AS n FROM system_metrics
            WHERE user_id = ? AND metric_name = 'timeline_status_update' AND feature = ?
              AND metadata LIKE ? AND metadata LIKE ?`,
      args: [userId, feature, '%"from":"new"%', '%"to":"viewed"%'],
    });
    return Number(res.rows[0]?.n) || 0;
  });
}

/** Snapshot id system_metrics user — dasar cleanup baris baru run ini. */
async function listSystemMetricIds(userId: string): Promise<string[]> {
  return withTurso(async (turso) => {
    const res = await turso.execute({ sql: 'SELECT id FROM system_metrics WHERE user_id = ?', args: [userId] });
    return res.rows.map((r) => String(r.id));
  });
}

async function ensureUsersRow(userId: string): Promise<void> {
  await withTurso(async (turso) => {
    await turso.execute({
      sql: `INSERT INTO users (id, email, name, display_name)
            VALUES (?, ?, 'Dafa Preview', 'Dafa Preview')
            ON CONFLICT(id) DO NOTHING`,
      args: [userId, DEMO_EMAIL],
    });
  });
}

/** Hapus system_metrics baru run ini (id ∉ baseline) — dataset demo tidak disentuh. */
async function cleanupNewMetrics(userId: string, baselineIds: string[]): Promise<void> {
  await withTurso(async (turso) => {
    if (baselineIds.length === 0) {
      await turso.execute({ sql: 'DELETE FROM system_metrics WHERE user_id = ?', args: [userId] });
    } else {
      const placeholders = baselineIds.map(() => '?').join(',');
      await turso.execute({
        sql: `DELETE FROM system_metrics WHERE user_id = ? AND id NOT IN (${placeholders})`,
        args: [userId, ...baselineIds],
      });
    }
  });
}

test.describe('AI detail-open events: insight & conversation (Dafa)', () => {
  let session: MintedSession;
  let baselineIds: string[] = [];
  let baseline: Record<string, number> = {};
  /** Status asli yang DIBACA saat runtime (bukan hardcode seed) — drift-proof. */
  const originalStatuses: Record<string, string> = {};

  test.beforeAll(async () => {
    session = await mintSessionCookieForEmail(DEMO_EMAIL);
    await ensureUsersRow(session.userId);
    baselineIds = await listSystemMetricIds(session.userId);
    baseline = {
      openInsight: await countOpenMetric(session.userId, 'insight'),
      openConversation: await countOpenMetric(session.userId, 'conversation'),
      openedTl0: await countOpenedForItem(session.userId, 'demo-tl-0'),
      openedTl2: await countOpenedForItem(session.userId, 'demo-tl-2'),
      statusInsight: await countStatusNewToViewed(session.userId, 'insight'),
      statusConversation: await countStatusNewToViewed(session.userId, 'conversation'),
    };
    // Setup deterministik: baca status asli (untuk restore drift-proof), lalu
    // pastikan 'new' — state machine new→viewed hanya valid dari 'new' (seed
    // memberi viewed/completed). Bila reset gagal, status yang sudah dibaca
    // langsung dikembalikan — tidak ada mutasi bocor walau beforeAll error.
    try {
      for (const id of EVENT_IDS) {
        const status = await timelineStatus(id);
        expect(status, `event ${id} harus ada di ai_timeline (seed demo)`).not.toBeNull();
        originalStatuses[id] = status as string;
        if (status !== 'new') await setTimelineStatus(id, 'new');
      }
    } catch (error) {
      for (const [id, status] of Object.entries(originalStatuses)) await setTimelineStatus(id, status);
      throw error;
    }
  });

  test.afterAll(async () => {
    // Restore status demo ke nilai yang DIBACA saat runtime (bukan hardcode).
    for (const [id, status] of Object.entries(originalStatuses)) await setTimelineStatus(id, status);
    await cleanupNewMetrics(session.userId, baselineIds);
    await cleanupTestSessions();
  });

  test.beforeEach(async ({ context }) => {
    await setupAuthContext(context, session);
  });

  test('buka detail insight (demo-tl-0) & conversation (demo-tl-2) → event tepat + status new→viewed', async ({ page }) => {
    const pageErrors = collectPageErrors(page);

    // ── Buka halaman AI Timeline ──
    await page.goto('/ai/timeline', { waitUntil: 'domcontentloaded' });
    await expect(page.getByRole('heading', { name: /Perjalanan finansialmu bersama AI/ })).toBeVisible({ timeout: 15_000 });

    // ── Detail INSIGHT (demo-tl-0): event_type insight ──
    // Filter 'Insights' membatasi list ke event insight saja — anti-flake
    // pagination (PAGE_SIZE 20) bila event nyata menumpuk dari run dogfood.
    const insightTitle = 'Pengeluaran makanan naik 27%';
    await page.getByRole('button', { name: FILTER_INSIGHT }).click();
    await page.getByRole('button', { name: `Lihat detail ${insightTitle}` }).click();
    await expect(page.getByText('Mengapa AI mengatakan ini')).toBeVisible();
    await expect(page.getByText('Rp1.150.000')).toBeVisible(); // payload evidence expense (formatCurrency id-ID)

    // Event yang TEPAT: timeline_event_open feature=insight naik.
    await expect
      .poll(async () => (await countOpenMetric(session.userId, 'insight')) > baseline.openInsight, {
        message: 'timeline_event_open (feature=insight) harus bertambah saat detail insight dibuka',
      })
      .toBe(true);
    // TIDAK ada recommendation_opened untuk event insight (bukan recommendation).
    await expect
      .poll(async () => (await countOpenedForItem(session.userId, 'demo-tl-0')) === baseline.openedTl0, {
        message: 'recommendation_opened TIDAK boleh menembak untuk event insight',
      })
      .toBe(true);
    // Status new → viewed (state machine P9 §12).
    await expect
      .poll(async () => (await timelineStatus('demo-tl-0')) === 'viewed', {
        message: 'demo-tl-0 (insight) harus new → viewed setelah detail dibuka',
      })
      .toBe(true);
    await expect
      .poll(async () => (await countStatusNewToViewed(session.userId, 'insight')) > baseline.statusInsight, {
        message: 'timeline_status_update {from:new,to:viewed} untuk insight harus tercatat',
      })
      .toBe(true);

    // ── Detail CONVERSATION (demo-tl-2): event_type conversation ──
    // Filter 'Percakapan' membatasi list ke event conversation saja.
    const convTitle = 'Kenapa uangku habis minggu ini?';
    await page.getByRole('button', { name: FILTER_CONVERSATION }).click();
    await page.getByRole('button', { name: `Lihat detail ${convTitle}` }).click();
    await expect(page.getByText('Mengapa AI mengatakan ini')).toBeVisible();

    await expect
      .poll(async () => (await countOpenMetric(session.userId, 'conversation')) > baseline.openConversation, {
        message: 'timeline_event_open (feature=conversation) harus bertambah saat detail conversation dibuka',
      })
      .toBe(true);
    await expect
      .poll(async () => (await countOpenedForItem(session.userId, 'demo-tl-2')) === baseline.openedTl2, {
        message: 'recommendation_opened TIDAK boleh menembak untuk event conversation',
      })
      .toBe(true);
    await expect
      .poll(async () => (await timelineStatus('demo-tl-2')) === 'viewed', {
        message: 'demo-tl-2 (conversation) harus new → viewed setelah detail dibuka',
      })
      .toBe(true);
    await expect
      .poll(async () => (await countStatusNewToViewed(session.userId, 'conversation')) > baseline.statusConversation, {
        message: 'timeline_status_update {from:new,to:viewed} untuk conversation harus tercatat',
      })
      .toBe(true);

    // ── Evidence summary (dicetak sebelum afterAll cleanup) ──
    const evidence = {
      userId: session.userId,
      timeline: {
        'demo-tl-0': await timelineStatus('demo-tl-0'),
        'demo-tl-2': await timelineStatus('demo-tl-2'),
      },
      timelineEventOpen: {
        insight: await countOpenMetric(session.userId, 'insight'),
        conversation: await countOpenMetric(session.userId, 'conversation'),
      },
      recommendationOpenedForItems: {
        'demo-tl-0': await countOpenedForItem(session.userId, 'demo-tl-0'),
        'demo-tl-2': await countOpenedForItem(session.userId, 'demo-tl-2'),
      },
      statusNewToViewed: {
        insight: await countStatusNewToViewed(session.userId, 'insight'),
        conversation: await countStatusNewToViewed(session.userId, 'conversation'),
      },
    };
    // eslint-disable-next-line no-console
    console.log('EVIDENCE_AI_DETAIL_EVENTS ' + JSON.stringify(evidence));

    pageErrors.expectClean();
  });
});
