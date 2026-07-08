/**
 * Sequence-workouts Task 2 — POST /api/day-workouts/:id/{complete,skip,reopen}.
 *
 * Covers:
 *   - complete happy path (200, completed_at stamped, run stays active while
 *     other workouts remain)
 *   - complete with completed_on (noon in run.start_tz — stored user-local
 *     date matches the requested date)
 *   - idempotent complete (repeat 200, completed_at does NOT move)
 *   - completed_on validation: future → 400, before run start → 400
 *   - skip (200), idempotent skip (200), skip-after-complete → 409
 *   - reopen from completed (clears completed_at) and from skipped;
 *     idempotent reopen on a planned row (200)
 *   - IDOR: foreign-user id and unknown id both → the same 404 shape
 *   - run lifecycle: completing/skipping the LAST open workout flips
 *     mesocycle_runs → completed (finished_at set) + user_programs →
 *     completed, response carries run_completed: true
 *   - reopen on a completed run re-activates run + user_program
 *   - reopen 409s when a DIFFERENT active run exists for the user
 *
 * Every fixture user is cleaned up via cleanupSeeded (cascade wipes the
 * program/run/day/set chain) so the shared repos_test DB stays clean.
 */

import 'dotenv/config';
import { randomUUID } from 'node:crypto';
import { describe, it, expect, afterEach, afterAll } from 'vitest';
import { build } from './helpers/build-test-app.js';
import { seedUserWithMesocycle, cleanupSeeded, type SeedHandle } from './helpers/seed-fixtures.js';
import { db } from '../src/db/client.js';
import { computeUserLocalDate } from '../src/services/userLocalDate.js';

const NY = 'America/New_York';
const handles: SeedHandle[] = [];

afterEach(async () => {
  if (handles.length) await cleanupSeeded(handles.splice(0));
});

afterAll(async () => {
  await db.end();
});

/** seedUserWithMesocycle starts the run at CURRENT_DATE; backdate it a week so
 *  `completed_on: yesterday` isn't rejected as pre-run-start. */
async function seedBackdatedRun(): Promise<SeedHandle> {
  const seed = await seedUserWithMesocycle();
  handles.push(seed);
  await db.query(`UPDATE mesocycle_runs SET start_date = CURRENT_DATE - 7 WHERE id = $1`, [
    seed.mesocycleRunId,
  ]);
  return seed;
}

/** Add a second planned day workout so completing/skipping the first one does
 *  NOT close the run. */
async function addSecondDay(seed: SeedHandle): Promise<string> {
  const {
    rows: [dw],
  } = await db.query<{ id: string }>(
    `INSERT INTO day_workouts (mesocycle_run_id, week_idx, day_idx, scheduled_date, kind, name)
     VALUES ($1, 1, 1, CURRENT_DATE + 1, 'strength', 'Seed Day B') RETURNING id`,
    [seed.mesocycleRunId],
  );
  return dw.id;
}

async function runState(runId: string) {
  const {
    rows: [r],
  } = await db.query<{ status: string; finished_at: Date | null; user_program_id: string }>(
    `SELECT status, finished_at, user_program_id FROM mesocycle_runs WHERE id = $1`,
    [runId],
  );
  return r;
}

async function userProgramStatus(userProgramId: string): Promise<string> {
  const {
    rows: [r],
  } = await db.query<{ status: string }>(`SELECT status FROM user_programs WHERE id = $1`, [
    userProgramId,
  ]);
  return r.status;
}

function yesterdayLocal(): string {
  return computeUserLocalDate(NY, new Date(Date.now() - 86_400_000));
}

