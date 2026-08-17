#!/usr/bin/env node
/**
 * Runner E2E terisolasi PARALEL (P2.2) — per-worker (per-shard) isolation.
 *
 * Playwright `webServer` hanya mendukung SATU pasang server per process test —
 * tidak ada server per-worker. Isolasi DB per-worker karena itu diimplementasikan
 * sebagai isolasi per-PROCESS via shard (lihat playwright.e2e-local.config.mjs):
 *
 *   worker i  =  process i  =  DB  .test-data/e2e-shard-<i>.db
 *                            + Vite 5190+2i + API 5191+2i
 *                            + slice test sendiri (--shard=i/N)
 *
 * Script ini meluncurkan N process shard SECARA KONKUREN, menunggu semuanya,
 * dan menggagalkan (exit 1) bila ada shard yang gagal — dipakai lokal maupun
 * CI (tanpa secret Turso: DB lokal file:).
 *
 * Penggunaan:
 *   node scripts/run-e2e-shards.mjs                 # 4 shard (default)
 *   E2E_SHARDS=2 node scripts/run-e2e-shards.mjs    # 2 shard
 *   node scripts/run-e2e-shards.mjs -- e2e/dashboard.spec.ts   # filter spec
 *
 * Exit code: 0 = semua shard hijau · 1 = ada shard gagal.
 */
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
// Default 2 = resource-safe di dev machine (evidence P2.2: 4 shard di i5-1135G7
// 8-thread + 4GB free RAM jenuh → per-test melambat ~2×, wall 3m05s ≈ 2 shard
// 3m18s). CI dengan runner lebih besar bisa E2E_SHARDS=4 (job CI menyetelnya).
const SHARDS = Math.max(1, Math.min(8, Number(process.env.E2E_SHARDS || 2)));
const extraArgs = process.argv.slice(2).filter((a) => a !== '--');

console.log(`[run-e2e-shards] ${SHARDS} worker paralel (DB + port per worker terisolasi)`);

const children = [];
for (let i = 0; i < SHARDS; i++) {
  const args = [
    'playwright',
    'test',
    '-c',
    'playwright.e2e-local.config.mjs',
    `--shard=${i + 1}/${SHARDS}`,
    ...extraArgs,
  ];
  const child = spawn('npx', args, {
    cwd: ROOT,
    env: { ...process.env, E2E_SHARD_INDEX: String(i) },
    stdio: ['ignore', 'pipe', 'pipe'],
    shell: process.platform === 'win32',
  });
  const tag = `[shard ${i}]`;
  child.stdout.on('data', (d) => process.stdout.write(`${tag} ${d}`));
  child.stderr.on('data', (d) => process.stderr.write(`${tag} ${d}`));
  children.push({ child, i });
}

const results = await Promise.all(
  children.map(
    ({ child, i }) =>
      new Promise((resolve) => {
        child.on('close', (code) => resolve({ i, code }));
      }),
  ),
);

let failed = 0;
for (const r of results) {
  const ok = r.code === 0;
  if (!ok) failed++;
  console.log(`[run-e2e-shards] shard ${r.i}: ${ok ? 'PASS' : `FAIL (exit ${r.code})`}`);
}
console.log(
  failed === 0
    ? `[run-e2e-shards] ✅ ${SHARDS}/${SHARDS} worker hijau`
    : `[run-e2e-shards] ❌ ${failed}/${SHARDS} worker gagal`,
);
process.exit(failed === 0 ? 0 : 1);
