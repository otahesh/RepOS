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
  const { rows: [u] } = await db.query(
    `INSERT INTO users (email) VALUES ($1) RETURNING id`,
    [`vitest.up.${Date.now()}@repos.test`],
  );
  userId = u.id;
  const { rows: [u2] } = await db.query(
    `INSERT INTO users (email) VALUES ($1) RETURNING id`,
    [`vitest.up.other.${Date.now()}@repos.test`],
  );
  otherUserId = u2.id;
  const mint = await app.inject({
    method: 'POST', url: '/api/tokens', body: { user_id: userId, label: 'up-test' }
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
      method: 'POST', url: '/api/program-templates/full-body-3-day/fork', headers: auth(),
    });
    const myUpId = fork.json<{ id: string }>().id;
    // someone else's
    const { rows: [tmpl] } = await db.query(
      `SELECT id, version, name FROM program_templates WHERE slug='full-body-3-day'`
    );
    const { rows: [otherUp] } = await db.query<{ id: string }>(
      `INSERT INTO user_programs (user_id, template_id, template_version, name)
       VALUES ($1, $2, $3, $4) RETURNING id`,
      [otherUserId, tmpl.id, tmpl.version, tmpl.name],
    );

    const r = await app.inject({ method: 'GET', url: '/api/user-programs', headers: auth() });
    expect(r.statusCode).toBe(200);
    const body = r.json<{ programs: { id: string }[] }>();
    const ids = body.programs.map(p => p.id);
    expect(ids).toContain(myUpId);
    expect(ids).not.toContain(otherUp.id);
  });

  it('401 without auth', async () => {
    const r = await app.inject({ method: 'GET', url: '/api/user-programs' });
    expect(r.statusCode).toBe(401);
  });
});

describe('GET /api/user-programs/:id', () => {
  let upId: string;
  beforeAll(async () => {
    const r = await app.inject({
      method: 'POST', url: '/api/program-templates/full-body-3-day/fork', headers: auth(),
    });
    upId = r.json<any>().id;
  });

  it('returns user_program with effective structure resolved (customizations overlay applied)', async () => {
    // Inject a rename customization
    await db.query(
      `UPDATE user_programs SET customizations='{"name_override":"My Program"}'::jsonb WHERE id=$1`,
      [upId],
    );
    const r = await app.inject({ method: 'GET', url: `/api/user-programs/${upId}`, headers: auth() });
    expect(r.statusCode).toBe(200);
    const body = r.json<any>();
    expect(body.id).toBe(upId);
    expect(body.effective_structure).toBeDefined();
    expect(body.effective_structure.days).toBeDefined();
    expect(body.effective_name).toBe('My Program');
  });

  it("404 on someone else's program (no leak)", async () => {
    const { rows: [tmpl] } = await db.query(
      `SELECT id, version, name FROM program_templates WHERE slug='full-body-3-day'`
    );
    const { rows: [other] } = await db.query(
      `INSERT INTO user_programs (user_id, template_id, template_version, name)
       VALUES ($1, $2, $3, $4) RETURNING id`,
      [otherUserId, tmpl.id, tmpl.version, tmpl.name],
    );
    const r = await app.inject({ method: 'GET', url: `/api/user-programs/${other.id}`, headers: auth() });
    expect(r.statusCode).toBe(404);
  });
});

