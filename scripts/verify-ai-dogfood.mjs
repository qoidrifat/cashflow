/**
 * Verification script — AI Dogfood Pipeline (one-command regression guard)
 *
 * Mengunci pipeline observability AI pada level API — komplemen dari
 * e2e/ai-dogfood.spec.ts (yang menguji UI browser). Alur yang sama di-drive
 * via fetch + cookie sesi Better Auth:
 *
 *   1. Mint sesi user demo (demo@cashflow.test — Dafa; dibuat bila belum ada)
 *   2. Seed 1 timeline event (feature advisor → event_type recommendation)
 *   3. AI Hub exposure      → POST /track ai_hub_view          → system_metrics +1
 *   4. Timeline list        → GET /timeline + track recommendation_shown → +1
 *   5. Detail view          → GET /timeline/:id + track recommendation_opened → +1
 *   6. Feedback 👍          → POST /feedback rating helpful    → ai_feedback +1
 *   7. ai_result_shown      → POST /track                      → system_metrics +1
 *   8. Status state machine → PATCH new→viewed                 → DB status viewed
 *
 * Verifikasi delta LANGSUNG di Turso (bukan hanya status HTTP) — sehingga
 * script benar-benar mengunci jalur POST /track → system_metrics dan
 * POST /feedback → ai_feedback (bukan sekadar "endpoint tidak 500").
 * Delta di-poll (8s/200ms) karena recordSystemMetric bersifat NON-BLOCKING
 * (INSERT async setelah respons — pola expect.poll e2e).
 *
 * Self-cleaning: cleanup-in-finally menghapus event timeline, feedback terkait,
 * SEMUA system_metrics baru user (id ∉ baseline) dan sesi yang di-mint —
 * dataset demo Dafa (id baseline) tidak pernah disentuh. Self-heal di awal
 * menghapus sisa run mati (marker title 'Verify Dogfood%') agar repeatable.
 *
 * Jalankan (API server harus aktif — `npm run dev:server` di server/):
 *   node scripts/verify-ai-dogfood.mjs [--port 5181]
 *   npm run verify:ai-dogfood
 *
 * Exit code 0 = seluruh langkah PASS.
 * Referensi kontrak: docs/ai-product/PRODUCT_METRICS.md (event registry),
 * e2e/ai-dogfood.spec.ts (alur browser yang sama).
 */
import fs from 'node:fs';
import path from 'node:path';
import { createClient } from '@libsql/client';
import { mintSessionCookieForEmail } from '../e2e/helpers/mintSession.ts';

const PORT = process.argv.includes('--port') ? Number(process.argv[process.argv.indexOf('--port') + 1]) : 5181;
const BASE_URL = `http://localhost:${PORT}`;
const COOKIE_NAME = 'better-auth.session_token';

/** Email seed user Dafa (scripts/seedDemoData.mjs — DEMO_EMAIL). */
const DEMO_EMAIL = 'demo@cashflow.test';
/** Marker title — dasar self-heal & asersi unik (tidak bentrok dataset demo). */
const EVENT_TITLE = `Verify Dogfood ${Date.now()}`;

