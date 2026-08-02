# Design: CashFlow Audit Fix & GenAI Agent Search

## Architecture

### Agent Search Backend (server/services/agentSearchService.js)

```
server/
├── index.js                              — Express endpoints
├── services/
│   └── agentSearchService.js            — Agent Search core logic
├── .env                                  — Credentials (gitignored)
└── google-agent-search-service-account.json — SA key (gitignored)
```

### Data Flow

```
User → Frontend (AI Search UI)
  → POST /api/agent-search/query
  → Server verifies Supabase JWT (for user-scoped endpoints)
  → Server calls Discovery Engine API
  → Returns filtered results
```

### Sync Flow

```
User clicks Sync → Frontend sends Supabase JWT
  → Server verifies JWT, gets user_id
  → Server queries Supabase with service role (user-scoped)
  → Sanitizes data (no raw body, no tokens)
  → Hashes user_id with stable salt
  → Exports JSONL
  → Uploads to Cloud Storage bucket
  → Triggers Data Store import
```

### Auth Guard

All `/api/agent-search/sync-*` endpoints require:
1. `Authorization: Bearer <supabase_access_token>`
2. Server verifies token via Supabase Auth
3. Extracts `user.id` from verified token
4. Queries only that user's data

### Privacy Sanitization

Indexed (safe):
- transaction metadata (amount, merchant, category, date, payment_method, note, source)
- user_id_hash (sha256 of userId + salt)
- Gmail log metadata (subject, sender_domain, status, error_code, confidence)
- Receipt metadata (merchant, amount, category, date)
- Documentation content (no secrets)

NOT indexed:
- Raw Gmail body, Gmail tokens, refresh tokens
- Supabase JWT, service role key
- Gemini API key, service account private key
- Base64 receipt images, signed URLs

### UI Route

`/suite/ai-search` — tabs with data-store-specific queries:
- Bantuan → knowledge data store
- Transaksi → transactions data store
- Insight → answer endpoint with transaction context
- Gmail Sync → gmail logs data store
- Bukti → receipts data store

### Env Strategy

Server `.env`:
- `AGENT_SEARCH_ENABLED` — master toggle
- `AGENT_SEARCH_PROJECT_ID`, `LOCATION`, `COLLECTION`, `ENGINE_ID`
- `AGENT_SEARCH_*_DATA_STORE_ID` — per data store
- `AGENT_SEARCH_USER_HASH_SALT` — stable production salt
- `GOOGLE_APPLICATION_CREDENTIALS` — SA JSON path
- `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY` — server-only

Frontend `.env`:
- `VITE_AGENT_SEARCH_ENABLED` — UI feature flag
- `VITE_AI_SEARCH_ROUTE_ENABLED` — route toggle

### Error States

- Not configured → safe message, setup instructions
- Credential missing → clear error, no secret exposed
- API disabled → actionable message
- Quota exceeded → friendly message
- Network error → retry suggestion
