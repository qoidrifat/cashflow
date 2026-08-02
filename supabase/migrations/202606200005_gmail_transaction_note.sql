-- Gmail Transaction Note
-- Menambahkan kolom extracted_note ke gmail_sync_logs untuk menyimpan
-- catatan transaksi yang dihasilkan dari AI extraction / fallback parser / note builder.
--
-- Catatan transaksi berisi deskripsi singkat tentang transaksi untuk apa,
-- misalnya: "Pembayaran tiket Nuanu Creative City - Order ID 1351082246"

alter table if exists public.gmail_sync_logs
    add column if not exists extracted_note text;

comment on column public.gmail_sync_logs.extracted_note
is 'Ringkasan catatan/keterangan transaksi hasil ekstraksi Gmail Sync. Tidak menyimpan full email body.';

update public.gmail_sync_logs
set extracted_note = left(
    coalesce(
        metadata->>'extractedNote',
        metadata->>'candidateNote',
        metadata->>'note'
    ),
    500
)
where extracted_note is null
  and metadata is not null
  and (
    metadata ? 'extractedNote'
    or metadata ? 'candidateNote'
    or metadata ? 'note'
  );

create index if not exists idx_gmail_logs_extracted_note
    on public.gmail_sync_logs (user_id)
    where extracted_note is not null;

notify pgrst, 'reload schema';
