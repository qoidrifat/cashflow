/**
 * CashFlow Development Server Launcher
 *
 * Starts both frontend (Vite) and backend (Express) servers with improved
 * output formatting, colored prefixes, and startup table display.
 *
 * Features:
 * - Colored output prefixes for easy identification
 * - Formatted startup table with service status
 * - Clear error formatting
 * - Graceful shutdown handling
 *
 * Run: node scripts/dev-all.mjs
 */

import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import fs from 'node:fs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const projectRoot = path.resolve(__dirname, '..');

function getSpawnArgs(name, args) {
  if (process.platform === 'win32') {
    const binPath = path.join(projectRoot, 'node_modules', '.bin', name);
    if (fs.existsSync(binPath + '.cmd')) {
      return { cmd: 'cmd.exe', cmdArgs: ['/c', binPath + '.cmd', ...args] };
    }
  }
  return { cmd: path.join(projectRoot, 'node_modules', '.bin', name), cmdArgs: args };
}

const FRONTEND_PORT = 5180;
const BACKEND_PORT = 5181;
const FRONTEND_URL = `http://localhost:${FRONTEND_PORT}`;
const BACKEND_URL = `http://localhost:${BACKEND_PORT}`;

const frontendArgs = getSpawnArgs('vite', ['--host', 'localhost', '--port', String(FRONTEND_PORT), '--strictPort']);
const backendArgs = { cmd: process.execPath, cmdArgs: ['--watch', 'server/index.js'] };

