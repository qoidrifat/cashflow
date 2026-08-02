# Gmail Attachment Document Extraction Checklist

> **Status**: ✅ Implementasi
> **Build**: ✅ `npm run build` — 0 error

---

## 1. Scope

- [x] AI/fallback bisa membaca dokumen inline email (HTML body, text parts)
- [x] Metadata attachment dibaca (filename, mimeType, size, attachmentId)
- [x] Nominal bisa dicari dari full content email (body + inline documents)
- [x] Full document tidak disimpan ke Supabase production
- [x] Hanya diproses dalam memory sementara

## 2. Gmail Parsing

- [x] MIME parser rekursif — `extractFullContent()` di `gmailService.ts`
- [x] `text/plain` diekstrak
- [x] `text/html` diekstrak dan di-strip
- [x] Attachment metadata dikumpulkan — `extractAttachments()`
- [x] Inline document parts (HTML bodies with invoice content) terdeteksi via `hasInlineDocumentParts()`
- [x] HTML entity decoding (nbsp, amp, lt, gt, quot, #39)

## 3. Document Extraction

- [x] HTML text extraction via `extractTextFromHtml()` di `gmailDocumentExtractor.ts`
- [x] Amount extraction dari dokumen dengan prioritas label: `Total Pembayaran`, `Total`, `Grand Total`, `Jumlah`, `Paid Amount`
- [x] Order ID extraction dari text
- [x] `processDocumentContent()` — menggabungkan body + fullContent + attachments
- [x] `getCombinedTextForAI()` — text aman untuk AI (maks 15000 chars)
- [x] Sender allowlist — `isTrustedForDocumentExtraction()`

## 4. tiket.com

- [x] `Bukti Pembayaran` — cek dokumen penuh untuk nominal
- [x] `E-tiket` — skipped jika tidak ada nominal (bukan failed)
- [x] Order ID diekstrak dari subject — `extractOrderIdFromSubject()`
- [x] `isPaymentReceipt()` — deteksi bukti pembayaran vs e-tiket
- [x] `isRelatedDocument()` — deteksi dokumen terkait (e-ticket tanpa nominal)
- [x] Dedupe key function — `getOrderDedupeKey()`
- [x] `detectTravelProvider()` — identifikasi provider travel

## 5. AI Context

- [x] Document text tersedia di memory untuk AI melalui `fullContent` field
- [x] Prompt AI bisa membaca konteks dokumen yang sudah dibersihkan
- [x] Output JSON strict tetap dari server
- [x] Validator tetap menentukan keputusan final

## 6. Security

- [x] Token tidak dilog
- [x] Full attachment tidak disimpan ke Supabase
- [x] Full body tidak disimpan ke Supabase
- [x] Sender allowlist diterapkan — hanya trusted domains
- [x] File size limit constants didefinisikan (5MB PDF, 1MB HTML/TXT)

## 7. Files Created/Modified

| File | Status | Perubahan |
| ---- | ------ | --------- |
| `src/services/gmailService.ts` | **MODIFIED** | Enhanced MIME parsing: `extractFullContent()`, `extractAttachments()`, `hasInlineDocumentParts()`, `stripHtml()`. GmailEmail: +fullContent, +attachments, +hasDocumentParts. GmailAttachmentMeta interface. GmailPayload: +filename, +attachmentId |
| `src/lib/gmailDocumentExtractor.ts` | **NEW** | `extractTextFromHtml()`, `extractAmountFromDocumentText()`, `extractOrderId()`, `processDocumentContent()`, `getCombinedTextForAI()`, `isTrustedForDocumentExtraction()` |
| `src/lib/tiketDedupe.ts` | **NEW** | `extractOrderIdFromSubject()`, `isPaymentReceipt()`, `isRelatedDocument()`, `getOrderDedupeKey()`, `isTravelProvider()`, `detectTravelProvider()` |
| `src/lib/geminiFallbackParser.ts` | **MODIFIED** | Enhanced `parseTiketEmail()` with comprehensive amount patterns + e-ticket handling |
| `src/features/gmail/GmailSyncPage.tsx` | **MODIFIED** | `processSingleEmail` + `fullContent`/`attachments` params. Document extraction step after AI+fallback fail. Travel provider related docs → auto_skipped. Helper functions: `inferMerchantFromSender`, `inferCategoryFromSender`, `inferPaymentMethodFromSender` |

## 8. Test Results

| Test | Expected | Result |
| ---- | -------- | ------ |
| tiket.com Bukti Pembayaran (nominal di HTML body) | amount found → auto_accepted/needs_review | ✅ Document extraction + validator |
| tiket.com E-ticket tanpa nominal | needs_review/skipped | ✅ `auto_skipped` dengan `RELATED_DOCUMENT_SKIPPED` |
| Travel provider without amount | needs_review/skipped | ✅ `auto_skipped` dengan alasan dokumen terkait |
| Build | success | ✅ 0 error |

## 9. Build Status

- [x] `npm run build` — 0 error
- [x] TypeScript strict check passed
- [x] Vite build production selesai

---

## Pipeline Flow (Enhanced)

```
Email → Pre-skip Rules → Prefilter → AI Extraction → Fallback Parser → Document Extraction → Validator
         ↓                  ↓            ↓                ↓                    ↓                ↓
    auto_skip/       send_to_ai/    auto_accepted     auto_accepted        amount found    final decision
    auto_reject      auto_reject    /needs_review     /needs_review       → needs_review
                                              /skipped    ↓
                                            no amount + trusted sender
                                            → extractFullContent + extractAmountFromDocumentText
                                            → if amount found: needs_review with ATTACHMENT_AMOUNT_FOUND
                                            → if travel e-ticket: auto_skipped with RELATED_DOCUMENT_SKIPPED
```

## Travel Provider Dedupe Strategy

```
Email A: [tiket.com] Bukti Pembayaran (Order ID: 1351082246)
  → Process: full MIME parse → find amount → needs_review / auto_accepted

Email B: Tiket.com - Order ID 1351082246, Ini E-tiket...
  → Process: detect same order ID → isRelatedDocument → auto_skipped
  → Reason: "Dokumen terkait — nominal ada di email bukti pembayaran terpisah"
  → No duplicate transaction created!
```
