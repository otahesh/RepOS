export type TermDef = {
  short: string;
  full: string;
  plain: string;
  whyMatters: string;
  citation?: { label: string; url: string };
};

export type TermKey =
  | 'RIR'
  | 'RPE'
  | 'MV'
  | 'MEV'
  | 'MAV'
  | 'MRV'
  | 'landmark'
  | 'mesocycle'
  | 'deload'
  | 'hypertrophy'
  | 'AMRAP'
  | 'Z2'
  | 'Z4'
  | 'Z5'
  | 'peak_tension_length'
  | 'push_horizontal'
  | 'pull_horizontal'
  | 'push_vertical'
  | 'pull_vertical'
  | 'hinge'
  | 'squat'
  | 'lunge'
  | 'carry'
  | 'rotation'
  | 'anti_rotation'
  | 'compound'
  | 'isolation'
  | 'accumulation'
  | 'working_set'
  | 'PAT'
  | 'bearer_token'
  | 'session'
  | 'IANA_timezone'
  | 'truncated_ip_24'
  | 'PAR_Q'
  | 'core'
  | 'intro_week'
  | 'soft_gate'
  | 'manual_deload'
  | 'advisory_mode'
  | 'pacing';

export const TERMS: Record<TermKey, TermDef> = {
  RIR: {
    short: 'RIR',
    full: 'Reps in Reserve',
    plain: 'How many more reps you could do before failure on this set.',
    whyMatters:
      'Higher RIR = more left in the tank. RepOS dials intensity week-to-week with RIR so you ramp without burning out.',
  },
  RPE: {
    short: 'RPE',
    full: 'Rate of Perceived Exertion',
    plain: 'A 1–10 scale of how hard a set felt. RPE 10 is true failure.',
    whyMatters:
      'RPE and RIR are interchangeable: RPE 8 ≈ RIR 2. RepOS speaks RIR; convert if you prefer RPE.',
  },
  MV: {
    short: 'MV',
    full: 'Maintenance Volume',
    plain: "The set count that holds onto what you've built — below it you slowly shrink.",
    whyMatters:
      'A useful floor when life is heavy and you just need to not regress. Optional in the landmarks editor.',
  },
  MEV: {
    short: 'MEV',
    full: 'Minimum Effective Volume',
    plain: 'The lowest weekly set count that still grows a muscle.',
    whyMatters: "Below MEV, you maintain — you don't grow. Auto-ramp starts each mesocycle here.",
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
  landmark: {
    short: 'landmark',
    full: 'Volume landmark',
    plain: 'A weekly set count threshold — MV, MEV, MAV, or MRV — that anchors the volume ramp.',
    whyMatters:
      "Landmarks let RepOS ramp you from MEV toward MRV across a mesocycle, then deload. Edit them if defaults don't match your recovery.",
  },
  mesocycle: {
    short: 'mesocycle',
    full: 'Mesocycle',
    plain: 'A 4–6 week training block — a few hard weeks plus a deload.',
    whyMatters:
      'The atomic unit of programming in RepOS. Volume ramps within it; you reset between them.',
  },
  deload: {
    // [I-DELOAD-WEEK-TERM] `full`/`plain` now cover BOTH senses: a single light
    // week inside a mesocycle, OR an entire low-volume deload mesocycle.
    short: 'deload',
    full: 'Deload — a planned light week, or a whole light mesocycle',
    plain:
      'Either a single light week inside a mesocycle, or an entire low-volume mesocycle. Fewer sets, more reps in reserve. Both serve recovery.',
    whyMatters:
      'You adapt to training PLUS recovery, not training alone. Skipping a deload makes the next mesocycle worse, not better.',
  },
  hypertrophy: {
    short: 'hypertrophy',
    full: 'Hypertrophy',
    plain: 'Muscle growth — increase in muscle fiber size.',
    whyMatters:
      'The training goal RepOS is built around. Different rep ranges and RIR than strength or endurance.',
  },
  AMRAP: {
    short: 'AMRAP',
    full: 'As Many Reps As Possible',
    plain: 'A set taken to technical failure or near-failure with no rep cap.',
    whyMatters:
      'In v1, RepOS caps RIR at 1. AMRAP is reserved for v2 when isolation can run to failure.',
  },
  Z2: {
    short: 'Z2',
    full: 'Heart-rate Zone 2',
    plain: 'Easy aerobic effort — you can hold a conversation. Roughly 60–70% of max HR.',
    whyMatters:
      'Builds aerobic base without competing with strength recovery. Stack-able same-day with heavy lower.',
  },
  Z4: {
    short: 'Z4',
    full: 'Heart-rate Zone 4',
    plain: 'Threshold effort — hard, sustainable for ~30 minutes.',
    whyMatters:
      'High interference with strength training. RepOS warns if scheduled within 4h of heavy lower.',
  },
  Z5: {
    short: 'Z5',
    full: 'Heart-rate Zone 5',
    plain: "VO2 max effort — short intervals, can't sustain past minutes.",
    whyMatters: "Maximum interference. Don't schedule day-before heavy lower.",
  },
  peak_tension_length: {
    short: 'peak tension',
    full: 'Peak tension at long muscle length',
    plain: 'Maximum mechanical tension delivered at the stretched portion of a movement.',
    whyMatters:
      'Long-length emphasis grows muscle faster per set. RepOS substitution-ranker prefers exercises that share this property.',
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
    whyMatters:
      'Pairs with horizontal push for shoulder-health balance — RepOS warns when one outweighs the other.',
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
    plain: "Walking under load, e.g. farmer's carry.",
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
    whyMatters:
      'High systemic fatigue, more total muscle worked, larger strength gains. Ramps slower than isolation.',
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
    whyMatters: "Warmup sets don't count toward volume. Working sets do.",
  },
  PAT: {
    short: 'PAT',
    full: 'Personal Access Token',
    plain:
      'A long-lived token your iOS Shortcut or other automation uses to talk to RepOS on your behalf.',
    whyMatters:
      'Bearer tokens are device-level. If you lose a device, revoke that token here — your CF Access login on browsers is separate.',
  },
  bearer_token: {
    short: 'bearer token',
    full: 'Bearer token',
    plain:
      'A long secret string an automation sends with each request to prove it is allowed to act for you.',
    whyMatters:
      'Anyone with the secret can act as you. Revoke immediately if a device is lost or shared.',
  },
  session: {
    short: 'session',
    full: 'Active session',
    plain: 'A browser or device that has authenticated to RepOS and can call the API.',
    whyMatters:
      'Sign out everywhere ends all sessions and bearer tokens at once — useful if you suspect any device is compromised.',
  },
  IANA_timezone: {
    short: 'time zone',
    full: 'IANA time zone',
    plain:
      'The named time zone (like America/New_York) RepOS uses to compute "today" for your workouts.',
    whyMatters:
      "If your time zone is wrong, the home page may show yesterday's or tomorrow's workout instead of today's.",
  },
  truncated_ip_24: {
    short: 'IP /24',
    full: 'Truncated IP address (/24)',
    plain:
      'RepOS shows only the network portion of your last-used IP (e.g., 192.168.88.0/24) — not the exact address.',
    whyMatters:
      'Enough information for "did I sign in from work or home?" without storing your precise location across every session.',
  },
  PAR_Q: {
    short: 'PAR-Q',
    full: 'Physical Activity Readiness Questionnaire',
    plain:
      'A 9-question screen for conditions that need clinician sign-off before changing your training.',
    whyMatters:
      'A "yes" doesn\'t lock you out — it puts your program into advisory mode (volume capped at MEV, RIR floored at 3) until you clear it on the Settings → Health page.',
  },
  advisory_mode: {
    short: 'advisory mode',
    full: 'Clinical advisory mode',
    plain:
      'A precaution the app applies after a PAR-Q "yes". Your program stays at MEV (minimum-effective volume) with RIR floored at 3 instead of progressing through the normal ramp.',
    whyMatters:
      'It is reversible: once you have spoken to a clinician you can mark yourself cleared on Settings → Health and the program goes back to normal progression.',
  },
  core: {
    short: 'core',
    full: 'Core (abdominals + obliques + spinal stabilizers)',
    plain:
      'The muscles that resist or produce trunk motion — abs, obliques, and the deep stabilizers along your spine.',
    whyMatters:
      'Trained for stiffness more than size in RepOS. Anti-rotation work transfers to every other lift.',
  },
  intro_week: {
    short: 'intro week',
    full: 'Intro week',
    plain: 'Week 1 of a mesocycle — light loads, full RIR budget, a deliberate ramp-on.',
    whyMatters: 'Lets your tendons and CNS catch up to the new program before volume ramps.',
  },
  soft_gate: {
    short: 'soft gate',
    full: 'Soft gate',
    plain: 'An advisory the app shows but does not enforce.',
    whyMatters:
      'You can always click through. RepOS never hard-blocks training based on a self-reported answer.',
  },
  manual_deload: {
    short: 'manual deload',
    full: 'Manual deload',
    plain:
      'A user-triggered deload that rewrites the remaining weeks of your mesocycle to lighter sets at RIR 4.',
    whyMatters:
      'Use it when life pushes back — sick, slept badly, joint cranky. Undoable for 24 hours.',
  },
  pacing: {
    short: 'pacing',
    full: 'Pacing',
    plain: 'Pacing compares your progress to the original plan dates. It never blocks training.',
    whyMatters:
      'Dates are hints, not gates. Fall behind and RepOS simply offers the next workout when you return — you never lose a day.',
  },
};

// ---------------------------------------------------------------------------
// Beta W3.2/W3.3 — injury advisory copy
// ---------------------------------------------------------------------------
// Used by MidSessionSwapPicker to render a one-line warning under candidates
// the server-side injuryRanker tagged. Keys mirror the InjuryJoint enum
// (api/src/schemas/userInjuries.ts) and the SubstitutionCandidate.injury_advisory
// shape in api/src/services/substitutions.ts. The copy is intentionally plain
// ("you noted ...") — the user has already declared the joint in Settings.
export const INJURY_ADVISORY_COPY: Record<string, Record<'mod' | 'high', string>> = {
  shoulder_left: {
    mod: 'Moderate shoulder load — you noted left shoulder',
    high: 'High shoulder load — you noted left shoulder',
  },
  shoulder_right: {
    mod: 'Moderate shoulder load — you noted right shoulder',
    high: 'High shoulder load — you noted right shoulder',
  },
  low_back: {
    mod: 'Moderate low-back load — you noted low back',
    high: 'High low-back load — you noted low back',
  },
  knee_left: {
    mod: 'Moderate knee load — you noted left knee',
    high: 'High knee load — you noted left knee',
  },
  knee_right: {
    mod: 'Moderate knee load — you noted right knee',
    high: 'High knee load — you noted right knee',
  },
  elbow: {
    mod: 'Moderate elbow load — you noted elbow',
    high: 'High elbow load — you noted elbow',
  },
  wrist: {
    mod: 'Moderate wrist load — you noted wrist',
    high: 'High wrist load — you noted wrist',
  },
};

export function injuryAdvisoryCopy(joint: string, level: 'mod' | 'high'): string {
  return INJURY_ADVISORY_COPY[joint]?.[level] ?? 'Joint stress on this lift';
}
