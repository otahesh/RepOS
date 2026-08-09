import { test } from 'node:test';
import assert from 'node:assert/strict';
import { renderManifestModule } from './manifestModule.js';

test('renders a sorted, always-expanded manifest module from webp filenames', () => {
  const out = renderManifestModule([
    'lat-pulldown-start.webp',
    'barbell-back-squat-end.webp',
    'barbell-back-squat-start.webp',
  ]);
  assert.ok(out.includes('GENERATED'));
  // Always-expanded entries: a one-line form would exceed prettier's
  // printWidth 100 and fail api's format:check on every regeneration.
  assert.ok(
    out.includes(
      "  'barbell-back-squat': {\n" +
        "    start: '/exercise-media/barbell-back-squat-start.webp',\n" +
        "    end: '/exercise-media/barbell-back-squat-end.webp',\n" +
        '  },',
    ),
  );
  assert.ok(
    out.includes(
      "  'lat-pulldown': {\n    start: '/exercise-media/lat-pulldown-start.webp',\n  },",
    ),
  );
  assert.ok(out.indexOf('barbell-back-squat') < out.indexOf('lat-pulldown'), 'sorted by slug');
});

test('rejects filenames that do not match the slug-frame contract', () => {
  assert.throws(() => renderManifestModule(['README.md']), /unexpected file/);
  assert.throws(() => renderManifestModule(['squat-side.webp']), /unexpected file/);
});

test('empty list renders an empty record', () => {
  assert.ok(renderManifestModule([]).includes('= {};'));
});
