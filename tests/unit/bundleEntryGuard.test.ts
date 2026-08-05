/**
 * Regression guard — fix P0 recharts lazy (Sprint 1.8/1.9).
 *
 * Memverifikasi DARI OUTPUT BUILD (dist/assets) bahwa entry chunk
 * (index-*.js) TIDAK static-import / meng-inline kode recharts
 * (vendor-charts → kini chunk CartesianChart-*.js).
 *
 * Latar belakang: sebelumnya recharts di-import statis dari beberapa halaman
 * chart → kode recharts (~200 kB) ikut ter-bundle ke entry chunk. Fix P0
 * memindahkan chart ke React.lazy → recharts ter-split ke chunk terpisah
 * (terverifikasi: CartesianChart-*.js berisi marker CartesianGrid/recharts)
 * yang hanya di-download saat halaman chart dibuka.
 *
 * Jika lazy boundary dihapus (React.lazy → import statis), kode recharts akan:
 *   1. hilang dari chunk terpisah, ATAU
 *   2. ter-inline ke entry chunk, ATAU
 *   3. di-static-import oleh entry chunk.
 * Ketiganya membuat test ini GAGAL — itulah fungsi regression guard.
 *
 * Catatan CI: quality job menjalankan `npm run test:unit` SEBELUM step Build,
 * jadi dist/ belum ada di checkout fresh. beforeAll menjalankan `npm run build`
 * on-demand bila dist tidak ditemukan agar guard tetap jujur di environment
 * mana pun (lokal dengan dist yang sudah dibuild = instant, tanpa rebuild).
 */
import { execSync } from 'node:child_process';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { beforeAll, describe, expect, it } from 'vitest';

const ROOT = process.cwd();
const DIST = join(ROOT, 'dist');
const ASSETS = join(DIST, 'assets');

/** Marker kode recharts di output minified — hanya ada bila recharts ikut ter-bundle. */
const RECHARTS_MARKERS = ['recharts', 'CartesianGrid'] as const;

/** Nama chunk chart yang dikenal (wrapper komponen chart yang di-lazy). */
const CHART_CHUNK_PATTERN = /(CartesianChart|LineChart|vendor-charts)-.*\.js$/;

let entryChunk: string;
let entryContent: string;
let chartsChunks: string[];

/** Semua file index-*.js di dist/assets (entry chunk). */
const entryFiles = (): string[] =>
  existsSync(ASSETS) ? readdirSync(ASSETS).filter((f) => /^index-.*\.js$/.test(f)) : [];

// Hook timeout default vitest = 10s, sedangkan build butuh ~15-30s → wajib
// timeout eksplisit di argumen kedua beforeAll, kalau tidak hook timed out
// (terbukti: "Hook timed out in 10000ms" saat dist belum ada).
beforeAll(
  () => {
    // Prekondisi build = entry chunk BENAR-BENAR ada (bukan sekadar
    // dist/index.html): build yang ter-putus di tengah (mis. hook timeout
    // membunuh execSync) bisa meninggalkan index.html tanpa dist/assets —
    // kalau hanya cek index.html, readdirSync(ASSETS) akan ENOENT.
    if (entryFiles().length === 0) {
      // dist belum ada / belum selesai dibangun (mis. CI unit-before-build) →
      // build on-demand.
      console.log('[bundleEntryGuard] entry chunk tidak ditemukan — menjalankan `npm run build` on-demand...');
      try {
        execSync('npm run build', {
          cwd: ROOT,
          stdio: 'pipe',
          encoding: 'utf8',
          timeout: 300_000,
          // Output tsc+vite bisa besar di runner yang noisy (warning/deprecation)
          // → naikkan maxBuffer dari default 1 MB agar tidak ENOBUFS.
          maxBuffer: 10 * 1024 * 1024,
          // Vitest fork berjalan dengan NODE_ENV=test; tanpa override, bundle
          // yang dihasilkan BERBEDA dari build produksi (terbukti: hash entry
          // index-CYP_7Ffw vs index-Da_El1kY) → guard bisa memvalidasi bundle
          // yang tidak mewakili CI/produksi. Paksa production agar identik
          // dengan `npm run build` di CI.
          env: { ...process.env, NODE_ENV: 'production' },
        });
      } catch (e) {
        const err = e as { stdout?: string; stderr?: string };
        throw new Error(
          `bundleEntryGuard: 'npm run build' gagal saat menyiapkan dist.\n` +
            `stdout: ${(err.stdout ?? '').slice(-1500)}\nstderr: ${(err.stderr ?? '').slice(-1500)}`,
        );
      }
    }

    const entries = entryFiles();
    if (entries.length !== 1) {
      throw new Error(
        `bundleEntryGuard: diharapkan tepat 1 entry chunk (index-*.js), ditemukan ${entries.length}: ${entries.join(', ')}`,
      );
    }
    entryChunk = entries[0];
    entryContent = readFileSync(join(ASSETS, entryChunk), 'utf8');

    // Chunk chart = (a) berisi kode recharts (marker CartesianGrid), atau
    // (b) nama wrapper chart yang dikenal — selain entry itu sendiri.
    chartsChunks = readdirSync(ASSETS).filter(
      (f) =>
        f.endsWith('.js') &&
        f !== entryChunk &&
        (CHART_CHUNK_PATTERN.test(f) || readFileSync(join(ASSETS, f), 'utf8').includes('CartesianGrid')),
    );
  },
  300_000,
);

describe('bundle entry chunk — regression guard recharts lazy', () => {
  it('recharts ter-split ke chunk terpisah (lazy split aktif)', () => {
    expect(chartsChunks.length, 'recharts harus di-split ke chunk terpisah, bukan inline di entry').toBeGreaterThan(0);
  });

  it('entry chunk TIDAK meng-inline kode recharts (regresi: lazy dihapus → inline)', () => {
    for (const marker of RECHARTS_MARKERS) {
      expect(entryContent, `entry chunk tidak boleh mengandung marker '${marker}'`).not.toContain(marker);
    }
  });

  it('entry chunk TIDAK static-import chunk chart mana pun', () => {
    for (const chunk of chartsChunks) {
      expect(entryContent, `entry chunk tidak boleh static-import '${chunk}'`).not.toContain(`from"./${chunk}`);
    }
  });

  it('entry chunk merefer chunk chart via preload (positive control — wiring lazy ada)', () => {
    const wired = chartsChunks.filter((c) => entryContent.includes(`assets/${c}`));
    expect(wired.length, 'minimal satu chunk chart harus di-wire ke entry (preload list)').toBeGreaterThan(0);
  });
});
