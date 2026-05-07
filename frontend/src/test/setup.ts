import '@testing-library/jest-dom/vitest';

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
