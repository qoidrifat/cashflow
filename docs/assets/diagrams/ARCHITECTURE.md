# Canonical Architecture Diagrams

> **Status:** Approved · **Version:** 1.0 · **Owner:** Core Engineering · **Last Updated:** 2026-08-04
> **Related:** [README](../../../README.md) (embedded copy), [docs/system/ARCHITECTURE.md](../../system/ARCHITECTURE.md)

These are the canonical Mermaid sources. Embed them in prose docs via ` ```mermaid ` fences.

## 1. System Architecture

```mermaid
flowchart LR
    subgraph Client["React SPA (Vite, port 5180)"]
        UI[React 18 + Zustand + Tailwind]
        SSE[SSE Realtime Client]
    end

    subgraph API["Express API (port 5181)"]
        AUTH[Better Auth<br/>Google OAuth + Sessions]
        ROUTES[Domain Routes<br/>transactions · budgets · gmail ·<br/>notifications · admin · ai]
        OBS[Observability<br/>request-ID · pino · HTTP metrics]
        RL[Rate Limiting<br/>express-rate-limit]
        CACHE[AI Response Cache<br/>LRU + single-flight dedup]
    end

    subgraph Data["Data Layer"]
        TURSO[(Turso / libSQL<br/>22 tables · Kysely)]
        BACKUP[(Backup + Restore<br/>backupTurso.mjs)]
    end

    subgraph GCP["Google Cloud"]
        GEM[Gemini 2.5 Flash<br/>primary + fallback models]
        VERTEX[Vertex AI]
        DE[Discovery Engine<br/>Agent Search · 3 data stores]
        GMAIL[Gmail API]
        STORAGE[Cloud Storage<br/>receipts & docs]
    end

    subgraph Mon["Monitoring & Alerts"]
        METRICS[admin_metrics · ai_usage_metrics<br/>system_metrics · alert_rules]
        ALERT[Alert Scheduler<br/>webhook + SMTP channels]
    end

    UI --> AUTH
    UI --> ROUTES
    SSE <-->|Server-Sent Events| API
    ROUTES --> TURSO
    AUTH --> TURSO
    CACHE --> TURSO
    API --> GEM
    API --> VERTEX
    API --> DE
    API --> GMAIL
    API --> STORAGE
    API --> METRICS
    METRICS --> ALERT
    ALERT -->|webhook / SMTP| Client
```

## 2. AI Pipeline — Gmail → Transaction

```mermaid
flowchart TD
    A[Gmail API scan<br/>newest-first to 2026-01-01] --> B[Gemini classifier<br/>amount · merchant · category · date]
    B --> C{Confidence score}
    C -->|high| D[Auto-accepted]
    C -->|low| E[Needs Review queue]
    C -->|malformed / duplicate| F[Rejected / Duplicate<br/>gmail_message_id dedupe]
    D --> G[(transactions)]
    E --> H[User approve / reject]
    H -->|approve| G
    H -->|outcome| I[Notification: SSE + webhook/SMTP]
    G --> J[ai_usage_metrics]
```

## 3. Sequence — Review Approve

```mermaid
sequenceDiagram
    participant U as User
    participant FE as React SPA
    participant API as Express API
    participant DB as Turso
    participant SSE as SSE Hub

    U->>FE: Klik Setujui
    FE->>API: POST /api/gmail/logs (status)
    API->>DB: update + create transaction
    API-->>FE: 200 ok + toast
    API->>SSE: push notification event
    SSE-->>FE: notification (bell + badge)
```
