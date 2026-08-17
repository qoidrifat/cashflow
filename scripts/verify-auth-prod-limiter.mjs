/**
 * verify-auth-prod-limiter.mjs — VERIFIKASI PRODUKSI (live, NODE_ENV=production):
 * buktikan `rateLimit: { enabled: false }` better-auth (server/lib/auth.js)
 * benar-benar bekerja di env produksi — BUKAN hanya via unit test (authConfig/
 * authRateLimitConfig) yang mengecek objek config.
 *
 * Alasan: default better-auth 1.6.25 = `enabled: isProduction` (100 req / 10s /
 * IP, memory storage — create-context.mjs:171). Bila disable eksplisit tidak
 * jalan, produksi punya DUA lapis limiter dengan kontrak 429 berbeda. Verifikasi
 * ini men-start server produksi ASLI dan membuktikan perilaku runtime:
 *
 *   A. FAIL-FAST SECRET: boot produksi dengan secret lemah → proses MENOLAK
 *      boot (exit != 0, pesan '[Auth] PRODUCTION') — hardening secret jalan.
 *   B. BOOT PRODUKSI: secret kuat (48 char) → /api/health 200.
 *   C. SESI VALID: mint sesi → GET /api/auth/get-session 200 (auth prod hidup).
 *   D. LIMITER BAWAAN TIDAK AKTIF: 120× GET get-session berturut-turut
 *      (< 10s, IP sama). Jika limiter bawaan AKTIF, request ke-101+ → 429
 *      {"message":"Too many requests. Please try again later."} + header
 *      `X-Retry-After`. Verifikasi: SEMUA 200, TIDAK ADA x-retry-after /
 *      body "Too many requests" di respons mana pun. (authLimiter express
 *      SKIP GET — index.js:214 → jalur ini mengisolasi limiter bawaan.)
 *   E. EXPRESS TETAP 429 (single source of truth): POST /api/auth/sign-out
 *      dengan RATE_LIMIT_AUTH_MAX=6 → request ke-7 = 429 express kanonik
 *      { ok:false, code:'RATE_LIMITED' } + Retry-After + `ratelimit` (draft-7)
 *      + TIDAK ADA x-retry-after (limiter bawaan tidak ikut campur).
 *      (POST auth wajib Origin dari trustedOrigins — request pertama TANPA
 *      Origin → 403 = bukti origin/CSRF check better-auth AKTIF di produksi,
 *      sesuai disableOriginCheck:false; request berikutnya pakai Origin
 *      http://localhost:5180 agar sign-out 200.)
 *   F. MODE PRODUKSI SUNGGUHAN: header HSTS (helmet prod) + Set-Cookie
 *      dengan atribut `Secure` pada respons auth (useSecureCookies).
 *
 * Menjalankan:
 *   npm run verify:auth-prod
 *   node scripts/verify-auth-prod-limiter.mjs
 *
 * Exit code: 0 = semua bukti lolos; 1 = ada langkah gagal.
 * Prasyarat: Turso creds di server/.env (sama dengan server dev) + port 5199
 * bebas (server produksi sementara di-spawn, di-shutdown otomatis di akhir).
 */
import crypto from 'node:crypto';
import fs from 'node:fs';
import { spawn } from 'node:child_process';
import { createClient } from '@libsql/client';
import { mintSessionCookieForEmail } from '../e2e/helpers/mintSession.ts';

const PORT = 5199;
const BASE = `http://localhost:${PORT}`;
const ORIGIN_HEADER = 'http://localhost:5180'; // ada di trustedOrigins — bukan 5199

/** Deteksi port sudah terisi (fail-fast, hindari EADDRINUSE + tunggu 60s). */
async function portBusy() {
  try {
    const r = await fetch(`${BASE}/api/health`);
    if (r.status >= 200) return true; // ada server hidup di port ini
  } catch { /* tidak ada listener → bebas */ }
  return false;
}
const STRONG_SECRET = crypto.randomBytes(24).toString('hex'); // 48 char
const WEAK_SECRET = 'short-secret'; // < 32 char
const RATE_LIMIT_AUTH_MAX = 6; // kecil → 429 express cepat untuk langkah E
const BURST = 120; // > 100 default limiter bawaan (10s window)
const CONCURRENCY = 25;

let failed = false;
const check = (cond, msg) => {
  if (!cond) { failed = true; console.log(`  ✗ ${msg}`); }
  else console.log(`  ✓ ${msg}`);
};

