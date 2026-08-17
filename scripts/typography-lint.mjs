#!/usr/bin/env node
/**
 * Typography lint guard — mengunci floor kebijakan §6.3
 * (docs/ui/DESIGN_TOKENS_AND_CONTRAST.md).
 *
 * Aturan yang ditegakkan:
 *   1. text-[9px]            → DILARANG di mana pun (semua pemakaian P2.2
 *                              dinaikkan ke ≥10px). Tanpa pengecualian.
 *   2. text-[10px]           → hanya boleh pada elemen NON-interaktif
 *                              (meta mikro non-esensial). DITOLAK pada elemen
 *                              interaktif: button/a/Link/summary/select/
 *                              option/th/thead/nav/input/textarea (tag JSX,
 *                              termasuk motion.button dll.) atau className
 *                              dengan affordance klik (hover:/cursor-pointer).
 *
 * Heuristik (bukan parser JSX penuh): untuk tiap kemunculan, telusuri mundur
 * ke tag pembuka JSX terdekat sebelum className; tag bernama terakhir (dot
 * segment, mis. motion.button → button) dicek ke set interaktif. `hover:` /
 * `cursor-pointer` pada baris yang sama dianggap affordance interaktif.
 * Batasan yang didokumentasikan: `<` di dalam string atribut (mis.
 * aria-label="x < y") bisa menghasilkan tag palsu — jarang dan hanya berisiko
 * false-negative, bukan false-positive.
 *
 * Penggunaan:
 *   node scripts/typography-lint.mjs          # exit 0 jika bersih
 *   npm run lint                              # tsc + guard ini
 */
import fs from 'node:fs';
import path from 'node:path';

const INTERACTIVE_TAGS = new Set([
  'button', 'a', 'link', 'summary', 'select', 'option',
  'th', 'thead', 'nav', 'input', 'textarea',
]);

const SRC = path.join(process.cwd(), 'src');
// P2.3 — text-meta = token semantic 10px (tailwind.config fontSize). Dianggap
// setara text-[10px]: HANYA meta non-interaktif. Guard mencegah token baru
// menjadi celah (tombol text-meta lolos tanpa pengecekan).
const RE = /text-\[(9|10)px\]|text-meta(?![\w-])/g;

function walk(dir, out = []) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(full, out);
    else if (entry.name.endsWith('.tsx') || entry.name.endsWith('.ts')) out.push(full);
  }
  return out;
}

/** Tag JSX pembuka terdekat sebelum absIndex (mengabaikan </, <!--, string). */
function nearestOpeningTag(text, absIndex) {
  let i = absIndex;
  while (i >= 0) {
    const lt = text.lastIndexOf('<', i);
    if (lt < 0) return null;
    const next = text[lt + 1];
    // Bukan tag pembuka: </ (closing), <!-- (komentar), <div expr, dll.
    if (next && /[A-Za-z]/.test(next)) {
      // Lewati `<` di dalam string atribut (diapit tanda kutip).
      const prev = text[lt - 1];
      if (prev === '"' || prev === "'") { i = lt - 1; continue; }
      const m = /^[A-Za-z][\w.]*/.exec(text.slice(lt + 1));
      if (m) return m[0];
    }
    i = lt - 1;
  }
  return null;
}

/** Elemen pemilik className = tag pembuka terdekat sebelum match 10px. */
function isInteractiveElement(text, absIndex) {
  const tag = nearestOpeningTag(text, absIndex);
  if (!tag) return false;
  const last = tag.split('.').pop().toLowerCase();
  return INTERACTIVE_TAGS.has(last);
}

/** Affordance interaktif pada baris yang sama dengan className. */
function hasAffordance(line) {
  return /\bhover:|cursor-pointer|cursor:\s*pointer/.test(line);
}

function main() {
  const files = walk(SRC);
  const violations = [];
  for (const file of files) {
    const text = fs.readFileSync(file, 'utf8');
    const lines = text.split('\n');
    let offset = 0;
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      RE.lastIndex = 0;
      let m;
      while ((m = RE.exec(line)) !== null) {
        const abs = offset + m.index;
        const rel = file.slice(process.cwd().length + 1).replace(/\\/g, '/');
        if (m[1] === '9') {
          violations.push(`${rel}:${i + 1}: text-[9px] dilarang (§6.3) — naikkan ke ≥10px (elemen interaktif: ≥11px)`);
        } else if (isInteractiveElement(text, abs) || hasAffordance(line)) {
          // m[0]: 'text-[10px]' atau 'text-meta' — keduanya 10px, non-interaktif only.
          violations.push(`${rel}:${i + 1}: ${m[0]} pada elemen interaktif (§6.3) — minimum 11px (pakai text-label)`);
        }
      }
      offset += line.length + 1;
    }
  }
  if (violations.length > 0) {
    console.error(`\n[typography-lint] ${violations.length} pelanggaran floor §6.3:\n`);
    for (const v of violations) console.error(`  ${v}`);
    console.error(`\nAturan: 9px dilarang · 10px hanya meta non-interaktif · interaktif/nav/table ≥11px.`);
    process.exit(1);
  }
  console.log('[typography-lint] OK — tidak ada text-[9px] dan tidak ada text-[10px] pada elemen interaktif.');
}

main();
