/**
 * Helpers E2E: siapkan browser context yang sudah login (pola cookie-login).
 *
 * Dipakai oleh semua spec (gmail-sync, transactions, dashboard) agar satu sumber
 * kebenaran untuk:
 *   1. Menekan modal onboarding pertama-kali (localStorage) yang bisa menghalangi klik.
 *   2. Inject cookie sesi Better Auth yang di-mint ke Turso (lihat mintSession.ts).
 */
import type { BrowserContext } from 'playwright/test';
import type { MintedSession } from './mintSession';

export const ONBOARDING_KEY = 'cashflow-onboarding-done';

/** Set localStorage onboarding-done sebelum app load (menekan modal walkthrough). */
export async function suppressOnboarding(context: BrowserContext): Promise<void> {
  await context.addInitScript((key) => {
    try {
      localStorage.setItem(key, 'true');
    } catch {
      /* noop */
    }
  }, ONBOARDING_KEY);
}

/** Inject cookie sesi Better Auth ke context (httpOnly, sameSite Lax, domain localhost). */
export async function injectSessionCookie(context: BrowserContext, session: MintedSession): Promise<void> {
  await context.addCookies([
    {
      name: 'better-auth.session_token',
      value: session.cookie,
      domain: 'localhost',
      path: '/',
      httpOnly: true,
      sameSite: 'Lax',
    },
  ]);
}

/** Gabungan: onboarding + cookie — panggil di beforeEach setiap spec. */
export async function setupAuthContext(context: BrowserContext, session: MintedSession): Promise<void> {
  await suppressOnboarding(context);
  await injectSessionCookie(context, session);
}
