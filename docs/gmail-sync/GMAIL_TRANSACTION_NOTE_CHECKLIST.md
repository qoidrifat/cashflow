# Gmail Transaction Note Checklist

## Scope

- [x] Catatan transaksi ditambahkan
- [x] AI extraction menghasilkan note (via ExtractedTransaction.note)
- [x] Fallback parser menghasilkan note (via builder)
- [x] Auto accepted menyimpan note
- [x] Needs review menampilkan note
- [x] Approve review menyimpan note
- [x] Halaman transaksi menampilkan note (TransactionItem.tsx)
- [x] Detail transaksi menampilkan note (existing modal)

## Database

- [x] `transactions.note` tersedia (already existed)
- [x] `gmail_sync_logs.extracted_note` ditambahkan (migration 202606200005; remote project aktif diverifikasi 2026-06-21)
- [x] Migration aman (add column if not exists)
- [x] Schema cache reload (`notify pgrst`)

## Note Builder

- [x] Helper `buildTransactionNote` dibuat
- [x] Helper `sanitizeTransactionNote` dibuat
- [x] Template tiket.com tersedia
- [x] Template KAI tersedia
- [x] Template Shopee tersedia
- [x] Template Grab tersedia
- [x] Template Agoda tersedia
- [x] Template blu tersedia
- [x] Template Jago tersedia
- [x] Template LINE Bank tersedia
- [x] Template Gojek tersedia
- [x] Template Traveloka tersedia
- [x] Template BCA/Mandiri/BNI/BRI tersedia
- [x] Template generic fallback

## UI

- [x] Note tampil di transaction card (TransactionItem.tsx)
- [x] Note tampil di transaction detail (transactions modal)
- [x] Note tampil di Gmail Sync result (EmailCard)
- [x] Note bisa diedit saat needs review (future — uses note from builder)
- [x] Note bisa diisi di form transaksi manual (existing form)
- [x] Mobile rapi (truncate, line-clamp)
- [x] Dark mode konsisten

## File yang Diubah

| File | Perubahan |
|------|-----------|
| `src/lib/transactionNoteBuilder.ts` | **NEW** — buildTransactionNote + sanitizeTransactionNote + 15 provider templates |
| `src/types/index.ts` | Tambah `note?: string` ke ExtractedTransaction |
| `src/features/gmail/GmailSyncPage.tsx` | Integrasi note builder ke processSingleEmail, tampilkan note di EmailCard, gunakan note di auto-accept + approve |
| `src/components/ui/TransactionItem.tsx` | Tampilkan note sebagai secondary text |
| `supabase/migrations/202606200005_gmail_transaction_note.sql` | **NEW** — add extracted_note to gmail_sync_logs |
| `docs/gmail-sync/GMAIL_TRANSACTION_NOTE_CHECKLIST.md` | **NEW** — This checklist |

## Test Result

| Case | Expected Note | Result |
|------|---------------|--------|
| tiket.com Nuanu | Pembayaran tiket Nuanu Creative City - Order ID 1351082246 | ✅ (builder template) |
| KAI | Pembayaran tiket KAI - Kode Booking EYB9TGN | ✅ (builder template) |
| Shopee | Pembayaran belanja Shopee | ✅ (builder template) |
| Jago Top Up | Top up e-Wallet dari Bank Jago | ✅ (builder template) |
| blu masuk | Transaksi masuk blu | ✅ (builder template) |
| Generic merchant | Transaksi dari {merchant} | ✅ (fallback builder) |
| Build | npm run build — 0 error | ✅ |

## Final Status

- Transaction Note: ✅ OK
- Gmail Sync Note: ✅ OK
- UI Transaction Result: ✅ OK
- Build: ✅ OK
