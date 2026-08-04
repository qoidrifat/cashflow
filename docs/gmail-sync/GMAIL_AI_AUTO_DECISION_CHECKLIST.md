# Gmail AI Auto Decision Checklist

> ⚠️ **STATUS: ARSIP HISTORIS (SUPERSEDED)** — Dokumen ini ditulis pada era Supabase/Firebase (sebelum 2026-08-02) dan TIDAK mencerminkan arsitektur aktif. Arsitektur saat ini: Express 4 + Better Auth + Turso (libSQL) + SSE + Vertex AI. Lihat [ADR-001..007](../adr/INDEX.md) untuk keputusan arsitektur terkini; desain Gmail sync saat ini ada di [ADR-007](../adr/ADR-007-gmail-sync.md).

> **Status**: ✅ Implemented
> **Flow**: Auto-First, Review-by-Exception
> **Build**: ✅ `npm run build` — 0 error

---

## 1. Konsep

- [x] Semua hasil tidak lagi wajib review manual — auto_accepted langsung masuk transactions
- [x] Auto-first diterapkan — pre-skip rules + AI + validator menentukan status
- [x] Review-by-exception diterapkan — hanya needs_review yang perlu dicek user
- [x] AI hanya memberi kandidat — rule-based validator menentukan final decision
- [x] Threshold confidence: >= 0.88 auto_accept, 0.60-0.87 needs_review, < 0.60 skip/reject

## 2. Auto Accept

- [x] Trusted sender mendapat +0.20 confidence
- [x] Amount jelas dan >= 1000
- [x] Tidak promo (validator menolak jika promo)
- [x] Tidak duplicate (cekidempotency)
- [x] Confidence >= 0.88
- [x] Validator lulus semua rule
- [x] Insert transaction berhasil ke table transactions

## 3. Auto Skip / Reject

- [x] Promo cashback — `auto_rejected` dengan `PROMO_CASHBACK_SKIPPED`
- [x] Card activation — `auto_skipped` dengan `CARD_ACTIVATION_SKIPPED`
- [x] Welcome email — `auto_skipped` dengan `WELCOME_EMAIL_SKIPPED`
- [x] bluSpending created — `auto_skipped` dengan `BLU_SPENDING_SKIPPED`
- [x] Newsletter/promo — `auto_rejected` dengan `PROMO_MARKETING_REJECTED`
- [x] Email tanpa nominal — `auto_skipped` dengan `NO_AMOUNT_FOUND`
- [x] Confident rendah (< 0.60) — `auto_skipped` dengan `LOW_CONFIDENCE_SKIPPED`

## 4. Needs Review

- [x] Confidence 0.60-0.87 masuk review
- [x] Multiple amount masuk review
- [x] Konflik AI/fallback (beda nominal > 1000) masuk review
- [x] AI gagal, fallback sukses dengan confidence sedang masuk review
- [x] Sender baru dengan nominal masuk review (via confidence scoring)
- [x] Handle approve/reject untuk needs_review items (sama seperti pending_review)

## 5. Core Components

### File Baru

| File | Status | Deskripsi |
|------|--------|-----------|
| `src/lib/confidenceScorer.ts` | ✅ | Composite scoring: trustedSender +0.20, tx keyword +0.20, amount +0.20, date +0.10, merchant +0.10, AI JSON +0.10, fallback +0.10. Penalties: promo -0.40, cashback max -0.50, no amount -0.50, unknown sender -0.15, conflicting -0.20 |
| `src/lib/aiDecisionValidator.ts` | ✅ | Pre-skip rules + validateAndFinalize(). Memeriksa promo, card activation, welcome, newsletter. Mengecek duplicate, konflik AI/fallback, confidence threshold |

### File Dimodifikasi

| File | Status | Perubahan |
|------|--------|-----------|
| `src/types/index.ts` | ✅ | Tambah status: `auto_accepted`, `auto_skipped`, `auto_rejected`, `needs_review`. Tipe: `AutoDecision`, `RiskFlags`, `ConfidenceBreakdown` |
| `src/features/gmail/GmailSyncPage.tsx` | ✅ | `processSingleEmail` — flow baru: pre-skip → AI → fallback → validator → decision. Auto-insert auto_accepted ke transactions. EmailCard approve/reject untuk needs_review. Stats: autoAcceptedCount, autoRejected. Summary cards untuk auto-flow |
| `server/index.js` | ✅ | AI prompt tambah field `decision` |
| `src/services/notificationTriggers.ts` | ✅ | Tambah autoAcceptedCount, autoSkippedCount, autoRejectedCount. Summary notification untuk auto-flow |

### File Sebelumnya (Background Sync)

