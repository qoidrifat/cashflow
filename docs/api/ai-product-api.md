# API Contract — `/api/ai-product/*` (single source of truth)

> **Owner:** Core Engineering · **Status:** Active · **Diperbarui:** 2026-08-09
> **Cakupan:** conversation · timeline · feedback · memory · track
> **Source of truth:** `server/routes/aiProductRoutes.js` · `server/routes/conversationRoutes.js`
> · `server/lib/timelineEvents.js` · `server/lib/conversationAggregator.js` · klien `src/services/{aiProductService,conversationService}.ts`
>
> Dokumen ini **satu-satunya referensi kontrak** untuk endpoint di bawah. Ubah schema di source
> **WAJIB** diiringi update dokumen ini + unit test yang me-lock kontrak
> (`tests/unit/{trackEventRoutes,aiProductRoutesValidation,timelineApi,conversationAggregator,geminiRoutesValidationG3}.test.ts`).

---

## 0. Konvensi Global

### Autentikasi
- Semua endpoint `requireAuth` (cookie Better Auth `better-auth.session_token`). Tanpa sesi → **401** `{ "error": "Unauthorized — silakan login terlebih dahulu." }`.
- Seluruh data **user-scoped** (`WHERE user_id = ?` dari sesi, bukan dari body). Resource milik user lain → **404** (bukan leak).

### Error shape (kanonik untuk namespace ini)

| Status | Shape | Kapan |
|---|---|---|
| 400 | `{ error: string, errorCode: "VALIDATION_ERROR", details: string[] }` | Validasi body/query/path gagal (`sendValidationError`) — **tidak pernah 401** |
| 401 | `{ error: string }` | Belum login (`requireAuth`) |
| 404 | `{ error: string }` | Resource tak ada / milik user lain (memory delete, timeline detail, timeline status) |
| 500 | `{ error: string, errorCode: string, requestId: string }` (+ legacy `success:false, ok:false, code, message, userMessage`) | Error tak terduga — semua 500 melalui **global handler** `handleServerError` (`server/middleware/errorHandler.js`); route memanggil `next(err)` dengan metadata (`err.errorCode`, `err.userMessage`); `requestId` = `req.id` dari `requestIdMiddleware` (korelasi log/metrics) |

- `errorCode` default `SERVER_ERROR`; conversation me-mount `CONVERSATION_FAILED` + `userMessage` spesifik (lihat §5).
- `detail` (isi `err.message`) hanya di non-produksi — tidak bocorkan internal.
- Field body tak dikenal **dibuang** (`validateBody`) — anti mass-assignment.
- `confidence` **tidak pernah dikarang**: `null` bila tidak tersedia (P9 §11).

### Enums kanonik

| Enum | Nilai | Sumber |
|---|---|---|
| `AI_FEATURES` | `advisor · insight · fraud · search · ocr · health · simulation · memory · conversation` | aiProductRoutes |
| `FEEDBACK_RATINGS` | `helpful · not_helpful · mismatched · irrelevant · already_done · skip` | aiProductRoutes + klien `types.ts` |
| `MEMORY_CATEGORIES` | `spending_habit · payment_preference · budget_style · subscription · goal · note` | aiProductRoutes + klien |
| `MEMORY_SOURCES` | `manual · ai_inferred` | aiProductRoutes |
| `EVENT_TYPES` (timeline) | `insight · recommendation · conversation · feedback · memory_update · risk · other` | timelineEvents.js |
| `TIMELINE_STATUSES` | `new · viewed · completed · dismissed` | timelineEvents.js |
| `TRACK_EVENTS` | `ai_hub_view · recommendation_shown · recommendation_opened · ai_result_shown` | aiProductRoutes |

### State machine status timeline (P9 §12)

```
new ─→ viewed ─→ completed
 │             └─→ dismissed
 ├──→ completed
 └──→ dismissed
```
`completed`/`dismissed` = final. No-op (sama) & transisi tak valid → **400 VALIDATION_ERROR**.

