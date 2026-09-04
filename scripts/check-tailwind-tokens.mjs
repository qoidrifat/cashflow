#!/usr/bin/env node
/**
 * Tailwind token guard — deteksi dini regresi ala P2.1 & bug audit 2026-09-04
 * (HIGH-V1: `bg-app-card` dipakai 30+ lokasi tapi token `app.card` tidak ada →
 * class senyap tidak di-generate, elemen render tanpa background).
 *
 * Mekanisme bug: Tailwind membuang class apa yang tidak resolve di theme
 * TANPA error. Guard ini mem-parse tailwind.config.js lalu memvalidasi setiap
 * pemakaian `app-<token>` di src/ terhadap daftar token yang benar-benar ada.
 *
 * Penggunaan:
 *   node scripts/check-tailwind-tokens.mjs   # exit 1 bila ada token hantu
 *   npm run lint                             # tsc + typography-lint + guard ini
 */
import fs from 'node:fs';
import path from 'node:path';

const ROOT = process.cwd();
const CONFIG = path.join(ROOT, 'tailwind.config.js');
const SRC = path.join(ROOT, 'src');

/** Parse colors.app keys dari tailwind.config.js tanpa eval. */
function extractAppTokens(configText) {
  const match = /app:\s*\{([\s\S]*?)\n\s{8}\}/.exec(configText);
  if (!match) return [];
  const tokens = [];
  for (const line of match[1].split('\n')) {
    const keyMatch = /^\s*([a-zA-Z][\w-]*):/.exec(line);
    if (keyMatch) tokens.push(keyMatch[1]);
  }
  return tokens;
}

function walk(dir, out = []) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(full, out);
    else if (/\.(tsx?|jsx?)$/.test(entry.name)) out.push(full);
  }
  return out;
}

const configText = fs.readFileSync(CONFIG, 'utf8');
const appTokens = extractAppTokens(configText);
if (appTokens.length === 0) {
  console.error('[check-tailwind-tokens] ⛔ Tidak bisa parse colors.app dari tailwind.config.js');
  process.exit(1);
}
const tokenSet = new Set(appTokens);

// Pemakaian valid: prefiks utility (bg-/text-/border-/from-/via-/to-/ring-/
// fill-/stroke-/divide-/shadow-/outline-/decoration-/caret-/accent-) diikuti
// `app-<token>` dengan batas non-[\w-].
const RE_APP = /(?:bg|text|border|from|via|to|ring|fill|stroke|divide|shadow|outline|decoration|caret|accent|placeholder)-app-([\w-]+)/g;

const violations = [];
for (const file of walk(SRC)) {
  const text = fs.readFileSync(file, 'utf8');
  const rel = path.relative(ROOT, file);
  for (const match of text.matchAll(RE_APP)) {
    const token = match[1];
    if (!tokenSet.has(token)) {
      const line = text.slice(0, match.index).split('\n').length;
      violations.push({ file: rel, line, full: match[0], token });
    }
  }
}

if (violations.length > 0) {
  console.error(`[check-tailwind-tokens] ⛔ ${violations.length} pemakaian token app-* TIDAK ada di tailwind.config.js (class akan senyap tidak di-generate):\n`);
  for (const v of violations) {
    console.error(`  ${v.file}:${v.line}  "${v.full}"  → token "app.${v.token}" tidak ada. Token valid: ${appTokens.join(', ')}`);
  }
  console.error('\nPerbaiki: tambahkan token ke tailwind.config.js colors.app + CSS var di globals.css (:root dan .dark), ATAU ganti ke token yang valid.');
  process.exit(1);
}

console.log(`[check-tailwind-tokens] ✓ ${appTokens.length} token app-* valid: ${appTokens.join(', ')}`);
