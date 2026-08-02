/**
 * Environment variables configuration.
 * All environment variables are accessed through this file.
 *
 * Sprint 1.4 (SECURITY_AUDIT M-1): blok `turso` (VITE_TURSO_DATABASE_URL /
 * VITE_TURSO_AUTH_TOKEN) DIHAPUS — dead config dengan 0 consumer; bila di-set,
 * token DB akan masuk bundle client (Vite statically replaces import.meta.env.*).
 * Turso hanya diakses server-side via server/.env.
 */

export const env = {
  api: {
    baseUrl: import.meta.env.VITE_API_BASE_URL || 'http://localhost:5181',
  },
  agentSearch: {
    enabled: import.meta.env.VITE_AGENT_SEARCH_ENABLED === 'true',
    routeEnabled: import.meta.env.VITE_AI_SEARCH_ROUTE_ENABLED !== 'false',
  },
} as const;

export function isApiConfigComplete(): boolean {
  return !!env.api.baseUrl;
}

export function getApiConfigError(): string | null {
  if (!env.api.baseUrl) return 'VITE_API_BASE_URL belum diisi.';
  return null;
}
