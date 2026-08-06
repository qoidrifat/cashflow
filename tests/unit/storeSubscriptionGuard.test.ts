/**
 * REGRESSION GUARD — Store Subscription Isolation
 *
 * Sprint Performance (render isolation): SEMUA komponen wajib subscribe
 * Zustand via SELECTOR (atau useShallow untuk multi-slice), TIDAK boleh
 * subscribe seluruh store:
 *
 *   ❌ const { authUser } = useAuthStore();            // full subscription
 *   ✅ const authUser = useAuthStore((s) => s.authUser);
 *   ✅ const { a, b } = useAuthStore(useShallow((s) => ({ a: s.a, b: s.b })));
 *
 * Alasan: full subscription me-render ulang komponen pada SETIAP setState()
 * store — termasuk setState no-op polling auth 10 detik — yang memicu
 * render cascade seluruh tree (root cause /admin/monitoring auto-refresh).
 *
 * Juga melarang object-literal selector TANPA useShallow:
 *   ❌ useAppStore((s) => ({ a: s.a }))   // object baru tiap render → selalu re-render
 *   ✅ useAppStore(useShallow((s) => ({ a: s.a })))
 *
 * Test ini memindai src/ secara statis (strip komentar) dan GAGAL bila
 * ditemukan pola terlarang — regression guard untuk refactor mendatang.
 */
import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

const SRC_DIR = path.resolve(process.cwd(), 'src');

function listSourceFiles(dir: string): string[] {
  const out: string[] = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      out.push(...listSourceFiles(full));
    } else if (/\.(ts|tsx)$/.test(entry.name) && !entry.name.endsWith('.d.ts')) {
      out.push(full);
    }
  }
  return out;
}

/** Hapus komentar blok & baris agar pola di komentar tidak terhitung. */
function stripComments(code: string): string {
  return code
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/\/\/[^\n]*/g, '');
}

/** Full subscription: panggilan store dengan argumen KOSONG. */
const FULL_SUB_RE = /\buse(AppStore|AuthStore|SessionExpiryStore)\(\s*\)/g;

/** Object-literal selector tanpa useShallow: useStore((s) => ({ ... })). */
const RAW_OBJECT_SELECTOR_RE = /\buse(AppStore|AuthStore)\(\s*(?:[a-zA-Z_$][\w$]*)\s*=>\s*\(\s*\{/g;

function scan(): { violations: string[]; checked: number } {
  const violations: string[] = [];
  let checked = 0;
  for (const file of listSourceFiles(SRC_DIR)) {
    checked++;
    const rel = path.relative(process.cwd(), file);
    const code = stripComments(fs.readFileSync(file, 'utf8'));

    for (const m of code.matchAll(FULL_SUB_RE)) {
      const lineNo = code.slice(0, m.index).split('\n').length;
      violations.push(`${rel}:${lineNo} — FULL SUBSCRIPTION ${m[0]} (pakai selector/useShallow)`);
    }
    for (const m of code.matchAll(RAW_OBJECT_SELECTOR_RE)) {
      const lineNo = code.slice(0, m.index).split('\n').length;
      violations.push(`${rel}:${lineNo} — object-literal selector tanpa useShallow (${m[0].trim().slice(0, 60)}…)`);
    }
  }
  return { violations, checked };
}

describe('Store subscription isolation (regression guard)', () => {
  it('tidak ada full subscription useAppStore()/useAuthStore()/useSessionExpiryStore()', () => {
    const { violations, checked } = scan();
    expect(checked).toBeGreaterThan(50); // sanity: file ter-scan cukup banyak
    expect(violations, violations.join('\n')).toEqual([]);
  });
});
