// api/tests/integration/movement-pattern-spinal-flexion-seeded.test.ts
import 'dotenv/config';
import { describe, it, expect, afterAll } from 'vitest';
import { db } from '../../src/db/client.js';

afterAll(async () => { await db.end(); });

describe('W2 — movement_pattern enum extension applied to seeds', () => {
  it('cable-crunch is movement_pattern=spinal_flexion with lumbar=high', async () => {
    const { rows } = await db.query(
      `SELECT movement_pattern::text, joint_stress_profile FROM exercises WHERE slug='cable-crunch'`,
    );
    expect(rows[0].movement_pattern).toBe('spinal_flexion');
    expect(rows[0].joint_stress_profile.lumbar).toBe('high');
  });

  it('hanging-leg-raise is movement_pattern=spinal_flexion with lumbar=mod', async () => {
    const { rows } = await db.query(
      `SELECT movement_pattern::text, joint_stress_profile FROM exercises WHERE slug='hanging-leg-raise'`,
    );
    expect(rows[0].movement_pattern).toBe('spinal_flexion');
    expect(rows[0].joint_stress_profile.lumbar).toBe('mod');
  });

  it('ab-wheel-rollout is movement_pattern=anti_extension with lumbar=high + shoulder=high', async () => {
    const { rows } = await db.query(
      `SELECT movement_pattern::text, joint_stress_profile FROM exercises WHERE slug='ab-wheel-rollout'`,
    );
    expect(rows[0].movement_pattern).toBe('anti_extension');
    expect(rows[0].joint_stress_profile.lumbar).toBe('high');
    expect(rows[0].joint_stress_profile.shoulder).toBe('high');
  });

  it('anti_rotation-correct exercises remain unchanged', async () => {
    const { rows } = await db.query(
      `SELECT slug, movement_pattern::text FROM exercises
       WHERE slug IN ('cable-pallof-press', 'dead-bug', 'side-plank')
       ORDER BY slug`,
    );
    for (const r of rows) expect(r.movement_pattern).toBe('anti_rotation');
  });
});
