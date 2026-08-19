/**
 * Proxied WebSocket (renderer -> main process)
 *
 * Collab sockets from the desktop renderer are opened in the main process and
 * bridged back over IPC rather than being opened directly with the browser
 * `WebSocket`. Chromium always stamps an `Origin` header on a browser upgrade
 * (in dev that is `http://localhost:5273`), and the sync server only allows
 * upgrades from its own explicit browser origin allowlist. A main-process
 * `ws` client sends no `Origin` at all, which is how the server identifies a
 * native/desktop client.
 *
 * Every desktop collab provider should route through `createProxiedWebSocket`
 * via its `createWebSocket` config hook. Lives in its own module so providers
 * can import it without pulling in `collabDocumentOpener`, which would form an
 * import cycle through the collab atoms.
 */

type WsEvent = { wsId: string; type: string; data?: string; code?: number; reason?: string; error?: string };
type WsEventHandler = (event: WsEvent) => void;

/** Map of wsId -> handler. A single IPC listener dispatches to the right handler. */
const wsEventHandlers = new Map<string, WsEventHandler>();
/** Buffer for events that arrive before their wsId handler is registered (IPC race). */
const wsPendingEvents = new Map<string, WsEvent[]>();
let globalWsListenerInstalled = false;

function ensureGlobalWsListener(): void {
  if (globalWsListenerInstalled) return;
  const api = window.electronAPI?.documentSync;
  if (!api?.onWsEvent) return;

  api.onWsEvent((event: WsEvent) => {
    const handler = wsEventHandlers.get(event.wsId);
    if (handler) {
      handler(event);
    } else {
      // Handler not yet registered (wsConnect IPC hasn't resolved yet).
      // Buffer the event for flush when the handler is registered.
      let pending = wsPendingEvents.get(event.wsId);
      if (!pending) {
        pending = [];
        wsPendingEvents.set(event.wsId, pending);
      }
      pending.push(event);
    }
  });
  globalWsListenerInstalled = true;
}

/** Register a handler for a wsId and flush any buffered events. */
function registerWsHandler(id: string, handler: WsEventHandler): void {
  wsEventHandlers.set(id, handler);
  const pending = wsPendingEvents.get(id);
  if (pending) {
    wsPendingEvents.delete(id);
    for (const event of pending) {
      handler(event);
    }
  }
}

/**
 * The only query keys a host config may contribute to a collab room URL.
 *
 * `urlExtraQuery` has exactly one producer: the Playwright collab identity
 * bridge, which hands a loopback `wrangler dev` worker `test_user_id` /
 * `test_org_id` in place of a Stytch session. Production `document-sync:open`
 * never sets the field at all.
 *
 * Those two keys are identity claims against a server that honours them when
 * `TEST_AUTH_BYPASS=true`, so the set is closed rather than open. A future
 * config path that populates `urlExtraQuery` from somewhere less trusted then
 * cannot smuggle its own parameters onto an authenticated room URL just by
 * reaching this function -- it has to come back here and say so.
 */
const ALLOWED_COLLAB_URL_QUERY_KEYS = new Set(['test_user_id', 'test_org_id']);

/**
 * Append a host-supplied, already-authorized query to a collab room URL.
 *
 * Re-serialized through `URLSearchParams` rather than concatenated verbatim:
 * that both re-encodes the values and drops anything outside
 * {@link ALLOWED_COLLAB_URL_QUERY_KEYS}. Dropping is deliberate -- the room URL
 * stays connectable and the server refuses it on its own terms, which is a
 * better failure than a renderer exception on a path that only the test bridge
 * exercises.
 */
export function appendCollabUrlQuery(url: string, urlExtraQuery?: string): string {
  if (!urlExtraQuery) return url;

  const allowed = new URLSearchParams();
  for (const [key, value] of new URLSearchParams(urlExtraQuery)) {
    if (ALLOWED_COLLAB_URL_QUERY_KEYS.has(key)) {
      allowed.append(key, value);
    } else {
      console.warn(
        `[collab] Ignored unrecognized collab URL query parameter "${key}". `
        + 'Only the Playwright identity bridge may extend a room URL.',
      );
    }
  }

  const serialized = allowed.toString();
  if (!serialized) return url;
  return `${url}${url.includes('?') ? '&' : '?'}${serialized}`;
}

