/**
 * Unit test: server/lib/terminal.js (P10.3 — Premium Dev Console formatter).
 *
 * MURNI tanpa I/O/DB: redaksi sentral, warna semantik, format request line,
 * parser pino, filter quiet path, fallback ASCII, mapping status event,
 * serta blok summary/restart/shutdown. Semua render memakai opsi `ansi`
 * eksplisit agar deterministik di CI (tidak bergantung TTY).
 */
import { describe, it, expect } from 'vitest';
import {
  symbols, color, colorForStatus, colorForLevel,
  isSensitiveKey, sanitizeLogObject, redactString, formatExtraFields,
  formatTime, shortRequestId, QUIET_PATHS, shouldShowRequest,
  formatRequestLine, parsePinoLine, statusEvent,
  boxBanner, section, buildReadySummary, buildRestartBlock, buildShutdownBlock,
} from '../../server/lib/terminal.js';

const ISO = '2026-08-07T12:05:09.000Z';
const localTime = new Date(ISO);
const p = (n) => String(n).padStart(2, '0');
const expectedTime = `${p(localTime.getHours())}:${p(localTime.getMinutes())}:${p(localTime.getSeconds())}`;

// ---------------------------------------------------------------------------
// Redaction (P10.3 §22)
// ---------------------------------------------------------------------------

describe('isSensitiveKey / sanitizeLogObject — redaksi sentral', () => {
  it('kunci sensitif dikenali (substring lowercase)', () => {
    for (const k of ['token', 'secret', 'password', 'authorization', 'cookie', 'apiKey', 'api_key', 'accessToken', 'refreshToken', 'serviceAccount', 'authToken', 'GOOGLE_APPLICATION_CREDENTIALS']) {
      expect(isSensitiveKey(k)).toBe(true);
    }
  });

  it('kunci aman TIDAK ikut ter-redaksi', () => {
    for (const k of ['model', 'port', 'path', 'status', 'ms', 'requestId', 'intervalMs', 'primaryModel', 'projectId', 'location', 'hostname', 'database', 'baseURL']) {
      expect(isSensitiveKey(k)).toBe(false);
    }
  });

  it('nilai sensitif di kedalaman mana pun → [redacted]', () => {
    const out = sanitizeLogObject({
      password: 'pwd1', token: 'tok2', secret: 'sec3',
      authorization: 'Bearer abc', cookie: 'a=b', apiKey: 'key5',
      accessToken: 'at6', refreshToken: 'rt7', serviceAccount: '{}',
      nested: { authToken: 'deep', keep: 42 },
      list: [{ password: 'listpwd' }],
    });
    const json = JSON.stringify(out);
    expect(json).not.toContain('pwd1');
    expect(json).not.toContain('tok2');
    expect(json).not.toContain('sec3');
    expect(json).not.toContain('Bearer abc');
    expect(json).not.toContain('key5');
    expect(json).not.toContain('deep');
    expect(json).not.toContain('listpwd');
    expect(json).toContain('[redacted]');
    expect(out.nested.keep).toBe(42);
    expect(out.nested.authToken).toBe('[redacted]');
  });

  it('redactString: kredensial tertanam di NILAI string ikut ditutup (bukan hanya kunci)', () => {
    expect(redactString('https://db.turso.io?authToken=abc123&x=1')).toBe('https://db.turso.io?authToken=[redacted]&x=1');
    expect(redactString('dsn=postgres://user:pw@host:5432/db')).toBe('dsn=postgres://[redacted]@host:5432/db');
    expect(redactString('?apiKey=zzz&token=ttt')).toBe('?apiKey=[redacted]&token=[redacted]');
    const out = sanitizeLogObject({ url: 'https://x?authToken=abc123' });
    expect(out.url).not.toContain('abc123');
    expect(out.url).toContain('[redacted]');
  });

  it('nilai aman lolos tanpa perubahan', () => {
    const out = sanitizeLogObject({ model: 'gemini-2.5-flash', port: 5181, path: '/api/health' });
    expect(out).toEqual({ model: 'gemini-2.5-flash', port: 5181, path: '/api/health' });
  });

  it('formatExtraFields: password → [redacted], objek dibungkus JSON, base fields dibuang', () => {
    const out = formatExtraFields({
      level: 30, time: ISO, msg: 'x', app: 'cashflow-server', pid: 1, hostname: 'h',
      feature: 'http', password: 'p', extra: { a: 1 },
    });
    expect(out).toContain('feature=http');
    expect(out).toContain('password=[redacted]');
    expect(out).toContain('extra={"a":1}');
    expect(out).not.toContain('level=');
    expect(out).not.toContain('cashflow-server');
  });
});

