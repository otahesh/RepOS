import 'dotenv/config';
import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { buildApp } from '../src/app.js';
import { db } from '../src/db/client.js';

type App = Awaited<ReturnType<typeof buildApp>>;
let app: App;
let userId: string;
let otherUserId: string;
let token: string;

beforeAll(async () => {
  app = await buildApp();
  const {
    rows: [u],
  } = await db.query(`INSERT INTO users (email) VALUES ($1) RETURNING id`, [
    `vitest.up.${Date.now()}@repos.test`,
  ]);
  userId = u.id;
  const {
    rows: [u2],
  } = await db.query(`INSERT INTO users (email) VALUES ($1) RETURNING id`, [
    `vitest.up.other.${Date.now()}@repos.test`,
  ]);
  otherUserId = u2.id;
  const mint = await app.inject({
    method: 'POST',
    url: '/api/tokens',
    body: { user_id: userId, label: 'up-test' },
  });
  token = mint.json<{ token: string }>().token;
});

afterAll(async () => {
  if (userId) await db.query(`DELETE FROM users WHERE id=$1`, [userId]);
  if (otherUserId) await db.query(`DELETE FROM users WHERE id=$1`, [otherUserId]);
  await app.close();
  await db.end();
});

const auth = () => ({ authorization: `Bearer ${token}` });

describe('GET /api/user-programs', () => {
  it('lists only my non-archived programs', async () => {
    // mine
    const fork = await app.inject({
      method: 'POST',
      url: '/api/program-templates/full-body-3-day/fork',
      headers: auth(),
    });
    const myUpId = fork.json<{ id: string }>().id;
    // someone else's
    const {
      rows: [tmpl],
    } = await db.query(
      `SELECT id, version, name FROM program_templates WHERE slug='full-body-3-day'`,
    );
    const {
      rows: [otherUp],
    } = await db.query<{ id: string }>(
      `INSERT INTO user_programs (user_id, template_id, template_version, name)
       VALUES ($1, $2, $3, $4) RETURNING id`,
      [otherUserId, tmpl.id, tmpl.version, tmpl.name],
    );

    const r = await app.inject({ method: 'GET', url: '/api/user-programs', headers: auth() });
    expect(r.statusCode).toBe(200);
    const body = r.json<{ programs: { id: string }[] }>();
    const ids = body.programs.map((p) => p.id);
    expect(ids).toContain(myUpId);
    expect(ids).not.toContain(otherUp.id);
  });

  it('default filter excludes abandoned and completed programs', async () => {
    await db.query(`DELETE FROM mesocycle_runs WHERE user_id=$1`, [userId]);
    await db.query(`DELETE FROM user_programs WHERE user_id=$1`, [userId]);

    const {
      rows: [tmpl],
    } = await db.query(
      `SELECT id, version, name FROM program_templates WHERE slug='full-body-3-day'`,
    );
    // draft — should appear
    const {
      rows: [draftUp],
    } = await db.query<{ id: string }>(
      `INSERT INTO user_programs (user_id, template_id, template_version, name, status)
       VALUES ($1, $2, $3, $4, 'draft') RETURNING id`,
      [userId, tmpl.id, tmpl.version, tmpl.name],
    );
    // abandoned — should NOT appear in default view
    const {
      rows: [abandonedUp],
    } = await db.query<{ id: string }>(
      `INSERT INTO user_programs (user_id, template_id, template_version, name, status)
       VALUES ($1, $2, $3, $4, 'abandoned') RETURNING id`,
      [userId, tmpl.id, tmpl.version, tmpl.name],
    );
    // completed — should NOT appear in default view
    const {
      rows: [completedUp],
    } = await db.query<{ id: string }>(
      `INSERT INTO user_programs (user_id, template_id, template_version, name, status)
       VALUES ($1, $2, $3, $4, 'completed') RETURNING id`,
      [userId, tmpl.id, tmpl.version, tmpl.name],
    );

    const r = await app.inject({ method: 'GET', url: '/api/user-programs', headers: auth() });
    expect(r.statusCode).toBe(200);
    const ids = r.json<{ programs: { id: string }[] }>().programs.map((p) => p.id);
    expect(ids).toContain(draftUp.id);
    expect(ids).not.toContain(abandonedUp.id);
    expect(ids).not.toContain(completedUp.id);
  });

  it('?include=past returns abandoned and completed but excludes archived', async () => {
    await db.query(`DELETE FROM mesocycle_runs WHERE user_id=$1`, [userId]);
    await db.query(`DELETE FROM user_programs WHERE user_id=$1`, [userId]);

    const {
      rows: [tmpl],
    } = await db.query(
      `SELECT id, version, name FROM program_templates WHERE slug='full-body-3-day'`,
    );
    const {
      rows: [abandonedUp],
    } = await db.query<{ id: string }>(
      `INSERT INTO user_programs (user_id, template_id, template_version, name, status)
       VALUES ($1, $2, $3, $4, 'abandoned') RETURNING id`,
      [userId, tmpl.id, tmpl.version, tmpl.name],
    );
    const {
      rows: [completedUp],
    } = await db.query<{ id: string }>(
      `INSERT INTO user_programs (user_id, template_id, template_version, name, status)
       VALUES ($1, $2, $3, $4, 'completed') RETURNING id`,
      [userId, tmpl.id, tmpl.version, tmpl.name],
    );
    const {
      rows: [archivedUp],
    } = await db.query<{ id: string }>(
      `INSERT INTO user_programs (user_id, template_id, template_version, name, status, archived_at)
       VALUES ($1, $2, $3, $4, 'archived', now()) RETURNING id`,
      [userId, tmpl.id, tmpl.version, tmpl.name],
    );

    const r = await app.inject({
      method: 'GET',
      url: '/api/user-programs?include=past',
      headers: auth(),
    });
    expect(r.statusCode).toBe(200);
    const ids = r.json<{ programs: { id: string }[] }>().programs.map((p) => p.id);
    expect(ids).toContain(abandonedUp.id);
    expect(ids).toContain(completedUp.id);
    expect(ids).not.toContain(archivedUp.id);
  });

  it('401 without auth', async () => {
    const r = await app.inject({ method: 'GET', url: '/api/user-programs' });
    expect(r.statusCode).toBe(401);
  });
});

