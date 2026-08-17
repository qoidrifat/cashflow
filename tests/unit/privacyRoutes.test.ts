/**
 * Unit test: server/routes/privacyRoutes.js — Data Export (P0.2) & Account
 * Deletion (P0.3). Pola harness adminSuspend.test.ts (fake app + req/res;
 * @libsql/client tidak perlu di-mock — getTurso di-mock).
 *
 * Matriks (docs/security/ACCOUNT_DATA_EXPORT.md / ACCOUNT_DELETION.md):
 *   Export  : 401 unauth · A hanya data A · B hanya data B · tanpa secret
 *             (account/session/verification TIDAK pernah di-query) ·
 *             observability privacy_export_completed.
 *   Delete  : 401 · 400 konfirmasi · 200 wipe A (semua tabel) · B tidak
 *             tersentuh · sesi revoked · user better-auth & legacy dihapus ·
 *             audit account_delete (email REDACT) · idempoten (404 kedua) ·
 *             500 tidak parsial.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const executeMock = vi.fn();
const batchMock = vi.fn();
vi.mock('../../server/lib/turso.js', () => ({
  getTurso: vi.fn(() => ({ execute: executeMock, batch: batchMock })),
}));
vi.mock('../../server/lib/logger.js', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

import {
  registerPrivacyRoutes,
  ACCOUNT_DELETE_STATEMENTS,
  ACCOUNT_DELETE_USER_SQL,
  ACCOUNT_DELETE_LEGACY_USER_SQL,
  ACCOUNT_DELETE_VERIFICATION_SQL,
  ACCOUNT_FIND_USER_SQL,
  DELETE_CONFIRMATION_PHRASE,
} from '../../server/routes/privacyRoutes.js';
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
type Handler = (req: unknown, res: unknown, next?: () => void) => Promise<unknown> | unknown;

function createApp() {
  const routes: Record<string, Handler[]> = {};
  const app = {
    get: (path: string, ...handlers: Handler[]) => { routes[path] = handlers; },
    delete: (path: string, ...handlers: Handler[]) => { routes[path] = handlers; },
    invoke: async (path: string, req: Record<string, unknown>) => {
      const handlers = routes[path];
      if (!handlers) throw new Error(`Route tidak terdaftar: ${path}`);
      const res = createRes();
      let i = 0;
      // next() menaikkan index (semantik express) — while-loop TIDAK
      // meng-increment sendiri (menghindari double-skip middleware).
      const next = () => { i += 1; };
      while (i < handlers.length) {
        const before = i;
        await handlers[i]({ ...req }, res, next);
        // Handler merespons (status != default ATAU body ter-set) → berhenti.
        if (res.statusCode !== 200 || res.body) break;
        // Tidak merespons & tidak memanggil next → guard anti infinite-loop.
        if (i === before) break;
      }
      return res;
    },
  };
  return app;
}

const app = createApp();
registerPrivacyRoutes(app as never);

const EXPORT = '/api/privacy/export';
const DELETE_ACCOUNT = '/api/privacy/account';
const USER_A = { id: 'user-a', email: 'a@cashflow.test' };
const USER_B = { id: 'user-b', email: 'b@cashflow.test' };

/** DB mini: tiap tabel punya baris milik A dan B. */
const ALL_TABLES = [
  'user', 'users', 'profiles', 'categories', 'transactions', 'fraud_flags', 'budgets',
  'recurring_transactions', 'gmail_sync_logs', 'gmail_sync_settings', 'gmail_sync_runs',
  'wallet_accounts', 'saving_goals', 'subscriptions', 'notifications',
  'ai_feedback', 'ai_memory', 'ai_timeline',
];
const DB: Record<string, Record<string, Array<Record<string, unknown>>>> = {};
for (const table of ALL_TABLES) {
  DB[table] = {
    'user-a': [{ id: `a-${table}`, user_id: 'user-a', name: 'A', email: 'a@cashflow.test' }],
    'user-b': [{ id: `b-${table}`, user_id: 'user-b', name: 'B', email: 'b@cashflow.test' }],
  };
}
// user (singular) tidak punya user_id — sesuaikan kolom identitasnya.
DB.user['user-a'] = [{ id: 'user-a', name: 'User A', email: 'a@cashflow.test', emailVerified: 1 }];
DB.user['user-b'] = [{ id: 'user-b', name: 'User B', email: 'b@cashflow.test', emailVerified: 1 }];
DB.users['user-a'] = [{ id: 'user-a', email: 'a@cashflow.test', name: 'User A' }];
DB.users['user-b'] = [{ id: 'user-b', email: 'b@cashflow.test', name: 'User B' }];

