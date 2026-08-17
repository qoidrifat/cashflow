/**
 * Feedback → Prioritas Perbaikan Prompt (Sprint 1.5 — integrasi ai_feedback
 * ke benchmark AI).
 *
 * Memuat dataset `ai_feedback` NYATA dari Turso (user feedback atas hasil AI),
 * mengagregasi per feature/rating, lalu menghasilkan:
 *   1. Tabel prioritas per feature (negativeRate, priorityScore, confidence).
 *   2. Action plan perbaikan prompt (feature → prompt builder → arah perbaikan).
 *   3. File `docs/ai/feedback-prompt-priorities.json` (snapshot, di-refresh manual).
 *
 * Digunakan sebelum menjalankan benchmark live (`npm run benchmark:ai:live`)
 * untuk memprioritaskan kategori & prompt mana yang perlu dievaluasi/diperbaiki.
 *
 * Jalankan:
 *   node scripts/feedbackPromptPriorities.mjs
 *
 * Butuh server/.env dengan TURSO_DATABASE_URL & TURSO_AUTH_TOKEN.
 *
 * Catatan dataset: query memuat SEMUA baris ai_feedback (tanpa LIMIT) lalu
 * agregasi di memori — cocok untuk tool analisis manual dengan dataset moderat.
 * Bila tabel tumbuh besar, agregasi bisa dipindah ke SQL (GROUP BY feature, rating).
 */
import fs from 'node:fs';
import path from 'node:path';
import { createClient } from '@libsql/client';
import { buildFeedbackPriorityReport } from '../server/lib/feedbackMetrics.js';

function loadEnv() {
  const envPath = path.resolve(process.cwd(), 'server', '.env');
  if (!fs.existsSync(envPath)) return;
  for (const line of fs.readFileSync(envPath, 'utf8').split(/\r?\n/)) {
    const t = line.trim();
    if (t && !t.startsWith('#') && t.includes('=')) {
      const i = t.indexOf('=');
      const k = t.slice(0, i).trim();
      const v = t.slice(i + 1).trim().replace(/^["']|["']$/g, '');
      if (k && !process.env[k]) process.env[k] = v;
    }
  }
}

loadEnv();

const url = process.env.TURSO_DATABASE_URL || process.env.TURSO_URL;
const authToken = process.env.TURSO_AUTH_TOKEN || process.env.TURSO_TOKEN;
if (!url) {
  console.error('❌ TURSO_DATABASE_URL tidak ditemukan di server/.env');
  process.exit(1);
}

const turso = createClient({ url, authToken: authToken || undefined });
try {
  const result = await turso.execute({
    sql: `SELECT feature, rating, reason FROM ai_feedback ORDER BY created_at ASC`,
    args: [],
  });

  const rows = (result.rows || []).map((r) => ({
    feature: String(r.feature || ''),
    rating: String(r.rating || ''),
    reason: String(r.reason || ''),
  }));

  console.log(`\n=== FEEDBACK → PRIORITAS PERBAIKAN PROMPT ===`);
  console.log(`Dataset ai_feedback: ${rows.length} baris\n`);

  if (rows.length === 0) {
    console.log('Belum ada feedback dari user. Ajakan feedback muncul di kartu AI (AI Hub, Advisor, dst).');
    console.log('File snapshot tetap ditulis dengan laporan kosong.');
  }

  const report = buildFeedbackPriorityReport(rows);

  // ── Tabel prioritas ──
  const table = report.features.map((f) => ({
    feature: f.feature,
    total: f.total,
    negative: f.counts.not_helpful + f.counts.mismatched + f.counts.irrelevant,
    positive: f.counts.helpful,
    skip: f.counts.skip,
    already_done: f.counts.already_done,
    negativeRate: `${Math.round(f.negativeRate * 100)}%`,
    priorityScore: f.priorityScore,
    confidence: f.confidence,
  }));
  console.table(table.length ? table : [{ feature: '(kosong)', total: 0, negative: 0, positive: 0, skip: 0, already_done: 0, negativeRate: '0%', priorityScore: 0, confidence: 'none' }]);

  // ── Action plan (top 5) ──
  console.log('\n=== ACTION PLAN PERBAIKAN PROMPT (top 5 prioritas) ===');
  for (const plan of report.actionPlan.slice(0, 5)) {
    console.log(`\n[${plan.feature}] (${plan.label}) — skor ${plan.priorityScore}, ${plan.total} feedback`);
    console.log(`  prompt : ${plan.prompt}`);
    console.log(`  file   : ${plan.file}`);
    console.log(`  arah   : ${plan.direction}`);
  }

  // ── Snapshot JSON (tanpa timestamp — deterministik per snapshot data) ──
  const outPath = path.resolve(process.cwd(), 'docs', 'ai', 'feedback-prompt-priorities.json');
  fs.mkdirSync(path.dirname(outPath), { recursive: true });
  fs.writeFileSync(outPath, JSON.stringify({ source: 'scripts/feedbackPromptPriorities.mjs', ...report }, null, 2));
  console.log(`\nSnapshot ditulis: ${outPath}`);
  const top = report.topPriority
    ? `"${report.topPriority.feature}" (skor ${report.topPriority.priorityScore})`
    : '(tidak ada — belum ada feedback)';
  console.log(`Ringkasan: ${report.totalFeedback} feedback · ${report.featuresWithFeedback} feature · prioritas teratas ${top}`);
} finally {
  turso.close();
}