describe('GET /api/user-programs — archived filter', () => {
  it('archived programs appear only under include=archived', async () => {
    const fork = await app.inject({
      method: 'POST',
      url: '/api/program-templates/full-body-3-day/fork',
      headers: auth(),
    });
    const upId = fork.json<{ id: string }>().id;

    // Archive it directly in the DB (archive endpoint lands in Task 4).
    await db.query(`UPDATE user_programs SET archived_at=now() WHERE id=$1`, [upId]);

    const def = await app.inject({ method: 'GET', url: '/api/user-programs', headers: auth() });
    expect(def.json<{ programs: { id: string }[] }>().programs.map((p) => p.id)).not.toContain(
      upId,
    );

    const past = await app.inject({
      method: 'GET',
      url: '/api/user-programs?include=past',
      headers: auth(),
    });
    expect(past.json<{ programs: { id: string }[] }>().programs.map((p) => p.id)).not.toContain(
      upId,
    );

    const arc = await app.inject({
      method: 'GET',
      url: '/api/user-programs?include=archived',
      headers: auth(),
    });
    expect(arc.json<{ programs: { id: string }[] }>().programs.map((p) => p.id)).toContain(upId);
  });
});

describe('GET /api/user-programs/:id', () => {
  let upId: string;
  beforeAll(async () => {
    const r = await app.inject({
      method: 'POST',
      url: '/api/program-templates/full-body-3-day/fork',
      headers: auth(),
    });
    upId = r.json<any>().id;
  });

  it('returns user_program with effective structure resolved (customizations overlay applied)', async () => {
    // Inject a rename customization
    await db.query(
      `UPDATE user_programs SET customizations='{"name_override":"My Program"}'::jsonb WHERE id=$1`,
      [upId],
    );
    const r = await app.inject({
      method: 'GET',
      url: `/api/user-programs/${upId}`,
      headers: auth(),
    });
    expect(r.statusCode).toBe(200);
    const body = r.json<any>();
    expect(body.id).toBe(upId);
    expect(body.effective_structure).toBeDefined();
    expect(body.effective_structure.days).toBeDefined();
    expect(body.effective_name).toBe('My Program');
  });

  it("404 on someone else's program (no leak)", async () => {
    const {
      rows: [tmpl],
    } = await db.query(
      `SELECT id, version, name FROM program_templates WHERE slug='full-body-3-day'`,
    );
    const {
      rows: [other],
    } = await db.query(
      `INSERT INTO user_programs (user_id, template_id, template_version, name)
       VALUES ($1, $2, $3, $4) RETURNING id`,
      [otherUserId, tmpl.id, tmpl.version, tmpl.name],
    );
    const r = await app.inject({
      method: 'GET',
      url: `/api/user-programs/${other.id}`,
      headers: auth(),
    });
    expect(r.statusCode).toBe(404);
  });
});

