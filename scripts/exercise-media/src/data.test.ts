import { test } from 'node:test';
import assert from 'node:assert/strict';
import { listExerciseInfo } from './data.js';

test('every guide maps to an exercise with name, equipment list, and callout', () => {
  const infos = listExerciseInfo();
  assert.ok(infos.length >= 40, `expected ~44 exercises, got ${infos.length}`);
  for (const info of infos) {
    assert.match(info.slug, /^[a-z0-9-]+$/);
    assert.ok(info.name.length > 0, `${info.slug}: empty name`);
    assert.ok(info.setupCallout.length >= 40, `${info.slug}: callout too short`);
    assert.ok(Array.isArray(info.equipment));
    for (const eq of info.equipment) assert.ok(!eq.includes('_'), `${info.slug}: unhumanized equipment "${eq}"`);
  }
});

test('gait/cardio exercises are excluded — no photos for walking or biking', () => {
  const slugs = listExerciseInfo().map((i) => i.slug);
  assert.ok(!slugs.includes('outdoor-walking-z2'), 'walking should be excluded');
  assert.ok(!slugs.includes('recumbent-bike-steady-state'), 'bike should be excluded');
});

test('a known exercise resolves with humanized equipment', () => {
  const incline = listExerciseInfo().find((i) => i.slug === 'incline-dumbbell-bench-press');
  assert.ok(incline);
  assert.ok(incline.equipment.some((e) => e.includes('bench')));
});
