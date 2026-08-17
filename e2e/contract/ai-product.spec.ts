/**
 * E2E: API Contract — namespace /api/ai-product/* (drift guard, 2026-08-09).
 *
 * Me-lock bentuk response endpoint AI product terhadap docs/api/ai-product-api.md:
 * track · feedback · memory · timeline · conversation. Bila server berubah
 * bentuk (field hilang/rename/tipe berubah) → test merah → drift terdeteksi.
 *
 * Cakupan:
 *   - Auth gate: kelima endpoint 401 tanpa cookie.
 *   - GET shape: timeline {items[],hasMore}, feedback array, memory array.
 *   - POST shape + side-effect P9: memory upsert → event memory_update di
 *     timeline; timeline create → PATCH status state machine; feedback terkait
 *     event timeline (itemId = id event, tanpa duplikat event); conversation →
 *     ConversationAnswer penuh + requestId.
 *   - Shape error §0: 400 VALIDATION_ERROR (event tak dikenal, query kosong,
 *     transisi status tidak valid).
 *
 * Hygiene: seluruh data test ditandai marker 'e2e-ai-contract-' (title/body/
 * key/item_id/reason/metadata) → cleanupAiProductFixtures() membersihkan semuanya
 * di beforeAll (delete-first idempoten) & afterAll. GET shape memakai
 * expect.poll (pola contract-check.spec.ts, anti-flaky 401 transient).
 *
 * Menjalankan:
 *   npm run test:e2e:contract:ai-product
 */
import { test, expect, type APIRequestContext, type APIResponse } from 'playwright/test';
import {
  mintSessionCookie,
  cleanupTestSessions,
  cleanupAiProductFixtures,
  type MintedSession,
} from '../helpers/mintSession';
import {
  bodyOf,
  timelineListContract,
  feedbackListContract,
  memoryListContract,
  trackPostContract,
  feedbackPostContract,
  memoryUpsertContract,
  timelinePostContract,
  timelineStatusPatchContract,
  conversationPostContract,
  validationErrorContract,
  type Contract,
} from './aiProductContracts';

/** Marker unik — seluruh side-effect spec memuat string ini agar bisa dibersihkan. */
const MARKER = 'e2e-ai-contract';

/** Id unik per attempt (retries) → prevent PK collision antar attempt. */
function uid(prefix: string): string {
  return `${MARKER}-${prefix}-${Date.now().toString(36)}${Math.floor(Math.random() * 1e6).toString(36)}`;
}

const cookieHeader = (cookie: string) => ({ Cookie: `better-auth.session_token=${cookie}` });

async function getWithCookie(
  request: APIRequestContext,
  pathname: string,
  cookie: string,
): Promise<APIResponse> {
  return request.get(pathname, { headers: cookieHeader(cookie) });
}

async function postJson(
  request: APIRequestContext,
  pathname: string,
  body: Record<string, unknown>,
  cookie: string,
): Promise<APIResponse> {
  return request.post(pathname, {
    headers: { 'Content-Type': 'application/json', ...cookieHeader(cookie) },
    data: body,
  });
}

async function patchJson(
  request: APIRequestContext,
  pathname: string,
  body: Record<string, unknown>,
  cookie: string,
): Promise<APIResponse> {
  return request.patch(pathname, {
    headers: { 'Content-Type': 'application/json', ...cookieHeader(cookie) },
    data: body,
  });
}

/** GET contract check dengan expect.poll (anti-flaky 401 transient saat blip Turso). */
async function checkContract(
  request: APIRequestContext,
  contract: Contract,
  pathname: string,
  cookie: string,
): Promise<void> {
  await expect
    .poll(
      async () => {
        const resp = await getWithCookie(request, pathname, cookie);
        if (resp.status() !== 200) return false;
        return contract.validate(await bodyOf(resp));
      },
      { timeout: 12_000, intervals: [150, 300, 600, 1200], message: `${contract.label} harus 200 + sesuai kontrak. Diharapkan: ${contract.describe()}` },
    )
    .toBe(true);
}