describe('PATCH /api/user-programs/:id', () => {
  let upId: string;
  beforeAll(async () => {
    const r = await app.inject({
      method: 'POST', url: '/api/program-templates/full-body-3-day/fork', headers: auth(),
    });
    upId = r.json<any>().id;
  });

  it('rename op updates customizations.name_override', async () => {
    const r = await app.inject({
      method: 'PATCH', url: `/api/user-programs/${upId}`, headers: auth(),
      body: { op: 'rename', name: 'My Custom Plan' },
    });
    expect(r.statusCode).toBe(200);
    const { rows } = await db.query(
      `SELECT customizations FROM user_programs WHERE id=$1`, [upId],
    );
    expect(rows[0].customizations.name_override).toBe('My Custom Plan');
  });

  it('swap_exercise op records {week_idx:1, day_idx, block_idx, from_slug captured, to_slug}', async () => {
    const r = await app.inject({
      method: 'PATCH', url: `/api/user-programs/${upId}`, headers: auth(),
      body: {
        op: 'swap_exercise', day_idx: 0, block_idx: 0,
        to_exercise_slug: 'dumbbell-goblet-squat',
      },
    });
    expect(r.statusCode).toBe(200);
    const { rows } = await db.query(
      `SELECT customizations, template_id FROM user_programs WHERE id=$1`, [upId],
    );
    const swaps = rows[0].customizations.swaps;
    expect(Array.isArray(swaps)).toBe(true);
    expect(swaps).toContainEqual(
      expect.objectContaining({
        week_idx: 1, day_idx: 0, block_idx: 0, to_slug: 'dumbbell-goblet-squat',
      })
    );
    // from_slug must be captured from the template's current structure
    const swap = swaps.find((s: any) => s.day_idx === 0 && s.block_idx === 0);
    expect(typeof swap.from_slug).toBe('string');
    expect(swap.from_slug.length).toBeGreaterThan(0);
  });

  it('skip_day op records {week_idx, day_idx}', async () => {
    const r = await app.inject({
      method: 'PATCH', url: `/api/user-programs/${upId}`, headers: auth(),
      body: { op: 'skip_day', week_idx: 2, day_idx: 1 },
    });
    expect(r.statusCode).toBe(200);
    const { rows } = await db.query(
      `SELECT customizations FROM user_programs WHERE id=$1`, [upId],
    );
    expect(rows[0].customizations.skipped_days).toContainEqual({ week_idx: 2, day_idx: 1 });
  });

  it('400 on invalid op (not in schema)', async () => {
    const r = await app.inject({
      method: 'PATCH', url: `/api/user-programs/${upId}`, headers: auth(),
      body: { op: 'destroy_program' },
    });
    expect(r.statusCode).toBe(400);
  });

  it("404 on someone else's user_program", async () => {
    const { rows: [tmpl] } = await db.query(
      `SELECT id, version, name FROM program_templates WHERE slug='full-body-3-day'`
    );
    const { rows: [other] } = await db.query(
      `INSERT INTO user_programs (user_id, template_id, template_version, name)
       VALUES ($1, $2, $3, $4) RETURNING id`,
      [otherUserId, tmpl.id, tmpl.version, tmpl.name],
    );
    const r = await app.inject({
      method: 'PATCH', url: `/api/user-programs/${other.id}`, headers: auth(),
      body: { op: 'rename', name: 'Hijacked' },
    });
    expect(r.statusCode).toBe(404);
  });

  it('409 on archived program', async () => {
    // Mark this program as archived, attempt rename → 409
    await db.query(`UPDATE user_programs SET status='archived' WHERE id=$1`, [upId]);
    try {
      const r = await app.inject({
        method: 'PATCH', url: `/api/user-programs/${upId}`, headers: auth(),
        body: { op: 'rename', name: 'Should Reject' },
      });
      expect(r.statusCode).toBe(409);
    } finally {
      await db.query(`UPDATE user_programs SET status='draft' WHERE id=$1`, [upId]);
    }
  });

  it('draft program PATCH emits no mesocycle_run_events row', async () => {
    const fork = await app.inject({
      method: 'POST', url: '/api/program-templates/full-body-3-day/fork', headers: auth(),
    });
    const draftUpId = fork.json<{ id: string }>().id;
    const r = await app.inject({
      method: 'PATCH', url: `/api/user-programs/${draftUpId}`, headers: auth(),
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
      method: 'POST', url: '/api/program-templates/full-body-3-day/fork', headers: auth(),
    });
    const activeUpId = fork.json<{ id: string }>().id;
    const start = await app.inject({
      method: 'POST', url: `/api/user-programs/${activeUpId}/start`, headers: auth(),
      body: { start_date: '2026-05-04', start_tz: 'America/New_York' },
    });
    expect(start.statusCode).toBe(201);
    const runId = start.json<{ mesocycle_run_id: string }>().mesocycle_run_id;

    const patch = await app.inject({
      method: 'PATCH', url: `/api/user-programs/${activeUpId}`, headers: auth(),
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
      method: 'POST', url: '/api/program-templates/full-body-3-day/fork', headers: auth(),
    });
    const swapUpId = fork.json<{ id: string }>().id;
    const start = await app.inject({
      method: 'POST', url: `/api/user-programs/${swapUpId}/start`, headers: auth(),
      body: { start_date: '2026-05-04', start_tz: 'America/New_York' },
    });
    const runId = start.json<{ mesocycle_run_id: string }>().mesocycle_run_id;

    const patch = await app.inject({
      method: 'PATCH', url: `/api/user-programs/${swapUpId}`, headers: auth(),
      body: { op: 'swap_exercise', day_idx: 0, block_idx: 0, to_exercise_slug: 'dumbbell-goblet-squat' },
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
      method: 'POST', url: '/api/program-templates/full-body-3-day/fork', headers: auth(),
    });
    upId = r.json<any>().id;
  });

  it('201 materializes a mesocycle_run + returns its id + run details', async () => {
    const r = await app.inject({
      method: 'POST', url: `/api/user-programs/${upId}/start`, headers: auth(),
      body: { start_date: '2026-05-04', start_tz: 'America/New_York' },
    });
    expect(r.statusCode).toBe(201);
    const body = r.json<any>();
    expect(body.mesocycle_run_id).toBeDefined();
    expect(body.start_date).toBe('2026-05-04');
    expect(body.start_tz).toBe('America/New_York');
    const { rows } = await db.query(
      `SELECT status FROM mesocycle_runs WHERE id=$1`, [body.mesocycle_run_id],
    );
    expect(rows[0].status).toBe('active');
  });

  it('409 when an active run already exists for this user', async () => {
    await app.inject({
      method: 'POST', url: `/api/user-programs/${upId}/start`, headers: auth(),
      body: { start_date: '2026-05-04', start_tz: 'America/New_York' },
    });
    const r2 = await app.inject({
      method: 'POST', url: '/api/program-templates/upper-lower-4-day/fork', headers: auth(),
    });
    const upId2 = r2.json<any>().id;
    const startR = await app.inject({
      method: 'POST', url: `/api/user-programs/${upId2}/start`, headers: auth(),
      body: { start_date: '2026-05-04', start_tz: 'America/New_York' },
    });
    expect(startR.statusCode).toBe(409);
    expect(startR.json<any>().error).toBe('active_run_exists');
  });

  it('409 with must_refork:true when template_version is stale', async () => {
    const { rows: [tmpl] } = await db.query(
      `SELECT id, version FROM program_templates WHERE slug='full-body-3-day'`,
    );
    await db.query(`UPDATE program_templates SET version=version+1 WHERE id=$1`, [tmpl.id]);
    try {
      const r = await app.inject({
        method: 'POST', url: `/api/user-programs/${upId}/start`, headers: auth(),
        body: { start_date: '2026-05-04', start_tz: 'America/New_York' },
      });
      expect(r.statusCode).toBe(409);
      const body = r.json<any>();
      expect(body.error).toBe('template_outdated');
      expect(body.must_refork).toBe(true);
      expect(body.latest_version).toBe(tmpl.version + 1);
    } finally {
      await db.query(`UPDATE program_templates SET version=$1 WHERE id=$2`, [tmpl.version, tmpl.id]);
    }
  });

  it("404 on someone else's user_program", async () => {
    const { rows: [tmpl] } = await db.query(
      `SELECT id, version, name FROM program_templates WHERE slug='full-body-3-day'`,
    );
    const { rows: [other] } = await db.query(
      `INSERT INTO user_programs (user_id, template_id, template_version, name)
       VALUES ($1, $2, $3, $4) RETURNING id`,
      [otherUserId, tmpl.id, tmpl.version, tmpl.name],
    );
    const r = await app.inject({
      method: 'POST', url: `/api/user-programs/${other.id}/start`, headers: auth(),
      body: { start_date: '2026-05-04', start_tz: 'America/New_York' },
    });
    expect(r.statusCode).toBe(404);
  });

  it('400 on invalid body (bad date format)', async () => {
    const r = await app.inject({
      method: 'POST', url: `/api/user-programs/${upId}/start`, headers: auth(),
      body: { start_date: 'not-a-date', start_tz: 'America/New_York' },
    });
    expect(r.statusCode).toBe(400);
  });

  it('start_date in response is TZ-stable YYYY-MM-DD (not shifted by runtime TZ)', async () => {
    const r = await app.inject({
      method: 'POST', url: `/api/user-programs/${upId}/start`, headers: auth(),
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
