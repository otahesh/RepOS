import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useRestTimer } from './useRestTimer';

// The hook chains one setTimeout per second (each re-armed in a React effect),
// so tests advance the clock in 1s steps — a single multi-second advance would
// only fire the first pending timeout before React flushes the next effect.
function tickSeconds(n: number) {
  for (let i = 0; i < n; i++) {
    act(() => {
      vi.advanceTimersByTime(1000);
    });
  }
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
});
