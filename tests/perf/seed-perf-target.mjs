// Seed a perf target: one user + one started mesocycle on the seeded
// `upper-lower-4-day` template, plus a bearer token scoped health:weight:write
// (the only scope-gated hot endpoint; all others ignore scope). Prints shell
// `export` lines the README pipes into the k6 run loop.
//
// Run from the api dir so tsx + the app's relative imports resolve:
//   cd api && npx tsx ../tests/perf/seed-perf-target.mjs
// Requires DATABASE_URL (api/.env) pointing at repos_test and the seed having
// been applied (npm run seed) so program_templates has upper-lower-4-day.
//
// NOTE on import paths: ESM resolves relative imports against THIS file's URL
// (tests/perf/...), not the cwd. From tests/perf/ the api source is two levels
// up: ../../api/src/... . The .js extension maps to .ts under tsx.
import { buildApp } from '../../api/src/app.js';
import { db } from '../../api/src/db/client.js';
import { randomUUID } from 'node:crypto';

async function main() {
  const app = await buildApp();
  const email = `perf.${randomUUID()}@repos.test`;
  const { rows: [u] } = await db.query(
    `INSERT INTO users (email, goal) VALUES ($1, 'maintain') RETURNING id`,
    [email],
  );
  const userId = u.id;

  const mint = await app.inject({
    method: 'POST', url: '/api/tokens',
    payload: { user_id: userId, label: 'perf', scopes: ['health:weight:write'] },
  });
  if (mint.statusCode !== 201) throw new Error(`mint failed ${mint.statusCode}`);
  const token = mint.json().token;
  const auth = { authorization: `Bearer ${token}`, 'content-type': 'application/json' };

  const fork = await app.inject({
    method: 'POST', url: '/api/program-templates/upper-lower-4-day/fork',
    headers: auth, payload: { name: 'perf run' },
  });
  if (fork.statusCode !== 201) throw new Error(`fork failed ${fork.statusCode}`);
  const upId = fork.json().id;

  const start = await app.inject({
    method: 'POST', url: `/api/user-programs/${upId}/start`,
    headers: auth,
    payload: { start_date: new Date().toISOString().slice(0, 10), start_tz: 'America/Indiana/Indianapolis' },
  });
  if (start.statusCode !== 201) throw new Error(`start failed ${start.statusCode}`);
  const mesoId = start.json().mesocycle_run_id;

  const { rows: [ps] } = await db.query(
    `SELECT ps.id FROM planned_sets ps
       JOIN day_workouts dw ON dw.id = ps.day_workout_id
      WHERE dw.mesocycle_run_id = $1
      ORDER BY dw.week_idx, dw.day_idx, ps.block_idx, ps.set_idx LIMIT 1`,
    [mesoId],
  );
  // A substitute candidate: any non-archived seeded exercise.
  // (exercises has no is_active column; archived_at IS NULL is the active set.)
  const { rows: [ex] } = await db.query(
    `SELECT id FROM exercises WHERE archived_at IS NULL LIMIT 1`,
  );

  // For the /start perf target we need a SECOND, still-draft user_program so
  // the start script has something to start (the first is already started).
  const fork2 = await app.inject({
    method: 'POST', url: '/api/program-templates/upper-lower-4-day/fork',
    headers: auth, payload: { name: 'perf start target' },
  });
  const upStartId = fork2.statusCode === 201 ? fork2.json().id : upId;

  console.log(`export TOKEN='${token}'`);
  console.log(`export MESO_ID='${mesoId}'`);
  console.log(`export PS_ID='${ps.id}'`);
  console.log(`export UP_ID='${upStartId}'`);
  console.log(`export SUB_EX_ID='${ex.id}'`);
  console.log(`# seeded user_id=${userId} email=${email}`);

  await app.close();
  await db.end();
}
main().catch(async (e) => { console.error(e); await db.end(); process.exit(1); });
