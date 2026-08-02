# GenAI App Builder CashFlow Setup

Panduan ini menjelaskan cara memakai Trial Credit for GenAI App Builder untuk fitur CashFlow AI Search, bukan untuk mengganti Gemini API free-tier. CashFlow tetap memakai Gemini untuk ekstraksi email/receipt, sementara GenAI App Builder dipakai sebagai Agent Search / Vertex AI Search / Discovery Engine untuk help center, knowledge base, transaction search, financial insight, Gmail Sync debug search, dan receipt metadata search.

## 1. Pastikan Trial Credit Aktif

1. Buka Google Cloud Console.
2. Pilih billing account yang mendapat trial credit GenAI App Builder.
3. Pastikan project CashFlow memakai billing account tersebut.
4. Cek halaman Billing > Credits untuk memastikan credit masih aktif.

## 2. Pilih Project Google Cloud

1. Buka project selector di Google Cloud Console.
2. Pilih project yang akan dipakai CashFlow.
3. Copy Project ID karena akan dipakai di `AGENT_SEARCH_PROJECT_ID`.
4. Jangan memakai project berbeda antara Data Store, Search App, bucket, dan service account.

## 3. Enable API

Aktifkan API berikut:

- Discovery Engine API
- Vertex AI API
- Cloud Storage API
- BigQuery API, jika nanti memakai BigQuery sebagai source analytics
- IAM Service Account Credentials API

Discovery Engine API adalah API utama untuk Vertex AI Search / Agent Search. Cloud Storage dipakai CashFlow untuk upload JSONL hasil sync docs dan data metadata aman.

## 4. Buat Service Account

1. Buka IAM & Admin > Service Accounts.
2. Klik Create Service Account.
3. Isi name: `cashflow-agent-search-sa`.
4. Beri description: `CashFlow backend service account for Agent Search sync and query`.
5. Tambahkan role development:
   - Discovery Engine Admin
   - Storage Admin, jika sync docs/data ke bucket
   - BigQuery Job User, jika memakai BigQuery
   - BigQuery Data Viewer, jika memakai BigQuery

Untuk production, kecilkan role sesuai kebutuhan setelah flow stabil.

## 5. Download Service Account JSON

1. Buka service account `cashflow-agent-search-sa`.
2. Tab Keys.
3. Add key > Create new key > JSON.
4. Simpan file ke:

```txt
server/google-agent-search-service-account.json
```

Jangan commit file ini. Repo sudah mengabaikan pola credential service account.

## 6. Buat Cloud Storage Bucket

Buat dua bucket:

- `cashflow-agent-search-docs`
- `cashflow-agent-search-data`

Rekomendasi:

- Location mengikuti lokasi Agent Search, atau gunakan region terdekat.
- Public access prevention aktif.
- Uniform bucket-level access aktif.
- Jangan buat bucket publik.

## 7. Buat Data Store

Buat Data Store berikut di Agent Builder / Vertex AI Search:

1. `CashFlow Knowledge Base`
   - Source: Cloud Storage JSONL docs
   - Field utama: `title`, `content`, `path`, `section`, `type`

2. `CashFlow Transactions Index`
   - Source: Cloud Storage JSONL
   - Field utama: `title`, `user_id_hash`, `type`, `amount`, `merchant`, `category`, `payment_method`, `note`, `transaction_date`, `source`, `search_text`

3. `CashFlow Gmail Logs Index`
   - Source: Cloud Storage JSONL
   - Field utama: `title`, `user_id_hash`, `subject`, `sender_domain`, `final_status`, `error_code`, `error_message`, `extracted_note`, `confidence_score`, `email_date`, `scanned_at`, `search_text`

4. `CashFlow Receipts Index`
   - Source: Cloud Storage JSONL
   - Field utama: `title`, `user_id_hash`, `transaction_id`, `merchant`, `amount`, `category`, `payment_method`, `note`, `transaction_date`, `source`, `search_text`

## 8. Buat Search App

1. Buka Agent Builder.
2. Create App.
3. Pilih Search.
4. Name: `CashFlow AI Search`.
5. Hubungkan Data Store knowledge, transactions, Gmail logs, dan receipts sesuai kebutuhan.
6. Copy Engine ID.
7. Copy Serving Config ID. Default biasanya `default_config`.

## 9. Copy ID Penting

Isi nilai berikut ke `server/.env`:

- Project ID
- Location, default `global`
- Collection, default `default_collection`
- Engine ID
- Serving Config ID
- Data Store ID knowledge
- Data Store ID transactions
- Data Store ID Gmail logs
- Data Store ID receipts
- Bucket docs
- Bucket data

## 10. Isi `server/.env`

```env
AGENT_SEARCH_ENABLED=true
AGENT_SEARCH_PROJECT_ID=your-google-cloud-project-id
AGENT_SEARCH_LOCATION=global
AGENT_SEARCH_COLLECTION=default_collection
AGENT_SEARCH_ENGINE_ID=cashflow-ai-search
AGENT_SEARCH_SERVING_CONFIG_ID=default_config

AGENT_SEARCH_KNOWLEDGE_DATA_STORE_ID=your-knowledge-data-store-id
AGENT_SEARCH_TRANSACTIONS_DATA_STORE_ID=your-transactions-data-store-id
AGENT_SEARCH_GMAIL_LOGS_DATA_STORE_ID=your-gmail-logs-data-store-id
AGENT_SEARCH_RECEIPTS_DATA_STORE_ID=your-receipts-data-store-id

AGENT_SEARCH_DOCS_BUCKET=cashflow-agent-search-docs
AGENT_SEARCH_DATA_BUCKET=cashflow-agent-search-data
AGENT_SEARCH_USER_HASH_SALT=generate-a-long-random-production-salt

GOOGLE_APPLICATION_CREDENTIALS=./google-agent-search-service-account.json
```

