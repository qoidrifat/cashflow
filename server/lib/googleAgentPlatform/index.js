/**
 * Google Agent Platform — CashFlow AI Knowledge (P0.14)
 *
 * Capability TAMBAHAN untuk knowledge retrieval grounded atas knowledge base
 * CashFlow. Bukan pengganti AI provider existing (DeepSeek/9inference di
 * harness; Gemini + Agent Search di runtime server).
 *
 * Modul: knowledgeAssistant.js — adapter read-only, feature-flagged.
 */
export {
  getKnowledgeConfig,
  getPublicKnowledgeConfig,
  classifyKnowledgeError,
  queryCashflowAssistant,
} from './knowledgeAssistant.js';
