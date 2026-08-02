/**
 * Better Auth Configuration
 * Setup authentication with Google OAuth and Turso/libSQL database.
 */
import { betterAuth } from 'better-auth';
import { createClient } from '@libsql/client';
import { LibsqlDialect } from '@libsql/kysely-libsql';
import { dash } from '@better-auth/infra';

let authInstance = null;

export function getAuth() {
  if (authInstance) return authInstance;

  const tursoClient = createClient({
    url: process.env.TURSO_DATABASE_URL,
    authToken: process.env.TURSO_AUTH_TOKEN || undefined,
  });

  authInstance = betterAuth({
    database: {
      dialect: new LibsqlDialect({ client: tursoClient }),
      type: 'sqlite',
    },
    plugins: [dash()],
    baseURL: process.env.BETTER_AUTH_URL || 'http://localhost:5181',
    secret: process.env.BETTER_AUTH_SECRET || process.env.AUTH_SECRET || 'cashflow-dev-secret-change-in-production',
    socialProviders: {
      google: {
        clientId: process.env.GOOGLE_CLIENT_ID || '',
        clientSecret: process.env.GOOGLE_CLIENT_SECRET || '',
        scope: [
          'openid',
          'email',
          'profile',
          'https://www.googleapis.com/auth/gmail.readonly',
        ],
        accessType: 'offline',
        prompt: 'consent',
      },
    },
    session: {
      cookieCache: {
        enabled: true,
        maxAge: 60 * 5, // 5 menit cache
      },
    },
    user: {
      additionalFields: {
        displayName: { type: 'string', required: false },
        photoUrl: { type: 'string', required: false },
        avatarUrl: { type: 'string', required: false },
        googleId: { type: 'string', required: false },
      },
    },
    advanced: {
      useSecureCookies: false,
      storeStateStrategy: 'cookie',
      defaultCookieAttributes: {
        sameSite: 'lax',
        secure: false,
      },
    },
    trustedOrigins: [
      'http://localhost:5180',
      'http://127.0.0.1:5180',
      'http://localhost:5181',
      'http://127.0.0.1:5181',
      'https://better-auth.com',
      'https://dash.better-auth.com',
      'https://*.loca.lt',
      'https://*.ngrok-free.app',
    ],
  });

  console.log('[Auth] Better Auth siap dengan Google OAuth.');
  return authInstance;
}