describe('PATCH /api/user-programs/:id', () => {
  let upId: string;
  beforeAll(async () => {
    const r = await app.inject({
      method: 'POST',
      url: '/api/program-templates/full-body-3-day/fork',
      headers: auth(),
    });
    upId = r.json<any>().id;
  });

  it('rename op updates customizations.name_override', async () => {
    const r = await app.inject({
      method: 'PATCH',
      url: `/api/user-programs/${upId}`,
      headers: auth(),
      body: { op: 'rename', name: 'My Custom Plan' },
    });
    expect(r.statusCode).toBe(200);
    const { rows } = await db.query(`SELECT customizations FROM user_programs WHERE id=$1`, [upId]);
    expect(rows[0].customizations.name_override).toBe('My Custom Plan');
  });

  it('swap_exercise op records {week_idx:1, day_idx, block_idx, from_slug captured, to_slug}', async () => {
    const r = await app.inject({
      method: 'PATCH',
      url: `/api/user-programs/${upId}`,
      headers: auth(),
      body: {
        op: 'swap_exercise',
        day_idx: 0,
        block_idx: 0,
        to_exercise_slug: 'dumbbell-goblet-squat',
      },
    });
    expect(r.statusCode).toBe(200);
    const { rows } = await db.query(
      `SELECT customizations, template_id FROM user_programs WHERE id=$1`,
      [upId],
    );
    const swaps = rows[0].customizations.swaps;
    expect(Array.isArray(swaps)).toBe(true);
    expect(swaps).toContainEqual(
      expect.objectContaining({
        week_idx: 1,
        day_idx: 0,
        block_idx: 0,
        to_slug: 'dumbbell-goblet-squat',
      }),
    );
    // from_slug must be captured from the template's current structure
    const swap = swaps.find((s: any) => s.day_idx === 0 && s.block_idx === 0);
    expect(typeof swap.from_slug).toBe('string');
    expect(swap.from_slug.length).toBeGreaterThan(0);
  });

  it('skip_day op records {week_idx, day_idx}', async () => {
    const r = await app.inject({
      method: 'PATCH',
      url: `/api/user-programs/${upId}`,
      headers: auth(),
      body: { op: 'skip_day', week_idx: 2, day_idx: 1 },
    });
    expect(r.statusCode).toBe(200);
    const { rows } = await db.query(`SELECT customizations FROM user_programs WHERE id=$1`, [upId]);
    expect(rows[0].customizations.skipped_days).toContainEqual({ week_idx: 2, day_idx: 1 });
  });

  it('400 on invalid op (not in schema)', async () => {
    const r = await app.inject({
      method: 'PATCH',
      url: `/api/user-programs/${upId}`,
      headers: auth(),
      body: { op: 'destroy_program' },
    });
    expect(r.statusCode).toBe(400);
  });

  it("404 on someone else's user_program", async () => {
    const {
      rows: [tmpl],
    } = await db.query(
      `SELECT id, version, name FROM program_templates WHERE slug='full-body-3-day'`,
    );
    const {
      rows: [other],
    } = await db.query(
      `INSERT INTO user_programs (user_id, template_id, template_version, name)
       VALUES ($1, $2, $3, $4) RETURNING id`,
      [otherUserId, tmpl.id, tmpl.version, tmpl.name],
    );
    const r = await app.inject({
      method: 'PATCH',
      url: `/api/user-programs/${other.id}`,
      headers: auth(),
      body: { op: 'rename', name: 'Hijacked' },
    });
    expect(r.statusCode).toBe(404);
  });

  it('409 on archived program', async () => {
    // Mark this program as archived, attempt rename → 409
    await db.query(`UPDATE user_programs SET status='archived' WHERE id=$1`, [upId]);
    try {
      const r = await app.inject({
        method: 'PATCH',
        url: `/api/user-programs/${upId}`,
        headers: auth(),
        body: { op: 'rename', name: 'Should Reject' },
      });
      expect(r.statusCode).toBe(409);
    } finally {
      await db.query(`UPDATE user_programs SET status='draft' WHERE id=$1`, [upId]);
    }
  });

  it('draft program PATCH emits no mesocycle_run_events row', async () => {
    const fork = await app.inject({
      method: 'POST',
      url: '/api/program-templates/full-body-3-day/fork',
      headers: auth(),
    });
    const draftUpId = fork.json<{ id: string }>().id;
    const r = await app.inject({
      method: 'PATCH',
      url: `/api/user-programs/${draftUpId}`,
      headers: auth(),
      body: { op: 'rename', name: 'Quiet Patch' },
    });
    expect(r.statusCode).toBe(200);
    const { rows } = await db.query<{ n: number }>(
      `SELECT count(*)::int AS n FROM mesocycle_run_events ev
       JOIN mesocycle_runs mr ON mr.id = ev.run_id
       WHERE mr.user_program_id = $1`,
      [draftUpId],
    );
    expect(rows[0].n).toBe(0);
  });

  it('active program PATCH emits a customized mesocycle_run_events row', async () => {
    // Ensure no active run for this user before /start
    await db.query(`DELETE FROM mesocycle_runs WHERE user_id=$1`, [userId]);
    const fork = await app.inject({
      method: 'POST',
      url: '/api/program-templates/full-body-3-day/fork',
      headers: auth(),
    });
    const activeUpId = fork.json<{ id: string }>().id;
    const start = await app.inject({
      method: 'POST',
      url: `/api/user-programs/${activeUpId}/start`,
      headers: auth(),
      body: { start_date: '2026-05-04', start_tz: 'America/New_York' },
    });
    expect(start.statusCode).toBe(201);
    const runId = start.json<{ mesocycle_run_id: string }>().mesocycle_run_id;

    const patch = await app.inject({
      method: 'PATCH',
      url: `/api/user-programs/${activeUpId}`,
      headers: auth(),
      body: { op: 'rename', name: 'During Run' },
    });
    expect(patch.statusCode).toBe(200);

    const { rows } = await db.query<{ event_type: string; payload: any }>(
      `SELECT event_type, payload FROM mesocycle_run_events
       WHERE run_id = $1 AND event_type = 'customized'`,
      [runId],
    );
    expect(rows.length).toBe(1);
    expect(rows[0].payload.op).toBe('rename');
    expect(rows[0].payload.name).toBe('During Run');

    // Cleanup so the START describe's beforeEach starts from a clean slate
    await db.query(`DELETE FROM mesocycle_runs WHERE user_id=$1`, [userId]);
  });

  it('active program swap_exercise audit payload captures from_slug', async () => {
    await db.query(`DELETE FROM mesocycle_runs WHERE user_id=$1`, [userId]);
    const fork = await app.inject({
      method: 'POST',
      url: '/api/program-templates/full-body-3-day/fork',
      headers: auth(),
    });
    const swapUpId = fork.json<{ id: string }>().id;
    const start = await app.inject({
      method: 'POST',
      url: `/api/user-programs/${swapUpId}/start`,
      headers: auth(),
      body: { start_date: '2026-05-04', start_tz: 'America/New_York' },
    });
    const runId = start.json<{ mesocycle_run_id: string }>().mesocycle_run_id;

    const patch = await app.inject({
      method: 'PATCH',
      url: `/api/user-programs/${swapUpId}`,
      headers: auth(),
      body: {
        op: 'swap_exercise',
        day_idx: 0,
        block_idx: 0,
        to_exercise_slug: 'dumbbell-goblet-squat',
      },
    });
    expect(patch.statusCode).toBe(200);

    const { rows } = await db.query<{ payload: any }>(
      `SELECT payload FROM mesocycle_run_events
       WHERE run_id = $1 AND event_type = 'customized'`,
      [runId],
    );
    expect(rows.length).toBe(1);
    expect(rows[0].payload.op).toBe('swap_exercise');
    expect(rows[0].payload.to_exercise_slug).toBe('dumbbell-goblet-squat');
    expect(typeof rows[0].payload.from_slug).toBe('string');
    expect(rows[0].payload.from_slug.length).toBeGreaterThan(0);

    await db.query(`DELETE FROM mesocycle_runs WHERE user_id=$1`, [userId]);
  });
});

