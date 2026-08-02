# Flow Analysis: CF-053 Monitoring

## Metrics Recording (e.g., OCR Receipt)
```
User uploads receipt
  ↓
POST /api/ai/extract-receipt-image (server/index.js)
  ↓
generateGeminiVision(prompt, image, { feature:'ocr_receipt' })
  ↓
generateVertexContent({ feature:'ocr_receipt', ... })  [chokepoint, t0=Date.now()]
  ↓
Vertex AI generateContent → response.usageMetadata
  ↓
metricsService.recordAIUsage({ feature, provider, promptTokens,
   completionTokens, executionTimeMs, status:'success' }).catch(()=>{})  [NON-BLOCKING]
  ↓
INSERT ai_usage_metrics (service-role client, bypasses RLS)
  ↓
OCR result returned to user (does NOT await metrics insert)
```

## Admin Dashboard Read
```
Admin opens /admin/monitoring (MonitoringPage.tsx)
  ↓
adminMetrics.ts → GET /api/admin/metrics/summary (+ai-usage, feature-health, alerts)
   with Authorization: Bearer <supabase JWT>
  ↓
resolveAdmin(req): verify JWT → check email ∈ ADMIN_EMAILS → else 403
  ↓
metricsService.getAIUsageSummary / getCostTrend / getFeatureHealth / checkAlerts
  ↓
SELECT aggregations from ai_usage_metrics + system_metrics (service-role)
  ↓
Dashboard renders: cost cards, 7-day trend chart, feature breakdown, health, alerts
```

## Critical Non-Functional Point
```
TARGET:       recordAIUsage(...).catch(()=>{})  — feature works even if insert fails
ANTI-PATTERN: await recordAIUsage(...) in critical path without guard
```

## Alert Evaluation
```
GET /api/admin/metrics/alerts → checkAlerts()
  ↓
For each active alert_rule:
  - estimated_cost_idr → SUM(ai_usage_metrics.estimated_cost_idr) in window
  - *_error_rate / *_failure_rate → computeRate() from ai_usage_metrics status
  - else → SUM(system_metrics.metric_value) for metric_name in window
  ↓
Compare to threshold (gt/lt/eq) → status ok|triggered (+ update last_triggered_at)
```
