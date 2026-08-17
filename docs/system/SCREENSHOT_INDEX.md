# CashFlow — Screenshot Index

> All screenshots captured **2026-08-03** from the running application (localhost:5180) using a temporary Playwright cookie-auth capture harness that has since been removed (it was never part of the test suite). Viewport: desktop `1440×900`, mobile `390×844`. Stored in `docs/assets/screenshots/`.

## Public pages

| File | Page | Mode | Viewport | Notes |
|---|---|---|---|---|
| `landing.png` | `/landing` | Light | Desktop | Marketing/landing hero |
| `login.png` | `/login` | Light | Desktop | Sign-in with Google |

## Protected pages (authenticated, light)

| File | Page | Mode | Viewport | Notes |
|---|---|---|---|---|
| `dashboard.png` | `/dashboard` | Light | Desktop | Balance, stats, quick actions, latest transactions |
| `transactions.png` | `/transactions` | Light | Desktop | Filtered, paginated list |
| `budgets.png` | `/budgets` | Light | Desktop | Budget cards |
| `recurring.png` | `/recurring` | Light | Desktop | Recurring templates (Rutin) |
| `reports.png` | `/reports` | Light | Desktop | Monthly reports |
| `professional.png` | `/professional` | Light | Desktop | Professional suite |
| `ai-search.png` | `/suite/ai-search` | Light | Desktop | AI agent search |
| `gmail-sync.png` | `/gmail-sync` | Light | Desktop | Connection card, auto-sync, summary cards, filters |
| `categories.png` | `/categories` | Light | Desktop | Category management |
| `notifications.png` | `/notifications` | Light | Desktop | Notification center |
| `profile.png` | `/profile` | Light | Desktop | Profile page |
| `settings.png` | `/settings` | Light | Desktop | App settings |
| `privacy.png` | `/privacy` | Light | Desktop | Privacy page |
| `admin-monitoring.png` | `/admin/monitoring` | Light | Desktop | Admin metrics dashboard |

## Feature modal

| File | Page | Mode | Viewport | Notes |
|---|---|---|---|---|
| `receipt-ocr.png` | `/transactions` (modal) | Light | Desktop | Receipt OCR upload modal |

## Dark mode

| File | Page | Mode | Viewport | Notes |
|---|---|---|---|---|
| `dashboard-dark.png` | `/dashboard` | Dark | Desktop | Dark theme dashboard |
| `gmail-sync-dark.png` | `/gmail-sync` | Dark | Desktop | Dark theme Gmail Sync |
| `ai-hub-light.png` | `/ai` | Light | Desktop | AI Hub: hero insight, health score, simulasi, timeline, memory |
| `ai-hub-dark.png` | `/ai` | Dark | Desktop | AI Hub, dark theme |
| `ai-chat-light.png` | `/ai/chat` | Light | Desktop | AI Chat: hero + suggested queries + komposer |
| `ai-chat-dark.png` | `/ai/chat` | Dark | Desktop | AI Chat, dark theme |
| `ai-chat-answer-light.png` | `/ai/chat` | Light | Desktop | Jawaban rich chat (ringkasan→grafik→kategori→aksi) |
| `ai-chat-answer-dark.png` | `/ai/chat` | Dark | Desktop | Jawaban rich chat, dark theme |

## Mobile

| File | Page | Mode | Viewport | Notes |
|---|---|---|---|---|
| `dashboard-mobile.png` | `/dashboard` | Light | Mobile (390×844) | Mobile layout |
| `transactions-mobile.png` | `/transactions` | Light | Mobile (390×844) | Mobile layout |
| `ai-timeline-mobile.png` | `/ai/timeline` | Light | Mobile (375×812) | Daftar event: grup tanggal + filter chips |
| `ai-timeline-mobile-dark.png` | `/ai/timeline` | Dark | Mobile (375×812) | Daftar event, dark theme |
| `ai-timeline-detail-mobile.png` | `/ai/timeline` | Light | Mobile (375×812) | Detail event insight: evidence + confidence + feedback |
| `ai-timeline-detail-mobile-dark.png` | `/ai/timeline` | Dark | Mobile (375×812) | Detail event insight, dark theme |
| `ai-hub-mobile.png` | `/ai` | Light | Mobile (375×812) | AI Hub mobile (tabel simulasi scroll internal — min-w-0 fix 2026-08-09) |
| `ai-hub-mobile-dark.png` | `/ai` | Dark | Mobile (375×812) | AI Hub mobile, dark theme |
| `ai-chat-mobile.png` | `/ai/chat` | Light | Mobile (375×812) | AI Chat mobile (state awal) |
| `ai-chat-mobile-dark.png` | `/ai/chat` | Dark | Mobile (375×812) | AI Chat mobile, dark theme |

---

**Totals:** 35 screenshots · 19 unique pages · light + dark + mobile coverage.

> Angka dihitung dari baris tabel di atas (2 public + 17 protected + 1 modal + 5 dark + 10 mobile).

**Usage:** referenced by `README.md` (curated selection) and available for docs, pitch decks, and portfolio materials.

**Regeneration:** Halaman AI (Hub `/ai` · Timeline `/ai/timeline` list+detail · Chat `/ai/chat`) → `npm run capture:ai` — flag `--viewport 375x812` untuk mobile, `--theme dark`, `--pages hub,timeline,chat`, `--chat-answer` (jawaban rich) · panel admin → `npm run capture:admin`. Keduanya memakai engine bersama `scripts/captureEngine.mjs` (konfigurasi halaman + selector panel) — script baru cukup memanggil `runCapture({ pages, ... })`.

**Mode CI (job dokumentasi GH Actions):** `npm run capture:ci` (atau `node scripts/<script> --ci`) — output ke **folder temporer** (`mkdtemp`, bukan `docs/assets/screenshots` yang tracked git; dihormati bila `--out` eksplisit) + menulis **`summary.json`** (`ok/generatedAt/viewport/themes/out/saved/failures`) + **exit code 0/1**. Kegagalan satu shot tidak menghentikan sisa run (semua halaman tetap dicapture, error dicatat per-shot); marker `waitText` yang tidak muncul dalam 20s = **failure** (`stage:'waitText'`) — halaman blank/error/redirect-to-login menggagalkan job, supaya gambar rusak tidak pernah ter-commit. Jadi job CI bisa: jalankan `capture:ci` → baca `summary.json`/exit code → diff folder temp vs tracked → commit hanya bila gambar berubah. Folder temp dibersihkan otomatis OS/GH Actions (VM ephemeral); pada mesin dev, `--ci` berulang menumpuk di `%TEMP%` (aman dihapus manual).

**Resilience (self-healing, diuji 2026-08-09):** fixture admin di-seed dengan id prefiks `e2e-*` dan `beforeAll` memakai **DELETE-first** sebelum seed — bila run terputus di tengah (SIGKILL sebelum cleanup), sisa baris `e2e-*` tersangkut dan seed ulang dengan id fixed yang sama akan gagal `UNIQUE constraint failed`. Verifikasi otomatis: `npm run verify:capture-selfheal` (script `scripts/verify-capture-selfheal.mjs`) — baseline 0 → simulasi kill (64 baris tersisa) → re-seed naive **PK violation tertangkap** → run ulang script asli exit 0 + 6 screenshot → pasca-run 0 baris. Status: **SELF-HEALING TERBUKTI**.
