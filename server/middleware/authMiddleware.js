/**
 * Auth Middleware
 * Validates session cookie and attaches user to request.
 * Provides requireAuth guard for protected routes.
 */
import { getAuth } from '../lib/auth.js';
import { fromNodeHeaders } from 'better-auth/node';

/**
 * Middleware: Attach user to every request (does NOT block unauthenticated requests).
 */
export async function authMiddleware(req, res, next) {
  try {
    const auth = getAuth();
    const session = await auth.api.getSession({
      headers: fromNodeHeaders(req.headers),
    });

    req.user = session?.user || null;
    req.session = session?.session || null;
  } catch {
    req.user = null;
    req.session = null;
  }
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
