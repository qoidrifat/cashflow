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
 */
import metricsService from '../services/metricsService.js';
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
      const tab = req.body?.tab || 'help';
      const userRequired = ['transactions', 'insight', 'gmail', 'receipts'].includes(tab);
      const userId = await resolveAgentSearchUser(req, { required: userRequired });

      const result = await queryAgentSearch({
        query: req.body?.query,
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
      const tab = req.body?.tab || 'help';
      const userRequired = ['transactions', 'insight', 'gmail', 'receipts'].includes(tab);
      const userId = await resolveAgentSearchUser(req, { required: userRequired });

      const result = await answerAgentSearch({
        query: req.body?.query,
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

  app.post('/api/agent-search/sync-docs', async (_req, res) => {
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
