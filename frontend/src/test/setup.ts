import '@testing-library/jest-dom/vitest';

// Node 26 ships a built-in `localStorage` global that requires the
// `--localstorage-file` flag to actually work; vitest's jsdom env doesn't
// expose its own Storage on top of it, so `window.localStorage` ends up
// undefined. Provide a minimal in-memory polyfill so the W1.3.7
// SessionExpiredBanner tests (and any future Storage callers) work.
if (typeof (globalThis as { localStorage?: Storage }).localStorage === 'undefined') {
  class MemoryStorage implements Storage {
    private store = new Map<string, string>();
    get length(): number {
      return this.store.size;
    }
    clear(): void {
      this.store.clear();
    }
    getItem(key: string): string | null {
      return this.store.has(key) ? this.store.get(key)! : null;
    }
    key(index: number): string | null {
      return Array.from(this.store.keys())[index] ?? null;
    }
    removeItem(key: string): void {
      this.store.delete(key);
    }
    setItem(key: string, value: string): void {
      this.store.set(key, String(value));
    }
  }
  const storage = new MemoryStorage();
  Object.defineProperty(globalThis, 'localStorage', {
    configurable: true,
    value: storage,
  });
  if (typeof window !== 'undefined') {
    Object.defineProperty(window, 'localStorage', {
      configurable: true,
      value: storage,
    });
  }
}

// Node ships a native `BroadcastChannel` global, but it is incompatible with
// jsdom: it delivers a Node-internal `MessageEvent` to listeners, and jsdom's
// EventTarget.dispatchEvent rejects it with `ERR_INVALID_ARG_TYPE` ("event must
// be an instance of Event"). The W6 SignOutEverywhereButton + AuthProvider use
// BroadcastChannel('repos-auth') for the cross-tab sign-out signal, and the
// component test asserts a posted message is received on a second channel. Swap
// in a minimal in-process, same-realm polyfill that uses jsdom's own
// MessageEvent so dispatch works under the test runner. This mirrors real
// browser BroadcastChannel semantics closely enough for the unit tests (sync
// delivery within the same realm; sender does not receive its own message).
{
  type BCListener = (ev: MessageEvent) => void;
  const channels = new Map<string, Set<BroadcastChannelPolyfill>>();

  class BroadcastChannelPolyfill implements BroadcastChannel {
    readonly name: string;
    onmessage: ((this: BroadcastChannel, ev: MessageEvent) => unknown) | null = null;
    onmessageerror: ((this: BroadcastChannel, ev: MessageEvent) => unknown) | null = null;
    private listeners = new Set<BCListener>();
    private closed = false;

    constructor(name: string) {
      this.name = name;
      let peers = channels.get(name);
      if (!peers) {
        peers = new Set();
        channels.set(name, peers);
      }
      peers.add(this);
    }

    postMessage(message: unknown): void {
      if (this.closed) throw new Error('BroadcastChannel is closed');
      const peers = channels.get(this.name);
      if (!peers) return;
      const data = structuredClone(message);
      for (const peer of peers) {
        if (peer === this || peer.closed) continue;
        // jsdom provides MessageEvent on the global; constructing it here keeps
        // dispatch inside the jsdom realm.
        const ev = new MessageEvent('message', { data });
        peer.onmessage?.call(peer as unknown as BroadcastChannel, ev);
        for (const fn of peer.listeners) fn(ev);
      }
    }

    close(): void {
      this.closed = true;
      channels.get(this.name)?.delete(this);
    }

    addEventListener(type: string, listener: EventListenerOrEventListenerObject): void {
      if (type !== 'message' || !listener) return;
      const fn = typeof listener === 'function' ? listener : listener.handleEvent.bind(listener);
      this.listeners.add(fn as BCListener);
    }

    removeEventListener(type: string, listener: EventListenerOrEventListenerObject): void {
      if (type !== 'message' || !listener) return;
      const fn = typeof listener === 'function' ? listener : listener.handleEvent.bind(listener);
      this.listeners.delete(fn as BCListener);
    }

    dispatchEvent(): boolean {
      return true;
    }
  }

  const target = globalThis as unknown as { BroadcastChannel?: unknown };
  target.BroadcastChannel = BroadcastChannelPolyfill as unknown as typeof BroadcastChannel;
  if (typeof window !== 'undefined') {
    (window as unknown as { BroadcastChannel?: unknown }).BroadcastChannel =
      BroadcastChannelPolyfill as unknown as typeof BroadcastChannel;
  }
}

if (typeof globalThis.ResizeObserver === 'undefined') {
  globalThis.ResizeObserver = class {
    observe() {}
    unobserve() {}
    disconnect() {}
  } as unknown as typeof ResizeObserver;
}

// jsdom does not implement PointerEvent — provide a minimal polyfill so tests
// that simulate touch/pen pointer events can set pointerType correctly.
if (typeof (globalThis as unknown as Record<string, unknown>).PointerEvent === 'undefined') {
  class PointerEventPolyfill extends MouseEvent {
    readonly pointerType: string;
    constructor(type: string, params: PointerEventInit = {}) {
      super(type, params);
      this.pointerType = params.pointerType ?? '';
    }
  }
  (globalThis as unknown as Record<string, unknown>).PointerEvent = PointerEventPolyfill;
}
