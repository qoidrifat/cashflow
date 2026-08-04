/**
 * Probe boot-check P1-2 G4 (agent-search + admin metrics validation).
 *
 * Dipakai untuk verifikasi manual server yang berjalan di port ephemeral
 * (mis. PORT=5194): memaku BENTUK ERROR domain untuk 400 validasi —
 *   - agent-search : { ok:false, code:'AGENT_SEARCH_INVALID_REQUEST', message }
 *   - admin metrics: { ok:false, code:'ADMIN_METRICS_400', message }
 * — dan bahwa validasi JANGAN PERNAH 401, config/health tetap publik,
 * serta clamp/whitelist lama dipertahankan.
 *
 * Meniru pola e2e/helpers/mintSession.ts untuk cookie admin (user pertama).
 * Menjalankan (server harus sudah hidup dulu):
 *   node scripts/verify-validation-g4.mjs 5194
 */
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { createClient } from '@libsql/client';

const PORT = Number(process.argv[2] || process.env.PROBE_PORT || 5194);
const BASE = `http://127.0.0.1:${PORT}`;

// ---------------------------------------------------------------------------
// Env & mint cookie (pola e2e/helpers/mintSession.ts)
// ---------------------------------------------------------------------------

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

async function mintAdminCookie() {
  loadEnv();
  const turso = createClient({
    url: process.env.TURSO_DATABASE_URL,
    authToken: process.env.TURSO_AUTH_TOKEN,
  });
  try {
    const users = await turso.execute({ sql: 'SELECT id FROM user LIMIT 1', args: [] });
    const userId = users.rows[0]?.id;
    if (!userId) throw new Error('Tidak ada user di tabel user — tidak bisa mint cookie.');
    const token = crypto.randomBytes(24).toString('base64url').slice(0, 32);
    const secret = process.env.BETTER_AUTH_SECRET || process.env.AUTH_SECRET || 'cashflow-dev-secret-change-in-production';
    const sig = crypto.createHmac('sha256', secret).update(token).digest('base64');
    const now = new Date();
    await turso.execute({
      sql: `INSERT INTO session (id, expiresAt, token, createdAt, updatedAt, ipAddress, userAgent, userId)
            VALUES (?, ?, ?, ?, ?, '', 'g4-probe', ?)`,
      args: [token, new Date(now.getTime() + 3600_000).toISOString(), token, now.toISOString(), now.toISOString(), userId],
    });
    return { cookie: `${token}.${sig}`, turso };
  } catch (error) {
    turso.close();
    throw error;
  }
}

async function cleanupProbeSession(turso) {
  try {
    await turso.execute({ sql: `DELETE FROM session WHERE userAgent = 'g4-probe'`, args: [] });
  } finally {
    turso.close();
  }
}

// ---------------------------------------------------------------------------
// Probe runner
// ---------------------------------------------------------------------------

let failures = 0;

function check(label, condition, evidence) {
  const mark = condition ? 'PASS' : 'FAIL';
  if (!condition) failures += 1;
  console.log(`[${mark}] ${label}${evidence ? ` — ${evidence}` : ''}`);
}

function isAgentSearchDomainError(body) {
  return body?.ok === false
    && body?.code === 'AGENT_SEARCH_INVALID_REQUEST'
    && typeof body?.message === 'string'
    && body.message.length > 0;
}

function isAdminDomainError(body) {
  return body?.ok === false
    && body?.code === 'ADMIN_METRICS_400'
    && typeof body?.message === 'string'
    && body.message.length > 0;
}

