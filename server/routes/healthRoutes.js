/**
 * Health Routes — CashFlow AI Proxy (P4.14 ekstraksi dari index.js)
 *
 *   GET /api/health — liveness: server hidup + provider Vertex AI
 *   GET /api/ready   — readiness: liveness + dependensi inti siap (Turso,
 *                      Vertex AI) untuk orkestrator (K8s/Cloud Run/Docker
 *                      HEALTHCHECK). Menjawab 503 bila belum siap.
 */
import { getVertexState } from '../lib/vertexContext.js';
import { getTurso } from '../lib/turso.js';

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

  // Readiness probe — PRODUCTION_READINESS (P2): memisahkan "proses hidup"
  // (liveness /api/health) dari "dependensi siap melayani" (readiness).
  // 200 hanya bila Turso terhubung; 503 + detail bila ada komponen belum siap.
  // Dipakai Docker HEALTHCHECK, Cloud Run startup probe, dan reverse proxy.
  app.get('/api/ready', async (_req, res) => {
    const {
      geminiReady,
      primaryModel,
    } = getVertexState();

    let tursoReady = false;
    let tursoError = null;
    try {
      await getTurso().execute('SELECT 1');
      tursoReady = true;
    } catch (error) {
      tursoError = error?.message || String(error);
    }

    const ready = tursoReady;
    const status = ready ? 200 : 503;
    return res.status(status).json({
      ok: ready,
      ready,
      status: ready ? 'ready' : 'not_ready',
      dependencies: {
        turso: tursoReady ? 'ok' : 'unavailable',
        vertexAi: geminiReady ? 'ok' : 'degraded', // AI tidak memblokir readiness
      },
      model: primaryModel,
      ...(tursoError ? { details: { turso: tursoError } } : {}),
    });
  });
}