describe('POST /api/day-workouts/:id/complete', () => {
  it('completes a planned workout: 200, completed_at stamped, run stays active', async () => {
    const app = await build();
    try {
      const seed = await seedBackdatedRun();
      await addSecondDay(seed);

      const resp = await app.inject({
        method: 'POST',
        url: `/api/day-workouts/${seed.dayWorkoutId}/complete`,
        headers: { authorization: `Bearer ${seed.bearer}` },
        payload: {},
      });
      expect(resp.statusCode).toBe(200);
      const body = resp.json();
      expect(body.id).toBe(seed.dayWorkoutId);
      expect(body.status).toBe('completed');
      expect(body.completed_at).toBeTruthy();
      expect(body.run_completed).toBe(false);

      const run = await runState(seed.mesocycleRunId);
      expect(run.status).toBe('active');
      expect(run.finished_at).toBeNull();
    } finally {
      await app.close();
    }
  });

  it('completed_on yesterday → stored completed_at lands on that user-local date', async () => {
    const app = await build();
    try {
      const seed = await seedBackdatedRun();
      await addSecondDay(seed);
      const yesterday = yesterdayLocal();

      const resp = await app.inject({
        method: 'POST',
        url: `/api/day-workouts/${seed.dayWorkoutId}/complete`,
        headers: { authorization: `Bearer ${seed.bearer}` },
        payload: { completed_on: yesterday },
      });
      expect(resp.statusCode).toBe(200);
      const body = resp.json();
      expect(body.status).toBe('completed');
      // Noon-local storage means the round-tripped user-local date is stable.
      expect(computeUserLocalDate(NY, new Date(body.completed_at))).toBe(yesterday);
    } finally {
      await app.close();
    }
  });

  it('idempotent: re-completing returns 200 and does NOT move completed_at', async () => {
    const app = await build();
    try {
      const seed = await seedBackdatedRun();
      await addSecondDay(seed);
      const auth = { authorization: `Bearer ${seed.bearer}` };

      const first = await app.inject({
        method: 'POST',
        url: `/api/day-workouts/${seed.dayWorkoutId}/complete`,
        headers: auth,
        payload: {},
      });
      expect(first.statusCode).toBe(200);
      const stamp = first.json().completed_at;

      // Repeat — even with a different completed_on, the original stamp wins.
      const second = await app.inject({
        method: 'POST',
        url: `/api/day-workouts/${seed.dayWorkoutId}/complete`,
        headers: auth,
        payload: { completed_on: yesterdayLocal() },
      });
      expect(second.statusCode).toBe(200);
      expect(second.json().completed_at).toBe(stamp);
      expect(second.json().status).toBe('completed');
      expect(second.json().run_completed).toBe(false);
    } finally {
      await app.close();
    }
  });

  it('future completed_on → 400 with actionable error', async () => {
    const app = await build();
    try {
      const seed = await seedBackdatedRun();
      const future = computeUserLocalDate(NY, new Date(Date.now() + 2 * 86_400_000));

      const resp = await app.inject({
        method: 'POST',
        url: `/api/day-workouts/${seed.dayWorkoutId}/complete`,
        headers: { authorization: `Bearer ${seed.bearer}` },
        payload: { completed_on: future },
      });
      expect(resp.statusCode).toBe(400);
      expect(resp.json()).toEqual({
        error: 'completed_on cannot be in the future',
        field: 'completed_on',
      });
      // Row untouched.
      const {
        rows: [dw],
      } = await db.query(`SELECT status FROM day_workouts WHERE id=$1`, [seed.dayWorkoutId]);
      expect(dw.status).toBe('planned');
    } finally {
      await app.close();
    }
  });

  it('completed_on before run start_date → 400', async () => {
    const app = await build();
    try {
      const seed = await seedBackdatedRun();
      const {
        rows: [r],
      } = await db.query<{ before_start: string }>(
        `SELECT to_char(start_date - 1, 'YYYY-MM-DD') AS before_start
         FROM mesocycle_runs WHERE id=$1`,
        [seed.mesocycleRunId],
      );

      const resp = await app.inject({
        method: 'POST',
        url: `/api/day-workouts/${seed.dayWorkoutId}/complete`,
        headers: { authorization: `Bearer ${seed.bearer}` },
        payload: { completed_on: r.before_start },
      });
      expect(resp.statusCode).toBe(400);
      expect(resp.json()).toEqual({
        error: 'completed_on is before the program started',
        field: 'completed_on',
      });
    } finally {
      await app.close();
    }
  });

  it('malformed completed_on → 400 from schema', async () => {
    const app = await build();
    try {
      const seed = await seedBackdatedRun();
      const resp = await app.inject({
        method: 'POST',
        url: `/api/day-workouts/${seed.dayWorkoutId}/complete`,
        headers: { authorization: `Bearer ${seed.bearer}` },
        payload: { completed_on: 'yesterday' },
      });
      expect(resp.statusCode).toBe(400);
      expect(resp.json().field).toBe('completed_on');
    } finally {
      await app.close();
    }
  });
});

