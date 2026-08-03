# ADR-006: Google Discovery Engine for Agent Search

> **Status:** Accepted · **Date:** 2026-07 · **Owner:** Core Engineering · **Related:** [ADR-004](ADR-004-ai-pipeline.md)

## Context

"AI Search" must let users query their own data (transactions, Gmail logs, receipts) in natural language and get grounded answers with sources — not raw vector search.

## Decision

Use **Google Discovery Engine** (Vertex AI Search):

- Three data stores: transactions, Gmail logs, receipts.
- Sync endpoints: `/api/agent-search/sync-transactions|gmail-logs|receipts`.
- Query + answer pipeline with grounding; config/health endpoints; auth-gated.
- Feature-flagged (`AGENT_SEARCH_ENABLED`, `VITE_AGENT_SEARCH_ENABLED`).

## Alternatives Considered

| Option | Reason rejected |
|---|---|
| Pure vector DB (Pinecone) | No grounding/ranking/enterprise search features |
| Elasticsearch | Ops burden; no semantic search out of the box |
| In-house RAG | Time-to-market; requires embeddings + rerankers + safety |

## Consequences

**Positive:** Enterprise-grade semantic search + grounding; low code; GCP-native (same project as Gemini/Gmail).
**Negative:** GCP dependency (credentials, quotas); data stores need sync cadence; per-query cost.
