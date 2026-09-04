/**
 * SSE (Server-Sent Events) Manager
 * Provides real-time push notifications from server to frontend.
 * Replaces Supabase Realtime (postgres_changes).
 */

/** @type {Map<string, Set<import('express').Response>>} */
const clients = new Map();

/** Batas koneksi SSE per user — anti memory-exhaustion DoS (audit 2026-09-04). */
const MAX_CONNECTIONS_PER_USER = 5;
/** Batas global seluruh user — guard proses, bukan per-user. */
const MAX_CONNECTIONS_GLOBAL = 1000;
let totalConnections = 0;

/**
 * Add a SSE client connection for a user.
 * @returns {boolean} false bila melebihi batas per-user ATAU global.
 */
export function addSSEClient(userId, res) {
  if (totalConnections >= MAX_CONNECTIONS_GLOBAL) return false;
  if (!clients.has(userId)) clients.set(userId, new Set());
  const set = clients.get(userId);
  if (set.size >= MAX_CONNECTIONS_PER_USER) return false;
  set.add(res);
  totalConnections += 1;
  return true;
}

/**
 * Remove a SSE client connection.
 */
export function removeSSEClient(userId, res) {
  const set = clients.get(userId);
  if (set) {
    if (set.delete(res)) totalConnections = Math.max(0, totalConnections - 1);
    if (set.size === 0) clients.delete(userId);
  }
}
export function notifyUser(userId, event, data = {}) {
  const set = clients.get(userId);
  if (!set || set.size === 0) return;

  const payload = `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
  for (const res of set) {
    try {
      res.write(payload);
    } catch {
      // Client disconnected, clean up
      set.delete(res);
    }
  }
}

/**
 * Broadcast an event to ALL connected clients.
 * @param {string} event
 * @param {object} data
 */
export function broadcastAll(event, data = {}) {
  const payload = `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
  for (const [, set] of clients) {
    for (const res of set) {
      try {
        res.write(payload);
      } catch {
        set.delete(res);
      }
    }
  }
}

/**
 * Close ALL SSE client connections (graceful shutdown / restart).
 * Ends setiap response dan kosongkan registry.
 */
export function closeSSEClients() {
  for (const [, set] of clients) {
    for (const res of set) {
      try {
        res.end();
      } catch {
        // client sudah putus
      }
    }
  }
  clients.clear();
  totalConnections = 0;
}

/**
 * Register the SSE endpoint on Express app.
 * Frontend connects to GET /api/events to receive real-time updates.
 */
export function registerSSERoute(app, requireAuthFn) {
  app.get('/api/events', requireAuthFn, (req, res) => {
    // Cap per-user: tolak koneksi ke-N (5+) dengan 429 sebelum writeHead —
    // hindari menulis header 200 lalu dibatalkan (memory leak sisi klien).
    if (!addSSEClient(req.user.id, res)) {
      res.status(429).json({ error: 'Terlalu banyak koneksi realtime aktif. Coba lagi nanti.', code: 'SSE_CONNECTION_LIMIT' });
      return;
    }
    // SSE headers
    res.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      Connection: 'keep-alive',
      'X-Accel-Buffering': 'no', // Disable Nginx buffering
    });

    // Send initial connection event
    res.write(`event: connected\ndata: ${JSON.stringify({ userId: req.user.id })}\n\n`);

    // Heartbeat every 30 seconds to keep connection alive
    const heartbeat = setInterval(() => {
      try {
        res.write(': heartbeat\n\n');
      } catch {
        clearInterval(heartbeat);
      }
    }, 30000);

    // Cleanup on disconnect
    req.on('close', () => {
      clearInterval(heartbeat);
      removeSSEClient(req.user.id, res);
    });
  });
}
