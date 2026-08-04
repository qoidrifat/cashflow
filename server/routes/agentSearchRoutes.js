/**
 * Agent Search Routes — CashFlow AI Proxy (P4.14 ekstraksi dari index.js)
 *
 * Endpoints:
 *   GET  /api/agent-search/config
 *   GET  /api/agent-search/health
 *   POST /api/agent-search/query
 *   POST /api/agent-search/answer
 *   POST /api/agent-search/sync-docs
 *   POST /api/agent-search/sync-transactions
 *   POST /api/agent-search/sync-gmail-logs
 *   POST /api/agent-search/sync-receipts
 *
 * Auth: req.user dari authMiddleware (Better Auth) — bukan Supabase JWT.
 *
 * P1-2 G4 (Validation Layer): body POST /query & /answer divalidasi memakai
 * shared library server/lib/validation.js (validateBody + validator murni).
 * KEGAGALAN validasi → HTTP 400 dengan BENTUK DOMAIN file ini
 * `{ ok:false, code:'AGENT_SEARCH_INVALID_REQUEST', message, detail? }` —
 * BUKAN bentuk generik sendValidationError, dan JANGAN PERNAH 401 (401
 * memicu dialog session-expired di client). Urutan dipertahankan: auth gate
 * dulu (tab user-scoped tanpa login → 401), baru validasi body.
 */
import metricsService from '../services/metricsService.js';
import { requireAuth } from '../middleware/authMiddleware.js';
import { validateBody, validateEnum, validateRequiredString } from '../lib/validation.js';
import {
  answerAgentSearch,
  checkAgentSearchHealth,
  classifyAgentSearchError,
  getPublicAgentSearchConfig,
  queryAgentSearch,
  syncCashFlowDocs,
  syncGmailLogsForUser,
  syncReceiptsForUser,
  syncTransactionsForUser,
} from '../services/agentSearchService.js';
import { isProduction } from '../lib/vertexContext.js';

/**
 * Resolve user dari session Better Auth (req.user diisi authMiddleware).
 * Migrasi dari validasi Supabase JWT — kini memakai cookie session Better Auth
 * yang sama dengan seluruh route lain (pola sama dengan resolveAdmin / CF-053).
 */
async function resolveAgentSearchUser(req, { required = false } = {}) {
  const user = req.user;
  if (user?.id) {
    return user.id;
  }

  if (required) {
    const authError = new Error('Autentikasi diperlukan. Silakan login terlebih dahulu.');
    authError.status = 401;
    authError.code = 'AGENT_SEARCH_INVALID_REQUEST';
    throw authError;
  }

  return null;
}

/** Whitelist tab — sumber: VALID_TABS di services/agentSearchService.js. */
const AGENT_SEARCH_TABS = ['help', 'transactions', 'insight', 'gmail', 'receipts'];

/**
 * Batas panjang query pencarian. Generous (2000) di level gate; service
 * men-truncate ulang ke 500 via cleanText dan tetap menolak < 2 karakter.
 */
const AGENT_SEARCH_QUERY_MAX = 2000;

/** Tab yang membutuhkan data user → login wajib (USER_SCOPED_TABS di service). */
const USER_REQUIRED_TABS = ['transactions', 'insight', 'gmail', 'receipts'];

/** Skema body POST /query & /answer — field tak dikenal otomatis dibuang validateBody. */
const AGENT_SEARCH_BODY_SCHEMA = {
  query: { validate: validateRequiredString, options: { min: 2, max: AGENT_SEARCH_QUERY_MAX } },
  tab: { validate: validateEnum, options: { values: AGENT_SEARCH_TABS } },
};

/**
 * Kirim kegagalan validasi sebagai 400 bentuk domain agent-search
 * ({ ok:false, code:'AGENT_SEARCH_INVALID_REQUEST', message, detail? }).
 * Dipakai alih-alih sendValidationError karena kontrak error route group ini
 * domain-spesifik (sama dengan kode 400 yang dilempar agentSearchService).
 */
function sendAgentSearchValidationError(res, result) {
  const error = new Error(result?.error || 'Parameter tidak valid.');
  error.status = 400;
  error.code = 'AGENT_SEARCH_INVALID_REQUEST';
  return sendAgentSearchError(res, error);
}

/**
 * Gate bersama POST /query & /answer: auth gate (urutan LAMA dipertahankan),
 * lalu validasi body via shared library. Mengembalikan `{ userId, query, tab }`
 * atau `{ response }` bila sudah merespons (401 auth / 400 validasi).
 */
async function resolveAgentSearchRequest(req, res) {
  const rawTab = req.body?.tab;
  const userRequired = USER_REQUIRED_TABS.includes(rawTab);
  const userId = await resolveAgentSearchUser(req, { required: userRequired });

  const result = validateBody(req.body, AGENT_SEARCH_BODY_SCHEMA);
  if (!result.ok) {
    return { response: sendAgentSearchValidationError(res, result) };
  }
  // tab absen/kosong → default 'help' (perilaku lama dipertahankan).
  return { userId, query: result.value.query, tab: result.value.tab || 'help' };
}

