import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useRestTimer } from './useRestTimer';

// The hook chains one setTimeout per second (each re-armed in a React effect),
// so tests advance the clock in 1s steps — a single multi-second advance would
// only fire the first pending timeout before React flushes the next effect.
// vi.useFakeTimers() also mocks Date, so advancing timers advances Date.now()
// in lockstep — that's what lets the wall-clock-anchored hook be tested at all.
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

describe('useRestTimer', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('is idle (remaining null) before start', () => {
    const { result } = renderHook(() => useRestTimer());
    expect(result.current.remaining).toBeNull();
  });

  it('start(150) → remaining 150, ticks down 1/sec, stops at 0 with remaining null', () => {
    const { result } = renderHook(() => useRestTimer());

    act(() => {
      result.current.start(150);
    });
    expect(result.current.remaining).toBe(150);

    tickSeconds(1);
    expect(result.current.remaining).toBe(149);

    tickSeconds(149);
    expect(result.current.remaining).toBeNull();

    // Timer is fully stopped — no pending timeouts keep ticking.
    expect(vi.getTimerCount()).toBe(0);
    tickSeconds(10);
    expect(result.current.remaining).toBeNull();
  });

  it('start() while running restarts from the new value', () => {
    const { result } = renderHook(() => useRestTimer());

    act(() => {
      result.current.start(100);
    });
    tickSeconds(10);
    expect(result.current.remaining).toBe(90);

    act(() => {
      result.current.start(30);
    });
    expect(result.current.remaining).toBe(30);

    tickSeconds(1);
    expect(result.current.remaining).toBe(29);
  });

  it('wall-clock anchored: a suspended/backgrounded timer catches up to the true remaining on the next tick, not a stale decrement', () => {
    const t0 = new Date('2026-07-06T12:00:00.000Z');
    vi.setSystemTime(t0);
    const { result } = renderHook(() => useRestTimer());

    act(() => {
      result.current.start(150);
    });
    expect(result.current.remaining).toBe(150);

    // Simulate the phone locking for 60s: the wall clock moves, but (as on a
    // suspended JS timer) no tick fires until the system wakes it back up.
    act(() => {
      vi.setSystemTime(new Date(t0.getTime() + 60_000));
    });
    expect(result.current.remaining).toBe(150); // still stale — no tick has run yet

    // A single timer tick fires (simulating the OS waking the JS runtime).
    // A naive decrement-by-1 hook would show 149; the wall-clock hook must
    // show the true elapsed remaining instead (~90s left, not 149s).
    act(() => {
      vi.advanceTimersByTime(1000);
    });
    expect(result.current.remaining).toBe(89);
  });

  it('visibilitychange forces an immediate recompute; elapsing fully in the background clears the timer on wake', () => {
    const t0 = new Date('2026-07-06T12:00:00.000Z');
    vi.setSystemTime(t0);
    setVisibility('visible');
    const { result } = renderHook(() => useRestTimer());

    act(() => {
      result.current.start(150);
    });

    // Hide the tab/lock the screen, then let the full rest period elapse
    // while backgrounded (no timer ticks fire — simulating suspension).
    setVisibility('hidden');
    act(() => {
      document.dispatchEvent(new Event('visibilitychange'));
    });
    act(() => {
      vi.setSystemTime(new Date(t0.getTime() + 200_000));
    });
    expect(result.current.remaining).toBe(150); // unchanged — still hidden, no recompute yet

    // Unlocking/foregrounding dispatches visibilitychange → immediate
    // recompute, which must find the rest period already elapsed.
    setVisibility('visible');
    act(() => {
      document.dispatchEvent(new Event('visibilitychange'));
    });
    expect(result.current.remaining).toBeNull();
  });
});
