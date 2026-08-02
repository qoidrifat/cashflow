# Tasks: CashFlow Audit Fix & GenAI Agent Search Implementation

## Phase 1: Audit Fixes

- [x] 1.1 Fix Vite config — replace `firebase` chunk with `supabase`
- [x] 1.2 Add ErrorBoundary wrapper for all lazy-loaded routes
- [ ] 1.3 Fix `receipt_scan` source constraint (migration)
- [ ] 1.4 Reduce TypeScript `any` in critical files (incremental)

## Phase 2: Agent Search Backend

- [x] 2.1 `server/services/agentSearchService.js` — config, health, query, answer, sync
- [x] 2.2 Endpoints in `server/index.js` — health, query, answer, sync-docs/transactions/gmail-logs/receipts
- [x] 2.3 Supabase JWT auth guard for sync endpoints
- [x] 2.4 Error classification (12 error codes)
- [x] 2.5 User ID hashing with salt
- [x] 2.6 Data sanitization (no secrets indexed)
- [x] 2.7 JSONL export format

## Phase 3: Agent Search Frontend

- [x] 3.1 Route `/suite/ai-search` in router.tsx
- [x] 3.2 AiSearchPage with tabs (Bantuan/Transaksi/Insight/Gmail Sync/Bukti)
- [x] 3.3 agentSearchClient.ts service
- [x] 3.4 Loading/empty/error states
- [x] 3.5 Mobile responsive + dark/light mode
- [x] 3.6 Sidebar + Professional Suite entry point
- [x] 3.7 Disabled state when VITE_AGENT_SEARCH_ENABLED=false

## Phase 4: Env & Config

- [x] 4.1 server/.env.example updated with Agent Search vars
- [x] 4.2 .env.example updated with VITE_AGENT_SEARCH_ENABLED
- [x] 4.3 .gitignore patterns for service account JSON

## Phase 5: Documentation

- [x] 5.1 GENAI_APP_BUILDER_CASHFLOW_SETUP.md
- [x] 5.2 GENAI_APP_BUILDER_IMPLEMENTATION_CHECKLIST.md
- [ ] 5.3 CASHFLOW_AUDIT_AND_GENAI_IMPLEMENTATION_REPORT.md

## Phase 6: Validation

- [x] 6.1 TypeScript compilation passes (`tsc --noEmit`)
- [x] 6.2 Vite build passes
- [x] 6.3 Server syntax valid (`node --check`)
- [ ] 6.4 Agent Search health endpoint returns safe state
- [ ] 6.5 Remote Google Cloud setup (manual step)

## Notes

- Agent Search implementation complete per checklist (all [x])
- Remote testing requires Google Cloud env setup (manual)
- TypeScript `any` reduction is incremental — not blocking
- `receipt_scan` constraint may already work if DB was migrated
