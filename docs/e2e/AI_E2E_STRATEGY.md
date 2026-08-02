# AI E2E Strategy — CashFlow

> Phase 4 · Strategy untuk menguji fitur AI: Vertex AI / Agent Search / Receipt OCR / Insight Generator
> Date: 2026-08-01

## 1. Prinsip

1. **Deterministik dulu, real integration kedua** — AI adalah non-deterministik & berbiaya.
2. **Quota-safe** — jangan bakar kuota Gemini/Vertex di tiap test; mock di level jaringan.
3. **Retry-aware** — Gemini punya rate-limit & transient error; test harus toleran.
4. **Layer test** — unit (parser) → integration (service dengan fixture) → E2E (UI dengan mock API).

## 2. Pemetaan Fitur AI → Strategi Test

| Fitur | Komponen | Default | Real (optional, ditandai) |
|---|---|---|---|
| **Receipt OCR** (`ScanReceiptModal`) | `geminiService`, `receiptScanService` | Mock response JSON parse (fixture `scan_result.json`) | `E2E_AI_REAL=1` — 1 gambar kecil |
| **Agent Search** (`/suite/ai-search`) | `agentSearchClient` | Mock `/api/agent-search` (route interception) | Sanity smoke 1 query |
| **Insight Generator** | `aiInsightService` | Mock summary payload | — |
| **Gmail classifier** (existing) | `geminiClassifier` | Sudah ada fixture data 519 logs | Tidak perlu real |

### Mengapa mock di level **network** (bukan komponen)?
- `page.route('**/api/**', handler)` di Playwright menangkap fetch browser → test tetap
  menjalankan UI asli, hanya respon AI yang di-mock → **paling mirip produksi, 0 kuota**.
- Untuk layanan yang dipanggil dari server (agent search), mock di route Express atau stub
  service via env `MOCK_AI=1` (rekomendasi: tambahkan flag server `AI_MOCK=1`).

## 3. Pola Implementasi (Playwright route interception)

```ts
// e2e/fixtures/aiMocks.ts
export async function mockAiEndpoints(page: Page): Promise<void> {
  await page.route('**/api/receipt/scan**', (route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify(receiptScanFixture),
    }),
  );
  await page.route('**/api/agent-search**', (route) =>
    route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(agentSearchFixture) }),
  );
}
```

- Fixture JSON diletakkan di `e2e/fixtures/` (bukan hardcode inline).
- Simulasi **rate-limit & timeout**: fixture tambahan `aiErrorFixture` (429/500) untuk menguji
  error state + retry UI.

## 4. Real Integration (quota-safe)

- **Tidak pernah** di default suite. Dijalankan via tag `@ai-real` + env gate:
  ```ts
  test('OCR real (smoke)', async () => {
    test.skip(process.env.E2E_AI_REAL !== '1', 'Real AI butuh kuota — set E2E_AI_REAL=1');
    // 1 gambar kecil, timeout 120s, retry 0
  });
  ```
- Budget: maksimal **2 real-AI call per run**; dokumentasikan konsumsi kuota di EXECUTION_REPORT.

## 5. Determinism & Retry

| Masalah | Solusi |
|---|---|
| Response AI non-deterministik | Assert **struktur** (fields ada, tipe benar), bukan nilai persis; atau snapshot struktur JSON |
| Rate-limit 429 | Mock 429 → assert UI menampilkan error state + tombol retry |
| Timeout Gemini | `test.slow()` / timeout 120s untuk real; mock selalu `page.route` dengan latensi 0 |
| Flaky karena AI | Tidak ada AI real di CI default → deterministik |

## 6. Assertion Strategy per Fitur

- **OCR**: setelah mock, assert modal menampilkan merchant/amount/tanggal hasil parse → klik simpan → toast sukses.
- **Agent Search**: assert loading → hasil card muncul (dari fixture) / empty state dari fixture kosong.
- **Insight**: assert card insight muncul; error state saat fixture error.
- **Gmail classifier**: sudah ter-cover via data 519 logs (integration nyata parser deterministik).

## 7. Rekomendasi Implementasi (Next Steps)

1. Buat `e2e/fixtures/` + `aiMocks.ts` (3 fixture: success, empty, error).
2. Tambah `e2e/ai-search.spec.ts` (P2) dan `e2e/receipt-ocr.spec.ts` (P3) dengan route interception.
3. Tambah tag `@ai-real` di `playwright.config` projects (optional project, `grep`).
4. Dokumentasikan kuota & cara menjalankan di CI_PIPELINE.md.

## 8. Risiko

- **Mock drift**: bila skema response AI berubah, fixture perlu update — mitigasi: simpan fixture
  dari response nyata (recording) + API contract check (lihat API_CONTRACT_STRATEGY.md).
- **Vertex/Discovery Engine** jarang di-test real di CI → smoke manual terjadwal (cron) lebih tepat.
