import 'dotenv/config';
import { describe, it, expect, afterEach, afterAll } from 'vitest';
import { build } from '../../helpers/build-test-app.js';
import {
  mkUserPair,
  seedFullMesocycleForUser,
  cleanupUserPair,
  type UserPairHandle,
} from '../../helpers/seed-fixtures.js';
import { db } from '../../../src/db/client.js';

const handles: UserPairHandle[] = [];
afterEach(async () => {
  if (handles.length) await cleanupUserPair(handles.splice(0));
});
afterAll(async () => {
  await db.end();
});

async function userProgramIdFor(userId: string): Promise<string> {
  const { rows } = await db.query<{ id: string }>(
    `SELECT id FROM user_programs WHERE user_id=$1 ORDER BY created_at DESC LIMIT 1`,
    [userId],
  );
  return rows[0].id;
}

describe('W8.2 contamination — user-programs', () => {
  it('GET /user-programs lists only user A rows, never user B', async () => {
    const app = await build();
    const pair = await mkUserPair();
    handles.push(pair);
    await seedFullMesocycleForUser(pair.userA.userId, { weeks: 4 });
    const upB = await userProgramIdFor(pair.userA.userId); // A's program id

    const res = await app.inject({
      method: 'GET',
      url: '/api/user-programs',
      headers: { authorization: `Bearer ${pair.userB.bearer}` },
    });
    expect(res.statusCode).toBe(200);
    const ids = res.json<{ programs: { id: string }[] }>().programs.map((p) => p.id);
    expect(ids).not.toContain(upB);
  });

  it('GET /user-programs/:id for A program from B token returns 404', async () => {
    const app = await build();
    const pair = await mkUserPair();
    handles.push(pair);
    await seedFullMesocycleForUser(pair.userA.userId, { weeks: 4 });
    const upA = await userProgramIdFor(pair.userA.userId);

    const res = await app.inject({
      method: 'GET',
      url: `/api/user-programs/${upA}`,
      headers: { authorization: `Bearer ${pair.userB.bearer}` },
    });
    expect(res.statusCode).toBe(404);
  });

  it('PATCH /user-programs/:id (rename) on A program from B token returns 404', async () => {
    const app = await build();
    const pair = await mkUserPair();
    handles.push(pair);
    await seedFullMesocycleForUser(pair.userA.userId, { weeks: 4 });
    const upA = await userProgramIdFor(pair.userA.userId);

    const res = await app.inject({
      method: 'PATCH',
      url: `/api/user-programs/${upA}`,
      headers: { authorization: `Bearer ${pair.userB.bearer}` },
      payload: { op: 'rename', name: 'pwned' },
    });
    expect(res.statusCode).toBe(404);
    const { rows } = await db.query<{ customizations: unknown }>(
      `SELECT customizations FROM user_programs WHERE id=$1`,
      [upA],
    );
    expect(JSON.stringify(rows[0].customizations ?? {})).not.toContain('pwned');
  });

  it('GET /user-programs/:id/warnings for A program from B token returns 404', async () => {
    const app = await build();
    const pair = await mkUserPair();
    handles.push(pair);
    await seedFullMesocycleForUser(pair.userA.userId, { weeks: 4 });
    const upA = await userProgramIdFor(pair.userA.userId);

    const res = await app.inject({
      method: 'GET',
      url: `/api/user-programs/${upA}/warnings`,
      headers: { authorization: `Bearer ${pair.userB.bearer}` },
    });
    expect(res.statusCode).toBe(404);
  });
});
