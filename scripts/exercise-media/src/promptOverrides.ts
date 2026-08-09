import type { Frame } from './prompt.js';

// The review loop lives here: when the user rejects an image, add/adjust the
// slug's entry and re-run `npm run generate -- --slug <slug> --force`.

/** Replaces the callout-derived position line for one frame of one exercise. */
export const positionOverrides: Record<string, Partial<Record<Frame, string>>> = {
  // 2026-07-08 cull round 1: no Slingshot band at all. Round 2: band showed up
  // but looped over the BAR instead of the arms — hence the explicit
  // sleeve-on-each-forearm framing and the bar-contact ban.
  'slingshot-bench-press': {
    end: 'He lies on a flat bench pressing a barbell while wearing a red elastic Slingshot bench-press band: a wide red fabric sleeve wraps around EACH forearm just above the elbow, and the red band stretches taut between the two forearms, spanning across his chest like a hammock. The band touches ONLY his two forearms — it never wraps around, loops over, or touches the barbell. The bar is at the lowest point of the rep, just above his chest, elbows bent about 75°, feet flat on the floor.',
  },
  // 2026-07-08 cull rounds 3–4: every "seated leg curl" render came back on a
  // leg EXTENSION chassis (front-pivot roller arm) — the two machines are
  // near-identical from this camera angle and the model's prior always wins.
  // Switched to the LYING leg curl, which cannot be confused with an
  // extension machine; the guide is variant-agnostic ("Leg Curl (Machine)",
  // callout says "seat or thigh pad").
  'leg-curl-machine': {
    start:
      'He lies FACE-DOWN (prone) on a lying leg curl machine: chest and hips flat on the angled bench pad, legs extended straight out behind him, the padded ankle roller resting on the back of his lower calves just above the heels. Hands grip the handles under the head end of the bench. Legs fully straight: the stretched set position before the first rep.',
    end:
      'He lies FACE-DOWN (prone) on a lying leg curl machine, at the TOP of the rep: knees bent so his heels are curled up toward his glutes, shins vertical, the padded ankle roller pressed against the back of his lower calves near the top of the arc. Chest and hips stay flat on the bench pad, hands gripping the handles under the head end. Hamstrings fully contracted.',
  },
  // 2026-07-08 cull round 2: end frame was flat-footed — near-identical to the
  // start frame, which defeats the start/end toggle.
  'dumbbell-standing-calf-raise': {
    end: 'He stands on the balls of his feet at the edge of a low platform, heels lifted as HIGH as possible — a full calf raise at peak height, ankles fully extended, clear daylight visible under both heels. One hand holds a dumbbell at his side, the other lightly braces the power rack upright for balance. Legs straight, body tall.',
  },
  // 2026-07-08 cull round 3: cable ran from a DIFFERENT machine behind him
  // while the station he faced had an empty carabiner.
  'cable-crunch': {
    start:
      'He kneels on the floor directly FACING a cable machine, close to it. A black rope attachment hangs from the high pulley of THAT machine — the one he faces — and its cable runs only to that pulley, nothing else. He holds one rope end in each hand beside his temples, elbows bent, torso upright and tall, hips over knees: the set position the instant before crunching down.',
  },
  // 2026-07-08 cull round 2: bar so low his feet read as touching the floor.
  pullup: {
    start: 'He hangs from a HIGH pull-up bar in a full dead hang: arms completely straight overhead, shoulders relaxed, body hanging vertically with both feet clearly OFF the floor — at least a foot of visible open air between his shoes and the gym floor. Knees straight or very slightly bent, toes pointed down.',
  },
  // 2026-07-08 cull: batch image faced the cable stack, which removes the
  // anti-rotation component entirely.
  'cable-pallof-press': {
    end: 'He stands SIDEWAYS to the cable machine — the cable runs horizontally from his side at chest height, NOT from in front. Feet shoulder-width, knees soft, both hands clasped on the single handle, arms fully extended straight out from the center of his chest, torso square to the camera and visibly resisting the sideways pull of the cable.',
  },
};

/**
 * Replaces the entire gym STYLE_BLOCK for exercises whose scene isn't a gym.
 * Currently empty: gait/cardio exercises are excluded from photo generation
 * entirely (product decision 2026-07-07), which retired the outdoor-walking
 * override that lived here.
 */
export const sceneOverrides: Record<string, string> = {};
