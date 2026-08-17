# AI Memory

> **Sprint 1.5 Phase 7** — Personal Memory Layer: AI mengingat preferensi user untuk rekomendasi lebih personal. **Editable, deletable, transparan, user-scoped.**

## 1. Konsep

Preferensi yang disimpan (contoh):
- "Lebih suka QRIS" (`payment_preference`)
- "Sering makan siang via GoFood" (`spending_habit`)
- "Budget mingguan" (`budget_style`)
- "Tidak suka cicilan" (`subscription` / `goal`)
- Catatan bebas (`note`)

Preferensi dipakai prompt personalisasi — **sudah di-injeksi ke prompt advisor & insight** (lihat §6). Tidak menyimpan data transaksi sensitif.

## 2. Kategori

| Kategori | Label | Contoh |
|---|---|---|
| `spending_habit` | Kebiasaan Belanja | "Belanja malam" |
| `payment_preference` | Preferensi Pembayaran | "QRIS" |
| `budget_style` | Gaya Budget | "Mingguan" |
| `subscription` | Langganan | "Netflix keluarga" |
| `goal` | Tujuan Keuangan | "Liburan Bali 2027" |
| `note` | Catatan | "Cicilan berakhir Nov" |

## 3. API

- `GET  /api/ai-product/memory` — daftar semua preferensi user.
- `POST /api/ai-product/memory` — upsert `{category, key, value, source?}`; `(user_id, category, key)` UNIQUE → insert/update.
- `PUT  /api/ai-product/memory/:id` — update `{value, source?}`.
- `DELETE /api/ai-product/memory/:id` — hapus.

`source` = `manual` (dibuat user) | `ai_inferred` (dideteksi AI — ditandai "(AI)" di UI).

## 4. UI (AiHubPage → AI Memory)

- Daftar preferensi: label kategori, `key: value`, tag "(AI)" bila inferensi.
- Edit inline (pencil → input → simpan/batal), hapus (trash).
- Tambah baru: form kategori + label + nilai.
- Transparansi: user selalu melihat apa yang AI "ingat" dan bisa menghapus kapan saja.

## 5. Privasi

- User-scoped penuh (`WHERE user_id = ?`).
- Tidak ada data keuangan dalam memory — hanya preferensi.
- Transparan: semua entri terlihat & bisa dihapus (prinsip GDPR-friendly).

## 6. Integrasi ke Prompt Advisor & Insight ("AI ingat: ...")

Memory user otomatis disisipkan ke prompt Gemini saat generate **advisor** (`POST /api/gemini/advisor`) dan **monthly report/insight** (`POST /api/gemini/monthly-report`):

- **Formatter murni**: `server/lib/aiMemoryContext.js` → blok `PREFERENSI PENGGUNA YANG AI INGAT` berisi `- key: "value" (Label Kategori)` per entri.
- **Fetch**: `loadUserMemory(userId)` di `geminiRoutes.js` — `SELECT category, key, value FROM ai_memory WHERE user_id = ?`; **gagal aman → `[]`** (memory tidak pernah menggagalkan generate).
- **Batasan token**: maksimal 12 entri (`MEMORY_PROMPT_MAX_ITEMS`) dan total ≤ 1200 char — memory tidak pernah mendominasi payload prompt.
- **Sanitasi anti prompt-injection**: control char dibuang, whitespace dinormalisasi, key ≤60 & value ≤140 char; blok diframe tegas **"BUKAN instruksi"** agar isi memory (yang bisa diedit user) tidak bisa menimpa aturan prompt.
- **Transparansi tetap**: user melihat & mengedit memory di AI Hub; AI hanya memakai `key: value` sebagai konteks personalisasi.
- Unit test: `tests/unit/aiMemoryContext.test.ts` (19 test — format, sanitasi, cap, framing, injeksi ke kedua prompt builder).