function loadEnvForTurso() {
  const p = 'server/.env';
  if (!fs.existsSync(p)) return;
  for (const line of fs.readFileSync(p, 'utf8').split(/\r?\n/)) {
    const t = line.trim();
    if (t && !t.startsWith('#') && t.includes('=')) {
      const i = t.indexOf('=');
      const k = t.slice(0, i).trim();
      const v = t.slice(i + 1).trim().replace(/^["']|["']$/g, '');
      if (k && !process.env[k]) process.env[k] = v;
    }
  }
}

/**
 * Spawn server produksi (node server/index.js) dengan env tertentu.
 * stdout/stderr di-pipe & disimpan (untuk evidence). Kembalikan child + helper.
 */
function spawnProdServer({ secret, envExtra = {} }) {
  const child = spawn(process.execPath, ['server/index.js'], {
    cwd: process.cwd(),
    env: {
      ...process.env,
      NODE_ENV: 'production',
      PORT: String(PORT),
      BETTER_AUTH_SECRET: secret,
      RATE_LIMIT_ENABLED: 'true',
      RATE_LIMIT_AUTH_MAX: String(RATE_LIMIT_AUTH_MAX),
      ALERT_SCHEDULER_ENABLED: 'false',
      ...envExtra,
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let out = '';
  child.stdout.on('data', (d) => { out += d; });
  child.stderr.on('data', (d) => { out += d; });
  return { child, getOut: () => out };
}

/** Tunggu sampai /api/health 200 (atau timeout). */
async function waitReady(timeoutMs = 60000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const r = await fetch(`${BASE}/api/health`);
      if (r.status === 200) return true;
    } catch { /* belum up */ }
    await new Promise((r) => setTimeout(r, 400));
  }
  return false;
}

/** Hentikan server (SIGTERM → tunggu ≤8s → SIGKILL). */
async function stopServer(child) {
  if (!child || child.exitCode !== null) return;
  child.kill('SIGTERM');
  const done = new Promise((resolve) => child.once('exit', resolve));
  const timeout = new Promise((resolve) => setTimeout(() => resolve('timeout'), 8000));
  const res = await Promise.race([done, timeout]);
  if (res === 'timeout' && child.exitCode === null) child.kill('SIGKILL');
}

/** Hapus user+sesi test (email unik) dari Turso. */
async function cleanupUser(email) {
  loadEnvForTurso();
  const turso = createClient({
    url: process.env.TURSO_DATABASE_URL,
    authToken: process.env.TURSO_AUTH_TOKEN,
  });
  try {
    await turso.execute({
      sql: `DELETE FROM session WHERE userId IN (SELECT id FROM user WHERE email = ?)`,
      args: [email],
    });
    await turso.execute({ sql: `DELETE FROM user WHERE email = ?`, args: [email] });
  } finally {
    turso.close();
  }
}

async function main() {
  console.log('=== VERIFIKASI PRODUKSI: rateLimit better-auth { enabled: false } ===\n');

  // ---------- A. Fail-fast secret di produksi ----------
  console.log(`[A] Boot produksi dengan secret LEMAH (${WEAK_SECRET.length} char)…`);
  const weak = spawnProdServer({ secret: WEAK_SECRET });
  const weakExit = await new Promise((resolve) => {
    const t = setTimeout(() => resolve('timeout'), 45000);
    weak.child.on('exit', (code) => { clearTimeout(t); resolve(code); });
  });
  const weakOut = weak.getOut();
  check(
    weakExit !== 0 && weakExit !== 'timeout',
    `proses MENOLAK boot (exit=${weakExit}, aktual: ${weakExit === 'timeout' ? 'timeout — boot tidak gagal!' : weakExit})`,
  );
  check(
    weakOut.includes('[Auth] PRODUCTION') || weakOut.includes('BETTER_AUTH_SECRET wajib'),
    'pesan fail-fast secret produksi muncul di stderr',
  );
  console.log(`  (evidence: ${weakOut.split('\n').filter((l) => l.includes('Auth') || l.includes('Error')).slice(-2).join(' | ') || 'exit non-zero'})`);

  // ---------- B. Boot produksi dengan secret kuat ----------
  if (await portBusy()) {
    console.error(`[verify] PORT ${PORT} sudah terisi (mungkin server orphan dari run sebelumnya). Bebaskan dulu lalu re-run.`);
    process.exit(1);
  }
  console.log(`\n[B] Boot produksi dengan secret KUAT (${STRONG_SECRET.length} char)…`);
  const prod = spawnProdServer({ secret: STRONG_SECRET });
  const ready = await waitReady();
  check(ready, `GET ${BASE}/api/health → 200 (server produksi hidup)`);
  if (!ready) {
    console.log(prod.getOut().slice(-800));
    await stopServer(prod.child);
    console.log(`\n=== VERDICT: GAGAL (server produksi tidak boot) ===`);
    process.exit(1);
  }

  // try/finally: server produksi + user/sesi test HARUS dibersihkan walau ada
  // error di tengah (mint gagal / fetch throw) — mencegah orphan 5199 & bocor
  // baris e2e-prod-verify-* di Turso (pola finally cleanup di seluruh codebase).
  // `email` dideklarasi DI LUAR try (dipakai finally).
  let email = '';
  try {

  // ---------- C. Sesi valid ----------
  // PENTING: mint sesi dengan secret yang SAMA dengan server produksi (bukan
  // secret server/.env) — cookie HMAC-signed dengan secret; mismatch secret =
  // get-session 200 body {} (sesi dianggap invalid). Set env parent DULU,
  // helper mintSession hanya mengisi env bila belum ada.
  process.env.BETTER_AUTH_SECRET = STRONG_SECRET;
  email = `e2e-prod-verify-${Date.now()}@cashflow.test`;
  let cookie = '';
  try {
    const minted = await mintSessionCookieForEmail(email);
    cookie = minted.cookie;
  } catch (e) {
    check(false, `mint sesi: ${String(e?.message || e).slice(0, 200)}`);
  }
  console.log(`\n[C] Mint sesi (${email}) + get-session…`);
  // Produksi (useSecureCookies) → nama cookie `__Secure-better-auth.session_token`.
  // Kirim KEDUA nama sekaligus agar tidak sensitif terhadap pin prefix.
  const COOKIE_HEADER = `__Secure-better-auth.session_token=${cookie}; better-auth.session_token=${cookie}`;
  const sessionResp = await fetch(`${BASE}/api/auth/get-session`, {
    headers: { cookie: COOKIE_HEADER },
  });
  const sessionBody = await sessionResp.text();
  check(sessionResp.status === 200, `GET /api/auth/get-session → 200 (aktual: ${sessionResp.status})`);
  check(
    sessionBody.includes('"user"') && sessionBody.includes(email),
    'respons get-session berisi user sesi (auth produksi memvalidasi cookie)',
  );

  // ---------- D. Limiter bawaan TIDAK aktif (burst > 100) ----------
  console.log(`\n[D] Burst ${BURST}× GET get-session (< 10s, IP sama) — limiter bawaan (default isProduction 100/10s/IP)…`);
  const results = [];
  for (let start = 0; start < BURST; start += CONCURRENCY) {
    const batch = Array.from({ length: Math.min(CONCURRENCY, BURST - start) }, async () => {
      const r = await fetch(`${BASE}/api/auth/get-session`, { headers: { cookie: COOKIE_HEADER } });
      return { status: r.status, headers: r.headers, body: await r.text() };
    });
    results.push(...(await Promise.all(batch)));
  }
  const non200 = results.filter((r) => r.status !== 200);
  const withRetryAfter = results.filter((r) => r.headers.get('x-retry-after') !== null);
  const withBa429Body = results.filter((r) => r.body.includes('Too many requests. Please try again later.'));
  const statusSummary = [...new Set(non200.map((r) => r.status))].join(',') || 'n/a';
  check(
    non200.length === 0,
    `SEMUA ${BURST} respons = 200 (aktual: ${non200.length} non-200 — status ${statusSummary})`,
  );
  check(
    withRetryAfter.length === 0,
    `TIDAK ADA header x-retry-after di respons mana pun (aktual: ${withRetryAfter.length})`,
  );
  check(
    withBa429Body.length === 0,
    `TIDAK ADA body "Too many requests" (limiter bawaan) (aktual: ${withBa429Body.length})`,
  );
  if (withRetryAfter.length > 0) {
    console.log(`  (evidence: ${withRetryAfter.slice(0, 3).map((r) => `status=${r.status} x-retry-after=${r.headers.get('x-retry-after')}`).join(' | ')})`);
  }

  // ---------- E. Express-rate-limit tetap 429 (single source of truth) ----------
  // POST auth di produksi melewati origin check better-auth (disableOriginCheck:
  // false) — request TANPA Origin → 403 (bukti CSRF/origin aktif). Request
  // berikutnya memakai Origin trustedOrigins agar sign-out 200. Siklus:
  //   i=1  POST tanpa Origin → 403 (origin check aktif)   [1 POST dihitung express]
  //   i=2  POST + Origin → 200 + Set-Cookie (clear sesi)   [dipakai langkah F]
  //   i≥3  POST + Origin → 200, lalu i=7 (ke-7 POST total) → 429 express kanonik
  // Setelah E exhaust budget, SEMUA POST /api/auth/* dari IP ini ikut 429
  // (window 15 mnt) — karena itu F TIDAK boleh POST sign-out lagi setelah E.
  console.log(`\n[E] POST /api/auth/sign-out ×${RATE_LIMIT_AUTH_MAX + 4} (RATE_LIMIT_AUTH_MAX=${RATE_LIMIT_AUTH_MAX}) — express harus 429 kanonik…`);
  let first429At = -1;
  let e429Body = null;
  let e429Headers = null;
  let signOutSetCookie = '';
  for (let i = 1; i <= RATE_LIMIT_AUTH_MAX + 4; i++) {
    // i=1 tanpa Origin (bukti origin check); i>=2 dengan Origin trusted.
    const headers = i === 1 ? { cookie: COOKIE_HEADER } : { cookie: COOKIE_HEADER, origin: ORIGIN_HEADER };
    const r = await fetch(`${BASE}/api/auth/sign-out`, { method: 'POST', headers });
    if (i === 1) {
      // Attribusi: express cors() TIDAK pernah 403 (hanya omit header) — 403
      // harus dari origin-check better-auth (INVALID_ORIGIN). Asersi body
      // ("origin") membuat pembuktian airtight vs misconfig CORS di masa depan.
      let bodyText = '';
      try { bodyText = await r.text(); } catch { /* non-JSON */ }
      check(
        r.status === 403 && /origin/i.test(bodyText),
        `origin/CSRF check better-auth AKTIF di produksi (POST auth tanpa Origin → 403 "origin") — aktual status=${r.status} body=${bodyText.slice(0, 60)}`,
      );
    } else if (i === 2) {
      signOutSetCookie = r.headers.getSetCookie().join('; ');
    }
    if (r.status === 429) { first429At = i; e429Body = await r.json(); e429Headers = r.headers; break; }
  }
  // i=1 adalah probe origin-403 — dihitung express, jadi 429 tetap di POST ke-7.
  check(first429At === RATE_LIMIT_AUTH_MAX + 1, `429 express muncul di POST auth ke-${RATE_LIMIT_AUTH_MAX + 1} (aktual: ${first429At})`);
  if (e429Body) {
    check(e429Body?.ok === false && e429Body?.code === 'RATE_LIMITED', 'body 429 = { ok:false, code:"RATE_LIMITED" } (kontrak kanonik, bukan body bawaan better-auth)');
    check(
      e429Headers.get('ratelimit') !== null && e429Headers.get('retry-after') !== null,
      'header `ratelimit` (draft-7) + `Retry-After` ada di 429 express',
    );
    check(
      e429Headers.get('x-retry-after') === null,
      'header x-retry-after (ciri limiter bawaan) TIDAK ada di 429 express',
    );
  } else {
    check(false, `tidak ada 429 express dalam ${RATE_LIMIT_AUTH_MAX + 4} request`);
  }

  // ---------- F. Mode produksi sungguhan (HSTS + Secure cookie) ----------
  console.log('\n[F] Bukti mode produksi sungguhan…');
  const probe = await fetch(`${BASE}/api/auth/get-session`, { headers: { cookie: COOKIE_HEADER } });
  check(
    probe.headers.get('strict-transport-security') !== null,
    'header HSTS (helmet prod) ada di respons (sekalipun sesi sudah di-revoke oleh E)',
  );
  // get-session pada sesi fresh tidak me-rotate → tidak selalu Set-Cookie;
  // pakai Set-Cookie dari respons sign-out (E, i=2) yang SELALU menghapus
  // cookie sesi dengan atribut lengkap (useSecureCookies prod).
  check(
    /Secure/i.test(signOutSetCookie) && /HttpOnly/i.test(signOutSetCookie) && /SameSite=Lax/i.test(signOutSetCookie),
    `Set-Cookie sign-out ber-atribut Secure+HttpOnly+SameSite=Lax (useSecureCookies prod) — "${(signOutSetCookie.split(';')[0] || '').trim()}"`,
  );

  } finally {
    await stopServer(prod.child);
    if (email) await cleanupUser(email);
  }

  // ---------- Verdict ----------
  console.log(`\n=== VERDICT: ${failed ? 'GAGAL' : 'DISABLE EKSPLISIT TERBUKTI DI PRODUKSI ✅'} ===`);
  console.log(`  Server produksi sementara (port ${PORT}) sudah di-shutdown · user/sesi test dihapus.`);
  process.exit(failed ? 1 : 0);
}

main().catch((e) => {
  console.error('[verify] GAGAL:', e?.message || e);
  process.exit(1);
});
