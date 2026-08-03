# ADR-003: Server-Sent Events (SSE) for Realtime Updates

> **Status:** Accepted · **Date:** 2026-07 · **Owner:** Core Engineering · **Related:** [ADR-004](ADR-004-ai-pipeline.md)

## Context

Notification results (e.g., Gmail review approve/reject/duplicate) must reach the UI **without polling**, and the realtime layer must be simple to host on the Express server without extra infrastructure.

## Decision

Use **Server-Sent Events (SSE)**:

- One-way push from `server/lib/sse.js` hub to the React client (`src/lib/sse.ts`).
- EventSource with auto-reconnect; `realtimeConnected` indicator (WifiOff icon) in the header.
- E2E tests gate on `waitRealtimeConnected` for determinism (SSE connect latency does not flake tests).

## Alternatives Considered

| Option | Reason rejected |
|---|---|
| WebSocket (socket.io) | Bidirectional need is minimal; heavier protocol, extra dependency |
| Firebase Realtime | Legacy stack |
| Supabase Realtime | Project decommissioned |
| Polling | Wasteful, slower UX; already tried and replaced |

## Consequences

**Positive:** Native HTTP, auto-reconnect, trivial to host, deterministic test gates.
**Negative:** One-way only (client→server uses regular HTTP POST); no fan-out across server instances without a broker (documented limitation for horizontal scaling).
