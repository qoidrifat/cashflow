/**
 * E2E P0.12 — WALLET & PROVIDER ONBOARDING UX + SEMANTIC VERIFICATION STATE.
 *
 * Membuktikan:
 *   - Provider catalog (GET /api/wallet-providers) memuat 5 provider, semua
 *     enabled & integration = manual (bukan fake "integrated/connected/verified").
 *   - Semua provider bisa didaftarkan manual (blu, Bank Jago, ShopeePay, DANA,
 *     LINE Bank) → Account Registered.
 *   - Account Registered ≠ Balance Verified: wallet baru TANPA anchor →
 *     balanceAnchorStatus null (UI: "Saldo belum terverifikasi"), BUKAN verified.
 *   - Balance verification → "Saldo terverifikasi"; mismatch → "Saldo tidak cocok".
 *   - Tidak ada klaim provider identity/ownership verification (manual provider).
 *   - Mass assignment tertutup: field user_id/verified yang dikirim client DIABAIKAN,
 *     ownership tetap dari session (req.user.id).
 *
 * Jalur aman: DB file: TERISOLASI (playwright.e2e-local.config.mjs) — TIDAK menyentuh
 * remote dev Turso. Menjalankan:
 *   npx playwright test -c playwright.e2e-local.config.mjs e2e/wallet-onboarding.spec.ts
 */
import { test, expect } from 'playwright/test';
import { mintSessionCookieForEmail, cleanupTestSessions, createE2eTursoClient } from './helpers/mintSession';
import { setupAuthContext } from './helpers/authContext';

const COOKIE_NAME = 'better-auth.session_token';
const EMAIL = 'e2e-wallet-onboard@cashflow.test';