// ---------------------------------------------------------------------------
// Colors & symbols
// ---------------------------------------------------------------------------

describe('color / colorForStatus / symbols — warna semantik & fallback', () => {
  it('color: ansi aktif → escape code; non-ansi → teks polos; warna tak dikenal → polos', () => {
    expect(color('x', 'green', { ansi: true })).toBe('\x1b[32mx\x1b[0m');
    expect(color('x', 'green', { ansi: false })).toBe('x');
    expect(color('x', 'hotpink', { ansi: true })).toBe('x');
  });

  it('colorForStatus: 2xx hijau, 3xx cyan, 4xx kuning, 5xx merah', () => {
    expect(colorForStatus(200, { ansi: true })).toBe('\x1b[32m200\x1b[0m');
    expect(colorForStatus(302, { ansi: true })).toContain('\x1b[36m');
    expect(colorForStatus(404, { ansi: true })).toContain('\x1b[33m');
    expect(colorForStatus(500, { ansi: true })).toContain('\x1b[31m');
    // ansi off → kode status polos, bukan nama warna
    expect(colorForStatus(200, { ansi: false })).toBe('200');
  });

  it('colorForLevel: trace/debug/info/warn/error — debug TIDAK tertelan branch trace', () => {
    expect(colorForLevel(10, { ansi: true })).toBe('\x1b[90mtrace\x1b[0m');
    expect(colorForLevel(20, { ansi: true })).toBe('\x1b[36mdebug\x1b[0m');
    expect(colorForLevel(30, { ansi: true })).toBe('\x1b[34minfo\x1b[0m');
    expect(colorForLevel(40, { ansi: true })).toBe('\x1b[33mwarn\x1b[0m');
    expect(colorForLevel(50, { ansi: true })).toBe('\x1b[31merror\x1b[0m');
    expect(colorForLevel(20, { ansi: false })).toBe('debug');
  });

  it('symbols: unicode vs ASCII fallback', () => {
    expect(symbols({ ansi: true }).ok).toBe('✓');
    expect(symbols({ ansi: true }).err).toBe('✕');
    expect(symbols({ ansi: false }).ok).toBe('[OK]');
    expect(symbols({ ansi: false }).err).toBe('[ERR]');
    expect(symbols({ ansi: false }).warn).toBe('[WARN]');
  });
});

// ---------------------------------------------------------------------------
// Time & request lines (P10.3 §12-13)
// ---------------------------------------------------------------------------

