# Gemini Quota & Fallback Strategy

## Realitas: Tidak Ada Gemini Gratis Tanpa Limit

- Free tier Gemini API: **15-20 request/menit**, hard quota per hari
- Prepaid credits bisa habis
- Error yang muncul: `429 Too Many Requests`, `Quota exceeded`, `prepayment credits are depleted`

## Arsitektur: Rules-First, AI-Only-For-Ambiguous

```
Email masuk
  │
  ├─→ [Duplicate check] → skip
  ├─→ [Promo/non-transaksi prefilter] → auto_rejected/auto_skipped
  ├─→ [Provider-specific parser (blu, Jago, Shopee, KAI, dll)] → auto_accepted
  ├─→ [Fallback regex parser] → auto_accepted jika confidence >= 0.88
  │
  └─→ [Ambigu] → Kirim ke AI (jika tersedia)
        ├─→ AI berhasil → auto_accepted / needs_review
        ├─→ AI gagal (non-quota) → fallback parser → needs_review
        └─→ AI quota/credits habis → fallback parser → retry_later
```

## Target AI Call Reduction

| Skenario | Tanpa Optimasi | Dengan Rules-First |
|----------|----------------|-------------------|
| 300 email | ~200-250 AI calls | ~30-80 AI calls |
| Saving | - | ~70% pengurangan |

## Error Classification

| Error | Code | Behavior |
|-------|------|----------|
| 429 rate limit | `GEMINI_RATE_LIMITED` | Stop AI, fallback parser, retry_later |
| Quota exceeded | `GEMINI_QUOTA_EXCEEDED` | Stop AI, fallback parser, retry_later |
| Credits depleted | `GEMINI_CREDITS_DEPLETED` | Stop AI, fallback parser, retry_later |
| API disabled | `GEMINI_API_DISABLED` | Config error, stop batch |
| Auth error | `GEMINI_AUTH_ERROR` | Config error, stop batch |

## Concurrency Settings (Optimized for Free Tier)

```
AI_CONCURRENCY = 1          (sequential, avoid burst)
AI_REQUEST_DELAY_MS = 1500  (1.5s between requests)
```

Ini membatasi ke ~40 request/menit — masih mungkin hit limit, tapi graceful degradation berlaku.

## Saat Gemini Limit/Habis

1. AI calls dihentikan untuk session ini
2. Fallback parser tetap berjalan
3. Email yang fallback bisa parse → `needs_review` atau `auto_accepted`
4. Email yang terlalu ambigu → `retry_later`
5. UI menampilkan pesan jelas (bukan "Konfigurasi AI Bermasalah")
6. User bisa retry nanti setelah limit reset

## Scan Bukti (Receipt Scan)

Saat Gemini limit/habis:
- Preview gambar tetap tampil
- Tombol "Isi Manual" tersedia
- Tombol "Coba Lagi" tersedia
- Pesan: "AI sedang tidak tersedia karena limit Gemini. Kamu tetap bisa mengisi transaksi manual."

## Cara Upgrade / Menambah Quota

1. Buka https://ai.studio/projects
2. Pilih project
3. Manage billing → tambah credit
4. Atau: Buat API key di project baru untuk fresh free quota
