import { useCallback, useEffect, useRef, useState } from 'react';

// =============================================================================
// useHoldTimer — count-UP stopwatch for duration-set logging (side plank etc).
// Sibling of useRestTimer with the same wall-clock anchoring: `elapsed`
// derives from Date.now() minus the recorded start timestamp rather than a
// decrementing setTimeout chain, so a locked phone mid-hold stays correct; a
// visibilitychange listener forces an immediate recompute on unlock.
// stop() freezes the display and returns whole elapsed seconds for the
// duration input; reset() returns to idle.
// =============================================================================

export function useHoldTimer(): {
  elapsed: number | null;
  running: boolean;
  start: () => void;
  stop: () => number;
  reset: () => void;
} {
  const [elapsed, setElapsed] = useState<number | null>(null);
  const [running, setRunning] = useState(false);
  const startAtRef = useRef<number | null>(null);

  const recompute = useCallback(() => {
    const startAt = startAtRef.current;
    if (startAt == null) return;
    setElapsed(Math.floor((Date.now() - startAt) / 1000));
  }, []);

  useEffect(() => {
    if (!running) return;
    const t = setTimeout(recompute, 1000);
    return () => clearTimeout(t);
  }, [running, elapsed, recompute]);

  useEffect(() => {
    if (!running) return;
    const onVisible = () => {
      if (document.visibilityState === 'visible') recompute();
    };
    document.addEventListener('visibilitychange', onVisible);
    return () => document.removeEventListener('visibilitychange', onVisible);
  }, [running, recompute]);

  const start = useCallback(() => {
    startAtRef.current = Date.now();
    setElapsed(0);
    setRunning(true);
  }, []);

  const stop = useCallback((): number => {
    const startAt = startAtRef.current;
    const final = startAt == null ? 0 : Math.floor((Date.now() - startAt) / 1000);
    startAtRef.current = null;
    setRunning(false);
    setElapsed(final);
    return final;
  }, []);

  const reset = useCallback(() => {
    startAtRef.current = null;
    setRunning(false);
    setElapsed(null);
  }, []);

  return { elapsed, running, start, stop, reset };
}