### Side-effect telemetry (non-PII, user-scoped → `system_metrics`)
`timeline_view` (GET list) · `timeline_event_open` (GET :id) · `timeline_status_update` `{from,to}` (PATCH) · `ai_conversation_started/_completed/_failed` (conversation) · `ai_result_shown` dll. via track. Detail payload: `docs/ai-product/EVENT_REGISTRY.md`.

---

## 1. Track — `POST /api/ai-product/track`

Telemetry frontend (exposure/engagement). **Append-only, at-least-once** — server tidak dedupe; klien wajib dedupe sendiri (`trackedIdsRef`). Record fire-and-forget (respons sebelum persist selesai).

### Request body

| Field | Type | Required | Constraint |
|---|---|---|---|
| `event` | string | ✅ | enum `TRACK_EVENTS` |
| `feature` | string | – | max 64 |
| `itemId` | string | – | max 100 |
| `eventType` | string | – | enum `EVENT_TYPES` |

Contoh: `{ "event": "recommendation_shown", "feature": "advisor", "itemId": "tl-123", "eventType": "recommendation" }`

### Response

| Status | Body |
|---|---|
| 200 | `{ ok: true }` |
| 400 | shape §0 (event tak dikenal / field invalid) |
| 500 | `{ error }` |

**Klien:** `trackAiProductEvent(event, meta?)` — mengabaikan error (non-blocking).

---

## 2. Feedback

### 2a. Create — `POST /api/ai-product/feedback`

### Request body

| Field | Type | Required | Constraint |
|---|---|---|---|
| `feature` | string | ✅ | enum `AI_FEATURES` |
| `rating` | string | ✅ | enum `FEEDBACK_RATINGS` |
| `itemId` | string | – | max 100; bila merujuk `ai_timeline.id` user → feedback **terkait** event tsb (P9 §13, tanpa duplikat event) |
| `reason` | string | – | max 500 |

### Response

| Status | Body |
|---|---|
| 201 | `{ id: string, ok: true }` |
| 400 | shape §0 |
| 500 | `{ error }` |

**Side effect:** bila `itemId` BUKAN timeline event → event timeline `feedback` otomatis (fire-and-forget).

### 2b. List — `GET /api/ai-product/feedback?feature=&limit=`

| Query | Default | Constraint |
|---|---|---|
| `feature` | (semua) | enum `AI_FEATURES` |
| `limit` | 20 | clamp [1, 200] |

**200** → array bare: `[{ id, feature, item_id, rating, reason, created_at }]` (DESC).
**Klien:** `submitFeedback()` · `listFeedback(feature?)`.

---

## 3. Memory

### 3a. List — `GET /api/ai-product/memory`

**200** → array bare: `[{ id, category, key, value, source, created_at, updated_at }]` (sort category,key ASC). **Klien:** `listMemory()`.

### 3b. Upsert — `POST /api/ai-product/memory`

**Idempoten:** `ON CONFLICT(user_id, category, key) DO UPDATE`.

| Field | Type | Required | Constraint |
|---|---|---|---|
| `category` | string | ✅ | enum `MEMORY_CATEGORIES` |
| `key` | string | ✅ | max 80 |
| `value` | string | ✅ | max 300 |
| `source` | string | – | enum `MEMORY_SOURCES` (default `manual`) |

| Status | Body |
|---|---|
| 200 | `{ id: string, ok: true }` (id hasil SELECT setelah upsert) |
| 400 | shape §0 |

**Side effect:** event timeline `memory_update` (action `set`). **Klien:** `upsertMemory()`.

### 3c. Update — `PUT /api/ai-product/memory/:id`

| Field | Type | Required | Constraint |
|---|---|---|---|
| `value` | string | ✅ | max 300 |
| `source` | string | – | enum `MEMORY_SOURCES` (default `manual`) |

| Status | Body |
|---|---|
| 200 | `{ success: true }` |
| 400 | shape §0 (termasuk id path invalid) |

