# Closed Beta Readiness Gate (P9 §25)

> **Target**: 10–30 users · 2–4 minggu · Tujuan: mengumpulkan **evidence nyata** pengguna
> untuk menentukan roadmap berikutnya (semantic cache L3 / embedding / RAG / multi-model /
> cost optimization ATAU perbaikan product experience yang lebih mendesak).

## Gate Checklist (P9 §25)

| # | Item | Status | Bukti |
|---|---|---|---|
| 1 | Auth stable | ✅ | Better Auth + Google OAuth hijau (regression, E2E) |
| 2 | Database stable | ✅ | Turso runtime HEALTHY; schema ter-apply; seed deterministik |
| 3 | AI stable | ✅ | Gemini production-ready; fallback rule-based; benchmark AI lulus |
| 4 | Feedback stable | ✅ | `ai_feedback` + admin panel prioritas prompt + benchmark feedback-driven |
| 5 | **Timeline stable** | ✅ | **P9**: event model, state machine, pagination, detail, producer otomatis (unit + E2E) |
| 6 | Error state stable | ✅ | Validasi 400 VALIDATION_ERROR; AI fallback; UI retry |
| 7 | Empty state stable | ✅ | Empty states di semua halaman AI (hub/chat/timeline) |
| 8 | Analytics instrumentation stable | ✅ | `system_metrics` (timeline_view/open/status_update, agent-search engagement, cache hit) |
| 9 | Privacy reviewed | ✅ | Tanpa PII di metrics; sanitasi metadata; tidak menyimpan raw response/Gmail body |
| 10 | Security reviewed | ✅ | User-scoped; enum fail-closed; rate limit; helmet; secret scan bersih |
| 11 | Cost monitoring active | ✅ | `ai_usage_metrics` + dashboard admin (biaya/token/latency/cache per fitur) + alert |
| 12 | Rollback procedure documented | ✅ | Baseline `react-performance-stable` di-tag; perubahan additive & backward-compatible |
| 13 | Accessibility (P2.1) | ✅ | Axe 5 halaman × light+dark: **0 serious/critical** (color-contrast 0) — gate `npm run test:a11y` |
| 14 | E2E deterministic & isolasi (P2.2) | ✅ | E2E isolated + parallel per-worker DB (file lokal, tanpa Turso); 2× run beruntun hijau |
| 15 | Component test coverage (P2.3) | ✅ | AiHub/Monitoring/Budgets halaman penuh (22 test) + 1160 unit total |
| 16 | Dependency audit gate (P2.4) | ✅ | Tiered gate di CI; 0 blocking; exception registri review-date |

## Aturan Data (P9 §26)

- Data sintetis (21 `ai_feedback` dev seed, fixture E2E) HANYA untuk development validation —
  BUKAN product-market evidence.
- Sprint 2 (atau roadmap berikutnya) ditentukan dari **real user evidence**, bukan angka sintetis.

## Metrik yang Dikumpulkan (P9 §24, §27)

Dari cohort nyata, kumpulkan & dokumentasikan (jangan klaim signifikansi statistik bila sample
kecil — tuliskan sample size, confidence limitations, data collection period, feature exposure,
missing data):

- AI recommendation CTR · feedback positive/negative rate · acceptance rate · completion rate
- Timeline engagement: `timeline_open_rate` · `event_open_rate` · `event_completion_rate` · `event_dismiss_rate`
- Retention: D1 · D7 · D14 · D28 · user satisfaction

## Blocker yang Harus Ditutup SEBELUM Closed Beta

- [ ] Deployment produksi (hosting frontend/backend, env production, secret) — Sprint 3
- [ ] Daftar 10–30 user beta & mekanisme onboarding
- [ ] SLA/rollback plan operasional
- [ ] Monitoring alert aktif di produksi (bukan hanya dev)

## Kesimpulan

P9 menuntaskan **gate teknis** terakhir. Sisa pekerjaan adalah **operasional beta** (deployment
+ rekrut user). JANGAN mulai Sprint 2 sebelum ada evidence nyata dari cohort.
