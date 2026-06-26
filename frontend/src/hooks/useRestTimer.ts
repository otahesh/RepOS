import { useEffect, useState } from 'react';

export interface RestTimerArgs {
  /** ms epoch of last logged set; null means no set logged yet. */
  lastLoggedAt: number | null;
  /** Intended rest interval in seconds. */
  targetRestSec: number;
}

export interface RestTimerState {
  elapsedSec: number;
  /** `targetRestSec - elapsedSec`; negative when isOvertime. */
  remainingSec: number;
  isOvertime: boolean;
}

function compute(lastLoggedAt: number | null, targetRestSec: number): RestTimerState {
  if (lastLoggedAt === null) {
    return {
      elapsedSec: 0,
      remainingSec: targetRestSec,
      isOvertime: false,
    };
  }
  const elapsedSec = Math.floor((Date.now() - lastLoggedAt) / 1000);
  return {
    elapsedSec,
    remainingSec: targetRestSec - elapsedSec,
    isOvertime: elapsedSec > targetRestSec,
  };
}

/**
 * Rest-timer hook for the live logger. Re-computes every 1s while a set is
 * armed; no interval starts when `lastLoggedAt` is null. Recomputes immediately
 * when `lastLoggedAt` changes (e.g. user logs another set).
 */
export function useRestTimer(args: RestTimerArgs): RestTimerState {
  const { lastLoggedAt, targetRestSec } = args;
  const [state, setState] = useState<RestTimerState>(() => compute(lastLoggedAt, targetRestSec));

  useEffect(() => {
    setState(compute(lastLoggedAt, targetRestSec));
    if (lastLoggedAt === null) return;
    const id = setInterval(() => {
      setState(compute(lastLoggedAt, targetRestSec));
    }, 1000);
    return () => clearInterval(id);
  }, [lastLoggedAt, targetRestSec]);

  return state;
}