function sendAgentSearchError(res, error) {
  const classified = classifyAgentSearchError(error);

  const status = error?.status
    || (classified.code === 'AGENT_SEARCH_INVALID_REQUEST' ? 400
      : classified.code === 'AGENT_SEARCH_NOT_CONFIGURED' ? 503
      : classified.code === 'AGENT_SEARCH_CREDENTIAL_MISSING' ? 503
      : classified.code === 'AGENT_SEARCH_PERMISSION_DENIED' ? 403
      : classified.code === 'AGENT_SEARCH_QUOTA_EXCEEDED' ? 429
      : 500);

  return res.status(status).json({
    ok: false,
    code: classified.code,
    message: classified.message,
    ...(!isProduction() ? { detail: classified.detail } : {}),
  });
}

export function registerAgentSearchRoutes(app) {
  app.get('/api/agent-search/config', (_req, res) => {
    res.json({
      ok: true,
      config: getPublicAgentSearchConfig(),
    });
  });

  app.get('/api/agent-search/health', async (_req, res) => {
    const health = await checkAgentSearchHealth();
    res.status(health.ok ? 200 : 503).json(health);
  });

  app.post('/api/agent-search/query', async (req, res) => {
    const t0 = Date.now();
    try {
      const resolved = await resolveAgentSearchRequest(req, res);
      if (resolved.response) return resolved.response;
      const { userId, query, tab } = resolved;

      const result = await queryAgentSearch({
        query,
        tab,
        userId,
      });

      // CF-053: non-blocking search metrics (count/latency only — no token data)
      const latency = Date.now() - t0;
      metricsService.recordAIUsage({
        feature: 'agent_search', provider: 'vertex_search', executionTimeMs: latency,
        status: 'success', userId, metadata: { tab, resultCount: result?.diagnostics?.resultCount ?? 0 },
      }).catch(() => {});
      metricsService.recordSystemMetric({ metricName: 'agent_search_count', feature: 'agent_search', userId, metadata: { tab } }).catch(() => {});
      if ((result?.diagnostics?.resultCount ?? 0) === 0) {
        metricsService.recordSystemMetric({ metricName: 'agent_search_empty', feature: 'agent_search', userId, metadata: { tab } }).catch(() => {});
      }
      metricsService.recordSystemMetric({ metricName: 'agent_search_latency', metricValue: latency, feature: 'agent_search', userId }).catch(() => {});

      return res.json(result);
    } catch (error) {
      metricsService.recordAIUsage({
        feature: 'agent_search', provider: 'vertex_search', executionTimeMs: Date.now() - t0,
        status: 'error', errorMessage: error?.code || error?.message,
      }).catch(() => {});
      metricsService.recordSystemMetric({ metricName: 'agent_search_error', feature: 'agent_search' }).catch(() => {});
      return sendAgentSearchError(res, error);
    }
  });

  app.post('/api/agent-search/answer', async (req, res) => {
    const t0 = Date.now();
    try {
      const resolved = await resolveAgentSearchRequest(req, res);
      if (resolved.response) return resolved.response;
      const { userId, query, tab } = resolved;

      const result = await answerAgentSearch({
        query,
        tab,
        userId,
      });

      // CF-053: non-blocking search metrics
      const latency = Date.now() - t0;
      metricsService.recordAIUsage({
        feature: 'agent_search', provider: 'vertex_search', executionTimeMs: latency,
        status: 'success', userId, metadata: { tab, resultCount: result?.diagnostics?.resultCount ?? 0 },
      }).catch(() => {});
      metricsService.recordSystemMetric({ metricName: 'agent_search_count', feature: 'agent_search', userId, metadata: { tab } }).catch(() => {});
      if ((result?.diagnostics?.resultCount ?? 0) === 0) {
        metricsService.recordSystemMetric({ metricName: 'agent_search_empty', feature: 'agent_search', userId, metadata: { tab } }).catch(() => {});
      }
      metricsService.recordSystemMetric({ metricName: 'agent_search_latency', metricValue: latency, feature: 'agent_search', userId }).catch(() => {});

      return res.json(result);
    } catch (error) {
      metricsService.recordAIUsage({
        feature: 'agent_search', provider: 'vertex_search', executionTimeMs: Date.now() - t0,
        status: 'error', errorMessage: error?.code || error?.message,
      }).catch(() => {});
      metricsService.recordSystemMetric({ metricName: 'agent_search_error', feature: 'agent_search' }).catch(() => {});
      return sendAgentSearchError(res, error);
    }
  });

  app.post('/api/agent-search/sync-docs', requireAuth, async (_req, res) => {
    try {
      const result = await syncCashFlowDocs();
      return res.json(result);
    } catch (error) {
      return sendAgentSearchError(res, error);
    }
  });

  app.post('/api/agent-search/sync-transactions', async (req, res) => {
    try {
      const userId = await resolveAgentSearchUser(req, { required: true });
      const result = await syncTransactionsForUser({ userId });
      return res.json(result);
    } catch (error) {
      return sendAgentSearchError(res, error);
    }
  });

  app.post('/api/agent-search/sync-gmail-logs', async (req, res) => {
    try {
      const userId = await resolveAgentSearchUser(req, { required: true });
      const result = await syncGmailLogsForUser({ userId });
      return res.json(result);
    } catch (error) {
      return sendAgentSearchError(res, error);
    }
  });

  app.post('/api/agent-search/sync-receipts', async (req, res) => {
    try {
      const userId = await resolveAgentSearchUser(req, { required: true });
      const result = await syncReceiptsForUser({ userId });
      return res.json(result);
    } catch (error) {
      return sendAgentSearchError(res, error);
    }
  });
}
