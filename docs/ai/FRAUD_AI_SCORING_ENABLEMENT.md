# Fraud AI Scoring — Production Enablement Checklist

> **Tujuan:** mengaktifkan L2 AI scoring (`FRAUD_AI_SCORING_ENABLED=true`) di
> produksi secara aman, dengan ekspektasi biaya & kualitas yang realistis.
> **Status:** Ready for enablement · **Owner:** Backend / Security
> **Related:** [FRAUD_DETECTION_DESIGN.md](FRAUD_DETECTION_DESIGN.md), [FRAUD_DETECTION_EVALUATION.md](FRAUD_DETECTION_EVALUATION.md), [ADR-011-fraud-detection](../adr/ADR-011-fraud-detection.md), [COST_MONITORING.md](COST_MONITORING.md)

---

## 1. Ringkasan

L1 rule engine (deterministik, gratis) sudah berjalan di produksi. L2 AI scoring
(Gemini) **shipped sejak Sprint 1 tapi default OFF** (`false` di
`server/.env.example`) untuk menghindari biaya Vertex tanpa ekspektasi tertulis.

Saat diaktifkan, L2 berjalan **hanya untuk transaksi yang ter-flag L1** dan
**async (non-blocking)** — write transaksi tidak pernah tertunda atau dijatuhkan.
Kegagalan L2 (quota/timeout/JSON invalid) **degrade aman ke verdict L1**.

```
Transaksi baru ──▶ L1 Rule Engine (gratis) ──▶ flags ──▶ persist + notifikasi + metric
                                    │
                                    └─[ENABLE]─▶ L2 Gemini (async) ──▶ persist skor AI + eskalasi advisory
```

---

## 2. Prasyarat (pre-flight) — harus terpenuhi sebelum aktivasi

| # | Cek | Cara verifikasi |
|---|---|---|
| 1 | **Vertex AI aktif** di project GCP | `GET /api/health` → `gemini: ready` (atau log boot "Vertex AI Gemini siap") |
| 2 | **Service account** `GOOGLE_APPLICATION_CREDENTIALS` valid & punya izin `aiplatform.endpoints.predict` | File JSON ada di path yang dikonfigurasi; boot server tanpa warning credentials |
| 3 | **Model** `GEMINI_PRIMARY_MODEL` / `GEMINI_FALLBACK_MODEL` tersedia & aktif di region | Panggil manual 1x via `npm run benchmark:ai:live` (subset fraud lulus) atau cek Cost Monitoring |
| 4 | **Cost Monitoring dashboard** dapat diakses admin | `/admin/monitoring` render + panel "Cost per Fitur" menampilkan `fraud_detection` |
| 5 | **Alert** `fraud_flags` aktif (`fraud_flag_count > 10`/60m) | Panel "Alerts" di `/admin/monitoring` menampilkan rule OK |
| 6 | **Uji staging** 1 hari penuh dengan `true` | Bagian 4 di bawah |

> L2 TIDAK butuh migration DB — kolom (`fraud_flags.risk_score`, `decision`,
> `rule_data`, `transactions.fraud_score`) sudah ada sejak Sprint 1.

---

## 3. Aktivasi (staging → produksi)

```bash
# 1) server/.env (di kedua environment)
FRAUD_DETECTION_ENABLED=true          # L1 (sudah aktif — jangan diubah)
FRAUD_AI_SCORING_ENABLED=true         # L2 (aktifkan)

# 2) Restart server — env dibaca SAAT BOOT (module scope), bukan per-request.
#    Tanpa restart, perubahan tidak berlaku.
```

Urutan yang disarankan:

1. **Staging**: set `true` → deploy → verifikasi (bagian 4) → biarkan **≥24 jam**.
2. **Observasi** Cost Monitoring: hitung volume flag vs biaya aktual (bagian 5).
3. **Produksi**: set `true` → deploy → verifikasi cepat (bagian 4) → pantau 7 hari.
4. **Evaluasi** data: bandingkan distribusi `decision` (allow/review/block) &
   `confidence` L2 terhadap ekspektasi (bagian 6).

---

## 4. Verifikasi pasca-aktivasi (smoke test)

| # | Aksi | Hasil yang diharapkan |
|---|---|---|
| 1 | Buat transaksi ter-flag (mis. transaksi ke merchant yang sama 6×/24 jam, atau nominal > 3× p99) | Notifikasi fraud L1 muncul (bell + SSE) |
| 2 | Tunggu ~10-30 detik (L2 async) | `fraud_flags.risk_score` & `decision` ter-update dengan nilai AI; `rule_data.aiReasons` (≥1 alasan) + `aiConfidence` terisi |
| 3 | Cek `transactions.fraud_score` | Ter-update dengan skor AI (0..1) |
| 4 | FraudPage → transaksi ter-flag | Badge **"Keyakinan N%"** (dari `aiConfidence`) + box **"Alasan AI"** tampil |
| 5 | Cost Monitoring → "Cost per Fitur" | Baris `fraud_detection` muncul: calls, tokens, latency avg, sukses % |
| 6 | Log server | TIDAK ada `Fraud AI scoring gagal` / `JSON tidak valid` berulang (>1% dari calls) |
| 7 | Uji degrade (opsional): matikan akses Vertex sementara | Transaksi tetap tercatat; verdict tetap L1; log warning non-blocking |

---

## 5. Ekspektasi Biaya

### 5.1 Rumus

```
biaya/bulan ≈ flagged_transactions × tokens_per_call × harga_per_token
flagged_transactions ≈ transaksi_bulanan × flag_rate (L1)
```

