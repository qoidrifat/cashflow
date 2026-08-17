/**
 * E2E: Dogfood alur Natural Conversation (Sprint 1.5 — P8) memakai seed user
 * Dafa (demo@cashflow.test) — repeatable di CI.
 *
 * Alur yang di-dogfood (UI path persis seperti user):
 *   1. AI Hub (/ai) — kartu insight menampilkan CTA "Tanya AI" (Link → /ai/chat).
 *   2. /ai/chat (AiConversationPage) — ketik pertanyaan finansial → Kirim.
 *   3. Jawaban kaya (ConversationAnswer): Ringkasan → angka kunci → grafik →
 *      kategori → transaksi → insight → aksi + **trust meta** (AiTrustMeta:
 *      sumber "Didukung Gemini AI" ATAU "Aturan lokal (deterministik)" —
 *      whichever path yang terjadi live; keduanya sah, yang DI-KUNCI adalah
 *      meta menampilkan sumber yang benar).
 *   4. Telemetry: ai_conversation_started/completed (+metadata source &
 *      fallback flag) di system_metrics.
 *   5. Timeline: event feature=conversation (event_type 'conversation',
 *      confidence 0.8, title = query) tercatat fire-and-forget.
 *
 * Verifikasi LANGSUNG di DB (system_metrics + ai_timeline) — bukan hanya UI.
 * Sumber jawaban (gemini vs rule-based) TIDAK di-pin: bergantung ketersediaan
 * Vertex AI. Yang DI-KUNCI adalah konsistensi: label trust meta UI HARUS sama
 * dengan metadata telemetry `source` (trust yang jujur — bug yang membuat UI
 * selalu menampilkan "Didukung Gemini AI" padahal server fallback rule-based
 * akan GAGAL di asersi ini).
 * Catatan fallback: jalur rule-based TIDAK di-exercise live (Gemini jalan saat
 * run); jalur itu di-lock unit test conversationAggregator.test.ts, dan asersi
 * `fallback` boolean di metadata membuktikan flag mekanismenya hidup.
 *
 * User Dafa: email demo@cashflow.test (scripts/seedDemoData.mjs). Spec ini
 * SELF-SUFFICIENT (mintSessionCookieForEmail membuat user bila belum ada).
 * Hanya data MILIK spec ini yang dibersihkan (event timeline + system_metrics
 * baru) — dataset demo Dafa tidak pernah disentuh.
 *
 * Menjalankan:
 *   npx playwright test e2e/ai-conversation.spec.ts
 *   npm run test:e2e:ai-conversation
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
/** Query unik per run — sekaligus marker title event timeline untuk cleanup. */
const QUERY = `Kategori apa yang paling boros bulan ini? (E2E Chat ${Date.now()})`;

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

/** Jumlah baris system_metrics user untuk satu metric_name. */
async function countMetric(userId: string, metricName: string): Promise<number> {
  return withTurso(async (turso) => {
    const res = await turso.execute({
      sql: 'SELECT COUNT(*) AS n FROM system_metrics WHERE user_id = ? AND metric_name = ?',
      args: [userId, metricName],
    });
    return Number(res.rows[0]?.n) || 0;
  });
}

/** Jumlah event timeline conversation user dengan title persis (per run unik). */
async function countConversationEvent(userId: string): Promise<number> {
  return withTurso(async (turso) => {
    const res = await turso.execute({
      sql: `SELECT COUNT(*) AS n FROM ai_timeline
            WHERE user_id = ? AND feature = 'conversation' AND title = ?`,
      args: [userId, QUERY],
    });
    return Number(res.rows[0]?.n) || 0;
  });
}

