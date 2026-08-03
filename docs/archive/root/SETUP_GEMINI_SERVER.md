# Setup Gemini API Server untuk CashFlow

> 📖 **File ini menjelaskan:** Kenapa arsitektur CashFlow dibuat seperti ini, bagaimana alur data dari browser sampai ke Gemini AI, dan langkah-langkah yang perlu kamu lakukan agar semuanya berfungsi.

---

## TL;DR — Penjelasan Singkat (Baca Ini Dulu)

### ❌ Masalah Sebelumnya

Dulu, kode CashFlow memanggil Gemini **langsung dari browser**:

```
Browser (React) ──→ https://generativelanguage.googleapis.com/...?key=VITE_GEMINI_API_KEY
```

Akibatnya:
| Masalah | Dampak |
|---------|--------|
| 🔑 **API key bocor** | `VITE_GEMINI_API_KEY` masuk ke bundle JavaScript. Siapa pun bisa buka DevTools dan lihat API key-nya |
| 🌐 **Referer blocked** | Karena request dari `localhost:5180`, Google memblokir karena HTTP referrer restriction |
| 🚫 **API disabled** | Project Google Cloud (`128646662860`) belum mengaktifkan Generative Language API |
| ❌ **Semua error tidak jelas** | User cuma lihat "Gagal mengekstrak transaksi" tanpa tahu penyebabnya |
| 🔄 **Batch sia-sia** | 200 email diproses satu per satu, semuanya gagal dengan error yang sama |

### ✅ Solusi Sekarang

Sekarang ada **Express Server** yang menjadi jembatan:

```
Browser (port 5180) ──→ Express Server (port 5181) ──→ Vertex AI (Google Cloud)
                         ↑                                ↑
                   pakai Service Account             enterprise grade
                   bukan API key                      ✅ data aman
                   ✅ API key tidak bocor             ✅ ada SLA
```

**Perubahan utama:**
1. **Tidak ada** `VITE_GEMINI_API_KEY` di kode frontend — tidak bisa bocor
2. **Semua request Gemini** lewat server proxy — tidak kena referer block
3. **Auth pakai Service Account IAM** — lebih aman, bisa di-revoke kapan saja
4. **Error classification** — user tahu persis kenapa error (API disabled, rate limited, dll)
5. **Batch berhenti otomatis** — kalau config error, batch tidak lanjut proses email lain

### 🔧 Yang Perlu Kamu Lakukan (3 Langkah)

| # | Langkah | Butuh GCP Console? | Butuh Terminal? |
|---|--------|-------------------|----------------|
| 1️⃣ | **Assign IAM Role** "Vertex AI User" ke Service Account CashFlow | ✅ Ya | ❌ Tidak |
| 2️⃣ | **Download JSON Key** → simpan di `server/cashflow-service-account.json` | ✅ Ya | ❌ Tidak |
| 3️⃣ | **Jalankan server:** `cd server && node index.js` | ❌ Tidak | ✅ Ya |

Selesai. Setelah 3 langkah itu, scan email akan berfungsi tanpa error "API disabled" atau "referer blocked".

---

## 📐 Arsitektur Sistem

Berikut alur request dari browser hingga Gemini memproses data:

```
┌─────────────────────────────────────────────────────────────────┐
│                    BROWSER (React Vite)                         │
│                                                                 │
│  Halaman Gmail Sync → fetch(/api/gemini/extract-transaction)    │
│                                                                 │
│  ⚠️ TIDAK ada panggilan langsung ke Gemini API                  │
│  ⚠️ TIDAK ada API key di JavaScript bundle                      │
└──────────────────────┬──────────────────────────────────────────┘
                       │
                       │ POST /api/gemini/extract-transaction
                       │ { emailText: "..." }
                       ▼
┌─────────────────────────────────────────────────────────────────┐
│              VITE PROXY (port 5180)                              │
│                                                                 │
│  File: vite.config.ts                                            │
│  proxy: { '/api': { target: 'http://127.0.0.1:5181' } }        │
│                                                                 │
│  Fungsinya: Meneruskan request dari frontend ke Express server  │
│  Kenapa? Agar frontend bisa panggil /api/... seolah-olah        │
│  itu bagian dari aplikasi yang sama (no CORS issues)            │
└──────────────────────┬──────────────────────────────────────────┘
                       │
                       ▼
┌─────────────────────────────────────────────────────────────────┐
│              EXPRESS SERVER (port 5181)                          │
│                                                                 │
│  File: server/index.js                                           │
│                                                                 │
│  Ini adalah "PROXY SERVER" — jembatan antara frontend dan AI    │
│                                                                 │
│  Tugasnya:                                                       │
│  1. Menerima emailText dari frontend                             │
│  2. Memvalidasi input (max 10.000 karakter)                     │
│  3. Memanggil Vertex AI SDK dengan Service Account              │
│  4. Mengembalikan hasil JSON ke frontend                        │
│                                                                 │
│  🔐 Keamanan:                                                    │
│  - GOOGLE_APPLICATION_CREDENTIALS = ./cashflow-service-account.json │
│  - File JSON credential hanya ada di SERVER, tidak di browser   │
│  - Tidak ada API key yang bocor ke client                       │
└──────────────────────┬──────────────────────────────────────────┘
                       │
                       │ Vertex AI SDK (Google Cloud)
                       │ @google-cloud/vertexai
                       │ Auth via Service Account IAM
                       ▼
┌─────────────────────────────────────────────────────────────────┐
│              VERTEX AI (Google Cloud)                            │
│                                                                 │
│  Region: asia-southeast1 (Singapore)                             │
│  - Latency terendah untuk Indonesia                              │
│  - Data tidak meninggalkan Asia                                  │
│                                                                 │
│  Model Utama:  gemini-2.5-flash  ✅ (cepat, akurat)             │
│  Model Cadangan: gemini-2.0-flash 🔄 (jika 2.5 error)          │
│                                                                 │
│  Konfigurasi:                                                    │
│  - temperature: 0.1 (konsisten, tidak banyak variasi)           │
│  - responseMimeType: application/json (paksa output JSON)       │
│  - maxOutputTokens: 1024                                        │
└──────────────────────┬──────────────────────────────────────────┘
                       │
                       ▼
┌─────────────────────────────────────────────────────────────────┐
│              HASIL: JSON Response                                │
│                                                                 │
│  {                                                               │
│    "success": true,                                              │
│    "rawResponse": "{                                             │
│       \\\"is_transaction\\\": true,                                │
│       \\\"amount\\\": 150000,                                      │
│       \\\"merchant\\\": \\\"PT KAI\\",                              │
│       \\\"category\\\": \\\"Transportasi\\",                        │
│       ...                                                       │
│    }"                                                            │
│  }                                                               │
│                                                                 │
│  Frontend kemudian parse response ini dengan:                    │
│  src/lib/geminiParser.ts → safeParseGeminiJson()                │
└─────────────────────────────────────────────────────────────────┘
```

---

## 🔄 Alur Lengkap: Dari Scan Email Sampai Transaksi Tersimpan

```
User klik "Scan Email"
    │
    ▼
1. Frontend ambil email dari Gmail API (OAuth)
    │
    ▼
2. Prefilter: classifyEmail() memeriksa subject & body
    │
    ├── auto_rejected → promo, newsletter, diskon
    ├── skipped → tidak cukup bukti transaksi
    └── send_to_ai → lanjut ke step 3
    │
    ▼
3. Kirim email ke Express Server (proxy)
    POST /api/gemini/extract-transaction
    { emailText: "..." }
    │
    ▼
4. Express Server panggil Vertex AI SDK
    genModel.generateContent({ contents: [{ parts: [{ text: prompt }] }] })
    │
    ▼
5. Gemini kembalikan JSON:
    { is_transaction, amount, merchant, category, ... }
    │
    ▼
6. Express Server kirim response ke frontend
    │
    ▼
7. Frontend parse dengan safeParseGeminiJson()
    │
    ├── is_transaction = false → auto_rejected
    ├── amount < 1000 → skipped
    └── valid → pending_review (user bisa setujui/tolak)
```

---

## 🛠️ Cara Setup Lengkap

### Prasyarat

| Komponen | Sudah? |
|----------|--------|
| Google Cloud Project `snappy-weft-479506-h5` | ✅ |
| Service Account `cashflow@...` | ✅ |
| Vertex AI API aktif | ✅ (via "Gemini for Google Cloud API") |
| Service Account punya role **Vertex AI User** | ⬜ (perlu di-set) |

### Langkah 1: Assign IAM Role

