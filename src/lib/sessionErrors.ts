/**
 * CF-056: Detect whether an error/response indicates an EXPIRED or INVALID
 * authentication session (Better Auth session OR Google OAuth token).
 *
 * This is a POSITIVE-MATCH detector: it returns true ONLY for clear auth-expiry
 * signals. Transient failures (HTTP 500, timeouts, network errors) never match,
 * so they will NOT trigger an auto-logout.
 *
 * Recognized signals:
 *  - HTTP 401 (Unauthorized / UNAUTHENTICATED)
 *  - Google: "Request had invalid authentication credentials",
 *    "Expected OAuth 2 access token", "UNAUTHENTICATED"
 *  - OAuth / auth: "invalid_grant", "jwt expired", "token expired",
 *    "refresh token", "session expired"
 *
 * NOTE: HTTP 403 alone is NOT treated as expiry — it usually means
 * "forbidden / insufficient permission" (e.g. non-admin, missing scope),
 * which should not force a logout.
 */

const AUTH_MESSAGE_PATTERNS = [
  'invalid authentication credentials',
  'expected oauth 2 access token',
  'unauthenticated',
  'invalid_grant',
  'jwt expired',
  'token expired',
  'token has expired',
  'refresh_token_not_found',
  'refresh token not found',
  'session expired',
  'session_expired',
  'sesi anda telah berakhir',
  'sesi telah berakhir',
  'no current session',
  'auth session missing',
];

interface ErrorLike {
  message?: string;
  status?: number;
  code?: number | string;
  statusCode?: number;
}

function extractStatus(input: unknown, explicitStatus?: number): number | undefined {
  if (typeof explicitStatus === 'number') return explicitStatus;
  if (typeof input === 'number') return input;
  if (input && typeof input === 'object') {
    const obj = input as ErrorLike;
    if (typeof obj.status === 'number') return obj.status;
    if (typeof obj.statusCode === 'number') return obj.statusCode;
    if (typeof obj.code === 'number') return obj.code;
  }
  return undefined;
}

function extractMessage(input: unknown): string {
  if (typeof input === 'string') return input;
  if (input instanceof Error) return input.message;
  if (input && typeof input === 'object') {
    const obj = input as ErrorLike;
    if (typeof obj.message === 'string') return obj.message;
  }
  return '';
}

/**
 * @param input  An Error, string message, status number, or response-like object.
 * @param status Optional explicit HTTP status to consider.
 */
export function isSessionExpiredError(input: unknown, status?: number): boolean {
  if (extractStatus(input, status) === 401) return true;
  const message = extractMessage(input).toLowerCase();
  if (!message) return false;
  return AUTH_MESSAGE_PATTERNS.some((pattern) => message.includes(pattern));
}
