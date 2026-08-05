/**
 * CF-053: Monitoring metrics configuration.
 * Pricing is an ESTIMATE for cost monitoring (not billing). Easily adjustable.
 */

// USD per 1,000,000 tokens
export const AI_PRICING = {
  gemini_flash: { input: 0.075, output: 0.30 },
  gemini_pro: { input: 3.50, output: 10.50 },
  vertex_search: { perQueryUsd: 0.0 }, // set per contract; default 0 (no token data)
};

export const USD_TO_IDR = Number(process.env.USD_TO_IDR || 16000);

export const FEATURES = ['gmail_sync', 'agent_search', 'ocr_receipt', 'insight_generator', 'fraud_detection', 'financial_advisor'];

export const FEATURE_PROVIDER = {
  gmail_sync: 'gemini_flash',
  ocr_receipt: 'gemini_flash',
  insight_generator: 'gemini_flash',
  agent_search: 'vertex_search',
  fraud_detection: 'gemini_flash',
  financial_advisor: 'gemini_flash',
};

export const ALERT_DEFAULTS = [
  { name: 'ai_cost_daily', metric_name: 'estimated_cost_idr', condition: 'gt', threshold: 50000, window_minutes: 1440 },
  { name: 'gmail_sync_failures', metric_name: 'gmail_sync_failed', condition: 'gt', threshold: 10, window_minutes: 10 },
  { name: 'agent_search_error_rate', metric_name: 'agent_search_error_rate', condition: 'gt', threshold: 0.10, window_minutes: 60 },
  { name: 'ocr_failure_rate', metric_name: 'ocr_failure_rate', condition: 'gt', threshold: 0.20, window_minutes: 60 },
  // Sprint 2: biaya estimasi AI 30 hari > Rp 100k (window 43200 menit = 30 hari).
  // Threshold 100k IDR default — sesuaikan di DB alert_rules bila perlu.
  { name: 'ai_cost_monthly', metric_name: 'ai_cost_monthly', condition: 'gt', threshold: 100000, window_minutes: 43200 },
];

/**
 * Admin emails (comma-separated env). Used by requireAdmin middleware.
 */
export function getAdminEmails() {
  return String(process.env.ADMIN_EMAILS || '')
    .split(',')
    .map((e) => e.trim().toLowerCase())
    .filter(Boolean);
}
