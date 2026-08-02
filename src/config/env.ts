/**
 * Environment variables configuration.
 * All environment variables are accessed through this file.
 */

export const env = {
  api: {
    baseUrl: import.meta.env.VITE_API_BASE_URL || 'http://localhost:5181',
  },
  turso: {
    url: import.meta.env.VITE_TURSO_DATABASE_URL as string,
    authToken: import.meta.env.VITE_TURSO_AUTH_TOKEN as string,
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