interface ApiOptions { method?: string; body?: unknown; cookie?: string; }
async function api(rel: string, { method = 'GET', body, cookie }: ApiOptions = {}) {
  const headers: Record<string, string> = {};
  if (cookie) headers.Cookie = `${COOKIE_NAME}=${cookie}`;
  if (body !== undefined) headers['Content-Type'] = 'application/json';
  const res = await fetch(`${process.env.API_BASE_URL || 'http://127.0.0.1:5191'}${rel}`, {
    method, headers, body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  let json: unknown = null;
  try { json = await res.json(); } catch { json = null; }
  return { status: res.status, json };
}

async function ensureUser(session: { userId: string }, email: string, name: string) {
  const turso = await createE2eTursoClient();
  try {
    // Delete-first by email: mintSessionCookieForEmail membuat row auth `user`
    // dgn id baru tiap run → hapus baris app `users` lama (stale id) utk email
    // ini agar FK wallet_accounts.user_id → users(id) mengarah ke session id.
    await turso.execute({ sql: `DELETE FROM users WHERE email = ?`, args: [email] });
    await turso.execute({
      sql: `INSERT INTO users (id, email, name, display_name) VALUES (?, ?, ?, ?)`,
      args: [session.userId, email, name, name],
    });
  } finally { turso.close(); }
}

test.describe('P0.12 Wallet Onboarding + Semantic Verification State', () => {
  let session: { cookie: string; userId: string };

  test.beforeAll(async () => {
    session = await mintSessionCookieForEmail(EMAIL);
    await ensureUser(session, EMAIL, 'E2E Onboard');
  });

  test.afterAll(async () => { await cleanupTestSessions(); });

  test('Provider catalog: 5 provider, semua enabled & integration=manual (tanpa klaim integrasi)', async () => {
    const { status, json } = await api('/api/wallet-providers', { cookie: session.cookie });
    expect(status).toBe(200);
    const list = json as Array<{ code: string; name: string; type: string; enabled: boolean; integration: string }>;
    const codes = list.map((p) => p.code);
    for (const expected of ['line_bank', 'blu', 'bank_jago', 'shopeepay', 'dana']) {
      expect(codes).toContain(expected);
    }
    for (const p of list) {
      expect(p.enabled, p.code).toBe(true);
      expect(p.integration, p.code).toBe('manual');
    }
    // Tidak boleh ada field secret/credential di respons publik.
    for (const p of list) {
      expect(Object.keys(p)).not.toEqual(expect.arrayContaining([
        'apiKey', 'secret', 'clientSecret', 'token', 'password', 'credential',
      ]));
    }
  });

  test('Semua provider dapat didaftarkan manual → Account Registered, balance belum diverifikasi', async () => {
    const providers = [
      { code: 'blu', name: 'blu', type: 'bank' },
      { code: 'bank_jago', name: 'Bank Jago', type: 'bank' },
      { code: 'shopeepay', name: 'ShopeePay', type: 'e-wallet' },
      { code: 'dana', name: 'DANA', type: 'e-wallet' },
      { code: 'line_bank', name: 'LINE Bank', type: 'bank' },
    ];
    for (const p of providers) {
      const res = await api('/api/wallets', {
        method: 'POST', cookie: session.cookie,
        body: { name: `${p.name}-${process.pid}`, type: p.type, institution: p.name, balance: 0, color: '#8b5cf6', providerCode: p.code },
      });
      expect(res.status, `${p.code} create: ${JSON.stringify(res.json)}`).toBe(200);
    }
    // bagan diagnostik: pastikan user session eksis di tabel users (FK vault).
    const turso0 = await createE2eTursoClient();
    try {
      const u = await turso0.execute({
        sql: `SELECT COUNT(*) c FROM users WHERE id = ?`, args: [session.userId],
      });
      expect(Number(u.rows[0].c), `users row for ${session.userId}`).toBeGreaterThanOrEqual(1);
    } finally { turso0.close(); }

    const { json } = await api('/api/wallets', { cookie: session.cookie });
    const wallets = json as Array<{ name: string; provider_code: string | null; balance_anchor_status: string | null }>;
    for (const p of providers) {
      const w = wallets.find((x) => x.provider_code === p.code);
      expect(w, `wallet for ${p.code}; got [${wallets.map((x) => x.provider_code).join(',')}]`).toBeDefined();
      // Account Registered ≠ Balance Verified: tidak ada anchor → status null.
      expect(w!.balance_anchor_status).not.toBe('verified');
    }
  });

  test('Mass assignment tertutup: client mengirim user_id/verified → user_id tetap dari session', async () => {
    const before = await api('/api/wallets', { cookie: session.cookie });
    const beforeCount = (before.json as unknown[]).length;

    const res = await api('/api/wallets', {
      method: 'POST', cookie: session.cookie,
      body: {
        name: 'E-Wallet Nakal', type: 'e-wallet', balance: 0,
        user_id: 'user-attacker', userId: 'user-attacker',
        verified: true, balance_anchor_status: 'verified',
      },
    });
    expect(res.status).toBe(200);

    // Verifikasi langsung ke DB: wallet punya user_id session (bukan attacker),
    // dan kolom verified/balance_anchor belum distel.
    const turso = await createE2eTursoClient();
    try {
      const row = await turso.execute({
        sql: `SELECT user_id, balance_anchor_status FROM wallet_accounts WHERE user_id = ? AND name = ?`,
        args: [session.userId, 'E-Wallet Nakal'],
      });
      expect(row.rows.length).toBe(1);
      expect(String(row.rows[0].user_id)).toBe(session.userId);
      expect(row.rows[0].balance_anchor_status ?? null).not.toBe('verified');
      // Tidak ada wallet milik user-attacker.
      const attacker = await turso.execute({
        sql: `SELECT COUNT(*) c FROM wallet_accounts WHERE user_id = ?`,
        args: ['user-attacker'],
      });
      expect(Number(attacker.rows[0].c)).toBe(0);
    } finally { turso.close(); }

    const after = await api('/api/wallets', { cookie: session.cookie });
    expect((after.json as unknown[]).length).toBe(beforeCount + 1);
  });

  test('Balance verification + mismatch memakai UI semantic (browser, DB isolated)', async ({ context, page }) => {
    await setupAuthContext(context, session);
    await page.goto('/professional');

    // Tambah wallet baru via UI (provider select sumber: GET /api/wallet-providers).
    await page.getByRole('button', { name: /Tambah Multi-Wallet/i }).click();
    await page.getByLabel('Provider').selectOption({ label: 'blu' });
    await page.getByLabel('Nama wallet').fill('blu verifikasi');
    await page.getByLabel('Saldo').fill('100000');
    await page.getByRole('button', { name: 'Simpan' }).click();
    await expect(page.getByText('blu verifikasi')).toBeVisible();

    // Balance belum diverifikasi (anchor null → "Saldo belum terverifikasi").
    await page.goto('/professional');
    await expect(page.getByText('Saldo belum terverifikasi').first()).toBeAttached();

    // Pastikan wallet hasil UI create benar-benar persist di server (poll).
    let walletId: string | undefined;
    await expect.poll(async () => {
      const acc = await api('/api/wallets', { cookie: session.cookie });
      const found = (acc.json as Array<{ id: string; name: string }>).find((w) => w.name === 'blu verifikasi');
      walletId = found?.id;
      return Boolean(found);
    }, { timeout: 10_000 }).toBe(true);
    expect(walletId).toBeDefined();

    const verifyRes = await api('/api/reconciliation/verify-balance', {
      method: 'POST', cookie: session.cookie,
      body: { accountId: walletId!, actualBalance: 100000, date: '2026-08-12' },
    });
    expect(verifyRes.status).toBe(200);
    expect((verifyRes.json as { status?: string }).status).toBe('verified');

    // Mismatch → anchor mismatch.
    const misRes = await api('/api/reconciliation/verify-balance', {
      method: 'POST', cookie: session.cookie,
      body: { accountId: walletId!, actualBalance: 1, date: '2026-08-12' },
    });
    expect(misRes.status).toBe(200);
    expect((misRes.json as { status?: string }).status).toBe('mismatch');

    // UI semantic tidak mengklaim provider identity/ownership verification.
    await page.goto('/professional');
    await expect(page.getByText('blu verifikasi')).toBeVisible();
    const body = await page.locator('body').innerText();
    expect(body).toContain('Saldo tidak cocok');
    // Tidak ada badge "Terintegrasi"/"Connected"/"Verified" untuk wallet manual.
    expect(body).not.toMatch(/Terintegrasi|terhubung langsung|Connected|Ownership verified/i);
  });
});