| File | Status | Deskripsi |
|------|--------|-----------|
| `supabase/migrations/202606200004_gmail_sync_runs_and_enhancements.sql` | ✅ | gmail_sync_runs table + enhanced logs + settings |
| `supabase/functions/gmail-auto-sync/index.ts` | ✅ | Edge Function background sync |
| `src/services/gmailSyncRunService.ts` | ✅ | CRUD sync runs |
| `src/features/gmail/AutoSyncStatus.tsx` | ✅ | Auto sync UI component |

## 6. Auto-insert Flow

- [x] Email auto_accepted → langsung `addTransaction()`
- [x] DuplicateTransactionError ditangani (tidak gagal batch)
- [x] Error auto-insert dicatat di logger
- [x] Auto-insert terjadi setelah persistGmailSyncResults

## 7. Notification Summary

- [x] Summary notification untuk auto_accepted items
- [x] Tidak spam per email
- [x] Dedupe key: `gmail-review-{date}`
- [x] Detail: autoAcceptedCount, autoSkippedCount, autoRejectedCount

## 8. Safety

- [x] Validator selalu cek rule sebelum auto_accept
- [x] Promo cashback tidak bisa auto_accept
- [x] Card activation tidak bisa auto_accept
- [x] No amount tidak bisa auto_accept
- [x] Conflicting AI/fallback tidak bisa auto_accept
- [x] Confidence < 0.88 tidak bisa auto_accept
- [x] Duplicate tidak bisa auto_accept
- [x] Audit log tersimpan di gmail_sync_logs
- [x] Transaction bisa diedit/delete setelah auto-accepted
- [x] Duplicate prevention via processedIdsRef + gmail_message_id

## 9. Test Case

| Case | Expected | Result |
|------|----------|--------|
| `Cashback hingga Rp800.000, Ajukan KTA LINE Bank` | `auto_rejected` | ✅ PROMO_CASHBACK_SKIPPED |
| `Garuda x bluDebit Card Kamu Telah Aktif` | `auto_skipped` | ✅ CARD_ACTIVATION_SKIPPED |
| `Request bluVirtual & Garuda x bluDebit Card Berhasil` | `auto_skipped` | ✅ CARD_ACTIVATION_SKIPPED |
| `Welcome to blu! Let's Make Your Move!` | `auto_skipped` | ✅ WELCOME_EMAIL_SKIPPED |
| `bluSpending "Makan & Minum" Berhasil Dibuat` | `auto_skipped` | ✅ BLU_SPENDING_SKIPPED |
| `Dapatkan cashback s/d Rp1.000.000` | `auto_rejected` | ✅ PROMO_CASHBACK_SKIPPED |
| `Transaksimu Pakai blu Berhasil` (dengan nominal) | `auto_accepted` | ✅ (if confidence >= 0.88) |
| `Kamu telah melakukan transfer` (dengan nominal) | `auto_accepted` | ✅ (if confidence >= 0.88) |
| `Pembayaranmu Berhasil Dikonfirmasi` (dengan nominal) | `auto_accepted` | ✅ (if confidence >= 0.88) |
| `Bukti Pembayaran Transaksi PT. KAI` (dengan nominal) | `auto_accepted` | ✅ (if confidence >= 0.88) |
| `[tiket.com] Bukti Pembayaran` (dengan nominal) | `auto_accepted` | ✅ (if confidence >= 0.88) |
| Email dengan 2+ nominal tidak jelas | `needs_review` | ✅ (via multipleAmounts risk flag) |
| AI dan fallback berbeda nominal | `needs_review` | ✅ (via conflictingAIandFallback) |

## 10. Build

- [x] `npm run build` — 0 error
- [x] TypeScript strict check passed
- [x] Vite build production selesai

---

## Scoring Formula

```
Base Score = trustedSender + transactionKeyword + amountPresent + datePresent
             + merchantPaymentMethod + aiValidJson + fallbackKnownPattern

Total = max(0, min(1, Base Score + Penalties))

Thresholds:
  >= 0.88 → auto_accept (jika validator lulus)
  0.60-0.87 → needs_review
  < 0.60  → auto_skip / auto_rejected (tergantung konteks)
```

## Pipeline Flow

```
Email → Pre-skip Rules (promo, card activation, welcome, newsletter)
         ↓ (lolos pre-skip)
       → Prefilter (classifier)
         ↓ (send_to_ai)
       → AI Extraction (Gemini)
         ↓ (gagal / sukses)
       → Fallback Parser (regex) ← hanya jika AI gagal atau prefilter skip
         ↓
       → Validator (validateAndFinalize)
         ↓
       → auto_accepted | needs_review | auto_skipped | auto_rejected
         ↓
       → auto_accepted → addTransaction() → transaction + sync_log
       → needs_review → email list (user approve/reject)
       → auto_skipped → sync_log (not a transaction)
       → auto_rejected → sync_log (not a transaction)
```