1. Buka [Google Cloud Console → IAM](https://console.cloud.google.com/iam-admin/iam)
2. Cari `cashflow@snappy-weft-479506-h5.iam.gserviceaccount.com`
3. Klik ✏️ Edit → **Add Another Role**
4. Cari dan pilih: **Vertex AI User** (`roles/aiplatform.user`)
5. Simpan

### Langkah 2: Download JSON Key

1. Buka [Service Accounts](https://console.cloud.google.com/iam-admin/serviceaccounts)
2. Klik **CashFlow**
3. Tab **Keys** → **Add Key** → **Create New Key** → **JSON**
4. File akan terdownload otomatis
5. Pindahkan file ke folder `server/cashflow-service-account.json`

### Langkah 3: Buat File Konfigurasi

Buat file `server/.env`:

```env
GCP_PROJECT_ID=snappy-weft-479506-h5
GCP_LOCATION=asia-southeast1
GOOGLE_APPLICATION_CREDENTIALS=./cashflow-service-account.json
PORT=5181
```

### Langkah 4: Jalankan Server

```bash
# Buka terminal di folder project
cd server

# Install dependencies (hanya sekali)
npm install

# Jalankan server proxy
node index.js
```

Output yang diharapkan:

```
╔══════════════════════════════════════════════╗
║        CashFlow Gemini API Proxy            ║
╠══════════════════════════════════════════════╣
║  Port:      5181                            ║
║  Project:   snappy-weft-479506-h5           ║
║  Location:  asia-southeast1                 ║
║  Auth:      Service Account (IAM)            ║
║  Model:     gemini-2.5-flash                 ║
║  Fallback:  gemini-2.0-flash                 ║
╚══════════════════════════════════════════════╝
✓ Credential: ./cashflow-service-account.json
```

### Langkah 5: Verifikasi

Buka terminal KEDUA, jalankan:

```bash
curl http://localhost:5181/api/gemini/health
```

**Jika berhasil**, response akan seperti ini:

```json
{
  "status": "ok",
  "ok": true,
  "message": "Vertex AI + Service Account berfungsi normal.",
  "projectId": "snappy-weft-479506-h5",
  "location": "asia-southeast1"
}
```

**Jika gagal**, response akan menunjukkan penyebabnya:

```json
{
  "status": "GEMINI_API_DISABLED",
  "ok": false,
  "message": "Vertex AI API belum aktif..."
}
```

### Langkah 6: Jalankan Frontend + Server Bersamaan

```bash
# Dari folder project utama
npm run dev          # Frontend (port 5180)
# DAN di terminal lain:
cd server && node index.js   # Server proxy (port 5181)

# Atau sekali jalan:
npm run dev:all      # Butuh concurrently terinstall
```

---

## 🔍 Penjelasan Detail Setiap Komponen

### 1. Browser (React Vite) — port 5180

**Apa yang terjadi:**
- User klik "Scan Email" di halaman Gmail Sync
- Frontend ambil email dari Gmail API
- Email dikirim ke `POST /api/gemini/extract-transaction`
- **Tidak ada API key Gemini di browser**

### 2. Vite Proxy — ada di `vite.config.ts`

```typescript
proxy: {
  '/api': {
    target: 'http://127.0.0.1:5181',
    changeOrigin: true,
  },
}
```

**Kenapa perlu?**
- Frontend berjalan di port 5180
- Express server di port 5181
- Vite proxy meneruskan request dari 5180 → 5181
- Frontend bisa panggil `/api/...` tanpa tahu port backend

### 3. Express Server — port 5181

**File:** `server/index.js`

Ini adalah **server proxy** yang bertugas:
1. Menerima request dari frontend
2. **Memvalidasi input** (max 10.000 karakter)
3. **Memanggil Vertex AI** dengan Service Account
4. **Mengembalikan hasil** ke frontend

**Kenapa perlu Express Server (bukan langsung dari frontend)?**

| Alasan | Detail |
|--------|--------|
| 🔐 **Keamanan** | Service Account file JSON ada di server. Browser tidak bisa akses |
| 🚫 **No API key** | Tidak ada `VITE_GEMINI_API_KEY`. API key tidak pernah masuk bundle |
| 🌐 **No CORS** | Request dari server, bukan browser. Tidak kena referer block |
| 📦 **Validasi** | Server bisa validasi ukuran dan format request |
| 🔄 **Error handling** | Server menangkap error Gemini dan mengembalikan pesan yang jelas |

### 4. Service Account (IAM)

**Email:** `cashflow@snappy-weft-479506-h5.iam.gserviceaccount.com`

**Apa itu Service Account?**
- Identitas untuk aplikasi (bukan manusia)
- Punya akses terbatas sesuai role yang diberikan
- Login via file JSON key, bukan password

**Kenapa lebih aman daripada API key?**

| API Key | Service Account |
|---------|----------------|
| String statis. Jika bocor, harus revoke manual | File JSON + IAM. Bisa dirotasi kapan saja |
| Bisa kena referer block | Tidak ada referer — server-to-server |
| Restriction terbatas (IP, referer, API) | IAM roles: izin granular per resource |
| Tidak terintegrasi dengan Google Cloud | Full integration: Secret Manager, Monitoring, dll |

### 5. Vertex AI — `asia-southeast1`

**Endpoint:** `aiplatform.googleapis.com`

**Region `asia-southeast1` (Singapore):**
- Latency terendah dari Indonesia (~20-40ms)
- Data tidak meninggalkan Asia Tenggara
- Cocok untuk kepatuhan data regional

**Model yang dipakai:**
- **Utama:** `gemini-2.5-flash` — model terbaru, cepat, akurat untuk ekstraksi data
- **Cadangan:** `gemini-2.0-flash` — jika model utama error/unavailable

### 6. Konfigurasi Generation

```javascript
generationConfig: {
  temperature: 0.1,           // Rendah → output konsisten
  topP: 0.95,                 // Nucleus sampling
  topK: 40,                   // Top-K sampling
  maxOutputTokens: 1024,      // Maks panjang response
  responseMimeType: 'application/json',  // PAKSA output JSON
}
```

**`responseMimeType: 'application/json'`** — Ini yang membuat Gemini selalu mengembalikan JSON valid. Tanpa ini, kadang Gemini mengembalikan markdown atau teks biasa.

---

## ✅ Checklist Verifikasi

Gunakan checklist ini untuk memastikan semuanya berfungsi:

- [ ] **Service Account** sudah dibuat di Google Cloud Console
- [ ] **Role "Vertex AI User"** sudah di-assign ke Service Account
- [ ] **File JSON key** sudah didownload dan disimpan di `server/cashflow-service-account.json`
- [ ] **File `server/.env`** sudah berisi `GOOGLE_APPLICATION_CREDENTIALS=./cashflow-service-account.json`
- [ ] **Server proxy** berjalan: `cd server && node index.js`
- [ ] **Health check** sukses: `curl http://localhost:5181/api/gemini/health` → `"ok": true`
- [ ] **Frontend** berjalan: `npm run dev`
- [ ] **Scan email** berhasil tanpa error "API disabled" atau "referer blocked"

---

## 🚨 Troubleshooting

| Error | Penyebab | Solusi |
|-------|----------|--------|
| `GEMINI_AUTH_ERROR` | File JSON credential tidak ditemukan atau salah | Cek path di `GOOGLE_APPLICATION_CREDENTIALS`. Pastikan file ada |
| `GEMINI_API_DISABLED` | Vertex AI API belum diaktifkan | Aktifkan "Vertex AI API" di Google Cloud Console |
| `GEMINI_RATE_LIMITED` | Terlalu banyak request dalam waktu singkat | Tunggu 1 menit, kurangi concurrency |
| `Cannot find credentials` | Environment variable `GOOGLE_APPLICATION_CREDENTIALS` tidak diset | Cek `server/.env`. Pastikan path benar |
| `Failed to fetch` dari frontend | Server proxy tidak berjalan | Jalankan `cd server && node index.js` |

---

## 📁 File yang Terkait

| File | Fungsi |
|------|--------|
| `server/index.js` | Express proxy server (yang menjembatani frontend → Vertex AI) |
| `server/.env` | Konfigurasi: project ID, region, path credential (TIDAK di-commit) |
| `server/.env.example` | Template konfigurasi (boleh di-commit) |
| `server/cashflow-service-account.json` | Credential file (TIDAK di-commit) |
| `vite.config.ts` | Proxy config: forward `/api/*` ke port 5181 |
| `src/services/geminiService.ts` | Frontend service: panggil `/api/gemini/extract-transaction` |
| `src/lib/geminiParser.ts` | Parse JSON response dari Gemini |
| `src/lib/geminiErrors.ts` | Klasifikasi error Gemini |

---

## 🔐 Keamanan: API Key Hilang Total

```
SEBELUM (❌ Tidak aman):
  Browser ↔ Gemini API langsung
  VITE_GEMINI_API_KEY ada di bundle JavaScript
  Siapa pun bisa buka DevTools dan lihat API key

SESUDAH (✅ Aman):
  Browser ↔ Express Server ↔ Vertex AI
  ✅ Tidak ada API key di bundle JavaScript
  ✅ Service Account hanya ada di server
  ✅ IAM Role bisa di-revoke kapan saja
  ✅ Data tidak dipakai training Google
  ✅ Ada SLA dari Google Cloud
```
