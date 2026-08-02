# Security & Privacy Audit: CF-054

## Review Metadata
- **Review ID:** REVIEW-CF-054
- **Task:** Fix Agent Search Empty Results (Hash User ID Filter Mismatch / Sync Gap)
- **Review Date:** 2026-06-22
- **Reviewer:** Bob Shell (Post-Kiro Review)
- **Focus:** User-scoping integrity, credential security, privacy preservation

---

## Executive Summary

**Overall Security Score:** 97/100

**Critical Findings:** 0
**High Priority Findings:** 0
**Medium Priority Findings:** 1
**Low Priority Findings:** 0

The implementation maintains strong security posture with no critical vulnerabilities. User-scoping remains intact, credentials are properly secured, and privacy guards function correctly. One medium-priority finding relates to the fallback mechanism documentation.

---

## Security Checklist Results

### 🔴 CRITICAL: User-Scoping Integrity (KP-09)

**Status:** ✅ **PASS** - No violations detected

**Verification:**

1. **Server-side filter NOT removed or weakened:**
   ```javascript
   // server/services/agentSearchService.js:398-405
   function buildFilter(tab, userId) {
     const filters = [];
     if (tab === 'help') filters.push('type: ANY("knowledge_base")');
     if (tab === 'transactions' || tab === 'insight') filters.push('user_id_hash: ANY("' + hashUserId(userId) + '")');
     if (tab === 'gmail') filters.push('user_id_hash: ANY("' + hashUserId(userId) + '")');
     if (tab === 'receipts') filters.push('user_id_hash: ANY("' + hashUserId(userId) + '")');
     return filters.join(' AND ');
   }
   ```
   - ✅ Filter generation unchanged
   - ✅ User-scoped tabs still require `user_id_hash` filter
   - ✅ No wildcard or global filters introduced

2. **Filter applied in Discovery Engine requests:**
   ```javascript
   // Line 477-478: Primary search
   const payload = {
     query: safeQuery,
     pageSize: 10,
     queryExpansionSpec: { condition: 'AUTO' },
     spellCorrectionSpec: { mode: 'AUTO' },
     ...(filter ? { filter } : {}),  // ✅ Filter included
   };
   
   // Line 530: Answer generation
   searchSpec: {
     searchParams: {
       maxReturnResults: 8,
       ...(filter ? { filter } : {}),  // ✅ Filter included
     },
   },
   ```

3. **Client-side defense-in-depth maintained:**
   ```javascript
   // Line 442-461: filterOwnedResults
   function filterOwnedResults(results, tab, userId, { serverFilterApplied = false } = {}) {
     if (!USER_SCOPED_TABS.has(tab)) return results;
     const expectedHash = hashUserId(userId);
     return results.filter((result) => {
       const hash = result.user_id_hash;
       if (hash === expectedHash) return true;  // ✅ Exact match kept
       if (hash === undefined || hash === null || hash === '') {
         return serverFilterApplied;  // ✅ Trust server filter when applied
       }
       return false;  // ✅ Mismatch always dropped
     });
   }
   ```

4. **Cross-user leak simulation:**
   - Scenario: User B queries while User A's documents exist
   - Server filter: `user_id_hash: ANY("hash_<User_B_hash>")`
   - Discovery Engine returns: Only User B's documents (or none if field not filterable)
   - Client filter: Drops any mismatched hashes
   - **Result:** ✅ User B CANNOT see User A's data

5. **Fallback path security:**
   ```javascript
   // Line 479-490: Fallback on 400 error
   try {
     data = await discoveryRequest(':search', payload);
   } catch (searchError) {
     const errStatus = searchError?.response?.status || searchError?.code;
     if (errStatus === 400 && filter) {
       try {
         const fallbackPayload = { ...payload };
         delete fallbackPayload.filter;  // ⚠️ No server filter
         data = await discoveryRequest(':search', fallbackPayload);
         serverFilterApplied = false;  // ✅ Tracked
         fallbackUsed = true;
       } catch (retryError) {
         throw retryError;
       }
     } else {
       throw searchError;
     }
   }
   ```
   - When fallback triggers: `serverFilterApplied = false`
   - Client filter behavior: `return serverFilterApplied` → returns `false` for field-absent results
   - **Result:** ✅ Fail-closed - field-absent results dropped on fallback

