import { useEffect, useState } from 'react';

// =============================================================================
// useRestTimer — countdown for the hub+focus logger's REST m:ss pill.
// `start(sec)` (re)arms the countdown; `remaining` ticks down once per second
// and becomes null at 0 (idle). Restart-while-running simply resets the value.
// =============================================================================

export function useRestTimer(): {
  remaining: number | null;
  start: (sec: number) => void;
} {
  const [remaining, setRemaining] = useState<number | null>(null);

  useEffect(() => {
    if (remaining === null || remaining <= 0) return;
    const t = setTimeout(() => setRemaining((r) => (r === null ? null : r - 1)), 1000);
    return () => clearTimeout(t);
  }, [remaining]);

  return {
    remaining: remaining !== null && remaining > 0 ? remaining : null,
    start: (sec: number) => setRemaining(sec),
  };
}