⚠️ **Dokumentasi kontrak saat ini:** tidak ada cek `rowsAffected` → resource tak ada tetap **200** `{success:true}` (bukan 404). **Klien:** `updateMemory(id, ...)`.

### 3d. Delete — `DELETE /api/ai-product/memory/:id`

| Status | Body |
|---|---|
| 200 | `{ success: true }` |
| 404 | `{ error: "Preferensi tidak ditemukan." }` (cekc eksplisit sebelum delete) |
| 400 | shape §0 |

**Side effect:** event timeline `memory_update` (action `delete`). **Klien:** `deleteMemory(id)`.

---

## 4. Timeline (P9)

### 4a. List — `GET /api/ai-product/timeline` — pagination **keyset** `(created_at, id)`

| Query | Default | Constraint |
|---|---|---|
| `feature` | – | enum `AI_FEATURES` |
| `eventType` | – | enum `EVENT_TYPES` |
| `before` | – | cursor `created_at` event terakhir (≤40 char) |
| `beforeId` | – | id event terakhir — **WAJIB dikirim bersama `before`** (tie-break) |
| `limit` | 20 | clamp [1, 100] |

**200** → `{ items: TimelineRecord[], hasMore: boolean }` (DESC; `hasMore` = ada baris kelebihan via `LIMIT limit+1`).

```
TimelineRecord = {
  id, feature, event_type, status, title,
  body?: string, confidence?: number|null, payload?: string (JSON), created_at?: string
}
```
**Klien:** `listTimeline({feature?, eventType?, before?, beforeId?, limit?})`.

### 4b. Detail — `GET /api/ai-product/timeline/:id`

| Status | Body |
|---|---|
| 200 | `{ ...TimelineRecord, confidence: number|null, feedback: [{ rating, reason, created_at }] }` (feedback via `item_id`, max 10, DESC) |
| 404 | `{ error: "Timeline event tidak ditemukan." }` (termasuk event user lain) |
| 400 | shape §0 (id path invalid) |

**Klien:** `getTimelineEvent(id)` → `TimelineDetail`.

### 4c. Create — `POST /api/ai-product/timeline`

`event_type` dihitung **server** dari `feature` (klien tidak bisa set sendiri). `status` default `new`.

| Field | Type | Required | Constraint |
|---|---|---|---|
| `feature` | string | ✅ | enum `AI_FEATURES` |
| `title` | string | ✅ | max 200 |
| `body` | string | – | max 2000 |
| `confidence` | number | – | 0–1 (null = absen) |
| `payload` | object | – | ≤ 8KB serialized; primitives saja (`sanitizePayload`, max 24 key) |

| Status | Body |
|---|---|
| 201 | `{ id: string, ok: true, event_type: string }` |
| 400 | shape §0 |

**Klien:** `addTimelineEntry(input)`.

### 4d. Update status — `PATCH /api/ai-product/timeline/:id/status`

| Field | Type | Required | Constraint |
|---|---|---|---|
| `status` | string | ✅ | enum `TIMELINE_STATUSES` + transisi valid (state machine §0) |

| Status | Body |
|---|---|
| 200 | `{ success: true, id: string, status: string }` |
| 400 | shape §0 (status invalid / transisi tidak valid / no-op) |
| 404 | `{ error: "Timeline event tidak ditemukan." }` |

**Klien:** `updateTimelineStatus(id, status)`.

---

## 5. Conversation — `POST /api/ai-product/conversation`

Alur: validasi → ambil transaksi periode + periode sebelumnya → agregasi deterministik (`conversationAggregator.js`) → Gemini untuk narasi → **fallback rule-based bila gagal** (tidak pernah raw error) → catat timeline (fire-and-forget).

### Request body

| Field | Type | Required | Constraint |
|---|---|---|---|
| `query` | string | ✅ | max 200 |
| `periodDays` | number | – | **7 \| 30 \| 90** (string `'7'` ditolak; default 30) |

