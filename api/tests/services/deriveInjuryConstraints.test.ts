// Direct unit coverage for services/deriveInjuryConstraints.ts (quality pass
// Q8). Previously exercised only through the /me/landmarks route.
import 'dotenv/config';
import { describe, it, expect, beforeEach, afterAll } from 'vitest';
import { deriveInjuryConstraints } from '../../src/services/deriveInjuryConstraints.js';
import { computeMuscleJointRoots } from '../../src/services/muscleJointStress.js';
import { mkUser, cleanupUser } from '../helpers/program-fixtures.js';
import { db } from '../../src/db/client.js';

const created: string[] = [];

async function userWithInjuries(
  injuries: Array<{ joint: string; severity: 'low' | 'mod' | 'high' }>,
): Promise<string> {
  const u = await mkUser({ prefix: 'dic' });
  created.push(u.id);
  for (const inj of injuries) {
    await db.query(`INSERT INTO user_injuries (user_id, joint, severity) VALUES ($1, $2, $3)`, [
      u.id,
      inj.joint,
      inj.severity,
    ]);
  }
  return u.id;
}

afterAll(async () => {
  for (const id of created) await cleanupUser(id);
  await db.end();
});
beforeEach(() => {
  /* per-test users; nothing shared */
});

describe('deriveInjuryConstraints', () => {
  it('returns {} for a user with no injuries', async () => {
    const userId = await userWithInjuries([]);
    expect(await deriveInjuryConstraints(userId)).toEqual({});
  });

  it('maps every muscle whose joint roots include the injured root, keeping the lateralized joint name', async () => {
    const userId = await userWithInjuries([{ joint: 'knee_left', severity: 'mod' }]);
    const out = await deriveInjuryConstraints(userId);

    // Ground truth from the same source the service uses: every muscle with
    // 'knee' among its stress roots must be constrained; no other muscle may be.
    const roots = await computeMuscleJointRoots();
    const kneeMuscles = Object.entries(roots)
      .filter(([, rs]) => rs.includes('knee'))
      .map(([m]) => m)
      .sort();
    expect(kneeMuscles.length).toBeGreaterThan(0); // seeded catalog has knee-stressed muscles
    expect(Object.keys(out).sort()).toEqual(kneeMuscles);
    for (const m of kneeMuscles) {
      expect(out[m]).toEqual({ joint: 'knee_left', level: 'mod' });
    }
  });

  it('reports the HIGHEST severity when two injuries share a root (bilateral collapse)', async () => {
    const userId = await userWithInjuries([
      { joint: 'knee_left', severity: 'low' },
      { joint: 'knee_right', severity: 'high' },
    ]);
    const out = await deriveInjuryConstraints(userId);
    const constrained = Object.values(out);
    expect(constrained.length).toBeGreaterThan(0);
    // The winning constraint everywhere must be the high-severity right knee.
    for (const c of constrained) {
      expect(c).toEqual({ joint: 'knee_right', level: 'high' });
    }
  });

  it('a muscle stressed at multiple injured roots gets the worst constraint', async () => {
    const userId = await userWithInjuries([
      { joint: 'low_back', severity: 'high' },
      { joint: 'knee_left', severity: 'low' },
    ]);
    const out = await deriveInjuryConstraints(userId);
    const roots = await computeMuscleJointRoots();
    const both = Object.entries(roots).filter(
      ([, rs]) => rs.includes('lumbar') && rs.includes('knee'),
    );
    for (const [muscle] of both) {
      expect(out[muscle]).toEqual({ joint: 'low_back', level: 'high' });
    }
  });
});
