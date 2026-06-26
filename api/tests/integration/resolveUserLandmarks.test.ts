import 'dotenv/config';
import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import { db } from '../../src/db/client.js';
import { mkUser, cleanupUser } from '../helpers/program-fixtures.js';
import { resolveUserLandmarks } from '../../src/services/resolveUserLandmarks.js';
import { MUSCLE_LANDMARKS } from '../../src/services/_muscleLandmarks.js';

describe('resolveUserLandmarks', () => {
  let userId: string;
  beforeAll(async () => {
    userId = (await mkUser({ prefix: 'vitest.lm-svc' })).id;
  });
  afterAll(async () => {
    await cleanupUser(userId);
  });

  it('returns canonical defaults when user has no overrides', async () => {
    const lm = await resolveUserLandmarks(userId);
    expect(lm.chest).toEqual(MUSCLE_LANDMARKS.chest);
    expect(lm.quads).toEqual(MUSCLE_LANDMARKS.quads);
  });

  it('merges user overrides on top of defaults', async () => {
    await db.query(`UPDATE users SET muscle_landmarks=$2::jsonb WHERE id=$1`, [
      userId,
      JSON.stringify({ _v: 1, overrides: { chest: { mev: 12, mav: 16, mrv: 22 } } }),
    ]);
    const lm = await resolveUserLandmarks(userId);
    expect(lm.chest).toEqual({ mev: 12, mav: 16, mrv: 22 });
    expect(lm.lats).toEqual(MUSCLE_LANDMARKS.lats); // untouched
  });

  it('logs + skips unknown muscle slug in overrides (read-side leniency) [I-LANDMARKS-UNKNOWN-SLUG]', async () => {
    // Use a direct write to bypass the zod write-side guard — this simulates
    // a back-channel admin tool. The CHECK constraint passes (shape is fine);
    // only the slug is invalid.
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    await db.query(`UPDATE users SET muscle_landmarks=$2::jsonb WHERE id=$1`, [
      userId,
      JSON.stringify({ _v: 1, overrides: { not_a_muscle: { mev: 1, mav: 4, mrv: 7 } } }),
    ]);
    const lm = await resolveUserLandmarks(userId);
    expect(lm.chest).toEqual(MUSCLE_LANDMARKS.chest); // canonical defaults still resolve
    expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining('not_a_muscle'));
    warnSpy.mockRestore();
  });
});
