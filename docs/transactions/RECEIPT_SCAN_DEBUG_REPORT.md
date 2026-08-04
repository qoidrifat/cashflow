# Receipt Scan Debug Report

> ⚠️ **STATUS: ARSIP HISTORIS (SUPERSEDED)** — Dokumen ini ditulis pada era Supabase/Firebase (sebelum 2026-08-02) dan TIDAK mencerminkan arsitektur aktif. Arsitektur saat ini: Express 4 + Better Auth + Turso (libSQL) + SSE + Vertex AI; receipt diproses in-memory dan tidak pernah disimpan di GCS. Lihat [ADR-001..007](../adr/INDEX.md) untuk keputusan arsitektur terkini.

## Root Cause

Fitur Scan Bukti tidak berfungsi end-to-end karena modal `ScanReceiptModal` sudah di-import dan state `showScanModal` sudah ada di `TransactionsPage`, tetapi komponen modal tidak dirender di JSX akhir halaman. Akibatnya klik tombol `Scan Bukti` hanya mengubah state dan tidak menampilkan modal.

Temuan tambahan:

* Output Gemini Vision dapat mengembalikan value seperti `debit`, `credit`, `transfer`, `unknown`, `risk_flags: null`, atau confidence di luar range yang tidak selalu cocok dengan enum frontend.
* Jalur simpan scan sebelumnya insert langsung ke Supabase, sehingga tidak memakai local fallback dan tidak konsisten dengan duplicate handling utama di `transactionService`.
* Constraint `transactions.source` di migration existing belum menjamin `receipt_scan` valid di semua database aktif. Jalur aman adalah `source = manual` dengan `metadata.inputSource = receipt_scan`.

## File yang Diubah

| File | Perubahan |
| ---- | --------- |
| `src/features/transactions/TransactionsPage.tsx` | Render `ScanReceiptModal`, close handler, refetch halaman pertama setelah save, dan notification metadata scan |
| `src/services/receiptScanService.ts` | Normalisasi payment method/type, hardening validator AI, fallback tanggal hari ini, dan save via `addTransaction` |
| `src/services/transactionService.ts` | Tambah dukungan metadata saat local save dan Supabase insert |
| `src/services/supabaseMappers.ts` | Mapping `transactions.metadata` ke model frontend |
| `src/types/index.ts` | Tambah `metadata` optional pada `Transaction` dan `TransactionFormData` |
| `server/index.js` | Validasi base64/MIME/ukuran image, normalisasi hasil receipt AI, dan limit JSON 8 MB |
| `docs/transactions/RECEIPT_SCAN_FEATURE_CHECKLIST.md` | Checklist fix not working diperbarui |

## Solusi

* Modal Scan Bukti sekarang benar-benar dirender dari halaman Transaksi.
* Upload/camera tetap memakai preview data URL lokal dan tidak menyimpan gambar permanen.
* AI extraction tetap lewat backend `POST /api/ai/extract-receipt-image`, bukan dari frontend langsung ke Gemini.
* Backend menolak payload non-base64, MIME selain JPG/PNG/WebP, dan image di atas 5 MB.
* Hasil AI dinormalisasi sebelum masuk UI agar tidak crash karena value enum yang berbeda.
* Validator frontend memastikan amount, confidence, date, payment method, type, dan risk flags aman.
* Save transaksi memakai `addTransaction`, sehingga duplicate detection, local fallback, dan payload schema mengikuti service transaksi existing.
* `source` tetap `manual` untuk menghindari constraint error; identitas scan disimpan di metadata.

## Test Result

| Test | Result | Notes |
| ---- | ------ | ----- |
| Tombol Scan Bukti membuka modal | OK | Root cause diperbaiki dengan render `ScanReceiptModal` |
| Upload gambar valid | OK by code path | JPG/PNG/WebP, max 5 MB |
| Preview gambar | OK by code path | Data URL lokal, tidak disimpan permanen |
| AI endpoint contract | OK by build | Backend dan frontend memakai JSON `{ image, mimeType, userHint }` |
| AI output invalid enum | OK | Dinormalisasi ke enum frontend |
| Simpan transaksi | OK by build | Via `addTransaction` source manual + metadata receipt_scan |
| Transaksi tampil di halaman Transaksi | OK by code path | `loadTransactions(1)` dipanggil setelah save |
| Lint/typecheck | OK | `npm run lint` berhasil |
| Build | OK | `npm run build` berhasil |

## Manual Step Tersisa

* Jalankan `npm run dev:all`, login, buka Transaksi, klik `Scan Bukti`.
* Uji kamera pada secure context atau browser yang memberi izin kamera.
* Uji upload gambar struk asli dan pastikan `server/.env` atau `.env.local` memiliki Gemini API key yang valid.
* Jika ingin menyimpan file bukti secara permanen, siapkan bucket private `transaction-receipts` dan policy user-owned sebelum mengaktifkan upload storage.

## Fix HTTP 413 Payload Too Large

### Root Cause

Error `Server AI mengembalikan HTTP 413` terjadi karena gambar bukti transaksi dikirim sebagai base64 di JSON request. Base64 membuat payload lebih besar dari file asli, dan gambar kamera modern bisa melewati limit request body Express sebelum AI sempat memproses.

### Perubahan

| Area | Sebelum | Sesudah |
| ---- | ------- | ------- |
| Frontend request | JSON `{ image: base64 }` | `multipart/form-data` dengan file hasil kompresi |
| Kompresi frontend | Data URL 1600px quality 0.85 tanpa target byte ketat | File JPEG 1280px quality bertahap 0.75/0.65/0.55/0.45 |
| Target output | Tidak ada target 1.5 MB | Target 1.5 MB, hard limit 2 MB sebelum dikirim |
| Input upload | Maks 5 MB | Maks 10 MB, lalu dikompres |
| Server parser | `express.json({ limit: '8mb' })` | JSON/urlencoded 10 MB untuk fallback, multipart file limit 5 MB |
| Error 413 | Bisa tampil sebagai HTTP 413 mentah | JSON user-friendly `PAYLOAD_TOO_LARGE` |

### Endpoint

`POST /api/ai/extract-receipt-image` sekarang menerima:

* `multipart/form-data` field `image` untuk flow utama.
* Legacy JSON base64 kecil untuk kompatibilitas lama.

Server mengubah file kecil menjadi base64 hanya di backend sebelum dikirim ke Gemini Vision. Base64 penuh tidak dilog.

### Test Result

| Test | Result | Notes |
| ---- | ------ | ----- |
| Typecheck | OK | `npm run lint` berhasil |
| Build | OK | `npm run build` berhasil |
| Syntax server | OK | `node --check server/index.js` berhasil |
| Multipart 6 MB | OK | Server port sementara mengembalikan 413 JSON user-friendly |
| Upload kecil | Belum manual | Perlu gambar struk asli + sesi browser |
| Upload 3-8 MB | Belum manual | Frontend akan kompres ke target 1.5 MB sebelum AI |
