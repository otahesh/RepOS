import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { createServer, type Server } from 'node:http';
import { db } from '../../src/db/client.js';
import { deliverFeedbackWebhook } from '../../src/lib/feedbackWebhook.js';
import { buildApp } from '../../src/app.js';
import { mkUser } from '../helpers/program-fixtures.js';

describe('deliverFeedbackWebhook', () => {
  let server: Server;
  let received: unknown[] = [];
  let userId: string;
  const savedUrl = process.env.FEEDBACK_WEBHOOK_URL;

  beforeAll(async () => {
    server = createServer((req, res) => {
      let raw = '';
      req.on('data', (c) => (raw += c));
      req.on('end', () => {
        received.push(JSON.parse(raw || '{}'));
        res.writeHead(204).end();
      });
    });
    await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
    const port = (server.address() as { port: number }).port;
    process.env.FEEDBACK_WEBHOOK_URL = `http://127.0.0.1:${port}/hook`;
    const { rows } = await db.query<{ id: string }>(
      `INSERT INTO users (email, timezone) VALUES ($1,'UTC') RETURNING id`,
      [`vitest.w7-deliver.${Date.now()}@repos.test`],
    );
    userId = rows[0].id;
  });

  afterAll(async () => {
    await new Promise<void>((r) => server.close(() => r()));
    if (savedUrl === undefined) delete process.env.FEEDBACK_WEBHOOK_URL;
    else process.env.FEEDBACK_WEBHOOK_URL = savedUrl;
    await db.query(`DELETE FROM feedback WHERE user_id=$1`, [userId]);
    await db.query(`DELETE FROM users WHERE id=$1`, [userId]);
  });

  it('delivers the payload and stamps webhook_delivered_at', async () => {
    const { rows } = await db.query<{ id: string }>(
      `INSERT INTO feedback (user_id, user_email_at_submit, body, route, app_sha)
       VALUES ($1,'tester@repos.test','hello from test','/today','abc123') RETURNING id`,
      [userId],
    );
    const id = rows[0].id;

    await deliverFeedbackWebhook(id, { sleep: () => Promise.resolve() });

    expect(received).toHaveLength(1);
    const { rows: after } = await db.query<{ webhook_delivered_at: Date | null; webhook_attempts: number }>(
      `SELECT webhook_delivered_at, webhook_attempts FROM feedback WHERE id=$1`,
      [id],
    );
    expect(after[0].webhook_delivered_at).not.toBeNull();
    expect(after[0].webhook_attempts).toBe(1);
  });

  it('no-ops cleanly when FEEDBACK_WEBHOOK_URL is unset', async () => {
    delete process.env.FEEDBACK_WEBHOOK_URL;
    const { rows } = await db.query<{ id: string }>(
      `INSERT INTO feedback (user_id, body) VALUES ($1,'no webhook configured') RETURNING id`,
      [userId],
    );
    await expect(deliverFeedbackWebhook(rows[0].id)).resolves.toBeUndefined();
    const { rows: after } = await db.query<{ webhook_attempts: number }>(
      `SELECT webhook_attempts FROM feedback WHERE id=$1`,
      [rows[0].id],
    );
    expect(after[0].webhook_attempts).toBe(0);
  });
});