/** Metadata telemetry ai_conversation_completed BARU (id ∉ baseline) — terbaru. */
async function latestCompletedMetadata(userId: string, baselineIds: string[]): Promise<{ source?: string; fallback?: boolean } | null> {
  return withTurso(async (turso) => {
    let sql: string;
    let args: Array<string | number>;
    if (baselineIds.length === 0) {
      sql = `SELECT metadata FROM system_metrics
             WHERE user_id = ? AND metric_name = 'ai_conversation_completed'
             ORDER BY rowid DESC LIMIT 1`;
      args = [userId];
    } else {
      const placeholders = baselineIds.map(() => '?').join(',');
      sql = `SELECT metadata FROM system_metrics
             WHERE user_id = ? AND metric_name = 'ai_conversation_completed'
               AND id NOT IN (${placeholders})
             ORDER BY rowid DESC LIMIT 1`;
      args = [userId, ...baselineIds];
    }
    const res = await turso.execute({ sql, args });
    const raw = res.rows[0]?.metadata;
    if (!raw) return null;
    try { return JSON.parse(String(raw)); } catch { return null; }
  });
}

/** Snapshot id system_metrics user SEBELUM flow — dasar cleanup (hapus hanya baris baru). */
async function listSystemMetricIds(userId: string): Promise<string[]> {
  return withTurso(async (turso) => {
    const res = await turso.execute({
      sql: 'SELECT id FROM system_metrics WHERE user_id = ?',
      args: [userId],
    });
    return res.rows.map((r) => String(r.id));
  });
}

/**
 * Self-heal: hapus sisa run SEBELUMNYA yang mati sebelum afterAll (marker title
 * 'E2E Chat%'). Tanpa ini, event stale bisa mengganggu hitungan & top-5 kartu
 * timeline. Idempoten (0 row bila bersih).
 */
async function cleanupStaleChatRows(): Promise<void> {
  await withTurso(async (turso) => {
    await turso.execute({
      sql: `DELETE FROM ai_feedback WHERE item_id IN (
              SELECT id FROM ai_timeline
              WHERE user_id = (SELECT id FROM user WHERE email = ?)
                AND title LIKE 'E2E Chat%'
            )`,
      args: [DEMO_EMAIL],
    });
    await turso.execute({
      sql: `DELETE FROM ai_timeline
            WHERE user_id = (SELECT id FROM user WHERE email = ?)
              AND title LIKE 'E2E Chat%'`,
      args: [DEMO_EMAIL],
    });
  });
}

/** Pastikan baris `users` (plural) ada untuk Dafa (FK tabel bisnis). */
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

/**
 * Cleanup data dogfood: event timeline + feedback terkait + SEMUA system_metrics
 * baru user (id ∉ baseline) — deterministic. Dataset demo Dafa tidak dihapus.
 */
