/**
 * verify-capture-selfheal.mjs — UJI KETAHANAN: buktikan DELETE-first pada
 * scripts/capture-admin-panels.mjs benar-benar self-healing tanpa PK violation.
 *
 * Skenario yang diuji:
 *   1. KILL DI TENGAH RUN: proses mati SETELAH beforeAll men-seed fixture
 *      (id prefiks e2e-*) tapi SEBELUM finally cleanup → baris e2e-* tertinggal.
 *   2. TANPA delete-first: re-seed dengan id fixed yang sama → PRIMARY KEY
 *      constraint failed (inilah yang terjadi bila seed tidak didahului cleanup).
 *   3. RUN ULANG SCRIPT ASLI: beforeAll delete-first membersihkan leftover
 *      (idempoten) → seed sukses → screenshot diproduksi → finally cleanup
 *      menghapus semua e2e-* lagi (state bersih, aman dijalankan berulang).
 *
 * Verifikasi kuantitatif (langsung ke Turso):
 *   - baseline e2e-* (harus 0) → setelah simulasi kill (harus >0) → setelah
 *     naive re-seed (PK violation TERTANGKAP, bukan crash) → setelah run ulang
 *     (harus 0 lagi + screenshot diproduksi + exit code 0).
 *
 * Menjalankan (butuh server dev + playwright):
 *   npm run verify:capture-selfheal
 *   node scripts/verify-capture-selfheal.mjs
 *
 * Exit code: 0 = semua bukti lolos; 1 = ada langkah gagal.
 *
 * Catatan:
 *   - Selama run, ~64 baris fixture e2e-* terlihat sementara di DB Turso lokal
 *     (panel admin monitoring bisa menampilkan data fixture ~30-60 detik bila
 *     dev server hidup) — setelah selesai dihapus (state bersih).
 *   - Langkah [3] sengaja memakai seedRecommendationFixtures karena seed ini
 *     TIDAK idempoten internal (id fixed, tanpa delete-first sendiri) — beda
 *     dengan seedRetentionFixtures yang delete-first internal. Bila nanti
 *     recommendation dijadikan idempoten, step [3] perlu diubah ke fixture
 *     lain yang masih PK-violate tanpa cleanup.
 */
import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { createClient } from '@libsql/client';
import {
  seedAICostTrendFixtures,
  seedRecommendationFixtures,
  seedFeedbackRateFixtures,
  seedRetentionFixtures,
  cleanupAICostTrendFixtures,
  cleanupRecommendationFixtures,
  cleanupFeedbackRateFixtures,
  cleanupRetentionFixtures,
} from '../e2e/helpers/mintSession.ts';

