/**
 * Evaluasi Before/After Perbaikan Prompt (Sprint 1.5 — alur evaluasi).
 *
 * Alur kerja yang dipakai bersama prioritas feedback (feedbackMetrics):
 *   1. node scripts/promptChangeEvaluate.mjs --baseline "sebelum ubah prompt advisor"
 *        → simpan snapshot docs/ai/benchmark-before.json dari hasil saat ini.
 *   2. (ubah prompt builder feature ber-prioritas tertinggi)
 *   3. node scripts/promptChangeEvaluate.mjs --compare "setelah ubah prompt advisor"
 *        → jalankan benchmark offline (vitest) → bandingkan dengan baseline →
 *          tabel delta per kategori + verdict (membaik / regresi / tidak berubah).
 *
 * Alternatif: --run-only (jalankan benchmark tanpa diff).
 *
 * File snapshot TIDAK di-commit (artefak kerja) — simpan/dokumentasikan bila
 * perlu. Jalankan dari root project; butuh node_modules (vitest).
 */
import fs from 'node:fs';
import path from 'node:path';
import { execSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';
import { diffBenchmarkReports, renderDiffTable, verdictLine } from './benchmarkDiff.mjs';

const ROOT = process.cwd();
const RESULTS_FILE = path.join(ROOT, 'docs', 'ai', 'benchmark-results.json');
const BASELINE_FILE = path.join(ROOT, 'docs', 'ai', 'benchmark-before.json');
const BENCH_SPEC = 'tests/benchmark/aiQualityBenchmark.spec.ts';

function readJson(file, { required = false } = {}) {
  if (!fs.existsSync(file)) {
    if (required) throw new Error(`File tidak ditemukan: ${file}`);
    return null;
  }
  return JSON.parse(fs.readFileSync(file, 'utf8'));
}

function runBenchmark() {
  console.log(`\n=== Menjalankan benchmark offline: vitest run ${BENCH_SPEC} ===`);
  // execSync via shell: temukan npx/npx.cmd lintas platform (Windows EINVAL
  // bila .cmd dijalankan langsung lewat execFileSync tanpa shell).
  execSync(`npx vitest run "${BENCH_SPEC}"`, {
    cwd: ROOT,
    stdio: 'inherit',
    timeout: 300_000,
  });
  if (!fs.existsSync(RESULTS_FILE)) {
    throw new Error('Benchmark selesai tetapi benchmark-results.json tidak ditulis.');
  }
  console.log(`Benchmark selesai → ${path.relative(ROOT, RESULTS_FILE)}\n`);
}

function cmdBaseline(label) {
  if (!label) throw new Error('--baseline butuh label: node scripts/promptChangeEvaluate.mjs --baseline "deskripsi kondisi"');
  const results = readJson(RESULTS_FILE, { required: true });
  const baseline = {
    label,
    capturedAt: new Date().toISOString(),
    runner: 'scripts/promptChangeEvaluate.mjs --baseline',
    categories: results.categories,
  };
  fs.writeFileSync(BASELINE_FILE, JSON.stringify(baseline, null, 2));
  console.log(`\n✅ Baseline disimpan: ${path.relative(ROOT, BASELINE_FILE)}`);
  console.log(`   Label: ${label} · ${results.categories.length} kategori · ${results.categories.reduce((s, c) => s + (c.cases || 0), 0)} kasus`);
  console.log('\n   Sekarang ubah prompt builder fitur prioritas tertinggi, lalu jalankan:');
  console.log('   node scripts/promptChangeEvaluate.mjs --compare "deskripsi kondisi setelah"');
}

function cmdCompare(label) {
  if (!label) throw new Error('--compare butuh label: node scripts/promptChangeEvaluate.mjs --compare "deskripsi kondisi setelah"');
  const baseline = readJson(BASELINE_FILE, { required: true });
  runBenchmark();
  const after = readJson(RESULTS_FILE, { required: true });

  const diff = diffBenchmarkReports(baseline, after);
  console.log(`\n=== DIFF BENCHMARK ===`);
  console.log(`Baseline : ${baseline.label} (${baseline.capturedAt})`);
  console.log(`Sesudah  : ${label}\n`);
  console.table(renderDiffTable(diff));
  console.log(verdictLine(diff, label));
  console.log('\nCatatan: avgLatencyMs bersifat informational (noise mikrodetik antar-run\npure-JS; bukti runtime 18-71% jitter pada kode sama). Verdict ditentukan\nmetrik kualitas (precision/recall/f1/accuracy/hit-rate) & estCostUsdPerCase.');
}

function cmdRunOnly() {
  runBenchmark();
  const results = readJson(RESULTS_FILE, { required: true });
  console.log(`Hasil tersimpan di ${path.relative(ROOT, RESULTS_FILE)} — ${results.categories.length} kategori.`);
}

function usage() {
  console.log(`
Penggunaan:
  node scripts/promptChangeEvaluate.mjs --baseline "<label>"
      Simpan snapshot benchmark saat ini sebagai baseline (benchmark-before.json).
      Jalankan SEBELUM mengubah prompt.

  node scripts/promptChangeEvaluate.mjs --compare "<label>"
      Jalankan benchmark offline lalu bandingkan dengan baseline:
      tabel delta per kategori + verdict (membaik / regresi / tidak berubah).

  node scripts/promptChangeEvaluate.mjs --run-only
      Hanya jalankan benchmark (setara npm run benchmark:ai).
`);
}

function main() {
  const args = process.argv.slice(2);
  const flagIndex = args.findIndex((a) => a === '--baseline' || a === '--compare' || a === '--run-only' || a === '--help');
  const flag = flagIndex >= 0 ? args[flagIndex] : '--help';
  const value = flagIndex >= 0 ? args[flagIndex + 1] : undefined;

  try {
    if (flag === '--baseline') cmdBaseline(value);
    else if (flag === '--compare') cmdCompare(value);
    else if (flag === '--run-only') cmdRunOnly();
    else usage();
  } catch (err) {
    console.error(`\n❌ ${err.message}`);
    process.exit(1);
  }
}

// Jalankan main() hanya saat dieksekusi langsung (aman di-import untuk unit test).
const isMain = process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url;
if (isMain) main();
