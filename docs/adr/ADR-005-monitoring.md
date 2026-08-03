# ADR-005: In-Database Monitoring & Alert Scheduler

> **Status:** Accepted · **Date:** 2026-07 · **Owner:** Core Engineering · **Related:** [ADR-004](ADR-004-ai-pipeline.md)

## Context

The platform needed per-feature, per-user, and per-AI-call metrics plus alerting — without adding an external APM/observability vendor. The admin dashboard (`/admin/monitoring`) must answer "what is the health of each feature and AI usage?".

## Decision

Store metrics in Turso and evaluate alerts in-process:

- Tables: `admin_metrics` (feature calls), `ai_usage_metrics` (tokens/latency/cost), `system_metrics` (memory/CPU), `alert_rules`.
- In-process alert scheduler (`ALERT_SCHEDULER_ENABLED`, interval + cooldown) evaluates rules and fires channels.
- Channels: in-app notification + webhook (`ALERT_WEBHOOK_URL`) + SMTP (`SMTP_*`).
- Observability middleware: request-ID → pino structured logs → HTTP metrics (4xx/5xx/latency).
- Admin routes gated by `ADMIN_EMAILS` (E2E-tested 401/403).

## Alternatives Considered

| Option | Reason rejected |
|---|---|
| External APM (Datadog/New Relic) | Cost, complexity, no need at this scale |
| Prometheus/Grafana | Ops burden for a small app |
| Cloudwatch/Supabase analytics | Cloud lock-in; decommissioned providers |

## Consequences

**Positive:** Zero external dependency; admin-visible; alert channels configurable; metrics queryable with SQL.
**Negative:** Scheduler runs in-process (single-instance assumption); retention is unbounded (cleanup job recommended).