**Verdict:** ✅ **SECURE** - User-scoping NOT weakened. Server filter remains primary guard. Client filter provides defense-in-depth with fail-closed behavior on fallback.

---

### 🔴 CRITICAL: Service Role Key Security (KP-06)

**Status:** ✅ **PASS** - No violations detected

**Verification:**

1. **No hardcoded credentials:**
   ```bash
   # Search results in server/services/
   - Line 18 (metricsService.js): process.env.SUPABASE_SERVICE_ROLE_KEY ✅
   - Line 449 (agentSearchService.js): process.env.SUPABASE_SERVICE_ROLE_KEY ✅
   ```
   - All service role keys read from environment variables
   - No hardcoded keys found

2. **No credential leakage to frontend:**
   ```bash
   # Search results in src/
   - config/env.ts: Only documentation comments about NOT using service_role in frontend ✅
   - No service_role key imports or usage in client code ✅
   ```

3. **GCP credential handling:**
   ```javascript
   // Line 23-26: Credential path resolution
   function resolveCredentialPath(rawPath) {
     if (!rawPath) return '';
     return path.isAbsolute(rawPath) ? rawPath : path.resolve(SERVER_ROOT, rawPath);
   }
   
   // Line 28-45: Config with credential path
   credentialPath: resolveCredentialPath(process.env.GOOGLE_APPLICATION_CREDENTIALS || './google-agent-search-service-account.json'),
   credentialExists: !!credentialPath && fs.existsSync(credentialPath),
   ```
   - ✅ Credential path from environment variable
   - ✅ File existence checked, not exposed to client
   - ✅ Used only in server-side GoogleAuth initialization

4. **Sensitive data sanitization:**
   ```javascript
   // Line 16: Pattern for sensitive keys
   const SENSITIVE_KEY_PATTERN = /(token|refresh|secret|service_role|api[_-]?key|private[_-]?key|jwt|authorization|credential|base64|image|body|raw|signed_url|public_url)/i;
   
   // Line 107-118: sanitizeAgentSearchPayload
   for (const [key, value] of Object.entries(input)) {
     if (SENSITIVE_KEY_PATTERN.test(key)) continue;  // ✅ Sensitive keys dropped
     if (typeof value === 'string' && /data:image\/|-----BEGIN|ya29\.|eyJ[a-zA-Z0-9_-]*\./.test(value)) continue;  // ✅ Tokens/images dropped
     // ...
   }
   ```

**Verdict:** ✅ **SECURE** - No credential exposure. All sensitive keys properly secured in environment variables.

---

### 🔴 CRITICAL: Data Sent to Agent Search (Privacy)

**Status:** ✅ **PASS** - No violations detected

**Verification:**

1. **What is sent to Discovery Engine:**
   - Query text (user input, sanitized)
   - Filter string (contains hash, not raw userId)
   - Page size, query expansion, spell correction settings
   - ✅ NO tokens, NO raw email body, NO service role, NO images

2. **Document ingestion sanitization:**
   ```javascript
   // Line 107-118: sanitizeAgentSearchPayload
   export function sanitizeAgentSearchPayload(input) {
     // ...
     for (const [key, value] of Object.entries(input)) {
       if (SENSITIVE_KEY_PATTERN.test(key)) continue;  // ✅ Drops sensitive keys
       if (typeof value === 'string' && /data:image\/|-----BEGIN|ya29\.|eyJ[a-zA-Z0-9_-]*\./.test(value)) continue;  // ✅ Drops tokens/images
       // ...
     }
   }
   ```

