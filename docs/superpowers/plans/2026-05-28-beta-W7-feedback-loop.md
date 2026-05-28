# Beta W7 — In-app Feedback Loop Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship the in-app feedback loop — a logged-in user submits free-text feedback from anywhere; it lands in a `feedback` table within 5s, forwards to a Discord-compatible webhook (with durable delivery confirmation), and the sole admin can pull + triage it.

**Architecture:** New `feedback` table (migration 070). `POST /api/feedback` (auth + CSRF) inserts the row, stamps server-side context (`app_sha`, `user_agent`, `user_id`/email), responds 201, then fires an advisory Discord webhook asynchronously that writes back `webhook_delivered_at`. `GET /api/admin/feedback` + `PATCH /api/admin/feedback/:id/triage` are admin-gated. Frontend adds a Topbar bug-button opening a shared `FeedbackForm` (also hosted at the pre-provisioned `/settings/feedback`), plus a minimal admin page at `/admin/feedback`.

**Tech Stack:** Fastify 5 + zod v4 + pg (backend); Vite + React 18 + react-router + Testing Library + Playwright (frontend); native `fetch` for the webhook (no new dependency).

**Spec:** `docs/superpowers/specs/2026-05-28-w7-feedback-loop-design.md`. **Migration range:** 070–079.

**Conventions verified in this codebase (do not deviate):**
- Bash calls don't preserve cwd — always `cd /abs/path && …` or chain with `&&`.
- Backend tests split: `npm test` (unit, excludes `tests/integration/**`) vs `npm run test:integration` (serial, `singleFork` — **env mutations leak across integration files; always save/restore `process.env` in `beforeAll`/`afterAll`**).
- Migrations apply via `cd api && npm run migrate` (applies pending `*.sql` in filename order, tracked in `_migrations`).
- Route plugins are `export async function xRoutes(app: FastifyInstance)`, registered in `api/src/app.ts` with `{ prefix: '/api' }`.
- Auth: `requireBearerOrCfAccess` populates `req.userId` (NOT `req.userEmail` on the bearer path); `requireAdminKeyOrCfAccess()` is the admin gate; `csrfOrigin` enforces Origin/`X-RepOS-CSRF:1` only on the CF-Access cookie path.
- Frontend imports use **no** `.js`/`.ts` extension; backend imports use `.js`.
- Reachability gate (`frontend/scripts/check-page-reachability.mjs`, run by `npm run validate`): every file under `src/components/**` must be transitively importable from `src/main.tsx`; every `to=` in `Sidebar.tsx` must match a `<Route path>` in `App.tsx`.

---

## File Structure

**Backend (create):**
- `api/src/db/migrations/070_feedback.sql` — the table.
- `api/src/schemas/feedback.ts` — zod request schema.
- `api/src/lib/feedbackWebhook.ts` — `buildDiscordPayload`, `postWithRetry`, `deliverFeedbackWebhook`.
- `api/src/routes/feedback.ts` — `POST /api/feedback`.
- `api/src/routes/adminFeedback.ts` — admin list + triage.
- `api/tests/feedbackSchema.test.ts`, `api/tests/feedbackWebhook.test.ts` — unit.
- `api/tests/integration/feedback.test.ts`, `api/tests/integration/admin-feedback.test.ts`, `api/tests/integration/contamination/feedback-contamination.test.ts` — integration.

**Backend (modify):**
- `api/src/middleware/cfAccess.ts` — add exported `isAdminEmail()`, refactor `rejectIfNotAdminEmail` to use it.
- `api/src/app.ts` — register the two route plugins; add `is_admin` to the inline `/api/me` handler.
- `api/src/bootstrap-guards.ts` — info-log when `FEEDBACK_WEBHOOK_URL` unset.

**Infra (modify):**
- `docker/Dockerfile` — `ARG APP_SHA` → `ENV APP_SHA` in the runtime stage.
- `.github/workflows/docker.yml` — pass `build-args: APP_SHA=${{ github.sha }}`.

**Frontend (create):**
- `frontend/src/lib/api/feedback.ts` — typed client.
- `frontend/src/components/feedback/FeedbackForm.tsx` — shared textarea+Send form.
- `frontend/src/components/feedback/FeedbackSheet.tsx` — modal wrapper.
- `frontend/src/pages/SettingsFeedbackPage.tsx` — Settings host + admin link.
- `frontend/src/pages/AdminFeedbackPage.tsx` — admin triage list.
- `frontend/src/components/feedback/FeedbackForm.test.tsx`, `frontend/src/pages/SettingsFeedbackPage.test.tsx` — vitest.
- `frontend/playwright/w7-feedback-smoke.spec.ts` — hermetic UI smoke.

**Frontend (modify):**
- `frontend/src/components/Icon.tsx` — add `'feedback'` icon.
- `frontend/src/components/layout/Topbar.tsx` — add bug-button + mount `FeedbackSheet`.
- `frontend/src/components/settings/SettingsSidebar.tsx` — flip Feedback slot `disabled:false`.
- `frontend/src/App.tsx` — route `/settings/feedback` → `SettingsFeedbackPage`; add `/admin/feedback`.
- `frontend/src/auth.tsx` — add `is_admin?: boolean` to `User`.

**Docs (modify/create):**
- `docs/qa/beta-reachability.md` — add W7 section.
- `docs/runbooks/beta-triage.md` — create (G12 triage cadence).

---

## Task 1: Migration 070 — `feedback` table

**Files:**
- Create: `api/src/db/migrations/070_feedback.sql`

- [ ] **Step 1: Write the migration SQL**

```sql
-- Beta W7 — in-app feedback capture. One row per submission.
-- Range 070–079 reserved for W7 per per-wave migration-range claim (W6 reserved
-- 060–069). user_id is SET NULL on user delete so feedback outlives the account
-- (the engineer still wants to read it after a tester leaves), with the email
-- snapshot preserved alongside (mirrors account_events.user_email_at_event).
CREATE TABLE IF NOT EXISTS feedback (
  id                   BIGSERIAL   PRIMARY KEY,
  user_id              UUID        NULL REFERENCES users(id) ON DELETE SET NULL,
  user_email_at_submit TEXT        NULL,
  body                 TEXT        NOT NULL CHECK (char_length(body) BETWEEN 1 AND 4000),
  route                TEXT        NULL,
  app_sha              TEXT        NULL,
  user_agent           TEXT        NULL,
  created_at           TIMESTAMPTZ NOT NULL DEFAULT now(),
  triaged_at           TIMESTAMPTZ NULL,
  webhook_delivered_at TIMESTAMPTZ NULL,
  webhook_attempts     INT         NOT NULL DEFAULT 0
);

-- Admin triage view orders untriaged-first, newest-first.
CREATE INDEX IF NOT EXISTS feedback_triage_idx
  ON feedback (triaged_at NULLS FIRST, created_at DESC);
```

- [ ] **Step 2: Apply to the local test DB and verify it lands**

Run: `cd /Users/jasonmeyer.ict/Projects/RepOS/api && npm run migrate`
Expected: console prints `✓ 070_feedback.sql` then `Migrations complete.`

- [ ] **Step 3: Verify the table + constraint exist**

