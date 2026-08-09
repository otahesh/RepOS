import { test } from 'node:test';
import assert from 'node:assert/strict';
import { extractImage, isRetryable, backoffMs } from './gemini.js';

test('extractImage returns decoded inline image data', () => {
  const png = Buffer.from('fake-png-bytes');
  const body = {
    candidates: [
      {
        content: {
          parts: [
            { text: 'Here is your image.' },
            { inlineData: { mimeType: 'image/png', data: png.toString('base64') } },
          ],
        },
      },
    ],
  };
  const out = extractImage(body);
  assert.equal(out.mimeType, 'image/png');
  assert.deepEqual(out.data, png);
});

test('extractImage throws with the text part when no image came back', () => {
  const body = {
    candidates: [{ content: { parts: [{ text: 'I cannot generate that.' }] } }],
  };
  assert.throws(() => extractImage(body), /I cannot generate that/);
});

test('extractImage throws on empty/blocked responses', () => {
  assert.throws(() => extractImage({}), /no candidates/i);
});

test('isRetryable: 429 and 5xx retry, 400/403 do not', () => {
  assert.equal(isRetryable(429), true);
  assert.equal(isRetryable(500), true);
  assert.equal(isRetryable(503), true);
  assert.equal(isRetryable(400), false);
  assert.equal(isRetryable(403), false);
});

test('backoffMs grows exponentially and is capped', () => {
  assert.ok(backoffMs(0) >= 1000 && backoffMs(0) < 2000);
  assert.ok(backoffMs(3) >= 8000 && backoffMs(3) < 9000);
  assert.ok(backoffMs(10) <= 61000);
});
