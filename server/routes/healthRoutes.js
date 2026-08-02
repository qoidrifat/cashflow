/**
 * Health Routes — CashFlow AI Proxy (P4.14 ekstraksi dari index.js)
 *
 *   GET /api/health — status server + provider Vertex AI
 */
import { getVertexState } from '../lib/vertexContext.js';

export function registerHealthRoutes(app) {
  app.get('/api/health', (_req, res) => {
    const {
      geminiReady,
      primaryModel,
      fallbackModel,
      projectId,
      location,
    } = getVertexState();

    res.json({
      ok: true,
      status: 'running',
      provider: 'vertex-ai',
      geminiReady,
      model: primaryModel,
      fallbackModel,
      projectId,
      location,
    });
  });
}