Run:
```bash
cd /Users/jasonmeyer.ict/Projects/RepOS/api && \
  psql "$DATABASE_URL" -c "\d feedback" -c "SELECT conname FROM pg_constraint WHERE conrelid='feedback'::regclass;"
```
(If `DATABASE_URL` isn't exported in the shell, read it from `api/.env`: `postgres://repos:repos_dev_pw@127.0.0.1:5432/repos_test`.)
Expected: table description shows all 10 columns; a CHECK constraint on `body` is listed.

- [ ] **Step 4: Commit**

```bash
cd /Users/jasonmeyer.ict/Projects/RepOS && \
  git add api/src/db/migrations/070_feedback.sql && \
  git commit -m "feat(w7): add feedback table (migration 070)"
```

---

## Task 2: Feedback request schema (zod v4)

**Files:**
- Create: `api/src/schemas/feedback.ts`
- Test: `api/tests/feedbackSchema.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
import { describe, it, expect } from 'vitest';
import { FeedbackCreateSchema } from '../src/schemas/feedback.js';

describe('FeedbackCreateSchema', () => {
  it('accepts a normal body and trims it', () => {
    const r = FeedbackCreateSchema.safeParse({ body: '  the rest timer skipped  ' });
    expect(r.success).toBe(true);
    if (r.success) expect(r.data.body).toBe('the rest timer skipped');
  });

  it('accepts an optional route', () => {
    const r = FeedbackCreateSchema.safeParse({ body: 'hi', route: '/today/abc/log' });
    expect(r.success).toBe(true);
    if (r.success) expect(r.data.route).toBe('/today/abc/log');
  });

  it('rejects an empty / whitespace-only body', () => {
    expect(FeedbackCreateSchema.safeParse({ body: '   ' }).success).toBe(false);
    expect(FeedbackCreateSchema.safeParse({ body: '' }).success).toBe(false);
  });

  it('rejects a body over 4000 chars', () => {
    expect(FeedbackCreateSchema.safeParse({ body: 'x'.repeat(4001) }).success).toBe(false);
    expect(FeedbackCreateSchema.safeParse({ body: 'x'.repeat(4000) }).success).toBe(true);
  });

  it('rejects unknown keys (cannot spoof user_id)', () => {
    expect(FeedbackCreateSchema.safeParse({ body: 'hi', user_id: 'other' }).success).toBe(false);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd /Users/jasonmeyer.ict/Projects/RepOS/api && npm test -- feedbackSchema`
Expected: FAIL — cannot find module `../src/schemas/feedback.js`.

- [ ] **Step 3: Write the schema**

```ts
// api/src/schemas/feedback.ts
// Beta W7 — request schema for POST /api/feedback. `.trim()` runs before the
// length checks so a whitespace-only body is rejected and the stored value is
// trimmed. `.strict()` rejects unknown keys (a client cannot smuggle user_id —
// identity is taken from the authenticated request, never the body).
import { z } from 'zod';

export const FeedbackCreateSchema = z
  .object({
    body: z.string().trim().min(1).max(4000),
    route: z.string().max(512).optional(),
  })
  .strict();
export type FeedbackCreate = z.infer<typeof FeedbackCreateSchema>;
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd /Users/jasonmeyer.ict/Projects/RepOS/api && npm test -- feedbackSchema`
Expected: PASS (5 tests).

- [ ] **Step 5: Commit**

```bash
cd /Users/jasonmeyer.ict/Projects/RepOS && \
  git add api/src/schemas/feedback.ts api/tests/feedbackSchema.test.ts && \
  git commit -m "feat(w7): feedback request schema (zod, trim + strict)"
```

---

## Task 3: Discord webhook builder + retry (pure, unit-tested)

**Files:**
- Create: `api/src/lib/feedbackWebhook.ts` (partial — `buildDiscordPayload` + `postWithRetry`; `deliverFeedbackWebhook` lands in Task 4)
- Test: `api/tests/feedbackWebhook.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
import { describe, it, expect, vi } from 'vitest';
import { buildDiscordPayload, postWithRetry } from '../src/lib/feedbackWebhook.js';

const ROW = {
  id: '42',
  body: 'rest timer skipped a beep',
  route: '/today/abc/log',
  app_sha: 'deadbee',
  user_email_at_submit: 'tester@repos.test',
};

describe('buildDiscordPayload', () => {
  it('builds a Discord embed with body as description + context fields', () => {
    const p = buildDiscordPayload(ROW);
    expect(p.content).toMatch(/feedback/i);
    expect(p.embeds[0].description).toBe(ROW.body);
    const names = p.embeds[0].fields.map((f) => f.name);
    expect(names).toEqual(expect.arrayContaining(['From', 'Route', 'Build']));
    expect(p.embeds[0].fields.find((f) => f.name === 'From')?.value).toBe('tester@repos.test');
  });

  it('falls back to placeholders for null context', () => {
    const p = buildDiscordPayload({ ...ROW, route: null, app_sha: null, user_email_at_submit: null });
    expect(p.embeds[0].fields.find((f) => f.name === 'From')?.value).toBe('unknown');
    expect(p.embeds[0].fields.find((f) => f.name === 'Route')?.value).toBe('—');
  });
});

describe('postWithRetry', () => {
  const payload = buildDiscordPayload(ROW);
  const noSleep = () => Promise.resolve();

  it('returns ok on a 2xx first try', async () => {
    const fetchImpl = vi.fn().mockResolvedValue({ ok: true, status: 204 });
    const r = await postWithRetry('http://hook', payload, { fetchImpl: fetchImpl as never, sleep: noSleep });
    expect(r).toEqual({ ok: true, attempts: 1 });
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it('retries on 429 then succeeds', async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce({ ok: false, status: 429 })
      .mockResolvedValueOnce({ ok: true, status: 204 });
    const r = await postWithRetry('http://hook', payload, { fetchImpl: fetchImpl as never, sleep: noSleep });
    expect(r).toEqual({ ok: true, attempts: 2 });
  });

  it('gives up after maxAttempts on persistent 5xx', async () => {
    const fetchImpl = vi.fn().mockResolvedValue({ ok: false, status: 500 });
    const r = await postWithRetry('http://hook', payload, { fetchImpl: fetchImpl as never, sleep: noSleep, maxAttempts: 3 });
    expect(r.ok).toBe(false);
    expect(r.attempts).toBe(3);
  });

  it('does NOT retry on a non-429 4xx', async () => {
    const fetchImpl = vi.fn().mockResolvedValue({ ok: false, status: 400 });
    const r = await postWithRetry('http://hook', payload, { fetchImpl: fetchImpl as never, sleep: noSleep });
    expect(r).toEqual({ ok: false, attempts: 1 });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd /Users/jasonmeyer.ict/Projects/RepOS/api && npm test -- feedbackWebhook`
Expected: FAIL — cannot find module `../src/lib/feedbackWebhook.js`.

- [ ] **Step 3: Write the builder + retry (no DB yet)**

```ts
// api/src/lib/feedbackWebhook.ts
// Beta W7 — Discord-compatible webhook delivery for feedback rows.
// No new dependency: native fetch (Node >=18). Delivery is ADVISORY — the POST
// /api/feedback handler fires it without awaiting and never fails the user
// submit on a webhook error (per CLAUDE.md: webhook is a notification, not the
// source of truth).

export interface FeedbackRow {
  id: string;
  body: string;
  route: string | null;
  app_sha: string | null;
  user_email_at_submit: string | null;
}

export interface DiscordWebhookPayload {
  content: string;
  embeds: Array<{
    title: string;
    description: string;
    fields: Array<{ name: string; value: string; inline?: boolean }>;
  }>;
}

export function buildDiscordPayload(row: FeedbackRow): DiscordWebhookPayload {
  return {
    content: 'New RepOS feedback',
    embeds: [
      {
        title: `Feedback #${row.id}`,
        // Discord embed description max is 4096; body is already capped at 4000.
        description: row.body.slice(0, 4000),
        fields: [
          { name: 'From', value: row.user_email_at_submit ?? 'unknown', inline: true },
          { name: 'Route', value: row.route ?? '—', inline: true },
          { name: 'Build', value: row.app_sha ?? 'dev', inline: true },
        ],
      },
    ],
  };
}

type FetchImpl = typeof fetch;

export interface PostOpts {
  fetchImpl?: FetchImpl;
  maxAttempts?: number;
  sleep?: (ms: number) => Promise<void>;
  timeoutMs?: number;
}

const defaultSleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

// Retries on network error / 429 / 5xx with capped exponential backoff (per
// CLAUDE.md API-reliability). Gives up immediately on a non-429 4xx (a bad
// payload won't fix itself). Returns the final outcome + attempt count.
export async function postWithRetry(
  url: string,
  payload: DiscordWebhookPayload,
  opts: PostOpts = {},
): Promise<{ ok: boolean; attempts: number }> {
  const fetchImpl = opts.fetchImpl ?? fetch;
  const maxAttempts = opts.maxAttempts ?? 3;
  const sleep = opts.sleep ?? defaultSleep;
  const timeoutMs = opts.timeoutMs ?? 5000;
  let attempts = 0;

  for (let i = 0; i < maxAttempts; i++) {
    attempts++;
    try {
      const ctrl = new AbortController();
      const timer = setTimeout(() => ctrl.abort(), timeoutMs);
      try {
        const res = await fetchImpl(url, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload),
          signal: ctrl.signal,
        });
        if (res.ok) return { ok: true, attempts };
        if (res.status !== 429 && res.status < 500) return { ok: false, attempts };
      } finally {
        clearTimeout(timer);
      }
    } catch {
      // network error / abort — fall through to retry
    }
    if (i < maxAttempts - 1) await sleep(250 * 2 ** i);
  }
  return { ok: false, attempts };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd /Users/jasonmeyer.ict/Projects/RepOS/api && npm test -- feedbackWebhook`
Expected: PASS (6 tests).

- [ ] **Step 5: Commit**

```bash
cd /Users/jasonmeyer.ict/Projects/RepOS && \
  git add api/src/lib/feedbackWebhook.ts api/tests/feedbackWebhook.test.ts && \
  git commit -m "feat(w7): Discord webhook payload builder + retry"
```

---

## Task 4: `deliverFeedbackWebhook` — persist delivery state (integration)

**Files:**
- Modify: `api/src/lib/feedbackWebhook.ts` (append `deliverFeedbackWebhook`)
- Test: `api/tests/integration/feedback.test.ts` (delivery section; rest of file in Task 5)

- [ ] **Step 1: Write the failing test (stand up a local mock receiver + assert DB writeback)**

```ts
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
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd /Users/jasonmeyer.ict/Projects/RepOS/api && npm run test:integration -- feedback`
Expected: FAIL — `deliverFeedbackWebhook` is not exported.

- [ ] **Step 3: Append `deliverFeedbackWebhook` to `feedbackWebhook.ts`**

```ts
import { db } from '../db/client.js';

// Reads the row, posts it to FEEDBACK_WEBHOOK_URL with retry, and persists the
// outcome (attempts + delivered timestamp). No-op when the URL is unset.
export async function deliverFeedbackWebhook(
  feedbackId: string,
  opts: Pick<PostOpts, 'fetchImpl' | 'sleep'> = {},
): Promise<void> {
  const url = process.env.FEEDBACK_WEBHOOK_URL;
  if (!url) return; // disabled (info-logged at boot in bootstrap-guards)

  const { rows } = await db.query<FeedbackRow>(
    `SELECT id, body, route, app_sha, user_email_at_submit FROM feedback WHERE id=$1`,
    [feedbackId],
  );
  const row = rows[0];
  if (!row) return;

  const { ok, attempts } = await postWithRetry(url, buildDiscordPayload(row), opts);
  await db.query(
    `UPDATE feedback
       SET webhook_attempts = $2,
           webhook_delivered_at = CASE WHEN $3 THEN now() ELSE webhook_delivered_at END
     WHERE id = $1`,
    [feedbackId, attempts, ok],
  );
}
```
(Add the `import { db }` line to the top of the file alongside the existing exports.)

- [ ] **Step 4: Run test to verify it passes**

Run: `cd /Users/jasonmeyer.ict/Projects/RepOS/api && npm run test:integration -- feedback`
Expected: PASS (2 tests in the delivery describe).

- [ ] **Step 5: Commit**

```bash
cd /Users/jasonmeyer.ict/Projects/RepOS && \
  git add api/src/lib/feedbackWebhook.ts api/tests/integration/feedback.test.ts && \
  git commit -m "feat(w7): deliverFeedbackWebhook persists delivery state"
```

---

## Task 5: `POST /api/feedback` route + register

**Files:**
- Create: `api/src/routes/feedback.ts`
- Modify: `api/src/app.ts` (import + register)
- Test: `api/tests/integration/feedback.test.ts` (append a route describe)

- [ ] **Step 1: Write the failing test (append to `feedback.test.ts`)**

```ts
import { buildApp } from '../../src/app.js';
import { mkUser } from '../helpers/program-fixtures.js';

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
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd /Users/jasonmeyer.ict/Projects/RepOS/api && npm run test:integration -- feedback`
Expected: FAIL — `POST /api/feedback` returns 404 (route not registered).

- [ ] **Step 3: Write the route**

```ts
// api/src/routes/feedback.ts
// Beta W7 — in-app feedback ingest. Identity comes from the authenticated
// request (req.userId), never the body. The webhook is fired without awaiting
// so a slow/broken Discord never blocks the user's submit.
import type { FastifyInstance } from 'fastify';
import { db } from '../db/client.js';
import { requireBearerOrCfAccess } from '../middleware/cfAccess.js';
import { csrfOrigin } from '../middleware/csrfOrigin.js';
import { FeedbackCreateSchema } from '../schemas/feedback.js';
import { deliverFeedbackWebhook } from '../lib/feedbackWebhook.js';

