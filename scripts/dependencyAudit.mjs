#!/usr/bin/env node
/**
 * CashFlow Dependency Security Audit — tiered gate (P2.4).
 *
 * Kebijakan tier (dokumentasi penuh: docs/security/DEPENDENCY_AUDIT.md):
 *
 *   CRITICAL            → BLOCKING (selalu)   — kecuali exception terdokumentasi
 *   HIGH + production   → BLOCKING            — kecuali exception terdokumentasi
 *   HIGH + dev-only     → WARNING (lulus)     — tercantum di laporan
 *   MODERATE / LOW      → INFO (lulus)        — tercantum di laporan
 *
 * Klasifikasi production vs dev: paket yang muncul pada `npm audit --omit=dev`
 * dianggap production-runtime; sisanya dev-only tooling.
 *
 * Exception: scripts/dependency-audit.exceptions.json (array) — blocking
 * finding boleh diloloskan hanya bila entri {package, severity} cocok DAN
 * `reviewDate` masih di masa depan. Tidak ada blanket exception.
 *
 * Penggunaan:
 *   npm run audit:deps          # laporan + exit code (0 = allowed, 1 = blocking)
 *   npm run audit:deps -- --json  # laporan dalam satu baris JSON (CI-friendly)
 */
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const EXCEPTIONS_PATH = path.join(ROOT, 'scripts', 'dependency-audit.exceptions.json');

/** Jalankan npm audit dan parse JSON. */
function runAudit(omitDev) {
  const args = ['audit', '--json'];
  if (omitDev) args.push('--omit=dev');
  // Windows: npm diekspos sebagai npm.cmd — tanpa ini spawnSync ENOENT.
  const bin = process.platform === 'win32' ? 'npm.cmd' : 'npm';
  // npm audit exit 1 SAAT ada vulnerability — stdout tetap berisi JSON;
  // tangkap lewat error (bukan throw tanpa output).
  try {
    const raw = execFileSync(bin, args, {
      cwd: ROOT,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
      // .cmd wrapper di Windows butuh shell (spawnSync npm.cmd → EINVAL tanpa ini).
      shell: process.platform === 'win32',
    });
    return JSON.parse(raw);
  } catch (err) {
    const out = err.stdout ? String(err.stdout) : '';
    return JSON.parse(out || '{"vulnerabilities":{},"metadata":{}}');
  }
}

function loadExceptions() {
  if (!fs.existsSync(EXCEPTIONS_PATH)) return [];
  return JSON.parse(fs.readFileSync(EXCEPTIONS_PATH, 'utf8'));
}

/** Blocking finding diloloskan bila ada exception valid (reviewDate >= hari ini). */
function exceptionAllows(exceptions, name, severity) {
  const today = new Date().toISOString().slice(0, 10);
  return exceptions.some(
    (e) => e.package === name && e.severity === severity && e.reviewDate && e.reviewDate >= today,
  );
}

const [allAudit, prodAudit] = [runAudit(false), runAudit(true)];
const prodNames = new Set(Object.keys(prodAudit.vulnerabilities || {}));
const exceptions = loadExceptions();

const findings = Object.entries(allAudit.vulnerabilities || {}).map(([name, v]) => {
  const via = (v.via || []).map((x) => (typeof x === 'string' ? x : x.title || x.url || '')).filter(Boolean);
  const fix = v.fixAvailable
    ? typeof v.fixAvailable === 'object'
      ? `${v.fixAvailable.name}@${v.fixAvailable.version}${v.fixAvailable.isSemVerMajor ? ' (major)' : ''}`
      : 'tersedia'
    : 'tidak tersedia';
  return {
    name,
    severity: v.severity,
    isDirect: !!v.isDirect,
    production: prodNames.has(name),
    via: via.slice(0, 2).join(' | '),
    range: v.range,
    fix,
  };
});

const BLOCK_CRITICAL = findings.filter((f) => f.severity === 'critical');
const BLOCK_HIGH_PROD = findings.filter((f) => f.severity === 'high' && f.production);
const ALLOWED_EXCEPTIONS = findings.filter(
  (f) => (f.severity === 'critical' || (f.severity === 'high' && f.production)) && exceptionAllows(exceptions, f.name, f.severity),
);
const WARN_HIGH_DEV = findings.filter((f) => f.severity === 'high' && !f.production);
const INFO = findings.filter((f) => f.severity === 'moderate' || f.severity === 'low');

const blocking = [...BLOCK_CRITICAL, ...BLOCK_HIGH_PROD].filter(
  (f) => !exceptionAllows(exceptions, f.name, f.severity),
);

const counts = { low: 0, moderate: 0, high: 0, critical: 0 };
for (const f of findings) counts[f.severity] = (counts[f.severity] || 0) + 1;

const report = {
  total: findings.length,
  counts,
  blocking: blocking.map((f) => ({
    package: f.name,
    range: f.range,
    severity: f.severity,
    production: f.production,
    via: f.via,
    fix: f.fix,
  })),
  allowedViaException: ALLOWED_EXCEPTIONS.map((f) => ({ package: f.name, severity: f.severity })),
  warnings: [...WARN_HIGH_DEV, ...INFO].map((f) => ({
    package: f.name,
    severity: f.severity,
    production: f.production,
    via: f.via,
    fix: f.fix,
  })),
};

if (process.argv.includes('--json')) {
  console.log(JSON.stringify({ ...report, exitCode: blocking.length ? 1 : 0 }));
} else {
  console.log('\nCashFlow Dependency Security Audit');
  console.log('==================================');
  console.log(`LOW       : ${counts.low}`);
  console.log(`MODERATE  : ${counts.moderate}`);
  console.log(`HIGH      : ${counts.high}`);
  console.log(`CRITICAL  : ${counts.critical}`);
  console.log('----------------------------------');
  console.log('Blocking findings (CRITICAL / HIGH-production):');
  if (blocking.length === 0) console.log('  — tidak ada —');
  for (const b of blocking) {
    console.log(`  ⛔ ${b.package}@${b.range} [${b.severity.toUpperCase()}] ${b.production ? 'prod' : ''} · via: ${b.via} · fix: ${b.fix}`);
  }
  if (ALLOWED_EXCEPTIONS.length) {
    console.log('Allowed via documented exception:');
    for (const a of ALLOWED_EXCEPTIONS) console.log(`  ℹ️  ${a.name} [${a.severity}] (exception valid)`);
  }
  console.log('Warnings (dev-only HIGH / MODERATE / LOW — non-blocking):');
  for (const w of [...WARN_HIGH_DEV, ...INFO]) {
    console.log(`  ⚠️  ${w.name} [${w.severity.toUpperCase()}] ${w.production ? 'prod' : 'dev'} · via: ${w.via} · fix: ${w.fix}`);
  }
  console.log('----------------------------------');
  console.log(blocking.length === 0 ? '✅ ALLOWED (tidak ada blocking vulnerability)' : `❌ BLOCKING: ${blocking.length} vulnerability`);
}

process.exit(blocking.length ? 1 : 0);
