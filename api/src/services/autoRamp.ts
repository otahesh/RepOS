// Volume auto-ramp per spec §5.2. Pure; no IO.

export type RampInput = {
  mev: number;
  mav: number; // carried for caller convenience; formula only uses mev + mrv
  mrv: number;
  week: number; // 1-indexed
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

export type BlockRampInput = {
  mev: number;
  mav: number;
  week: number; // 1-indexed
  totalWeeks: number; // N (deload is week N)
};

/**
 * Per-block sets-per-session ramp, driven by the template author's mev/mav.
 *
 *   sets(w) = round( mev + (mav - mev) * (w - 1) / max(N - 2, 1) )  for w in 1..N-1
 *   sets(N) = max(1, round( mev / 2 ))                              deload
 *
 * Week 1 lands exactly on the block's MEV, the last accumulation week (N-1)
 * exactly on its MAV. This replaces the landmark-driven weekly-muscle
 * distribution, which concentrated an entire intermediate week's volume into
 * whatever few blocks a template gave a muscle (23-set sessions in 2-day
 * templates). Landmarks retain their real job: MAV/MRV warning thresholds.
 */
export function computeBlockRamp(input: BlockRampInput): number {
  const { mev, mav, week, totalWeeks } = input;
  if (week === totalWeeks) return Math.max(1, Math.round(mev / 2)); // deload
  const denom = Math.max(totalWeeks - 2, 1);
  return Math.round(mev + (mav - mev) * ((week - 1) / denom));
}

export type BlockMev = { blockKey: string; mev: number };
export type BlockSets = { blockKey: string; sets: number };

/**
 * Distribute a muscle's week target across that muscle's blocks proportional
 * to each block's MEV allocation. Result sums exactly to weekTarget.
 *
 * Algorithm:
 *  1. Compute raw share per block (MEV-weighted; if all zero, even split).
 *  2. Floor each share, track fractional remainders.
 *  3. Distribute the leftover sets (weekTarget - sum_floor) one-by-one to
 *     blocks with the largest remainders (largest-remainder method).
 */
export function distributeWeekTargetAcrossBlocks(
  blocks: BlockMev[],
  weekTarget: number,
): BlockSets[] {
  if (blocks.length === 0) return [];
  if (weekTarget <= 0) return blocks.map((b) => ({ blockKey: b.blockKey, sets: 0 }));

  const totalMev = blocks.reduce((s, b) => s + b.mev, 0);
  const raw =
    totalMev === 0
      ? blocks.map((b) => ({ blockKey: b.blockKey, share: weekTarget / blocks.length }))
      : blocks.map((b) => ({ blockKey: b.blockKey, share: weekTarget * (b.mev / totalMev) }));

  const floored = raw.map((r) => ({
    blockKey: r.blockKey,
    sets: Math.floor(r.share),
    remainder: r.share - Math.floor(r.share),
  }));
  let remaining = weekTarget - floored.reduce((s, b) => s + b.sets, 0);

  // Largest-remainder reconciliation (stable: original order on tiebreak).
  const order = [...floored]
    .map((b, i) => ({ ...b, idx: i }))
    .sort((a, b) => b.remainder - a.remainder || a.idx - b.idx);
  for (let i = 0; i < order.length && remaining > 0; i++) {
    floored[order[i].idx].sets += 1;
    remaining -= 1;
  }
  return floored.map((b) => ({ blockKey: b.blockKey, sets: b.sets }));
}