function tableFromSql(sql: string): string {
  const m = /FROM\s+(\w+)/i.exec(sql);
  return m ? m[1] : '';
}

function setupMockDb(): void {
  executeMock.mockImplementation(async ({ sql, args }: { sql: string; args: unknown[] }) => {
    const table = tableFromSql(sql);
    if (table === 'user' && sql.includes('WHERE id =')) {
      const id = String(args[0] || '');
      return { rows: DB.user[id] ? [DB.user[id][0]] : [] };
    }
    if (table === 'users' && sql.includes('WHERE id =')) {
      const id = String(args[0] || '');
      return { rows: DB.users[id] ? [DB.users[id][0]] : [] };
    }
    if (table === 'gmail_sync_settings') {
      const id = String(args[0] || '');
      return { rows: (DB.gmail_sync_settings[id] || []).slice(0, 1) };
    }
    if (DB[table]) {
      const id = String(args[0] || '');
      return { rows: DB[table][id] || [] };
    }
    return { rows: [] };
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  setupMockDb();
});
afterEach(() => {
  vi.restoreAllMocks();
});

describe('GET /api/privacy/export — auth', () => {
  it('unauthenticated → 401 (requireAuth), Turso tidak dipanggil', async () => {
    const res = await app.invoke(EXPORT, {});
    expect(res.statusCode).toBe(401);
    expect(executeMock).not.toHaveBeenCalled();
  });
});

describe('GET /api/privacy/export — scoping & secret exclusion', () => {
  it('user A: export memuat HANYA data A, TIDAK memuat data B', async () => {
    const res = await app.invoke(EXPORT, { user: USER_A });
    expect(res.statusCode).toBe(200);
    const body = res.body as Record<string, unknown>;
    expect(body.ok).toBe(true);
    expect(body.exportVersion).toBe('1.0');
    expect((body.transactions as unknown[]).map((t) => (t as { id: string }).id)).toEqual(['a-transactions']);
    expect((body.ai as { memory: unknown[] }).memory.map((m) => (m as { id: string }).id)).toEqual(['a-ai_memory']);
    expect((body.ai as { timeline: unknown[] }).timeline.map((t) => (t as { id: string }).id)).toEqual(['a-ai_timeline']);
    expect((body.user as { id: string }).id).toBe('user-a');

    const serialized = JSON.stringify(body);
    expect(serialized).not.toContain('b-transactions');
    expect(serialized).not.toContain('b-ai_memory');
    expect(serialized).not.toContain('b-ai_timeline');
    expect(serialized).not.toContain('b-');
  });

  it('user B: export memuat HANYA data B', async () => {
    const res = await app.invoke(EXPORT, { user: USER_B });
    expect(res.statusCode).toBe(200);
    const body = res.body as Record<string, unknown>;
    expect((body.transactions as unknown[]).map((t) => (t as { id: string }).id)).toEqual(['b-transactions']);
    expect(JSON.stringify(body)).not.toContain('a-transactions');
    expect((body.user as { id: string }).id).toBe('user-b');
  });

  it('SECRET EXCLUSION: account/session/verification TIDAK pernah di-query, tidak ada token di respons', async () => {
    const res = await app.invoke(EXPORT, { user: USER_A });
    expect(res.statusCode).toBe(200);
    const queriedSql = executeMock.mock.calls.map((c) => String((c[0] as { sql: string }).sql)).join('\n');
    expect(queriedSql).not.toMatch(/FROM\s+(account|session|verification)\b/i);
    const serialized = JSON.stringify(res.body);
    expect(serialized).not.toMatch(/accessToken|refreshToken|idToken|password|token|secret/i);
  });

  it('observability: privacy_export_completed dicatat untuk user (bukan PII)', async () => {
    await app.invoke(EXPORT, { user: USER_A });
    const metricCall = executeMock.mock.calls.find((c) =>
      String((c[0] as { sql: string }).sql).includes('privacy_export_completed'));
    expect(metricCall).toBeTruthy();
    expect((metricCall![0] as { args: unknown[] }).args[0]).toBe('user-a');
  });

  it('500 (Turso error) → PRIVACY_EXPORT_FAILED', async () => {
    executeMock.mockRejectedValue(new Error('turso down'));
    const res = await app.invoke(EXPORT, { user: USER_A });
    expect(res.statusCode).toBe(500);
    expect((res.body as { code: string }).code).toBe('PRIVACY_EXPORT_FAILED');
  });
});

describe('DELETE /api/privacy/account — auth & konfirmasi', () => {
  it('unauthenticated → 401', async () => {
    const res = await app.invoke(DELETE_ACCOUNT, {});
    expect(res.statusCode).toBe(401);
    expect(batchMock).not.toHaveBeenCalled();
  });

  it('tanpa konfirmasi → 400 INVALID_CONFIRMATION, batch tidak dipanggil', async () => {
    const res = await app.invoke(DELETE_ACCOUNT, { user: USER_A, body: {} });
    expect(res.statusCode).toBe(400);
    expect((res.body as { code: string }).code).toBe('INVALID_CONFIRMATION');
    expect(batchMock).not.toHaveBeenCalled();
  });

  it('konfirmasi salah → 400 INVALID_CONFIRMATION', async () => {
    const res = await app.invoke(DELETE_ACCOUNT, { user: USER_A, body: { confirmation: 'hapus' } });
    expect(res.statusCode).toBe(400);
    expect((res.body as { code: string }).code).toBe('INVALID_CONFIRMATION');
    expect(batchMock).not.toHaveBeenCalled();
  });
});

describe('DELETE /api/privacy/account — wipe lengkap A, B tak tersentuh', () => {
  beforeEach(() => {
    executeMock.mockImplementation(async ({ sql, args }: { sql: string; args: unknown[] }) => {
      // Lookup user ada untuk SIAPA PUN yang diautentikasi (id dari args).
      if (sql === ACCOUNT_FIND_USER_SQL) {
        const id = String(args[0]);
        return { rows: [{ id, email: `${id}@cashflow.test` }] };
      }
      return { rows: [] };
    });
    // Batch sukses: tiap statement menghapus ≥1 baris.
    batchMock.mockResolvedValue(ACCOUNT_DELETE_STATEMENTS.map(() => ({ rowsAffected: 1 })));
  });

  it('200: batch menghapus SEMUA tabel user-owned + verification + user (better-auth & legacy) + audit', async () => {
    const res = await app.invoke(DELETE_ACCOUNT, {
      user: USER_A, body: { confirmation: DELETE_CONFIRMATION_PHRASE }, id: 'req-del',
    });
    expect(res.statusCode).toBe(200);
    const body = res.body as { ok: boolean; action: string; deletedSessions: number; deletedTransactions: number };
    expect(body.ok).toBe(true);
    expect(body.action).toBe('account_delete');
    expect(body.deletedSessions).toBe(1);
    expect(body.deletedTransactions).toBe(1);

    // SATU batch atomik — semua statement user-scoped A.
    expect(batchMock).toHaveBeenCalledTimes(1);
    const stmts = (batchMock.mock.calls[0][0] as { sql: string; args: unknown[] }[]);

    // Setiap DELETE user-owned: arg = A (B tidak pernah jadi target).
    // Pengecualian: verification dihapus via identifier (email) — bukan id.
    for (const s of stmts) {
      if (s.sql.startsWith('DELETE') && s.sql !== ACCOUNT_DELETE_VERIFICATION_SQL) {
        expect(String(s.args[0])).toBe('user-a');
      }
    }
    const verificationStmt = stmts.find((s) => s.sql === ACCOUNT_DELETE_VERIFICATION_SQL);
    expect(verificationStmt?.args).toEqual(['a@cashflow.test']);
    // Semua tabel user-owned tercakup.
    const deleteSql = stmts.map((s) => s.sql).join('\n');
    for (const table of ['transactions', 'categories', 'budgets', 'ai_feedback', 'ai_memory', 'ai_timeline',
      'gmail_sync_logs', 'gmail_sync_settings', 'gmail_sync_runs', 'notifications', 'fraud_flags',
      'recurring_transactions', 'wallet_accounts', 'saving_goals', 'subscriptions', 'profiles',
      'user_sessions', 'session', 'account', 'system_metrics', 'ai_usage_metrics']) {
      expect(deleteSql).toContain(`DELETE FROM ${table}`);
    }
    // verification (identifier=email) + user better-auth + users legacy.
    expect(deleteSql).toContain(ACCOUNT_DELETE_VERIFICATION_SQL);
    expect(deleteSql).toContain(ACCOUNT_DELETE_USER_SQL);
    expect(deleteSql).toContain(ACCOUNT_DELETE_LEGACY_USER_SQL);

    // Audit: action account_delete, email REDACT (''), result success, requestId.
    const auditStmt = stmts.find((s) => s.sql === ADMIN_AUDIT_INSERT_SQL);
    expect(auditStmt).toBeTruthy();
    expect(auditStmt!.args).toEqual([
      expect.any(String),   // id
      'account_delete',     // action
      'user-a',             // target_user_id
      null,                 // target_email — TIDAK menyimpan email (privacy)
      'user-a',             // actor_user_id
      '',                   // actor_email — REDACT (aturan privasi)
      '{}',                 // metadata
      'success',            // result
      'req-del',            // request_id
    ]);
  });

  it('user B tetap utuh: wipe B hanya menarget B; A tidak pernah jadi target', async () => {
    const res = await app.invoke(DELETE_ACCOUNT, {
      user: USER_B, body: { confirmation: DELETE_CONFIRMATION_PHRASE }, id: 'req-del-b',
    });
    expect(res.statusCode).toBe(200);
    const stmts = (batchMock.mock.calls[0][0] as { sql: string; args: unknown[] }[]);
    for (const s of stmts) {
      if (s.sql.startsWith('DELETE') && s.sql !== ACCOUNT_DELETE_VERIFICATION_SQL) {
        expect(String(s.args[0])).toBe('user-b');
        expect(String(s.args[0])).not.toBe('user-a');
      }
    }
    // Audit mencatat actor/target = B, email redacted.
    const auditStmt = stmts.find((s) => s.sql === ADMIN_AUDIT_INSERT_SQL);
    expect(auditStmt!.args[2]).toBe('user-b');
    expect(auditStmt!.args[4]).toBe('user-b');
    expect(auditStmt!.args[5]).toBe('');
  });

  it('IDEMPOTEN: delete kedua (akun sudah dihapus) → 404 ACCOUNT_NOT_FOUND, batch tidak dipanggil', async () => {
    executeMock.mockImplementation(async () => ({ rows: [] }));
    const res = await app.invoke(DELETE_ACCOUNT, { user: USER_A, body: { confirmation: DELETE_CONFIRMATION_PHRASE } });
    expect(res.statusCode).toBe(404);
    expect((res.body as { code: string }).code).toBe('ACCOUNT_NOT_FOUND');
    expect((res.body as { message: string }).message).toContain('sudah dihapus');
    expect(batchMock).not.toHaveBeenCalled();
  });

  it('500 (batch gagal) → ACCOUNT_DELETE_FAILED — batch atomik, tidak ada partial', async () => {
    executeMock.mockImplementation(async () => ({ rows: [{ id: 'user-a', email: 'a@cashflow.test' }] }));
    batchMock.mockRejectedValue(new Error('transaction aborted'));
    const res = await app.invoke(DELETE_ACCOUNT, { user: USER_A, body: { confirmation: DELETE_CONFIRMATION_PHRASE } });
    expect(res.statusCode).toBe(500);
    expect((res.body as { code: string }).code).toBe('ACCOUNT_DELETE_FAILED');
    expect((res.body as { message: string }).message).toContain('Tidak ada data yang diubah');
  });
});
