import type { Frame } from './prompt.js';

// The review loop lives here: when the user rejects an image, add/adjust the
// slug's entry and re-run `npm run generate -- --slug <slug> --force`.

/** Replaces the callout-derived position line for one frame of one exercise. */
export const positionOverrides: Record<string, Partial<Record<Frame, string>>> = {};

/**
 * Replaces the entire gym STYLE_BLOCK for exercises that don't happen in a gym
 * (cardio is first-class — memory feedback_cardio_first_class).
 */
export const sceneOverrides: Record<string, string> = {
  'outdoor-walking-z2': `Photorealistic outdoor photograph.
The SAME athlete as the gym set: a man in his early 30s, average athletic build, short dark hair,
plain heather-gray t-shirt, black shorts, neutral dark training shoes.
Setting: a paved park path with trees, soft overcast daylight, no other people visible.
Camera: chest height, three-quarter side angle, full body in frame.
Composition: 4:3 landscape orientation.
Strictly NO text, NO lettering, NO logos, NO watermarks, NO other people.`,
};
