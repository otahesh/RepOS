import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useRestTimer } from './useRestTimer';

describe('useRestTimer', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    // Pin "now" so tests are deterministic relative to lastLoggedAt offsets.
    vi.setSystemTime(new Date('2026-05-18T12:00:00Z'));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('returns zeroed elapsed and full remaining when lastLoggedAt is null; no interval started', () => {
    const setIntervalSpy = vi.spyOn(window, 'setInterval');
    const { result } = renderHook(() => useRestTimer({ lastLoggedAt: null, targetRestSec: 90 }));
    expect(result.current).toEqual({
      elapsedSec: 0,
      remainingSec: 90,
      isOvertime: false,
    });
    expect(setIntervalSpy).not.toHaveBeenCalled();

    // Advancing time should not change state when lastLoggedAt is null.
    act(() => {
      vi.advanceTimersByTime(5000);
    });
    expect(result.current.elapsedSec).toBe(0);
    expect(result.current.remainingSec).toBe(90);
  });

  it('computes elapsed/remaining for lastLoggedAt 10s ago with 60s target', () => {
    const now = Date.now();
    const { result } = renderHook(() =>
      useRestTimer({ lastLoggedAt: now - 10_000, targetRestSec: 60 }),
    );
    expect(result.current).toEqual({
      elapsedSec: 10,
      remainingSec: 50,
      isOvertime: false,
    });
  });

  it('advances every 1s when fake timers progress', () => {
    const now = Date.now();
    const { result } = renderHook(() => useRestTimer({ lastLoggedAt: now, targetRestSec: 60 }));
    expect(result.current.elapsedSec).toBe(0);

    act(() => {
      vi.advanceTimersByTime(1000);
    });
    expect(result.current.elapsedSec).toBe(1);
    expect(result.current.remainingSec).toBe(59);

    act(() => {
      vi.advanceTimersByTime(4000);
    });
    expect(result.current.elapsedSec).toBe(5);
    expect(result.current.remainingSec).toBe(55);
    expect(result.current.isOvertime).toBe(false);
  });

  it('sets isOvertime=true and negative remainingSec when elapsed > target', () => {
    const now = Date.now();
    const { result } = renderHook(() =>
      useRestTimer({ lastLoggedAt: now - 120_000, targetRestSec: 60 }),
    );
    expect(result.current.elapsedSec).toBe(120);
    expect(result.current.remainingSec).toBe(-60);
    expect(result.current.isOvertime).toBe(true);
  });

  it('recomputes immediately when lastLoggedAt prop changes', () => {
    const now = Date.now();
    const { result, rerender } = renderHook(
      ({ lastLoggedAt }: { lastLoggedAt: number | null }) =>
        useRestTimer({ lastLoggedAt, targetRestSec: 60 }),
      { initialProps: { lastLoggedAt: now - 30_000 } },
    );
    expect(result.current.elapsedSec).toBe(30);

    // Simulate logging a fresh set: lastLoggedAt becomes "now".
    rerender({ lastLoggedAt: now });
    expect(result.current.elapsedSec).toBe(0);
    expect(result.current.remainingSec).toBe(60);
    expect(result.current.isOvertime).toBe(false);
  });

  it('clears interval on unmount — state stops updating', () => {
    const clearSpy = vi.spyOn(window, 'clearInterval');
    const now = Date.now();
    const { result, unmount } = renderHook(() =>
      useRestTimer({ lastLoggedAt: now, targetRestSec: 60 }),
    );

    act(() => {
      vi.advanceTimersByTime(2000);
    });
    expect(result.current.elapsedSec).toBe(2);
    const snapshot = { ...result.current };

    unmount();
    expect(clearSpy).toHaveBeenCalled();

    // Advance time further — without an active interval, result.current must
    // retain its last-rendered value.
    act(() => {
      vi.advanceTimersByTime(10_000);
    });
    expect(result.current).toEqual(snapshot);
  });
});
