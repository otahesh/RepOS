import { test } from 'node:test';
import assert from 'node:assert/strict';
import { renderContactSheet } from './contactSheet.js';

test('contact sheet lists each slug with start/end imgs and the prompt', () => {
  const html = renderContactSheet([
    {
      slug: 'barbell-back-squat',
      name: 'Barbell Back Squat',
      frames: { start: 'barbell-back-squat-start.png', end: 'barbell-back-squat-end.png' },
      prompts: { start: 'PROMPT-START', end: 'PROMPT-END' },
    },
    { slug: 'lat-pulldown', name: 'Lat Pulldown', frames: { start: 'lat-pulldown-start.png' }, prompts: { start: 'P' } },
  ]);
  assert.ok(html.includes('barbell-back-squat-start.png'));
  assert.ok(html.includes('barbell-back-squat-end.png'));
  assert.ok(html.includes('Barbell Back Squat'));
  assert.ok(html.includes('PROMPT-START'));
  assert.ok(html.includes('missing'), 'absent end frame is marked missing');
});
