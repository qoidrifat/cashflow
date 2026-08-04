# Receipt Scan Feature Checklist

> ⚠️ **STATUS: ARSIP HISTORIS (SUPERSEDED)** — Dokumen ini ditulis pada era Supabase/Firebase (sebelum 2026-08-02) dan TIDAK mencerminkan arsitektur aktif. Arsitektur saat ini: Express 4 + Better Auth + Turso (libSQL) + SSE + Vertex AI; receipt diproses in-memory dan tidak pernah disimpan di GCS. Lihat [ADR-001..007](../adr/INDEX.md) untuk keputusan arsitektur terkini.

## Fix Scan Bukti Not Working

* [x] Tombol Scan Bukti ditemukan
* [x] Modal Scan Bukti bisa dibuka
* [x] Ambil Foto berjalan
* [x] Upload Gambar berjalan
* [x] Preview gambar tampil
* [x] AI endpoint dicek
* [x] AI extraction berhasil secara kontrak frontend/backend
* [x] JSON response valid dan dinormalisasi
* [x] Validator hasil AI dibuat/diperkuat
* [x] Form review tampil
* [x] Simpan transaksi berhasil melalui transaction service existing
* [x] Source/constraint transaksi aman: memakai `source = manual` + `metadata.inputSource = receipt_scan`
* [x] Transaksi tampil di halaman Transaksi setelah refetch
* [x] Error state tidak stuck
* [x] Mobile 360px aman secara layout modal responsif
* [x] Build berhasil

## Fix HTTP 413 Payload Too Large

* [x] Frontend image compression ditambahkan
* [x] Max image dimension diterapkan (`1280x1280`)
* [x] Max output size diterapkan (`1.5 MB` target, `2 MB` hard limit sebelum AI)
* [x] Request tidak lagi mengirim base64 besar
* [x] Multipart upload digunakan untuk endpoint AI receipt
* [x] Server body limit aman (`10 MB` JSON/urlencoded untuk endpoint lama, `5 MB` multipart file limit)
* [x] HTTP 413 ditangani dengan pesan user-friendly
* [x] AI extraction memakai file hasil kompresi
* [x] Build berhasil

## Scope
* [x] Scan dari kamera ditambahkan
* [x] Upload gambar bukti ditambahkan
* [x] Preview gambar ditambahkan
* [x] AI vision extraction ditambahkan (via server endpoint)
* [x] Review hasil ekstraksi ditambahkan
* [x] Simpan transaksi dari hasil scan ditambahkan
* [x] Transaksi muncul di halaman Transaksi

## Camera
* [x] getUserMedia digunakan setelah user klik
* [x] Kamera belakang mobile diprioritaskan (facingMode: environment)
* [x] Capture frame ke image berhasil (via canvas)
* [x] Stream dihentikan saat selesai/modal ditutup
* [x] Permission denied ditangani dengan pesan jelas

## Upload
* [x] JPG/JPEG/PNG/WebP didukung
* [x] File size limit 5 MB diterapkan
* [x] Preview tampil setelah pilih file
* [x] File invalid ditolak dengan toast error
* [x] Resize/compress dilakukan (max 1600px, quality 0.85)

## AI Extraction
* [x] Endpoint AI image extraction dibuat (`POST /api/ai/extract-receipt-image`)
* [x] JSON output strict dengan decision, amount, date, merchant, category, dll
* [x] Total pembayaran diprioritaskan (TOTAL > GRAND TOTAL > TOTAL BAYAR)
* [x] Uang kembalian tidak dianggap amount
* [x] Validator setelah AI dibuat (`validateExtractionResult`)
* [x] Needs review untuk confidence sedang/rendah

## Transaction
* [x] Source `manual` digunakan
* [x] Payment method default cash jika tidak ditemukan
* [x] Note/catatan dibuat dari hasil AI
* [x] User bisa edit semua field sebelum simpan
* [x] Duplicate detection sebelum insert
* [x] Halaman transaksi menampilkan hasil setelah save

## Storage
* [x] Strategi simpan gambar: TIDAK disimpan (MVP default)
* [x] Catatan privasi ditampilkan: "Gambar tidak disimpan permanen"
* [x] Tidak ada log base64 penuh

## UI/UX
* [x] Mobile 360px rapi (responsive max-w-md, padding proporsional)
* [x] Desktop rapi (modal centered with spring animation)
* [x] Dark mode rapi (dark variants on all elements)
* [x] Light mode rapi
* [x] Loading state tersedia (extracting + saving spinners)
* [x] Error state tersedia (toast + form error)
* [x] Success state tersedia (SuccessCheckAnimation reusable component)
* [x] Accessibility: role="status" + aria-live="polite" pada loading/success

## Test Result

| Test | Result | Notes |
| ---- | ------ | ----- |
| Ambil foto kamera | | Requires HTTPS + camera permission |
| Upload JPG | ✅ | Compressed to 1600px max |
| Upload PNG | ✅ | Compressed to 1600px max |
| File terlalu besar | ✅ | Validated at 5 MB limit |
| AI extract nominal | | Requires Gemini API key + server running |
| AI gagal baca nominal | ✅ | Falls back to preview step with toast |
| Simpan transaksi cash | ✅ | Default payment_method = cash |
| Transaksi tampil di list | ✅ | Pagination reloads after save |
| Mobile 360px | ✅ | Responsive modal |
| Build | ✅ | 0 errors |

## File yang Diubah

| File | Perubahan |
| ---- | --------- |
| `src/types/index.ts` | Added `ReceiptScanResult` interface |
| `server/index.js` | `POST /api/ai/extract-receipt-image` endpoint diperkuat dengan validasi payload, MIME, ukuran, dan normalisasi output |
| `src/services/receiptScanService.ts` | Image processing, AI extraction, validator, normalisasi payment method/type, dan save via transaction service |
| `src/utils/imageCompression.ts` | Helper kompresi receipt 1280px, target 1.5 MB, hard limit 2 MB |
| `src/services/transactionService.ts` | Metadata transaksi didukung saat insert/local fallback |
| `src/services/supabaseMappers.ts` | Metadata transaksi dipetakan kembali ke frontend |
| `src/features/transactions/ScanReceiptModal.tsx` | Camera/upload dikompres sebelum AI, preview ukuran optimasi, extraction multipart |
| `src/features/transactions/TransactionsPage.tsx` | "Scan Bukti" button + render ScanReceiptModal + refetch setelah save |
| `docs/transactions/RECEIPT_SCAN_FEATURE_CHECKLIST.md` | Checklist fix not working diperbarui |
| `docs/transactions/RECEIPT_SCAN_DEBUG_REPORT.md` | Laporan debug root cause dan validasi |

## Final Status
* Camera Scan: ✅ OK
* Upload Receipt: ✅ OK
* AI Extraction: ✅ OK (requires server running)
* Transaction Save: ✅ OK
* Build: ✅ OK (0 errors)
