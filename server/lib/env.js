/**
 * Early Environment Loader — WAJIB di-import PALING PERTAMA di server/index.js.
 *
 * Masalah yang diperbaiki (root cause, bukti smoke test staging 2026-08-06):
 * ESM mengevaluasi import secara depth-first sesuai urutan deklarasi source.
 * Sebelumnya dotenv.config() + loadEnvFile() dipanggil di top-level index.js —
 * SETELAH seluruh module lain (transactionRoutes → fraudDetectionService,
 * metricsConfig, auth) dievaluasi. Konstanta module-scope yang membaca
 * process.env (mis. `FRAUD_AI_SCORING_ENABLED === 'true'`, `USD_TO_IDR`)
 * dievaluasi SAAT module dibaca → nilainya selalu default/kosong, walau
 * server/.env berisi nilai yang benar.
 *
 * Modul ini meng-load env SEDINI mungkin (import pertama → dievaluasi pertama),
 * sehingga seluruh konstanta module-scope di modul lain melihat nilai nyata.
 *
 * Catatan: tanpa import ini, beberapa env TIDAK pernah terbaca saat boot:
 *   - FRAUD_AI_SCORING_ENABLED=true  → tetap false (L2 tidak pernah jalan)
 *   - USD_TO_IDR                     → selalu 16000 (cost dashboard salah)
 *   - BETTER_AUTH_SECRET             → selalu fallback development
 */
import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import dotenv from 'dotenv';

const __filename = fileURLToPath(import.meta.url);
// Modul ini berada di server/lib/ — naik 1 level ke server/, 2 level ke root.
const __dirname = path.dirname(__filename);
const SERVER_DIR = path.resolve(__dirname, '..');
const ROOT_DIR = path.resolve(__dirname, '..', '..');

// 1) dotenv — tidak menimpa env proses yang sudah ada (override default false).
//    quiet: true — supresi pesan "◇ injected env (N)" dotenv v17 yang mencemari
//    stream log JSON terstruktur (logger pino-style; parser log prod sensitif).
dotenv.config({ path: path.resolve(SERVER_DIR, '.env'), quiet: true });
dotenv.config({ path: path.resolve(ROOT_DIR, '.env.local'), quiet: true });
dotenv.config({ quiet: true });

// 2) Fallback parser manual — mendukung nilai yang tidak tertangani dotenv
//    (mis. trailing backslash pada path Windows). Idempoten: tidak menimpa.
function loadEnvFile(filePath) {
  if (!fs.existsSync(filePath)) return;

  const lines = fs.readFileSync(filePath, 'utf8').split(/\r?\n/);

  for (const line of lines) {
    const trimmed = line.trim();

    if (!trimmed || trimmed.startsWith('#') || !trimmed.includes('=')) {
      continue;
    }

    const separatorIndex = trimmed.indexOf('=');
    const key = trimmed.slice(0, separatorIndex).trim();
    const value = trimmed
      .slice(separatorIndex + 1)
      .trim()
      .replace(/^["']|["']$/g, '');

    if (key && process.env[key] === undefined) {
      process.env[key] = value;
    }
  }
}

loadEnvFile(path.resolve(SERVER_DIR, '.env'));
loadEnvFile(path.resolve(ROOT_DIR, '.env.local'));
