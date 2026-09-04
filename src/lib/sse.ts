/**
 * SSE (Server-Sent Events) Client for Real-time Frontend Updates
 * Replaces realtime database change notifications (postgres_changes).
 */
import { getApiBaseUrl } from '../config/api';

type SSEHandler = (data: unknown) => void;
type SSEStatusHandler = (connected: boolean) => void;

let eventSource: EventSource | null = null;
const handlers = new Map<string, Set<SSEHandler>>();
const statusHandlers = new Set<SSEStatusHandler>();
let isConnecting = false;
let lastReconnectAttempt = 0;
const RECONNECT_MIN_INTERVAL_MS = 5_000;

function notifyStatus(connected: boolean): void {
  for (const fn of statusHandlers) {
    try {
      fn(connected);
    } catch (err) {
      console.error('[SSE] status handler error:', err);
    }
  }
}

export function connectSSE(): void {
  if (eventSource || isConnecting) return;
  const now = Date.now();
  if (now - lastReconnectAttempt < RECONNECT_MIN_INTERVAL_MS) return;
  lastReconnectAttempt = now;
  isConnecting = true;

  try {
    const url = `${getApiBaseUrl()}/api/events`;
    eventSource = new EventSource(url, { withCredentials: true });

    eventSource.onopen = () => {
      isConnecting = false;
      notifyStatus(true);
    };

    const eventsToListen: ReadonlyArray<string> = [
      'connected',
      'transaction:created',
      'transaction:updated',
      'transaction:deleted',
      'category:changed',
      'budget:changed',
      'recurring:changed',
      'notification:new',
      'wallet:changed',
      'goal:changed',
      'subscription:changed',
      'gmail:log',
    ];

    for (const evt of eventsToListen) {
      eventSource.addEventListener(evt, (e: MessageEvent) => {
        let data: unknown = {};
        try {
          data = JSON.parse(e.data || '{}');
        } catch {
          data = {};
        }
        dispatch(evt, data);
      });
    }

    eventSource.onerror = () => {
      isConnecting = false;
      notifyStatus(false);
      if (eventSource) {
        try {
          eventSource.close();
        } catch {
          /* noop */
        }
        eventSource = null;
      }
    };
  } catch {
    isConnecting = false;
    notifyStatus(false);
  }
}

export function disconnectSSE(): void {
  if (eventSource) {
    try {
      eventSource.close();
    } catch {
      /* noop */
    }
    eventSource = null;
  }
  isConnecting = false;
  lastReconnectAttempt = 0;
  handlers.clear();
  notifyStatus(false);
}

/** Subscribe status perubahan koneksi SSE (untuk BellIcon WifiOff). */
export function onSSEStatus(handler: SSEStatusHandler): () => void {
  statusHandlers.add(handler);
  return () => {
    statusHandlers.delete(handler);
  };
}

function dispatch(event: string, data: unknown): void {
  const set = handlers.get(event);
  if (!set) return;
  for (const fn of set) {
    try {
      fn(data);
    } catch (err) {
      console.error(`[SSE] Error in handler for event "${event}":`, err);
    }
  }
}

export function onSSE(event: string, handler: SSEHandler): () => void {
  let set = handlers.get(event);
  if (!set) {
    set = new Set();
    handlers.set(event, set);
  }
  set.add(handler);

  if (!eventSource) {
    connectSSE();
  }

  return () => {
    const s = handlers.get(event);
    if (s) s.delete(handler);
  };
}
