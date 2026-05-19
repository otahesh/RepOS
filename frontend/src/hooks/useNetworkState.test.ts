import { describe, it, expect, beforeEach, afterEach, afterAll, vi } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useNetworkState } from './useNetworkState';

// Mirror the pattern from logBuffer.test.ts: save the jsdom onLine descriptor
// at module top and restore it in afterAll so other test files that run after
// this one inherit the real accessor.
const originalOnLineDescriptor =
  Object.getOwnPropertyDescriptor(Object.getPrototypeOf(navigator), 'onLine') ??
  Object.getOwnPropertyDescriptor(navigator, 'onLine');

function setOnline(value: boolean): void {
  Object.defineProperty(navigator, 'onLine', { value, configurable: true });
}

describe('useNetworkState', () => {
  beforeEach(() => {
    setOnline(true);
  });

  afterEach(() => {
    setOnline(true);
  });

  afterAll(() => {
    if (originalOnLineDescriptor) {
      Object.defineProperty(navigator, 'onLine', originalOnLineDescriptor);
    } else {
      delete (navigator as unknown as { onLine?: boolean }).onLine;
    }
  });

  it('returns online: true when navigator.onLine is true initially', () => {
    setOnline(true);
    const { result } = renderHook(() => useNetworkState());
    expect(result.current.online).toBe(true);
    expect(typeof result.current.transitionedAt).toBe('number');
  });

  it('returns online: false when navigator.onLine is false initially', () => {
    setOnline(false);
    const { result } = renderHook(() => useNetworkState());
    expect(result.current.online).toBe(false);
  });

  it('updates to online: false when offline event fires; transitionedAt increases', async () => {
    setOnline(true);
    const { result } = renderHook(() => useNetworkState());
    const initialAt = result.current.transitionedAt;
    // Ensure clock advances at least 1ms before the transition.
    await new Promise((r) => setTimeout(r, 2));
    act(() => {
      setOnline(false);
      window.dispatchEvent(new Event('offline'));
    });
    expect(result.current.online).toBe(false);
    expect(result.current.transitionedAt).toBeGreaterThan(initialAt);
  });

  it('updates to online: true when online event fires after being offline; transitionedAt increases', async () => {
    setOnline(false);
    const { result } = renderHook(() => useNetworkState());
    const initialAt = result.current.transitionedAt;
    await new Promise((r) => setTimeout(r, 2));
    act(() => {
      setOnline(true);
      window.dispatchEvent(new Event('online'));
    });
    expect(result.current.online).toBe(true);
    expect(result.current.transitionedAt).toBeGreaterThan(initialAt);
  });

  it("dispatches a 'reconnect' CustomEvent on window ONLY on offline→online (not on initial mount)", () => {
    setOnline(true);
    const handler = vi.fn();
    window.addEventListener('reconnect', handler as EventListener);
    const { unmount } = renderHook(() => useNetworkState());
    // Initial mount with online=true should NOT have dispatched 'reconnect'.
    expect(handler).not.toHaveBeenCalled();

    act(() => {
      setOnline(true);
      window.dispatchEvent(new Event('online'));
    });

    expect(handler).toHaveBeenCalledTimes(1);
    const evt = handler.mock.calls[0][0] as CustomEvent<{ transitionedAt: number }>;
    expect(evt.type).toBe('reconnect');
    expect(typeof evt.detail.transitionedAt).toBe('number');

    window.removeEventListener('reconnect', handler as EventListener);
    unmount();
  });

  it('removes event listeners on unmount — hook stops responding to events', () => {
    setOnline(true);
    const { result, unmount } = renderHook(() => useNetworkState());
    const snapshot = { ...result.current };
    unmount();

    // After unmount, dispatching offline should NOT change the captured snapshot
    // (and React would warn if state update were attempted on unmounted component).
    act(() => {
      setOnline(false);
      window.dispatchEvent(new Event('offline'));
    });

    expect(snapshot.online).toBe(true);
    // result.current still reflects the last render before unmount.
    expect(result.current.online).toBe(true);
  });

  it('removes both online and offline listeners on unmount (spy verification)', () => {
    const removeSpy = vi.spyOn(window, 'removeEventListener');
    const { unmount } = renderHook(() => useNetworkState());
    unmount();
    const removedTypes = removeSpy.mock.calls.map((c) => c[0]);
    expect(removedTypes).toContain('online');
    expect(removedTypes).toContain('offline');
  });
});
