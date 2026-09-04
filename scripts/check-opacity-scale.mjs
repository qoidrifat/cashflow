#!/usr/bin/env node
/**
 * Opacity scale guard — deteksi dini regresi ala P2.1 & bug audit 2026-09-04
 * (HIGH-V2: `bg-app-elevated/78` dipakai di Header/Sidebar/BottomNav tapi
 * opacity `78` tidak terdaftar di theme.extend.opacity → class senyap tidak
 * di-generate → chrome layout transparan).
 *
 * Mekanisme bug: Tailwind pluginUtils (lib/util/pluginUtils.js:159-162) me-
 * return undefined bila alpha modifier tidak ada di theme.opacity — silent
 * drop, tidak ada error build. Guard ini mem-parse skala opacity dari
 * tailwind.config.js lalu memvalidasi SEMUA modifier `/N` di src/ terhadap
 * skala + kelipatan 5 default Tailwind.
 *
 * Penggunaan:
 *   node scripts/check-opacity-scale.mjs     # exit 1 bila ada modifier hantu
 *   npm run lint                             # tsc + typography-lint + guard ini
 */
import fs from 'node:fs';
import path from 'node:path';

const ROOT = process.cwd();
const CONFIG = path.join(ROOT, 'tailwind.config.js');
const SRC = path.join(ROOT, 'src');

/** Parse theme.extend.opacity keys (angka) dari tailwind.config.js tanpa eval. */
function extractOpacityKeys(configText) {
  const match = /opacity:\s*\{([\s\S]*?)\n\s{6}\},/.exec(configText);
  if (!match) return [];
  const keys = new Set();
  for (const line of match[1].split('\n')) {
    const keyMatch = /^\s*(\d+):/.exec(line);
    if (keyMatch) keys.add(Number(keyMatch[1]));
  }
  return keys;
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
const customOpacity = extractOpacityKeys(configText);
// Skala default Tailwind 3 = kelipatan 5 (0–100) + nilai fraksional khusus.
const defaultOpacity = new Set(
  Array.from({ length: 21 }, (_, i) => i * 5),
);
const validOpacity = new Set([...defaultOpacity, ...customOpacity]);

// Modifier opacity dalam className: hanya utility yang punya alpha modifier
// (bg/text/border/gradient/ring/shadow/fill/stroke/dll) diikuti `/N`.
// EKSKLUSI otomatis: translate-x-1/2, inset-1/3, w-2/3, aspect-video, dsb.
// (fraksi dimension) — pola N/M di sana BUKAN opacity, regex hanya menerima
// prefiks utility color/alpha di atas.
const RE_MODIFIER = /((?:bg|text|border|from|via|to|ring|divide|shadow|stroke|fill|accent|caret|placeholder|outline|decoration)-[\w[\]#.%-]+)\/(\d{1,3})(?![\w.%])/g;
const violations = [];

for (const file of walk(SRC)) {
  const text = fs.readFileSync(file, 'utf8');
  const rel = path.relative(ROOT, file);
  for (const match of text.matchAll(RE_MODIFIER)) {
    const n = Number(match[2]);
    if (!validOpacity.has(n)) {
      const line = text.slice(0, match.index).split('\n').length;
      violations.push({ file: rel, line, full: match[0], n });
    }
  }
}

if (violations.length > 0) {
  console.error(`[check-opacity-scale] ⛔ ${violations.length} modifier opacity TIDAK ada di skala Tailwind (class akan senyap tidak di-generate):\n`);
  for (const v of violations) {
    console.error(`  ${v.file}:${v.line}  "${v.full}"  → /${v.n} tidak valid. Custom terdaftar: ${[...customOpacity].join(', ') || '(kosong)'}. Default kelipatan 5.`);
  }
  console.error('\nPerbaiki: daftarkan ke theme.extend.opacity di tailwind.config.js, ATAU ganti ke nilai skala (kelipatan 5 / custom terdaftar).');
  process.exit(1);
}

console.log(`[check-opacity-scale] ✓ skala opacity aman — custom: ${[...customOpacity].join(', ') || '(kosong)'} + default kelipatan 5`);