describe('POST /api/day-workouts/:id/skip', () => {
  it('skips a planned workout; idempotent on repeat', async () => {
    const app = await build();
    try {
      const seed = await seedBackdatedRun();
      await addSecondDay(seed);
      const auth = { authorization: `Bearer ${seed.bearer}` };

      const first = await app.inject({
        method: 'POST',
        url: `/api/day-workouts/${seed.dayWorkoutId}/skip`,
        headers: auth,
      });
      expect(first.statusCode).toBe(200);
      expect(first.json()).toMatchObject({
        id: seed.dayWorkoutId,
        status: 'skipped',
        completed_at: null,
        run_completed: false,
      });

      const second = await app.inject({
        method: 'POST',
        url: `/api/day-workouts/${seed.dayWorkoutId}/skip`,
        headers: auth,
      });
      expect(second.statusCode).toBe(200);
      expect(second.json().status).toBe('skipped');
    } finally {
      await app.close();
    }
  });

  it('skip after complete → 409 pointing at reopen', async () => {
    const app = await build();
    try {
      const seed = await seedBackdatedRun();
      await addSecondDay(seed);
      const auth = { authorization: `Bearer ${seed.bearer}` };

      await app.inject({
        method: 'POST',
        url: `/api/day-workouts/${seed.dayWorkoutId}/complete`,
        headers: auth,
        payload: {},
      });
      const resp = await app.inject({
        method: 'POST',
        url: `/api/day-workouts/${seed.dayWorkoutId}/skip`,
        headers: auth,
      });
      expect(resp.statusCode).toBe(409);
      expect(resp.json()).toEqual({
        error: 'already completed — reopen first',
        field: 'status',
      });
    } finally {
      await app.close();
    }
  });
});

describe('POST /api/day-workouts/:id/reopen', () => {
  it('reopen from completed → planned, completed_at cleared', async () => {
    const app = await build();
    try {
      const seed = await seedBackdatedRun();
      await addSecondDay(seed);
      const auth = { authorization: `Bearer ${seed.bearer}` };

      await app.inject({
        method: 'POST',
        url: `/api/day-workouts/${seed.dayWorkoutId}/complete`,
        headers: auth,
        payload: {},
      });
      const resp = await app.inject({
        method: 'POST',
        url: `/api/day-workouts/${seed.dayWorkoutId}/reopen`,
        headers: auth,
      });
      expect(resp.statusCode).toBe(200);
      expect(resp.json()).toMatchObject({
        id: seed.dayWorkoutId,
        status: 'planned',
        completed_at: null,
        run_completed: false,
      });
      const {
        rows: [dw],
      } = await db.query(`SELECT status, completed_at FROM day_workouts WHERE id=$1`, [
        seed.dayWorkoutId,
      ]);
      expect(dw.status).toBe('planned');
      expect(dw.completed_at).toBeNull();
    } finally {
      await app.close();
    }
  });

  it('reopen from skipped → planned', async () => {
    const app = await build();
    try {
      const seed = await seedBackdatedRun();
      await addSecondDay(seed);
      const auth = { authorization: `Bearer ${seed.bearer}` };

      await app.inject({
        method: 'POST',
        url: `/api/day-workouts/${seed.dayWorkoutId}/skip`,
        headers: auth,
      });
      const resp = await app.inject({
        method: 'POST',
        url: `/api/day-workouts/${seed.dayWorkoutId}/reopen`,
        headers: auth,
      });
      expect(resp.statusCode).toBe(200);
      expect(resp.json().status).toBe('planned');
    } finally {
      await app.close();
    }
  });

  it('idempotent: reopening an already-planned workout returns 200', async () => {
    const app = await build();
    try {
      const seed = await seedBackdatedRun();
      const resp = await app.inject({
        method: 'POST',
        url: `/api/day-workouts/${seed.dayWorkoutId}/reopen`,
        headers: { authorization: `Bearer ${seed.bearer}` },
      });
      expect(resp.statusCode).toBe(200);
      expect(resp.json()).toMatchObject({
        status: 'planned',
        completed_at: null,
        run_completed: false,
      });
    } finally {
      await app.close();
    }
  });
});

describe('IDOR / not-found contract', () => {
  it('foreign-user day workout id → 404 (no existence oracle)', async () => {
    const app = await build();
    try {
      const owner = await seedBackdatedRun();
      const attacker = await seedUserWithMesocycle();
      handles.push(attacker);

      for (const action of ['complete', 'skip', 'reopen']) {
        const resp = await app.inject({
          method: 'POST',
          url: `/api/day-workouts/${owner.dayWorkoutId}/${action}`,
          headers: { authorization: `Bearer ${attacker.bearer}` },
          payload: {},
        });
        expect(resp.statusCode).toBe(404);
        expect(resp.json()).toEqual({ error: 'day_workout not found' });
      }
    } finally {
      await app.close();
    }
  });

  it('unknown id → same 404 shape', async () => {
    const app = await build();
    try {
      const seed = await seedBackdatedRun();
      const resp = await app.inject({
        method: 'POST',
        url: `/api/day-workouts/${randomUUID()}/complete`,
        headers: { authorization: `Bearer ${seed.bearer}` },
        payload: {},
      });
      expect(resp.statusCode).toBe(404);
      expect(resp.json()).toEqual({ error: 'day_workout not found' });
    } finally {
      await app.close();
    }
  });

  it('no auth → 401', async () => {
    const app = await build();
    try {
      const resp = await app.inject({
        method: 'POST',
        url: `/api/day-workouts/${randomUUID()}/complete`,
        payload: {},
      });
      expect(resp.statusCode).toBe(401);
    } finally {
      await app.close();
    }
  });
});