const colors = {
  reset: '\x1b[0m',
  bright: '\x1b[1m',
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

function colorize(text, color) {
  return `${colors[color]}${text}${colors.reset}`;
}

function printHeader() {
  console.log('\n' + colorize('╔═══════════════════════════════════════════════════════════════════╗', 'cyan'));
  console.log(colorize('║', 'cyan') + colorize('              CASHFLOW DEVELOPMENT ENVIRONMENT                   '.padStart(71), 'bright') + colorize('║', 'cyan'));
  console.log(colorize('╚═══════════════════════════════════════════════════════════════════╝', 'cyan') + '\n');
}

function printServiceTable(services) {
  const borderTop = colorize('┌', 'gray') + colorize('─────────────────────────────────────────────────────────────────────────────', 'gray') + colorize('┐', 'gray');
  const borderMid = colorize('├', 'gray') + colorize('─────────────────────────────────────────────────────────────────────────────', 'gray') + colorize('┤', 'gray');
  const borderBot = colorize('└', 'gray') + colorize('─────────────────────────────────────────────────────────────────────────────', 'gray') + colorize('┘', 'gray');

  console.log(borderTop);
  console.log(colorize('│', 'gray') + colorize(' SERVICE       STATUS      URL                                    PORT  '.padEnd(76), 'dim') + colorize('│', 'gray'));
  console.log(borderMid);

  for (const svc of services) {
    const statusColor = svc.status === 'RUNNING' ? 'green' : svc.status === 'FAILED' ? 'red' : 'yellow';
    const statusIndicator = svc.status === 'RUNNING' ? '✓' : svc.status === 'FAILED' ? '✗' : '⋯';
    const line = '│ ' +
      colorize(svc.name.padEnd(14), 'bright') +
      colorize(statusIndicator + ' ' + svc.status.padEnd(10), statusColor) +
      colorize(svc.url.padEnd(46), 'cyan') +
      colorize(String(svc.port).padEnd(7), 'white') +
      '│';
    console.log(line);
  }

  console.log(borderBot);
}

function printStartupInfo() {
  console.log(colorize('  QUICK ACCESS', 'bright') + '\n');
  console.log(colorize('  • Frontend:', 'dim') + colorize(` ${FRONTEND_URL}`, 'cyan'));
  console.log(colorize('  • Backend API:', 'dim') + colorize(` ${BACKEND_URL}`, 'cyan'));
  console.log(colorize('  • API Health:', 'dim') + colorize(` ${BACKEND_URL}/api/health`, 'cyan'));
  console.log('');
  console.log(colorize('  Press ', 'dim') + colorize('Ctrl+C', 'yellow') + colorize(' to stop all servers', 'dim'));
  console.log('');
}

function printError(service, message) {
  const timestamp = new Date().toLocaleTimeString('id-ID', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
  console.log(colorize(`\n▲ ${service} ERROR at ${timestamp}`, 'red'));
  console.log(colorize('  └─', 'red') + colorize(` ${message}`, 'white'));
}

function createPrefixer(serviceName, color) {
  return (data) => {
    const lines = data.toString().split('\n').filter(line => line.trim());
    for (const line of lines) {
      const prefix = colorize(`[${serviceName}]`, color);
      console.log(`${prefix} ${line}`);
    }
  };
}

const frontendPrefix = createPrefixer('FRONTEND', 'cyan');
const backendPrefix = createPrefixer('BACKEND', 'green');

function startFrontend() {
  return new Promise((resolve) => {
    const proc = spawn(frontendArgs.cmd, frontendArgs.cmdArgs, {
      stdio: ['ignore', 'pipe', 'pipe'],
      cwd: projectRoot,
    });

    proc.stdout.on('data', frontendPrefix);
    proc.stderr.on('data', frontendPrefix);

    proc.on('close', (code) => {
      if (code !== 0 && code !== null) {
        printError('FRONTEND', `Process exited with code ${code}`);
      }
    });

    proc.on('error', (err) => {
      printError('FRONTEND', err.message);
    });

    setTimeout(() => resolve(proc), 1500);
  });
}

function startBackend() {
  return new Promise((resolve) => {
    const proc = spawn(backendArgs.cmd, backendArgs.cmdArgs, {
      stdio: ['ignore', 'pipe', 'pipe'],
      cwd: projectRoot,
      env: { ...process.env, FORCE_COLOR: '1' },
    });

    proc.stdout.on('data', backendPrefix);
    proc.stderr.on('data', backendPrefix);

    proc.on('close', (code) => {
      if (code !== 0 && code !== null) {
        printError('BACKEND', `Process exited with code ${code}`);
      }
    });

    proc.on('error', (err) => {
      printError('BACKEND', err.message);
    });

    setTimeout(() => resolve(proc), 1500);
  });
}

function waitForServers(frontendProc, backendProc) {
  return new Promise((resolve) => {
    const services = [
      { name: 'Frontend', status: 'STARTING', url: FRONTEND_URL, port: FRONTEND_PORT },
      { name: 'Backend', status: 'STARTING', url: BACKEND_URL, port: BACKEND_PORT },
    ];

    let frontendReady = false;
    let backendReady = false;
    let checked = false;

    const checkPorts = async () => {
      if (checked) return;
      checked = true;

      const net = await import('node:net');
      const checkPort = (port) => new Promise((res) => {
        const s = net.createServer();
        s.once('error', () => res(false));
        s.once('listening', () => { s.close(); res(true); });
        s.listen(port, '127.0.0.1');
      });

      const [frontendOk, backendOk] = await Promise.all([
        checkPort(FRONTEND_PORT).catch(() => false),
        checkPort(BACKEND_PORT).catch(() => false),
      ]);

      if (frontendOk && !frontendReady) {
        frontendReady = true;
        services[0].status = 'RUNNING';
      }
      if (backendOk && !backendReady) {
        backendReady = true;
        services[1].status = 'RUNNING';
      }

      if (frontendReady && backendReady) {
        console.clear();
        printHeader();
        printServiceTable(services);
        printStartupInfo();
        resolve();
      } else {
        checked = false;
        setTimeout(checkPorts, 500);
      }
    };

    setTimeout(checkPorts, 2000);
  });
}

async function main() {
  console.clear();
  printHeader();
  console.log(colorize('  Starting servers...\n', 'dim'));

  const [frontendProc, backendProc] = await Promise.all([
    startFrontend(),
    startBackend(),
  ]);

  await waitForServers(frontendProc, backendProc);

  const shutdown = (signal) => {
    console.log(colorize(`\n\n${signal} received. Shutting down...`, 'yellow'));
    frontendProc.kill('SIGTERM');
    backendProc.kill('SIGTERM');
    setTimeout(() => {
      frontendProc.kill('SIGKILL');
      backendProc.kill('SIGKILL');
      process.exit(0);
    }, 2000);
  };

  process.on('SIGINT', () => shutdown('SIGINT'));
  process.on('SIGTERM', () => shutdown('SIGTERM'));
}

main().catch((err) => {
  console.error(colorize(`Fatal error: ${err.message}`, 'red'));
  process.exit(1);
});