function loadEnv() {
  for (const p of ['server/.env', '.env.local']) {
    if (!fs.existsSync(p)) continue;
    for (const line of fs.readFileSync(p, 'utf8').split(/\r?\n/)) {
      const t = line.trim();
      if (t && !t.startsWith('#') && t.includes('=')) {
        const i = t.indexOf('=');
        const k = t.slice(0, i).trim();
        const v = t.slice(i + 1).trim().replace(/^["']|["']$/g, '');
        if (k && !process.env[k]) process.env[k] = v;
      }
    }
  }
}

let turso = null;
function withTurso() {
  if (turso) return turso;
  loadEnv();
  turso = createClient({
    url: process.env.TURSO_DATABASE_URL,
    authToken: process.env.TURSO_AUTH_TOKEN,
  });
  return turso;
}

/** Hitung SEMUA baris fixture e2e-* di keempat tabel (id prefiks khas tiap fixture). */
async function countE2eRows() {
  const t = withTurso();
  const q = async (sql, args = []) => {
    const r = await t.execute({ sql, args });
    return Number(r.rows[0]?.n) || 0;
  };
  return {
    usage: await q(`SELECT COUNT(*) n FROM ai_usage_metrics WHERE id LIKE 'e2e-usage-%'`),
    reco: await q(`SELECT COUNT(*) n FROM system_metrics WHERE id LIKE 'e2e-reco-%'`),
    frFeedback: await q(`SELECT COUNT(*) n FROM ai_feedback WHERE id LIKE 'e2e-fr-%'`),
    frViews: await q(`SELECT COUNT(*) n FROM system_metrics WHERE id LIKE 'e2e-fr-%'`),
    retUsers: await q(`SELECT COUNT(*) n FROM user WHERE id LIKE 'e2e-ret-%'`),
    retMetrics: await q(`SELECT COUNT(*) n FROM system_metrics WHERE id LIKE 'e2e-ret-%'`),
  };
}

const total = (rows) =>
  Object.values(rows).reduce((s, v) => s + v, 0);

async function demoUserId() {
  const t = withTurso();
  const r = await t.execute({ sql: 'SELECT id FROM user WHERE email = ?', args: ['demo@cashflow.test'] });
  if (!r.rows.length) throw new Error('User demo@cashflow.test tidak ditemukan (jalankan seed demo dulu)');
  return String(r.rows[0].id);
}

/**
 * Jalankan script capture-admin-panels.mjs sebagai proses anak; kembalikan
 * { code, out }. Timeout 240s: bila proses anak hang (mis. chromium.launch
 * menggantung), bunuh dan laporkan code=null — jangan menggantung verifikasi.
 */
function runCaptureAdmin() {
  return new Promise((resolve) => {
    const child = spawn(process.execPath, ['scripts/capture-admin-panels.mjs'], {
      cwd: process.cwd(),
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let out = '';
    const timer = setTimeout(() => {
      child.kill('SIGKILL');
      resolve({ code: null, out: out + '\n[TIMEOUT] proses anak dibunuh setelah 240s' });
    }, 240_000);
    child.stdout.on('data', (d) => { out += d; });
    child.stderr.on('data', (d) => { out += d; });
    child.on('close', (code) => {
      clearTimeout(timer);
      resolve({ code, out });
    });
  });
}

/** Jalankan satu fungsi async dan kembalikan { ok, error } — error diharapkan TIDAK crash. */
async function attempt(label, fn) {
  try {
    await fn();
    console.log(`  ✓ ${label} — SUKSES (tidak error)`);
    return { ok: true };
  } catch (e) {
    const msg = String(e?.message || e);
    console.log(`  ✗ ${label} — ERROR TERTANGKAP: ${msg.slice(0, 200)}`);
    return { ok: false, error: msg };
  }
}

let failed = false;
const check = (cond, msg) => {
  if (!cond) {
    failed = true;
    console.log(`  ✗ ${msg}`);
  } else {
    console.log(`  ✓ ${msg}`);
  }
};

async function main() {
  console.log('=== UJI KETAHANAN: DELETE-first self-healing capture-admin-panels ===\n');
  const userId = await demoUserId();

  // 1) Baseline bersih.
  const baseline = await countE2eRows();
  console.log(`[1] BASELINE e2e-*: total=${total(baseline)}`, JSON.stringify(baseline));
  check(total(baseline) === 0, 'baseline harus 0 baris e2e-*');

  // 2) SIMULASI KILL MID-RUN: seed semua fixture TANPA cleanup dulu
  //    (proses mati setelah beforeAll seed, sebelum finally cleanup).
  console.log('\n[2] SIMULASI KILL MID-RUN: seed keempat fixture tanpa cleanup…');
  await seedAICostTrendFixtures(userId);
  await seedRecommendationFixtures(userId);
  await seedFeedbackRateFixtures(userId);
  await seedRetentionFixtures();
  const killed = await countE2eRows();
  console.log(`  e2e-* setelah simulasi kill: total=${total(killed)}`, JSON.stringify(killed));
  check(total(killed) > 0, 'state kill harus menyisakan baris e2e-* (>0)');

  // 3) TANPA delete-first → PK violation (bukti mengapa delete-first wajib).
  console.log('\n[3] BUKTI TANPA delete-first: re-seed recommendation (id fixed sama)…');
  const naive = await attempt('re-seed seedRecommendationFixtures tanpa cleanup', () =>
    seedRecommendationFixtures(userId),
  );
  check(!naive.ok && /constraint|primary|unique/i.test(naive.error || ''), 're-seed tanpa cleanup harus PK violation');

  // 4) RUN ULANG SCRIPT ASLI — beforeAll delete-first membersihkan leftover lalu seed.
  console.log('\n[4] RUN ULANG script asli (capture-admin-panels.mjs)…');
  const res = await runCaptureAdmin();
  check(res.code === 0, `exit code 0 (aktual: ${res.code})`);
  // Anchor ke baris DONE engine + verifikasi file PNG benar-benar ada di disk
  // (bukan sekadar hitung substring "✓" di stdout yang rapuh).
  const doneMatch = res.out.match(/DONE — (\d+) screenshot/);
  const produced = doneMatch ? Number(doneMatch[1]) : 0;
  check(produced === 6, `6 screenshot diproduksi (DONE line, aktual: ${produced})`);
  const EXPECTED_FILES = [
    'admin-monitoring-recommendation.png',
    'admin-monitoring-recommendation-dark.png',
    'admin-monitoring-feedback-rate.png',
    'admin-monitoring-feedback-rate-dark.png',
    'admin-monitoring-retention.png',
    'admin-monitoring-retention-dark.png',
  ];
  const missing = EXPECTED_FILES.filter(
    (f) => !fs.existsSync(path.join('docs', 'assets', 'screenshots', f)),
  );
  check(missing.length === 0, `6 file PNG ada di disk (missing: ${missing.join(', ') || 'none'})`);
  if (res.code !== 0) console.log(res.out.slice(-800));

  // 5) State bersih setelah run ulang.
  const post = await countE2eRows();
  console.log(`\n[5] PASCA-RUN: e2e-* total=${total(post)}`, JSON.stringify(post));
  check(total(post) === 0, 'pasca-run harus 0 baris e2e-* (cleanup finally jalan)');

  console.log(`\n=== VERDICT: ${failed ? 'GAGAL' : 'SELF-HEALING TERBUKTI ✅'} ===`);
  if (turso) turso.close();
  process.exit(failed ? 1 : 0);
}

main().catch((e) => {
  console.error('[verify] GAGAL:', e.message);
  if (turso) turso.close();
  process.exit(1);
});