describe('POST /api/user-programs/:id/start', () => {
  let upId: string;
  beforeEach(async () => {
    // Clean active run + user_programs for this test user
    await db.query(`DELETE FROM mesocycle_runs WHERE user_id=$1`, [userId]);
    await db.query(`DELETE FROM user_programs WHERE user_id=$1`, [userId]);
    const r = await app.inject({
      method: 'POST',
      url: '/api/program-templates/full-body-3-day/fork',
      headers: auth(),
    });
    upId = r.json<any>().id;
  });

  it('201 materializes a mesocycle_run + returns its id + run details', async () => {
    const r = await app.inject({
      method: 'POST',
      url: `/api/user-programs/${upId}/start`,
      headers: auth(),
      body: { start_date: '2026-05-04', start_tz: 'America/New_York' },
    });
    expect(r.statusCode).toBe(201);
    const body = r.json<any>();
    expect(body.mesocycle_run_id).toBeDefined();
    expect(body.start_date).toBe('2026-05-04');
    expect(body.start_tz).toBe('America/New_York');
    const { rows } = await db.query(`SELECT status FROM mesocycle_runs WHERE id=$1`, [
      body.mesocycle_run_id,
    ]);
    expect(rows[0].status).toBe('active');
  });

  it('409 when an active run already exists for this user', async () => {
    await app.inject({
      method: 'POST',
      url: `/api/user-programs/${upId}/start`,
      headers: auth(),
      body: { start_date: '2026-05-04', start_tz: 'America/New_York' },
    });
    const r2 = await app.inject({
      method: 'POST',
      url: '/api/program-templates/upper-lower-4-day/fork',
      headers: auth(),
    });
    const upId2 = r2.json<any>().id;
    const startR = await app.inject({
      method: 'POST',
      url: `/api/user-programs/${upId2}/start`,
      headers: auth(),
      body: { start_date: '2026-05-04', start_tz: 'America/New_York' },
    });
    expect(startR.statusCode).toBe(409);
    expect(startR.json<any>().error).toBe('active_run_exists');
  });

  it('409 with must_refork:true when template_version is stale', async () => {
    const {
      rows: [tmpl],
    } = await db.query(`SELECT id, version FROM program_templates WHERE slug='full-body-3-day'`);
    await db.query(`UPDATE program_templates SET version=version+1 WHERE id=$1`, [tmpl.id]);
    try {
      const r = await app.inject({
        method: 'POST',
        url: `/api/user-programs/${upId}/start`,
        headers: auth(),
        body: { start_date: '2026-05-04', start_tz: 'America/New_York' },
      });
      expect(r.statusCode).toBe(409);
      const body = r.json<any>();
      expect(body.error).toBe('template_outdated');
      expect(body.must_refork).toBe(true);
      expect(body.latest_version).toBe(tmpl.version + 1);
    } finally {
      await db.query(`UPDATE program_templates SET version=$1 WHERE id=$2`, [
        tmpl.version,
        tmpl.id,
      ]);
    }
  });

  it("404 on someone else's user_program", async () => {
    const {
      rows: [tmpl],
    } = await db.query(
      `SELECT id, version, name FROM program_templates WHERE slug='full-body-3-day'`,
    );
    const {
      rows: [other],
    } = await db.query(
      `INSERT INTO user_programs (user_id, template_id, template_version, name)
       VALUES ($1, $2, $3, $4) RETURNING id`,
      [otherUserId, tmpl.id, tmpl.version, tmpl.name],
    );
    const r = await app.inject({
      method: 'POST',
      url: `/api/user-programs/${other.id}/start`,
      headers: auth(),
      body: { start_date: '2026-05-04', start_tz: 'America/New_York' },
    });
    expect(r.statusCode).toBe(404);
  });

  it('400 on invalid body (bad date format)', async () => {
    const r = await app.inject({
      method: 'POST',
      url: `/api/user-programs/${upId}/start`,
      headers: auth(),
      body: { start_date: 'not-a-date', start_tz: 'America/New_York' },
    });
    expect(r.statusCode).toBe(400);
  });

  it('start_date in response is TZ-stable YYYY-MM-DD (not shifted by runtime TZ)', async () => {
    const r = await app.inject({
      method: 'POST',
      url: `/api/user-programs/${upId}/start`,
      headers: auth(),
      body: { start_date: '2026-05-04', start_tz: 'America/New_York' },
    });
    expect(r.statusCode).toBe(201);
    const body = r.json<any>();
    expect(body.start_date).toBe('2026-05-04');
    // Sanity: the response field should be a string, not a Date or shifted ISO
    expect(typeof body.start_date).toBe('string');
    expect(body.start_date).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });
});

