/**
 * Knowledge Routes — CashFlow AI Knowledge Assistant (P0.14)
 *
 *   GET  /api/ai/cashflow-knowledge/config  — status publik (tanpa secret)
 *   POST /api/ai/cashflow-knowledge         — grounded answer atas knowledge base
 *
 * READ-ONLY: tidak ada mutasi wallet / balance / verification / Gmail / DB.
 * Tidak ada data finansial user yang dikirim ke Google — query hanya terhadap
 * knowledge base (docs CashFlow non-sensitif, tab 'help' / type knowledge_base).
 *
 * Feature flag GOOGLE_AGENT_PLATFORM_ENABLED default FALSE — endpoint aktif
 * mengembalikan 503 NOT_CONFIGURED sampai billing proof selesai
 * (docs/google-agent-platform/BILLING_PROOF.md).
 *
 * Auth: req.user dari authMiddleware (Better Auth, global) — opsional
 * (knowledge base publik; userId dipakai HANYA untuk observability metrics).
 */
import { validateBody, validateRequiredString } from '../lib/validation.js';
import { getPublicKnowledgeConfig, queryCashflowAssistant } from '../lib/googleAgentPlatform/index.js';
import metricsService from '../services/metricsService.js';

const KNOWLEDGE_BODY_SCHEMA = {
  query: { validate: validateRequiredString, options: { min: 2, max: 500 } },
};

export function registerKnowledgeRoutes(app) {
  app.get('/api/ai/cashflow-knowledge/config', (_req, res) => {
    res.json({
      ok: true,
      config: getPublicKnowledgeConfig(),
    });
  });

  app.post('/api/ai/cashflow-knowledge', async (req, res) => {
    const t0 = Date.now();
    const userId = req.user?.id || null;

    const validation = validateBody(req.body || {}, KNOWLEDGE_BODY_SCHEMA);
    if (!validation.ok) {
      return res.status(400).json({
        ok: false,
        code: 'GOOGLE_AGENT_PLATFORM_INVALID_REQUEST',
        message: validation.error,
      });
    }

    const result = await queryCashflowAssistant({
      query: validation.value.query,
      userId,
    });
    const latency = Date.now() - t0;
    const ok = result.ok === true;

    // Observability (non-blocking, tanpa PII). Provider `google_agent_platform`
    // memisahkan usage jalur P0.14 dari provider existing (vertex_search dll).
    metricsService.recordAIUsage({
      feature: 'cashflow_knowledge',
      provider: 'google_agent_platform',
      executionTimeMs: latency,
      status: ok ? 'success' : 'error',
      userId,
      metadata: {
        code: result.code || null,
        sourceCount: Array.isArray(result.sources) ? result.sources.length : 0,
      },
    }).catch(() => {});
    metricsService.recordSystemMetric({
      metricName: ok ? 'cashflow_knowledge_count' : 'cashflow_knowledge_error',
      feature: 'cashflow_knowledge',
      userId,
    }).catch(() => {});
    metricsService.recordSystemMetric({
      metricName: 'cashflow_knowledge_latency',
      metricValue: latency,
      feature: 'cashflow_knowledge',
      userId,
    }).catch(() => {});

    return res.status(result.statusCode || 200).json(result);
  });
}
