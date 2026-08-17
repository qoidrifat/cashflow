# Documentation Drift Report

**Report Date:** 2026-08-04
**Engagement:** Analysis-only audit (no code, config, or data was modified)

**Companion Reports:**
- [IMPLEMENTATION_STATUS_REPORT.md](./IMPLEMENTATION_STATUS_REPORT.md)
- [FEATURE_COMPLETION_MATRIX.md](./FEATURE_COMPLETION_MATRIX.md)
- [GAP_ANALYSIS_REPORT.md](./GAP_ANALYSIS_REPORT.md)
- [IMPLEMENTATION_PRIORITY.md](./IMPLEMENTATION_PRIORITY.md)

---

## 1. Scope & Method

Documentation was compared against the code ground truth (React 18 + TS + Vite 5 · Express 4.22.2 port 5181 · Better Auth · Turso libSQL 22 tables · SSE `/api/events` · Vertex AI service-account · Agent Search env-flagged default off). The `.kiro` directory is gitignored and was reviewed locally.

---

## 2. Residual Documentation Drift

| # | Document | Claim | Reality | Severity | Recommended Action |
|---|---|---|---|---|---|
| D1 | `server/.env.example` | `GEMINI_API_KEY` marked WAJIB (mandatory) | Variable is dead (0 consumers); Vertex service account is used | HIGH | Remove/rewrite; P2 |
| D2 | `server/.env.example` | Fallback model `gemini-2.0-flash` | Code uses `gemini-2.5-flash-lite` | HIGH | Update model name |
| D3 | `server/.env.example` | Lists `GEMINI_HTTP_REFERER` | Dead variable | HIGH | Remove |
| D4 | `server/.env.example` | — | Missing `TURSO_DATABASE_URL`, `TURSO_AUTH_TOKEN`, `ALERT_WEBHOOK_URL`, `SMTP_*`, `GMAIL_WEBHOOK_URL`, `RATE_LIMIT_*` | HIGH | Add missing variables |
| D5 | Root `.env.example` | `GEMINI_API_KEY` guidance + `VITE_FUNCTIONS_BASE_URL` | Both dead | HIGH | Remove guidance |
| D6 | `docs/system/ARCHITECTURE.md` | "Inline endpoints" in server entry | Endpoints extracted into 11 route modules | MEDIUM | Rewrite section |
| D7 | `docs/system/ARCHITECTURE.md` | Server entry "~1650 lines" | `server/index.js` ≈ 510 lines | MEDIUM | Correct figure |
| D8 | README SSE section | "gmail events (sync completed/review needed)" | Only `gmail:log` exists | LOW | Correct event list |
| D9 | `docs/gmail-sync/GEMINI_QUOTA_AND_FALLBACK_STRATEGY.md` | `GEMINI_*` error codes; API-key upgrade advice | `VERTEX_*` reality; service-account-only architecture | MEDIUM | Rewrite for Vertex |
| D10 | `docs/adr/ADR-004-ai-pipeline.md` body | Lists `@google/generative-ai` | Header says removed; dep still in both `package.json` but 0 imports | MEDIUM | Clean dep, then align body |
| D11 | `docs/enterprise/SECURITY_AUDIT.md` §4 | `resolveAdmin` finding | Finding stale (no longer applicable) | LOW | Annotate as resolved/stale |
| D12 | `docs/ai-pipeline/*` files | Dated 2025; free-tier framing | 2026 reality; service-account billing | LOW | Re-date / re-frame |
| D13 | `docs/enterprise/EXECUTIVE_SUMMARY.md` | "12 route modules"; `index.js` line counts | 11 route files; actual counts differ | LOW | Correct figures |
| D14 | README alerting claim | SMTP alerting | `alertNotifier.js` implements webhook + in-app only | MEDIUM | Implement SMTP or correct README (P1) |
| D15 | FEATURE_MATRIX (docs) | Metrics in `admin_metrics` | Real metrics in `ai_usage_metrics` / `system_metrics`; `admin_metrics` dead | MEDIUM | Correct table reference |

---

## 3. Kiro Spec Consistency

| Spec | Consistency | State | Notes |
|---|---|---|---|
| `agent-search.md` | **HIGH** | LIVE | `hashUserId` sha256 + salt verified in code |
| `auth.md` | Bannered | Partially stale | CF-056 implemented; body stale — `firebaseUser` naming, broken doc link |
| `monitoring.md` | Bannered | Contract live | Says 4 alert rules (actually 5); wrong file location cited |
| `notification-system` | Bannered | Re-implemented | Rebuilt on Turso/SSE; `tasks.md` checkboxes stale; `notifications.type` lacks CHECK constraint unlike design |
| `supabase-core-schema-fix` | **Obsolete** | — | Supabase no longer in stack |
| `cashflow-audit-genai-implementation` | Bannered | Phases 2–3 done via Better Auth | Open tasks: 1.3, 1.4, 5.3, 6.4, 6.5 |
| `ai-pipeline-token-optimization` | Implemented phases 1–3 | No banner | Phase 4 open |
| Steering files | Stack-agnostic | Consistent | No drift |