describe('DELETE /api/user-programs/:id', () => {
  // The START describe block above can leave an active run for this user; clear
  // it so /start below isn't rejected by the active_run_exists (409) guard.
  beforeEach(async () => {
    await db.query(`DELETE FROM mesocycle_runs WHERE user_id=$1`, [userId]);
  });
  afterAll(async () => {
    await db.query(`DELETE FROM mesocycle_runs WHERE user_id=$1`, [userId]);
  });

  it('deletes the program and cascades its mesocycle data', async () => {
    const fork = await app.inject({
      method: 'POST',
      url: '/api/program-templates/full-body-3-day/fork',
      headers: auth(),
    });
    const upId = fork.json<{ id: string }>().id;

    // Start a mesocycle so child rows (runs, day_workouts, planned_sets) exist.
    const start = await app.inject({
      method: 'POST',
      url: `/api/user-programs/${upId}/start`,
      headers: auth(),
      body: { start_date: '2026-06-01', start_tz: 'America/Chicago' },
    });
    expect(start.statusCode).toBeLessThan(300);

    const before = await db.query<{ n: number }>(
      `SELECT count(*)::int AS n FROM mesocycle_runs WHERE user_program_id=$1`,
      [upId],
    );
    expect(before.rows[0].n).toBe(1);

    const del = await app.inject({
      method: 'DELETE',
      url: `/api/user-programs/${upId}`,
      headers: auth(),
    });
    expect(del.statusCode).toBe(204);

    const prog = await db.query(`SELECT 1 FROM user_programs WHERE id=$1`, [upId]);
    expect(prog.rows.length).toBe(0);
    const runs = await db.query<{ n: number }>(
      `SELECT count(*)::int AS n FROM mesocycle_runs WHERE user_program_id=$1`,
      [upId],
    );
    expect(runs.rows[0].n).toBe(0);
  });

  it('returns 404 for a program the caller does not own', async () => {
    const tmpl = await db.query<{ id: string; version: number; name: string }>(
      `SELECT id, version, name FROM program_templates WHERE slug='full-body-3-day'`,
    );
    const otherUp = await db.query<{ id: string }>(
      `INSERT INTO user_programs (user_id, template_id, template_version, name)
       VALUES ($1, $2, $3, $4) RETURNING id`,
      [otherUserId, tmpl.rows[0].id, tmpl.rows[0].version, tmpl.rows[0].name],
    );
    const del = await app.inject({
      method: 'DELETE',
      url: `/api/user-programs/${otherUp.rows[0].id}`,
      headers: auth(),
    });
    expect(del.statusCode).toBe(404);
    const still = await db.query(`SELECT 1 FROM user_programs WHERE id=$1`, [otherUp.rows[0].id]);
    expect(still.rows.length).toBe(1);
  });
});

