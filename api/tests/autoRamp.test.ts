import { describe, it, expect } from 'vitest';
import { computeRamp, distributeWeekTargetAcrossBlocks } from '../src/services/autoRamp.js';

// MRV_target = MRV - 1 (the steeper ramp the spec calls for; replaces the
// prior MAV+2 cap). For chest defaults MEV=10, MAV=14, MRV=22:
//   - prior MAV+2 cap would top out at 16 sets/wk
//   - new MRV-1 cap tops out at 21 sets/wk

describe('computeRamp (spec §5.2)', () => {
  it('week 1 returns MEV', () => {
    expect(computeRamp({ mev: 10, mav: 14, mrv: 22, week: 1, totalWeeks: 5 })).toBe(10);
  });

  it('last accumulation week (N-1) returns MRV-1', () => {
    // N=5 → accumulation weeks 1..4, deload week 5.
    // sets_in_week(4) = round(MEV + (MRV-1 - MEV) * (4-1)/max(N-2,1))
    //                 = round(10 + (21 - 10) * 3/3) = 21
    expect(computeRamp({ mev: 10, mav: 14, mrv: 22, week: 4, totalWeeks: 5 })).toBe(21);
  });

  it('mid-week interpolates (round to nearest)', () => {
    // week 2 of 5 → 10 + 11 * 1/3 = 13.66.. → 14
    expect(computeRamp({ mev: 10, mav: 14, mrv: 22, week: 2, totalWeeks: 5 })).toBe(14);
    // week 3 of 5 → 10 + 11 * 2/3 = 17.33.. → 17
    expect(computeRamp({ mev: 10, mav: 14, mrv: 22, week: 3, totalWeeks: 5 })).toBe(17);
  });

  it('deload week (N) returns round(MEV/2)', () => {
    expect(computeRamp({ mev: 10, mav: 14, mrv: 22, week: 5, totalWeeks: 5 })).toBe(5);
    // odd MEV: round(7/2) = 4 (banker's? plain Math.round is 4)
    expect(computeRamp({ mev: 7, mav: 12, mrv: 20, week: 5, totalWeeks: 5 })).toBe(4);
  });

  it('uses MRV-1 ceiling, NOT MAV+2 (regression vs prior spec)', () => {
    // chest defaults MEV=10 MAV=14 MRV=22. Last accum week must be 21
    // (=MRV-1). If implementation still capped at MAV+2 it would be 16.
    const last = computeRamp({ mev: 10, mav: 14, mrv: 22, week: 4, totalWeeks: 5 });
    expect(last).toBe(21);
    expect(last).toBeGreaterThan(16);   // explicit: > MAV+2
  });

  it('MEV = MAV edge — ramp is monotonic non-decreasing', () => {
    // glutes MEV=4 MAV=12 MRV=16; pretend a muscle with MEV==MAV: MEV=8 MAV=8 MRV=10
    const w1 = computeRamp({ mev: 8, mav: 8, mrv: 10, week: 1, totalWeeks: 5 });
    const w4 = computeRamp({ mev: 8, mav: 8, mrv: 10, week: 4, totalWeeks: 5 });
    expect(w1).toBe(8);
    expect(w4).toBe(9); // MRV_target = 9
    expect(w4).toBeGreaterThanOrEqual(w1);
  });

  it('very-low-MRV muscles still ramp without going negative', () => {
    // smallest landmark on the table is glutes MEV=4 MAV=12 MRV=16
    const w1 = computeRamp({ mev: 4, mav: 12, mrv: 16, week: 1, totalWeeks: 5 });
    const w4 = computeRamp({ mev: 4, mav: 12, mrv: 16, week: 4, totalWeeks: 5 });
    const wD = computeRamp({ mev: 4, mav: 12, mrv: 16, week: 5, totalWeeks: 5 });
    expect(w1).toBe(4);
    expect(w4).toBe(15); // MRV-1
    expect(wD).toBe(2);  // round(4/2)
    [w1, w4, wD].forEach(v => expect(v).toBeGreaterThanOrEqual(0));
  });

  it('4-week meso (N=4): max(N-2, 1) keeps ramp well-defined', () => {
    // sets_in_week(w) = round(MEV + (MRV-1 - MEV) * (w-1)/max(2,1))
    expect(computeRamp({ mev: 10, mav: 14, mrv: 22, week: 1, totalWeeks: 4 })).toBe(10);
    expect(computeRamp({ mev: 10, mav: 14, mrv: 22, week: 3, totalWeeks: 4 })).toBe(21);
    expect(computeRamp({ mev: 10, mav: 14, mrv: 22, week: 4, totalWeeks: 4 })).toBe(5);
  });

  it('1-week meso (smoke): week 1 == deload', () => {
    // N=1 → deload week is week 1
    expect(computeRamp({ mev: 10, mav: 14, mrv: 22, week: 1, totalWeeks: 1 })).toBe(5);
  });
});