### Response — **200** `ConversationAnswer`

```jsonc
{
  "success": true,
  "query": "string",
  "periodDays": 30,
  "period": { "startDate": "ISO", "endDate": "ISO", "label": "string" },
  "stats": {
    "income": 0, "expense": 0, "net": 0,
    "prevIncome": 0, "prevExpense": 0, "prevNet": 0,
    "expenseDeltaPct": 0|null, "incomeDeltaPct": 0|null,
    "transactionCount": 0, "expenseCount": 0, "incomeCount": 0, "hasData": false
  },
  "narrative": {
    "summary": "string",
    "insights": [{ "title": "string", "detail": "string", "severity": "high|medium|low" }],
    "recommendations": [{ "title": "string", "action": "string", "href"?: "string", "impact"?: "string" }]
  },
  "chart": { "daily": [{ "date": "string", "income": 0, "expense": 0 }] },
  "categories": [{ "name": "string", "amount": 0, "count": 0, "pct": 0 }],
  "topMerchants": [{ "merchant": "string", "amount": 0, "count": 0 }],
  "topTransactions": [{ "id": "string", "merchant": "string", "note": "string",
                        "categoryName": "string", "amount": 0, "date": "string" }],
  "trust": { "source": "gemini|rule-based", "model"?: "string",
             "processingTimeMs": 0, "dataCoverage"?: "string",
             "timestamp"?: "string", "fallbackReason"?: "string" },
  "requestId": "string"
}
```

| Status | Body |
|---|---|
| 400 | shape §0 (query kosong/terlalu panjang, periodDays invalid) |
| 500 | `{ success: false, error, errorCode: "CONVERSATION_FAILED", requestId, message }` — via global handler (`next(err)` + `attachConversationError`) |

**Side effects:** timeline event `conversation` (confidence 0.8, payload `{periodDays, expense, income, topCategory}`); `ai_conversation_started/completed/failed`; Gemini cache TTL 1 jam (pertanyaan+data sama → hit).
**Klien:** `askFinancialQuestion({query, periodDays?})` → `ConversationAnswer`.

---

## 6. Matrix Konsistensi (audit internal)

| Endpoint | POST-create | Idempoten | Pagination | Envelope |
|---|---|---|---|---|
| `/track` | 200 `{ok:true}` | ❌ at-least-once (dedupe klien) | – | bare |
| `/feedback` POST | **201** `{id, ok}` | ❌ (korelasi timeline saja) | – | bare |
| `/feedback` GET | – | – | limit saja | bare array |
| `/memory` POST | 200 `{id, ok}` (upsert) | ✅ UNIQUE upsert | – | bare |
| `/memory` PUT/DELETE | – | – | – | bare |
| `/timeline` GET | – | – | keyset `{items,hasMore}` | bare |
| `/timeline` POST | **201** `{id, ok, event_type}` | ❌ (1 event baru per call) | – | bare |
| `/conversation` POST | 200 | ❌ (event timeline per call) | – | bare |

Catatan: `POST /memory` & `POST /conversation` mengembalikan 200 (bukan 201) — keputusan disengaja (upsert / aksi komposit); `GET /feedback` & `GET /memory` mengembalikan array bare tanpa wrapper `ok` (berbeda dari `GET /timeline` yang `{items, hasMore}`).

---

## 7. Referensi
- `docs/ai-product/EVENT_REGISTRY.md` — schema payload `system_metrics` (side-effect telemetry).
- `docs/ai-product/AI_TIMELINE.md` · `AI_CONVERSATION.md` · `AI_FEEDBACK.md` · `AI_MEMORY.md` — desain fitur & keputusan P8/P9.
- `docs/e2e/API_CONTRACT_STRATEGY.md` — strategi contract-test drift detection.
- Klien: `src/services/aiProductService.ts` · `src/services/conversationService.ts` · `src/features/ai-product/types.ts`.
