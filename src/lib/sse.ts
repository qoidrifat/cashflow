/**
 * SSE (Server-Sent Events) Client for Real-time Frontend Updates
 * Replaces realtime database change notifications (postgres_changes).
 */
import { getApiBaseUrl } from '../config/api';

type SSEHandler = (data: any) => void;

let eventSource: EventSource | null = null;
const handlers = new Map<string, Set<SSEHandler>>();
let isConnecting = false;

export function connectSSE() {
  if (eventSource || isConnecting) return;
  isConnecting = true;

  try {
    const url = `${getApiBaseUrl()}/api/events`;
    eventSource = new EventSource(url, { withCredentials: true });

    eventSource.onopen = () => {
      isConnecting = false;
    };

    const eventsToListen = [
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
        try {
          const data = JSON.parse(e.data || '{}');
          dispatch(evt, data);
        } catch {
          dispatch(evt, {});
        }
      });
    }

    eventSource.onerror = () => {
      isConnecting = false;
      // Browser EventSource automatically reconnects on error
    };
  } catch {
    isConnecting = false;
  }
}

export function disconnectSSE() {
  if (eventSource) {
    eventSource.close();
    eventSource = null;
  }
  isConnecting = false;
  handlers.clear();
}

function dispatch(event: string, data: any) {
  const set = handlers.get(event);
  if (set) {
    for (const fn of set) {
      try {
        fn(data);
      } catch (err) {
        console.error(`[SSE] Error in handler for event "${event}":`, err);
      }
    }
  }
}

export function onSSE(event: string, handler: SSEHandler): () => void {
  if (!handlers.has(event)) {
    handlers.set(event, new Set());
  }
  handlers.get(event)!.add(handler);

  if (!eventSource) {
    connectSSE();
  }

  return () => {
    const set = handlers.get(event);
    if (set) {
      set.delete(handler);
    }
  };
}
