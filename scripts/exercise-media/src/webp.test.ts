import { test } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import sharp from 'sharp';
import { convertToWebp, MAX_BYTES } from './webp.js';

async function makePng(dir: string, name: string, pixels: Buffer): Promise<string> {
  const p = path.join(dir, name);
  await sharp(pixels, { raw: { width: 1600, height: 1200, channels: 3 } }).png().toFile(p);
  return p;
}

test('a compressible image fits at the first quality rung', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'webp-'));
  // Structured pattern → compresses well → q82 fits on the first try.
  const pattern = Buffer.alloc(1600 * 1200 * 3);
  for (let i = 0; i < pattern.length; i++) pattern[i] = (i * 2654435761) % 255;
  const src = await makePng(dir, 'in.png', pattern);

  const dest = path.join(dir, 'out.webp');
  const { bytes, quality } = await convertToWebp(src, dest);
  assert.ok(fs.existsSync(dest));
  assert.equal(bytes, fs.statSync(dest).size);
  assert.ok(bytes <= MAX_BYTES, `expected ≤${MAX_BYTES}, got ${bytes}`);
  assert.equal(quality, 82, 'compressible input should not descend the ladder');
  const meta = await sharp(dest).metadata();
  assert.equal(meta.format, 'webp');
  assert.ok((meta.width ?? 0) <= 1280);
  fs.rmSync(dir, { recursive: true, force: true });
});

test('incompressible noise descends to the quality floor and commits with a warning', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'webp-'));
  // True random noise never fits the budget even at q42 — exercises the
  // full ladder descent AND the give-up path.
  const src = await makePng(dir, 'noise.png', crypto.randomFillSync(Buffer.alloc(1600 * 1200 * 3)));

  const dest = path.join(dir, 'noise.webp');
  const { bytes, quality } = await convertToWebp(src, dest);
  assert.equal(quality, 42, 'should give up at the ladder floor');
  assert.ok(bytes > MAX_BYTES, 'noise cannot fit the budget — file written anyway');
  assert.ok(fs.existsSync(dest));
  fs.rmSync(dir, { recursive: true, force: true });
});