function loadEnv() {
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

/** Mint Turso client (env sudah di-load). */
function openTurso() {
  return createClient({
    url: process.env.TURSO_DATABASE_URL,
    authToken: process.env.TURSO_AUTH_TOKEN,
  });
}

/** Count system_metrics user untuk satu metric_name. */
async function countMetric(turso, userId, metricName) {
  const r = await turso.execute({
    sql: 'SELECT COUNT(*) AS n FROM system_metrics WHERE user_id = ? AND metric_name = ?',
    args: [userId, metricName],
  });
  return Number(r.rows[0]?.n) || 0;
}

/** Count ai_feedback user untuk (item_id, rating). */
async function countFeedback(turso, userId, itemId, rating) {
  const r = await turso.execute({
    sql: 'SELECT COUNT(*) AS n FROM ai_feedback WHERE user_id = ? AND item_id = ? AND rating = ?',
    args: [userId, itemId, rating],
  });
  return Number(r.rows[0]?.n) || 0;
}

/** Snapshot id system_metrics user — dasar cleanup (hapus hanya baris baru). */
async function listSystemMetricIds(turso, userId) {
  const r = await turso.execute({
    sql: 'SELECT id FROM system_metrics WHERE user_id = ?',
    args: [userId],
  });
  return r.rows.map((row) => String(row.id));
}

/** Self-heal: hapus sisa run VERIFIKASI sebelumnya yang mati sebelum cleanup. */
async function cleanupStaleRows(turso, userId) {
  await turso.execute({
    sql: `DELETE FROM ai_feedback WHERE item_id IN (
            SELECT id FROM ai_timeline
            WHERE user_id = ? AND title LIKE 'Verify Dogfood%'
          )`,
    args: [userId],
  });
  await turso.execute({
    sql: `DELETE FROM ai_timeline WHERE user_id = ? AND title LIKE 'Verify Dogfood%'`,
    args: [userId],
  });
}

/** Cleanup-in-finally: event + feedback + metrics baru + sesi minted. Idempoten. */
async function cleanupData(turso, { userId, eventId, baselineIds, token }) {
  if (eventId) {
    await turso.execute({ sql: 'DELETE FROM ai_feedback WHERE item_id = ?', args: [eventId] });
    await turso.execute({ sql: 'DELETE FROM ai_timeline WHERE id = ?', args: [eventId] });
  }
  if (userId) {
    if (baselineIds.length === 0) {
      // User demo fresh (baru dibuat) → semua metrics = milik run ini.
      await turso.execute({ sql: 'DELETE FROM system_metrics WHERE user_id = ?', args: [userId] });
    } else {
      const placeholders = baselineIds.map(() => '?').join(',');
      await turso.execute({
        sql: `DELETE FROM system_metrics WHERE user_id = ? AND id NOT IN (${placeholders})`,
        args: [userId, ...baselineIds],
      });
    }
  }
  if (token) {
    await turso.execute({ sql: 'DELETE FROM session WHERE token = ?', args: [token] });
  }
}

/** GET/POST dengan cookie — helper fetch tunggal. */
async function api(pathname, { method = 'GET', body, cookie } = {}) {
  const headers = {};
  if (cookie) headers.Cookie = `${COOKIE_NAME}=${cookie}`;
  if (body !== undefined) headers['Content-Type'] = 'application/json';
  return fetch(`${BASE_URL}${pathname}`, { method, headers, body: body !== undefined ? JSON.stringify(body) : undefined });
}

/**
 * Poll hingga kondisi terpenuhi (pola expect.poll e2e).
 * recordSystemMetric bersifat NON-BLOCKING (INSERT async setelah respons) →
 * count sinkron bisa kalah balapan; polling menghapus flakiness tanpa timing
 * magic. Default 8s / 200ms.
 */
async function waitFor(cond, { timeoutMs = 8000, intervalMs = 200 } = {}) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    if (await cond()) return true;
    await new Promise((resolve) => setTimeout(resolve, intervalMs));
  }
  return (await cond()) || false;
}