describe('formatTime / shortRequestId / formatRequestLine', () => {
  it('formatTime: ISO → HH:MM:SS lokal; input invalid → --:--:--', () => {
    expect(formatTime(ISO)).toBe(expectedTime);
    expect(formatTime('bogus')).toBe('--:--:--');
  });

  it('shortRequestId: req_...abcde → #abcde (5 char terakhir)', () => {
    expect(shortRequestId('req_1_abcdef')).toBe('#bcdef');
    expect(shortRequestId('req_1_a31f')).toBe('#a31f');
    expect(shortRequestId('req_1699999999_ab12cd34')).toBe('#2cd34');
    expect(shortRequestId('')).toBe('');
  });

  it('formatRequestLine: time · method · path · status · ms; TANPA userId/email', () => {
    const line = formatRequestLine({
      time: ISO, method: 'GET', path: '/api/health', status: 200, ms: 4,
      userId: 'u-secret', email: 'x@y.test',
    }, { ansi: false });
    expect(line.startsWith(`${expectedTime}  `)).toBe(true);
    expect(line).toContain('GET');
    expect(line).toContain('/api/health');
    expect(line).toContain('200');
    expect(line).toContain('4ms');
    expect(line).not.toContain('u-secret');
    expect(line).not.toContain('x@y.test');
    expect(line).not.toContain('req_');
  });

  it('formatRequestLine: status 500 merah; debug menambahkan short request id', () => {
    expect(formatRequestLine({ time: ISO, method: 'POST', path: '/x', status: 500, ms: 92 }, { ansi: true })).toContain('\x1b[31m');
    const dbg = formatRequestLine({ time: ISO, method: 'GET', path: '/x', status: 200, ms: 1, requestId: 'req_1_a31f' }, { ansi: false, debug: true });
    expect(dbg).toContain('#a31f');
  });

  it('shouldShowRequest: quiet path (get-session) disembunyikan di info, tampil di debug', () => {
    expect(QUIET_PATHS).toContain('/api/auth/get-session');
    expect(shouldShowRequest({ path: '/api/auth/get-session' }, { debug: false })).toBe(false);
    expect(shouldShowRequest({ path: '/api/auth/get-session' }, { debug: true })).toBe(true);
    expect(shouldShowRequest({ path: '/api/transactions' }, { debug: false })).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Pino parsing
// ---------------------------------------------------------------------------

describe('parsePinoLine — line stdout backend', () => {
  it('pino JSON dengan msg → kind pino', () => {
    const { kind, value } = parsePinoLine('{"level":30,"time":"2026-08-07T12:05:09.000Z","msg":"request","path":"/api/health","status":200}');
    expect(kind).toBe('pino');
    expect(value.msg).toBe('request');
    expect(value.status).toBe(200);
  });

  it('teks polos → kind text', () => {
    expect(parsePinoLine('  VITE v5.3.1 ready in 500 ms').kind).toBe('text');
    expect(parsePinoLine('').kind).toBe('text');
  });

  it('JSON tanpa msg / JSON invalid → kind text (tidak pernah crash)', () => {
    expect(parsePinoLine('{"a":1}').kind).toBe('text');
    expect(parsePinoLine('{invalid').kind).toBe('text');
  });
});

// ---------------------------------------------------------------------------
// Status events → board (P10.3 §7-10)
// ---------------------------------------------------------------------------

describe('statusEvent — mapping startup ke board', () => {
  it('Turso: hanya hostname yang diekstrak (bukan URL/token)', () => {
    const rows = statusEvent({ msg: 'Database client Turso siap', database: { hostname: 'db.example.turso.io', port: 443 } });
    expect(rows).not.toBeNull();
    expect(rows[0].key).toBe('turso');
    expect(rows[0].ok).toBe(true);
    expect(rows[0].value).toBe('db.example.turso.io');
    expect(JSON.stringify(rows)).not.toContain('token');
    expect(JSON.stringify(rows)).not.toContain('auth');
  });

  it('schema / vertex / connectivity / auth / scheduler / listening', () => {
    expect(statusEvent({ msg: 'Schema database Turso terverifikasi' })[0]).toMatchObject({ key: 'schema', value: 'VERIFIED', ok: true });
    expect(statusEvent({ msg: 'Warning initializing schema' })[0].ok).toBe(false);
    expect(statusEvent({ msg: 'Vertex AI Gemini siap', model: 'gemini-2.5-flash' })[0]).toMatchObject({ key: 'vertex', ok: true });
    expect(statusEvent({ msg: 'Vertex AI connectivity OK', model: 'x' })[0]).toMatchObject({ key: 'aiConn', value: 'READY', ok: true });
    expect(statusEvent({ msg: 'Vertex AI connectivity test gagal' })[0].ok).toBe(false);

    const auth = statusEvent({ msg: 'Better Auth siap dengan Google OAuth' });
    expect(auth.map((r) => r.key)).toEqual(['auth', 'oauth']);
    expect(auth[0]).toMatchObject({ value: 'READY', ok: true });
    expect(auth[1]).toMatchObject({ value: 'CONFIGURED', ok: true });

    const sched = statusEvent({ msg: 'Alert scheduler aktif (evaluasi berkala)', intervalMs: 60000 });
    expect(sched[0]).toMatchObject({ key: 'scheduler', ok: true });
    expect(String(sched[0].value)).toContain('60000ms');

    const listen = statusEvent({ msg: 'CashFlow AI Proxy berjalan', port: 5181, primaryModel: 'gemini-2.5-flash', fallbackModel: 'gemini-2.5-flash-lite', projectId: 'proj-x', location: 'us-central1' });
    expect(listen.map((r) => r.key)).toEqual(['listening', 'primaryModel', 'fallbackModel', 'projectId', 'location']);
    expect(listen[1].value).toBe('gemini-2.5-flash');
  });

  it('msg tidak dikenal → null (tidak crash)', () => {
    expect(statusEvent({ msg: 'random log line' })).toBeNull();
    expect(statusEvent(null)).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Sections & blocks
// ---------------------------------------------------------------------------

describe('boxBanner / section / buildReadySummary / buildRestartBlock / buildShutdownBlock', () => {
  it('boxBanner: judul & subjudul ter-center dalam lebar tetap', () => {
    const lines = boxBanner('CASHFLOW', 'Development Runtime', { width: 30, ansi: false });
    expect(lines[0]).toBe('╭────────────────────────────╮');
    expect(lines[2]).toBe('│          CASHFLOW          │');
    expect(lines[3]).toBe('│    Development Runtime     │');
    expect(lines[4]).toBe('╰────────────────────────────╯');
    expect(lines[2].length).toBe(lines[0].length);
  });

  it('section: label rapi + simbol status; ok:false → warning; pending → netral', () => {
    const out = section('AI', [
      { label: 'Provider', value: 'Vertex AI', ok: true },
      { label: 'Model', value: 'gemini-2.5-flash', ok: true },
      { label: 'Connectivity', value: 'DEGRADED', ok: false },
      { label: 'Project', value: '…', pending: true },
    ], { ansi: false });
    expect(out).toContain('AI');
    expect(out).toContain('Provider');
    expect(out).toContain('Vertex AI');
    expect(out).toContain('[OK]');
    expect(out).toContain('[WARN]');
    expect(out).toContain('DEGRADED');
    expect(out).toContain('[ ]'); // pending → simbol inactive, bukan warning
    expect(out).not.toContain('[WARN] Project');
  });

  it('buildReadySummary: semua seksi + timing + URL; non-ansi → tanpa escape code', () => {
    const out = buildReadySummary({
      frontendUrl: 'http://localhost:5180',
      backendUrl: 'http://localhost:5181',
      backendPort: 5181,
      elapsedSec: 2.8,
      board: {
        turso: { value: 'db.example.turso.io', ok: true },
        schema: { value: 'VERIFIED', ok: true },
        primaryModel: { value: 'gemini-2.5-flash', ok: true },
        fallbackModel: { value: 'gemini-2.5-flash-lite', ok: true },
        projectId: { value: 'proj-x', ok: true },
        location: { value: 'us-central1', ok: true },
        aiConn: { value: 'READY', ok: true },
        auth: { value: 'READY', ok: true },
        oauth: { value: 'CONFIGURED', ok: true },
        scheduler: { value: 'ACTIVE · 60000ms', ok: true },
      },
      nodeEnv: 'development',
      ansi: false,
    });
    expect(out).toContain('CASHFLOW DEV MODE');
    expect(out).toContain('http://localhost:5180');
    expect(out).toContain('http://localhost:5181');
    expect(out).toContain('Vertex AI');
    expect(out).toContain('gemini-2.5-flash');
    expect(out).toContain('libSQL');
    expect(out).toContain('Startup completed in 2.8s');
    expect(out).toContain('Ctrl+C');
    expect(out).not.toContain('\x1b[');
    expect(out).not.toContain('token');
    expect(out).not.toContain('secret');
  });

  it('buildRestartBlock: banner utama tidak diulang, hanya blok restart', () => {
    const out = buildRestartBlock({ ansi: false });
    expect(out).toContain('restart');
    expect(out).not.toContain('CASHFLOW DEV MODE');
  });

  it('buildShutdownBlock: clean vs warning', () => {
    expect(buildShutdownBlock({ clean: true, ansi: false })).toContain('Shutdown complete');
    expect(buildShutdownBlock({ clean: false, ansi: false })).toContain('Shutdown completed with warnings');
    expect(buildShutdownBlock({ clean: true, ansi: false })).not.toContain('\x1b[');
  });
});
