# AI Memory

> **Sprint 1.5 Phase 7** — Personal Memory Layer: AI mengingat preferensi user untuk rekomendasi lebih personal. **Editable, deletable, transparan, user-scoped.**

## 1. Konsep

Preferensi yang disimpan (contoh):
- "Lebih suka QRIS" (`payment_preference`)
- "Sering makan siang via GoFood" (`spending_habit`)
- "Budget mingguan" (`budget_style`)
- "Tidak suka cicilan" (`subscription` / `goal`)
- Catatan bebas (`note`)

Preferensi dipakai prompt personalisasi (roadmap: injeksi ke advisor/insight prompt). Tidak menyimpan data transaksi sensitif.

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
