# API Contract Strategy — CashFlow

> Phase 7 · Validasi kontrak API + deteksi schema drift otomatis
> Date: 2026-08-01

## 1. Tujuan

Mendeteksi **schema drift** (perubahan bentuk response API tanpa update konsumen) secara
otomatis — mencegah regresi tak terlihat antara server Express/Turso dan client React.

## 2. Inventaris API (dari server/routes/*.js)

| Grup | Endpoints |
|---|---|
| **Transactions** | `GET /api/transactions`, `GET /api/transactions/paginated`, `POST/PUT/DELETE /api/transactions/:id` |
| **Gmail Sync** | `GET /api/gmail/logs`, `GET /api/gmail/runs`, `GET/PUT /api/gmail/settings`, `GET /api/gmail/token`, `POST /api/gmail/logs` |
| **Budgets** | `GET/POST /api/budgets`, `PUT/DELETE /api/budgets/:id`, `POST /api/budgets/update-usage` |
| **Categories** | `GET/POST /api/categories`, `PUT/DELETE /api/categories/:id`, `POST /api/categories/init-defaults` |
| **Notifications** | `GET/POST /api/notifications`, `PUT /api/notifications/:id/read`, `PUT /api/notifications/read-all`, `DELETE /api/notifications/:id` |
| **Recurring** | `GET/POST /api/recurring`, `PUT/DELETE /api/recurring/:id` |
| **Professional Suite** | Goals / Subscriptions / Wallets (CRUD) |
| **Monitoring** | (metrics service) — lihat `server/services/metricsService.js` |

## 3. Pendekatan: Contract Test Ringan (zero-dep)

**Tanpa OpenAPI/Swagger** — gunakan TypeScript types aplikasi sebagai source of truth + validasi
runtime ringan di test:

```ts
// e2e/contract/contracts.ts — schema minimal per endpoint
export const gmailLogsContract = {
  data: (v: unknown): v is Array<Record<string, unknown>> => Array.isArray(v),
  total: (v: unknown): v is number => typeof v === 'number',
  page: (v: unknown): v is number => typeof v === 'number',
  pageSize: (v: unknown): v is number => typeof v === 'number',
  summary: (v: unknown): v is Record<string, number> =>
    typeof v === 'object' && v !== null && 'autoAccepted' in v && 'needsReview' in v && 'total' in v,
};
```

```ts
// e2e/contract/contract-check.spec.ts — deteksi drift
test('gmail logs contract', async ({ request }) => {
  const res = await request.get('/api/gmail/logs?includeSummary=1&page=1&pageSize=5', {
    headers: { Cookie: `better-auth.session_token=${session.cookie}` },
  });
  expect(res.ok()).toBeTruthy();
  const body = await res.json();
  for (const [key, check] of Object.entries(gmailLogsContract)) {
    expect(check(body[key]), `field ${key} drif dari kontrak`).toBe(true);
  }
});
```

## 4. Drift Detection Otomatis

1. **Contract test per endpoint inti** (Transactions paginated, Gmail logs+summary, Budgets,
   Categories, Notifications) — assert field wajib + tipe.
2. **Fail-fast di CI** — contract spec dijalankan di job `smoke` (paling cepat), sebelum functional.
3. **Versioning header** (rekomendasi): tambahkan `X-API-Version` di server → test assert
   version >= minimal yang didukung client.
4. **Alert manual**: bila contract test merah di CI, tim server wajib update contract test
   bersamaan dengan perubahan schema (contract-test-first).

## 5. Prioritas Endpoint Contract

| Prioritas | Endpoint | Field kunci |
|---|---|---|
| 1 | `/api/gmail/logs` | data[], total, page, pageSize, summary{autoAccepted, needsReview, skippedRejected, error, total} |
| 1 | `/api/transactions/paginated` | data[], total, page, pageSize, totalPages |
| 2 | `/api/transactions` | array; tiap row: id, type, amount, date, category_name |
| 2 | `/api/budgets` | array; id, category_id, amount, month, year |
| 2 | `/api/categories` | array; id, name, icon |
| 3 | `/api/notifications` | id, type, title, read, createdAt |

## 6. Relasi dengan AI/OCR Mock

- Contract check berlaku juga untuk **mock fixture AI**: fixture harus match kontrak endpoint
  yang di-mock → jika kontrak berubah, fixture lama gagal (tanda mock drift).

## 7. Tooling Lanjutan (opsional)

- **Zod**: sudah ada di dependencies — bisa dipakai untuk schema validasi di test
  (`import { z } from 'zod'` + `schema.safeParse(body)` → error detail field).
- **OpenAPI generation** dari Express (swagger-jsdoc) — nice-to-have, bukan blocker.

## 8. Risiko

- Contract test terlalu longgar → tidak menangkap drift halus (mis. field baru opsional).
  Mitigasi: assert field wajib yang dipakai client, bukan seluruh field.
- Response error (4xx/5xx) juga perlu kontrak: `{ error: string }`.
