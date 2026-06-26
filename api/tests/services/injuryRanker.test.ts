import { describe, it, expect } from 'vitest';
import {
  jointRoot,
  applyInjuryAdvisory,
  type RankerCandidate,
} from '../../src/services/injuryRanker.js';

describe('jointRoot', () => {
  it('maps lateralized keys to joint_stress_profile root', () => {
    expect(jointRoot('knee_left')).toBe('knee');
    expect(jointRoot('shoulder_right')).toBe('shoulder');
    expect(jointRoot('low_back')).toBe('lumbar');
    expect(jointRoot('elbow')).toBe('elbow');
    expect(jointRoot('wrist')).toBe('wrist');
  });
});

describe('applyInjuryAdvisory', () => {
  const cands: RankerCandidate[] = [
    {
      id: 'a',
      slug: 'leg-press',
      name: 'Leg Press',
      score: 500,
      reason: '',
      joint_stress_profile: { _v: 1, knee: 'low' },
    },
    {
      id: 'b',
      slug: 'back-squat',
      name: 'Back Squat',
      score: 480,
      reason: '',
      joint_stress_profile: { _v: 1, knee: 'high', lumbar: 'mod' },
    },
    {
      id: 'c',
      slug: 'bss',
      name: 'BSS',
      score: 400,
      reason: '',
      joint_stress_profile: { _v: 1, knee: 'mod' },
    },
  ];

  it('passes through unchanged when no injuries', async () => {
    const out = await applyInjuryAdvisory(cands, []);
    expect(out).toEqual(cands);
  });

  it('penalizes high-load by 300 × severity-factor, tags advisory', async () => {
    const out = await applyInjuryAdvisory(cands, [{ joint: 'knee_left', severity: 'mod' }]);
    const squat = out.find((c) => c.slug === 'back-squat')!;
    // stress=high (300) × severity=mod (1.0) = -300
    expect(squat.score).toBe(180);
    expect(squat.injury_advisory).toEqual({ joint: 'knee_left', level: 'high' });
  });

  it('severity=low halves the penalty (FIX-26)', async () => {
    const out = await applyInjuryAdvisory(cands, [{ joint: 'knee_left', severity: 'low' }]);
    const squat = out.find((c) => c.slug === 'back-squat')!;
    // 300 × 0.5 = 150 penalty
    expect(squat.score).toBe(330);
  });

  it('severity=high amplifies penalty (FIX-26)', async () => {
    const out = await applyInjuryAdvisory(cands, [{ joint: 'knee_left', severity: 'high' }]);
    const squat = out.find((c) => c.slug === 'back-squat')!;
    // 300 × 1.5 = 450 penalty
    expect(squat.score).toBe(30);
  });

  it('penalizes mod-load by 150 × severity, tags advisory', async () => {
    const out = await applyInjuryAdvisory(cands, [{ joint: 'knee_left', severity: 'mod' }]);
    const bss = out.find((c) => c.slug === 'bss')!;
    expect(bss.score).toBe(250);
    expect(bss.injury_advisory).toEqual({ joint: 'knee_left', level: 'mod' });
  });

  it('leaves low-load candidates untagged', async () => {
    const out = await applyInjuryAdvisory(cands, [{ joint: 'knee_left', severity: 'mod' }]);
    const lp = out.find((c) => c.slug === 'leg-press')!;
    expect(lp.score).toBe(500);
    expect(lp.injury_advisory).toBeUndefined();
  });

  it('re-sorts by adjusted score (lp > bss > squat now)', async () => {
    const out = await applyInjuryAdvisory(cands, [{ joint: 'knee_left', severity: 'mod' }]);
    expect(out.map((c) => c.slug)).toEqual(['leg-press', 'bss', 'back-squat']);
  });

  it('keeps highest-penalty when two injuries match same candidate', async () => {
    const out = await applyInjuryAdvisory(cands, [
      { joint: 'knee_left', severity: 'mod' },
      { joint: 'low_back', severity: 'mod' },
    ]);
    const squat = out.find((c) => c.slug === 'back-squat')!;
    // knee=high(300×1.0=300) vs lumbar=mod(150×1.0=150) — keep the higher
    expect(squat.injury_advisory).toEqual({ joint: 'knee_left', level: 'high' });
  });

  // [FIX-14] alphabetical tiebreaker
  it('same-root double-injury picks alphabetical winner with equal severity', async () => {
    const out = await applyInjuryAdvisory(cands, [
      { joint: 'knee_right', severity: 'mod' },
      { joint: 'knee_left', severity: 'mod' },
    ]);
    const squat = out.find((c) => c.slug === 'back-squat')!;
    // both map to 'knee', equal weight — alphabetical 'knee_left' wins
    expect(squat.injury_advisory?.joint).toBe('knee_left');
  });
});
