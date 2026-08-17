/**
 * E2E: State machine status timeline live (P9 §12) — alur "Tandai Selesai" + transisi invalid.
 *
 * Memakai event DEMO `demo-tl-4` (insight "Tagihan bulan ini lebih tinggi",
 * seed status 'new') milik demo@cashflow.test — sesuai request QA. Verifikasi:
 *
 *   1. Tandai Selesai via UI (tombol "Tandai selesai …" — hanya render saat
 *      status new|viewed) → PATCH /api/ai-product/timeline/:id/status:
 *      - DB: ai_timeline.status = 'completed'
 *      - UI: badge status "Selesai" muncul, tombol Selesai/Buang hilang
 *        (completed = final — aksi non-render)
 *      - Observability: timeline_status_update feature=insight metadata
 *        { from: 'new', to: 'completed' }
 *   2. Transisi INVALID completed → dismissed (final state) → 400 dengan
 *      shape kanonik `{ error, errorCode: 'VALIDATION_ERROR', details }` —
 *      status DB TIDAK berubah (tetap completed), dan TIDAK ada
 *      timeline_status_update {from:completed, to:dismissed} tercatat.
 *
 * Spec me-reset demo-tl-4 ke 'new' di beforeAll (deterministik — seed memberi
 * 'new', tapi run sebelumnya bisa meninggalkan status lain; status asli di-CAPTURE
 * runtime untuk restore drift-proof) dan me-restore status asli + membersihkan
 * system_metrics baru di afterAll (dataset demo dikembalikan — tidak ada mutasi
 * permanen). Reset dibungkus try/catch: bila beforeAll error, status yang sudah
 * dibaca langsung dikembalikan (afterAll dilewati Playwright saat beforeAll gagal).
 *
 * Menjalankan:
 *   npx playwright test e2e/ai-status-machine.spec.ts
 *   npm run test:e2e:ai-status-machine
 */
import { test, expect } from 'playwright/test';
import fs from 'node:fs';
import path from 'node:path';
import { createClient } from '@libsql/client';
import { mintSessionCookieForEmail, cleanupTestSessions, createE2eTursoClient, type MintedSession } from './helpers/mintSession';
import { setupAuthContext } from './helpers/authContext';
import { collectPageErrors } from './helpers/errors';

const DEMO_EMAIL = 'demo@cashflow.test';
const EVENT_ID = 'demo-tl-4';
const EVENT_TITLE = 'Tagihan bulan ini lebih tinggi';
/** Filter chip untuk membatasi list ke event insight (anti-flake pagination). */
const FILTER_INSIGHT = 'Insights';

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

