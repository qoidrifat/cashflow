/**
 * CashFlow Development Server Launcher — Premium Dev Console (P10.3)
 *
 * Starts both frontend (Vite) and backend (Express) servers with a clean,
 * structured terminal experience:
 *
 *   - Backend pino JSON lines  → formatted, colored, categorized output
 *     (request lines like `19:21:11  GET  /api/health  200  4ms`, startup
 *     status events accumulated into a READY summary).
 *   - Vite output              → dim `[vite]` prefixed lines.
 *   - Watch restart            → compact `↻ Backend restart detected` block
 *     (main banner never repeated).
 *   - Shutdown (Ctrl+C)        → structured shutdown block.
 *
 * Structured logging is NOT removed: production JSON stays byte-identical
 * (this launcher only consumes stdout), and raw JSON can be teed to a file
 * via `LOG_TEE=1` (default `.dev-server-backend.log`, gitignored).
 *
 * Env:
 *   LOG_LEVEL=debug  → show every request + request id (`#a31f`) + debug lines
 *   LOG_LEVEL=info   → hide quiet SPA polling paths (get-session)
 *   LOG_TEE=1        → tee raw pino JSON lines to .dev-server-backend.log
 *
 * Run: npm run dev:all
 */

import { spawn, spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import fs from 'node:fs';
import {
  supportsAnsi, symbols, color,
  parsePinoLine, statusEvent, shouldShowRequest, formatRequestLine,
  formatExtraFields, formatTime,
  boxBanner, buildReadySummary, buildRestartBlock, buildShutdownBlock,
} from '../server/lib/terminal.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const projectRoot = path.resolve(__dirname, '..');

const ANSI = supportsAnsi();
const SYM = symbols({ ansi: ANSI });

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------

const FRONTEND_PORT = 5180;
const BACKEND_PORT = 5181;
const FRONTEND_URL = `http://localhost:${FRONTEND_PORT}`;
const BACKEND_URL = `http://localhost:${BACKEND_PORT}`;
const NODE_ENV = process.env.NODE_ENV || 'development';

const DEBUG_LEVEL = process.env.LOG_LEVEL === 'debug';

// Opt-in raw JSON tee (machine-readable structured logs during dev).
const TEE_PATH = process.env.LOG_TEE
  ? (process.env.LOG_TEE === '1' ? path.join(projectRoot, '.dev-server-backend.log') : process.env.LOG_TEE)
  : null;
// Path tee yang tidak valid TIDAK boleh menggagalkan startup launcher.
let teeFd = null;
if (TEE_PATH) {
  try {
    teeFd = fs.openSync(TEE_PATH, 'a');
  } catch {
    // `yellow` belum terdefinisi di scope ini (helpers di bawah) — inline color().
    console.log(color(`[tee] tidak bisa membuka ${TEE_PATH} — raw JSON di-skip`, 'yellow', { ansi: ANSI }));
  }
}

function teeRaw(line) {
  if (teeFd != null && line) fs.writeSync(teeFd, `${line}\n`);
}

// ---------------------------------------------------------------------------
// Line plumbing
// ---------------------------------------------------------------------------

/** Chunk → complete lines (handles partial chunks + \r progress updates). */
function createLineReader(onLine) {
  let buf = '';
  return (chunk) => {
    buf += chunk.toString();
    // Split pada \n DAN \r: progress spinner vite memakai lone-\r tanpa \n.
    const lines = buf.split(/[\r\n]+/);
    buf = lines.pop() || '';
    for (const l of lines) onLine(l);
  };
}

// ---------------------------------------------------------------------------
// Output helpers
// ---------------------------------------------------------------------------

const dim = (text) => color(text, 'dim', { ansi: ANSI });
const gray = (text) => color(text, 'gray', { ansi: ANSI });
const cyan = (text) => color(text, 'cyan', { ansi: ANSI });
const yellow = (text) => color(text, 'yellow', { ansi: ANSI });
const red = (text) => color(text, 'red', { ansi: ANSI });

function printBox(lines) {
  for (const l of lines) console.log(l);
}

// ---------------------------------------------------------------------------
// Startup status board (accumulated from backend status events)
// ---------------------------------------------------------------------------

const board = new Map(); // key -> { label, value, ok }

function applyStatusRows(rows) {
  for (const row of rows || []) board.set(row.key, row);
}

const STARTED_AT = Date.now();

// ---------------------------------------------------------------------------
// Backend stream handling
// ---------------------------------------------------------------------------

let backendBooted = false; // has the backend ever printed the listening line?

function onBackendLine(line) {
  teeRaw(line);
  const { kind, value } = parsePinoLine(line);

  if (kind === 'text') {
    if (value) console.log(dim(value));
    return;
  }

  const entry = value;

  // Startup status events → accumulate into the board, print as progress.
  const rows = statusEvent(entry);
  if (rows) {
    applyStatusRows(rows);
    const isListening = rows.some((r) => r.key === 'listening');
    if (isListening && !backendBooted) backendBooted = true;
    for (const r of rows) {
      const sym = r.ok === false ? yellow(SYM.warn) : gray(SYM.ok);
      console.log(`  ${sym} ${r.label.padEnd(18)}${r.ok === false ? yellow(String(r.value)) : dim(String(r.value))}`);
    }
    return;
  }

  // Request lines (msg === 'request').
  if (entry.msg === 'request') {
    if (!shouldShowRequest(entry, { debug: DEBUG_LEVEL })) return;
    console.log(formatRequestLine(entry, { debug: DEBUG_LEVEL, ansi: ANSI }));
    return;
  }

  // Level-based rendering for everything else.
  const level = entry.level || 30;
  const time = gray(formatTime(entry.time));
  const extra = formatExtraFields(entry);

  if (level >= 50) {
    console.log(`${time} ${red(SYM.err)} ${red(String(entry.msg))}${extra}`);
  } else if (level === 40) {
    console.log(`${time} ${yellow(SYM.warn)} ${yellow(String(entry.msg))}${extra}`);
  } else if (level <= 20) {
    if (DEBUG_LEVEL) console.log(`${time} ${gray('·')} ${gray(String(entry.msg))}${extra}`);
  } else {
    console.log(`${time} ${dim('·')} ${dim(String(entry.msg))}${extra}`);
  }
}

function onBackendStderr(line) {
  const trimmed = String(line).trim();
  // node --watch restart banner → compact block, banner not repeated.
  if (/restarting 'server\/index\.js'/i.test(trimmed) || /restarting server/i.test(trimmed)) {
    if (backendBooted) {
      printBox(buildRestartBlock({ ansi: ANSI }).split('\n'));
      board.clear();
    } else {
      console.log(dim(trimmed));
    }
    return;
  }
  if (trimmed) console.log(yellow(trimmed));
}

function onViteLine(line) {
  const trimmed = String(line).trim();
  if (!trimmed) return;
  // Keep the vite readiness line visible; dim the rest.
  const ready = /ready in|Local:|VITE v/.test(trimmed);
  console.log(ready ? cyan(`[vite] ${trimmed}`) : dim(`[vite] ${trimmed}`));
}

// ---------------------------------------------------------------------------
// Process spawning
// ---------------------------------------------------------------------------

function getSpawnArgs(name, args) {
  if (process.platform === 'win32') {
    const binPath = path.join(projectRoot, 'node_modules', '.bin', name);
    if (fs.existsSync(binPath + '.cmd')) {
      return { cmd: 'cmd.exe', cmdArgs: ['/c', binPath + '.cmd', ...args] };
    }
  }
  return { cmd: path.join(projectRoot, 'node_modules', '.bin', name), cmdArgs: args };
}

const frontendArgs = getSpawnArgs('vite', ['--port', String(FRONTEND_PORT), '--strictPort', '--host', '127.0.0.1']);
const backendArgs = { cmd: process.execPath, cmdArgs: ['--watch', 'server/index.js'] };

function startFrontend() {
  return new Promise((resolve) => {
    const proc = spawn(frontendArgs.cmd, frontendArgs.cmdArgs, {
      stdio: ['ignore', 'pipe', 'pipe'],
      cwd: projectRoot,
    });
    proc.stdout.on('data', createLineReader(onViteLine));
    proc.stderr.on('data', createLineReader(onViteLine));
    proc.on('error', (err) => console.log(red(`[vite] ${err.message}`)));
    proc.on('close', (code) => {
      if (code !== 0 && code !== null) console.log(red(`[vite] exited with code ${code}`));
    });
    setTimeout(() => resolve(proc), 1200);
  });
}

function startBackend() {
  return new Promise((resolve) => {
    const proc = spawn(backendArgs.cmd, backendArgs.cmdArgs, {
      stdio: ['ignore', 'pipe', 'pipe'],
      cwd: projectRoot,
      // PORT dipin ke BACKEND_PORT: env loader melewati var yang sudah ada,
      // jadi PORT stray dari shell (mis. 63161) akan memecah proxy Vite
      // (lihat .freebuff/run.md). Dev launcher selalu backend di :5181.
      env: { ...process.env, PORT: String(BACKEND_PORT), FORCE_COLOR: '1' },
    });
    proc.stdout.on('data', createLineReader(onBackendLine));
    proc.stderr.on('data', createLineReader(onBackendStderr));
    proc.on('error', (err) => console.log(red(`[backend] ${err.message}`)));
    proc.on('close', (code) => {
      if (code !== 0 && code !== null) console.log(red(`[backend] exited with code ${code}`));
    });
    setTimeout(() => resolve(proc), 1200);
  });
}

// ---------------------------------------------------------------------------
// Process tree kill (Windows: cmd.exe wrapper → SIGTERM tidak sampai ke
// grandchild vite/node. taskkill /T membunuh SELURUH pohon agar tidak ada
// orphan yang menahan port 5180/5181 setelah shutdown.)
// ---------------------------------------------------------------------------

function treeKill(proc) {
  if (!proc || proc.pid == null) return;
  if (process.platform === 'win32') {
    spawnSync('taskkill', ['/pid', String(proc.pid), '/T', '/F'], { stdio: 'ignore' });
  } else {
    try { proc.kill('SIGKILL'); } catch { /* sudah mati */ }
  }
}

// ---------------------------------------------------------------------------
// Readiness (HTTP probes — faithful: what actually matters is HTTP answers)
// ---------------------------------------------------------------------------

const probe = (url) =>
  fetch(url, { signal: AbortSignal.timeout(2000) })
    .then(() => true)
    .catch(() => false);

async function waitForServers() {
  const deadline = Date.now() + 60_000;
  let frontendOk = false;
  let backendOk = false;

  while (Date.now() < deadline && !(frontendOk && backendOk)) {
    const [f, b] = await Promise.all([
      frontendOk ? true : probe(FRONTEND_URL),
      backendOk ? true : probe(`${BACKEND_URL}/api/health`),
    ]);
    frontendOk = frontendOk || f;
    backendOk = backendOk || b;
    if (!(frontendOk && backendOk)) {
      await new Promise((r) => setTimeout(r, 500));
    }
  }

  return { frontendOk, backendOk };
}

// ---------------------------------------------------------------------------
// Lifecycle
// ---------------------------------------------------------------------------

async function main() {
  console.log(''); // breathing room before banner
  printBox(boxBanner('CASHFLOW', 'Development Runtime', { ansi: ANSI }));
  console.log('');
  console.log(dim(`  Environment: ${NODE_ENV}   Mode: watch`));
  console.log('');

  const [frontendProc, backendProc] = await Promise.all([startFrontend(), startBackend()]);

  const { frontendOk, backendOk } = await waitForServers();

  // Settle: event `listening` (membawa model/project/region) bisa tiba ~1s
  // SETELAH port menjawab HTTP. Tunggu sebentar (maks 6s) agar summary lengkap.
  // Schema verify TIDAK digate di sini — berjalan async (60+ round-trip Turso,
  // bisa 10s+ saat cold) → summary menampilkannya sebagai pending '…' lalu baris
  // `[OK] Schema VERIFIED` masuk live begitu selesai.
  const settleDeadline = Date.now() + 6000;
  while (Date.now() < settleDeadline && !board.has('listening')) {
    await new Promise((r) => setTimeout(r, 200));
  }

  const elapsedSec = (Date.now() - STARTED_AT) / 1000;

  if (!frontendOk || !backendOk) {
    console.log('');
    console.log(red(`  ${SYM.err} Startup incomplete (${frontendOk ? 'frontend OK' : 'frontend NOT ready'}, ${backendOk ? 'backend OK' : 'backend NOT ready'})`));
    console.log(red('  Check the logs above.'));
  }

  // One consolidated summary — banner + sections from the live status board.
  console.clear();
  printBox(buildReadySummary({
    frontendUrl: FRONTEND_URL,
    backendUrl: BACKEND_URL,
    backendPort: BACKEND_PORT,
    elapsedSec,
    board: Object.fromEntries(board),
    nodeEnv: NODE_ENV,
    ansi: ANSI,
  }).split('\n'));

  // Exit code non-zero SEBELUM shutdown dimulai = crash (mis. EADDRINUSE).
  // Exit saat shutdown (SIGTERM/taskkill) TIDAK dihitung — pada Windows
  // force-kill selalu menutup dengan code non-zero, normal shutdown tetap ✓.
  const crashed = {};
  let shuttingDown = false;
  const track = (name) => (code) => {
    if (!shuttingDown && code !== 0 && code !== null) crashed[name] = code;
  };

  frontendProc.on('close', track('frontend'));
  backendProc.on('close', track('backend'));

  const shutdown = (signal) => {
    shuttingDown = true;
    console.log('');
    try { frontendProc.kill('SIGTERM'); } catch { /* noop */ }
    try { backendProc.kill('SIGTERM'); } catch { /* noop */ }
    setTimeout(() => {
      // Windows: pastikan tidak ada orphan (vite/backend) yang menahan port.
      treeKill(frontendProc);
      treeKill(backendProc);
      const clean = !crashed.frontend && !crashed.backend;
      printBox(buildShutdownBlock({ clean, ansi: ANSI }).split('\n'));
      if (teeFd != null) fs.closeSync(teeFd);
      process.exit(0);
    }, 1200);
  };

  process.on('SIGINT', () => shutdown('SIGINT'));
  process.on('SIGTERM', () => shutdown('SIGTERM'));
}

main().catch((err) => {
  console.error(red(`Fatal error: ${err.message}`));
  process.exit(1);
});
