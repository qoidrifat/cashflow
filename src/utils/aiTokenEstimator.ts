/**
 * Lightweight AI token/cost estimator for CashFlow.
 * Uses approximation: 1 token ≈ 4 chars for mixed Indonesian/English text.
 *
 * This is a pure utility — no side effects, no external dependencies.
 * Used for cost monitoring and observability, not billing.
 */

// ===================== Interfaces =====================

export interface TokenEstimate {
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
}

export interface CostEstimate {
  model: string;
  inputTokens: number;
  outputTokens: number;
  inputCostUsd: number;
  outputCostUsd: number;
  totalCostUsd: number;
}

export interface AiUsageSummary {
  totalCalls: number;
  skippedByRules: number;
  parsedByFallback: number;
  sentToAi: number;
  aiSkippedDueQuota: number;
  estimatedInputTokens: number;
  estimatedOutputTokens: number;
  estimatedCostUsd: number;
  savedAiCalls: number;
  estimatedTokensSaved: number;
}

// ===================== Constants =====================

/** Gemini 2.5 Flash input cost: $0.15 per 1M tokens */
const GEMINI_FLASH_INPUT_COST_PER_MILLION = 0.15;

/** Gemini 2.5 Flash output cost: $0.60 per 1M tokens */
const GEMINI_FLASH_OUTPUT_COST_PER_MILLION = 0.60;

/** Approximation: 1 token ≈ 4 characters for mixed Indonesian/English text */
const CHARS_PER_TOKEN = 4;

/** Average AI output size for transaction extraction JSON response */
const AVERAGE_AI_OUTPUT_TOKENS = 400;

// ===================== Token Estimation =====================

/**
 * Estimate token count from text content.
 * Uses 4-char/token ratio (±20% accuracy for mixed ID/EN text).
 */
export function estimateTokensFromText(text: string): number {
  if (!text) return 0;
  return Math.ceil(text.length / CHARS_PER_TOKEN);
}

/**
 * Estimate token count from image file size (receipt scan).
 * Gemini charges ~258 tokens per image tile (256x256).
 * Average receipt: 1000-2000 tokens depending on resolution.
 */
export function estimateTokensFromImageBytes(bytes: number): number {
  if (bytes <= 0) return 0;
  if (bytes <= 100_000) return 1000;   // Small image (<100KB)
  if (bytes <= 500_000) return 1500;   // Medium image (<500KB)
  return 2000;                          // Large image (500KB-5MB)
}

// ===================== Cost Estimation =====================

/**
 * Estimate Gemini API cost in USD.
 * Based on Gemini 2.5 Flash pricing (as of 2025).
 */
export function estimateGeminiCost(options: {
  inputTokens: number;
  outputTokens?: number;
  model?: string;
}): CostEstimate {
  const {
    inputTokens,
    outputTokens = AVERAGE_AI_OUTPUT_TOKENS,
    model = 'gemini-2.5-flash',
  } = options;

  const inputCostUsd = (inputTokens / 1_000_000) * GEMINI_FLASH_INPUT_COST_PER_MILLION;
  const outputCostUsd = (outputTokens / 1_000_000) * GEMINI_FLASH_OUTPUT_COST_PER_MILLION;

  return {
    model,
    inputTokens,
    outputTokens,
    inputCostUsd: Math.round(inputCostUsd * 1_000_000) / 1_000_000,
    outputCostUsd: Math.round(outputCostUsd * 1_000_000) / 1_000_000,
    totalCostUsd: Math.round((inputCostUsd + outputCostUsd) * 1_000_000) / 1_000_000,
  };
}

// ===================== Usage Summary =====================

/**
 * Build aggregate AI usage summary for a sync run.
 * Calculates token estimates, costs, and savings from rules-first architecture.
 */
export function buildAiUsageSummary(stats: {
  totalEmails: number;
  skippedByRules: number;
  parsedByFallback: number;
  sentToAi: number;
  aiSkippedDueQuota: number;
  averageInputCharsPerAiCall: number;
}): AiUsageSummary {
  const {
    totalEmails: _totalEmails,
    skippedByRules,
    parsedByFallback,
    sentToAi,
    aiSkippedDueQuota,
    averageInputCharsPerAiCall,
  } = stats;

  const estimatedInputTokens = sentToAi * estimateTokensFromText('x'.repeat(averageInputCharsPerAiCall));
  const estimatedOutputTokens = sentToAi * AVERAGE_AI_OUTPUT_TOKENS;
  const cost = estimateGeminiCost({ inputTokens: estimatedInputTokens, outputTokens: estimatedOutputTokens });

  const savedAiCalls = skippedByRules + parsedByFallback;
  const averageSavedInputChars = Math.min(averageInputCharsPerAiCall, 4000);
  const estimatedTokensSaved = savedAiCalls * estimateTokensFromText('x'.repeat(averageSavedInputChars));

  return {
    totalCalls: sentToAi,
    skippedByRules,
    parsedByFallback,
    sentToAi,
    aiSkippedDueQuota,
    estimatedInputTokens,
    estimatedOutputTokens,
    estimatedCostUsd: cost.totalCostUsd,
    savedAiCalls,
    estimatedTokensSaved,
  };
}

// ===================== Format Helpers =====================

/**
 * Format USD cost for display.
 * Shows appropriate precision based on magnitude.
 */
export function formatCostUsd(cost: number): string {
  if (cost < 0.001) return '< $0.001';
  if (cost < 0.01) return `$${cost.toFixed(4)}`;
  return `$${cost.toFixed(3)}`;
}

/**
 * Format token count for display (e.g., "1.5K", "2.3M").
 */
export function formatTokenCount(tokens: number): string {
  if (tokens >= 1_000_000) return `${(tokens / 1_000_000).toFixed(1)}M`;
  if (tokens >= 1_000) return `${(tokens / 1_000).toFixed(1)}K`;
  return `${tokens}`;
}