async function probe() {
  console.log(`\n=== P1-2 G4 boot probe → ${BASE} ===\n`);
  console.log('--- Public: config & health tidak berubah ---');
  {
    const resp = await fetch(`${BASE}/api/agent-search/config`);
    const body = await resp.json();
    check('GET config → 200 { ok:true, config }', resp.status === 200 && body.ok === true && typeof body.config === 'object',
      `status=${resp.status} body=${JSON.stringify(body).slice(0, 160)}`);
  }
  {
    const resp = await fetch(`${BASE}/api/agent-search/health`);
    const body = await resp.json();
    check('GET health → 200|503 + ok boolean', [200, 503].includes(resp.status) && typeof body.ok === 'boolean',
      `status=${resp.status} body=${JSON.stringify(body).slice(0, 160)}`);
  }

  console.log('\n--- agent-search: POST /query & /answer invalid → 400 domain shape ---');
  const agentCases = [
    ['query absen', '/api/agent-search/query', { tab: 'help' }],
    ['query whitespace', '/api/agent-search/query', { query: '   ', tab: 'help' }],
    ['query 1 char (< 2)', '/api/agent-search/query', { query: 'a', tab: 'help' }],
    ['query > 2000', '/api/agent-search/query', { query: 'x'.repeat(2001), tab: 'help' }],
    ['tab invalid', '/api/agent-search/query', { query: 'halo dunia', tab: 'sideways' }],
    ['answer query kosong', '/api/agent-search/answer', { query: '', tab: 'help' }],
    ['answer tab invalid', '/api/agent-search/answer', { query: 'halo dunia', tab: 'hacked' }],
  ];
  for (const [label, pathname, payload] of agentCases) {
    const resp = await fetch(`${BASE}${pathname}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    const body = await resp.json();
    check(`POST ${pathname} (${label}) → 400 domain`, resp.status === 400 && isAgentSearchDomainError(body),
      `status=${resp.status} body=${JSON.stringify(body).slice(0, 200)}`);
  }

  {
    const resp = await fetch(`${BASE}/api/agent-search/query`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ query: '', tab: 'transactions' }),
    });
    check('POST query (tab user-scoped, tanpa cookie, body invalid) → tetap 401 (auth gate dulu)', resp.status === 401,
      `status=${resp.status} body=${JSON.stringify(await resp.json()).slice(0, 160)}`);
  }

  console.log('\n--- admin metrics: tanpa cookie → 401 bahkan untuk query invalid ---');
  {
    const resp = await fetch(`${BASE}/api/admin/metrics/feature/agent_search/calls?page=abc&page_size=xyz`);
    check('GET feature calls invalid tanpa cookie → 401', resp.status === 401, `status=${resp.status}`);
  }

  console.log('\n--- admin metrics: dengan cookie admin → 400 ADMIN_METRICS_400 / clamp ---');
  let turso = null;
  try {
    const minted = await mintAdminCookie();
    turso = minted.turso;
    const cookie = `better-auth.session_token=${minted.cookie}`;

    const cacheResp = await fetch(`${BASE}/api/admin/metrics/cache`, { headers: { Cookie: cookie } });
    if (cacheResp.status !== 200) {
      console.log(`[SKIP] user pertama bukan admin (status=${cacheResp.status}) — probe admin dilewati.`);
    } else {
      const adminCases = [
        ['page non-integer', '/api/admin/metrics/feature/agent_search/calls?page=abc'],
        ['page_size non-integer', '/api/admin/metrics/feature/agent_search/calls?page_size=xyz'],
        ['feature-health feature invalid', '/api/admin/metrics/feature-health?feature=hacked'],
        ['feature path invalid', '/api/admin/metrics/feature/hacked/calls'],
        ['ai-usage from invalid', '/api/admin/metrics/ai-usage?from=bukan-tanggal'],
      ];
      for (const [label, pathname] of adminCases) {
        const resp = await fetch(`${BASE}${pathname}`, { headers: { Cookie: cookie } });
        const body = await resp.json();
        check(`GET ${pathname} (${label}) → 400 ADMIN_METRICS_400`, resp.status === 400 && isAdminDomainError(body),
          `status=${resp.status} body=${JSON.stringify(body).slice(0, 200)}`);
      }
      {
        const resp = await fetch(`${BASE}/api/admin/metrics/feature/agent_search/calls?page=999999&page_size=500`, { headers: { Cookie: cookie } });
        const body = await resp.json();
        check('GET calls page=999999&page_size=500 → 200 + clamp (100000/100)', resp.status === 200 && body.ok === true && body.page === 100000 && body.pageSize === 100,
          `status=${resp.status} page=${body.page} pageSize=${body.pageSize}`);
      }
      {
        const resp = await fetch(`${BASE}/api/admin/metrics/system?metric_name=agent_search_count`, { headers: { Cookie: cookie } });
        const body = await resp.json();
        check('GET system metric_name valid → 200 ok:true', resp.status === 200 && body.ok === true, `status=${resp.status}`);
      }
    }
  } catch (error) {
    console.log(`[SKIP] mint cookie gagal (DB tidak tersedia?): ${error.message}`);
  } finally {
    if (turso) await cleanupProbeSession(turso);
  }

  console.log(`\n=== Selesai: ${failures === 0 ? 'SEMUA PROBE PASS' : `${failures} PROBE GAGAL`} ===\n`);
  process.exit(failures === 0 ? 0 : 1);
}

probe().catch((error) => {
  console.error('Probe error:', error);
  process.exit(1);
});
