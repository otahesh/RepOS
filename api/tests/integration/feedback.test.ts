import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { createServer, type Server } from 'node:http';
import { db } from '../../src/db/client.js';
import { deliverFeedbackWebhook } from '../../src/lib/feedbackWebhook.js';

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

  it('delivers the payload and stamps webhook_delivered_at within 5s', async () => {
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