async function cleanupChatData(userId: string, baselineIds: string[]): Promise<void> {
  await withTurso(async (turso) => {
    // Feedback terkait event dulu (FK), lalu event itu sendiri — defensif:
    // saat ini spec tidak mengklik feedback, tapi jaga simetri ai-dogfood.
    await turso.execute({
      sql: `DELETE FROM ai_feedback WHERE item_id IN (
              SELECT id FROM ai_timeline WHERE user_id = ? AND feature = 'conversation' AND title = ?
            )`,
      args: [userId, QUERY],
    });
    await turso.execute({
      sql: `DELETE FROM ai_timeline WHERE user_id = ? AND feature = 'conversation' AND title = ?`,
      args: [userId, QUERY],
    });
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

// Gemini live bisa lambat (timeout server Vertex ~30s) + asersi bertingkat:
// timeout spec 90s memberi margin atas konfigurasi test default 60s — tanpa
// risiko flake teoritis saat Gemini lambat (fallback rule-based instan).
test.describe('AI Conversation flow (Dafa — P8)', () => {
  test.setTimeout(90_000);
  let session: MintedSession;
  let baselineIds: string[] = [];
  let baselineCompleted = 0;

  test.beforeAll(async () => {
    await cleanupStaleChatRows();
    session = await mintSessionCookieForEmail(DEMO_EMAIL);
    await ensureUsersRow(session.userId);
    baselineIds = await listSystemMetricIds(session.userId);
    baselineCompleted = await countMetric(session.userId, 'ai_conversation_completed');
  });

  test.afterAll(async () => {
    await cleanupChatData(session.userId, baselineIds);
    await cleanupTestSessions();
  });

  test.beforeEach(async ({ context }) => {
    await setupAuthContext(context, session);
  });

  test('AI Hub → Tanya AI → /ai/chat → pertanyaan → jawaban + trust meta + telemetry + timeline event', async ({ page }) => {
    const pageErrors = collectPageErrors(page);

    // ── 1. AI Hub (/ai): kartu insight menampilkan CTA "Tanya AI" ──
    await page.goto('/ai', { waitUntil: 'domcontentloaded' });
    await expect(page.getByRole('heading', { name: 'Dashboard keuangan cerdas kamu' })).toBeVisible({ timeout: 20_000 });
    const tanyaAi = page.getByRole('link', { name: 'Tanya AI' });
    await expect(tanyaAi).toBeVisible();

    // ── 2. Klik "Tanya AI" → /ai/chat ──
    await tanyaAi.click();
    await expect(page).toHaveURL(/\/ai\/chat/);
    await expect(page.getByRole('heading', { name: 'Tanya keuanganmu dengan bahasa sehari-hari' })).toBeVisible({ timeout: 20_000 });

    // ── 3. Ketik pertanyaan → Kirim ──
    await page.getByLabel('Pertanyaan finansial').fill(QUERY);
    await page.getByRole('button', { name: 'Kirim' }).click();

    // Jawaban kaya: Ringkasan (label kartu summary — /Ringkasan ·/ tidak bisa
    // false-match subtitle hero yang lowercase 'ringkasan') + angka kunci.
    // Gemini bisa lambat (fallback rule-based instan) — timeout longgar & keduanya sah.
    await expect(page.getByText(/Ringkasan ·/).first()).toBeVisible({ timeout: 45_000 });
    await expect(page.getByText('Pengeluaran', { exact: false }).first()).toBeVisible({ timeout: 20_000 });

    // ── 4. Trust meta: sumber Gemini ATAU rule-based (whichever live) + dataCoverage ──
    const sourceLabel = page.getByText('Didukung Gemini AI').or(page.getByText('Aturan lokal (deterministik)'));
    await expect(sourceLabel).toBeVisible({ timeout: 20_000 });
    await expect(page.getByText(/Transaksi 30 hari|Belum ada transaksi/, { exact: false }).first()).toBeVisible({ timeout: 20_000 });

    // ── 5. Telemetry: ai_conversation_completed bertambah (recordSystemMetric async → poll) ──
    await expect
      .poll(async () => (await countMetric(session.userId, 'ai_conversation_completed')) > baselineCompleted, {
        message: 'ai_conversation_completed harus bertambah setelah percakapan selesai',
      })
      .toBe(true);

    // Konsistensi (kontrak "trust yang jujur"): label trust meta UI HARUS cocok
    // dengan metadata telemetry source — UI tidak boleh berbohong tentang jalur
    // pipeline yang benar-benar berjalan.
    const uiSource = (await page.getByText('Didukung Gemini AI').isVisible()) ? 'gemini' : 'rule-based';
    const meta = await latestCompletedMetadata(session.userId, baselineIds);
    expect(meta, 'ai_conversation_completed metadata harus ada').not.toBeNull();
    expect(meta?.source).toBe(uiSource);
    expect(typeof meta?.fallback).toBe('boolean');

    // ── 6. Timeline: event conversation (title=query, confidence 0.8) tercatat ──
    await expect
      .poll(async () => (await countConversationEvent(session.userId)) >= 1, {
        message: 'event timeline conversation harus tercatat (fire-and-forget)',
      })
      .toBe(true);

    // Detail event: event_type conversation + confidence 0.8 + status new.
    await withTurso(async (turso) => {
      const res = await turso.execute({
        sql: `SELECT event_type, status, confidence FROM ai_timeline
              WHERE user_id = ? AND feature = 'conversation' AND title = ?`,
        args: [session.userId, QUERY],
      });
      expect(res.rows.length).toBeGreaterThanOrEqual(1);
      expect(res.rows[0]?.event_type).toBe('conversation');
      expect(res.rows[0]?.status).toBe('new');
      expect(Number(res.rows[0]?.confidence)).toBe(0.8);
    });

    pageErrors.expectClean();
  });
});
