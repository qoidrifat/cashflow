/**
 * E2E P3 — OAuth STATE regression (oauthStateMismatchRegression).
 *
 * ROOT CAUSE yang di-lock: state_mismatch di alur Freebuff Preview karena
 * state OAuth terikat cookie jar browser yang menginisiasi login (webview
 * preview http://127.0.0.1:5180) sedangkan redirect Google + callback selesai
 * di TAB CHROME EKSTERNAL (cookie jar TERPISAH) → cookie `better-auth.state`
 * tidak pernah sampai callback → state_mismatch.
 *
 * Fix: state disimpan SERVER-SIDE (tabel `verification`, migration 0001) +
 * `account.skipStateCookieCheck` (pola plugin resmi oauth-proxy) — callback
 * divalidasi via parameter `state` itu sendiri, TANPA dependensi cookie jar.
 * Validasi TETAP eksak dan di-lock di sini:
 *
 *   A same-jar        → state LOLOS (lanjut token exchange; kode palsu → invalid_code)
 *   B other-jar       → state LOLOS (SKENARIO FREEBUFF — bug asli)
 *   C tampered state  → REJECTED (state_mismatch)
 *   D missing state   → REJECTED (state_not_found)
 *   E replay          → callback ke-2 REJECTED (state sekali pakai)
 *   F expired state   → REJECTED (state_mismatch)
 *
 * Menjalankan (DB lokal terisolasi):
 *   npx playwright test -c playwright.e2e-local.config.mjs e2e/oauth-state.spec.ts
 */
import { test, expect } from 'playwright/test';
import { createE2eTursoClient } from './helpers/mintSession';

const COOKIE_NAME = 'better-auth.session_token';
const API = process.env.API_BASE_URL || 'http://127.0.0.1:5191';
const ORIGIN = 'http://127.0.0.1:5180'; // origin preview Freebuff

async function initiate() {
  const init = await fetch(`${API}/api/auth/sign-in/social`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Origin': ORIGIN, 'Referer': `${ORIGIN}/login` },
    body: JSON.stringify({ provider: 'google', callbackURL: `${ORIGIN}/auth/callback` }),
    redirect: 'manual',
  });
  const body = await init.json().catch(() => ({}));
  const state = decodeURIComponent((body.url || '').match(/[?&]state=([^&]+)/)?.[1] || '');
  const cookie = (init.headers.get('set-cookie') || '').split(';')[0] || '';
  return { state, cookie, initStatus: init.status };
}

async function callback(state: string, opts: { cookie?: string; override?: string } = {}) {
  const s = opts.override ?? state;
  const res = await fetch(
    `${API}/api/auth/callback/google?state=${encodeURIComponent(s)}&code=fake-code&scope=email+profile`,
    { headers: opts.cookie ? { Cookie: opts.cookie } : {}, redirect: 'manual' },
  );
  const loc = res.headers.get('location') || '';
  return {
    status: res.status,
    stateMismatch: loc.includes('state_mismatch'),
    error: (loc.match(/error=([^&]+)/) || [])[1] || null,
  };
}

test.describe('OAuth state regression (P3 — Freebuff cross-jar state_mismatch)', () => {
  test('A same-jar: callback dgn cookie state → LOLOS state (invalid_code, kode palsu)', async () => {
    const { state, cookie } = await initiate();
    const r = await callback(state, { cookie });
    expect(r.stateMismatch).toBe(false);
    expect(r.error).toBe('invalid_code'); // token exchange gagal — kode palsu, state sudah PASS
  });

  test('B other-jar (skenario Freebuff, TANPA cookie): state TETAP LOLOS — bug asli', async () => {
    const { state } = await initiate();
    const r = await callback(state);
    // Sebelum fix: state_mismatch. Setelah fix: lanjut ke token exchange.
    expect(r.stateMismatch).toBe(false);
    expect(r.error).toBe('invalid_code');
  });

  test('C state di-tamper → REJECTED (state_mismatch)', async () => {
    const { state } = await initiate();
    const tampered = state.slice(0, -1) + (state.endsWith('a') ? 'b' : 'a');
    const r = await callback(state, { override: tampered });
    expect(r.stateMismatch).toBe(true);
  });

  test('D state hilang → REJECTED (state_not_found)', async () => {
    const res = await fetch(`${API}/api/auth/callback/google?code=fake-code&scope=email+profile`, {
      redirect: 'manual',
    });
    const loc = res.headers.get('location') || '';
    expect(loc).toContain('error=state_not_found');
  });

  test('E replay: callback kedua dgn state sama → REJECTED (state sekali pakai)', async () => {
    const { state } = await initiate();
    const first = await callback(state);
    expect(first.stateMismatch).toBe(false);
    const second = await callback(state);
    expect(second.stateMismatch).toBe(true); // row verification sudah dikonsumsi
  });

  test('F state kedaluwarsa → REJECTED (state_mismatch)', async () => {
    const crypto = await import('node:crypto');
    const turso = await createE2eTursoClient();
    const expState = crypto.randomBytes(16).toString('base64url');
    const expId = crypto.randomBytes(16).toString('base64url');
    try {
      await turso.execute({
        sql: `INSERT INTO verification (id, identifier, value, expiresAt) VALUES (?, ?, ?, ?)`,
        args: [
          expId,
          expState,
          JSON.stringify({
            callbackURL: `${ORIGIN}/auth/callback`,
            codeVerifier: 'x'.repeat(128),
            oauthState: expState,
            expiresAt: Date.now() - 60000,
          }),
          Date.now() - 60000,
        ],
      });
      const r = await callback(expState);
      expect(r.stateMismatch).toBe(true);
    } finally {
      await turso.execute({ sql: `DELETE FROM verification WHERE id = ?`, args: [expId] });
      turso.close();
    }
  });
});
