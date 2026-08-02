# Implementation Plan: CF-053

## Current State (before)
- No metrics tables, service, endpoints, dashboard, or alerting.
- AI calls (Gemini via Vertex) route through `generateVertexContent` with token
  metadata available but uncaptured.
- No admin role mechanism.

## Target State (after)
- 3 tables: ai_usage_metrics, system_metrics, alert_rules (RLS deny-by-default).
- MetricsService: record (non-blocking) + query + health + alerts.
- 4 features instrumented.
- 5 admin endpoints (ADMIN_EMAILS-guarded).
- /admin/monitoring dashboard (recharts).

## Phased Approach
| Phase | Scope | Status |
|-------|-------|--------|
| Tahap 1 | Supabase Reports (docs only) | ✅ documented in spec |
| Tahap 2 | Migration (3 tables + RLS + seed) | ✅ |
| Tahap 3 | metricsConfig + MetricsService + instrumentation | ✅ |
| Tahap 4 | 5 admin endpoints + requireAdmin | ✅ |
| Tahap 5 | Dashboard + types + API client + route | ✅ |
| Tahap 6 | Alerting (checkAlerts) + Metrics API docs | ✅ |

## Key Technical Decisions
1. **Admin mechanism**: ADMIN_EMAILS env (user-chosen) — no profiles migration.
2. **Token capture**: central `generateVertexContent` chokepoint.
3. **Agent Search**: count/latency only (Discovery REST has no tokens).
4. **Chart**: recharts (already installed).
5. **RLS**: enable + no permissive policy → service-role-only access.

## Risk & Rollback
- Risk: LOW (additive migration, fire-and-forget recording).
- Rollback: `DROP TABLE IF EXISTS ai_usage_metrics, system_metrics, alert_rules;`
  + revert server/frontend files. No existing data touched.

## Testing Strategy
- tsc --noEmit, vite build, node --check (all pass).
- Manual: trigger each feature → rows appear; non-admin → 403; DB down → feature still works.