describe('distributeWeekTargetAcrossBlocks (spec §5.2)', () => {
  it('single block → all sets to that block', () => {
    const out = distributeWeekTargetAcrossBlocks(
      [{ blockKey: 'a', mev: 6 }],
      14,
    );
    expect(out).toEqual([{ blockKey: 'a', sets: 14 }]);
  });

  it('two blocks proportional to MEV-allocation', () => {
    // compound 6 MEV + isolation 2 MEV → 6:2 = 3:1 split of the week target
    const out = distributeWeekTargetAcrossBlocks(
      [{ blockKey: 'compound', mev: 6 }, { blockKey: 'isolation', mev: 2 }],
      16,
    );
    // 16 * 6/8 = 12, 16 * 2/8 = 4
    expect(out).toEqual([
      { blockKey: 'compound', sets: 12 },
      { blockKey: 'isolation', sets: 4 },
    ]);
  });

  it('rounds fractional shares and reconciles total to weekTarget', () => {
    // 3 blocks 5/3/2 MEV, target 11 → raw 5.5 / 3.3 / 2.2
    // round → 6 / 3 / 2 = 11 (already correct)
    const out = distributeWeekTargetAcrossBlocks(
      [
        { blockKey: 'a', mev: 5 },
        { blockKey: 'b', mev: 3 },
        { blockKey: 'c', mev: 2 },
      ],
      11,
    );
    const total = out.reduce((s, b) => s + b.sets, 0);
    expect(total).toBe(11); // exact reconciliation
    expect(out[0].sets).toBeGreaterThanOrEqual(out[1].sets);
    expect(out[1].sets).toBeGreaterThanOrEqual(out[2].sets);
  });

  it('reconciles when rounding overshoots/undershoots', () => {
    // 3 equal blocks, target 10 → 3.33 each → naive round 3+3+3=9 (under)
    const out = distributeWeekTargetAcrossBlocks(
      [{ blockKey: 'a', mev: 1 }, { blockKey: 'b', mev: 1 }, { blockKey: 'c', mev: 1 }],
      10,
    );
    expect(out.reduce((s, b) => s + b.sets, 0)).toBe(10);
  });

  it('zero-MEV block treated as zero share (no NaN)', () => {
    const out = distributeWeekTargetAcrossBlocks(
      [{ blockKey: 'a', mev: 8 }, { blockKey: 'b', mev: 0 }],
      8,
    );
    expect(out.find(b => b.blockKey === 'b')!.sets).toBe(0);
    expect(out.reduce((s, b) => s + b.sets, 0)).toBe(8);
  });

  it('all-zero MEV defaults to even split', () => {
    const out = distributeWeekTargetAcrossBlocks(
      [{ blockKey: 'a', mev: 0 }, { blockKey: 'b', mev: 0 }],
      6,
    );
    expect(out.reduce((s, b) => s + b.sets, 0)).toBe(6);
    expect(out[0].sets).toBe(3);
    expect(out[1].sets).toBe(3);
  });

  it('weekTarget=0 (deload edge) → all blocks 0', () => {
    const out = distributeWeekTargetAcrossBlocks(
      [{ blockKey: 'a', mev: 5 }, { blockKey: 'b', mev: 3 }],
      0,
    );
    expect(out.every(b => b.sets === 0)).toBe(true);
  });
});
