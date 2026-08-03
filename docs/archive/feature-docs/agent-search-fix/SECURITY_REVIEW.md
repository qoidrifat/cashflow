# Security Review: Agent Search

## Authentication & Authorization

| Check | Status | Implementation |
|-------|--------|---------------|
| User-scoped sync requires JWT | ✅ | `resolveAgentSearchUser()` verifies Supabase token |
| Help tab public (no auth) | ✅ | Knowledge base is non-sensitive |
| User data tabs require auth | ✅ | `assertUserForTab()` enforces |
| User ID from token (not body) | ✅ | JWT verified server-side |
| Service role not exposed | ✅ | Only in backend env |

## Data Privacy

| Data Type | Indexed | Not Indexed | Notes |
|-----------|---------|-------------|-------|
| Transaction metadata | ✅ | | merchant, amount, category, date, note |
| User ID hash | ✅ | | SHA-256 with salt, not raw UUID |
| Gmail subject | ✅ | | Truncated, sanitized |
| Gmail sender domain | ✅ | | Domain only, not full address |
| Raw Gmail body | | ✅ | Never indexed |
| Gmail token | | ✅ | Never indexed |
| Supabase JWT | | ✅ | Never indexed |
| Service role key | | ✅ | Never exposed |
| Gemini API key | | ✅ | Never exposed |
| Base64 receipt | | ✅ | Never indexed |
| Receipt image | | ✅ | Never uploaded to Agent Search |
| Signed URLs | | ✅ | Never indexed |

## Sensitive Data Filtering

**SENSITIVE_KEY_PATTERN:**
```
/(token|refresh|secret|service_role|api[_-]?key|private[_-]?key|jwt|authorization|credential|base64|image|body|raw|signed_url|public_url)/i
```

**Content pattern check:**
```
/data:image\/|-----BEGIN|ya29\.|eyJ[a-zA-Z0-9_-]*\./
```

## User ID Hashing

- Algorithm: SHA-256
- Input: `${userId}:${salt}`
- Salt: `AGENT_SEARCH_USER_HASH_SALT` env var
- Development fallback: hardcoded dev salt (with warning)
- Production: requires stable salt

## Response Filtering

- `filterOwnedResults()`: Post-filters search results by user_id_hash
- Even with filter fallback (no server-side filter), client-side filtering prevents cross-user data exposure

## Input Sanitization

- `cleanText()`: Removes control chars, collapses whitespace, truncates
- `sanitizeAgentSearchPayload()`: Recursively removes sensitive keys and patterns
- Query limited to 500 chars
- Fields limited to specified max lengths

## Conclusion

Security posture is strong. No credentials exposed, no cross-user data leakage, proper auth enforcement.