describe('run lifecycle', () => {
  it('completing the last open workout closes the run + user_program (run_completed: true)', async () => {
    const app = await build();
    try {
      const seed = await seedBackdatedRun(); // single day workout — completing it empties the sequence

      const resp = await app.inject({
        method: 'POST',
        url: `/api/day-workouts/${seed.dayWorkoutId}/complete`,
        headers: { authorization: `Bearer ${seed.bearer}` },
        payload: {},
      });
      expect(resp.statusCode).toBe(200);
      expect(resp.json().run_completed).toBe(true);

      const run = await runState(seed.mesocycleRunId);
      expect(run.status).toBe('completed');
      expect(run.finished_at).not.toBeNull();
      expect(await userProgramStatus(seed.userProgramId)).toBe('completed');
    } finally {
      await app.close();
    }
  });

  it('skipping the last open workout also closes the run', async () => {
    const app = await build();
    try {
      const seed = await seedBackdatedRun();

      const resp = await app.inject({
        method: 'POST',
        url: `/api/day-workouts/${seed.dayWorkoutId}/skip`,
        headers: { authorization: `Bearer ${seed.bearer}` },
      });
      expect(resp.statusCode).toBe(200);
      expect(resp.json().run_completed).toBe(true);
      expect((await runState(seed.mesocycleRunId)).status).toBe('completed');
    } finally {
      await app.close();
    }
  });

  it('reopening a workout of a completed run re-activates run + user_program', async () => {
    const app = await build();
    try {
      const seed = await seedBackdatedRun();
      const auth = { authorization: `Bearer ${seed.bearer}` };

      await app.inject({
        method: 'POST',
        url: `/api/day-workouts/${seed.dayWorkoutId}/complete`,
        headers: auth,
        payload: {},
      });
      expect((await runState(seed.mesocycleRunId)).status).toBe('completed');

      const resp = await app.inject({
        method: 'POST',
        url: `/api/day-workouts/${seed.dayWorkoutId}/reopen`,
        headers: auth,
      });
      expect(resp.statusCode).toBe(200);
      expect(resp.json().status).toBe('planned');

      const run = await runState(seed.mesocycleRunId);
      expect(run.status).toBe('active');
      expect(run.finished_at).toBeNull();
      expect(await userProgramStatus(seed.userProgramId)).toBe('active');
    } finally {
      await app.close();
    }
  });

  it('reopen 409s when a different active run exists', async () => {
    const app = await build();
    try {
      const seed = await seedBackdatedRun();
      const auth = { authorization: `Bearer ${seed.bearer}` };

      // Close run A via its last workout.
      await app.inject({
        method: 'POST',
        url: `/api/day-workouts/${seed.dayWorkoutId}/complete`,
        headers: auth,
        payload: {},
      });

      // Start run B (active) for the same user — legal now that A is completed.
      const {
        rows: [tpl],
      } = await db.query<{ template_id: string }>(
        `SELECT template_id FROM user_programs WHERE id=$1`,
        [seed.userProgramId],
      );
      const {
        rows: [upB],
      } = await db.query<{ id: string }>(
        `INSERT INTO user_programs (user_id, template_id, template_version, name, status)
         VALUES ($1, $2, 1, 'Run B', 'active') RETURNING id`,
        [seed.userId, tpl.template_id],
      );
      await db.query(
        `INSERT INTO mesocycle_runs (user_program_id, user_id, start_date, start_tz, weeks, current_week, status)
         VALUES ($1, $2, CURRENT_DATE, 'America/New_York', 1, 1, 'active')`,
        [upB.id, seed.userId],
      );

      const resp = await app.inject({
        method: 'POST',
        url: `/api/day-workouts/${seed.dayWorkoutId}/reopen`,
        headers: auth,
      });
      expect(resp.statusCode).toBe(409);
      expect(resp.json()).toEqual({
        error: 'another program is active — abandon it first',
        field: 'run',
      });
      // Run A untouched; its workout stays completed.
      expect((await runState(seed.mesocycleRunId)).status).toBe('completed');
      const {
        rows: [dw],
      } = await db.query(`SELECT status FROM day_workouts WHERE id=$1`, [seed.dayWorkoutId]);
      expect(dw.status).toBe('completed');
    } finally {
      await app.close();
    }
  });
});
