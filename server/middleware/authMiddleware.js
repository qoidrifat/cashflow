/**
 * Auth Middleware
 * Validates session cookie and attaches user to request.
 * Provides requireAuth guard for protected routes.
 */
import { getAuth } from '../lib/auth.js';
import { fromNodeHeaders } from 'better-auth/node';

/** Jeda sebelum retry getSession saat blip DB (ms). */
const SESSION_RETRY_DELAY_MS = 150;

/**
 * Middleware: Attach user to every request (does NOT block unauthenticated requests).
 *
 * Membedakan DUA kondisi yang berbeda (fix flaky 2026-08-02):
 *   (a) getSession() mengembalikan null (cookie tidak ada / tidak valid)
 *       → req.user = null → route terproteksi 401. BENAR: memang belum login.
 *   (b) getSession() THROW (blip koneksi Turso / error DB)
 *       → BUKAN kondisi "belum login". Retry sekali (150ms); bila masih gagal,
 *         teruskan error ke Express error handler → respons 500 jujur (bukan 401 palsu).
 *
 * Sebelumnya error kasus (b) ditelan try/catch kosong → req.user = null → request
 * valid sesekali dapat 401 transient (penyebab flaky di E2E: admin-metrics,
 * agent-search, gmail-sync).
 */
export async function authMiddleware(req, res, next) {
  let session = null;
  try {
    const auth = getAuth();
    session = await auth.api.getSession({
      headers: fromNodeHeaders(req.headers),
    });
  } catch {
    // Kasus (b): blip DB — retry sekali sebelum menyerah.
    try {
      await new Promise((resolve) => setTimeout(resolve, SESSION_RETRY_DELAY_MS));
      const auth = getAuth();
      session = await auth.api.getSession({
        headers: fromNodeHeaders(req.headers),
      });
    } catch (secondError) {
      console.error(
        '[authMiddleware] getSession gagal setelah retry — error DB, bukan status login:',
        secondError?.message || secondError,
      );
      return next(secondError);
    }
  }

  req.user = session?.user || null;
  req.session = session?.session || null;
  next();
}

/**
 * Guard: Block unauthenticated requests with 401.
 * Use as middleware on protected routes.
 */
export function requireAuth(req, res, next) {
  if (!req.user) {
    return res.status(401).json({ error: 'Unauthorized — silakan login terlebih dahulu.' });
  }
  next();
}
