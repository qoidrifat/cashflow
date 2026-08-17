/**
 * Unit test: POST /api/admin/users/:id/suspend (2026-08-09).
 *
 * Endpoint admin security — logout paksa: hapus SEMUA sesi user (tabel
 * `session` WHERE userId) + tulis admin_audit_log dalam SATU batch atomik.
 * Pola harness adminFeedbackSummary.test.ts (fake app + req/res):
 *   - 401 tanpa user, 403 non-admin (gate resolveAdmin dipertahankan).
 *   - 400 id kosong / >191 char (fail-closed) & self-suspend (jangan revoke
 *     sesi admin sendiri lewat endpoint).
 *   - 404 user tidak ada (lookup tabel `user`) — batch TIDAK dipanggil.
 *   - 200 admin: batch = [INSERT audit (subquery COUNT pra-revoke), DELETE
 *     sessions] → { ok, action:'user_suspend', user, deletedSessions }.
 *   - 500 kegagalan Turso (lookup ATAU batch) → ADMIN_METRICS_500.
 * SQL konstanta di-assert persis (prepared statements, argumen anti-injection).
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

vi.mock('../../server/config/metricsConfig.js', () => ({
  getAdminEmails: vi.fn(() => ['admin@cashflow.test']),
  FEATURES: [],
}));

const executeMock = vi.fn();
const batchMock = vi.fn();
vi.mock('../../server/lib/turso.js', () => ({
  getTurso: vi.fn(() => ({ execute: executeMock, batch: batchMock })),
}));

// metricsService di-mock agar import route tidak menarik dependensi berat;
// route lain tidak di-invoke di suite ini.
vi.mock('../../server/services/metricsService.js', () => ({
  default: {},
}));

import {
  registerAdminMetricsRoutes,
  ADMIN_SUSPEND_FIND_USER_SQL,
  ADMIN_SUSPEND_DELETE_SESSIONS_SQL,
} from '../../server/routes/adminMetricsRoutes.js';
import { ADMIN_AUDIT_INSERT_SQL } from '../../server/lib/adminAudit.js';

interface FakeRes {
  statusCode: number;
  body: unknown;
  status: ReturnType<typeof vi.fn>;
  json: ReturnType<typeof vi.fn>;
}

function createRes(): FakeRes {
  const res: FakeRes = { statusCode: 200, body: undefined, status: vi.fn(), json: vi.fn() };
  res.status.mockImplementation((code: number) => { res.statusCode = code; return res; });
  res.json.mockImplementation((body: unknown) => { res.body = body; return res; });
  return res;
}

type Handler = (req: unknown, res: unknown) => Promise<unknown> | unknown;

function createApp() {
  const routes: Record<string, Handler> = {};
  const app = {
    get: (path: string, handler: Handler) => { routes[path] = handler; },
    post: (path: string, handler: Handler) => { routes[path] = handler; },
    // invoke mendukung pola path dengan placeholder `:param` (mis.
    // /api/admin/users/:id/suspend) — segmen dicocokkan per bagian dan
    // nilai placeholder disuntikkan ke req.params.
    invoke: async (path: string, req: { user?: unknown; params?: Record<string, string>; ip?: string }) => {
      const segs = path.split('/');
      let matched: string | null = null;
      let params: Record<string, string> = {};
      for (const rp of Object.keys(routes)) {
        const rsegs = rp.split('/');
        if (rsegs.length !== segs.length) continue;
        const p: Record<string, string> = {};
        let ok = true;
        for (let i = 0; i < rsegs.length; i++) {
          if (rsegs[i].startsWith(':')) p[rsegs[i].slice(1)] = segs[i];
          else if (rsegs[i] !== segs[i]) { ok = false; break; }
        }
        if (ok) { matched = rp; params = p; break; }
      }
      if (!matched) throw new Error(`Route tidak terdaftar: ${path}`);
      const res = createRes();
      await routes[matched]({ ...req, params: { ...(req.params || {}), ...params } }, res);
      return res;
    },
  };
  return app;
}

const app = createApp();
registerAdminMetricsRoutes(app as never);

const ENDPOINT = (id: string) => `/api/admin/users/${id}/suspend`;
const ADMIN_USER = { id: 'admin-1', email: 'admin@cashflow.test' };
const NON_ADMIN_USER = { id: 'user-1', email: 'bukan-admin@cashflow.test' };

beforeEach(() => {
  vi.clearAllMocks();
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('POST /api/admin/users/:id/suspend — auth gate', () => {
  it('tanpa user → 401 ADMIN_METRICS_401, Turso tidak dipanggil', async () => {
    const res = await app.invoke(ENDPOINT('user-2'), {});
    expect(res.statusCode).toBe(401);
    expect((res.body as { code: string }).code).toBe('ADMIN_METRICS_401');
    expect(executeMock).not.toHaveBeenCalled();
    expect(batchMock).not.toHaveBeenCalled();
  });

  it('non-admin → 403 ADMIN_METRICS_403 + audit DENIED best-effort (bukan silent)', async () => {
    executeMock.mockResolvedValue({ rows: [] });
    const res = await app.invoke(ENDPOINT('user-2'), { user: NON_ADMIN_USER, id: 'req-deny' });
    expect(res.statusCode).toBe(403);
    expect((res.body as { code: string }).code).toBe('ADMIN_METRICS_403');
    // Percobaan admin yang DITOLAK dicatat (nilai keamanan) — fail-open.
    expect(batchMock).not.toHaveBeenCalled();
    expect(executeMock).toHaveBeenCalledWith(
      expect.objectContaining({ sql: ADMIN_AUDIT_INSERT_SQL }),
    );
    const args = executeMock.mock.calls[0][0].args as unknown[];
    expect(args[1]).toBe('user_suspend');
    expect(args[7]).toBe('denied');
    expect(args[8]).toBe('req-deny');
  });
});

describe('POST /api/admin/users/:id/suspend — validasi & guard', () => {
  it('id kosong → 400 ADMIN_METRICS_400, Turso tidak dipanggil', async () => {
    const res = await app.invoke(ENDPOINT('  '), { user: ADMIN_USER });
    expect(res.statusCode).toBe(400);
    expect((res.body as { code: string }).code).toBe('ADMIN_METRICS_400');
    expect(executeMock).not.toHaveBeenCalled();
  });

  it('id > 191 char → 400 ADMIN_METRICS_400 (fail-closed)', async () => {
    const longId = 'a'.repeat(192);
    const res = await app.invoke(ENDPOINT(longId), { user: ADMIN_USER });
    expect(res.statusCode).toBe(400);
    expect((res.body as { code: string }).code).toBe('ADMIN_METRICS_400');
    expect(executeMock).not.toHaveBeenCalled();
  });

  it('self-suspend (target == admin) → 400, Turso tidak dipanggil', async () => {
    const res = await app.invoke(ENDPOINT('admin-1'), { user: ADMIN_USER });
    expect(res.statusCode).toBe(400);
    expect((res.body as { code: string }).code).toBe('ADMIN_METRICS_400');
    expect((res.body as { message: string }).message).toContain('akun sendiri');
    expect(executeMock).not.toHaveBeenCalled();
    expect(batchMock).not.toHaveBeenCalled();
  });

  it('user tidak ditemukan → 404 ADMIN_METRICS_404, batch TIDAK dipanggil', async () => {
    executeMock.mockResolvedValue({ rows: [] });
    const res = await app.invoke(ENDPOINT('ghost-user'), { user: ADMIN_USER });
    expect(res.statusCode).toBe(404);
    expect((res.body as { code: string }).code).toBe('ADMIN_METRICS_404');
    expect(executeMock).toHaveBeenCalledWith({ sql: ADMIN_SUSPEND_FIND_USER_SQL, args: ['ghost-user'] });
    expect(batchMock).not.toHaveBeenCalled();
  });
});

describe('POST /api/admin/users/:id/suspend — 200 revoke + audit atomik', () => {
  it('admin → batch [INSERT audit (result+requestId), DELETE sessions] + response lengkap', async () => {
    executeMock.mockResolvedValue({ rows: [{ id: 'user-2', email: 'target@cashflow.test' }] });
    batchMock.mockResolvedValue([{ rowsAffected: 1 }, { rowsAffected: 3 }]);

    const res = await app.invoke(ENDPOINT('user-2'), { user: ADMIN_USER, ip: '10.0.0.1', id: 'req-ok' });
    expect(res.statusCode).toBe(200);

    const body = res.body as {
      ok: boolean;
      action: string;
      user: { id: string; email: string };
      deletedSessions: number;
    };
    expect(body.ok).toBe(true);
    expect(body.action).toBe('user_suspend');
    expect(body.user).toEqual({ id: 'user-2', email: 'target@cashflow.test' });
    expect(body.deletedSessions).toBe(3);

    // Lookup user (email untuk audit).
    expect(executeMock).toHaveBeenCalledTimes(1);
    expect(executeMock).toHaveBeenCalledWith({ sql: ADMIN_SUSPEND_FIND_USER_SQL, args: ['user-2'] });

    // Batch: SATU panggilan, dua statement, urutan INSERT-audit → DELETE.
    expect(batchMock).toHaveBeenCalledTimes(1);
    const [stmts] = batchMock.mock.calls[0] as [{ sql: string; args: unknown[] }[]];
    expect(stmts).toHaveLength(2);

    const [auditStmt, deleteStmt] = stmts;
    expect(auditStmt.sql).toBe(ADMIN_AUDIT_INSERT_SQL);
    expect(auditStmt.args).toEqual([
      expect.any(String),        // audit id (UUID)
      'user_suspend',            // action
      'user-2',                  // target_user_id
      'target@cashflow.test',    // target_email
      'admin-1',                 // actor_user_id
      'admin@cashflow.test',     // actor_email
      JSON.stringify({ sourceIp: '10.0.0.1' }), // metadata sanitized
      'success',                 // result
      'req-ok',                  // request_id
    ]);
    expect(deleteStmt.sql).toBe(ADMIN_SUSPEND_DELETE_SESSIONS_SQL);
    expect(deleteStmt.args).toEqual(['user-2']);
  });

  it('deletedSessions 0 (user tanpa sesi) tetap 200 + audit tercatat', async () => {
    executeMock.mockResolvedValue({ rows: [{ id: 'user-2', email: 'target@cashflow.test' }] });
    batchMock.mockResolvedValue([{ rowsAffected: 1 }, { rowsAffected: 0 }]);

    const res = await app.invoke(ENDPOINT('user-2'), { user: ADMIN_USER });
    expect(res.statusCode).toBe(200);
    expect((res.body as { deletedSessions: number }).deletedSessions).toBe(0);
    // Audit tetap ditulis — aksi admin dicatat walau tidak ada sesi yang dicabut.
    expect(batchMock).toHaveBeenCalledTimes(1);
  });
});

describe('POST /api/admin/users/:id/suspend — error path Turso', () => {
  it('lookup user gagal → 500 ADMIN_METRICS_500', async () => {
    executeMock.mockRejectedValue(new Error('turso down'));
    const res = await app.invoke(ENDPOINT('user-2'), { user: ADMIN_USER });
    expect(res.statusCode).toBe(500);
    expect((res.body as { code: string }).code).toBe('ADMIN_METRICS_500');
    expect((res.body as { ok: boolean }).ok).toBe(false);
    expect(batchMock).not.toHaveBeenCalled();
  });

  it('batch gagal (revoke/audit) → 500 ADMIN_METRICS_500 — audit failure best-effort dicatat', async () => {
    executeMock.mockResolvedValue({ rows: [{ id: 'user-2', email: 'target@cashflow.test' }] });
    batchMock.mockRejectedValue(new Error('transaction aborted'));
    executeMock.mockClear(); // pisahkan lookup dari audit failure
    const res = await app.invoke(ENDPOINT('user-2'), { user: ADMIN_USER, id: 'req-fail' });
    expect(res.statusCode).toBe(500);
    expect((res.body as { code: string }).code).toBe('ADMIN_METRICS_500');
    // Kegagalan DICATAT (result='failure') — fail-open, tidak menimpa 500.
    const auditCalls = executeMock.mock.calls.filter((c) => (c[0] as { sql: string }).sql === ADMIN_AUDIT_INSERT_SQL);
    expect(auditCalls.length).toBe(1);
    expect((auditCalls[0][0] as { args: unknown[] }).args[7]).toBe('failure');
  });

  it('audit denied/failure gagal ditulis → operasi utama tetap merespons (fail-open)', async () => {
    // Lookup sukses → batch gagal → audit failure juga gagal (DB down) —
    // respons 500 utama TIDAK tertimpa oleh error audit.
    executeMock
      .mockImplementationOnce(async () => ({ rows: [{ id: 'user-2', email: 'target@cashflow.test' }] }))
      .mockImplementationOnce(async () => { throw new Error('audit db down'); });
    batchMock.mockRejectedValue(new Error('transaction aborted'));
    const res = await app.invoke(ENDPOINT('user-2'), { user: ADMIN_USER });
    expect(res.statusCode).toBe(500);
    expect((res.body as { code: string }).code).toBe('ADMIN_METRICS_500');
  });
});
