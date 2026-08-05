# ADR-010: Observability Architecture (Request-ID · Structured Logs · Metrics)

> **Status:** Accepted · **Date:** 2026-08 · **Owner:** Core Engineering · **Related:** [ADR-005](ADR-005-monitoring.md)

## Context

The OBSERVABILITY_REVIEW scored observability 3.0/10: metrics existed (in-database, ADR-005) but there was no request correlation, no structured logging, and no HTTP-level metrics — the three smallest actions with the highest debugging value.

## Decision

Adopt a lightweight, vendor-free observability spine:

- **Request-ID (global):** `requestIdMiddleware` runs first in the Express chain; every request gets a `req.id`, propagated to all logs (`logger.info({ requestId, ... })`) and to error responses (`requestId` field), enabling end-to-end correlation across routes, AI calls, and notifications.
- **Structured logging (pino):** `server/lib/logger.js` — JSON logs with `level`, `time`, `requestId`, `feature`, `model`; redaction rules keep secrets out of log output.
- **HTTP metrics (middleware):** `httpMetricsMiddleware` records status-code classes (4xx/5xx) and latency per route into `system_metrics`, after auth (so `req.user` is available) and before rate limiters (so 429s are counted).
- **Future OpenTelemetry compatibility:** all logging goes through one `logger` façade and all metric writes through `metricsService` — both are single choke points where an OTLP exporter can be added without touching business routes.

## Alternatives Considered

| Option | Reason rejected |
|---|---|
| Full OpenTelemetry SDK now | No collector/host yet; adds deps + config for current scale |
| APM vendor (Datadog/New Relic) | Cost + no need (see ADR-005) |
| Plain `console.log` | Unstructured — cannot correlate or filter |

## Consequences

**Positive:** Correlated debugging (`requestId` in API error + server log); HTTP SLO data (4xx/5xx/latency) available in the admin monitoring dashboard; zero external dependency; clean migration path to OTel via the two façade modules.
**Negative:** Log volume grows with structured fields (mitigated by pino's speed); in-process metrics still assume a single instance (documented in ADR-005).
