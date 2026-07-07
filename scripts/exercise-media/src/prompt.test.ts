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

test('position override replaces the callout-derived line', () => {
  const p = buildPrompt({ ...BASE, frame: 'start', positionOverride: 'Lying back on a 30-degree bench, dumbbells resting on thighs.' });
  assert.ok(p.includes('dumbbells resting on thighs'));
  assert.ok(!p.includes('2nd incline notch'));
});

test('scene override replaces the gym style block entirely', () => {
  const p = buildPrompt({ ...BASE, frame: 'start', sceneOverride: 'Outdoor park path, overcast daylight.' });
  assert.ok(!p.includes(STYLE_BLOCK));
  assert.ok(p.includes('Outdoor park path'));
});
