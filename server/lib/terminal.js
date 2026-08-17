/**
 * Terminal Presentation (Dev Console — premium `npm run dev:all`).
 *
 * PURE module — no side effects, no production imports, no I/O. Only
 * `scripts/dev-all.mjs` (the dev launcher) imports this; the production
 * pino JSON logger (`server/lib/logger.js`) is untouched, so machine-
 * readable structured logging stays byte-identical in production.
 *
 * Design (per P10.3 spec):
 *   - semantic colors: SUCCESS green · INFO cyan · WARNING yellow · ERROR red
 *   - symbols: ✓ ● ○ ! ✕ → │ ─ with ASCII fallback ([OK]/[ERR]/...) on non-TTY
 *   - centralized redaction: password/token/secret/credential/authorization/
 *     cookie/apiKey/serviceAccount NEVER rendered — even if a log object
 *     carries them (defense-in-depth beyond pino's own redact).
 */

// ---------------------------------------------------------------------------
// Colors & symbols
// ---------------------------------------------------------------------------

const ANSI = {
  reset: '\x1b[0m',
  bold: '\x1b[1m',
  dim: '\x1b[2m',
  red: '\x1b[31m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  blue: '\x1b[34m',
  magenta: '\x1b[35m',
  cyan: '\x1b[36m',
  white: '\x1b[37m',
  gray: '\x1b[90m',
};

const ANSI_KEYS = new Set(Object.keys(ANSI));

/** Detect whether ANSI escape codes are safe on the current stdout. */
export function supportsAnsi() {
  if (process.env.NO_COLOR) return false;
  if (process.env.FORCE_COLOR && process.env.FORCE_COLOR !== '0') return true;
  if (!process.stdout.isTTY) return false;
  if (process.env.TERM === 'dumb') return false;
  return true;
}

/**
 * Unicode symbol set with ASCII fallback for non-TTY / legacy terminals.
 * `{ ansi }` accepted for deterministic unit tests; defaults to supportsAnsi().
 */
export function symbols({ ansi = supportsAnsi() } = {}) {
  return ansi
    ? { ok: '✓', active: '●', inactive: '○', warn: '!', err: '✕', arrow: '→', vline: '│', hline: '─', restart: '↻' }
    : { ok: '[OK]', active: '[*]', inactive: '[ ]', warn: '[WARN]', err: '[ERR]', arrow: '->', vline: '|', hline: '-', restart: '[RS]' };
}

/**
 * Wrap text in an ANSI color. Unknown color → plain text (graceful fallback).
 */
export function color(text, name, { ansi = supportsAnsi() } = {}) {
  if (!ansi || !ANSI_KEYS.has(name)) return text;
  return `${ANSI[name]}${text}${ANSI.reset}`;
}

/** Semantic color label for a pino level (10..60). */
export function colorForLevel(level, { ansi = supportsAnsi() } = {}) {
  if (level < 20) return color('trace', 'gray', { ansi });
  if (level === 20) return color('debug', 'cyan', { ansi });
  if (level < 40) return color('info', 'blue', { ansi });
  if (level === 40) return color('warn', 'yellow', { ansi });
  return color('error', 'red', { ansi });
}

/**
 * HTTP status code with semantic color (2xx green, 3xx cyan, 4xx yellow,
 * 5xx red). ANSI off → plain code (never the literal color name).
 */
export function colorForStatus(code, { ansi = supportsAnsi() } = {}) {
  const name = code >= 500 ? 'red' : code >= 400 ? 'yellow' : code >= 300 ? 'cyan' : 'green';
  return color(String(code), name, { ansi });
}

// ---------------------------------------------------------------------------
// Redaction
// ---------------------------------------------------------------------------

/**
 * Keys (lowercased, exact) that are NEVER rendered to the terminal.
 * Deliberately conservative — a key containing any of these substrings
 * is treated as sensitive.
 */
const REDACT_SUBSTRINGS = [
  'token', 'secret', 'password', 'credential', 'authorization', 'cookie',
  'apikey', 'api_key', 'serviceaccount', 'access_token', 'refresh_token',
];

/** True if a key must never be rendered. */
export function isSensitiveKey(key) {
  const k = String(key).toLowerCase();
  return REDACT_SUBSTRINGS.some((s) => k.includes(s));
}

const REDACTED = '[redacted]';

/**
 * Mask credential-looking patterns embedded in string VALUES (defense-in-depth
 * beyond key redaction): `?authToken=...`, `key=...`, `user:pass@` URLs.
 * Key-based redaction only catches sensitive KEY names — a non-sensitive key
 * whose value embeds a credential would otherwise pass through verbatim.
 */
const CRED_PATTERNS = [
  // query string credential: ?authToken=... / &apiKey=...
  { re: /([?&](?:authToken|access_token|refresh_token|api_key|apiKey|token|key|password|secret|sig)=)[^&\s"']+/gi, rep: '$1[redacted]' },
  // URL userinfo: postgres://user:pw@host — `@` dikembalikan agar host tetap valid
  { re: /((?:https?|postgres|mysql|redis|mongodb):\/\/)[^:\s@/]+:[^@\s]+@/g, rep: '$1[redacted]@' },
];

export function redactString(text) {
  if (typeof text !== 'string') return text;
  let out = text;
  for (const { re, rep } of CRED_PATTERNS) out = out.replace(re, rep);
  return out;
}

/**
 * Deep-copy an object replacing every sensitive value with `[redacted]`.
 * Arrays, primitives, null and nested objects up to MAX_DEPTH are handled;
 * string values additionally pass through redactString.
 */
export function sanitizeLogObject(value, depth = 0, MAX_DEPTH = 8) {
  if (depth > MAX_DEPTH) return '[max-depth]';
  if (value === null || value === undefined) return value;
  if (typeof value === 'string') return redactString(value);
  if (typeof value !== 'object') return value;
  if (Array.isArray(value)) return value.map((v) => sanitizeLogObject(v, depth + 1, MAX_DEPTH));
  const out = {};
  for (const [k, v] of Object.entries(value)) {
    out[k] = isSensitiveKey(k) ? REDACTED : sanitizeLogObject(v, depth + 1, MAX_DEPTH);
  }
  return out;
}

/**
 * Render extra non-base fields of a pino entry as compact `k=v` pairs.
 * Fields are sanitized; base pino metadata (level/time/msg/pid/hostname/app)
 * is skipped. Never renders a sensitive value.
 */
export function formatExtraFields(entry, { maxPairs = 4 } = {}) {
  const BASE = new Set(['level', 'time', 'msg', 'pid', 'hostname', 'app']);
  const pairs = [];
  for (const [k, v] of Object.entries(entry)) {
    if (BASE.has(k)) continue;
    if (isSensitiveKey(k)) { pairs.push(`${k}=${REDACTED}`); continue; }
    let val = v;
    if (typeof v === 'object' && v !== null) val = JSON.stringify(sanitizeLogObject(v));
    else if (typeof v === 'string') val = v.length > 60 ? `${redactString(v).slice(0, 60)}…` : redactString(v);
    pairs.push(`${k}=${val}`);
    if (pairs.length >= maxPairs) break;
  }
  return pairs.length ? `  · ${pairs.join('  · ')}` : '';
}

// ---------------------------------------------------------------------------
// Time & request lines
// ---------------------------------------------------------------------------

/** ISO timestamp → local HH:MM:SS (deterministic, independent of locale). */
export function formatTime(iso) {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '--:--:--';
  const p = (n) => String(n).padStart(2, '0');
  return `${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`;
}

/**
 * Short human-friendly request id. Prefers the trailing hex segment so
 * `req_1699999999_a31f` → `#a31f` (never cuts into the `req_` prefix).
 */
export function shortRequestId(id) {
  if (!id) return '';
  const str = String(id);
  const hex = str.match(/[0-9a-fA-F]{4,}$/);
  return `#${(hex ? hex[0] : str).slice(-5)}`;
}

/** Quiet endpoints polled constantly by the SPA — dimmed at info level. */
export const QUIET_PATHS = ['/api/auth/get-session'];

/**
 * Decide whether a `request` pino line should be printed.
 * info level: hide quiet polling paths (still recorded in JSON/tee).
 * debug level: show everything with request id.
 */
export function shouldShowRequest(entry, { debug = false } = {}) {
  if (debug) return true;
  const p = entry.path || '';
  if (QUIET_PATHS.some((q) => p === q || p.startsWith(q + '?'))) return false;
  return true;
}

/**
 * Format a pino `request` line:
 *   19:21:11  GET  /api/admin/metrics/retention  200  101ms
 * Never renders userId/email/body/cookies — only method, path, status, ms.
 */
export function formatRequestLine(entry, { debug = false, ansi = supportsAnsi() } = {}) {
  const time = formatTime(entry.time);
  const method = String(entry.method || '?').padEnd(5);
  const path = String(entry.path || entry.route || '?');
  const status = String(entry.status || 0).padStart(3);
  const ms = `${entry.ms != null ? entry.ms : '?'}ms`;
  const statusColored = colorForStatus(Number(entry.status), { ansi });
  const tail = debug && entry.requestId ? `  ${color(shortRequestId(entry.requestId), 'gray', { ansi })}` : '';
  return `${time}  ${color(method, 'cyan', { ansi })} ${path}  ${statusColored}  ${ms}${tail}`;
}

// ---------------------------------------------------------------------------
// Pino line parsing
// ---------------------------------------------------------------------------

/** Parse a single stdout line: pino JSON → { kind:'pino', value }, else text. */
export function parsePinoLine(line) {
  const trimmed = String(line).trim();
  if (!trimmed || !trimmed.startsWith('{')) return { kind: 'text', value: trimmed };
  try {
    const value = JSON.parse(trimmed);
    if (value && typeof value === 'object' && 'msg' in value) return { kind: 'pino', value };
    return { kind: 'text', value: trimmed };
  } catch {
    return { kind: 'text', value: trimmed };
  }
}

// ---------------------------------------------------------------------------
// Status events (startup board)
// ---------------------------------------------------------------------------

/**
 * Map a pino line to a status-board update (or null).
 * Each rule returns `{ key, label, value, ok, warn }` — one or more rows.
 * Values are extracted from sanitized fields only; never credentials.
 */
export function statusEvent(entry) {
  if (!entry || typeof entry.msg !== 'string') return null;
  const msg = entry.msg;

  const rows = [];

  if (msg === 'Database client Turso siap') {
    const host = entry.database && typeof entry.database === 'object' ? entry.database.hostname : '…';
    rows.push({ key: 'turso', label: 'Turso', value: host || 'connected', ok: true });
  } else if (msg === 'TURSO_DATABASE_URL belum diisi') {
    rows.push({ key: 'turso', label: 'Turso', value: 'TURSO_DATABASE_URL belum diisi', ok: false });
  } else if (msg === 'Schema database Turso terverifikasi') {
    rows.push({ key: 'schema', label: 'Schema', value: 'VERIFIED', ok: true });
  } else if (msg === 'Warning initializing schema') {
    rows.push({ key: 'schema', label: 'Schema', value: 'warning', ok: false });
  } else if (msg === 'Error initializing schema') {
    rows.push({ key: 'schema', label: 'Schema', value: 'FAILED', ok: false });
  } else if (msg === 'Vertex AI Gemini siap') {
    const model = entry.model ? String(entry.model) : '…';
    rows.push({ key: 'vertex', label: 'Vertex AI', value: `ready · ${model}`, ok: true });
  } else if (msg === 'Vertex AI connectivity OK') {
    rows.push({ key: 'aiConn', label: 'AI Connectivity', value: 'READY', ok: true });
  } else if (msg === 'Vertex AI connectivity test gagal') {
    rows.push({ key: 'aiConn', label: 'AI Connectivity', value: 'DEGRADED', ok: false });
  } else if (msg === 'Better Auth siap dengan Google OAuth') {
    rows.push({ key: 'auth', label: 'Better Auth', value: 'READY', ok: true });
    rows.push({ key: 'oauth', label: 'Google OAuth', value: 'CONFIGURED', ok: true });
  } else if (msg === 'Alert scheduler aktif (evaluasi berkala)') {
    const interval = entry.intervalMs != null ? `${entry.intervalMs}ms` : '60s';
    rows.push({ key: 'scheduler', label: 'Alert Scheduler', value: `ACTIVE · ${interval}`, ok: true });
  } else if (msg === 'Alert scheduler dinonaktifkan (env/test server)') {
    rows.push({ key: 'scheduler', label: 'Alert Scheduler', value: 'disabled', ok: false });
  } else if (msg === 'CashFlow AI Proxy berjalan') {
    rows.push({ key: 'listening', label: 'HTTP', value: `listening · :${entry.port}`, ok: true });
    rows.push({ key: 'primaryModel', label: 'Model', value: entry.primaryModel || '…', ok: true });
    rows.push({ key: 'fallbackModel', label: 'Fallback', value: entry.fallbackModel || '…', ok: true });
    rows.push({ key: 'projectId', label: 'Project', value: entry.projectId || '…', ok: true });
    rows.push({ key: 'location', label: 'Region', value: entry.location || '…', ok: true });
  } else if (msg === 'Graceful shutdown dimulai') {
    rows.push({ key: 'shutdown', label: 'Shutdown', value: 'started', ok: true });
  } else if (msg === 'Shutdown bersih selesai') {
    rows.push({ key: 'shutdown', label: 'Shutdown', value: 'clean', ok: true });
  } else if (msg === 'Graceful shutdown timeout (10s) — force exit') {
    rows.push({ key: 'shutdown', label: 'Shutdown', value: 'TIMEOUT', ok: false });
  }

  return rows.length ? rows : null;
}

// ---------------------------------------------------------------------------
// Section & summary rendering
// ---------------------------------------------------------------------------

const SECTION_WIDTH = 62;

function rule({ ansi }) {
  const c = (text, name) => color(text, name, { ansi });
  const s = symbols({ ansi });
  const hline = s.hline.repeat(SECTION_WIDTH);
  return { c, s, hline };
}

/**
 * Box banner shared by the startup header and the READY summary (satu-satunya
 * sumber centering — tidak ada padding manual yang bisa meleset):
 *
 *   ╭────────────╮
 *   │  TITLE     │
 *   │  subtitle  │
 *   ╰────────────╯
 */
export function boxBanner(title, subtitle, { width = SECTION_WIDTH, ansi = supportsAnsi() } = {}) {
  const c = (text, name) => color(text, name, { ansi });
  const inner = width - 2;
  const center = (text, bold = false) => {
    const left = Math.max(0, Math.floor((inner - text.length) / 2));
    const right = Math.max(0, inner - text.length - left);
    const rendered = bold ? color(text, 'bold', { ansi }) : text;
    return c(`│${' '.repeat(left)}${rendered}${' '.repeat(right)}│`, 'cyan');
  };
  return [
    c(`╭${'─'.repeat(inner)}╮`, 'cyan'),
    c(`│${' '.repeat(inner)}│`, 'cyan'),
    center(title, true),
    center(subtitle),
    c(`╰${'─'.repeat(inner)}╯`, 'cyan'),
  ];
}

/**
 * Render a status section:
 *   AI
 *   ─────────────────────────────────────────────────────────
 *   ✓ Provider        Vertex AI
 *   ✓ Model           gemini-2.5-flash
 */
export function section(title, rows, { ansi = supportsAnsi() } = {}) {
  const { c, s, hline } = rule({ ansi });
  const lines = [];
  lines.push(c(title, 'bold'));
  lines.push(c(hline, 'gray'));
  for (const row of rows || []) {
    let sym;
    let colorName = 'reset';
    if (row.pending) {
      sym = c(s.inactive, 'gray'); // status belum tiba — netral, bukan warning
      colorName = 'dim';
    } else if (row.ok === false || row.warn) {
      sym = c(s.warn, 'yellow');
      colorName = 'yellow';
    } else {
      sym = c(s.ok, 'green');
    }
    const line = `  ${sym} ${String(row.label).padEnd(18)}${String(row.value)}`;
    lines.push(c(line, colorName));
  }
  return lines.join('\n');
}

/**
 * Build the READY summary block (printed once when both ports answer HTTP):
 * banner + SYSTEM/DATABASE/AI/AUTH/SCHEDULER sections + timing + URLs.
 */
export function buildReadySummary({
  frontendUrl,
  backendUrl,
  backendPort,
  elapsedSec,
  board = {},
  nodeEnv = 'development',
  ansi = supportsAnsi(),
} = {}) {
  const { c, s, hline } = rule({ ansi });
  const lines = [];

  // Banner
  lines.push(...boxBanner('CASHFLOW DEV MODE', 'AI-Powered Finance Platform', { width: SECTION_WIDTH, ansi }));
  lines.push('');

  // SYSTEM
  const sysRows = [
    { label: 'Frontend', value: frontendUrl, ok: true },
    { label: 'Backend', value: backendUrl, ok: true },
    { label: 'Environment', value: nodeEnv, ok: true },
    { label: 'Process', value: 'watch mode', ok: true },
  ];
  lines.push(section('SYSTEM', sysRows, { ansi }));
  lines.push('');

  // DATABASE
  const dbRows = [
    { label: 'Turso', value: board.turso ? String(board.turso.value) : '…', ok: board.turso ? board.turso.ok : false, pending: !board.turso },
    { label: 'Schema', value: board.schema ? String(board.schema.value) : '…', ok: board.schema ? board.schema.ok : false, pending: !board.schema },
    { label: 'Driver', value: 'libSQL', ok: true },
  ];
  lines.push(section('DATABASE', dbRows, { ansi }));
  lines.push('');

  // AI
  const aiRows = [
    { label: 'Provider', value: 'Vertex AI', ok: true },
    { label: 'Model', value: board.primaryModel ? String(board.primaryModel.value) : '…', ok: true, pending: !board.primaryModel },
    { label: 'Fallback', value: board.fallbackModel ? String(board.fallbackModel.value) : '…', ok: true, pending: !board.fallbackModel },
    { label: 'Project', value: board.projectId ? String(board.projectId.value) : '…', ok: true, pending: !board.projectId },
    { label: 'Region', value: board.location ? String(board.location.value) : '…', ok: true, pending: !board.location },
    { label: 'Connectivity', value: board.aiConn ? String(board.aiConn.value) : '…', ok: board.aiConn ? board.aiConn.ok : false, pending: !board.aiConn },
  ];
  lines.push(section('AI', aiRows, { ansi }));
  lines.push('');

  // AUTH
  const authRows = [
    { label: 'Better Auth', value: board.auth ? String(board.auth.value) : '…', ok: board.auth ? board.auth.ok : false, pending: !board.auth },
    { label: 'Google OAuth', value: board.oauth ? String(board.oauth.value) : '…', ok: board.oauth ? board.oauth.ok : false, pending: !board.oauth },
  ];
  lines.push(section('AUTH', authRows, { ansi }));
  lines.push('');

  // SCHEDULER
  const schRows = [
    { label: 'Alert Scheduler', value: board.scheduler ? String(board.scheduler.value) : '…', ok: board.scheduler ? board.scheduler.ok : false, pending: !board.scheduler },
  ];
  lines.push(section('SCHEDULER', schRows, { ansi }));
  lines.push('');

  lines.push(c(hline, 'gray'));
  lines.push(`  ${c(s.ok, 'green')} ${c('CashFlow is ready', 'bold')}`);
  lines.push(`  ${c(s.ok, 'green')} ${c(`Startup completed in ${elapsedSec.toFixed(1)}s`, 'dim')}`);
  lines.push('');
  lines.push(`  ${c('Frontend', 'dim')} → ${c(frontendUrl, 'cyan')}`);
  lines.push(`  ${c('Backend', 'dim')}  → ${c(`${backendUrl} (port ${backendPort})`, 'cyan')}`);
  lines.push('');
  lines.push(`  Press ${c('Ctrl+C', 'yellow')} to stop`);
  lines.push('');

  return lines.join('\n');
}

/** Compact block shown on backend watch-restart (banner is NOT repeated). */
export function buildRestartBlock({ ansi = supportsAnsi() } = {}) {
  const { c, s, hline } = rule({ ansi });
  return [
    c(hline, 'gray'),
    `  ${c(s.restart, 'yellow')} ${c('Backend restart detected', 'yellow')}`,
    '  Reinitializing services…',
    c(hline, 'gray'),
  ].join('\n');
}

/** Shutdown block (Ctrl+C). Honest per-item status based on exit codes. */
export function buildShutdownBlock({ clean = true, ansi = supportsAnsi() } = {}) {
  const { c, s, hline } = rule({ ansi });
  const ok = (label) => `  ${c(s.ok, 'green')} ${label}`;
  const lines = [
    c(hline, 'gray'),
    '  Shutting down CashFlow…',
    '',
    ok('Backend stopped'),
    ok('Frontend stopped'),
    '',
  ];
  if (clean) {
    lines.push(`  ${c(s.ok, 'green')} ${c('Shutdown complete', 'bold')}`);
  } else {
    lines.push(`  ${c(s.warn, 'yellow')} ${c('Shutdown completed with warnings', 'yellow')}`);
  }
  lines.push(c(hline, 'gray'));
  return lines.join('\n');
}