3. **Transaction documents:**
   ```javascript
   // Line 134-156: buildTransactionSearchDocument
   return sanitizeAgentSearchPayload({
     id: `transaction_${transaction.id}`,
     transaction_id: String(transaction.id),
     user_id_hash: userHash,  // ✅ Hash, not raw userId
     title: cleanText(...),
     type, amount, currency, merchant, category, payment_method, note,
     transaction_date, source, created_at, search_text
   });
   ```
   - ✅ Only `user_id_hash` (hashed), not raw `user_id`
   - ✅ No tokens, no credentials
   - ✅ Text fields sanitized via `cleanText()`

4. **Gmail log documents:**
   ```javascript
   // Line 158-178: buildGmailLogSearchDocument
   return sanitizeAgentSearchPayload({
     id: `gmail_log_${log.id || hash}`,
     gmail_message_id_hash: hash,  // ✅ Hash of message ID
     user_id_hash: hashUserId(log.user_id || log.userId),  // ✅ Hash, not raw userId
     title, subject, sender_domain, final_status, error_code, error_message,
     extracted_note, amount, merchant, confidence_score, email_date, scanned_at, search_text
   });
   ```
   - ✅ No raw email body
   - ✅ Only sender domain, not full email address
   - ✅ No OAuth tokens or refresh tokens

5. **Knowledge base documents:**
   ```javascript
   // Line 418-420: syncCashFlowDocs - secret detection
   if (/-----BEGIN PRIVATE KEY-----|service_role|refresh_token|client_secret/i.test(raw)) {
     skipped.push({ path: path.relative(PROJECT_ROOT, file).replace(/\\/g, '/'), reason: 'possible_secret' });
     continue;
   }
   ```
   - ✅ Files with secrets are skipped
   - ✅ Markdown content cleaned (code blocks with sensitive patterns removed)

**Verdict:** ✅ **SECURE** - No sensitive data sent to Agent Search. Proper sanitization and hashing applied.

---

### 🟠 MEDIUM: Query Injection Prevention

**Status:** ✅ **PASS** - Adequate protection

**Verification:**

1. **Query sanitization:**
   ```javascript
   // Line 467: Query cleaning
   const safeQuery = cleanText(query, 500);
   
   // Line 165-171: cleanText function
   function cleanText(value, maxLength = 800) {
     return String(value || '')
       .replace(/[\u0000-\u001f\u007f]/g, ' ')  // ✅ Control chars removed
       .replace(/\s+/g, ' ')  // ✅ Whitespace normalized
       .trim()
       .slice(0, maxLength);  // ✅ Length limited
   }
   ```

2. **Filter string construction:**
   ```javascript
   // Line 398-405: buildFilter
   if (tab === 'transactions' || tab === 'insight') filters.push('user_id_hash: ANY("' + hashUserId(userId) + '")');
   ```
   - ⚠️ String concatenation used
   - ✅ BUT: `userId` comes from authenticated JWT (Supabase), not user input
   - ✅ `hashUserId()` produces deterministic hex string (no special chars)
   - **Risk:** LOW - userId is trusted source, hash output is safe

3. **Discovery Engine API:**
   - Filter syntax: `field: ANY("value")`
   - User input goes to `query` field (separate from filter)
   - Filter constructed server-side from trusted userId
   - **Result:** ✅ No injection vector for user input into filter

**Verdict:** ✅ **ADEQUATE** - Query sanitized, filter constructed from trusted source. No injection vulnerability detected.

---

## Privacy Checklist Results

### 🔴 CRITICAL: Hash + PII Logging (KP-05)

**Status:** ✅ **PASS** - No violations detected

**Verification:**

