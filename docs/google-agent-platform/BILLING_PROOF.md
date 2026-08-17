# BILLING_PROOF.md — Billing Proof CashFlow AI Knowledge (P0.14)

> **Status: PENDING VERIFICATION** — billing eligibility BLOCKED dari
> environment agent (tidak ada akses Billing Console). Repo-side preparation
> selesai; **belum ada request berbayar yang dijalankan**.
> **Owner:** Core Engineering · **Last Updated:** 2026-08-14

## 1. Aturan main

- **TIDAK ADA request berbayar yang boleh dijalankan** sebelum
  `ELIGIBILITY_CONFIRMED = true` (lihat `ELIGIBILITY.md`).
- Tidak ada fake billing proof: API 200 / resource created / credit "Available"
  **bukan** bukti. Bukti = **usage + eligible SKU + credit application**.
- Tidak ada artificial credit burn: target proof = 1–5 query minimal, bukan loop.

## 2. Baseline (STEP A)

| Metric | Nilai | Sumber | Verifikasi |
|---|---|---|---|
| Credit remaining (before) | Rp 17.801.001 | User (Billing Console, user-reported 2026-08-14) | ⚠️ BELUM diverifikasi dari environment agent |
| Credit validity | 2026-06-19 → 2027-06-19 | User | User-reported |
| Billing account / project | `PRESENT` | `server/.env` (key names) | Key names only |

## 3. Workload plan (hanya setelah eligibility proven)

Minimal & terukur (P0.14 §28):

| # | Workload | SKU estimasi | Jumlah | Estimasi biaya |
|---|---|---|---|---|
| 1 | `POST /api/ai/cashflow-knowledge` — query knowledge base | Agent Search standard search (`agent_search_standard_search`) | 1–5 query | ~USD $0.0015–0.03 (jika $1.50/1k; cek pricing aktual) |
| 2 | (Opsional) sync docs ke data store — **hanya bila import diperlukan** | Discovery Engine import + Cloud Storage | 1× (≤20 file) | Pisahkan: Cloud Storage ≠ credit App Builder |

Catatan penting: **jangan jalankan** Agent Engine / Cloud Storage bulk /
Gemini loop / load test untuk proof.

## 4. Log permintaan yang direncanakan (template §28)

| timestamp | project | service | sku | requestCount | responseStatus | billingObservation |
|---|---|---|---|---|---|---|
| (isi saat menjalankan) | (dari usage receipt) | agent_search | agent_search_standard_search | 1 | (200/503) | (isi dari console) |

`usage` receipt otomatis ada di respons `POST /api/ai/cashflow-knowledge`
(`{ service, skuLabel, projectId, location, requestCount, timestamp, responseStatus }`)
dan di metrics observability (`feature: cashflow_knowledge`,
`provider: google_agent_platform`). Tanpa credential tersimpan.

## 5. Billing proof matrix (STEP G — template)

| Metric | Before | Usage | After | Evidence |
|---|---|---|---|---|
| Credit remaining | Rp 17.801.001 | — | ? | Billing Console → Credits |
| Service cost | 0 | ? | ? | Cost table / Billing export |
| Credit applied | 0 | ? | ? | Promotions / credits offset |
| Net cost | 0 | ? | ? | Billing |
| SKU | — | ? | ? | Billing |

## 6. Prosedur verifikasi (user, di Billing Console)

1. Jalankan 1–5 query knowledge (setelah flag aktif & `ELIGIBILITY.md` §7 selesai).
2. Tunggu billing telemetry (bisa 24–48 jam untuk kredit net pricing).
3. Periksa: **Billing → Reports / Cost table** (project, service, SKU, tanggal)
   dan **Promotions / credits** → apakah muncul offset credit.
4. Bandingkan Before/After matrix §5.
5. Update status di bawah.

## 7. Status classification (P0.14 §43)

| Kondisi | Status |
|---|---|
| eligible SKU + actual usage + credit applied | `VERIFIED` |
| service eligibility confirmed + usage confirmed, credit belum terlihat (propagation) | `PARTIALLY VERIFIED` |
| eligibility unknown / credit applicability unknown | `BLOCKED` |
| billing menunjukkan tidak eligible | `NOT ELIGIBLE` |

**Status saat ini: BLOCKED — BILLING ELIGIBILITY UNPROVEN**
(karena tidak ada akses Billing Console dari environment ini; *belum ada
usage berbayar*).

## 8. Yang sudah dibuktikan (tanpa biaya)

| Item | Status | Evidence |
|---|---|---|
| Integrasi keluarga produk (Agent Search/Discovery Engine) sudah ada & flag-enabled | ✅ | `server/services/agentSearchService.js`, `AGENT_SEARCH_ENABLED=true` |
| Credential service account ada & gitignored | ✅ | `server/*service-account*.json` (git check-ignore) |
| Adapter P0.14 + route + flag OFF default | ✅ | `server/lib/googleAgentPlatform/`, `knowledgeRoutes.js` |
| Kontrak flag-OFF (503, tanpa panggilan Google) | ✅ | unit test 13 kasus + E2E spec |
| Eligible SKU / credit application | ❌ BLOCKED | butuh Billing Console |

## 9. Hal yang TIDAK boleh dilakukan

- `npm run db:migrate` / `applyTursoSchema` untuk P0.14 (tanpa root cause & izin).
- Gmail import/resync, bulk parsing.
- Load test / loop query ke Google.
- Mengubah billing account / detach / payment method / menghapus credit.
