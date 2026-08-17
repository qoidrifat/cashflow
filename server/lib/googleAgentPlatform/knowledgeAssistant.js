/**
 * Google Agent Platform — CashFlow AI Knowledge Assistant (P0.14)
 *
 * CAPABILITY TAMBAHAN (bukan pengganti AI provider existing):
 *   - Existing: Gemini (email/receipt extraction, insights) via server/lib/vertexContext.js
 *   - Existing: Agent Search / Discovery Engine (server/services/agentSearchService.js)
 *   - Baru (P0.14): knowledge retrieval GROUNDED atas knowledge base CashFlow
 *     (docs non-sensitif, type `knowledge_base`, tab `help`) — READ-ONLY.
 *
 * Aturan P0.14 yang dijaga di file ini:
 *   1. Feature flag GOOGLE_AGENT_PLATFORM_ENABLED default FALSE — hanya diaktifkan
 *      setelah billing proof selesai (docs/google-agent-platform/BILLING_PROOF.md).
 *   2. Tidak ada data finansial user yang dikirim ke Google: query hanya ke
 *      knowledge base (userId tidak diteruskan ke search; tab dipaksa 'help').
 *   3. Tidak ada mutasi: adapter ini TIDAK menyentuh wallet / balance / verifikasi
 *      / Gmail / database. Murni retrieval.
 *   4. Graceful fallback: bila Google tidak tersedia → "AI knowledge service
 *      temporarily unavailable" — CashFlow tidak pernah crash.
 *   5. Tidak ada secret di public config; source tidak pernah mengekspos path
 *      internal / credential.
 *
 * Injectable (deps.answerAgentSearch) agar unit test murni tanpa jaringan.
 */
import { answerAgentSearch } from '../../services/agentSearchService.js';

const DEFAULT_TIMEOUT_MS = 8000;
const QUERY_MAX = 500;
const ANSWER_MAX = 3000;
const SOURCES_MAX = 6;
const SOURCE_TITLE_MAX = 160;
const SOURCE_SECTION_MAX = 120;

/** Discovery Engine / Agent Search — keluarga produk GenAI App Builder (branding: Agent Search). */
const SERVICE_NAME = 'agent_search';
/**
 * Estimasi SKU untuk billing proof. BUKAN konfirmasi — SKU aktual & credit
 * application WAJIB diverifikasi di Billing Console (lihat BILLING_PROOF.md).
 */
const SKU_LABEL = 'agent_search_standard_search';

const UNAVAILABLE_MESSAGE = 'AI knowledge service temporarily unavailable';

function envFlag(value) {
  return String(value || '').toLowerCase() === 'true';
}

function cleanText(value, maxLength = 200) {
  return String(value || '')
    .replace(/[\u0000-\u001f\u007f]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, maxLength);
}

export function getKnowledgeConfig() {
  return {
    enabled: envFlag(process.env.GOOGLE_AGENT_PLATFORM_ENABLED),
    projectId:
      process.env.GOOGLE_AGENT_PLATFORM_PROJECT_ID
      || process.env.AGENT_SEARCH_PROJECT_ID
      || process.env.GCP_PROJECT_ID
      || '',
    location: process.env.GOOGLE_AGENT_PLATFORM_LOCATION || process.env.AGENT_SEARCH_LOCATION || 'global',
    dataStoreId:
      process.env.GOOGLE_AGENT_PLATFORM_DATA_STORE_ID
      || process.env.AGENT_SEARCH_KNOWLEDGE_DATA_STORE_ID
      || '',
    service: SERVICE_NAME,
    skuLabel: SKU_LABEL,
    timeoutMs: Number(process.env.GOOGLE_AGENT_PLATFORM_TIMEOUT_MS) > 0
      ? Number(process.env.GOOGLE_AGENT_PLATFORM_TIMEOUT_MS)
      : DEFAULT_TIMEOUT_MS,
  };
}

/**
 * Config publik untuk frontend — TANPA secret: tidak ada project id di sini,
 * tidak ada credential path, tidak ada token. Frontend hanya butuh `enabled`.
 */
export function getPublicKnowledgeConfig(config = getKnowledgeConfig()) {
  return {
    enabled: config.enabled,
    service: config.service,
    skuLabel: config.skuLabel,
    projectConfigured: !!config.projectId,
    dataStoreConfigured: !!config.dataStoreId,
  };
}

/**
 * Normalisasi error dari lapisan bawah (agentSearchService) ke kode domain
 * P0.14. Tidak pernah membocorkan detail teknis ke client non-dev.
 */
export function classifyKnowledgeError(error) {
  const code = error?.code || '';
  if (code.startsWith('GOOGLE_AGENT_PLATFORM_')) {
    return { code, detail: error?.message || '' };
  }
  if (code === 'AGENT_SEARCH_NOT_CONFIGURED' || code === 'AGENT_SEARCH_CREDENTIAL_MISSING' || code === 'AGENT_SEARCH_API_DISABLED') {
    return { code: 'GOOGLE_AGENT_PLATFORM_NOT_CONFIGURED', detail: error?.message || '' };
  }
  if (code === 'AGENT_SEARCH_NETWORK_ERROR' || code === 'AGENT_SEARCH_QUOTA_EXCEEDED') {
    return { code: 'GOOGLE_AGENT_PLATFORM_UNAVAILABLE', detail: error?.message || '' };
  }
  return { code: 'GOOGLE_AGENT_PLATFORM_INTERNAL_ERROR', detail: error?.message || '' };
}

