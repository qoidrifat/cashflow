# CashFlow — Observability Upgrade Review

> Audit READ-ONLY · 2 Agustus 2026 · Evidence-based · Pillars: Metrics, Logs, Tracing, Correlation ID.

---

## 1. Kondisi Saat Ini

| Pilar | Status | Bukti |
|---|---|---|
| **Metrics** | ✅ Ada (custom) | `ai_usage_metrics`, `system_metrics`, `alert_rules` + admin dashboard (MONITORING_AUDIT) |
| **Logs** | ⚠️ Console-only | `console.log/warn/error` di server (index 12, vertexContext 8, turso 5, dst) — tanpa structured format, tanpa level-filter, tanpa sink |
| **Tracing** | ⚠️ Parsial | `createRequestId()` di `geminiRoutes` (receipt/extract/monthly-report) untuk error response; **tidak ada** request-id di middleware global; tidak ada span |
| **Correlation ID** | ❌ Tidak ada | Tidak ada header `x-request-id` direspons/konsumsi klien; tidak di-echo ke response |
| **Feature metrics** | ✅ | 4 fitur AI (gmail_sync, agent_search, ocr_receipt, insight_generator) |
| **AI metrics** | ✅ | token, cost, latency, status |
| **DB metrics** | ❌ Tidak ada | Tidak ada query timing Turso, connection count, error count |
| **Realtime metrics** | ❌ Tidak ada | Tidak ada metrik koneksi SSE aktif, event rate, drop |
| **Request metrics (HTTP)** | ❌ Tidak ada | Tidak ada 4xx/5xx count, latency per route |
| **Distributed tracing** | ❌ Tidak ada | Tidak ada OpenTelemetry/W3C traceparent |

---

## 2. Alur Request Saat Ini (tanpa tracing)

```
Client → Express → authMiddleware → route handler
  ├─ AI call: generateVertexContent → (metrics recorded, requestId hanya di response error)
  ├─ Turso query: (no timing capture)
  └─ SSE: (no connection metric)
```

- **Tidak ada cara** menghubungkan error log → request → user → AI call (tanpa PII) → DB query.
- Debug produksi = grep console timestamp (sulit, tanpa konteks).

---

## 3. Rancangan Observability Target (minimal-invasive)

### 3.1 Request-ID Middleware (global, 1 file baru + 1 baris wiring)
```
app.use((req, res, next) => {
  req.id = req.headers['x-request-id'] || createRequestId('req');
  res.setHeader('x-request-id', req.id);
  next();
});
```
- Echo ke response → klien bisa correlate; simpan di `metadata.requestId` metrics AI (sudah ada field).
- Backward compatible: header optional, requestId string.

### 3.2 Structured Logging (pino, 1 dep + 1 module)
```
import pino from 'pino';
export const logger = pino({ base: { app: 'cashflow-server' } });
// logger.info({ requestId: req.id, route, ms }, 'request done')
```
- Ganti console.* bertahap (mulai route AI + auth + turso).
- Level: `LOG_LEVEL` env (info produksi, debug dev).
- Sink: stdout JSON (Cloud Run/Logging ready) — tanpa agent ekstra.

### 3.3 HTTP Metrics Middleware
- `res.on('finish')` → `recordSystemMetric({ metricName: 'http_status_<class>', value: 1 })` + `http_latency_ms` sum → dashboard.

### 3.4 AI Call Span
- Di `generateVertexContent`: `start = now`; simpan `{ requestId, label, model, ms, status, tokens }` via metrics `metadata` (sudah ada `metricMeta`) — cukup tambah `requestId` ke `metricMeta`.

### 3.5 SSE Health Metrics
- `addSSEClient/removeSSEClient` → system_metrics `sse_connections` delta + `sse_events_sent` counter + heartbeat miss detection.

### 3.6 DB Metrics (opsional)
- Bungkus `getTurso().execute` dengan timing counter (`db_query_ms`, `db_query_count`) — hati-hati overhead; sampling 1/10.

---

## 4. Prioritas & Dampak

| # | Aksi | Effort | Dampak |
|---|---|---|---|
| 1 | Request-ID middleware | S (30 menit) | Fondasi tracing + correlation |
| 2 | pino structured logging (bertahap) | M | Debug produksi jauh lebih cepat |
| 3 | HTTP metrics middleware | S–M | Error rate 4xx/5xx + latency |
| 4 | requestId → metricMeta AI | S | Trace AI call per request |
| 5 | SSE health metrics | S | Pantau realtime |
| 6 | DB timing (sampled) | M | Temukan slow query |
| 7 | OpenTelemetry (jauh) | L | Distributed tracing formal — hanya bila multi-service |

---

## 5. Skor Observability

| Dimensi | Skor /10 |
|---|---|
| Metrics (bisnis+AI) | 7.5 |
| Logs | 2.0 |
| Tracing | 1.5 |
| Correlation ID | 1.0 |
| DB/Realtime metrics | 1.5 |
| **Observability** | **3.0 / 10** |

---

## 6. Konklusi

Observability adalah gap terbesar bersama infrastruktur. **Mulai dari request-id + pino + HTTP metrics** (3 aksi kecil) — tanpa mengubah arsitektur, langsung menaikkan skor ke ~5.5. OpenTelemetry hanya relevan setelah multi-service (AI gateway terpisah).
