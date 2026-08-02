# Requirements: CashFlow Audit Fix & GenAI Agent Search Implementation

## Scope

Implementasi fix dari audit report dan integrasi GenAI App Builder Agent Search.

## Audit Issues (from CASHFLOW_SYSTEM_AUDIT_REPORT.md)

### MEDIUM-001: TypeScript `any` (53 instances)
- Reduce `any` usage di runtime-critical files
- Replace dengan proper interfaces, `unknown` + type guard, atau generic

### MEDIUM-002: Vite Config firebase chunk
- Replace `firebase` chunk naming dengan `supabase`

### MEDIUM-003: Database column naming `date` vs `transaction_date`
- Standardize mapper agar backward-compatible
- Tidak drop kolom lama

### LOW-001: Build permission error
- Non-code issue, resolved by closing file locks

### LOW-002: Error boundaries for lazy routes
- Wrap semua lazy routes dengan ErrorBoundary

### Source constraint `receipt_scan`
- Database constraint harus include `receipt_scan`

## Agent Search Requirements (from GENAI_APP_BUILDER docs)

### Backend
- Health endpoint safe not-configured state
- Query endpoint dengan data store routing
- Answer endpoint untuk AI insight
- Sync endpoints (docs, transactions, gmail-logs, receipts) dengan Supabase JWT auth guard
- Error classification lengkap
- Privacy sanitization (no raw body, no tokens, no keys)
- User ID hashing dengan stable salt

### Frontend
- Route `/suite/ai-search`
- Tabs: Bantuan, Transaksi, Insight, Gmail Sync, Bukti
- Loading/empty/error states
- Mobile responsive, dark/light mode
- Disabled state jika `VITE_AGENT_SEARCH_ENABLED=false`

### Privacy
- No raw Gmail body indexed
- No tokens/keys indexed
- User ID hashed
- Results filtered by user
- Service role hanya di backend

## Validation
- `npm run build` pass
- `node --check server/index.js` pass
- Health endpoints return expected responses
