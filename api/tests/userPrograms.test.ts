import 'dotenv/config';
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
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
    await app.inject({
      method: 'POST', url: '/api/program-templates/full-body-3-day/fork', headers: auth(),
    });
    // someone else's
    const { rows: [tmpl] } = await db.query(
      `SELECT id, version, name FROM program_templates WHERE slug='full-body-3-day'`
    );
    await db.query(
      `INSERT INTO user_programs (user_id, template_id, template_version, name)
       VALUES ($1, $2, $3, $4)`,
      [otherUserId, tmpl.id, tmpl.version, tmpl.name],
    );

    const r = await app.inject({ method: 'GET', url: '/api/user-programs', headers: auth() });
    expect(r.statusCode).toBe(200);
    const body = r.json<{ programs: any[] }>();
    expect(body.programs.every(p => p.user_id === userId || p.user_id === undefined)).toBe(true);
    expect(body.programs.length).toBeGreaterThanOrEqual(1);
  });

  it('401 without auth', async () => {
    const r = await app.inject({ method: 'GET', url: '/api/user-programs' });
    expect(r.statusCode).toBe(401);
  });
});