---

## 4. ADR Alignment

| ADR | Title (subject) | Alignment | Notes |
|---|---|---|---|
| ADR-001 | Better Auth | ✅ Aligned | Implemented |
| ADR-002 | Turso | ✅ Aligned | 22 tables live |
| ADR-003 | SSE | ✅ Aligned | `/api/events` live, user isolation correct |
| ADR-004 | AI Pipeline | ⚠️ Partial | Body lists `@google/generative-ai` though header says removed; dependency cleanup pending (dep in both `package.json`, 0 imports) |
| ADR-005 | Monitoring | ✅ Aligned | Live (with minor rule-count drift in `monitoring.md` spec) |
| ADR-006 | Discovery Engine | ✅ Aligned | Live via Agent Search |
| ADR-007 | Gmail Sync | ✅ Aligned | Live |

> No uncovered Supabase/Firebase claims remain in active prose.

---

## 5. Undocumented Implementation Inventory

| # | Implementation | Missing Documentation |
|---|---|---|
| U1 | `GMAIL_WEBHOOK_URL` | Absent from README env table |
| U2 | `RATE_LIMIT_*` variables | Code-comments only — **RESOLVED 2026-08-09**: [`../security/RATE_LIMITING.md`](../security/RATE_LIMITING.md) (keputusan single source of truth, 4 limiter, env override, guards) |
| U3 | `AI_CACHE_MAX_ENTRIES` | Code-comments only |
| U4 | `AI_RETRY_*` variables | Code-comments only |
| U5 | Health endpoints | No FEATURE_MATRIX rows |
| U6 | Professional Suite (Wallet/Goals/Subscriptions) | No dedicated document |
| U7 | `imageCompression.ts` | Undocumented |
| U8 | SSE event payload shapes | Undocumented |

---

## 6. Stale Document List & Disposition

| Document / Artifact | Disposition | Rationale |
|---|---|---|
| `scripts/verify-admin-monitoring.mjs` | **Delete** (recommendation) | Superseded per CLUTTER_REPORT |
| `scripts/verify-agent-search-auth.mjs` | **Delete** (recommendation) | Superseded per CLUTTER_REPORT |
| `scripts/verify-ai-search-browser.mjs` | **Delete** (recommendation) | Superseded per CLUTTER_REPORT |
| `scripts/verify-cache-panel.mjs` | **Delete** (recommendation) | Superseded per CLUTTER_REPORT |
| `docs/mobile/` | **Keep** (status dated) | Retain with status dates |
| `docs/ui/` | **Keep** (status dated) | Retain with status dates |
| `docs/ai-pipeline/*` (2025-dated, free-tier) | **Update** | Re-date to 2026; reframe billing |
| `docs/enterprise/SECURITY_AUDIT.md` §4 | **Update** | Mark `resolveAdmin` finding stale |
| `docs/adr/ADR-004-ai-pipeline.md` | **Update** | After dependency cleanup |
| `docs/system/ARCHITECTURE.md` | **Update** | Inline-endpoint + line-count claims wrong |
| `docs/gmail-sync/GEMINI_QUOTA_AND_FALLBACK_STRATEGY.md` | **Update** | Gemini→Vertex reality |
| `.kiro/specs/supabase-core-schema-fix` | **Archive/Legacy** | Obsolete stack |
| `.kiro/specs/auth.md`, `monitoring.md`, `notification-system` | **Update** | Already bannered; fix body details |

> Legend: **Update** = fix content in place · **Delete** = remove (per prior CLUTTER_REPORT recommendation) · **Archive/Legacy** = mark as historical · **Keep** = retain with explicit status/date annotation.
> Note: all dispositions are recommendations only — this engagement modified no files.

---

## 7. Summary

| Category | Count |
|---|---|
| Residual drift items (HIGH) | 5 (D1–D5) |
| Residual drift items (MEDIUM) | 6 (D6, D7, D9, D10, D14, D15) |
| Residual drift items (LOW) | 4 (D8, D11, D12, D13) |
| Kiro specs fully consistent | 1 of 7 (`agent-search.md`) + steering files |
| ADRs aligned | 6 of 7 (ADR-004 partial) |
| Undocumented implementations | 8 |
| Delete recommendations | 4 scripts |

The highest-impact documentation fixes are the two `.env.example` templates (D1–D5) and the alerting/README honesty item (D14), all scheduled in [IMPLEMENTATION_PRIORITY.md](./IMPLEMENTATION_PRIORITY.md).