### 5.2 Angka riil (diukur, bukan perkiraan)

| Metrik | Nilai | Sumber |
|---|---|---|
| Tokens per call (input+output) | **~400** (2017 token / 5 kasus) | live benchmark fraud_l2_live |
| Latency rata-rata per call | **~7.9 s** | live benchmark (async — tidak menunda write) |
| Est. cost per call | **~$0.00005** | AI_PRICING gemini_flash (input $0.075/1M, output $0.30/1M) |
| Retry | 3 attempt, backoff 0.5s×2^n | `AI_RETRY_MAX_ATTEMPTS`/`AI_RETRY_BASE_MS` (retryable: quota/timeout/network) |

### 5.3 Contoh skenario

| Skenario | Flag L1/bulan (asumsi) | Calls L2 | Tokens | Est. biaya/bulan |
|---|---|---|---|---|
| Rilis awal (1k transaksi/bulan, ~10% flag) | 100 | 100 | ~40k | **<$0.01** |
| 10k transaksi/bulan, ~10% flag | 1.000 | 1.000 | ~400k | **~$0.05** |
| 100k transaksi/bulan, ~15% flag | 15.000 | 15.000 | ~6M | **~$0.75** |

> Volume kuota gratis Gemini API jauh di atas kebutuhan ini; risiko dominan
> bukan biaya, melainkan **rate limit saat lonjakan flag** (lihat 6.3).

### 5.4 Kontrol biaya (built-in)

- L2 dipanggil **hanya untuk kandidat ter-flag** (bukan semua transaksi).
- `cacheTtlMs: 0` — skor per transaksi unik, sengaja tidak di-cache (keputusan desain).
- Prompt **bounded** (cap 6.000 char, tanpa PII mentah).
- Semua biaya tercatat di `ai_usage_metrics` (feature `fraud_detection`) →
  dashboard Cost Monitoring — **tidak ada biaya tak terlihat**.

---

## 6. Ekspektasi Kualitas & Perilaku

| Aspek | Ekspektasi |
|---|---|
| **Output L2** | `fraud_score` 0..1, `decision` allow/review/block, `reasons` ≤4 (Bahasa Indonesia), `confidence` 0..1 |
| **Eskalasi** | `block` → notifikasi "Aktivitas berisiko tinggi" — **ADVISORY**: transaksi TETAP tercatat, tidak dihapus/diblokir |
| **Non-determinisme LLM** | Skor dapat bervariasi antar run pada kasus yang sama (± kecil). Jangan gunakan L2 untuk keputusan otomatis yang menghapus data |
| **Degrade** | Quota/timeout/JSON invalid → verdict L1 (`logger.warn`, non-blocking) |
| **Latency** | Async — write transaksi TIDAK terpengaruh; notifikasi eskalasi menyusul |
| **Cache** | Off (keputusan desain — skor per transaksi unik) |
| **Data PII** | Prompt berisi ringkasan (merchant, nominal, konteks agregat) — **tanpa PII mentah** (nama user, email, alamat) |

### 6.1 Ekspektasi distribusi decision (jika sehat)

- **Mayoritas `review`** pada flag severity medium (velocity, new_merchant) — AI
  menegaskan aturan, bukan menaikkan.
- **`block` jarang** — hanya indikasi kuat (gmail duplicate + nominal besar,
  velocity ekstrem). `block` > 20% dari calls = indikasi prompt/aturan perlu
  direview.
- **`allow` wajar** untuk FP L1 (mis. pembelian rutin nominal sama) — ini nilai
  utama L2: **menurunkan false-positive notification** di masa depan.

### 6.2 Observability wajib selama 7 hari pertama

- Dashboard: `fraud_detection` success rate ≥ 95% (sisanya rate_limited/timeout wajar).
- Log: cek proporsi `JSON tidak valid` (harus < 5%).
- Alert `fraud_flag_count`: lonjakan flag memicu review — bukan alarm L2.

### 6.3 Risiko utama & mitigasi

| Risiko | Dampak | Mitigasi |
|---|---|---|
| Rate limit saat lonjakan flag | Call L2 gagal → degrade L1 (aman) | Retry bawaan; pantau status `rate_limited` di `ai_usage_metrics` |
| Non-determinisme skor | Notifikasi eskalasi bervariasi | `block` tetap advisory; ekspektasi distribusi (6.1) |
| Latensi AI saat beban tinggi | Calls memakan slot async | Async queue natural (fire-and-forget); tidak memblokir |

---

## 7. Rollback

```bash
# server/.env
FRAUD_AI_SCORING_ENABLED=false
# restart server
```

- L2 berhenti seketika; L1 + notifikasi + alert **tetap berjalan** (tidak
  terpengaruh). Data historis (skor AI yang sudah tersimpan) tetap dipertahankan.
- Rollback adalah perubahan satu baris + restart — tidak ada migrasi data.

---

## 8. Checklist Final (centang sebelum deploy produksi)

- [ ] Prasyarat 1-6 (bagian 2) terpenuhi
- [ ] Staging berjalan `true` ≥ 24 jam tanpa error berulang
- [ ] Smoke test bagian 4 lulus di staging
- [ ] Estimasi biaya (bagian 5.3) disetujui & dipahami
- [ ] Dashboard Cost Monitoring + alert `fraud_flags` dapat diakses
- [ ] Rollback plan (bagian 7) tersedia & diuji
- [ ] Ekspektasi kualitas (bagian 6) dikomunikasikan ke tim/owner