1. **Observability log analysis:**
   ```javascript
   // Line 651-660: Console log
   console.log('[agent-search] query diagnostics', {
     tab: safeTab,
     hashPrefix: userId ? hashUserId(userId).slice(0, 16) : null,  // ✅ Only first 16 chars
     serverFilterApplied,
     fallbackUsed,
     rawCount,
     extractedCount: rawResults.length,
     userIdHashFieldPresent: fieldPresentCount,
     finalCount: results.length,
   });
   ```

2. **What is logged:**
   - ✅ `tab`: search tab name (safe)
   - ✅ `hashPrefix`: First 16 characters of hash (NOT full hash, NOT raw userId)
   - ✅ `serverFilterApplied`: boolean (safe)
   - ✅ `fallbackUsed`: boolean (safe)
   - ✅ `rawCount`: number (safe)
   - ✅ `extractedCount`: number (safe)
   - ✅ `userIdHashFieldPresent`: number (safe)
   - ✅ `finalCount`: number (safe)

3. **What is NOT logged:**
   - ✅ No raw `userId`
   - ✅ No full hash (only 16-char prefix)
   - ✅ No email addresses
   - ✅ No query text (could contain PII)
   - ✅ No result content

4. **Privacy analysis:**
   - Hash prefix alone: Cannot reverse to userId
   - Hash prefix + userId together: Would break anonymization
   - Current implementation: ✅ Only hash prefix, no userId → anonymization preserved

**Verdict:** ✅ **SECURE** - No PII logged with hash. Anonymization preserved.

---

### Document Storage Privacy

**Status:** ✅ **PASS** - No violations detected

**Verification:**

1. **What is stored in datastore:**
   - Transaction documents: sanitized fields, `user_id_hash` (not raw userId)
   - Gmail log documents: sender domain (not full email), no raw body, `user_id_hash`
   - Receipt documents: same as transactions, no image data
   - Knowledge base: public documentation only, secrets skipped

2. **What is NOT stored:**
   - ✅ No raw email body
   - ✅ No receipt images (base64)
   - ✅ No OAuth tokens
   - ✅ No service role keys
   - ✅ No raw user IDs

**Verdict:** ✅ **SECURE** - Only necessary, sanitized data stored. No PII exposure.

---

### Error Message Privacy

**Status:** ✅ **PASS** - No violations detected

**Verification:**

1. **Error classification:**
   ```javascript
   // Line 685-745: classifyAgentSearchError
   export function classifyAgentSearchError(error) {
     const rawMessage = error?.message || error?.details || String(error || '');
     const message = rawMessage.toLowerCase();
     // ...
     return {
       code,
       message: userMessage,  // ✅ Generic user-facing message
       detail: rawMessage,    // ⚠️ Raw message (server-side only)
     };
   }
   ```

2. **Error exposure to frontend:**
   ```typescript
   // src/features/ai-search/services/agentSearchClient.ts:48-54
   async function parseResponse<T>(response: Response): Promise<T> {
     const payload = await response.json().catch(() => ({}));
     if (!response.ok || payload?.ok === false) {
       const error = new Error(payload?.message || 'AI Search request gagal.');  // ✅ Generic message
       (error as Error & { code?: string; status?: number }).code = payload?.code;
       (error as Error & { code?: string; status?: number }).status = response.status;
       throw error;
     }
     return payload as T;
   }
   ```

3. **What frontend receives:**
   - ✅ Generic error codes (e.g., `AGENT_SEARCH_NOT_CONFIGURED`)
   - ✅ User-friendly messages (e.g., "Agent Search belum dikonfigurasi")
   - ✅ NO filter strings, NO hash values, NO internal paths

**Verdict:** ✅ **SECURE** - Error messages sanitized for frontend. No internal details exposed.

---

## Findings Summary

### Critical Findings
**Count:** 0

None detected.

---

### High Priority Findings
**Count:** 0

None detected.

---

### Medium Priority Findings
**Count:** 1

#### M-01: Fallback Mechanism Documentation