export async function feedbackRoutes(app: FastifyInstance) {
  app.post('/feedback', { preHandler: [requireBearerOrCfAccess, csrfOrigin] }, async (req, reply) => {
    const userId = (req as { userId?: string }).userId;
    if (!userId) return reply.code(500).send({ error: 'auth_state_missing' });

    const parsed = FeedbackCreateSchema.safeParse(req.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: 'invalid_body', issues: parsed.error.issues });
    }

    // The bearer path doesn't populate userEmail; re-read it (same precedent as
    // account.ts) so the row + Discord embed carry a human identifier.
    let email = (req as { userEmail?: string }).userEmail;
    if (!email) {
      const { rows } = await db.query<{ email: string }>(`SELECT email FROM users WHERE id=$1`, [userId]);
      email = rows[0]?.email;
    }

    const { rows } = await db.query<{ id: string }>(
      `INSERT INTO feedback (user_id, user_email_at_submit, body, route, app_sha, user_agent)
       VALUES ($1,$2,$3,$4,$5,$6) RETURNING id`,
      [
        userId,
        email ?? null,
        parsed.data.body,
        parsed.data.route ?? null,
        process.env.APP_SHA ?? 'dev',
        req.headers['user-agent'] ?? null,
      ],
    );
    const id = rows[0].id;

    // Advisory: fire-and-forget. Errors are logged, never surfaced to the user.
    void deliverFeedbackWebhook(id).catch((err) => req.log.error({ err }, 'feedback_webhook_failed'));

    return reply.code(201).send({ id });
  });
}
```

- [ ] **Step 4: Register in `app.ts`**

Add the import alongside the other route imports (after line 29):
```ts
import { feedbackRoutes } from './routes/feedback.js';
```
Add the registration in the `/api` block (after the `mesocyclesDeloadRoutes` line, line 75):
```ts
  await app.register(feedbackRoutes, { prefix: '/api' });
```

- [ ] **Step 5: Run test to verify it passes**

Run: `cd /Users/jasonmeyer.ict/Projects/RepOS/api && npm run test:integration -- feedback`
Expected: PASS (delivery describe + 3 route tests).

- [ ] **Step 6: Commit**

```bash
cd /Users/jasonmeyer.ict/Projects/RepOS && \
  git add api/src/routes/feedback.ts api/src/app.ts api/tests/integration/feedback.test.ts && \
  git commit -m "feat(w7): POST /api/feedback route"
```

---

## Task 6: `isAdminEmail` helper + `is_admin` on `/api/me`

**Files:**
- Modify: `api/src/middleware/cfAccess.ts` (add exported `isAdminEmail`, refactor `rejectIfNotAdminEmail`)
- Modify: `api/src/app.ts` (inline `/api/me` handler)
- Test: `api/tests/integration/admin-feedback.test.ts` (the `/api/me` portion; admin routes added in Task 7)

- [ ] **Step 1: Write the failing test**

```ts
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { buildApp } from '../../src/app.js';
import { setupTestJwks, type TestJwksHandle } from '../helpers/cf-access-jwt.js';
import { db } from '../../src/db/client.js';

