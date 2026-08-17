# Dependency Security Audit — Kebijakan Tier & Registri Exception (P2.4)

> Dibuat: 2026-08-09 (P2.4). Single source of truth untuk gate dependensi CashFlow.

## 1. Tujuan

Setiap perubahan dependensi harus mempertahankan profil keamanan yang
terpantau. Gate ini menjalankan `npm audit` di CI dan LOKAL, menerapkan kebijakan
tier, dan **TIDAK PERNAH** menjalankan `npm audit fix` (apalagi `--force`)
secara otomatis — upgrade hanya dilakukan sebagai task eksplisit dengan evidence.

```bash
npm run audit:deps          # laporan + exit code
npm run audit:deps -- --json  # JSON satu baris (CI-friendly)
```

## 2. Kebijakan Tier

| Severity | Klasifikasi | Aksi CI | Exit code |
|----------|-------------|---------|-----------|
| LOW      | Informational            | LULUS (tercatat) | 0 |
| MODERATE | Warning                  | LULUS (tercatat) | 0 |
| HIGH     | **Dev-only tooling**     | LULUS (warning)  | 0 |
| HIGH     | **Production runtime**   | **BLOCKING**     | 1 |
| CRITICAL | Semua                    | **BLOCKING**     | 1 |

Klasifikasi production vs dev: paket yang muncul pada `npm audit --omit=dev`
dianggap production-runtime (konservatif — npm tidak selalu memisahkan
devDependencies transitivity dengan benar, mis. vite ikut terdaftar; klasifikasi
ini memilih sisi aman).

## 3. Exception

Blocking finding (CRITICAL / HIGH-production) boleh diloloskan HANYA bila:

1. Ada entri di `scripts/dependency-audit.exceptions.json` dengan
   `package` + `severity` yang cocok, DAN
2. `reviewDate` masih di masa depan (≥ hari ini), DAN
3. Alasan terdokumentasi: tidak applicable / tidak ada patch tanpa major
   upgrade / mitigasi eksplisit.

TIDAK ADA blanket exception ("ignore semua HIGH"). Exception yang kedaluwarsa
otomatis menjadi blocking lagi — review terjadwal wajib.

## 4. Registri Exception Aktif

| Package | Severity | Alasan | Owner | Review | Mitigasi |
|---------|----------|--------|-------|--------|----------|
| vite (5.4.21) | HIGH | Dev-only tooling; advisory path traversal `.map` + launch-editor NTLM hanya relevan saat menjalankan dev server lokal operator. Patch hanya di 6.4.3+/7.x (major upgrade) — ditunda dengan review. | cashflow-eng | 2026-09-09 | Upgrade vite 6/7 sebagai task terpisah dengan evidence CI green |
| protobufjs (≤7.6.4) | MODERATE | Transitive @google/genai; DoS hanya saat parsing `.proto` attacker-controlled (SDK mem-parse proto bundled) | cashflow-eng | 2026-09-09 | Pantau rilis @google/genai ≥ protobufjs 7.6.5 |

## 5. Status Audit Terakhir (2026-08-09)

Sebelum P2.4 (baseline):

```text
LOW 0 · MODERATE 2 · HIGH 7 · CRITICAL 0 · TOTAL 9
```

Setelah targeted upgrade (patch-level, tanpa force):

```text
postcss 8.5.15 → 8.5.26   (dev, path traversal source map)      FIXED
react-router-dom 7.18.0 → 7.18.2 (prod, RSC CSRF — SPA tanpa RSC) FIXED
concurrently 10.0.3 → 10.0.4 (dev, shell-quote DoS)              FIXED
nanoid 3.3.12 (transitive postcss)                                FIXED
```

Sekarang:

```text
LOW 0 · MODERATE 2 · HIGH 1 · CRITICAL 0 · TOTAL 3  →  ALLOWED (0 blocking)
```

## 6. Perilaku CI

- Step `Dependency audit (tiered gate)` di job `quality` (`e2e.yml`), dijalankan
  segera setelah install — fail-fast sebelum typecheck/build.
- Blocking finding → job gagal → merge diblokir.
- Moderate/HIGH-dev → laporan warning di log, tidak memblokir.
- Kebijakan: jangan pernah `npm audit fix --force` di CI; upgrade dengan
  evidence (versi patch tersedia + seluruh gate hijau).
