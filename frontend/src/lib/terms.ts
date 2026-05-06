export type TermDef = {
  short: string;
  full: string;
  plain: string;
  whyMatters: string;
  citation?: { label: string; url: string };
};

export type TermKey =
  | 'RIR' | 'RPE' | 'MEV' | 'MAV' | 'MRV'
  | 'mesocycle' | 'deload' | 'hypertrophy' | 'AMRAP'
  | 'Z2' | 'Z4' | 'Z5'
  | 'peak_tension_length'
  | 'push_horizontal' | 'pull_horizontal'
  | 'push_vertical' | 'pull_vertical'
  | 'hinge' | 'squat' | 'lunge' | 'carry'
  | 'rotation' | 'anti_rotation'
  | 'compound' | 'isolation'
  | 'accumulation' | 'working_set';

export const TERMS: Record<TermKey, TermDef> = {
  RIR: {
    short: 'RIR',
    full: 'Reps in Reserve',
    plain: 'How many more reps you could do before failure on this set.',
    whyMatters: 'Higher RIR = more left in the tank. RepOS dials intensity week-to-week with RIR so you ramp without burning out.',
  },
  RPE: {
    short: 'RPE',
    full: 'Rate of Perceived Exertion',
    plain: 'A 1–10 scale of how hard a set felt. RPE 10 is true failure.',
    whyMatters: 'RPE and RIR are interchangeable: RPE 8 ≈ RIR 2. RepOS speaks RIR; convert if you prefer RPE.',
  },
  MEV: {
    short: 'MEV',
    full: 'Minimum Effective Volume',
    plain: 'The lowest weekly set count that still grows a muscle.',
    whyMatters: 'Below MEV, you maintain — you don\'t grow. Auto-ramp starts each mesocycle here.',
  },
  MAV: {
    short: 'MAV',
    full: 'Maximum Adaptive Volume',
    plain: 'The set count where most growth happens for most people.',
    whyMatters: 'The fat part of the bell curve. Not the most volume — the most-productive volume.',
  },
  MRV: {
    short: 'MRV',
    full: 'Maximum Recoverable Volume',
    plain: 'The most weekly volume you can recover from inside one mesocycle.',
    whyMatters: 'Crossing MRV stalls you. RepOS ramps to MRV-1 then deloads.',
  },
  mesocycle: {
    short: 'mesocycle',
    full: 'Mesocycle',
    plain: 'A 4–6 week training block — a few hard weeks plus a deload.',
    whyMatters: 'The atomic unit of programming in RepOS. Volume ramps within it; you reset between them.',
  },
  deload: {
    short: 'deload',
    full: 'Deload week',
    plain: 'A planned light week — fewer sets, more reps in reserve — to dump fatigue.',
    whyMatters: 'You don\'t adapt to training; you adapt to training plus recovery. Deload is the recovery.',
  },
  hypertrophy: {
    short: 'hypertrophy',
    full: 'Hypertrophy',
    plain: 'Muscle growth — increase in muscle fiber size.',
    whyMatters: 'The training goal RepOS is built around. Different rep ranges and RIR than strength or endurance.',
  },
  AMRAP: {
    short: 'AMRAP',
    full: 'As Many Reps As Possible',
    plain: 'A set taken to technical failure or near-failure with no rep cap.',
    whyMatters: 'In v1, RepOS caps RIR at 1. AMRAP is reserved for v2 when isolation can run to failure.',
  },
  Z2: {
    short: 'Z2',
    full: 'Heart-rate Zone 2',
    plain: 'Easy aerobic effort — you can hold a conversation. Roughly 60–70% of max HR.',
    whyMatters: 'Builds aerobic base without competing with strength recovery. Stack-able same-day with heavy lower.',
  },
  Z4: {
    short: 'Z4',
    full: 'Heart-rate Zone 4',
    plain: 'Threshold effort — hard, sustainable for ~30 minutes.',
    whyMatters: 'High interference with strength training. RepOS warns if scheduled within 4h of heavy lower.',
  },
  Z5: {
    short: 'Z5',
    full: 'Heart-rate Zone 5',
    plain: 'VO2 max effort — short intervals, can\'t sustain past minutes.',
    whyMatters: 'Maximum interference. Don\'t schedule day-before heavy lower.',
  },
  peak_tension_length: {
    short: 'peak tension',
    full: 'Peak tension at long muscle length',
    plain: 'Maximum mechanical tension delivered at the stretched portion of a movement.',
    whyMatters: 'Long-length emphasis grows muscle faster per set. RepOS substitution-ranker prefers exercises that share this property.',
  },
  push_horizontal: {
    short: 'horizontal push',
    full: 'Horizontal push pattern',
    plain: 'Pushing weight away from your chest, e.g. bench press.',
    whyMatters: 'One of seven movement patterns RepOS uses to classify and substitute exercises.',
  },
  pull_horizontal: {
    short: 'horizontal pull',
    full: 'Horizontal pull pattern',
    plain: 'Pulling weight toward your torso, e.g. row variants.',
    whyMatters: 'Pairs with horizontal push for shoulder-health balance — RepOS warns when one outweighs the other.',
  },
  push_vertical: {
    short: 'vertical push',
    full: 'Vertical push pattern',
    plain: 'Pressing weight overhead, e.g. shoulder press.',
    whyMatters: 'Stresses front delt and triceps differently than horizontal push.',
  },
  pull_vertical: {
    short: 'vertical pull',
    full: 'Vertical pull pattern',
    plain: 'Pulling weight from above to your torso, e.g. pull-up, lat pulldown.',
    whyMatters: 'Pairs with vertical push for healthy shoulder mobility.',
  },
  hinge: {
    short: 'hinge',
    full: 'Hip hinge',
    plain: 'Bending at the hips with a flat back, e.g. Romanian deadlift.',
    whyMatters: 'Trains hamstrings, glutes, and spinal erectors. Distinct from squat pattern.',
  },
  squat: {
    short: 'squat',
    full: 'Squat pattern',
    plain: 'Bending hips and knees together to lower your body, e.g. back squat.',
    whyMatters: 'Quad-dominant — hits quads, glutes, and adductors.',
  },
  lunge: {
    short: 'lunge',
    full: 'Lunge pattern',
    plain: 'Single-leg squat with a split stance, e.g. Bulgarian split squat.',
    whyMatters: 'Higher demand on stabilizers and glutes than bilateral squats.',
  },
  carry: {
    short: 'carry',
    full: 'Carry pattern',
    plain: 'Walking under load, e.g. farmer\'s carry.',
    whyMatters: 'Trains grip and core stiffness under fatigue. Out of v1 catalog scope.',
  },
  rotation: {
    short: 'rotation',
    full: 'Rotation pattern',
    plain: 'Twisting against load, e.g. cable woodchop.',
    whyMatters: 'Trunk power transfer for sport. Out of v1 catalog scope.',
  },
  anti_rotation: {
    short: 'anti-rotation',
    full: 'Anti-rotation pattern',
    plain: 'Resisting twist under load, e.g. Pallof press.',
    whyMatters: 'Trains trunk stability — what your spine actually wants in real life.',
  },
  compound: {
    short: 'compound',
    full: 'Compound exercise',
    plain: 'A movement that crosses two or more joints, e.g. squat, bench, row.',
    whyMatters: 'High systemic fatigue, more total muscle worked, larger strength gains. Ramps slower than isolation.',
  },
  isolation: {
    short: 'isolation',
    full: 'Isolation exercise',
    plain: 'A movement that crosses one joint, e.g. curl, lateral raise, leg extension.',
    whyMatters: 'Lower systemic fatigue, targets specific muscles, ramps faster than compound.',
  },
  accumulation: {
    short: 'accumulation',
    full: 'Accumulation phase',
    plain: 'The hard weeks of a mesocycle, between intro and deload. Volume ramps each week.',
    whyMatters: 'Where the actual training stimulus lives.',
  },
  working_set: {
    short: 'working set',
    full: 'Working set',
    plain: 'A set at the prescribed RIR target — counted toward weekly volume.',
    whyMatters: 'Warmup sets don\'t count toward volume. Working sets do.',
  },
};
