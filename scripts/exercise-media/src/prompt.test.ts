import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildPrompt, STYLE_BLOCK } from './prompt.js';

const BASE = {
  name: 'Incline Dumbbell Bench Press',
  equipment: ['dumbbells', 'adjustable bench'],
  setupCallout: 'Bench: 30° — usually the 2nd incline notch.',
};

test('prompt contains style block, exercise, equipment, and callout', () => {
  const p = buildPrompt({ ...BASE, frame: 'start' });
  assert.ok(p.includes(STYLE_BLOCK));
  assert.ok(p.includes('Incline Dumbbell Bench Press'));
  assert.ok(p.includes('dumbbells, adjustable bench'));
  assert.ok(p.includes('Bench: 30°'));
});

test('start and end frames produce different position lines', () => {
  const start = buildPrompt({ ...BASE, frame: 'start' });
  const end = buildPrompt({ ...BASE, frame: 'end' });
  assert.notEqual(start, end);
  assert.match(start, /STARTING position/);
  assert.match(end, /END position/);
});

test('end frame is the turnaround point, not "peak contraction"', () => {
  // "Peak contraction" collapses start and end into the same pose for any
  // exercise that starts contracted (bench press lockout, RDL standing tall):
  // the 2026-07-07 validation run returned two near-identical frames for both.
  const end = buildPrompt({ ...BASE, frame: 'end' });
  assert.match(end, /turnaround point/i);
  assert.match(end, /furthest .* from the starting position/i);
  assert.doesNotMatch(end, /peak contraction/);
});

test('style block keeps bench and rack setup identical across frames', () => {
  // The bench-press validation pair used a plain flat bench at start and an
  // upright-equipped bench at end.
  assert.match(STYLE_BLOCK, /same bench, rack, and machine/i);
});

test('position override replaces the callout-derived line', () => {
  const p = buildPrompt({ ...BASE, frame: 'start', positionOverride: 'Lying back on a 30-degree bench, dumbbells resting on thighs.' });
  assert.ok(p.includes('dumbbells resting on thighs'));
  assert.ok(!p.includes('2nd incline notch'));
});

test('style block reads as an instructional how-to demonstration with perfect form', () => {
  assert.match(STYLE_BLOCK, /[Ii]nstructional/);
  assert.match(STYLE_BLOCK, /how to do this exercise/i);
  assert.match(STYLE_BLOCK, /PERFECT textbook form/);
  // User call 2026-07-07: the demonstrator should read as an experienced
  // lifter ("gym bro"), not an average build.
  assert.match(STYLE_BLOCK, /visibly muscular/);
});

test('style block pins equipment load so start and end frames match', () => {
  // The pilot's pro-model squat had an unloaded bar at start and a loaded bar
  // at end — frames generate independently, so the load must be in the prompt.
  assert.match(STYLE_BLOCK, /loaded identically in every image/);
  assert.match(STYLE_BLOCK, /matching pair/);
  assert.match(STYLE_BLOCK, /same equipment and load .* start and end/i);
  // Lighting drifts between independently-generated frames just like load did
  // (validation squat: bright white start, moody dark end).
  assert.match(STYLE_BLOCK, /same lighting/i);
});

test('style block keeps the text/label bans (poster style must not bake in text)', () => {
  assert.match(STYLE_BLOCK, /NO text/);
  assert.match(STYLE_BLOCK, /NO diagrams/);
  assert.match(STYLE_BLOCK, /NO arrows/);
  assert.match(STYLE_BLOCK, /NO logos/);
});

test('scene override replaces the gym style block entirely', () => {
  const p = buildPrompt({ ...BASE, frame: 'start', sceneOverride: 'Outdoor park path, overcast daylight.' });
  assert.ok(!p.includes(STYLE_BLOCK));
  assert.ok(p.includes('Outdoor park path'));
});
