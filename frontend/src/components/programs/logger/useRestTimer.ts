import { useCallback, useEffect, useRef, useState } from 'react';

// =============================================================================
// useRestTimer — countdown for the hub+focus logger's REST m:ss pill.
// `start(sec)` (re)arms the countdown; `remaining` ticks down once per second
// and becomes null at 0 (idle). Restart-while-running simply resets the value.
//
// Wall-clock anchored: rather than decrementing state on a setTimeout chain
// (which drifts/freezes when the tab or phone screen is backgrounded — the
// primary use case, resting between sets with the phone locked), we store the
// timestamp the rest period ends at and derive `remaining` from Date.now() on
// every tick. A `visibilitychange` listener forces an immediate recompute when
// the phone unlocks, so the displayed value snaps to the true remaining time
// rather than waiting for the next 1s tick.
// =============================================================================

export function useRestTimer(): {
  remaining: number | null;
  start: (sec: number) => void;
} {
  const [remaining, setRemaining] = useState<number | null>(null);
  const endAtRef = useRef<number | null>(null);

  const recompute = useCallback(() => {
    const endAt = endAtRef.current;
    if (endAt == null) return;
    const left = Math.ceil((endAt - Date.now()) / 1000);
    if (left <= 0) {
      endAtRef.current = null;
      setRemaining(null);
    } else {
      setRemaining(left);
    }
  }, []);

  useEffect(() => {
    if (remaining === null) return;
    const t = setTimeout(recompute, 1000);
    return () => clearTimeout(t);
  }, [remaining, recompute]);

  useEffect(() => {
    const onVisible = () => {
      if (document.visibilityState === 'visible') recompute();
    };
    document.addEventListener('visibilitychange', onVisible);
    return () => document.removeEventListener('visibilitychange', onVisible);
  }, [recompute]);

  const start = useCallback((sec: number) => {
    endAtRef.current = Date.now() + sec * 1000;
    setRemaining(sec);
  }, []);

  return { remaining, start };
}
