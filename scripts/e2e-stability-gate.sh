#!/usr/bin/env bash
# =============================================================================
# Stability gate E2E — CashFlow
# -----------------------------------------------------------------------------
# Menjalankan suite E2E hingga MAX_ATTEMPTS kali dan GAGAL HANYA bila semua
# attempt gagal berturut-turut (kegagalan konsisten = regresi riil). Flake
# sesekali (1-2 attempt gagal lalu attempt berikutnya lulus) = job HIJAU,
# disertai warning + arsip per-attempt untuk forensik.
#
# Ini implementasi roadmap CI_PIPELINE.md #1 ("npm run test:e2e 3× di CI —
# stability gate") — diterapkan saat suite > 20 test (kini 38 test).
#
# Interplay dengan retries Playwright:
#   - playwright.config.ts retries:1 → tiap test yang gagal di-retry 1× dalam
#     satu run (flake per-test ditangani di level test).
#   - Gate ini bekerja di level SUITE: bila run tetap gagal (test gagal 2×),
#     run diulang hingga 3×. Total eksekusi terburuk = 3 run × (1 + 1 retry).
#
# Variabel env (semua opsional):
#   E2E_CMD       perintah suite        (default: npm run test:e2e)
#   SEED_CMD      perintah re-seed antar attempt yang gagal
#                 (default: node scripts/seedE2eDataset.mjs — idempoten,
#                  hanya menyentuh user seed, aman dijalankan berulang)
#   MAX_ATTEMPTS  jumlah attempt maks  (default: 3)
#   GITHUB_OUTPUT       bila diset (CI), tulis output result + failed_attempts
#                       untuk dipakai step selanjutnya (saat ini di-siapkan
#                       untuk konsumen di masa depan — upload artifact saat ini
#                       memakai if: always() agar flake forensics tetap terkirim)
#   GITHUB_STEP_SUMMARY bila diset (CI), tulis tabel markdown per-attempt agar
#                       flake terlihat sekilas di halaman run (bukan cuma log)
#
# Exit code: 0 = stabil (lulus ≤ MAX_ATTEMPTS), 1 = gagal konsisten.
#
# Contoh:
#   bash scripts/e2e-stability-gate.sh                    # happy path riil
#   E2E_CMD="false" SEED_CMD="true" bash scripts/e2e-stability-gate.sh
#       # simulasikan regresi → 3 attempt gagal → exit 1
# =============================================================================
set -u

E2E_CMD="${E2E_CMD:-npm run test:e2e}"
SEED_CMD="${SEED_CMD:-node scripts/seedE2eDataset.mjs}"
MAX_ATTEMPTS="${MAX_ATTEMPTS:-3}"

failed_attempts=0
attempt_results=""

write_summary() {
  # $1 = verdict final ("stable" | "regression")
  if [ -n "${GITHUB_STEP_SUMMARY:-}" ]; then
    {
      echo "## Stability Gate E2E"
      echo ""
      echo "| Attempt | Hasil |"
      echo "|---|---|"
      printf '%b\n' "${attempt_results}"
      echo ""
      if [ "$1" = "regression" ]; then
        echo "> 🔴 **REGresi**: gagal pada ${failed_attempts}/${MAX_ATTEMPTS} attempt berturut — bukan flake."
      elif [ "${failed_attempts}" -gt 0 ]; then
        echo "> ⚠️ Flake terdeteksi: ${failed_attempts} attempt gagal sebelum lulus — arsip per-attempt di-upload untuk forensik."
      else
        echo "> ✅ Stabil — lulus pada attempt pertama."
      fi
    } >> "${GITHUB_STEP_SUMMARY}"
  fi
}

echo "── Stability gate: max ${MAX_ATTEMPTS} attempt (cmd: ${E2E_CMD}) ──"

for attempt in $(seq 1 "${MAX_ATTEMPTS}"); do
  echo ""
  echo "===== Stability gate: attempt ${attempt}/${MAX_ATTEMPTS} ====="

  # Catat rc secara eksplisit — jangan biarkan set -e menghentikan loop.
  eval "${E2E_CMD}"
  rc=$?

  if [ "${rc}" -eq 0 ]; then
    attempt_results="${attempt_results}| ${attempt}/${MAX_ATTEMPTS} | ✅ PASSED |\n"
    echo "✅ attempt ${attempt}/${MAX_ATTEMPTS} PASSED"
    if [ "${failed_attempts}" -gt 0 ]; then
      echo "::warning::E2E flake terdeteksi: ${failed_attempts} attempt gagal sebelum attempt ini lulus — suite stabil namun ada test flaky. Arsip per-attempt (playwright-report-attempt-* / test-results-attempt-*) di-upload untuk forensik."
    fi
    write_summary "stable"
    if [ -n "${GITHUB_OUTPUT:-}" ]; then
      echo "result=passed" >> "${GITHUB_OUTPUT}"
      echo "failed_attempts=${failed_attempts}" >> "${GITHUB_OUTPUT}"
    fi
    exit 0
  fi

  # Arsip report/traces attempt ini SEBELUM run berikutnya menimpa folder.
  if [ -d playwright-report ]; then
    cp -r playwright-report "playwright-report-attempt-${attempt}" 2>/dev/null || true
  fi
  if [ -d test-results ]; then
    cp -r test-results "test-results-attempt-${attempt}" 2>/dev/null || true
  fi

  attempt_results="${attempt_results}| ${attempt}/${MAX_ATTEMPTS} | ❌ FAILED (rc=${rc}) |\n"
  failed_attempts=$((failed_attempts + 1))
  echo "❌ attempt ${attempt}/${MAX_ATTEMPTS} FAILED (rc=${rc}) — attempt gagal berturut: ${failed_attempts}"

  # Re-seed antar attempt: attempt berikutnya mulai dari state deterministik,
  # bukan dari sisa data run yang gagal (mencegah kegagalan beruntun palsu).
  if [ "${attempt}" -lt "${MAX_ATTEMPTS}" ]; then
    echo "→ Re-seed DB (${SEED_CMD})"
    eval "${SEED_CMD}" || echo "::warning::Re-seed antar-attempt gagal — lanjut dengan state saat ini"
  fi
done

echo ""
echo "::error::E2E suite GAGAL pada ${failed_attempts}/${MAX_ATTEMPTS} attempt berturut-turut — kegagalan konsisten (BUKAN flake), kemungkinan regresi riil. Periksa arsip per-attempt & report akhir."
write_summary "regression"
if [ -n "${GITHUB_OUTPUT:-}" ]; then
  echo "result=failed" >> "${GITHUB_OUTPUT}"
  echo "failed_attempts=${failed_attempts}" >> "${GITHUB_OUTPUT}"
fi
exit 1
