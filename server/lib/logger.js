/**
 * Structured Logger (Sprint 2 — OBSERVABILITY_REVIEW).
 *
 * pino: JSON lines ke stdout — siap disinkronkan ke Cloud Logging / Loki / dll.
 * Level via env LOG_LEVEL (default: info produksi, debug dev).
 * Redact otomatis: cookie, authorization, token/secret/password (jangan pernah
 * log PII/credential walau sebuah object pass ke logger).
 */
import pino from 'pino';

const LOG_LEVEL = process.env.LOG_LEVEL || (process.env.NODE_ENV === 'production' ? 'info' : 'debug');

export const logger = pino({
  level: LOG_LEVEL,
  base: { app: 'cashflow-server' },
  timestamp: pino.stdTimeFunctions.isoTime,
  redact: {
    paths: [
      'req.headers.cookie',
      'req.headers.authorization',
      '*.accessToken',
      '*.refreshToken',
      '*.token',
      '*.secret',
      '*.password',
      '*.apiKey',
      '*.cookie',
    ],
    censor: '[redacted]',
  },
});