describe('/api/me is_admin', () => {
  let app: Awaited<ReturnType<typeof buildApp>>;
  let jwks: TestJwksHandle;
  const savedAdminEmails = process.env.REPOS_ADMIN_EMAILS;

  beforeAll(async () => {
    jwks = await setupTestJwks();
    process.env.REPOS_ADMIN_EMAILS = 'boss@repos.test';
    app = await buildApp();
  });

  afterAll(async () => {
    await jwks.teardown();
    if (savedAdminEmails === undefined) delete process.env.REPOS_ADMIN_EMAILS;
    else process.env.REPOS_ADMIN_EMAILS = savedAdminEmails;
    await db.query(`DELETE FROM users WHERE email IN ('boss@repos.test','peon@repos.test')`);
    await app.close();
  });

  it('returns is_admin=true for an admin email', async () => {
    const jwt = await jwks.mintJwt('boss@repos.test');
    const r = await app.inject({ method: 'GET', url: '/api/me', headers: { cookie: `CF_Authorization=${jwt}` } });
    expect(r.statusCode).toBe(200);
    expect(r.json<{ is_admin: boolean }>().is_admin).toBe(true);
  });

  it('returns is_admin=false for a non-admin email', async () => {
    const jwt = await jwks.mintJwt('peon@repos.test');
    const r = await app.inject({ method: 'GET', url: '/api/me', headers: { cookie: `CF_Authorization=${jwt}` } });
    expect(r.statusCode).toBe(200);
    expect(r.json<{ is_admin: boolean }>().is_admin).toBe(false);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd /Users/jasonmeyer.ict/Projects/RepOS/api && npm run test:integration -- admin-feedback`
Expected: FAIL — `is_admin` is `undefined` in the `/api/me` response.

- [ ] **Step 3: Add `isAdminEmail` to `cfAccess.ts` and refactor**

Add this exported helper above `rejectIfNotAdminEmail` (around line 173):
```ts
// True iff `email` is in the comma-separated REPOS_ADMIN_EMAILS allow-list.
// Fail-closed: unset env or empty email → false (never accidentally admin).
export function isAdminEmail(email: string | undefined | null): boolean {
  const adminEmails = process.env.REPOS_ADMIN_EMAILS;
  if (!adminEmails || !email) return false;
  return adminEmails
    .split(',')
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean)
    .includes(email.toLowerCase());
}
```
Then refactor the body of `rejectIfNotAdminEmail` to reuse it (keep the misconfigured-403 + warn behavior):
```ts
function rejectIfNotAdminEmail(req: FastifyRequest, reply: FastifyReply): boolean {
  if (!process.env.REPOS_ADMIN_EMAILS) {
    req.log.error('admin_check: REPOS_ADMIN_EMAILS not configured — failing closed');
    reply.code(403).send({ error: 'admin_check_misconfigured' });
    return true;
  }
  const userEmail = (req as { userEmail?: string }).userEmail;
  if (!isAdminEmail(userEmail)) {
    req.log.warn({ userEmail }, 'admin_check_rejected');
    reply.code(403).send({ error: 'not_an_admin' });
    return true;
  }
  return false;
}
```

- [ ] **Step 4: Add `is_admin` to the inline `/api/me` handler in `app.ts`**

Update the import on line 26:
```ts
import { requireCfAccess, isAdminEmail } from './middleware/cfAccess.js';
```
Add `is_admin` to the returned object in the `/api/me` handler (after the `par_q_advisory_active` line, ~line 107):
```ts
      is_admin: isAdminEmail((req as { userEmail?: string }).userEmail),
```

- [ ] **Step 5: Run test to verify it passes**

Run: `cd /Users/jasonmeyer.ict/Projects/RepOS/api && npm run test:integration -- admin-feedback`
Expected: PASS (2 tests).

- [ ] **Step 6: Commit**

```bash
cd /Users/jasonmeyer.ict/Projects/RepOS && \
  git add api/src/middleware/cfAccess.ts api/src/app.ts api/tests/integration/admin-feedback.test.ts && \
  git commit -m "feat(w7): isAdminEmail helper + is_admin on /api/me"
```

---

## Task 7: Admin list + triage routes

**Files:**
- Create: `api/src/routes/adminFeedback.ts`
- Modify: `api/src/app.ts` (import + register)
- Test: `api/tests/integration/admin-feedback.test.ts` (append admin-route describe)

- [ ] **Step 1: Write the failing test (append)**

```ts
describe('admin feedback routes', () => {
  let app: Awaited<ReturnType<typeof buildApp>>;
  let jwks: TestJwksHandle;
  let feedbackId: string;       // a newer untriaged row (also exercised by the triage test)
  let olderUntriagedId: string; // an older untriaged row
  let triagedId: string;        // an already-triaged row
  const savedAdminEmails = process.env.REPOS_ADMIN_EMAILS;
  const savedAdminKey = process.env.ADMIN_API_KEY;

  beforeAll(async () => {
    jwks = await setupTestJwks();
    process.env.REPOS_ADMIN_EMAILS = 'boss@repos.test';
    process.env.ADMIN_API_KEY = 'w7-admin-key'; // force the gate closed for non-admins
    app = await buildApp();
    // Seed THREE rows so the list test can prove the spec-mandated ordering
    // (triaged_at NULLS FIRST, created_at DESC) — not just presence: two
    // untriaged at different times + one already-triaged.
    const ins = await db.query<{ id: string }>(
      `INSERT INTO feedback (body, user_email_at_submit, route, created_at, triaged_at) VALUES
         ('older untriaged','t@repos.test','/today', now() - interval '2 hours', NULL),
         ('newer untriaged','t@repos.test','/today', now() - interval '1 hour', NULL),
         ('already triaged','t@repos.test','/today', now(),                      now())
       RETURNING id`,
    );
    olderUntriagedId = ins.rows[0].id;
    feedbackId = ins.rows[1].id; // newer untriaged
    triagedId = ins.rows[2].id;
  });

  afterAll(async () => {
    await jwks.teardown();
    if (savedAdminEmails === undefined) delete process.env.REPOS_ADMIN_EMAILS; else process.env.REPOS_ADMIN_EMAILS = savedAdminEmails;
    if (savedAdminKey === undefined) delete process.env.ADMIN_API_KEY; else process.env.ADMIN_API_KEY = savedAdminKey;
    await db.query(`DELETE FROM feedback WHERE id = ANY($1::bigint[])`, [[feedbackId, olderUntriagedId, triagedId]]);
    await db.query(`DELETE FROM users WHERE email IN ('boss@repos.test','peon@repos.test')`);
    await app.close();
  });

  it('lists untriaged-first, newest-first within untriaged (X-Admin-Key path)', async () => {
    const r = await app.inject({ method: 'GET', url: '/api/admin/feedback', headers: { 'x-admin-key': 'w7-admin-key' } });
    expect(r.statusCode).toBe(200);
    const ids = r.json<{ items: { id: string }[] }>().items.map((i) => i.id);
    const iNewer = ids.indexOf(feedbackId);
    const iOlder = ids.indexOf(olderUntriagedId);
    const iTriaged = ids.indexOf(triagedId);
    expect(iNewer).toBeGreaterThanOrEqual(0); // present (if -1, reset the test DB — shared-DB cruft)
    expect(iNewer).toBeLessThan(iOlder);      // newer untriaged before older untriaged (created_at DESC)
    expect(iOlder).toBeLessThan(iTriaged);    // both untriaged before the triaged row (NULLS FIRST)
  });

  it('403s a non-admin CF Access email', async () => {
    const jwt = await jwks.mintJwt('peon@repos.test');
    const r = await app.inject({ method: 'GET', url: '/api/admin/feedback', headers: { cookie: `CF_Authorization=${jwt}` } });
    expect(r.statusCode).toBe(403);
  });

  it('marks triaged_at idempotently', async () => {
    const r1 = await app.inject({ method: 'PATCH', url: `/api/admin/feedback/${feedbackId}/triage`, headers: { 'x-admin-key': 'w7-admin-key' } });
    expect(r1.statusCode).toBe(200);
    const t1 = r1.json<{ triaged_at: string }>().triaged_at;
    expect(t1).not.toBeNull();
    const r2 = await app.inject({ method: 'PATCH', url: `/api/admin/feedback/${feedbackId}/triage`, headers: { 'x-admin-key': 'w7-admin-key' } });
    expect(r2.json<{ triaged_at: string }>().triaged_at).toBe(t1); // unchanged
  });

  it('404s a triage on a non-numeric / missing id', async () => {
    const r = await app.inject({ method: 'PATCH', url: `/api/admin/feedback/99999999/triage`, headers: { 'x-admin-key': 'w7-admin-key' } });
    expect(r.statusCode).toBe(404);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd /Users/jasonmeyer.ict/Projects/RepOS/api && npm run test:integration -- admin-feedback`
Expected: FAIL — admin routes 404 (not registered).

- [ ] **Step 3: Write the routes**

```ts
// api/src/routes/adminFeedback.ts
// Beta W7 — admin triage surface. Admin-gated (X-Admin-Key OR CF Access +
// REPOS_ADMIN_EMAILS). List is untriaged-first, newest-first.
import type { FastifyInstance } from 'fastify';
import { db } from '../db/client.js';
import { requireAdminKeyOrCfAccess } from '../middleware/cfAccess.js';
import { csrfOrigin } from '../middleware/csrfOrigin.js';

const SELECT_COLS = `
  id, body, route, app_sha, user_email_at_submit,
  to_char(created_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS"Z"') AS created_at,
  to_char(triaged_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS"Z"') AS triaged_at,
  to_char(webhook_delivered_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS"Z"') AS webhook_delivered_at`;

export async function adminFeedbackRoutes(app: FastifyInstance) {
  app.get<{ Querystring: { limit?: string } }>(
    '/admin/feedback',
    { preHandler: requireAdminKeyOrCfAccess() },
    async (req, reply) => {
      const limit = Math.min(Math.max(parseInt(req.query.limit ?? '100', 10) || 100, 1), 200);
      const { rows } = await db.query(
        `SELECT ${SELECT_COLS} FROM feedback ORDER BY triaged_at NULLS FIRST, created_at DESC LIMIT $1`,
        [limit],
      );
      return reply.send({ items: rows });
    },
  );

  app.patch<{ Params: { id: string } }>(
    '/admin/feedback/:id/triage',
    { preHandler: [requireAdminKeyOrCfAccess(), csrfOrigin] },
    async (req, reply) => {
      const { id } = req.params;
      if (!/^\d+$/.test(id)) return reply.code(404).send({ error: 'not_found' });
      const { rows } = await db.query(
        `UPDATE feedback SET triaged_at = COALESCE(triaged_at, now()) WHERE id=$1 RETURNING ${SELECT_COLS}`,
        [id],
      );
      if (rows.length === 0) return reply.code(404).send({ error: 'not_found' });
      return reply.send(rows[0]);
    },
  );
}
```

- [ ] **Step 4: Register in `app.ts`**

Add the import (after the `feedbackRoutes` import from Task 5):
```ts
import { adminFeedbackRoutes } from './routes/adminFeedback.js';
```
Add the registration (after the `feedbackRoutes` registration):
```ts
  await app.register(adminFeedbackRoutes, { prefix: '/api' });
```

- [ ] **Step 5: Run test to verify it passes**

Run: `cd /Users/jasonmeyer.ict/Projects/RepOS/api && npm run test:integration -- admin-feedback`
Expected: PASS (the `/api/me` describe from Task 6 + 4 admin-route tests).

- [ ] **Step 6: Commit**

```bash
cd /Users/jasonmeyer.ict/Projects/RepOS && \
  git add api/src/routes/adminFeedback.ts api/src/app.ts api/tests/integration/admin-feedback.test.ts && \
  git commit -m "feat(w7): admin feedback list + triage routes"
```

---

## Task 8: Contamination / IDOR test (G2)

**Files:**
- Create: `api/tests/integration/contamination/feedback-contamination.test.ts`

- [ ] **Step 1: Write the test**

```ts
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { buildApp } from '../../../src/app.js';
import { mkUser } from '../../helpers/program-fixtures.js';
import { db } from '../../../src/db/client.js';

// G2: POST /api/feedback is a per-user write — a client cannot attribute
// feedback to another user (identity is from the token, body is .strict()).
// GET /api/admin/feedback is admin-global — a regular bearer must NOT get a
// 200-with-data. Adds 2 routes to the G2 matrix.
describe('feedback contamination — G2', () => {
  let app: Awaited<ReturnType<typeof buildApp>>;
  let userA: string;
  let tokenA: string;
  const savedAdminKey = process.env.ADMIN_API_KEY;

  beforeAll(async () => {
    // Mint the bearer FIRST, while the admin gate is still OPEN (ADMIN_API_KEY
    // unset → open-admin bypass in requireAdminKeyOrCfAccess; the gate reads the
    // env at request time). THEN set ADMIN_API_KEY so the "regular bearer can't
    // read the admin list" assertion gets a real 401/403 instead of the open
    // path. (Precedent: account-sessions-delete-contamination.test.ts mints
    // with ADMIN_API_KEY unset for exactly this reason.)
    delete process.env.ADMIN_API_KEY;
    app = await buildApp();
    const a = await mkUser({ prefix: 'vitest.w7-cont-a' });
    userA = a.id;
    const mint = await app.inject({
      method: 'POST', url: '/api/tokens',
      body: { user_id: userA, label: 'A', scopes: ['health:weight:write'] },
    });
    tokenA = mint.json<{ token: string }>().token;
    process.env.ADMIN_API_KEY = 'w7-cont-key'; // now close the gate for the admin-list assertion
  });

  afterAll(async () => {
    if (savedAdminKey === undefined) delete process.env.ADMIN_API_KEY; else process.env.ADMIN_API_KEY = savedAdminKey;
    await db.query(`DELETE FROM feedback WHERE user_id=$1`, [userA]);
    await db.query(`DELETE FROM device_tokens WHERE user_id=$1`, [userA]);
    await db.query(`DELETE FROM users WHERE id=$1`, [userA]);
    await app.close();
  });

  it('a body with a spoofed user_id is rejected (strict schema)', async () => {
    const r = await app.inject({
      method: 'POST', url: '/api/feedback',
      headers: { authorization: `Bearer ${tokenA}`, 'x-repos-csrf': '1' },
      body: { body: 'hi', user_id: '00000000-0000-0000-0000-000000000000' },
    });
    expect(r.statusCode).toBe(400);
  });

  it('a valid submit is stamped with the token owner, not a body value', async () => {
    const r = await app.inject({
      method: 'POST', url: '/api/feedback',
      headers: { authorization: `Bearer ${tokenA}`, 'x-repos-csrf': '1' },
      body: { body: 'legit feedback' },
    });
    expect(r.statusCode).toBe(201);
    const { rows } = await db.query(`SELECT user_id FROM feedback WHERE id=$1`, [r.json<{ id: string }>().id]);
    expect(rows[0].user_id).toBe(userA);
  });

  it('a regular bearer cannot read the admin feedback list', async () => {
    const r = await app.inject({
      method: 'GET', url: '/api/admin/feedback',
      headers: { authorization: `Bearer ${tokenA}` },
    });
    expect([401, 403]).toContain(r.statusCode); // never 200-with-data
  });
});
```

- [ ] **Step 2: Run test to verify it passes** (route already exists from Tasks 5/7)

Run: `cd /Users/jasonmeyer.ict/Projects/RepOS/api && npm run test:integration -- feedback-contamination`
Expected: PASS (3 tests).

- [ ] **Step 3: Commit**

```bash
cd /Users/jasonmeyer.ict/Projects/RepOS && \
  git add api/tests/integration/contamination/feedback-contamination.test.ts && \
  git commit -m "test(w7): feedback contamination matrix (G2, +2 routes)"
```

---

## Task 9: Optional `FEEDBACK_WEBHOOK_URL` boot guard

**Files:**
- Modify: `api/src/bootstrap-guards.ts`
- Test: extend the existing bootstrap-guards unit test if present; else create `api/tests/bootstrapGuards.feedback.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
import { describe, it, expect } from 'vitest';
import { validateStartupEnv } from '../src/bootstrap-guards.js';

describe('validateStartupEnv — FEEDBACK_WEBHOOK_URL', () => {
  const base = { DATABASE_URL: 'postgres://x', NODE_ENV: 'test' } as NodeJS.ProcessEnv;
  it('info-logs (not fatal) when FEEDBACK_WEBHOOK_URL is unset', () => {
    const r = validateStartupEnv({ ...base });
    expect(r.fatal).not.toContain('FEEDBACK_WEBHOOK_URL must be set');
    expect(JSON.stringify(r.info)).toMatch(/FEEDBACK_WEBHOOK_URL unset/);
  });
  it('does not info-log when set', () => {
    const r = validateStartupEnv({ ...base, FEEDBACK_WEBHOOK_URL: 'https://discord/x' });
    expect(JSON.stringify(r.info)).not.toMatch(/FEEDBACK_WEBHOOK_URL unset/);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd /Users/jasonmeyer.ict/Projects/RepOS/api && npm test -- bootstrapGuards.feedback`
Expected: FAIL — no `FEEDBACK_WEBHOOK_URL unset` info line.

- [ ] **Step 3: Add the info log to `validateStartupEnv`** (before `return { fatal, info };`)

```ts
  if (!env.FEEDBACK_WEBHOOK_URL) {
    info.push({ msg: 'FEEDBACK_WEBHOOK_URL unset — feedback webhook delivery disabled' });
  }
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd /Users/jasonmeyer.ict/Projects/RepOS/api && npm test -- bootstrapGuards.feedback`
Expected: PASS (2 tests).

- [ ] **Step 5: Commit**

```bash
cd /Users/jasonmeyer.ict/Projects/RepOS && \
  git add api/src/bootstrap-guards.ts api/tests/bootstrapGuards.feedback.test.ts && \
  git commit -m "feat(w7): boot info-log for optional FEEDBACK_WEBHOOK_URL"
```

---

## Task 10: `APP_SHA` build-arg through Docker + CI

**Files:**
- Modify: `docker/Dockerfile`
- Modify: `.github/workflows/docker.yml`

- [ ] **Step 1: Add the ARG/ENV LATE in the runtime stage** (`docker/Dockerfile`, immediately **before** `EXPOSE 80` on line 84 — NOT right after `FROM`)

```dockerfile
# W7 — the running API stamps feedback.app_sha from this. CI passes the commit
# SHA as a build-arg; falls back to "dev" for local builds. Placed late in the
# stage on purpose: APP_SHA changes every commit, so a BuildKit layer that
# consumes it must sit AFTER the stable, expensive `apk add` + binary-check +
# mkdir layers — otherwise every push to main busts the postgres/node/nginx
# install cache. APP_SHA is read only at node startup, so a late ENV layer is
# functionally identical.
ARG APP_SHA=dev
ENV APP_SHA=$APP_SHA
```

- [ ] **Step 2: Pass the build-arg in CI** (`.github/workflows/docker.yml`, inside the `docker/build-push-action@v6` `with:` block, after the `file:` line)

```yaml
          build-args: |
            APP_SHA=${{ github.sha }}
```

- [ ] **Step 3: Verify the Dockerfile change (honest about what's actually checked)**

The edit is two trivial lines (an `ARG`/`ENV` pair) plus one YAML `build-args:` line — near-zero syntax risk. There is **no pre-merge Docker CI**: `.github/workflows/docker.yml` runs a real `docker/build-push-action` build only on push to `main` (post-merge), and `test.yml` never builds the image. So do an explicit local check if Docker is present, and DON'T mask a real failure as success:

```bash
cd /Users/jasonmeyer.ict/Projects/RepOS && \
  if command -v docker >/dev/null 2>&1; then \
    docker build --check -f docker/Dockerfile . && echo "CHECK OK" || echo "CHECK FAILED — fix the Dockerfile"; \
  else \
    echo "docker not installed — visually confirm the ARG/ENV lines + build-args YAML; docker.yml will build on merge to main"; \
  fi
```
Expected: `CHECK OK`, or the "docker not installed" line (Docker is absent on this workstation, so the visual-confirm branch is expected here). `docker build --check` needs Buildx ≥0.15 / Engine 27; if it errors as an unknown flag, fall back to visual confirmation — do not treat the error as a pass.

- [ ] **Step 4: Commit**

```bash
cd /Users/jasonmeyer.ict/Projects/RepOS && \
  git add docker/Dockerfile .github/workflows/docker.yml && \
  git commit -m "feat(w7): wire APP_SHA build-arg into image + CI"
```

---

## Task 11: Frontend API client

**Files:**
- Create: `frontend/src/lib/api/feedback.ts`

- [ ] **Step 1: Write the client** (no separate unit test — exercised by the component test in Task 12 and the smoke in Task 16)

```ts
// frontend/src/lib/api/feedback.ts
// Beta W7 — typed client for the feedback surfaces. State-changing calls carry
// X-RepOS-CSRF:1 (the csrfOrigin middleware requires it on the CF Access path).
import { apiFetch } from '../../auth';
import { jsonOrThrow } from './_http';

export type FeedbackSubmit = { body: string; route?: string };
export type FeedbackCreated = { id: string };

export async function submitFeedback(input: FeedbackSubmit): Promise<FeedbackCreated> {
  const res = await apiFetch('/api/feedback', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-RepOS-CSRF': '1' },
    body: JSON.stringify(input),
  });
  return jsonOrThrow<FeedbackCreated>(res);
}

export type AdminFeedbackItem = {
  id: string;
  body: string;
  route: string | null;
  app_sha: string | null;
  user_email_at_submit: string | null;
  created_at: string;
  triaged_at: string | null;
  webhook_delivered_at: string | null;
};

export async function listAdminFeedback(): Promise<{ items: AdminFeedbackItem[] }> {
  const res = await apiFetch('/api/admin/feedback');
  return jsonOrThrow<{ items: AdminFeedbackItem[] }>(res);
}

export async function triageFeedback(id: string): Promise<AdminFeedbackItem> {
  const res = await apiFetch(`/api/admin/feedback/${id}/triage`, {
    method: 'PATCH',
    headers: { 'X-RepOS-CSRF': '1' },
  });
  return jsonOrThrow<AdminFeedbackItem>(res);
}
```

- [ ] **Step 2: Typecheck**

Run: `cd /Users/jasonmeyer.ict/Projects/RepOS/frontend && npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 3: Commit**

```bash
cd /Users/jasonmeyer.ict/Projects/RepOS && \
  git add frontend/src/lib/api/feedback.ts && \
  git commit -m "feat(w7): frontend feedback api client"
```

---

## Task 12: `feedback` Icon + shared `FeedbackForm`

**Files:**
- Modify: `frontend/src/components/Icon.tsx`
- Create: `frontend/src/components/feedback/FeedbackForm.tsx`
- Test: `frontend/src/components/feedback/FeedbackForm.test.tsx`

- [ ] **Step 1: Write the failing component test**

```tsx
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { FeedbackForm } from './FeedbackForm';

vi.mock('../../lib/api/feedback', () => ({ submitFeedback: vi.fn() }));
vi.mock('../common/ToastHost', () => ({ pushToast: vi.fn() }));
import { submitFeedback } from '../../lib/api/feedback';
import { pushToast } from '../common/ToastHost';

describe('FeedbackForm', () => {
  beforeEach(() => vi.clearAllMocks());

  it('disables Send until the textarea has non-whitespace content', async () => {
    render(<FeedbackForm />);
    const send = screen.getByRole('button', { name: /send/i });
    expect(send).toBeDisabled();
    await userEvent.type(screen.getByRole('textbox'), 'something is off');
    expect(send).toBeEnabled();
  });

  it('submits the body + route, toasts success, clears, and calls onSubmitted', async () => {
    (submitFeedback as ReturnType<typeof vi.fn>).mockResolvedValue({ id: '7' });
    const onSubmitted = vi.fn();
    render(<FeedbackForm initialRoute="/today/x/log" onSubmitted={onSubmitted} />);
    await userEvent.type(screen.getByRole('textbox'), 'bug here');
    await userEvent.click(screen.getByRole('button', { name: /send/i }));
    await waitFor(() => expect(submitFeedback).toHaveBeenCalledWith({ body: 'bug here', route: '/today/x/log' }));
    expect(pushToast).toHaveBeenCalledWith(expect.objectContaining({ severity: 'success' }));
    expect(onSubmitted).toHaveBeenCalled();
    expect((screen.getByRole('textbox') as HTMLTextAreaElement).value).toBe('');
  });

  it('toasts an error on failure and keeps the text', async () => {
    (submitFeedback as ReturnType<typeof vi.fn>).mockRejectedValue(new Error('HTTP 500'));
    render(<FeedbackForm />);
    await userEvent.type(screen.getByRole('textbox'), 'keep me');
    await userEvent.click(screen.getByRole('button', { name: /send/i }));
    await waitFor(() => expect(pushToast).toHaveBeenCalledWith(expect.objectContaining({ severity: 'error' })));
    expect((screen.getByRole('textbox') as HTMLTextAreaElement).value).toBe('keep me');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd /Users/jasonmeyer.ict/Projects/RepOS/frontend && npm test -- FeedbackForm`
Expected: FAIL — cannot find `./FeedbackForm`.

- [ ] **Step 3: Add the `feedback` icon** to `Icon.tsx`

Append `'feedback'` to the `IconName` union (end of the type, line 15):
```ts
  | 'pause' | 'play' | 'settings' | 'key' | 'trash' | 'copy' | 'eye' | 'eyeOff' | 'feedback'
```
Add the path to the `paths` record (after the `eyeOff` entry, line 57):
```tsx
    feedback: <g {...p}><path d="M21 11.5a8.38 8.38 0 01-.9 3.8 8.5 8.5 0 01-7.6 4.7 8.38 8.38 0 01-3.8-.9L3 21l1.9-5.7a8.38 8.38 0 01-.9-3.8 8.5 8.5 0 014.7-7.6 8.38 8.38 0 013.8-.9h.5a8.48 8.48 0 018 8v.5z"/></g>,
```

- [ ] **Step 4: Write `FeedbackForm.tsx`**

```tsx
// frontend/src/components/feedback/FeedbackForm.tsx
// Beta W7 — shared feedback form (textarea + char counter + Send). Used by both
// the Topbar FeedbackSheet and the /settings/feedback page. Design-system
// styled (Inter Tight, surface inputs, all-caps accent CTA).
import { useState } from 'react';
import { TOKENS, FONTS } from '../../tokens';
import { submitFeedback } from '../../lib/api/feedback';
import { pushToast } from '../common/ToastHost';

const MAX = 4000;

export function FeedbackForm({
  initialRoute,
  onSubmitted,
}: {
  initialRoute?: string;
  onSubmitted?: () => void;
}) {
  const [body, setBody] = useState('');
  const [saving, setSaving] = useState(false);
  const canSend = body.trim().length > 0 && body.length <= MAX && !saving;

  async function handleSend(): Promise<void> {
    setSaving(true);
    try {
      await submitFeedback({ body: body.trim(), ...(initialRoute ? { route: initialRoute } : {}) });
      pushToast({ severity: 'success', body: 'Thanks — feedback sent.' });
      setBody('');
      onSubmitted?.();
    } catch (err) {
      pushToast({
        severity: 'error',
        body: 'Could not send. ' + (err instanceof Error ? err.message : 'Try again.'),
      });
    } finally {
      setSaving(false);
    }
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
      <textarea
        aria-label="Feedback"
        placeholder="What's working, what's broken, what's missing?"
        value={body}
        maxLength={MAX}
        rows={5}
        onChange={(e) => setBody(e.target.value)}
        style={{
          padding: '10px 12px', background: TOKENS.bg, color: TOKENS.text,
          border: `1px solid ${TOKENS.lineStrong}`, borderRadius: 8, fontSize: 14,
          fontFamily: FONTS.ui, resize: 'vertical', minHeight: 96,
        }}
      />
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <span style={{ fontFamily: FONTS.mono, fontSize: 11, color: TOKENS.textMute }}>
          {body.length}/{MAX}
        </span>
        <button
          type="button"
          onClick={() => void handleSend()}
          disabled={!canSend}
          style={{
            padding: '8px 18px', borderRadius: 6, border: 'none',
            background: canSend ? TOKENS.accent : TOKENS.surface,
            color: canSend ? '#fff' : TOKENS.textMute,
            fontFamily: FONTS.ui, fontSize: 13, fontWeight: 600, letterSpacing: 0.6,
            cursor: canSend ? 'pointer' : 'not-allowed',
          }}
        >
          {saving ? 'SENDING…' : 'SEND'}
        </button>
      </div>
    </div>
  );
}
```

- [ ] **Step 5: Run test to verify it passes**

Run: `cd /Users/jasonmeyer.ict/Projects/RepOS/frontend && npm test -- FeedbackForm`
Expected: PASS (3 tests).

- [ ] **Step 6: Commit**

```bash
cd /Users/jasonmeyer.ict/Projects/RepOS && \
  git add frontend/src/components/Icon.tsx frontend/src/components/feedback/FeedbackForm.tsx frontend/src/components/feedback/FeedbackForm.test.tsx && \
  git commit -m "feat(w7): feedback icon + shared FeedbackForm"
```

---

## Task 13: `FeedbackSheet` + Topbar bug-button

**Files:**
- Create: `frontend/src/components/feedback/FeedbackSheet.tsx`
- Modify: `frontend/src/components/layout/Topbar.tsx`

- [ ] **Step 1: Write `FeedbackSheet.tsx`** (modal overlay; ESC/backdrop close; autofills route from current location)

```tsx
// frontend/src/components/feedback/FeedbackSheet.tsx
// Beta W7 — modal wrapper around FeedbackForm, opened from the Topbar bug-button.
// Autofills the current route so the engineer sees where the user was.
import { useEffect } from 'react';
import { useLocation } from 'react-router-dom';
import { TOKENS, FONTS } from '../../tokens';
import { FeedbackForm } from './FeedbackForm';

export function FeedbackSheet({ open, onClose }: { open: boolean; onClose: () => void }) {
  const location = useLocation();

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  if (!open) return null;

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Send feedback"
      onClick={onClose}
      style={{
        position: 'fixed', inset: 0, zIndex: 1000,
        background: 'rgba(0,0,0,0.5)',
        display: 'flex', alignItems: 'flex-start', justifyContent: 'center', padding: '12vh 16px 16px',
      }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          width: '100%', maxWidth: 460, background: TOKENS.surface,
          border: `1px solid ${TOKENS.line}`, borderRadius: 14, padding: 20,
          display: 'flex', flexDirection: 'column', gap: 14,
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <h2 style={{ margin: 0, fontSize: 16, fontFamily: FONTS.ui, color: TOKENS.text }}>Send feedback</h2>
          <button type="button" aria-label="Close" onClick={onClose}
            style={{ background: 'none', border: 'none', color: TOKENS.textMute, cursor: 'pointer', fontSize: 18 }}>×</button>
        </div>
        <FeedbackForm initialRoute={location.pathname} onSubmitted={onClose} />
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Add the bug-button to `Topbar.tsx`**

Add to the imports (after line 5):
```tsx
import { useState } from 'react'
import { FeedbackSheet } from '../feedback/FeedbackSheet'
```
(`useState` is already imported on line 1 — merge it there instead of duplicating; the final import line 1 reads `import { useEffect, useState, useCallback } from 'react'`.)

Inside the component, add state (after line 41, `const isMobile = useIsMobile()`):
```tsx
  const [feedbackOpen, setFeedbackOpen] = useState(false)
```

Add the button as the FIRST child of the right-side action group (immediately after `<div style={{ display: 'flex', alignItems: 'center', gap: 12, flexShrink: 0 }}>` on line 134, before the sync pill `<div>`):
```tsx
        <button
          type="button"
          onClick={() => setFeedbackOpen(true)}
          aria-label="Send feedback"
          style={{
            width: 36, height: 36, flexShrink: 0,
            display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
            borderRadius: 8, border: `1px solid ${TOKENS.line}`,
            background: TOKENS.surface, color: TOKENS.text, cursor: 'pointer', padding: 0,
          }}>
          <Icon name="feedback" size={18} color={TOKENS.text} />
        </button>
```

Mount the sheet just before the closing `</header>` (after the action-group `</div>` on line 185):
```tsx
      <FeedbackSheet open={feedbackOpen} onClose={() => setFeedbackOpen(false)} />
```

- [ ] **Step 3: Typecheck + run the existing Topbar/nav smoke**

Run: `cd /Users/jasonmeyer.ict/Projects/RepOS/frontend && npx tsc --noEmit && npm test -- navigation.smoke`
Expected: no type errors; navigation smoke still passes.

- [ ] **Step 4: Commit**

```bash
cd /Users/jasonmeyer.ict/Projects/RepOS && \
  git add frontend/src/components/feedback/FeedbackSheet.tsx frontend/src/components/layout/Topbar.tsx && \
  git commit -m "feat(w7): Topbar feedback button + FeedbackSheet modal"
```

---

## Task 14: Settings → Feedback page (flip slot + route)

**Files:**
- Modify: `frontend/src/components/settings/SettingsSidebar.tsx`
- Create: `frontend/src/pages/SettingsFeedbackPage.tsx`
- Modify: `frontend/src/App.tsx`
- Modify: `frontend/src/auth.tsx` (add `is_admin?` to `User`)
- Test: `frontend/src/pages/SettingsFeedbackPage.test.tsx`

- [ ] **Step 1: Write the failing page test**

```tsx
import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import SettingsFeedbackPage from './SettingsFeedbackPage';

vi.mock('../auth', async () => {
  const actual = await vi.importActual<typeof import('../auth')>('../auth');
  return { ...actual, useCurrentUser: vi.fn() };
});
import { useCurrentUser } from '../auth';

function renderWith(is_admin: boolean) {
  (useCurrentUser as ReturnType<typeof vi.fn>).mockReturnValue({
    status: 'authenticated',
    user: { id: '1', email: 'a@b.c', display_name: null, timezone: 'UTC', is_admin },
    error: null,
  });
  render(<MemoryRouter><SettingsFeedbackPage /></MemoryRouter>);
}

describe('SettingsFeedbackPage', () => {
  it('renders the feedback form', () => {
    renderWith(false);
    expect(screen.getByRole('textbox', { name: /feedback/i })).toBeInTheDocument();
  });
  it('shows the admin link only for admins', () => {
    renderWith(true);
    expect(screen.getByRole('link', { name: /view all feedback/i })).toHaveAttribute('href', '/admin/feedback');
  });
  it('hides the admin link for non-admins', () => {
    renderWith(false);
    expect(screen.queryByRole('link', { name: /view all feedback/i })).toBeNull();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd /Users/jasonmeyer.ict/Projects/RepOS/frontend && npm test -- SettingsFeedbackPage`
Expected: FAIL — cannot find `./SettingsFeedbackPage`.

- [ ] **Step 3: Add `is_admin?` to the `User` type** (`frontend/src/auth.tsx`, in the `User` interface after `par_q_advisory_active?`)

```ts
  is_admin?: boolean
```

- [ ] **Step 4: Write `SettingsFeedbackPage.tsx`**

```tsx
// frontend/src/pages/SettingsFeedbackPage.tsx
// Beta W7 — full-page feedback host in Settings. Admins also get a link to the
// triage view (gated client-side by is_admin; the API enforces it server-side).
import { Link } from 'react-router-dom';
import { TOKENS, FONTS } from '../tokens';
import { useCurrentUser } from '../auth';
import { FeedbackForm } from '../components/feedback/FeedbackForm';

export default function SettingsFeedbackPage() {
  const { user } = useCurrentUser();
  return (
    <div style={{ maxWidth: 560, margin: '0 auto', padding: '24px 20px', display: 'flex', flexDirection: 'column', gap: 16 }}>
      <header style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
        <h1 style={{ margin: 0, fontSize: 20, fontFamily: FONTS.ui, color: TOKENS.text }}>Feedback</h1>
        <p style={{ margin: 0, fontSize: 13, color: TOKENS.textDim }}>
          Found a bug or have an idea? Tell us — it goes straight to the team.
        </p>
      </header>
      <section style={{ background: TOKENS.surface, border: `1px solid ${TOKENS.line}`, borderRadius: 12, padding: 20 }}>
        <FeedbackForm />
      </section>
      {user?.is_admin && (
        <Link to="/admin/feedback" style={{ color: TOKENS.accent, fontSize: 13, fontFamily: FONTS.mono, letterSpacing: 0.4 }}>
          VIEW ALL FEEDBACK →
        </Link>
      )}
    </div>
  );
}
```

- [ ] **Step 5: Flip the Settings slot** (`SettingsSidebar.tsx` line 23): change `disabled: true` to `disabled: false` on the Feedback row.

- [ ] **Step 6: Route it** in `App.tsx` — add the import (after line 19):
```tsx
import SettingsFeedbackPage from './pages/SettingsFeedbackPage'
```
Replace the `settings/feedback` route (lines 60–62) with:
```tsx
            <Route path="settings/feedback" element={<SettingsFeedbackPage />} />
```

**Then remove the now-dead `ComingSoonPlaceholder`** — W7 was its last consumer, and leaving it breaks `npm run validate` two ways (verified): keeping the import fails `tsc` with `TS6133 'ComingSoonPlaceholder' is declared but its value is never read` (frontend `tsconfig.json` has `noUnusedLocals:true`); removing the import but keeping the file fails `check-page-reachability.mjs` with a 1-orphan error (the file is under `src/components/**` and isn't in `KNOWN_PENDING`). Both deletions are required:
- Delete the import line in `App.tsx` (currently line 21): `import { ComingSoonPlaceholder } from './components/common/ComingSoonPlaceholder'`
- Delete the file `frontend/src/components/common/ComingSoonPlaceholder.tsx`.
- Verify nothing else references it:
```bash
cd /Users/jasonmeyer.ict/Projects/RepOS && grep -rn "ComingSoonPlaceholder" frontend/src && echo "REMAINING REFS — fix before commit" || echo "clean: zero references"
```
Expected: `clean: zero references`.

- [ ] **Step 7: Run test + reachability gate**

Run: `cd /Users/jasonmeyer.ict/Projects/RepOS/frontend && npm test -- SettingsFeedbackPage && node scripts/check-page-reachability.mjs`
Expected: page tests PASS; `page-reachability: OK` (Feedback slot now non-disabled and its Route exists).

- [ ] **Step 8: Commit**

```bash
cd /Users/jasonmeyer.ict/Projects/RepOS && \
  git rm frontend/src/components/common/ComingSoonPlaceholder.tsx && \
  git add frontend/src/pages/SettingsFeedbackPage.tsx frontend/src/pages/SettingsFeedbackPage.test.tsx frontend/src/components/settings/SettingsSidebar.tsx frontend/src/App.tsx frontend/src/auth.tsx && \
  git commit -m "feat(w7): Settings -> Feedback page + slot flip + is_admin type; drop dead ComingSoonPlaceholder"
```

---

## Task 15: Admin triage page

**Files:**
- Create: `frontend/src/pages/AdminFeedbackPage.tsx`
- Modify: `frontend/src/App.tsx` (add route)
- Test: `frontend/src/pages/AdminFeedbackPage.test.tsx`

- [ ] **Step 1: Write the failing test**

```tsx
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import AdminFeedbackPage from './AdminFeedbackPage';

vi.mock('../lib/api/feedback', () => ({ listAdminFeedback: vi.fn(), triageFeedback: vi.fn() }));
import { listAdminFeedback, triageFeedback } from '../lib/api/feedback';

const ITEM = {
  id: '5', body: 'rest timer bug', route: '/today', app_sha: 'abc', user_email_at_submit: 't@x.io',
  created_at: '2026-05-28T00:00:00Z', triaged_at: null, webhook_delivered_at: '2026-05-28T00:00:01Z',
};

describe('AdminFeedbackPage', () => {
  beforeEach(() => vi.clearAllMocks());

  it('renders feedback rows from the API', async () => {
    (listAdminFeedback as ReturnType<typeof vi.fn>).mockResolvedValue({ items: [ITEM] });
    render(<AdminFeedbackPage />);
    expect(await screen.findByText(/rest timer bug/)).toBeInTheDocument();
  });

  it('marks an item triaged on button click', async () => {
    (listAdminFeedback as ReturnType<typeof vi.fn>).mockResolvedValue({ items: [ITEM] });
    (triageFeedback as ReturnType<typeof vi.fn>).mockResolvedValue({ ...ITEM, triaged_at: '2026-05-28T01:00:00Z' });
    render(<AdminFeedbackPage />);
    await screen.findByText(/rest timer bug/);
    await userEvent.click(screen.getByRole('button', { name: /mark triaged/i }));
    await waitFor(() => expect(triageFeedback).toHaveBeenCalledWith('5'));
  });

  it('shows a not-authorized message on 403', async () => {
    (listAdminFeedback as ReturnType<typeof vi.fn>).mockRejectedValue(Object.assign(new Error('HTTP 403'), { status: 403 }));
    render(<AdminFeedbackPage />);
    expect(await screen.findByText(/not authorized/i)).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd /Users/jasonmeyer.ict/Projects/RepOS/frontend && npm test -- AdminFeedbackPage`
Expected: FAIL — cannot find `./AdminFeedbackPage`.

- [ ] **Step 3: Write `AdminFeedbackPage.tsx`**

```tsx
// frontend/src/pages/AdminFeedbackPage.tsx
// Beta W7 — minimal admin triage list. The route is reachable but the API
// admin-gates it; a non-admin sees "Not authorized".
import { useEffect, useState } from 'react';
import { TOKENS, FONTS } from '../tokens';
import { listAdminFeedback, triageFeedback, type AdminFeedbackItem } from '../lib/api/feedback';
import { pushToast } from '../components/common/ToastHost';

export default function AdminFeedbackPage() {
  const [items, setItems] = useState<AdminFeedbackItem[] | null>(null);
  const [denied, setDenied] = useState(false);

  useEffect(() => {
    listAdminFeedback()
      .then((r) => setItems(r.items))
      .catch((err: { status?: number }) => {
        if (err?.status === 403 || err?.status === 401) setDenied(true);
        else pushToast({ severity: 'error', body: 'Could not load feedback.' });
      });
  }, []);

  async function handleTriage(id: string): Promise<void> {
    try {
      const updated = await triageFeedback(id);
      setItems((prev) => prev?.map((i) => (i.id === id ? updated : i)) ?? null);
    } catch {
      pushToast({ severity: 'error', body: 'Triage failed.' });
    }
  }

  if (denied) {
    return <div style={{ padding: 32, color: TOKENS.danger, fontFamily: FONTS.mono }}>Not authorized.</div>;
  }

  return (
    <div style={{ maxWidth: 760, margin: '0 auto', padding: '24px 20px', display: 'flex', flexDirection: 'column', gap: 12 }}>
      <h1 style={{ margin: 0, fontSize: 20, fontFamily: FONTS.ui, color: TOKENS.text }}>Feedback triage</h1>
      {items === null && <div style={{ color: TOKENS.textMute, fontFamily: FONTS.mono, fontSize: 12 }}>Loading…</div>}
      {items?.length === 0 && <div style={{ color: TOKENS.textMute }}>No feedback yet.</div>}
      {items?.map((i) => (
        <div key={i.id} style={{
          background: TOKENS.surface, border: `1px solid ${TOKENS.line}`, borderRadius: 10, padding: 14,
          opacity: i.triaged_at ? 0.55 : 1, display: 'flex', flexDirection: 'column', gap: 8,
        }}>
          <div style={{ fontSize: 14, color: TOKENS.text, whiteSpace: 'pre-wrap' }}>{i.body}</div>
          <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', fontFamily: FONTS.mono, fontSize: 11, color: TOKENS.textMute }}>
            <span>{i.user_email_at_submit ?? 'unknown'}</span>
            <span>{i.route ?? '—'}</span>
            <span>{i.app_sha ?? 'dev'}</span>
            <span style={{ color: i.webhook_delivered_at ? TOKENS.good : TOKENS.warn }}>
              {i.webhook_delivered_at ? 'delivered' : 'not delivered'}
            </span>
            <span>{i.created_at}</span>
          </div>
          {!i.triaged_at && (
            <button type="button" onClick={() => void handleTriage(i.id)}
              style={{
                alignSelf: 'flex-start', padding: '6px 12px', borderRadius: 6, border: `1px solid ${TOKENS.line}`,
                background: TOKENS.bg, color: TOKENS.text, fontFamily: FONTS.ui, fontSize: 12, cursor: 'pointer',
              }}>Mark triaged</button>
          )}
        </div>
      ))}
    </div>
  );
}
```

- [ ] **Step 4: Route it** in `App.tsx` — add the import (after the `SettingsFeedbackPage` import):
```tsx
import AdminFeedbackPage from './pages/AdminFeedbackPage'
```
Add the route inside the AppShell `<Route path="/">` block (after the `settings/feedback` route):
```tsx
            <Route path="admin/feedback" element={<AdminFeedbackPage />} />
```

- [ ] **Step 5: Run test + reachability**

Run: `cd /Users/jasonmeyer.ict/Projects/RepOS/frontend && npm test -- AdminFeedbackPage && node scripts/check-page-reachability.mjs`
Expected: 3 tests PASS; `page-reachability: OK`.

- [ ] **Step 6: Commit**

```bash
cd /Users/jasonmeyer.ict/Projects/RepOS && \
  git add frontend/src/pages/AdminFeedbackPage.tsx frontend/src/pages/AdminFeedbackPage.test.tsx frontend/src/App.tsx && \
  git commit -m "feat(w7): admin feedback triage page"
```

---

## Task 16: Hermetic Playwright UI smoke

**Files:**
- Create: `frontend/playwright/w7-feedback-smoke.spec.ts`

> **Note on verification layers:** the rigorous "row in DB ≤5s + webhook delivered" assertion lives in the integration tests (Tasks 4–5, against the real DB + a mock receiver). This Playwright spec is **hermetic** (route-mocked, same pattern as `w6-signout-everywhere-g3d.spec.ts`) and proves the *UI path*: the Topbar button → sheet → submit → success toast, plus the route auto-fill. The against-prod CF-Access run (G12 final) is a runbook step (Task 17), not CI — there is no staging (`project_beta_no_staging`).

- [ ] **Step 1: Write the spec**

```ts
// frontend/playwright/w7-feedback-smoke.spec.ts
// W7 / G12 (UI layer) — a logged-in (non-admin) user opens feedback from the
// Topbar, submits, and sees a success toast. Hermetic: /api/feedback is mocked
// 201 and the POST body is captured to assert the route auto-fill. The DB-row +
// webhook-delivery assertions live in the api integration tests.
import { test, expect, type BrowserContext, type Route } from '@playwright/test';

// onboarding_completed_at MUST be a past timestamp: AppShell.useOnboardingGate
// mounts a full-viewport OnboardingOverlay (role=dialog, zIndex 1500) whenever
// it is falsy, which would cover the Topbar feedback button and fail the click.
// par_q fields included so the PAR-Q gate also stays down. (No /api/me/par-q
// route mock needed — refreshParQ catches a miss and leaves the gate closed.)
const USER = {
  id: 'user-1', email: 'tester@example.com', display_name: 'Tester', timezone: 'UTC',
  is_admin: false, onboarding_completed_at: '2026-01-01T00:00:00Z',
  par_q_version: 1, par_q_advisory_active: false,
};

test('W7: user submits feedback from the Topbar button', async ({ browser }) => {
  const posted: Array<Record<string, unknown>> = [];

  const wire = async (ctx: BrowserContext): Promise<void> => {
    await ctx.route('**/api/me', (r: Route) => r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(USER) }));
    await ctx.route('**/api/equipment/profile', (r: Route) =>
      r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ _v: 1, barbell: { available: true } }) }));
    await ctx.route('**/api/health/sync/status', (r: Route) =>
      r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ source: 'Apple Health', last_success_at: null, state: 'stale' }) }));
    await ctx.route('**/api/feedback', async (r: Route) => {
      posted.push(JSON.parse(r.request().postData() ?? '{}'));
      await r.fulfill({ status: 201, contentType: 'application/json', body: JSON.stringify({ id: '1' }) });
    });
  };

  const ctx = await browser.newContext();
  await wire(ctx);
  const page = await ctx.newPage();
  await page.goto('/');

  await page.getByRole('button', { name: /send feedback/i }).click();
  const dialog = page.getByRole('dialog', { name: /send feedback/i });
  await expect(dialog).toBeVisible();

  await dialog.getByRole('textbox', { name: /feedback/i }).fill('the rest timer skipped a beep');
  const resp = page.waitForResponse('**/api/feedback');
  await dialog.getByRole('button', { name: /^send$/i }).click();
  expect((await resp).status()).toBe(201);

  await expect(page.getByText(/feedback sent/i)).toBeVisible();
  expect(posted).toHaveLength(1);
  expect(posted[0]).toMatchObject({ body: 'the rest timer skipped a beep', route: '/' });
});
```

- [ ] **Step 2: Run the spec**

Run: `cd /Users/jasonmeyer.ict/Projects/RepOS/frontend && npx playwright test w7-feedback-smoke`
Expected: 1 passed. (First run builds the preview server — allow up to 180s.)

- [ ] **Step 3: Commit**

```bash
cd /Users/jasonmeyer.ict/Projects/RepOS && \
  git add frontend/playwright/w7-feedback-smoke.spec.ts && \
  git commit -m "test(w7): hermetic Playwright feedback UI smoke"
```

---

## Task 17: Docs — reachability + triage runbook

**Files:**
- Modify: `docs/qa/beta-reachability.md` (append W7 section)
- Create: `docs/runbooks/beta-triage.md`

- [ ] **Step 1: Append the W7 reachability section** to `docs/qa/beta-reachability.md` (match the existing table format):

```markdown
## W7 — Feedback

| Surface | Path from `/` | Clicks |
|---|---|---|
| Send feedback (FeedbackSheet) | `/` → Topbar "Send feedback" button | 1 ✓ |
| Feedback page (`/settings/feedback`) | `/` → Settings → Feedback | 2 ✓ |
| Admin triage (`/admin/feedback`, admins only) | `/` → Settings → Feedback → "View all feedback" | 3 ✓ |

Source-of-truth selectors:
- Topbar button: `frontend/src/components/layout/Topbar.tsx` `aria-label="Send feedback"`.
- Settings slot: `frontend/src/components/settings/SettingsSidebar.tsx::SETTINGS_SECTIONS` Feedback entry (`disabled:false`); route `settings/feedback` → `SettingsFeedbackPage` in `App.tsx`.
- Admin link: rendered only when `useCurrentUser().user.is_admin`; route `admin/feedback` → `AdminFeedbackPage`.
- Playwright: `frontend/playwright/w7-feedback-smoke.spec.ts`.

G7 status: ✓ — all three W7 surfaces ≤3 clicks.
```

- [ ] **Step 2: Create `docs/runbooks/beta-triage.md`** (G12 triage cadence + the prod-window smoke)

```markdown
# Beta Feedback Triage Runbook (G12)

## Channel
In-app feedback (W7) → `feedback` table → Discord webhook (`FEEDBACK_WEBHOOK_URL`).
This is the documented Beta contact path (contributes to G14).

## Privacy note
The Discord payload's "From" field carries the submitter's **account email** (the
CF-Access identity). The webhook channel therefore contains tester PII — keep it
private to the engineering operator. The full email is also retained in the
`feedback` table (read via `GET /api/admin/feedback` over CF Access). This is an
accepted Beta decision (N≤10 trusted testers, operator's own Discord); revisit a
pseudonymous identifier at GA.

## Delivery is advisory — the table row is the source of truth
The webhook is fired fire-and-forget after the row is committed; it is NOT the
durable record. If the process restarts between insert and send, or all retries
fail (Discord outage), `webhook_delivered_at` stays NULL and there is no
auto-resend. The admin page's "not delivered" indicator is the manual backstop —
see the daily-review step below.

## Severity tiers + target time-to-acknowledge
- **Sev-1** (data loss, can't log a set, auth lockout): ack ≤ 1h, cross-ref `docs/runbooks/bug-triage.md`.
- **Sev-2** (feature broken, no data loss): ack ≤ 1 business day.
- **Sev-3** (cosmetic / idea): ack ≤ 1 week.

## Cadence
Review `GET /api/admin/feedback` (or `/admin/feedback` page) **daily** during Beta.
Mark each row triaged once routed to a fix/issue/won't-do.
Also scan for rows showing **"not delivered"** (NULL `webhook_delivered_at`) — those
never reached Discord (restart or exhausted retries). The DB row is intact, so just
triage them from the admin page directly; no signal is lost.

## Pull via API (engineer)
```bash
curl -s -H "X-Admin-Key: $ADMIN_API_KEY" https://repos.jpmtech.com/api/admin/feedback | jq '.items[] | {id, body, route, triaged_at}'
```

## G12 pre-cutover prod smoke (no staging — runs against prod in the cutover window)
1. Ensure `FEEDBACK_WEBHOOK_URL` is set in `/mnt/user/appdata/repos/.env` to the Discord webhook.
2. As a CF-Access-provisioned non-admin test user, open the app → Topbar "Send feedback" → submit "G12 prod smoke <timestamp>".
3. Confirm within 5s: a row appears via `GET /api/admin/feedback` (admin key), and the message arrives in the Discord channel.
4. Record the pass (timestamp + Discord message link) in PASSDOWN.
```

- [ ] **Step 3: Commit**

```bash
cd /Users/jasonmeyer.ict/Projects/RepOS && \
  git add docs/qa/beta-reachability.md docs/runbooks/beta-triage.md && \
  git commit -m "docs(w7): reachability W7 section + beta-triage runbook (G12)"
```

---

## Task 18: Full-suite verification sweep

**Files:** none (verification only)

- [ ] **Step 1: Apply migration + run the full api unit suite**

Run: `cd /Users/jasonmeyer.ict/Projects/RepOS/api && npm run migrate && npx tsc --noEmit && npm test`
Expected: tsc clean; all unit tests pass (prior count + the new feedback schema/webhook/bootstrap tests).

- [ ] **Step 2: Run the full api integration suite**

Run: `cd /Users/jasonmeyer.ict/Projects/RepOS/api && npm run test:integration`
Expected: all integration tests pass, including `feedback`, `admin-feedback`, and `contamination/feedback-contamination`.

- [ ] **Step 3: Run the full frontend validate gate**

Run: `cd /Users/jasonmeyer.ict/Projects/RepOS/frontend && npm run validate`
Expected: tsc + vitest + term-coverage + **page-reachability** + tz-sync all pass.

- [ ] **Step 4: Run the W7 Playwright smoke once more (clean)**

Run: `cd /Users/jasonmeyer.ict/Projects/RepOS/frontend && npx playwright test w7-feedback-smoke`
Expected: 1 passed.

- [ ] **Step 5: Final commit (if any verification-driven fixes were made)**

```bash
cd /Users/jasonmeyer.ict/Projects/RepOS && git add -A && git commit -m "chore(w7): verification sweep — tsc + unit + integration + validate + e2e green" || echo "nothing to commit"
```

---

## Wave-completion gate (after Task 18)

Per `docs/superpowers/goals/beta.md` Step 4 — do NOT merge until:
1. Every W7 acceptance bullet verified by running tests (not reading checkboxes).
2. Reviewer matrix dispatched (backend / frontend / security / QA + infra for the Docker/CI change) — apply every Critical + Important finding (`feedback_ship_clean`).
3. Re-run `tsc --noEmit` + tests on both sides.
4. Present "W7 Complete" summary → user approves merge.
5. Merge to `main`, push, delete branch.
6. Update `docs/superpowers/goals/beta.md`: flip W7 `[ ]`→`[x]`; mark **G12 `[~]`** — *engineering-satisfied (table-insert ≤5s + webhook-delivery + triage runbook all proven in test), prod pre-cutover smoke PENDING (W8 cutover window)*. Do **NOT** flip G12 `[x]` at merge: the binary gate's predicate requires the against-prod CF-Access run (Task 17 runbook), and this plan has no prod-redeploy step — so it cannot have happened at merge. G12 flips green only after that runbook smoke lands a real row + confirmed Discord delivery in the pre-cutover window. This mirrors how G3/G9 (same prod-window dependency) stay `[~]`/`[ ]`. Advance G2 (+2 routes) / G7 (reachability doc) rows, refresh **Next dispatch** to W8, bump **Last updated**.

## Spec coverage map

| Spec item | Task |
|---|---|
| `070_feedback.sql` table | 1 |
| zod request schema | 2 |
| Discord webhook (build + retry) | 3 |
| durable delivery state | 4 |
| `POST /api/feedback` | 5 |
| `is_admin` on `/api/me` | 6 |
| admin list + triage | 7 |
| G2 contamination | 8 |
| `FEEDBACK_WEBHOOK_URL` boot guard | 9 |
| `app_sha` via Docker/CI | 10 |
| frontend api client | 11 |
| Topbar trigger + shared form | 12, 13 |
| Settings → Feedback page | 14 |
| admin triage page | 15 |
| Playwright smoke | 16 |
| G7 reachability + G12 runbook | 17 |
| full verification | 18 |