/** Jumlah timeline_status_update {from→to} untuk satu feature/event_type. */
async function countStatusTransition(userId: string, feature: string, from: string, to: string): Promise<number> {
  return withTurso(async (turso) => {
    const res = await turso.execute({
      sql: `SELECT COUNT(*) AS n FROM system_metrics
            WHERE user_id = ? AND metric_name = 'timeline_status_update' AND feature = ?
              AND metadata LIKE ? AND metadata LIKE ?`,
      args: [userId, feature, `%"from":"${from}"%`, `%"to":"${to}"%`],
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

test.describe('AI status state machine: Selesai + transisi invalid (Dafa)', () => {
  let session: MintedSession;
  let baselineIds: string[] = [];
  let baseline: Record<string, number> = {};
  /** Status asli demo-tl-4 yang DIBACA saat runtime (restore drift-proof). */
  const originalStatus: { value: string } = { value: 'new' };

  test.beforeAll(async () => {
    session = await mintSessionCookieForEmail(DEMO_EMAIL);
    await ensureUsersRow(session.userId);
    baselineIds = await listSystemMetricIds(session.userId);
    baseline = {
      newToCompleted: await countStatusTransition(session.userId, 'insight', 'new', 'completed'),
      completedToDismissed: await countStatusTransition(session.userId, 'insight', 'completed', 'dismissed'),
    };
    // Setup deterministik: baca status asli lalu pastikan 'new' — alur Selesai
    // dari 'new'→completed (state machine P9 §12). Bila reset gagal, status yang
    // sudah dibaca langsung dikembalikan — tidak ada mutasi bocor walau error.
    try {
      const status = await timelineStatus(EVENT_ID);
      expect(status, `event ${EVENT_ID} harus ada di ai_timeline (seed demo)`).not.toBeNull();
      originalStatus.value = status as string;
      if (status !== 'new') await setTimelineStatus(EVENT_ID, 'new');
    } catch (error) {
      await setTimelineStatus(EVENT_ID, originalStatus.value);
      throw error;
    }
  });

  test.afterAll(async () => {
    // Restore status demo ke nilai yang DIBACA saat runtime (bukan hardcode).
    await setTimelineStatus(EVENT_ID, originalStatus.value);
    await cleanupNewMetrics(session.userId, baselineIds);
    await cleanupTestSessions();
  });

  test.beforeEach(async ({ context }) => {
    await setupAuthContext(context, session);
  });

  test('tandai Selesai (new→completed) + transisi invalid completed→dismissed ditolak 400', async ({ page, context }) => {
    const pageErrors = collectPageErrors(page);

    // ── Buka halaman AI Timeline, filter Insights (anti-flake pagination) ──
    await page.goto('/ai/timeline', { waitUntil: 'domcontentloaded' });
    await expect(page.getByRole('heading', { name: /Perjalanan finansialmu bersama AI/ })).toBeVisible({ timeout: 15_000 });
    await page.getByRole('button', { name: FILTER_INSIGHT }).click();

    // ── 1. Tandai Selesai via UI ──
    const selesaiBtn = page.getByRole('button', { name: `Tandai selesai ${EVENT_TITLE}` });
    await expect(selesaiBtn).toBeVisible({ timeout: 15_000 });
    await selesaiBtn.click();

    // DB: status new → completed.
    await expect
      .poll(async () => (await timelineStatus(EVENT_ID)) === 'completed', {
        message: 'demo-tl-4 harus new → completed setelah tandai Selesai',
      })
      .toBe(true);

    // Observability: timeline_status_update {from:new, to:completed} feature=insight.
    await expect
      .poll(async () => (await countStatusTransition(session.userId, 'insight', 'new', 'completed')) > baseline.newToCompleted, {
        message: 'timeline_status_update {from:new, to:completed} untuk insight harus tercatat',
      })
      .toBe(true);

    // UI: badge "Selesai" muncul & tombol aksi hilang (completed = final).
    // Reload dulu — status UI diambil FRESH dari server. Optimistic update bisa
    // dikalahkan response stale load() (StrictMode dev double-mount memicu 2×
    // fetch 'all' + fetch filter; tanpa guard stale-response, response lama yang
    // tiba belakangan menimpa status 'completed' kembali ke 'new'). Verifikasi
    // via reload menghilangkan ketergantungan pada timing tersebut — yang di-lock
    // adalah KONTRAK UI terhadap server truth, bukan transient state.
    await page.reload({ waitUntil: 'domcontentloaded' });
    await expect(page.getByRole('heading', { name: /Perjalanan finansialmu bersama AI/ })).toBeVisible({ timeout: 15_000 });
    await page.getByRole('button', { name: FILTER_INSIGHT }).click();
    // completed = final → tombol aksi (hanya render saat new|viewed) hilang.
    await expect(page.getByRole('button', { name: `Tandai selesai ${EVENT_TITLE}` })).toBeHidden({ timeout: 15_000 });
    await expect(page.getByRole('button', { name: `Buang ${EVENT_TITLE}` })).toBeHidden();
    // Badge status "Selesai" tampil di kartu event (chip STATUS_META.completed).
    const detailBtn = page.getByRole('button', { name: `Lihat detail ${EVENT_TITLE}` });
    await expect(detailBtn).toBeVisible();
    const card = detailBtn.locator('xpath=ancestor::div[contains(@class,"rounded")]').first();
    await expect(card.getByText('Selesai')).toBeVisible();

    // ── 2. Transisi INVALID: completed → dismissed (final) → 400 ──
    const res = await context.request.patch(`/api/ai-product/timeline/${EVENT_ID}/status`, {
      data: { status: 'dismissed' },
    });
    expect(res.status()).toBe(400);
    const body = (await res.json()) as { error?: string; errorCode?: string; details?: string[] };
    expect(body.errorCode).toBe('VALIDATION_ERROR');
    expect(body.details?.[0]).toContain('Tidak bisa mengubah status');

    // DB TIDAK berubah (tetap completed) & TIDAK ada metric completed→dismissed.
    expect(await timelineStatus(EVENT_ID)).toBe('completed');
    await expect
      .poll(async () => (await countStatusTransition(session.userId, 'insight', 'completed', 'dismissed')) === baseline.completedToDismissed, {
        message: 'transisi invalid TIDAK boleh mencatat timeline_status_update',
      })
      .toBe(true);

    // ── Evidence summary (dicetak sebelum afterAll cleanup) ──
    const evidence = {
      userId: session.userId,
      timeline: { [EVENT_ID]: await timelineStatus(EVENT_ID) },
      statusTransitions: {
        newToCompleted: await countStatusTransition(session.userId, 'insight', 'new', 'completed'),
        completedToDismissed: await countStatusTransition(session.userId, 'insight', 'completed', 'dismissed'),
      },
      invalidPatchStatus: res.status(),
      invalidPatchBody: body,
    };
    // eslint-disable-next-line no-console
    console.log('EVIDENCE_AI_STATUS_MACHINE ' + JSON.stringify(evidence));

    pageErrors.expectClean();
  });
});
