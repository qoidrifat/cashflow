/**
 * SSE (Server-Sent Events) Manager
 * Provides real-time push notifications from server to frontend.
 * Replaces Supabase Realtime (postgres_changes).
 */

/** @type {Map<string, Set<import('express').Response>>} */
const clients = new Map();

/**
 * Add a SSE client connection for a user.
 */
export function addSSEClient(userId, res) {
  if (!clients.has(userId)) clients.set(userId, new Set());
  clients.get(userId).add(res);
}

/**
 * Remove a SSE client connection.
 */
export function removeSSEClient(userId, res) {
  const set = clients.get(userId);
  if (set) {
    set.delete(res);
    if (set.size === 0) clients.delete(userId);
  }
}

/**
 * Send an event to all connected clients for a specific user.
 * @param {string} userId
 * @param {string} event - Event name (e.g., 'transaction:created')
 * @param {object} data - Event data payload
 */
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
}

/**
 * Register the SSE endpoint on Express app.
 * Frontend connects to GET /api/events to receive real-time updates.
 */
export function registerSSERoute(app, requireAuthFn) {
  app.get('/api/events', requireAuthFn, (req, res) => {
    // SSE headers
    res.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      Connection: 'keep-alive',
      'X-Accel-Buffering': 'no', // Disable Nginx buffering
    });

    // Send initial connection event
    res.write(`event: connected\ndata: ${JSON.stringify({ userId: req.user.id })}\n\n`);

    // Register client
    addSSEClient(req.user.id, res);

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