describe('POST /api/user-programs/:id/archive + /unarchive', () => {
  // A leftover active/paused run from earlier describe blocks would make the
  // archive-409 test's /start return 409 (active_run_exists). Clear runs for
  // this user before each test and after the block — scoped to archive only.
  beforeEach(async () => {
    await db.query(`DELETE FROM mesocycle_runs WHERE user_id=$1`, [userId]);
  });
  afterAll(async () => {
    await db.query(`DELETE FROM mesocycle_runs WHERE user_id=$1`, [userId]);
  });

  it('archive sets archived_at and hides from default + past lists', async () => {
    const fork = await app.inject({
      method: 'POST',
      url: '/api/program-templates/full-body-3-day/fork',
      headers: auth(),
    });
    const upId = fork.json<{ id: string }>().id;

    const arch = await app.inject({
      method: 'POST',
      url: `/api/user-programs/${upId}/archive`,
      headers: auth(),
    });
    expect(arch.statusCode).toBe(200);

    const row = await db.query<{ archived_at: string | null }>(
      `SELECT archived_at FROM user_programs WHERE id=$1`,
      [upId],
    );
    expect(row.rows[0].archived_at).not.toBeNull();

    const def = await app.inject({ method: 'GET', url: '/api/user-programs', headers: auth() });
    expect(def.json<{ programs: { id: string }[] }>().programs.map((p) => p.id)).not.toContain(
      upId,
    );
  });

  it('archive is rejected with 409 when an active mesocycle run exists', async () => {
    const fork = await app.inject({
      method: 'POST',
      url: '/api/program-templates/full-body-3-day/fork',
      headers: auth(),
    });
    const upId = fork.json<{ id: string }>().id;
    const start = await app.inject({
      method: 'POST',
      url: `/api/user-programs/${upId}/start`,
      headers: auth(),
      body: { start_date: '2026-06-01', start_tz: 'America/Chicago' },
    });
    expect(start.statusCode).toBeLessThan(300);

    const arch = await app.inject({
      method: 'POST',
      url: `/api/user-programs/${upId}/archive`,
      headers: auth(),
    });
    expect(arch.statusCode).toBe(409);
  });

  it('unarchive clears archived_at', async () => {
    const fork = await app.inject({
      method: 'POST',
      url: '/api/program-templates/full-body-3-day/fork',
      headers: auth(),
    });
    const upId = fork.json<{ id: string }>().id;
    await app.inject({ method: 'POST', url: `/api/user-programs/${upId}/archive`, headers: auth() });

    const un = await app.inject({
      method: 'POST',
      url: `/api/user-programs/${upId}/unarchive`,
      headers: auth(),
    });
    expect(un.statusCode).toBe(200);
    const row = await db.query<{ archived_at: string | null }>(
      `SELECT archived_at FROM user_programs WHERE id=$1`,
      [upId],
    );
    expect(row.rows[0].archived_at).toBeNull();
  });

  it('archive returns 404 for a program the caller does not own', async () => {
    const tmpl = await db.query<{ id: string; version: number; name: string }>(
      `SELECT id, version, name FROM program_templates WHERE slug='full-body-3-day'`,
    );
    const otherUp = await db.query<{ id: string }>(
      `INSERT INTO user_programs (user_id, template_id, template_version, name)
       VALUES ($1, $2, $3, $4) RETURNING id`,
      [otherUserId, tmpl.rows[0].id, tmpl.rows[0].version, tmpl.rows[0].name],
    );
    const arch = await app.inject({
      method: 'POST',
      url: `/api/user-programs/${otherUp.rows[0].id}/archive`,
      headers: auth(),
    });
    expect(arch.statusCode).toBe(404);
  });
});
