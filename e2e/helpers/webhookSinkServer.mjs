/**
 * Webhook sink server untuk e2e/notification-metadata-guard.spec.ts (P1-4).
 *
 * Server Express uji (port 5183, dikonfigurasi di playwright.config.ts dengan
 * GMAIL_WEBHOOK_URL=http://127.0.0.1:5184/hook) akan mem-POST payload webhook
 * gmail review ke sini. Spec membaca payload via GET /sink-payloads (fetch dari
 * proses Node Playwright) untuk mengassert side effect operator secara
 * deterministik — tanpa sink ini klaim "webhook TIDAK dipicu" tidak bisa
 * dibuktikan (server 5181 shared tidak punya GMAIL_WEBHOOK_URL di server/.env).
 *
 * Jalan di background (is_background) SEBELUM suite Playwright dimulai;
 * playwright.config memakai url health-check endpoint /sink-health.
 */
import http from 'node:http';

const PORT = Number(process.env.WEBHOOK_SINK_PORT || '5184');
const payloads = [];
let server;

process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);

function shutdown() {
  if (server) server.close();
  process.exit(0);
}

server = http.createServer((req, res) => {
  // Health-check untuk webServer readiness Playwright.
  if (req.method === 'GET' && req.url === '/sink-health') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ ok: true, count: payloads.length }));
    return;
  }

  // Reset sink (dipanggil spec sebelum tiap test agar deterministik).
  if (req.method === 'POST' && req.url === '/sink-reset') {
    payloads.length = 0;
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ ok: true }));
    return;
  }

  // Baca payload yang diterima (spec Node fetch langsung ke sink).
  if (req.method === 'GET' && req.url === '/sink-payloads') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ payloads }));
    return;
  }

  // Terima webhook (path apa pun) — simpan body JSON mentah.
  if (req.method === 'POST') {
    let body = '';
    req.on('data', (chunk) => { body += chunk; });
    req.on('end', () => {
      let parsed = null;
      try { parsed = JSON.parse(body); } catch { /* simpan null bila bukan JSON */ }
      payloads.push({ path: req.url, body: parsed, raw: body });
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: true }));
    });
    return;
  }

  res.writeHead(404, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify({ error: 'not found' }));
});

server.listen(PORT, '127.0.0.1', () => {
  console.log(`[webhook-sink] listening on http://127.0.0.1:${PORT}`);
});
