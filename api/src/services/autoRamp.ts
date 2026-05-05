// Volume auto-ramp per spec §5.2. Pure; no IO.

export type RampInput = {
  mev: number;
  mav: number;     // carried for caller convenience; formula only uses mev + mrv
  mrv: number;
  week: number;       // 1-indexed
  totalWeeks: number; // N (deload is week N)
};

/**
 * Sets-per-muscle-per-week.
 *
 *   MRV_target      = MRV - 1
 *   sets_in_week(w) = round( MEV + (MRV_target - MEV) * (w - 1) / max(N - 2, 1) )  for w in 1..N-1
 *   sets_in_week(N) = round( MEV / 2 )                                              deload
 */
export function computeRamp(input: RampInput): number {
  const { mev, mrv, week, totalWeeks } = input;
  if (week === totalWeeks) return Math.round(mev / 2); // deload
  const mrvTarget = mrv - 1;
  const denom = Math.max(totalWeeks - 2, 1);
  const raw = mev + (mrvTarget - mev) * ((week - 1) / denom);
  return Math.round(raw);
}