/**
 * Create a browser-compatible WebSocket that proxies through the Electron
 * main process via IPC. This works around Cloudflare blocking WebSocket
 * upgrades from browser/Chromium clients.
 *
 * Returns an object that implements the browser WebSocket interface
 * (enough for DocumentSyncProvider to use).
 */
export function createProxiedWebSocket(url: string): WebSocket {
  const api = window.electronAPI?.documentSync;
  if (!api?.wsConnect) {
    throw new Error('WebSocket proxy API not available');
  }

  ensureGlobalWsListener();

  // Create a fake WebSocket that proxies through IPC
  const eventTarget = new EventTarget();
  let wsId: string | null = null;
  let readyState: number = WebSocket.CONNECTING;
  let closedBeforeConnected = false;

  function cleanup(): void {
    if (wsId) {
      wsEventHandlers.delete(wsId);
    }
  }

  function dispatchWsEvent(event: WsEvent): void {
    switch (event.type) {
      case 'open':
        if (readyState === WebSocket.CLOSING || readyState === WebSocket.CLOSED) break;
        readyState = WebSocket.OPEN;
        eventTarget.dispatchEvent(new Event('open'));
        break;
      case 'message':
        if (readyState === WebSocket.CLOSING || readyState === WebSocket.CLOSED) break;
        readyState = WebSocket.OPEN;
        eventTarget.dispatchEvent(new MessageEvent('message', { data: event.data }));
        break;
      case 'close':
        readyState = WebSocket.CLOSED;
        eventTarget.dispatchEvent(new CloseEvent('close', {
          code: event.code ?? 1000,
          reason: event.reason ?? '',
        }));
        cleanup();
        break;
      case 'error':
        eventTarget.dispatchEvent(new Event('error'));
        break;
    }
  }

  const ws = {
    get readyState() { return readyState; },
    get CONNECTING() { return WebSocket.CONNECTING; },
    get OPEN() { return WebSocket.OPEN; },
    get CLOSING() { return WebSocket.CLOSING; },
    get CLOSED() { return WebSocket.CLOSED; },

    addEventListener(type: string, listener: EventListenerOrEventListenerObject) {
      eventTarget.addEventListener(type, listener);
    },
    removeEventListener(type: string, listener: EventListenerOrEventListenerObject) {
      eventTarget.removeEventListener(type, listener);
    },

    send(data: string) {
      if (wsId && readyState === WebSocket.OPEN) {
        api.wsSend(wsId, data);
      }
    },

    close() {
      if (readyState === WebSocket.CLOSING || readyState === WebSocket.CLOSED) {
        return;
      }
      readyState = WebSocket.CLOSING;
      if (wsId) {
        api.wsClose(wsId);
      } else {
        // close() called before wsConnect() resolved (e.g., React StrictMode teardown).
        // Flag it so the connect resolution can close the main-process socket.
        closedBeforeConnected = true;
      }
    },
  } as unknown as WebSocket;

  // Initiate the connection asynchronously
  api.wsConnect(url).then((result) => {
    if (result.success && result.wsId) {
      wsId = result.wsId;

      // If close() was called before wsConnect resolved (React StrictMode),
      // register first so the main-process close event reaches the caller.
      if (closedBeforeConnected) {
        registerWsHandler(wsId, dispatchWsEvent);
        api.wsClose(wsId);
        return;
      }

      // Register handler for events on this wsId (flushes any buffered events)
      registerWsHandler(wsId, dispatchWsEvent);
    } else {
      console.error('[createProxiedWebSocket] Failed to connect:', result.error);
      readyState = WebSocket.CLOSED;
      eventTarget.dispatchEvent(new Event('error'));
      eventTarget.dispatchEvent(new CloseEvent('close', { code: 1006, reason: result.error ?? '' }));
    }
  }).catch((err: unknown) => {
    console.error('[createProxiedWebSocket] IPC error:', err);
    readyState = WebSocket.CLOSED;
    eventTarget.dispatchEvent(new Event('error'));
    eventTarget.dispatchEvent(new CloseEvent('close', { code: 1006, reason: String(err) }));
  });

  return ws;
}