function notConfiguredResult() {
  return {
    ok: false,
    code: 'GOOGLE_AGENT_PLATFORM_NOT_CONFIGURED',
    message: 'Fitur AI Knowledge CashFlow belum diaktifkan. Aktifkan GOOGLE_AGENT_PLATFORM_ENABLED=true hanya setelah eligibility billing terbukti (docs/google-agent-platform/BILLING_PROOF.md).',
    statusCode: 503,
    usage: null,
  };
}

function invalidQueryResult(message) {
  return {
    ok: false,
    code: 'GOOGLE_AGENT_PLATFORM_INVALID_REQUEST',
    message,
    statusCode: 400,
    usage: null,
  };
}

/**
 * Source referensi untuk UI — HANYA title + section. Path internal repo,
 * user_id_hash, dan field lain dari dokumen hasil search TIDAK diteruskan.
 */
function sanitizeSources(results) {
  if (!Array.isArray(results)) return [];
  return results
    .slice(0, SOURCES_MAX)
    .map((result) => ({
      title: cleanText(result?.title, SOURCE_TITLE_MAX),
      section: cleanText(result?.section, SOURCE_SECTION_MAX),
    }))
    .filter((source) => source.title);
}

/**
 * Receipt penggunaan untuk billing proof (P0.14 §28): timestamp, project,
 * service, SKU label, request count, response status. TANPA credential.
 */
function buildUsage(config, { status, errorCode = null }) {
  return {
    service: config.service,
    skuLabel: config.skuLabel,
    projectId: config.projectId,
    location: config.location,
    dataStoreConfigured: !!config.dataStoreId,
    requestCount: 1,
    timestamp: new Date().toISOString(),
    responseStatus: status,
    ...(errorCode ? { errorCode } : {}),
  };
}

function withTimeout(promise, timeoutMs) {
  return Promise.race([
    promise,
    new Promise((_, reject) => {
      const timer = setTimeout(() => {
        const error = new Error('AI knowledge service timed out.');
        error.code = 'GOOGLE_AGENT_PLATFORM_TIMEOUT';
        reject(error);
      }, timeoutMs);
      if (typeof timer.unref === 'function') timer.unref();
    }),
  ]);
}

/**
 * Query utama — grounded knowledge assistant.
 *
 * Selalu return objek result (tidak pernah throw untuk kegagalan service):
 *   - flag off            → { ok:false, code:NOT_CONFIGURED, statusCode:503 }
 *   - query invalid       → { ok:false, code:INVALID_REQUEST, statusCode:400 }
 *   - sukses + grounded   → { ok:true, answer, sources[], usage, statusCode:200 }
 *   - sukses tanpa info   → { ok:true, noInfo:true, message:"Informasi tersebut
 *                            belum tersedia dalam knowledge base CashFlow." }
 *   - service unavailable → { ok:false, code:TIMEOUT/UNAVAILABLE/INTERNAL,
 *                            message:"AI knowledge service temporarily unavailable",
 *                            statusCode:503/500 }
 */
export async function queryCashflowAssistant({ query, userId, deps = {} }) {
  const config = getKnowledgeConfig();
  if (!config.enabled) return notConfiguredResult();

  const safeQuery = cleanText(query, QUERY_MAX);
  if (safeQuery.length < 2) {
    return invalidQueryResult('Query minimal 2 karakter.');
  }

  // READ-ONLY + anti-PII: tab dipaksa 'help' (hanya knowledge_base), userId
  // TIDAK diteruskan ke Google — data user tidak pernah meninggalkan CashFlow.
  const search = deps.answerAgentSearch || answerAgentSearch;

  try {
    const response = await withTimeout(
      search({ query: safeQuery, tab: 'help', userId: null }),
      config.timeoutMs,
    );

    const rawResults = Array.isArray(response?.results) ? response.results : [];
    const answerText = typeof response?.answer?.text === 'string' ? response.answer.text.slice(0, ANSWER_MAX) : '';
    const sources = sanitizeSources(rawResults);

    if (!answerText && sources.length === 0) {
      return {
        ok: true,
        grounded: true,
        noInfo: true,
        answer: '',
        message: 'Informasi tersebut belum tersedia dalam knowledge base CashFlow.',
        sources: [],
        usage: buildUsage(config, { status: 'success' }),
        statusCode: 200,
      };
    }

    return {
      ok: true,
      grounded: true,
      noInfo: false,
      answer: answerText,
      sources,
      usage: buildUsage(config, { status: 'success' }),
      statusCode: 200,
    };
  } catch (error) {
    const classified = classifyKnowledgeError(error);
    if (classified.code === 'GOOGLE_AGENT_PLATFORM_NOT_CONFIGURED') {
      return notConfiguredResult();
    }
    const statusCode = classified.code === 'GOOGLE_AGENT_PLATFORM_INTERNAL_ERROR' ? 500 : 503;
    return {
      ok: false,
      code: classified.code,
      message: UNAVAILABLE_MESSAGE,
      statusCode,
      usage: buildUsage(config, { status: 'error', errorCode: classified.code }),
      ...(process.env.NODE_ENV !== 'production' ? { detail: classified.detail } : {}),
    };
  }
}
