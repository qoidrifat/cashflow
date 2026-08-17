/**
 * Unit test: server/lib/googleAgentPlatform/knowledgeAssistant.js (P0.14)
 *
 * Memakai dependency injection (deps.answerAgentSearch) → murni offline,
 * tanpa jaringan, tanpa kredensial. Kontrak yang dipaku:
 *
 *   1. Flag GOOGLE_AGENT_PLATFORM_ENABLED default FALSE → NOT_CONFIGURED 503,
 *      search TIDAK dipanggil sama sekali.
 *   2. Sukses → grounded answer + sources (title/section SAJA — path internal
 *      dan user_id_hash tidak pernah bocor).
 *   3. Empty / malformed → noInfo:true + pesan "belum tersedia dalam knowledge
 *      base" (anti-hallucination) — tidak pernah error.
 *   4. API error → graceful fallback "AI knowledge service temporarily
 *      unavailable" (CashFlow tidak crash).
 *   5. Timeout → GOOGLE_AGENT_PLATFORM_TIMEOUT 503 + pesan unavailable.
 *   6. Security: public config tanpa secret; query di-sanitasi; READ-ONLY
 *      (search dipanggil dengan tab='help' & userId=null — tidak ada data
 *      user yang dikirim ke Google); adapter tidak menyentuh DB/wallet.
 *   7. Semantic (P0.12/P0.13): hasil knowledge assistant TIDAK pernah
 *      mengandung label verification/ownership — retrieval ≠ verification.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const { answerAgentSearchMock } = vi.hoisted(() => ({
  answerAgentSearchMock: vi.fn(),
}));

vi.mock('../../server/services/agentSearchService.js', () => ({
  answerAgentSearch: answerAgentSearchMock,
}));

import {
  queryCashflowAssistant,
  getPublicKnowledgeConfig,
  classifyKnowledgeError,
} from '../../server/lib/googleAgentPlatform/index.js';

const FLAG = 'GOOGLE_AGENT_PLATFORM_ENABLED';
const TIMEOUT_FLAG = 'GOOGLE_AGENT_PLATFORM_TIMEOUT_MS';

function clearEnv() {
  delete process.env[FLAG];
  delete process.env[TIMEOUT_FLAG];
  delete process.env.GOOGLE_AGENT_PLATFORM_PROJECT_ID;
  delete process.env.GOOGLE_AGENT_PLATFORM_DATA_STORE_ID;
  delete process.env.AGENT_SEARCH_PROJECT_ID;
  delete process.env.AGENT_SEARCH_KNOWLEDGE_DATA_STORE_ID;
}

function sampleSuccessResponse() {
  return {
    ok: true,
    results: [
      {
        title: 'Cara Menambahkan Wallet',
        section: 'Wallet',
        path: 'docs/wallet/onboarding.md',
        user_id_hash: 'hash_secret_user',
        content: 'isi dokumen',
      },
      {
        title: 'Provider Capability',
        section: 'Providers',
        path: 'docs/providers/capability.md',
        user_id_hash: 'hash_secret_user',
      },
    ],
    answer: {
      text: 'Untuk menambahkan wallet, buka halaman Wallet lalu pilih Tambah Akun.',
      citations: [{ documentId: 'docs/wallet/onboarding.md' }],
      sourceCount: 2,
    },
  };
}

describe('CashFlow AI Knowledge Assistant (P0.14)', () => {
  beforeEach(() => {
    clearEnv();
    answerAgentSearchMock.mockReset();
  });

  afterEach(() => {
    clearEnv();
  });

  describe('feature flag (billing gate)', () => {
    it('default OFF → NOT_CONFIGURED 503 dan search TIDAK dipanggil', async () => {
      const result = await queryCashflowAssistant({ query: 'bagaimana cara menambahkan wallet?' });
      expect(result.ok).toBe(false);
      expect(result.code).toBe('GOOGLE_AGENT_PLATFORM_NOT_CONFIGURED');
      expect(result.statusCode).toBe(503);
      expect(answerAgentSearchMock).not.toHaveBeenCalled();
    });

    it('public config tidak pernah mengekspos secret', () => {
      process.env[FLAG] = 'true';
      const config = getPublicKnowledgeConfig();
      const serialized = JSON.stringify(config);
      expect(config.enabled).toBe(true);
      expect(config).not.toHaveProperty('projectId');
      expect(config).not.toHaveProperty('credentialPath');
      expect(serialized).not.toMatch(/(private[_-]?key|client[_-]?secret|refresh[_-]?token|api[_-]?key|credential|password)/i);
    });
  });

  describe('success path (grounded answer)', () => {
    beforeEach(() => {
      process.env[FLAG] = 'true';
      process.env.GOOGLE_AGENT_PLATFORM_PROJECT_ID = 'p0-14-proof-project';
      process.env.GOOGLE_AGENT_PLATFORM_DATA_STORE_ID = 'cashflow-knowledge-ds';
    });

    it('mengembalikan answer grounded + sources tanpa path/user_id_hash', async () => {
      answerAgentSearchMock.mockResolvedValue(sampleSuccessResponse());
      const result = await queryCashflowAssistant({ query: 'bagaimana cara menambahkan wallet?' });

      expect(result.ok).toBe(true);
      expect(result.answer).toContain('menambahkan wallet');
      expect(result.sources).toHaveLength(2);
      expect(result.sources[0]).toEqual({ title: 'Cara Menambahkan Wallet', section: 'Wallet' });
      // Path internal & user hash TIDAK boleh bocor ke client.
      const serialized = JSON.stringify(result);
      expect(serialized).not.toMatch(/docs\/wallet|docs\/providers/);
      expect(serialized).not.toContain('hash_secret_user');
      expect(serialized).not.toContain('user_id_hash');
    });

    it('READ-ONLY: search dipanggil dengan tab help + userId null (anti-PII)', async () => {
      answerAgentSearchMock.mockResolvedValue(sampleSuccessResponse());
      await queryCashflowAssistant({ query: 'fitur cashflow', userId: 'user-123' });

      expect(answerAgentSearchMock).toHaveBeenCalledTimes(1);
      expect(answerAgentSearchMock).toHaveBeenCalledWith({
        query: 'fitur cashflow',
        tab: 'help',
        userId: null,
      });
    });

    it('usage receipt untuk billing proof (timestamp, project, service, sku, count)', async () => {
      answerAgentSearchMock.mockResolvedValue(sampleSuccessResponse());
      const result = await queryCashflowAssistant({ query: 'fitur cashflow' });

      expect(result.usage).toMatchObject({
        service: 'agent_search',
        skuLabel: 'agent_search_standard_search',
        projectId: 'p0-14-proof-project',
        requestCount: 1,
        responseStatus: 'success',
      });
      expect(Date.parse(result.usage.timestamp)).not.toBeNaN();
    });

    it('query di-sanitasi: kontrol char dibuang, panjang dipotong', async () => {
      answerAgentSearchMock.mockResolvedValue(sampleSuccessResponse());
      const dirty = `\u0000fitur\u0007  cashflow ${'x'.repeat(600)}`;
      await queryCashflowAssistant({ query: dirty });
      const arg = answerAgentSearchMock.mock.calls[0][0];
      expect(arg.query).not.toMatch(/[\u0000-\u001f]/);
      expect(arg.query.length).toBeLessThanOrEqual(500);
      expect(arg.query).toContain('fitur cashflow');
    });
  });

  describe('empty & malformed (anti-hallucination)', () => {
    beforeEach(() => {
      process.env[FLAG] = 'true';
    });

    it('tidak ada hasil & tidak ada jawaban → noInfo dengan pesan knowledge base', async () => {
      answerAgentSearchMock.mockResolvedValue({ ok: true, results: [], answer: { text: '', citations: [] } });
      const result = await queryCashflowAssistant({ query: 'hal yang tidak ada di knowledge base' });

      expect(result.ok).toBe(true);
      expect(result.noInfo).toBe(true);
      expect(result.message).toBe('Informasi tersebut belum tersedia dalam knowledge base CashFlow.');
      expect(result.sources).toEqual([]);
    });

    it('response malformed (results bukan array, answer null) → tidak crash, noInfo', async () => {
      answerAgentSearchMock.mockResolvedValue({ ok: true, results: 'bukan-array', answer: null });
      const result = await queryCashflowAssistant({ query: 'fitur apa saja' });

      expect(result.ok).toBe(true);
      expect(result.noInfo).toBe(true);
      expect(result.sources).toEqual([]);
    });

    it('query < 2 karakter → INVALID_REQUEST 400 tanpa memanggil Google', async () => {
      const result = await queryCashflowAssistant({ query: 'a' });
      expect(result.ok).toBe(false);
      expect(result.code).toBe('GOOGLE_AGENT_PLATFORM_INVALID_REQUEST');
      expect(result.statusCode).toBe(400);
      expect(answerAgentSearchMock).not.toHaveBeenCalled();
    });
  });

  describe('fallback (service unavailable)', () => {
    beforeEach(() => {
      process.env[FLAG] = 'true';
    });

    it('network error → graceful "temporarily unavailable" 503, tidak throw', async () => {
      const error = new Error('ECONNREFUSED');
      error.code = 'AGENT_SEARCH_NETWORK_ERROR';
      answerAgentSearchMock.mockRejectedValue(error);

      const result = await queryCashflowAssistant({ query: 'fitur cashflow' });
      expect(result.ok).toBe(false);
      expect(result.code).toBe('GOOGLE_AGENT_PLATFORM_UNAVAILABLE');
      expect(result.message).toBe('AI knowledge service temporarily unavailable');
      expect(result.statusCode).toBe(503);
      expect(result.usage.responseStatus).toBe('error');
    });

    it('timeout → GOOGLE_AGENT_PLATFORM_TIMEOUT 503 + unavailable', async () => {
      process.env[TIMEOUT_FLAG] = '50';
      answerAgentSearchMock.mockReturnValue(new Promise(() => {})); // never resolves

      const result = await queryCashflowAssistant({ query: 'fitur cashflow' });
      expect(result.ok).toBe(false);
      expect(result.code).toBe('GOOGLE_AGENT_PLATFORM_TIMEOUT');
      expect(result.message).toBe('AI knowledge service temporarily unavailable');
      expect(result.statusCode).toBe(503);
    }, 5000);

    it('permission denied → fallback, tidak membocorkan detail ke prod', async () => {
      const originalNodeEnv = process.env.NODE_ENV;
      process.env.NODE_ENV = 'production';
      try {
        const error = new Error('Permission denied: role tidak cukup');
        error.code = 'AGENT_SEARCH_PERMISSION_DENIED';
        answerAgentSearchMock.mockRejectedValue(error);

        const result = await queryCashflowAssistant({ query: 'fitur cashflow' });
        expect(result.ok).toBe(false);
        expect(result.code).toBe('GOOGLE_AGENT_PLATFORM_INTERNAL_ERROR');
        expect(result.message).toBe('AI knowledge service temporarily unavailable');
        expect(result.detail).toBeUndefined();
      } finally {
        process.env.NODE_ENV = originalNodeEnv;
      }
    });
  });

  describe('classifyKnowledgeError', () => {
    it('memetakan kode Agent Search ke kode domain P0.14', () => {
      expect(classifyKnowledgeError({ code: 'AGENT_SEARCH_NOT_CONFIGURED' }).code).toBe('GOOGLE_AGENT_PLATFORM_NOT_CONFIGURED');
      expect(classifyKnowledgeError({ code: 'AGENT_SEARCH_NETWORK_ERROR' }).code).toBe('GOOGLE_AGENT_PLATFORM_UNAVAILABLE');
      expect(classifyKnowledgeError({ code: 'AGENT_SEARCH_QUOTA_EXCEEDED' }).code).toBe('GOOGLE_AGENT_PLATFORM_UNAVAILABLE');
      expect(classifyKnowledgeError({ code: 'AGENT_SEARCH_PERMISSION_DENIED' }).code).toBe('GOOGLE_AGENT_PLATFORM_INTERNAL_ERROR');
      expect(classifyKnowledgeError({ code: 'GOOGLE_AGENT_PLATFORM_TIMEOUT' }).code).toBe('GOOGLE_AGENT_PLATFORM_TIMEOUT');
    });
  });
});
