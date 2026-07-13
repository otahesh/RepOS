import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useHoldTimer } from './useHoldTimer';

// Same fake-timer discipline as useRestTimer.test.ts: the hook chains one
// setTimeout per second, so advance the clock in 1s steps; fake timers mock
// Date.now() in lockstep, which is what makes the wall-clock anchor testable.
function tickSeconds(n: number) {
  for (let i = 0; i < n; i++) {
    act(() => {
      vi.advanceTimersByTime(1000);
    });
  }
}

function setVisibility(state: 'visible' | 'hidden') {
  Object.defineProperty(document, 'visibilityState', {
    value: state,
    configurable: true,
  });
}

describe('useHoldTimer', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('is idle (elapsed null, not running) before start', () => {
    const { result } = renderHook(() => useHoldTimer());
    expect(result.current.elapsed).toBeNull();
    expect(result.current.running).toBe(false);
  });

  it('counts up wall-clock-anchored and stop() returns elapsed seconds', () => {
    const { result } = renderHook(() => useHoldTimer());
    act(() => result.current.start());
    expect(result.current.running).toBe(true);
    tickSeconds(42);
    expect(result.current.elapsed).toBe(42);
    let final = 0;
    act(() => {
      final = result.current.stop();
    });
    expect(final).toBe(42);
    expect(result.current.running).toBe(false);
    expect(result.current.elapsed).toBe(42); // frozen, still displayed
  });

  it('recovers true elapsed after a backgrounded (locked-phone) gap', () => {
    const { result } = renderHook(() => useHoldTimer());
    act(() => result.current.start());
    tickSeconds(5);
    // Simulate a 30s lock: time passes with no ticks delivered, then the
    // visibilitychange recompute snaps to truth.
    setVisibility('hidden');
    act(() => {
      vi.setSystemTime(Date.now() + 30_000);
    });
    setVisibility('visible');
    act(() => {
      document.dispatchEvent(new Event('visibilitychange'));
    });
    expect(result.current.elapsed).toBe(35);
  });

  it('reset() clears back to idle', () => {
    const { result } = renderHook(() => useHoldTimer());
    act(() => result.current.start());
    tickSeconds(10);
    act(() => {
      result.current.stop();
    });
    act(() => {
      result.current.reset();
    });
    expect(result.current.elapsed).toBeNull();
    expect(result.current.running).toBe(false);
  });

  it('restart while running re-anchors from zero', () => {
    const { result } = renderHook(() => useHoldTimer());
    act(() => result.current.start());
    tickSeconds(20);
    act(() => result.current.start());
    expect(result.current.elapsed).toBe(0);
    tickSeconds(3);
    expect(result.current.elapsed).toBe(3);
  });
});