async function main() {
  loadEnv();

  // Pre-flight (DX): API server harus aktif. Error sebelum mint → pesan jelas
  // (bukan raw fetch error yang membingungkan).
  try {
    const health = await fetch(`${BASE_URL}/api/health`);
    if (!health.ok) throw new Error(`HTTP ${health.status}`);
  } catch {
    console.error(`API server tidak aktif di ${BASE_URL} — jalankan \`npm run dev:server\` (di server/) lalu ulangi.`);
    process.exit(1);
  }

  const turso = openTurso();

  /** Konteks yang di-cleanup di finally. */
  const ctx = { userId: null, eventId: null, baselineIds: [], token: null };

  /** Riwayat langkah: [name, detail, ok]. */
  const steps = [];
  const record = (name, detail, ok) => steps.push([name, detail, ok]);

  /**
   * Jalankan langkah bila seed sukses; bila seed gagal, langkah berikutnya
   * dicatat FAIL '(seed gagal — dilewati)' — TANPA throw, sehingga tabel
   * langkah selalu tercetak (diagnostik guard tidak hilang).
   */
  const step = async (name, fn) => {
    if (!ctx.eventId) {
      record(name, '(seed gagal — dilewati)', false);
      return;
    }
    await fn();
  };

  let session;
  try {
    // ── 1. Mint sesi demo user (dibuat bila belum ada — CI) ──
    session = await mintSessionCookieForEmail(DEMO_EMAIL);
    ctx.userId = session.userId;
    ctx.token = session.cookie.split('.')[0];

    // Sinkronkan `users` (plural — FK tabel bisnis ai_timeline/ai_feedback);
    // idempoten ON CONFLICT (Dafa lokal sudah ada dari seedDemoData).
    await turso.execute({
      sql: `INSERT INTO users (id, email, name, display_name)
            VALUES (?, ?, 'Dafa Preview', 'Dafa Preview')
            ON CONFLICT(id) DO NOTHING`,
      args: [session.userId, DEMO_EMAIL],
    });

    // Self-heal sisa run mati + baseline SEBELUM flow.
    await cleanupStaleRows(turso, session.userId);
    ctx.baselineIds = await listSystemMetricIds(turso, session.userId);
    const base = {
      hub: await countMetric(turso, session.userId, 'ai_hub_view'),
      shown: await countMetric(turso, session.userId, 'recommendation_shown'),
      opened: await countMetric(turso, session.userId, 'recommendation_opened'),
      result: await countMetric(turso, session.userId, 'ai_result_shown'),
    };

    // ── 2. Seed 1 rekomendasi via POST /timeline (feature advisor → recommendation) ──
    const seed = await api('/api/ai-product/timeline', {
      method: 'POST',
      cookie: session.cookie,
      body: {
        feature: 'advisor',
        title: EVENT_TITLE,
        body: 'Kurangi pengeluaran GoFood agar cashflow bulan ini aman.',
        confidence: 0.82,
        payload: { periodDays: 7, expense: 150000, topCategory: 'Makanan' },
      },
    });
    const seedBody = await seed.json().catch(() => null);
    const seedOk = seed.status === 201 && !!seedBody?.id;
    record('seed-timeline', seedOk ? `201 id=${seedBody.id}` : `HTTP ${seed.status} ${JSON.stringify(seedBody)}`, seedOk);
    if (seedOk) ctx.eventId = seedBody.id;

    // ── 3. AI Hub exposure → ai_hub_view +1 (poll — recorder async) ──
    await step('hub-exposure', async () => {
      const hub = await api('/api/ai-product/track', {
        method: 'POST', cookie: session.cookie, body: { event: 'ai_hub_view', feature: 'ai_hub' },
      });
      const landed = await waitFor(async () => (await countMetric(turso, session.userId, 'ai_hub_view')) > base.hub);
      const delta = (await countMetric(turso, session.userId, 'ai_hub_view')) - base.hub;
      const ok = hub.status === 200 && landed;
      record('hub-exposure', ok ? `200 ai_hub_view +${delta}` : `HTTP ${hub.status}, delta=${delta}`, ok);
    });

    // ── 4. Timeline list + recommendation_shown (denominator CTR) ──
    await step('timeline-list', async () => {
      const list = await api(`/api/ai-product/timeline?limit=50`, { cookie: session.cookie });
      const listBody = await list.json().catch(() => null);
      const ok = list.status === 200
        && Array.isArray(listBody?.items)
        && typeof listBody?.hasMore === 'boolean'
        && listBody.items.some((it) => it.id === ctx.eventId);
      record('timeline-list', ok ? '200 items incl. event' : `HTTP ${list.status}`, ok);
    });

    await step('recommendation-shown', async () => {
      const shown = await api('/api/ai-product/track', {
        method: 'POST', cookie: session.cookie,
        body: { event: 'recommendation_shown', feature: 'advisor', itemId: ctx.eventId, eventType: 'recommendation' },
      });
      const landed = await waitFor(async () => (await countMetric(turso, session.userId, 'recommendation_shown')) > base.shown);
      const delta = (await countMetric(turso, session.userId, 'recommendation_shown')) - base.shown;
      const ok = shown.status === 200 && landed;
      record('recommendation-shown', ok ? `200 +${delta}` : `HTTP ${shown.status}, delta=${delta}`, ok);
    });

    // ── 5. Detail view + recommendation_opened (numerator CTR) ──
    await step('detail-open', async () => {
      const detail = await api(`/api/ai-product/timeline/${ctx.eventId}`, { cookie: session.cookie });
      const detailBody = await detail.json().catch(() => null);
      const ok = detail.status === 200
        && detailBody?.title === EVENT_TITLE
        && Array.isArray(detailBody?.feedback)
        && Number(detailBody?.confidence) === 0.82;
      record('detail-open', ok ? '200 title+confidence+feedback[]' : `HTTP ${detail.status} ${JSON.stringify(detailBody)}`, ok);
    });

    await step('recommendation-opened', async () => {
      const opened = await api('/api/ai-product/track', {
        method: 'POST', cookie: session.cookie,
        body: { event: 'recommendation_opened', feature: 'advisor', itemId: ctx.eventId, eventType: 'recommendation' },
      });
      const landed = await waitFor(async () => (await countMetric(turso, session.userId, 'recommendation_opened')) > base.opened);
      const delta = (await countMetric(turso, session.userId, 'recommendation_opened')) - base.opened;
      const ok = opened.status === 200 && landed;
      record('recommendation-opened', ok ? `200 +${delta}` : `HTTP ${opened.status}, delta=${delta}`, ok);
    });

    // ── 6. Feedback 👍 "Membantu" → ai_feedback (rating helpful) ──
    await step('feedback-thumbs-up', async () => {
      const fb = await api('/api/ai-product/feedback', {
        method: 'POST', cookie: session.cookie,
        body: { feature: 'advisor', itemId: ctx.eventId, rating: 'helpful' },
      });
      const fbCount = await countFeedback(turso, session.userId, ctx.eventId, 'helpful');
      const ok = fb.status === 201 && fbCount >= 1;
      record('feedback-thumbs-up', ok ? `201 ai_feedback helpful=${fbCount}` : `HTTP ${fb.status}, count=${fbCount}`, ok);
    });

    // ── 7. ai_result_shown (denominator Feedback Rate) ──
    await step('ai-result-shown', async () => {
      const result = await api('/api/ai-product/track', {
        method: 'POST', cookie: session.cookie,
        body: { event: 'ai_result_shown', feature: 'advisor', itemId: ctx.eventId, eventType: 'recommendation' },
      });
      const landed = await waitFor(async () => (await countMetric(turso, session.userId, 'ai_result_shown')) > base.result);
      const delta = (await countMetric(turso, session.userId, 'ai_result_shown')) - base.result;
      const ok = result.status === 200 && landed;
      record('ai-result-shown', ok ? `200 +${delta}` : `HTTP ${result.status}, delta=${delta}`, ok);
    });

    // ── 8. Status state machine: new → viewed ──
    await step('status-new-viewed', async () => {
      const patch = await api(`/api/ai-product/timeline/${ctx.eventId}/status`, {
        method: 'PATCH', cookie: session.cookie, body: { status: 'viewed' },
      });
      const patchBody = await patch.json().catch(() => null);
      const dbStatus = await turso.execute({
        sql: 'SELECT status FROM ai_timeline WHERE id = ? AND user_id = ?',
        args: [ctx.eventId, session.userId],
      });
      const ok = patch.status === 200 && patchBody?.status === 'viewed' && dbStatus.rows[0]?.status === 'viewed';
      record('status-new-viewed', ok ? `200 DB=${dbStatus.rows[0]?.status}` : `HTTP ${patch.status}, DB=${dbStatus.rows[0]?.status}`, ok);
    });
  } finally {
    // Self-cleaning: apa pun hasilnya (PASS/FAIL/exception), tidak ada residu.
    try {
      await cleanupData(turso, ctx);
    } catch (cleanErr) {
      console.error('WARN cleanup:', cleanErr.message);
    }
    turso.close();
  }

  let allOk = true;
  console.log(`TARGET ${BASE_URL} · user=${DEMO_EMAIL} · event=${ctx.eventId || '(seed gagal)'}\n`);
  console.log('STEP                        STATUS  DETAIL');
  console.log('----                        ------  ------');
  for (const [name, detail, ok] of steps) {
    console.log(`${ok ? 'PASS' : 'FAIL'}  ${name.padEnd(24)} ${ok ? 'OK' : 'FAIL'}  ${detail}`);
    if (!ok) allOk = false;
  }
  console.log(allOk
    ? '\nALL STEPS PASS — pipeline AI dogfood sesuai kontrak (track/feedback/timeline → system_metrics + ai_feedback)'
    : '\nSOME STEPS FAILED — periksa server, kontrak & database');
  process.exit(allOk ? 0 : 1);
}

main().catch((e) => { console.error('ERR', e.message); process.exit(1); });