describe('POST /api/feedback (bearer path)', () => {
  let app: Awaited<ReturnType<typeof buildApp>>;
  let userId: string;
  let token: string;

  beforeAll(async () => {
    app = await buildApp();
    const u = await mkUser({ prefix: 'vitest.w7-post' });
    userId = u.id;
    const mint = await app.inject({
      method: 'POST',
      url: '/api/tokens',
      body: { user_id: userId, label: 'w7', scopes: ['health:weight:write'] },
    });
    token = mint.json<{ token: string }>().token;
  });

  afterAll(async () => {
    await db.query(`DELETE FROM feedback WHERE user_id=$1`, [userId]);
    await db.query(`DELETE FROM device_tokens WHERE user_id=$1`, [userId]);
    await db.query(`DELETE FROM users WHERE id=$1`, [userId]);
    await app.close();
  });

  it('inserts a row stamped with the authenticated user + server context', async () => {
    const r = await app.inject({
      method: 'POST',
      url: '/api/feedback',
      headers: { authorization: `Bearer ${token}`, 'x-repos-csrf': '1', 'user-agent': 'vitest-UA' },
      body: { body: '  the deload button needs a tooltip  ', route: '/settings/health' },
    });
    expect(r.statusCode).toBe(201);
    const id = r.json<{ id: string }>().id;

    const { rows } = await db.query(
      `SELECT user_id, user_email_at_submit, body, route, user_agent, app_sha FROM feedback WHERE id=$1`,
      [id],
    );
    expect(rows[0].user_id).toBe(userId);
    expect(rows[0].body).toBe('the deload button needs a tooltip'); // trimmed
    expect(rows[0].route).toBe('/settings/health');
    expect(rows[0].user_agent).toBe('vitest-UA');
    expect(rows[0].user_email_at_submit).toContain('@repos.test');
    expect(rows[0].app_sha).toBe('dev'); // APP_SHA unset in test → 'dev'
  });

  it('rejects an empty body with 400', async () => {
    const r = await app.inject({
      method: 'POST',
      url: '/api/feedback',
      headers: { authorization: `Bearer ${token}`, 'x-repos-csrf': '1' },
      body: { body: '   ' },
    });
    expect(r.statusCode).toBe(400);
  });

  it('rejects unauthenticated requests with 401', async () => {
    const r = await app.inject({ method: 'POST', url: '/api/feedback', body: { body: 'hi' } });
    expect(r.statusCode).toBe(401);
  });
});

// G12 end-to-end: proves the ROUTE actually wires the async delivery loop —
// POST → row committed (201) → fire-and-forget deliverFeedbackWebhook →
// webhook_delivered_at stamped, all within the spec's 5s budget. The isolated
// tests above cover the pieces; only this asserts the wiring through POST.
describe('POST /api/feedback → async webhook delivery (G12 end-to-end)', () => {
  let app: Awaited<ReturnType<typeof buildApp>>;
  let server: Server;
  const received: unknown[] = [];
  let userId: string;
  let token: string;
  const savedUrl = process.env.FEEDBACK_WEBHOOK_URL;

  beforeAll(async () => {
    server = createServer((req, res) => {
      let raw = '';
      req.on('data', (c) => (raw += c));
      req.on('end', () => {
        received.push(JSON.parse(raw || '{}'));
        res.writeHead(204).end();
      });
    });
    await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
    const port = (server.address() as { port: number }).port;
    process.env.FEEDBACK_WEBHOOK_URL = `http://127.0.0.1:${port}/hook`;
    app = await buildApp();
    const u = await mkUser({ prefix: 'vitest.w7-e2e' });
    userId = u.id;
    const mint = await app.inject({
      method: 'POST',
      url: '/api/tokens',
      body: { user_id: userId, label: 'w7e2e', scopes: ['health:weight:write'] },
    });
    token = mint.json<{ token: string }>().token;
  });

  afterAll(async () => {
    await new Promise<void>((r) => server.close(() => r()));
    if (savedUrl === undefined) delete process.env.FEEDBACK_WEBHOOK_URL;
    else process.env.FEEDBACK_WEBHOOK_URL = savedUrl;
    await db.query(`DELETE FROM feedback WHERE user_id=$1`, [userId]);
    await db.query(`DELETE FROM device_tokens WHERE user_id=$1`, [userId]);
    await db.query(`DELETE FROM users WHERE id=$1`, [userId]);
    await app.close();
  });

  it('POST commits the row, then the async webhook stamps webhook_delivered_at ≤5s', async () => {
    const r = await app.inject({
      method: 'POST',
      url: '/api/feedback',
      headers: { authorization: `Bearer ${token}`, 'x-repos-csrf': '1' },
      body: { body: 'end-to-end webhook delivery', route: '/today' },
    });
    expect(r.statusCode).toBe(201);
    const id = r.json<{ id: string }>().id;

    // Fire-and-forget: poll for the durable proof the loop ran end-to-end.
    await expect
      .poll(
        async () => {
          const { rows } = await db.query<{ webhook_delivered_at: Date | null }>(
            `SELECT webhook_delivered_at FROM feedback WHERE id=$1`,
            [id],
          );
          return rows[0]?.webhook_delivered_at !== null && received.length >= 1;
        },
        { timeout: 5000, interval: 100 },
      )
      .toBe(true);
  });
});
