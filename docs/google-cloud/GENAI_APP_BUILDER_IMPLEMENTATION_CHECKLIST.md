# GenAI App Builder Implementation Checklist

## Scope

* [x] AI Help Center dibuat
* [x] AI Search Transaksi dibuat
* [x] AI Financial Insight dibuat
* [x] Gmail Sync Debug Search dibuat
* [x] Receipt Metadata Search dibuat
* [x] Backend Agent Search endpoints dibuat
* [x] UI Suite AI Search dibuat

## Google Cloud Setup

* [ ] Discovery Engine API enabled
* [ ] Vertex AI API enabled
* [ ] Cloud Storage API enabled
* [ ] Service account dibuat
* [ ] Data store knowledge dibuat
* [ ] Data store transactions dibuat
* [ ] Data store Gmail logs dibuat
* [ ] Data store receipts dibuat
* [ ] Search app dibuat

## Backend

* [x] `/api/agent-search/health`
* [x] `/api/agent-search/query`
* [x] `/api/agent-search/answer`
* [x] `/api/agent-search/sync-docs`
* [x] `/api/agent-search/sync-transactions`
* [x] `/api/agent-search/sync-gmail-logs`
* [x] `/api/agent-search/sync-receipts`
* [x] Error classification
* [x] Auth guard for sync endpoints

## Frontend

* [x] Route `/suite/ai-search`
* [x] Menu Suite → AI Search
* [x] Tabs Bantuan/Transaksi/Insight/Gmail Sync/Bukti
* [x] Loading state
* [x] Empty state
* [x] Error state
* [x] Result cards
* [x] Answer card
* [x] Mobile responsive
* [x] Dark/light mode

## Privacy

* [x] No raw Gmail body indexed
* [x] No Gmail token indexed
* [x] No base64 receipt indexed
* [x] No service role exposed
* [x] User_id hashed
* [x] Result filtered by user

## Test Result

| Test               | Result | Notes |
| ------------------ | ------ | ----- |
| Health endpoint    | OK | Returns safe `AGENT_SEARCH_NOT_CONFIGURED` state before Google Cloud env is filled. |
| Sync docs          | Belum remote | Needs Google Cloud bucket and service account. |
| Sync transactions  | Belum remote | Requires Supabase JWT and Google Cloud env. |
| Query help center  | Belum remote | Requires Search App configured. |
| Query transactions | Belum remote | Requires transaction sync/import first. |
| Query insight      | Belum remote | Uses transaction data store and user hash filter. |
| Query Gmail logs   | Belum remote | Requires Gmail logs sync/import first. |
| Query receipts     | Belum remote | Requires receipt metadata sync/import first. |
| Mobile 360px       | Build OK | Responsive classes implemented; browser screenshot verification still requires running authenticated app UI. |
| Build              | OK | `npm run build` passed. `npm run lint` passed. |

## File yang Diubah

| File | Perubahan |
| ---- | --------- |
| `server/services/agentSearchService.js` | Agent Search config, health, query, answer, sync docs, sync transactions, sync Gmail logs, sync receipts, sanitasi, hash user, error classification. |
| `server/index.js` | Endpoint `/api/agent-search/*` dan Supabase JWT guard. |
| `server/package.json` | Dependency Google Cloud Storage, Google Auth, dan Supabase server client. |
| `server/.env.example` | Env Agent Search, bucket, data store, user hash salt, Supabase server env. |
| `.env.example` | Flag frontend AI Search. |
| `.gitignore` | Pola ignore service account JSON. |
| `src/pages/AiSearchPage.tsx` | Halaman UI AI Search. |
| `src/features/ai-search/components/*` | Komponen tabs, search box, answer card, result card, empty state, error state. |
| `src/features/ai-search/services/agentSearchClient.ts` | Client API ke backend Agent Search. |
| `src/app/router.tsx` | Route `/suite/ai-search`. |
| `src/config/navigation.ts` | Menu mobile more untuk AI Search. |
| `src/components/layout/Sidebar.tsx` | Menu desktop AI Search. |
| `src/features/professional/ProfessionalSuitePage.tsx` | Entry point Suite ke AI Search. |
| `src/config/env.ts` | Flag AI Search frontend. |
| `docs/google-cloud/GENAI_APP_BUILDER_CASHFLOW_SETUP.md` | Panduan setup Google Cloud. |
| `docs/google-cloud/GENAI_APP_BUILDER_IMPLEMENTATION_CHECKLIST.md` | Checklist implementasi dan validasi. |

## Final Status

* Agent Search Backend: OK
* AI Search UI: OK
* Docs Sync: OK kode, butuh setup Google Cloud untuk remote test
* Transaction Sync: OK kode, butuh Supabase JWT dan setup Google Cloud untuk remote test
* Privacy Guard: OK
* Build: OK
