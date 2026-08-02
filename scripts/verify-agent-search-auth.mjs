/**
 * TEMP verification script — resolveAgentSearchUser fix (pola resolveAdmin)
 *
 * Memverifikasi bahwa route /api/agent-search/* kini memakai req.user dari
 * cookie session Better Auth (bukan Supabase JWT yang rusak / ReferenceError).
 *
 * Test:
 *  1. query tab=transactions TANPA cookie → harus 401 (bukan 500)
 *  2. query tab=help TANPA cookie       → harus lolos auth (bukan 401/500)
 *  3. query tab=transactions DENGAN cookie minted → harus lolos auth (bukan 401)
 *  4. sync-transactions TANPA cookie    → harus 401
 *
 * Jalankan:
 *   node scripts/verify-agent-search-auth.mjs
 */
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { createClient } from '@libsql/client';

const API = 'http://localhost:5181';

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

async function mintSessionCookie() {
  const turso = createClient({
    url: process.env.TURSO_DATABASE_URL,
    authToken: process.env.TURSO_AUTH_TOKEN,
  });
  try {
    const users = await turso.execute({ sql: 'SELECT id, email FROM user LIMIT 1', args: [] });
    const userId = users.rows[0]?.id;
    const email = users.rows[0]?.email;
    if (!userId) throw new Error('Tidak ada user di tabel user');
    const token = crypto.randomBytes(24).toString('base64url').slice(0, 32);
    const secret = process.env.BETTER_AUTH_SECRET || process.env.AUTH_SECRET || 'cashflow-dev-secret-change-in-production';
    const sig = crypto.createHmac('sha256', secret).update(token).digest('base64');
    const now = new Date();
    await turso.execute({
      sql: `INSERT INTO session (id, expiresAt, token, createdAt, updatedAt, ipAddress, userAgent, userId)
            VALUES (?, ?, ?, ?, ?, '', 'e2e-test', ?)`,
      args: [token, new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000).toISOString(), token, now.toISOString(), now.toISOString(), userId],
    });
    return { cookie: `${token}.${sig}`, userId, email };
  } finally {
    turso.close();
  }
}

async function cleanupTestSessions() {
  const turso = createClient({ url: process.env.TURSO_DATABASE_URL, authToken: process.env.TURSO_AUTH_TOKEN });
  try {
    await turso.execute({ sql: `DELETE FROM session WHERE userAgent = 'e2e-test'`, args: [] });
  } finally {
    turso.close();
  }
}

async function api(pathname, body, cookie) {
  const headers = { 'Content-Type': 'application/json' };
  if (cookie) headers['Cookie'] = `better-auth.session_token=${cookie}`;
  const resp = await fetch(`${API}${pathname}`, {
    method: 'POST',
    headers,
    body: JSON.stringify(body),
  });
  let payload = null;
  try { payload = await resp.json(); } catch { /* noop */ }
  return { status: resp.status, payload };
}

let failed = 0;
function check(label, ok, detail = '') {
  console.log(`${ok ? '✅' : '❌'} ${label}${detail ? ` — ${detail}` : ''}`);
  if (!ok) failed++;
}

loadEnv();
const session = await mintSessionCookie();
console.log(`Minted session: ${session.email} (userId ${session.userId.slice(0, 8)}...)`);

try {
  // 1. Tanpa cookie, tab required → 401 (bukan 500 ReferenceError)
  const t1 = await api('/api/agent-search/query', { query: 'test', tab: 'transactions' });
  check('query tab=transactions TANPA cookie → 401 (auth gate)', t1.status === 401, `HTTP ${t1.status}`);

  // 2. Tanpa cookie, tab help → lolos auth (200/400/503, bukan 401/500)
  const t2 = await api('/api/agent-search/query', { query: 'halo', tab: 'help' });
  check('query tab=help TANPA cookie → lolos auth', t2.status !== 401 && t2.status !== 500, `HTTP ${t2.status}`);

  // 3. DENGAN cookie, tab required → lolos auth (bukan 401)
  const t3 = await api('/api/agent-search/query', { query: 'test', tab: 'transactions' }, session.cookie);
  check('query tab=transactions DENGAN cookie → lolos auth', t3.status !== 401, `HTTP ${t3.status}`);

  // 4. sync-transactions tanpa cookie → 401
  const t4 = await api('/api/agent-search/sync-transactions', {});
  check('sync-transactions TANPA cookie → 401', t4.status === 401, `HTTP ${t4.status}`);

  // 5. sync-transactions DENGAN cookie → lolos auth
  const t5 = await api('/api/agent-search/sync-transactions', {}, session.cookie);
  check('sync-transactions DENGAN cookie → lolos auth', t5.status !== 401, `HTTP ${t5.status}`);

  // 6. answer tab=insight tanpa cookie → 401
  const t6 = await api('/api/agent-search/answer', { query: 'hutang', tab: 'insight' });
  check('answer tab=insight TANPA cookie → 401', t6.status === 401, `HTTP ${t6.status}`);
} catch (err) {
  check('Eksekusi skrip', false, err.message);
} finally {
  await cleanupTestSessions();
  console.log('\n========================================');
  console.log(failed === 0 ? '✅ VERIFIKASI LULUS — resolveAgentSearchUser menggunakan req.user (Better Auth)' : `❌ ${failed} check GAGAL`);
  console.log('========================================');
  process.exit(failed === 0 ? 0 : 1);
}