> Catatan (2026-08-02): Supabase sudah di-decommission. `SUPABASE_URL` dan
> `SUPABASE_SERVICE_ROLE_KEY` TIDAK lagi dibutuhkan/dipakai oleh server runtime.

Production wajib mengisi `AGENT_SEARCH_USER_HASH_SALT` dengan salt random yang stabil. Jika kosong, backend memakai fallback development agar local testing tidak gagal, tetapi hash production bisa berubah jika salt nanti diganti.

## 11. Frontend `.env`

```env
VITE_AGENT_SEARCH_ENABLED=true
VITE_AI_SEARCH_ROUTE_ENABLED=true
```

Jangan menaruh `GOOGLE_APPLICATION_CREDENTIALS`, private key, atau service role/key di frontend.

## 12. Test Health

Jalankan server:

```bash
cd server
npm install
node index.js
```

Test:

```bash
curl http://localhost:5181/api/agent-search/health
```

Jika konfigurasi benar:

```json
{
  "ok": true,
  "enabled": true,
  "message": "Agent Search siap digunakan."
}
```

Jika belum setup:

```json
{
  "ok": false,
  "code": "AGENT_SEARCH_NOT_CONFIGURED",
  "message": "Agent Search belum dikonfigurasi. Isi env server dan ikuti panduan setup."
}
```

## 13. Sync Docs

Endpoint:

```bash
curl -X POST http://localhost:5181/api/agent-search/sync-docs
```

Backend akan:

1. Membaca file `.md` di `docs`.
2. Membaca root docs penting seperti Gmail Sync dan Gemini setup.
3. Skip file yang terindikasi mengandung secret.
4. Convert ke JSONL.
5. Upload ke bucket docs.
6. Memanggil import Data Store jika Data Store ID tersedia.

## 14. Sync Transactions

Endpoint:

```bash
curl -X POST http://localhost:5181/api/agent-search/sync-transactions \
  -b "better-auth.session_token=<SESSION_COOKIE>"
```

Backend mengambil user dari session Better Auth (`req.user` — cookie, bukan Supabase JWT),
lalu query `transactions` hanya milik user tersebut dan export field aman.

## 15. Sync Gmail Logs

Endpoint:

```bash
curl -X POST http://localhost:5181/api/agent-search/sync-gmail-logs \
  -b "better-auth.session_token=<SESSION_COOKIE>"
```

Yang diindex hanya metadata aman: subject ringkas, sender domain, status, error code/message ringkas, extracted note, amount/merchant dari metadata aman jika ada, confidence, tanggal email, dan scanned_at. Full Gmail body tidak diindex.

## 16. Sync Receipts

Endpoint:

```bash
curl -X POST http://localhost:5181/api/agent-search/sync-receipts \
  -b "better-auth.session_token=<SESSION_COOKIE>"
```

Yang diindex hanya metadata transaksi receipt scan. File gambar, base64, signed URL, dan public URL privat tidak dikirim.

## 17. Test UI

1. Jalankan frontend.
2. Login ke CashFlow.
3. Buka `/suite/ai-search`.
4. Test tab:
   - Bantuan
   - Transaksi
   - Insight
   - Gmail Sync
   - Bukti
5. Jika Agent Search belum aktif, UI harus menampilkan error state aman.
6. Setelah setup, jalankan sync lalu query data.

## 18. Troubleshooting

### Permission denied

Pastikan service account punya role Discovery Engine Admin dan Storage Admin untuk development. Pastikan JSON yang dipakai adalah milik service account tersebut.

### Data store not found

Periksa `AGENT_SEARCH_*_DATA_STORE_ID`. Jangan isi display name jika field meminta ID.

### Engine not found

Periksa `AGENT_SEARCH_ENGINE_ID`, `AGENT_SEARCH_LOCATION`, dan `AGENT_SEARCH_COLLECTION`.

### Quota

Pastikan trial credit masih aktif dan quota Discovery Engine belum habis.

### Billing

Agent Builder membutuhkan project billing aktif. Trial credit tetap harus terkait ke billing account/project yang benar.

### Service account path salah

`GOOGLE_APPLICATION_CREDENTIALS=./google-agent-search-service-account.json` berarti file harus berada di folder `server`.

### API belum aktif

Enable Discovery Engine API, Vertex AI API, Cloud Storage API, dan IAM Service Account Credentials API.

## 19. Privacy Rules

Data yang boleh diindex:

- Transaction metadata aman
- User ID hash, bukan raw UUID
- Merchant, kategori, nominal, payment method, note ringkas, tanggal, source
- Gmail Sync metadata aman
- Receipt metadata aman
- Dokumentasi project yang tidak mengandung secret

Data yang tidak boleh diindex:

- Gmail token
- Refresh token
- Full Gmail body
- Full email content
- Service role
- API key
- Private key
- JWT / session token (Better Auth)
- Base64 struk
- File gambar bukti
- Permanent signed URL/private storage URL

## 20. Referensi Resmi

- Google Cloud Generative AI App Builder / Vertex AI Search documentation: https://cloud.google.com/generative-ai-app-builder/docs
- Discovery Engine API: https://cloud.google.com/generative-ai-app-builder/docs/reference/rest
- Cloud Storage documentation: https://cloud.google.com/storage/docs