test.describe('API contract — /api/ai-product/* (drift guard)', () => {
  let session: MintedSession;

  test.beforeAll(async () => {
    // Delete-first (idempoten): bersihkan leftover run gagal sebelum test.
    await cleanupAiProductFixtures();
    session = await mintSessionCookie();
  });

  test.afterAll(async () => {
    await cleanupAiProductFixtures();
    await cleanupTestSessions();
  });

  test('auth gate — kelima endpoint 401 tanpa cookie', async ({ request }) => {
    for (const path of ['/api/ai-product/timeline', '/api/ai-product/feedback', '/api/ai-product/memory']) {
      const res = await request.get(path);
      expect(res.status(), `GET ${path}`).toBe(401);
      expect(typeof (await bodyOf(res) as { error?: unknown }).error).toBe('string');
    }
    const postCases: Array<[string, Record<string, unknown>]> = [
      ['/api/ai-product/track', { event: 'ai_hub_view' }],
      ['/api/ai-product/feedback', { feature: 'insight', rating: 'helpful' }],
      ['/api/ai-product/memory', { category: 'note', key: 'x', value: 'y' }],
      ['/api/ai-product/timeline', { feature: 'insight', title: 't' }],
      ['/api/ai-product/conversation', { query: 'q' }],
    ];
    for (const [path, body] of postCases) {
      const res = await request.post(path, { data: body });
      expect(res.status(), `POST ${path}`).toBe(401);
    }
  });

  test('GET timeline — { items[], hasMore } + field wajib event', async ({ request }) => {
    await checkContract(request, timelineListContract, '/api/ai-product/timeline?limit=5', session.cookie);
  });

  test('GET feedback — array row (id,feature,item_id,rating,reason,created_at)', async ({ request }) => {
    await checkContract(request, feedbackListContract, '/api/ai-product/feedback?limit=5', session.cookie);
  });

  test('GET memory — array row (id,category,key,value,source,created_at,updated_at)', async ({ request }) => {
    await checkContract(request, memoryListContract, '/api/ai-product/memory', session.cookie);
  });

  test('POST track → 200 { ok:true } (telemetry non-PII)', async ({ request }) => {
    const res = await postJson(request, '/api/ai-product/track', {
      event: 'ai_result_shown',
      feature: 'insight',
      itemId: uid('track'),
      eventType: 'insight',
    }, session.cookie);
    expect(res.status()).toBe(200);
    expect(trackPostContract.validate(await bodyOf(res))).toBe(true);
  });

  test('POST track — event tak dikenal → 400 VALIDATION_ERROR (§0, fail-closed)', async ({ request }) => {
    const res = await postJson(request, '/api/ai-product/track', { event: 'evil_event' }, session.cookie);
    expect(res.status()).toBe(400);
    expect(validationErrorContract.validate(await bodyOf(res))).toBe(true);
  });

  test('POST memory upsert → { id, ok } + side-effect event memory_update (P9 §14)', async ({ request }) => {
    const key = uid('mem');
    const res = await postJson(request, '/api/ai-product/memory', {
      category: 'note',
      key,
      value: `${MARKER} value`,
    }, session.cookie);
    expect(res.status()).toBe(200);
    const body = await bodyOf(res);
    expect(memoryUpsertContract.validate(body)).toBe(true);

    // Side effect P9: event memory_update muncul di timeline (fire-and-forget,
    // body berisi key unik spec) — mengunci kontrak side-effect.
    await expect
      .poll(
        async () => {
          const resp = await getWithCookie(request, '/api/ai-product/timeline?limit=100', session.cookie);
          if (resp.status() !== 200) return false;
          const list = await bodyOf(resp) as { items?: Array<{ event_type?: string; body?: string }> };
          return (list.items ?? []).some(
            (i) => i.event_type === 'memory_update' && (i.body ?? '').includes(key),
          );
        },
        { timeout: 10_000, intervals: [150, 300, 600, 1200], message: 'event memory_update harus muncul di timeline setelah upsert memory' },
      )
      .toBe(true);
  });

  test('POST timeline → 201 { id, ok, event_type } + PATCH status state machine (§0)', async ({ request }) => {
    const title = uid('tl');
    const res = await postJson(request, '/api/ai-product/timeline', {
      feature: 'insight',
      title,
      body: `${MARKER} body`,
      confidence: 0.8,
    }, session.cookie);
    expect(res.status()).toBe(201);
    const body = await bodyOf(res);
    expect(timelinePostContract.validate(body)).toBe(true);
    const eventId = (body as { id: string }).id;
    expect((body as { event_type: string }).event_type).toBe('insight');

    // Transisi valid: new → completed (state machine P9 §12).
    const patch = await patchJson(request, `/api/ai-product/timeline/${eventId}/status`, { status: 'completed' }, session.cookie);
    expect(patch.status()).toBe(200);
    expect(timelineStatusPatchContract.validate(await bodyOf(patch))).toBe(true);
    expect(await bodyOf(patch)).toMatchObject({ success: true, id: eventId, status: 'completed' });

    // Transisi tak valid: completed (final) → viewed → 400 VALIDATION_ERROR.
    const bad = await patchJson(request, `/api/ai-product/timeline/${eventId}/status`, { status: 'viewed' }, session.cookie);
    expect(bad.status()).toBe(400);
    expect(validationErrorContract.validate(await bodyOf(bad))).toBe(true);
  });

  test('POST feedback → 201 { id, ok } terkait event timeline (P9 §13, tanpa duplikat)', async ({ request }) => {
    // Buat timeline event dulu → itemId = id event (korelasi feedback-event).
    const tl = await postJson(request, '/api/ai-product/timeline', {
      feature: 'insight',
      title: uid('fb-tl'),
    }, session.cookie);
    expect(tl.status()).toBe(201);
    const eventId = (await bodyOf(tl) as { id: string }).id;

    const res = await postJson(request, '/api/ai-product/feedback', {
      feature: 'insight',
      itemId: eventId,
      rating: 'helpful',
      reason: `${MARKER} reason`,
    }, session.cookie);
    expect(res.status()).toBe(201);
    expect(feedbackPostContract.validate(await bodyOf(res))).toBe(true);

    // Detail timeline menampilkan feedback terkait (P9 §13 — feedback row
    // sudah di-INSERT sebelum 201, deterministik).
    const detail = await getWithCookie(request, `/api/ai-product/timeline/${eventId}`, session.cookie);
    expect(detail.status()).toBe(200);
    const detailBody = await bodyOf(detail) as { feedback?: Array<{ rating?: string }> };
    expect(Array.isArray(detailBody.feedback)).toBe(true);
    expect(detailBody.feedback?.some((f) => f.rating === 'helpful')).toBe(true);
  });

  test('POST conversation → 200 ConversationAnswer (shape §5) + requestId + side-effect timeline', async ({ request }) => {
    const query = uid('conv');
    const res = await postJson(request, '/api/ai-product/conversation', {
      query,
      periodDays: 7,
    }, session.cookie);
    expect(res.status()).toBe(200);
    const body = await bodyOf(res);
    expect(conversationPostContract.validate(body)).toBe(true);
    expect(typeof (body as { requestId?: unknown }).requestId).toBe('string');

    // Side effect P9: event conversation (title = query) muncul di timeline
    // (fire-and-forget) — mengunci kontrak side-effect + memastikan afterAll
    // cleanup berjalan setelah INSERT selesai (deterministik).
    await expect
      .poll(
        async () => {
          const resp = await getWithCookie(request, '/api/ai-product/timeline?limit=100', session.cookie);
          if (resp.status() !== 200) return false;
          const list = await bodyOf(resp) as { items?: Array<{ event_type?: string; title?: string }> };
          return (list.items ?? []).some(
            (i) => i.event_type === 'conversation' && (i.title ?? '').includes(query),
          );
        },
        { timeout: 10_000, intervals: [150, 300, 600, 1200], message: 'event conversation harus muncul di timeline setelah POST conversation' },
      )
      .toBe(true);
  });

  test('POST conversation — query kosong → 400 VALIDATION_ERROR (§0)', async ({ request }) => {
    const res = await postJson(request, '/api/ai-product/conversation', { query: '   ' }, session.cookie);
    expect(res.status()).toBe(400);
    expect(validationErrorContract.validate(await bodyOf(res))).toBe(true);
  });
});
