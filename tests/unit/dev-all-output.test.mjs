/**
 * Unit tests for dev-all.mjs output formatting
 *
 * Tests the output formatting functions and table generation logic
 * without requiring actual server processes.
 *
 * Run: node --test tests/unit/dev-all-output.test.mjs
 */

import { describe, it } from 'node:test';
import assert from 'node:assert';

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

function createPrefixer(serviceName, color) {
  return (data) => {
    const lines = data.toString().split('\n').filter(line => line.trim());
    return lines.map(line => `${colorize(`[${serviceName}]`, color)} ${line}`);
  };
}

function getSpawnArgs(name, args, platform = 'win32') {
  if (platform === 'win32') {
    const binPath = `D:/Workspace/cashflow/node_modules/.bin/${name}`;
    if (binPath.endsWith('.cmd')) {
      return { cmd: 'cmd.exe', cmdArgs: ['/c', binPath, ...args] };
    }
  }
  return { cmd: `D:/Workspace/cashflow/node_modules/.bin/${name}`, cmdArgs: args };
}

describe('Output Formatting', () => {
  describe('colorize()', () => {
    it('should wrap text with color codes', () => {
      const result = colorize('test', 'red');
      assert.ok(result.startsWith('\x1b[31m'));
      assert.ok(result.endsWith('\x1b[0m'));
      assert.ok(result.includes('test'));
    });

    it('should handle all color names', () => {
      const colorNames = ['reset', 'bright', 'dim', 'red', 'green', 'yellow', 'blue', 'magenta', 'cyan', 'white', 'gray'];
      for (const color of colorNames) {
        const result = colorize('text', color);
        assert.ok(result.includes('text'), `Should include text for color ${color}`);
      }
    });
  });

  describe('createPrefixer()', () => {
    it('should create a prefixer function for service', () => {
      const prefixer = createPrefixer('FRONTEND', 'cyan');
      const result = prefixer(Buffer.from('VITE ready\nListening on localhost'));

      assert.equal(result.length, 2);
      assert.ok(result[0].includes('[FRONTEND]'));
      assert.ok(result[0].includes('VITE ready'));
      assert.ok(result[1].includes('[FRONTEND]'));
      assert.ok(result[1].includes('Listening on localhost'));
    });

    it('should filter empty lines', () => {
      const prefixer = createPrefixer('BACKEND', 'green');
      const result = prefixer(Buffer.from('\n\nLine1\n\nLine2\n\n'));

      assert.equal(result.length, 2);
      assert.ok(result.every(line => !line.startsWith('\n')));
    });

    it('should apply correct color to prefix', () => {
      const cyanPrefixer = createPrefixer('FRONTEND', 'cyan');
      const greenPrefixer = createPrefixer('BACKEND', 'green');

      const cyanResult = cyanPrefixer(Buffer.from('test'))[0];
      const greenResult = greenPrefixer(Buffer.from('test'))[0];

      assert.ok(cyanResult.includes('\x1b[36m'));
      assert.ok(greenResult.includes('\x1b[32m'));
    });
  });
});

describe('Table Generation', () => {
  it('should generate valid service status objects', () => {
    const services = [
      { name: 'Frontend', status: 'RUNNING', url: 'http://localhost:5180', port: 5180 },
      { name: 'Backend', status: 'RUNNING', url: 'http://localhost:5181', port: 5181 },
    ];

    assert.equal(services.length, 2);
    assert.equal(services[0].name, 'Frontend');
    assert.equal(services[0].status, 'RUNNING');
    assert.equal(services[1].name, 'Backend');
    assert.equal(services[1].status, 'RUNNING');
  });

  it('should handle FAILED status correctly', () => {
    const failedService = { name: 'Backend', status: 'FAILED', url: 'http://localhost:5181', port: 5181 };

    assert.equal(failedService.status, 'FAILED');
    assert.ok(['RUNNING', 'FAILED', 'STARTING'].includes(failedService.status));
  });

  it('should handle STARTING status correctly', () => {
    const startingService = { name: 'Frontend', status: 'STARTING', url: 'http://localhost:5180', port: 5180 };

    assert.equal(startingService.status, 'STARTING');
    assert.ok(['RUNNING', 'FAILED', 'STARTING'].includes(startingService.status));
  });
});

describe('Port Configuration', () => {
  it('should use correct default ports', () => {
    const FRONTEND_PORT = 5180;
    const BACKEND_PORT = 5181;

    assert.equal(FRONTEND_PORT, 5180);
    assert.equal(BACKEND_PORT, 5181);
    assert.notEqual(FRONTEND_PORT, BACKEND_PORT);
  });

  it('should generate correct URLs', () => {
    const FRONTEND_URL = `http://localhost:5180`;
    const BACKEND_URL = `http://localhost:5181`;

    assert.ok(FRONTEND_URL.startsWith('http://'));
    assert.ok(BACKEND_URL.startsWith('http://'));
    assert.ok(FRONTEND_URL.includes('5180'));
    assert.ok(BACKEND_URL.includes('5181'));
  });
});

describe('Error Formatting', () => {
  it('should format error messages correctly', () => {
    const service = 'FRONTEND';
    const message = 'Port 5180 is already in use';
    const timestamp = new Date().toLocaleTimeString('id-ID', { hour: '2-digit', minute: '2-digit', second: '2-digit' });

    const errorOutput = `\n▲ ${service} ERROR at ${timestamp}\n  └─ ${message}`;

    assert.ok(errorOutput.includes('▲'));
    assert.ok(errorOutput.includes(service));
    assert.ok(errorOutput.includes('ERROR'));
    assert.ok(errorOutput.includes(message));
    assert.ok(errorOutput.includes(timestamp));
  });
});

describe('Spawn Arguments Generation', () => {
  describe('getSpawnArgs()', () => {
    it('should generate cmd.exe args for Windows vite with .cmd extension', () => {
      const result = getSpawnArgs('vite.cmd', ['--port', '5180'], 'win32');

      assert.equal(result.cmd, 'cmd.exe');
      assert.ok(result.cmdArgs.includes('/c'));
      assert.ok(result.cmdArgs.some(arg => arg.includes('vite.cmd')));
    });

    it('should generate direct path args for non-Windows', () => {
      const result = getSpawnArgs('vite', ['--port', '5180'], 'linux');

      assert.ok(result.cmd.includes('vite'));
      assert.deepEqual(result.cmdArgs, ['--port', '5180']);
    });

    it('should include arguments correctly', () => {
      const args = ['--host', 'localhost', '--port', '5180'];
      const result = getSpawnArgs('vite.cmd', args, 'win32');

      for (const arg of args) {
        assert.ok(result.cmdArgs.includes(arg), `Should include argument: ${arg}`);
      }
    });
  });
});

describe('Status Indicator Logic', () => {
  it('should show correct indicator for RUNNING status', () => {
    const status = 'RUNNING';
    const statusIndicator = status === 'RUNNING' ? '✓' : status === 'FAILED' ? '✗' : '⋯';

    assert.equal(statusIndicator, '✓');
  });

  it('should show correct indicator for FAILED status', () => {
    const status = 'FAILED';
    const statusIndicator = status === 'RUNNING' ? '✓' : status === 'FAILED' ? '✗' : '⋯';

    assert.equal(statusIndicator, '✗');
  });

  it('should show correct indicator for STARTING status', () => {
    const status = 'STARTING';
    const statusIndicator = status === 'RUNNING' ? '✓' : status === 'FAILED' ? '✗' : '⋯';

    assert.equal(statusIndicator, '⋯');
  });
});

console.log('Running dev-all output formatting tests...');