**Severity:** 🟠 MEDIUM
**Pattern:** N/A (architectural concern)
**Location:** server/services/agentSearchService.js:479-490

**Description:**
The fallback mechanism (retry without filter on 400 error) is secure but could benefit from additional documentation about when it triggers and its security implications.

**Current Implementation:**
```javascript
try {
  data = await discoveryRequest(':search', payload);
} catch (searchError) {
  const errStatus = searchError?.response?.status || searchError?.code;
  if (errStatus === 400 && filter) {
    try {
      const fallbackPayload = { ...payload };
      delete fallbackPayload.filter;
      data = await discoveryRequest(':search', fallbackPayload);
      serverFilterApplied = false;
      fallbackUsed = true;
    } catch (retryError) {
      throw retryError;
    }
  } else {
    throw searchError;
  }
}
```

**Security Analysis:**
- ✅ Fallback is fail-closed (client filter drops field-absent results)
- ✅ `serverFilterApplied` flag properly tracked
- ✅ `fallbackUsed` logged for observability
- ⚠️ Could add comment explaining why 400 triggers fallback (field not filterable)

**Recommendation:**
Add inline comment explaining fallback trigger condition:
```javascript
// If search fails with 400 (likely due to user_id_hash not marked Filterable in schema),
// retry without filter. Client filter provides defense-in-depth (fail-closed on fallback).
if (errStatus === 400 && filter) {
```

**Impact:** LOW - Does not affect security, only code maintainability

**Action:** DOCUMENT ONLY (no code change required)

---

### Low Priority Findings
**Count:** 0

None detected.

---

## Security Score Breakdown

| Dimension | Score | Weight | Weighted Score |
|-----------|-------|--------|----------------|
| User-Scoping Integrity | 100/100 | 30% | 30.0 |
| Credential Security | 100/100 | 25% | 25.0 |
| Data Privacy (ingestion) | 100/100 | 20% | 20.0 |
| Logging Privacy | 100/100 | 15% | 15.0 |
| Injection Prevention | 95/100 | 5% | 4.75 |
| Error Message Privacy | 100/100 | 5% | 5.0 |

**Overall Security Score:** 99.75/100 → **97/100** (rounded, accounting for M-01)

---

## Privacy Score Breakdown

| Dimension | Score | Notes |
|-----------|-------|-------|
| Hash Anonymization | 100/100 | Only hash prefix logged, no raw userId |
| Document Sanitization | 100/100 | Sensitive fields dropped, proper cleaning |
| PII Exposure | 100/100 | No PII in logs, errors, or datastore |
| Cross-User Isolation | 100/100 | Server + client filters prevent leaks |

**Overall Privacy Score:** 100/100

---

## Compliance Verification

### GDPR / Privacy Regulations
- ✅ User data hashed (pseudonymization)
- ✅ No PII in logs
- ✅ User-scoped access enforced
- ✅ Sensitive data sanitized before storage

### Security Best Practices
- ✅ Defense-in-depth (server + client filters)
- ✅ Fail-closed on fallback
- ✅ Credentials in environment variables
- ✅ Input sanitization
- ✅ Error message sanitization

---

## Recommendations

1. ✅ **APPROVE** - Security posture is strong
2. 📝 **OPTIONAL:** Add inline comment for fallback mechanism (M-01)
3. 📊 **MONITORING:** Track `fallbackUsed` metric to identify datastore schema issues
4. 🔒 **OPERATIONAL:** Ensure `AGENT_SEARCH_USER_HASH_SALT` is properly secured in production environment

---

## Final Verdict

**Security Status:** ✅ **APPROVED**

The implementation maintains excellent security posture with:
- Zero critical or high-priority vulnerabilities
- Strong user-scoping with defense-in-depth
- Proper credential management
- Privacy-preserving logging and data handling
- One minor documentation improvement opportunity (non-blocking)

**Next Step:** Proceed to STEP 3 (Technical Review)
