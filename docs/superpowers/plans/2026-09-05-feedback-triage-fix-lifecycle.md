# Feedback Triage — Plan 2 of 3: Ship Detection and the Fix Lifecycle

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Close the loop on a reported bug — detect when a fix has actually reached production, tell the people who reported it, and give the fix itself durable state so an interrupted attempt resumes from observed reality rather than from what a run remembered.

**Architecture:** Three concerns, deliberately kept apart. `checkShipped` answers "is this deployed?" by ancestry against the SHA read from the production container, never by merge state. `reconcileFixes` is the **sole writer** of every remote-derived `fix_status`, observing the public repository anonymously so a lost response costs nothing. The patch path crosses a privilege boundary as an inert diff carrying a broker-signed approval — `repos-git` holds only a public key and a GitHub token, and never touches a repository the agent can write.

**Tech Stack:** TypeScript (ESM — every relative import ends in `.js`), `pg` Pool via `src/db/client.js`, Node `crypto` Ed25519, `spawn` with argv arrays (never `bash -c`), GitHub REST over `fetch`, Vitest.

**Spec:** `docs/superpowers/specs/2026-08-10-feedback-triage-agent-design.md` (PR #86). Read it before starting; this plan argues from it.

**Baseline:** Plan 1 merged at `502e96d` (PR #87). **Read the merged code, not Plan 1's document** — five execution rulings changed it, and they are listed under Global Constraints below.

## Scope

| Plan | Covers | Status |
|---|---|---|
| 1 | Migration 094, lock, triage/defer, queues, mailer, ledger, delivery, alerts, operator CLI | **merged `502e96d`** |
| **2 (this one)** | `resolved` email path, `link`, `check-shipped`, `reconcile-fixes`, `approve-patch`, `submit-patch`, `open-pr` | ready |
| 3 | Broker daemon + socket, agent-facing client, the sweep skill, systemd timer, model proxy, the three OS accounts, deployment | not written |

**On process separation.** The spec puts these verbs behind two sockets under two OS principals. This plan builds them as **tested library functions plus operator CLI verbs**, exactly as Plan 1 did — the process boundary is Plan 3's job, and there is no agent yet for it to constrain. But the *code* is written so Plan 3 only has to wrap it: nothing in the `repos-git` modules (Tasks 6–7) may import the database or the mailer, and nothing in the broker modules may import the GitHub token. Those import boundaries are asserted by a test in Task 8, so the split is enforced before the processes exist.

## Global Constraints

Every task's requirements implicitly include these.

- **ESM:** all relative imports inside `api/src` end in `.js`.
- **Never `git add -A` or `git add .`.** `.gitignore` is permanently modified-and-uncommitted in this repo. Stage by explicit path.
- **Subprocesses are spawned with argv arrays, never `bash -c` or an interpolated shell string.** SSH, Docker, Git and mail are all named explicitly. This is the 2026-09-04 hardening and it is not negotiable.
- **Every git invocation in `repos-git` sets `core.hooksPath=/dev/null`, `GIT_CONFIG_NOSYSTEM=1` and `GIT_CONFIG_GLOBAL=/dev/null`**, and names its remote and transport explicitly. The workstation's git config carries `url.git@github.com:.insteadOf https://github.com/`, which silently rewrites HTTPS to SSH — and SSH to `github.com:22` times out on this machine. An unattended sweep would hang opaquely.
- **The branch name is derived, never accepted: `feedback/<id>`.** `repos-git` has no database, so the id is the only fact it has.
- **`reconcile-fixes` is the sole writer of `patch_submitted`, `pr_open` and `merged`.** `triage` writes `needed`/`n/a`; `defer` writes `deferred`. The two sets never overlap. `submit-patch` and `open-pr` write **nothing** to the database.
- **Both SHAs in an ancestry check must be full lowercase 40-hex.** If the deployed SHA cannot be read, the fetch fails, an object is missing, or either SHA is malformed, `check-shipped` **no-ops**. It never guesses.
- **The effective fix SHA is `COALESCE(own fix_commit_sha, canonical row's fix_commit_sha via dedupe_of)`.** Selecting on the row's own SHA would exclude every duplicate from the step meant to include them.
- **Delivery stays at-most-once**, and `resolved` reuses Plan 1's ledger unchanged: commit before send, frozen bytes replayed verbatim under the same key.
- **No submitter address and no secret may appear** in a branch name, commit message, PR title or body, or in the patch itself — including any test fixture it adds.
- Brand palette for email: accent `#4D8DFF`, good `#6BE28B`, surface `#10141C`, background `#0A0D12`. No `@font-face`.

### The five rulings that changed Plan 1 — the merged code is the truth

The Plan 1 *document* still shows the pre-ruling version in these places. Trust the code.

| # | What the merged code does |
|---|---|
| 1 | `assertFeedbackRequest` validates `reply_to` against the `FEEDBACK_REPLY_TO` constant, not merely non-empty. Signature is unchanged: `(r, expectedTo, expectedFrom)`. |
| 2 | `replayPending` claims each row with a guarded UPDATE (`WHERE id=$1 AND sent_at IS NULL AND dead_lettered_at IS NULL`, checking `rowCount`) rather than an unguarded increment. |
| 3 | All alert calls fire **outside** `withFeedbackLock`. A 5s Discord POST inside a lock whose acquisition deadline is also 5s aborts a contending sweep. |
| 4 | `classifyFailure` returns `recipient` for **422 only**; every other 4xx is `retryable`. |
| 5 | `triage` preserves `fix_status` when it is already `patch_submitted`, `pr_open`, `merged` or `deferred`. **Any new terminal state this plan adds must join that list** — see Task 4. |

### Exact interfaces available from the merged baseline

Read these files; do not re-derive them.

`api/src/services/feedbackTriage.ts`
```ts
export type FeedbackCategory = 'bug' | 'ux' | 'feature' | 'question' | 'noise';
export type FeedbackSeverity = 'p1' | 'p2' | 'p3';
export type FixStatus = 'n/a' | 'needed' | 'patch_submitted' | 'pr_open' | 'merged' | 'deferred';
export const FIXABLE: readonly FeedbackCategory[];   // bug, ux, feature
export const TERMINAL: readonly FeedbackCategory[];  // question, noise
export class TriageError extends Error { readonly code: TriageErrorCode }
export interface TriageInput { id: string; category: FeedbackCategory; severity?: FeedbackSeverity | null; note: string; dedupeOf?: string | null }
export async function triage(input: TriageInput): Promise<void>;
export async function defer(id: string, reason: string): Promise<void>;
export interface QueueRow { id: string; body: string; route: string | null; created_at: Date;
  category: FeedbackCategory | null; severity: FeedbackSeverity | null;
  user_email_at_submit: string | null; fix_status: FixStatus; dedupe_of: string | null }
export async function listUntriaged(): Promise<QueueRow[]>;
export async function listPending(): Promise<QueueRow[]>;
export async function listFixPending(): Promise<QueueRow[]>;
export async function listDeadLettered(): Promise<Array<{ feedback_id: string; kind: string;
  error: string | null; dead_lettered_at: Date; user_email_at_submit: string | null }>>;
```

`api/src/services/feedbackEmails.ts`
```ts
export type SendableKind = 'ack' | 'reply';
export class EmailGateError extends Error { readonly code: EmailGateErrorCode }
export interface SendResult { status: 'sent' | 'already_sent' | 'failed'; messageId?: string; error?: string }
export const NO_RECIPIENT_NOTE: string;
export async function sendFeedbackEmail(input: { id: string; kind: SendableKind; bodyText: string }): Promise<SendResult>;
export const IDEMPOTENCY_WINDOW_MS: number;   // 86_400_000
export type FailureClass = 'retryable' | 'auth' | 'recipient';
export function classifyFailure(err: unknown): FailureClass;
export async function replayPending(opts?: { now?: Date }): Promise<{ sent: number; deadLettered: number; paused: boolean }>;
```

`api/src/services/feedbackMailer.ts`
```ts
export const FEEDBACK_REPLY_TO = 'jason@jpmtech.com';
export const APP_URL = 'https://repos.jpmtech.com';
export type EmailKind = 'ack' | 'resolved' | 'reply';   // note: 'resolved' already modelled
export class MailerError extends Error { readonly code: FeedbackMailerErrorCode; readonly status?: number }
export function __setMailFetchForTesting(f: typeof fetch | null): void;
export function idempotencyKeyFor(kind: EmailKind, feedbackId: string): string;   // fb-{kind}-{id}
export function escapeHtml(s: string): string;
export function fromAddress(): string;
export interface FeedbackRequest { from: string; to: string[]; reply_to: string; subject: string; html: string; text: string }
export interface CopyInput { kind: EmailKind; toEmail: string; feedbackId: string; bodyText: string }
export function buildFeedbackRequest(input: CopyInput): FeedbackRequest;
export function serializeFeedbackRequest(r: FeedbackRequest): string;
export function assertFeedbackRequest(r: unknown, expectedTo: string, expectedFrom: string): asserts r is FeedbackRequest;
export function parseFeedbackRequest(stored: string, expectedTo: string, expectedFrom: string): FeedbackRequest;
export async function sendFeedbackRequest(request: FeedbackRequest, idempotencyKey: string, expectedTo: string, opts?: { timeoutMs?: number }): Promise<{ messageId: string }>;
```
`SUBJECTS.resolved` is already `'RepOS — the thing you reported is fixed'`.

`api/src/services/feedbackLock.ts`
```ts
export { LockTimeoutError };
export const FEEDBACK_LOCK_CLASS = 0x46424b31;
export async function withFeedbackLock<T>(feedbackId: string | number, fn: () => Promise<T>, opts?: { timeoutMs?: number }): Promise<T>;
export async function withFeedbackPairLock<T>(a: string | number, b: string | number, fn: () => Promise<T>, opts?: { timeoutMs?: number }): Promise<T>;
```

`api/src/services/feedbackAlerts.ts`
```ts
export function __setAlertFetchForTesting(f: typeof fetch | null): void;
export function assertAlertingConfigured(): void;
export async function alertDeadLetter(input: { feedbackId: string; kind: string; recipient: string; error: string | null }): Promise<void>;
export async function alertSendingPaused(input: { reason: string }): Promise<void>;
```

`api/src/utils/childProcess.ts`
```ts
export function waitForSuccessfulExit(child: ChildProcess, label: string): Promise<void>;
export async function pipeChildProcesses(producer, producerLabel, consumer, consumerLabel, opts?: { allowEarlyConsumerExit?: boolean }): Promise<void>;
```

Migration 094 already provides every column this plan writes: `fix_commit_sha`, `fix_status`, `fix_base_sha`, `fix_patch_digest`, `fix_branch`, `fix_pr_number`. **No new migration is needed.**

## Test environment facts

- `createEphemeralDb(tag)` from `api/tests/helpers/ephemeral-db.ts` returns `{ url, name, drop }` — there is **no** `cleanup` property.
- Tests that touch the database set `process.env.DATABASE_URL` and then use top-level `await import(...)`, because `src/db/client.js` opens its pool at import time.
- `feedback.id` is `BIGSERIAL` → `pg` returns it as a **string**.
- `api/.env` holds only `DATABASE_URL` and `PORT`. No `RESEND_API_KEY`, no `FEEDBACK_WEBHOOK_URL`, no GitHub token. Tests set what they need and must clean up after themselves.
- Under vitest `NODE_ENV === 'test'`, so `validateFeedbackWebhookUrl` also accepts loopback HTTP.
- `replayPending` calls `assertAlertingConfigured()`, so any suite that invokes it must set a Discord-shaped `FEEDBACK_WEBHOOK_URL` and stub the alert fetch.
- Node 20+: `fetch`, `Response`, `AbortController`, and `crypto.generateKeyPairSync('ed25519')` are all available with no polyfill.

---

### Task 1: The `resolved` email path

**Files:**
- Modify: `api/src/services/feedbackEmails.ts`
- Create: `api/tests/services/feedback-resolved.test.ts`

**Interfaces:**
- Consumes: the merged `feedbackEmails.ts` internals.
- Produces:
  - `sendResolvedEmail(input: { id: string; bodyText: string }): Promise<SendResult>`

**Why this is a refactor first.** Plan 1 made `'resolved'` unreachable on purpose: `SendableKind = 'ack' | 'reply'` and a runtime gate. That was right — there must be no general-purpose resolved command. But `check-shipped` needs the same ledger machinery (commit-before-send, frozen bytes, the unique constraint), and duplicating it would mean two copies of the guarantee that only one of them is tested. So extract the shared core, then add a **second narrow entry point** that only `check-shipped` calls.

The gate that keeps the guarantee: `sendResolvedEmail` requires the category to be in `FIXABLE` and refuses if a `reply` row exists. It does **not** require the `ack` to have been sent — a dead-lettered `ack` must still permit a later `resolved`, per the spec's failure table.

- [ ] **Step 1: Write the failing test**

Create `api/tests/services/feedback-resolved.test.ts`:

```ts
import 'dotenv/config';
import { describe, it, expect, beforeEach, afterAll, vi } from 'vitest';
import pg from 'pg';
import { createEphemeralDb } from '../helpers/ephemeral-db.js';
import { runMigrations } from '../../src/db/runMigrations.js';

const eph = await createEphemeralDb('fb-resolved');
{
  const bootstrap = new pg.Pool({ connectionString: eph.url, max: 4 });
  await runMigrations(bootstrap);
  await bootstrap.end();
}
process.env.DATABASE_URL = eph.url;
process.env.FEEDBACK_FROM_EMAIL = 'feedback@send.jpmtech.com';
process.env.RESEND_API_KEY = 'test-key';

const { db } = await import('../../src/db/client.js');
const { triage } = await import('../../src/services/feedbackTriage.js');
const mailer = await import('../../src/services/feedbackMailer.js');
const { sendFeedbackEmail, sendResolvedEmail } = await import('../../src/services/feedbackEmails.js');

afterAll(async () => {
  await db.end();
  await eph.drop();
});

const ok = (id = 'msg-r') =>
  vi.fn(async () => new Response(JSON.stringify({ id }), { status: 200 }));

async function mkClassified(category: 'bug' | 'noise'): Promise<string> {
  const { rows } = await db.query<{ id: string }>(
    `INSERT INTO feedback (body, user_email_at_submit) VALUES ('x','sub@example.test') RETURNING id`,
  );
  const id = rows[0].id;
  await triage(
    category === 'bug'
      ? { id, category: 'bug', severity: 'p2', note: 'real' }
      : { id, category: 'noise', note: 'junk' },
  );
  return id;
}

async function ledger(id: string) {
  const { rows } = await db.query(
    `SELECT kind, sent_at, message_id, dead_lettered_at FROM feedback_emails
      WHERE feedback_id=$1 ORDER BY kind`,
    [id],
  );
  return rows;
}

beforeEach(async () => {
  await db.query('DELETE FROM feedback_emails');
  await db.query('DELETE FROM feedback');
  mailer.__setMailFetchForTesting(null);
});

describe('sendResolvedEmail', () => {
  it('sends a resolved notice for a fixable row', async () => {
    mailer.__setMailFetchForTesting(ok());
    const id = await mkClassified('bug');
    const res = await sendResolvedEmail({ id, bodyText: 'shipped it' });
    expect(res.status).toBe('sent');
    const rows = await ledger(id);
    expect(rows.map((r) => r.kind)).toEqual(['resolved']);
    expect(rows[0].message_id).toBe('msg-r');
  });

  it('coexists with an ack — both rows, one each', async () => {
    mailer.__setMailFetchForTesting(ok());
    const id = await mkClassified('bug');
    await sendFeedbackEmail({ id, kind: 'ack', bodyText: 'got it' });
    await sendResolvedEmail({ id, bodyText: 'shipped it' });
    expect((await ledger(id)).map((r) => r.kind)).toEqual(['ack', 'resolved']);
  });

  it('sends even when the ack was dead-lettered', async () => {
    // Per the spec's failure table: dead-lettering one email does not abandon
    // the item. The person still deserves to hear their bug was fixed.
    const id = await mkClassified('bug');
    await db.query(
      `INSERT INTO feedback_emails (feedback_id, kind, request, idempotency_key, dead_lettered_at, attempts, first_attempt_at)
       VALUES ($1,'ack','{}',$2, now(), 1, now())`,
      [id, `fb-ack-${id}`],
    );
    mailer.__setMailFetchForTesting(ok());
    const res = await sendResolvedEmail({ id, bodyText: 'shipped it' });
    expect(res.status).toBe('sent');
  });

  it('refuses a terminal category', async () => {
    const id = await mkClassified('noise');
    await expect(sendResolvedEmail({ id, bodyText: 'x' })).rejects.toMatchObject({
      code: 'kind_not_allowed_for_category',
    });
    expect(await ledger(id)).toHaveLength(0);
  });

  it('refuses when a reply already exists', async () => {
    mailer.__setMailFetchForTesting(ok());
    const id = await mkClassified('noise');
    await sendFeedbackEmail({ id, kind: 'reply', bodyText: 'snark' });
    // Reclassify so the category gate alone would now permit resolved.
    await triage({ id, category: 'bug', severity: 'p3', note: 'actually real' });
    await expect(sendResolvedEmail({ id, bodyText: 'x' })).rejects.toMatchObject({
      code: 'exclusive_kind_present',
    });
  });

  it('is at-most-once: a second call is already_sent and does not re-send', async () => {
    const fetchMock = ok();
    mailer.__setMailFetchForTesting(fetchMock);
    const id = await mkClassified('bug');
    await sendResolvedEmail({ id, bodyText: 'shipped' });
    const again = await sendResolvedEmail({ id, bodyText: 'different prose' });
    expect(again.status).toBe('already_sent');
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('refuses a row with no submitter address and writes no ledger row', async () => {
    const { rows } = await db.query<{ id: string }>(
      `INSERT INTO feedback (body, user_email_at_submit) VALUES ('x',NULL) RETURNING id`,
    );
    await triage({ id: rows[0].id, category: 'bug', severity: 'p2', note: 'x' });
    await expect(sendResolvedEmail({ id: rows[0].id, bodyText: 'x' })).rejects.toMatchObject({
      code: 'no_recipient',
    });
    expect(await ledger(rows[0].id)).toHaveLength(0);
  });
});

describe('the refactor preserves sendFeedbackEmail', () => {
  it('still refuses resolved through the public entry point', async () => {
    const id = await mkClassified('bug');
    await expect(
      // @ts-expect-error 'resolved' is deliberately outside SendableKind
      sendFeedbackEmail({ id, kind: 'resolved', bodyText: 'x' }),
    ).rejects.toMatchObject({ code: 'kind_not_allowed_for_category' });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/services/feedback-resolved.test.ts`
Expected: FAIL — `sendResolvedEmail is not a function`.

- [ ] **Step 3: Extract the ledger core**

In `api/src/services/feedbackEmails.ts`, move everything in `sendFeedbackEmail` from `const key = idempotencyKeyFor(...)` to the end of the closure into a new module-private function. It assumes the gates have passed and **the lock is already held**:

```ts
/**
 * The ledger half of a send: freeze, commit, then attempt. Shared by
 * sendFeedbackEmail and sendResolvedEmail so the commit-before-send ordering
 * and the frozen-bytes replay exist in exactly one tested place.
 *
 * Callers MUST already hold this row's feedback lock and MUST have run their
 * own gates — this function enforces neither.
 */
async function runLedgeredSend(input: {
  id: string;
  kind: EmailKind;
  to: string;
  bodyText: string;
}): Promise<SendResult> {
  const key = idempotencyKeyFor(input.kind, input.id);
  const from = fromAddress();

  const { rows: existing } = await db.query<{
    id: string;
    request: string;
    sent_at: Date | null;
    dead_lettered_at: Date | null;
  }>(
    `SELECT id, request, sent_at, dead_lettered_at
       FROM feedback_emails WHERE feedback_id=$1 AND kind=$2`,
    [input.id, input.kind],
  );

  let rowId: string;
  let requestJson: string;

  if (existing.length > 0) {
    if (existing[0].sent_at !== null) return { status: 'already_sent' };
    if (existing[0].dead_lettered_at !== null) {
      return { status: 'failed', error: 'dead-lettered; not retried' };
    }
    rowId = existing[0].id;
    requestJson = existing[0].request;
  } else {
    const request = buildFeedbackRequest({
      kind: input.kind,
      toEmail: input.to,
      feedbackId: input.id,
      bodyText: input.bodyText,
    });
    requestJson = serializeFeedbackRequest(request);
    const { rows: inserted } = await db.query<{ id: string }>(
      `INSERT INTO feedback_emails (feedback_id, kind, request, idempotency_key)
       VALUES ($1,$2,$3,$4) RETURNING id`,
      [input.id, input.kind, requestJson, key],
    );
    rowId = inserted[0].id;
  }

  // `db` is a Pool and each query auto-commits, so the row above is durable
  // before the call below. Nothing here opens a transaction on purpose.
  await db.query(
    `UPDATE feedback_emails
        SET attempts = attempts + 1,
            first_attempt_at = COALESCE(first_attempt_at, now()),
            last_attempt_at = now()
      WHERE id = $1`,
    [rowId],
  );

  try {
    const request = parseFeedbackRequest(requestJson, input.to, from);
    const { messageId } = await sendFeedbackRequest(request, key, input.to);
    await db.query(
      `UPDATE feedback_emails SET sent_at=now(), message_id=$2, error=NULL WHERE id=$1`,
      [rowId, messageId],
    );
    return { status: 'sent', messageId };
  } catch (err) {
    const detail =
      err instanceof MailerError
        ? `${err.code}: ${err.message}${err.detail ? ` — ${err.detail}` : ''}`
        : String(err);
    await db.query(`UPDATE feedback_emails SET error=$2 WHERE id=$1`, [
      rowId,
      detail.slice(0, 500),
    ]);
    return { status: 'failed', error: detail };
  }
}
```

Then `sendFeedbackEmail` keeps its gates and ends with:

```ts
    return runLedgeredSend({ id: input.id, kind: input.kind, to, bodyText: input.bodyText });
```

Add `EmailKind` to the existing `./feedbackMailer.js` type import.

- [ ] **Step 4: Add the resolved entry point**

Append to `api/src/services/feedbackEmails.ts`:

```ts
/**
 * The ONLY path that creates a `resolved` email. Deliberately not reachable
 * through `sendFeedbackEmail` — `SendableKind` excludes it — because there
 * must be no general-purpose "tell them it's fixed" command an agent could
 * call on a hunch. Ship detection calls this after an ancestry check.
 *
 * It does NOT require the `ack` to have been delivered: a dead-lettered ack
 * still permits a resolved notice, because dead-lettering one email does not
 * abandon the item.
 */
export async function sendResolvedEmail(input: {
  id: string;
  bodyText: string;
}): Promise<SendResult> {
  return withFeedbackLock(input.id, async () => {
    const { rows } = await db.query<{
      category: FeedbackCategory | null;
      user_email_at_submit: string | null;
    }>(`SELECT category, user_email_at_submit FROM feedback WHERE id=$1`, [input.id]);
    if (rows.length === 0) {
      throw new EmailGateError('not_found', `feedback ${input.id} not found`);
    }
    const { category, user_email_at_submit: to } = rows[0];
    if (category === null) {
      throw new EmailGateError('not_classified', 'classify the row before emailing');
    }
    if (!FIXABLE.includes(category)) {
      throw new EmailGateError(
        'kind_not_allowed_for_category',
        `kind 'resolved' is not permitted for category '${category}'`,
      );
    }
    if (!to) {
      await appendSkipReason(input.id);
      throw new EmailGateError('no_recipient', 'row has no submitter address');
    }

    // `resolved` is exclusive with `reply`, exactly as `ack` is.
    const { rows: conflicting } = await db.query<{ kind: string }>(
      `SELECT kind FROM feedback_emails WHERE feedback_id=$1 AND kind='reply'`,
      [input.id],
    );
    if (conflicting.length > 0) {
      throw new EmailGateError(
        'exclusive_kind_present',
        `a 'reply' email already exists for this row`,
      );
    }

    return runLedgeredSend({ id: input.id, kind: 'resolved', to, bodyText: input.bodyText });
  });
}
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `cd /var/home/jason/Projects/RepOS/api && npx vitest run tests/services/feedback-resolved.test.ts tests/services/feedback-emails.test.ts tests/services/feedback-delivery.test.ts`
Expected: PASS — the new suite plus both Plan 1 suites unchanged. **The refactor must not alter a single Plan 1 assertion.** If one fails, the extraction changed behaviour; fix the extraction, never the Plan 1 test.

- [ ] **Step 6: Mutation-check the exclusivity gate**

Temporarily delete the `reply` conflict check from `sendResolvedEmail`.

Run: `npx vitest run tests/services/feedback-resolved.test.ts`
Expected: FAIL — "refuses when a reply already exists".

Revert and re-run. Expected: PASS.

- [ ] **Step 7: Commit**

```bash
cd /var/home/jason/Projects/RepOS
git add api/src/services/feedbackEmails.ts api/tests/services/feedback-resolved.test.ts
git commit -m "feat(feedback): the resolved email path, sharing the ledger core"
```

---

### Task 2: Effective fix SHA and `link`

**Files:**
- Create: `api/src/services/fixLifecycle.ts`
- Create: `api/tests/services/feedback-fix-lifecycle.test.ts`

**Interfaces:**
- Consumes: `withFeedbackLock`, `db`, `FixStatus`.
- Produces:
  - `const SHA_RE = /^[0-9a-f]{40}$/`
  - `class FixLifecycleError extends Error { readonly code: FixLifecycleErrorCode }`
  - `link(id: string, sha: string): Promise<void>`
  - `interface ResolvableRow { id: string; effective_fix_sha: string; user_email_at_submit: string; body: string; dedupe_of: string | null }`
  - `listResolvable(): Promise<ResolvableRow[]>`

**Why the effective SHA is a query, not a field.** A duplicate never carries its own `fix_commit_sha` — its canonical row owns the fix. Selecting on the row's own column would exclude every duplicate from the exact step meant to include them, so their submitters would be acked and then never told.

- [ ] **Step 1: Write the failing test**

Create `api/tests/services/feedback-fix-lifecycle.test.ts`:

```ts
import 'dotenv/config';
import { describe, it, expect, beforeEach, afterAll } from 'vitest';
import pg from 'pg';
import { createEphemeralDb } from '../helpers/ephemeral-db.js';
import { runMigrations } from '../../src/db/runMigrations.js';

const eph = await createEphemeralDb('fb-fixlife');
{
  const bootstrap = new pg.Pool({ connectionString: eph.url, max: 4 });
  await runMigrations(bootstrap);
  await bootstrap.end();
}
process.env.DATABASE_URL = eph.url;

const { db } = await import('../../src/db/client.js');
const { triage, defer } = await import('../../src/services/feedbackTriage.js');
const { link, listResolvable } = await import('../../src/services/fixLifecycle.js');

afterAll(async () => {
  await db.end();
  await eph.drop();
});

const SHA_A = 'a'.repeat(40);
const SHA_B = 'b'.repeat(40);

async function mkBug(email: string | null = 'sub@example.test'): Promise<string> {
  const { rows } = await db.query<{ id: string }>(
    `INSERT INTO feedback (body, user_email_at_submit) VALUES ('it broke',$1) RETURNING id`,
    [email],
  );
  await triage({ id: rows[0].id, category: 'bug', severity: 'p2', note: 'real' });
  return rows[0].id;
}

async function row(id: string) {
  const { rows } = await db.query(`SELECT * FROM feedback WHERE id=$1`, [id]);
  return rows[0];
}

beforeEach(async () => {
  await db.query('DELETE FROM feedback_emails');
  await db.query('DELETE FROM feedback');
});

describe('link', () => {
  it('records the SHA and moves the row to merged', async () => {
    const id = await mkBug();
    await link(id, SHA_A);
    const r = await row(id);
    expect(r.fix_commit_sha).toBe(SHA_A);
    expect(r.fix_status).toBe('merged');
  });

  it('is idempotent for the same SHA', async () => {
    const id = await mkBug();
    await link(id, SHA_A);
    await link(id, SHA_A);
    expect((await row(id)).fix_commit_sha).toBe(SHA_A);
  });

  it('refuses to overwrite a different recorded SHA', async () => {
    // Silently replacing it would change which commit the ancestry check runs
    // against, and could tell someone their bug shipped when a different
    // commit did.
    const id = await mkBug();
    await link(id, SHA_A);
    await expect(link(id, SHA_B)).rejects.toMatchObject({ code: 'sha_conflict' });
  });

  it('rejects a malformed SHA', async () => {
    const id = await mkBug();
    for (const bad of ['NOTASHA', 'A'.repeat(40), 'abc', `${SHA_A}0`]) {
      await expect(link(id, bad)).rejects.toMatchObject({ code: 'bad_sha' });
    }
    expect((await row(id)).fix_commit_sha).toBeNull();
  });

  it('refuses a duplicate — its canonical row owns the fix', async () => {
    const canonical = await mkBug();
    const dup = await mkBug();
    await triage({ id: dup, category: 'bug', severity: 'p2', note: 'dup', dedupeOf: canonical });
    await expect(link(dup, SHA_A)).rejects.toMatchObject({ code: 'not_canonical' });
  });

  it('refuses a deferred row', async () => {
    const id = await mkBug();
    await defer(id, 'not doing it');
    await expect(link(id, SHA_A)).rejects.toMatchObject({ code: 'terminal_state' });
  });

  it('404s on an unknown id', async () => {
    await expect(link('999999', SHA_A)).rejects.toMatchObject({ code: 'not_found' });
  });
});

describe('listResolvable', () => {
  it('returns a merged canonical row with an address', async () => {
    const id = await mkBug();
    await link(id, SHA_A);
    const rows = await listResolvable();
    expect(rows.map((r) => r.id)).toEqual([id]);
    expect(rows[0].effective_fix_sha).toBe(SHA_A);
  });

  it('returns a duplicate using its canonical row SHA', async () => {
    // The whole point: the duplicate carries no fix_commit_sha of its own.
    const canonical = await mkBug();
    const dup = await mkBug('dup@example.test');
    await triage({ id: dup, category: 'bug', severity: 'p2', note: 'dup', dedupeOf: canonical });
    await link(canonical, SHA_A);

    const rows = await listResolvable();
    const byId = new Map(rows.map((r) => [r.id, r]));
    expect(byId.get(dup)!.effective_fix_sha).toBe(SHA_A);
    expect(byId.get(dup)!.user_email_at_submit).toBe('dup@example.test');
    expect((await row(dup)).fix_commit_sha).toBeNull();
  });

  it('excludes a row that already has a resolved email', async () => {
    const id = await mkBug();
    await link(id, SHA_A);
    await db.query(
      `INSERT INTO feedback_emails (feedback_id, kind, request, idempotency_key)
       VALUES ($1,'resolved','{}',$2)`,
      [id, `fb-resolved-${id}`],
    );
    expect(await listResolvable()).toHaveLength(0);
  });

  it('excludes a row whose submitter got a terminal reply', async () => {
    const id = await mkBug();
    await link(id, SHA_A);
    await db.query(
      `INSERT INTO feedback_emails (feedback_id, kind, request, idempotency_key)
       VALUES ($1,'reply','{}',$2)`,
      [id, `fb-reply-${id}`],
    );
    expect(await listResolvable()).toHaveLength(0);
  });

  it('excludes rows with no SHA anywhere, no address, and deferred canonicals', async () => {
    await mkBug(); // no SHA
    const noAddr = await mkBug(null);
    await link(noAddr, SHA_A);

    const deferredCanonical = await mkBug();
    const dupOfDeferred = await mkBug('x@example.test');
    await triage({
      id: dupOfDeferred, category: 'bug', severity: 'p2', note: 'dup', dedupeOf: deferredCanonical,
    });
    await defer(deferredCanonical, 'wontfix');

    // A deferred canonical has no fix_commit_sha, so neither it nor its
    // duplicate resolves to an effective SHA. Nobody is told a fix shipped.
    expect(await listResolvable()).toHaveLength(0);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd /var/home/jason/Projects/RepOS/api && npx vitest run tests/services/feedback-fix-lifecycle.test.ts`
Expected: FAIL — cannot resolve `../../src/services/fixLifecycle.js`.

- [ ] **Step 3: Write the implementation**

Create `api/src/services/fixLifecycle.ts`:

```ts
// Feedback triage — the durable state of a fix.
//
// `link` is the manual path, for when a human merges something the agent did
// not push. `reconcile-fixes` (Task 4) is the observed path and owns every
// other transition into a remote-derived state.
import { db } from '../db/client.js';
import { withFeedbackLock } from './feedbackLock.js';

/** Full lowercase 40-hex. Anything else is refused rather than normalised. */
export const SHA_RE = /^[0-9a-f]{40}$/;

export type FixLifecycleErrorCode =
  | 'not_found'
  | 'bad_sha'
  | 'sha_conflict'
  | 'not_canonical'
  | 'terminal_state';

export class FixLifecycleError extends Error {
  readonly code: FixLifecycleErrorCode;
  constructor(code: FixLifecycleErrorCode, message: string) {
    super(message);
    this.name = 'FixLifecycleError';
    this.code = code;
  }
}

/**
 * Record a merged commit by hand.
 *
 * Refuses to overwrite a different SHA: silently replacing it would change
 * which commit the ancestry check runs against, and could tell somebody their
 * bug shipped when a different commit did.
 */
export async function link(id: string, sha: string): Promise<void> {
  if (!SHA_RE.test(sha)) {
    throw new FixLifecycleError('bad_sha', `not a full lowercase 40-hex SHA: ${sha}`);
  }
  return withFeedbackLock(id, async () => {
    const { rows } = await db.query<{
      fix_commit_sha: string | null;
      fix_status: string;
      dedupe_of: string | null;
    }>(`SELECT fix_commit_sha, fix_status, dedupe_of FROM feedback WHERE id=$1`, [id]);
    if (rows.length === 0) throw new FixLifecycleError('not_found', `feedback ${id} not found`);
    const r = rows[0];
    if (r.dedupe_of !== null) {
      throw new FixLifecycleError(
        'not_canonical',
        'a duplicate does not own a fix; link its canonical row instead',
      );
    }
    if (r.fix_status === 'deferred') {
      throw new FixLifecycleError('terminal_state', 'the row is deferred; no fix is planned');
    }
    if (r.fix_commit_sha !== null && r.fix_commit_sha !== sha) {
      throw new FixLifecycleError(
        'sha_conflict',
        `row already links ${r.fix_commit_sha}; refusing to overwrite with ${sha}`,
      );
    }
    await db.query(`UPDATE feedback SET fix_commit_sha=$2, fix_status='merged' WHERE id=$1`, [
      id,
      sha,
    ]);
  });
}

export interface ResolvableRow {
  id: string;
  effective_fix_sha: string;
  user_email_at_submit: string;
  body: string;
  dedupe_of: string | null;
}

/**
 * Rows that would receive a `resolved` email IF their fix turns out to be
 * deployed. The ancestry check is check-shipped's job; this is only selection.
 *
 * The effective fix SHA is COALESCE(own, canonical-via-dedupe_of). A duplicate
 * never carries its own, so selecting on the row's own column would exclude
 * every duplicate from the step meant to include them — their submitters would
 * be acked and then never told.
 */
export async function listResolvable(): Promise<ResolvableRow[]> {
  const { rows } = await db.query<ResolvableRow>(
    `SELECT f.id,
            COALESCE(f.fix_commit_sha, c.fix_commit_sha) AS effective_fix_sha,
            f.user_email_at_submit,
            f.body,
            f.dedupe_of
       FROM feedback f
       LEFT JOIN feedback c ON c.id = f.dedupe_of
      WHERE COALESCE(f.fix_commit_sha, c.fix_commit_sha) IS NOT NULL
        AND f.user_email_at_submit IS NOT NULL
        AND NOT EXISTS (
          SELECT 1 FROM feedback_emails e
           WHERE e.feedback_id = f.id AND e.kind IN ('resolved','reply')
        )
      ORDER BY f.created_at, f.id`,
  );
  return rows;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd /var/home/jason/Projects/RepOS/api && npx vitest run tests/services/feedback-fix-lifecycle.test.ts`
Expected: PASS — 13 tests.

- [ ] **Step 5: Mutation-check the effective-SHA resolution**

In `listResolvable`, temporarily replace both `COALESCE(f.fix_commit_sha, c.fix_commit_sha)` occurrences with `f.fix_commit_sha`.

Run: `npx vitest run tests/services/feedback-fix-lifecycle.test.ts`
Expected: FAIL — "returns a duplicate using its canonical row SHA".

Revert and re-run. Expected: PASS. This is the test that stops every duplicate's submitter being silently dropped.

- [ ] **Step 6: Commit**

```bash
cd /var/home/jason/Projects/RepOS
git add api/src/services/fixLifecycle.ts api/tests/services/feedback-fix-lifecycle.test.ts
git commit -m "feat(feedback): link and effective-fix-SHA resolution"
```

---

### Task 3: Reading the deployed SHA

**Files:**
- Create: `api/src/services/deployedRev.ts`
- Create: `api/tests/services/deployed-rev.test.ts`

**Interfaces:**
- Consumes: `waitForSuccessfulExit` from `../utils/childProcess.js`.
- Produces:
  - `class DeployedRevError extends Error { readonly code: 'unreadable' | 'malformed' | 'not_configured' }`
  - `function __setDeployedRevRunnerForTesting(r: ((argv: string[]) => Promise<string>) | null): void`
  - `readDeployedRev(): Promise<string>` — full lowercase 40-hex

**Why this is its own module.** Ship detection has two independent failure surfaces — reading the deployed SHA over SSH, and the ancestry check against a local clone. Separating them means the ancestry logic (Task 4's `check-shipped`) can be tested exhaustively with a real temporary git repository and zero network, while this module's SSH argv is asserted precisely. Split, both are testable; merged, neither is.

The SHA comes from the running container's `APP_SHA`, which the Dockerfile bakes at build time and which `src/routes/feedback.ts:42` already reads. Asking the container is asking production what it is actually running — a registry tag or a compose file would only say what was *intended*.

- [ ] **Step 1: Write the failing test**

Create `api/tests/services/deployed-rev.test.ts`:

```ts
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
  readDeployedRev,
  __setDeployedRevRunnerForTesting,
} from '../../src/services/deployedRev.js';

const SHA = 'c'.repeat(40);
const saved = { host: process.env.UNRAID_SSH_HOST, user: process.env.UNRAID_SSH_USER };

beforeEach(() => {
  process.env.UNRAID_SSH_HOST = '192.168.88.2';
  process.env.UNRAID_SSH_USER = 'root';
});

afterEach(() => {
  __setDeployedRevRunnerForTesting(null);
  if (saved.host === undefined) delete process.env.UNRAID_SSH_HOST;
  else process.env.UNRAID_SSH_HOST = saved.host;
  if (saved.user === undefined) delete process.env.UNRAID_SSH_USER;
  else process.env.UNRAID_SSH_USER = saved.user;
});

describe('readDeployedRev', () => {
  it('returns the trimmed SHA the container reports', async () => {
    __setDeployedRevRunnerForTesting(async () => `${SHA}\n`);
    expect(await readDeployedRev()).toBe(SHA);
  });

  it('builds an argv array with no shell metacharacter surface', async () => {
    let seen: string[] = [];
    __setDeployedRevRunnerForTesting(async (argv) => {
      seen = argv;
      return SHA;
    });
    await readDeployedRev();

    expect(seen[0]).toBe('ssh');
    // Every argument is a separate array element: nothing is ever concatenated
    // into a string an interpreter could re-split.
    expect(seen).toContain('root@192.168.88.2');
    expect(seen).toContain('BatchMode=yes');
    expect(seen).toContain('docker');
    expect(seen).toContain('RepOS');
    expect(seen.some((a) => a.includes('APP_SHA'))).toBe(true);
    for (const arg of seen) expect(arg).not.toMatch(/[;&|`$(){}<>]/);
  });

  it('rejects a malformed SHA rather than returning it', async () => {
    for (const bad of ['', 'unknown', 'C'.repeat(40), 'abc123', `${SHA} ${SHA}`]) {
      __setDeployedRevRunnerForTesting(async () => bad);
      await expect(readDeployedRev()).rejects.toMatchObject({ code: 'malformed' });
    }
  });

  it('surfaces an unreachable host as unreadable, never as a SHA', async () => {
    __setDeployedRevRunnerForTesting(async () => {
      throw new Error('ssh: connect to host 192.168.88.2 port 22: No route to host');
    });
    await expect(readDeployedRev()).rejects.toMatchObject({ code: 'unreadable' });
  });

  it('refuses when the host is not configured', async () => {
    delete process.env.UNRAID_SSH_HOST;
    __setDeployedRevRunnerForTesting(async () => SHA);
    await expect(readDeployedRev()).rejects.toMatchObject({ code: 'not_configured' });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/services/deployed-rev.test.ts`
Expected: FAIL — cannot resolve `deployedRev.js`.

- [ ] **Step 3: Write the implementation**

Create `api/src/services/deployedRev.ts`:

```ts
// What production is ACTUALLY running.
//
// The SHA is read from the live container's APP_SHA rather than from a
// registry tag or a compose file, because those record what was intended to
// be deployed. Ship detection must not tell somebody their bug is fixed
// because a deploy was requested.
import { spawn } from 'node:child_process';
import { waitForSuccessfulExit } from '../utils/childProcess.js';

const SHA_RE = /^[0-9a-f]{40}$/;
const TIMEOUT_MS = 15_000;
const CONTAINER = 'RepOS';

export type DeployedRevErrorCode = 'unreadable' | 'malformed' | 'not_configured';

export class DeployedRevError extends Error {
  readonly code: DeployedRevErrorCode;
  constructor(code: DeployedRevErrorCode, message: string) {
    super(message);
    this.name = 'DeployedRevError';
    this.code = code;
  }
}

type Runner = (argv: string[]) => Promise<string>;
let runnerOverride: Runner | null = null;

export function __setDeployedRevRunnerForTesting(r: Runner | null): void {
  runnerOverride = r;
}

const defaultRunner: Runner = async (argv) => {
  const child = spawn(argv[0], argv.slice(1), { stdio: ['ignore', 'pipe', 'pipe'] });
  const timer = setTimeout(() => child.kill('SIGKILL'), TIMEOUT_MS);
  let out = '';
  child.stdout.setEncoding('utf8');
  child.stdout.on('data', (c: string) => {
    out += c;
  });
  child.stderr.resume();
  try {
    await waitForSuccessfulExit(child, 'ssh docker inspect');
  } finally {
    clearTimeout(timer);
  }
  return out;
};

/**
 * The full lowercase 40-hex commit the production container was built from.
 *
 * Throws rather than returning a placeholder for every failure mode. A caller
 * that cannot read this must no-op; guessing is how somebody gets told their
 * bug shipped when it did not.
 */
export async function readDeployedRev(): Promise<string> {
  const host = process.env.UNRAID_SSH_HOST;
  const user = process.env.UNRAID_SSH_USER ?? 'root';
  if (!host) {
    throw new DeployedRevError('not_configured', 'UNRAID_SSH_HOST is not set');
  }

  // Fixed argv. Nothing here is built by string concatenation, and the remote
  // command is a literal docker invocation with no user-supplied component.
  const argv = [
    'ssh',
    '-o', 'BatchMode=yes',
    '-o', 'StrictHostKeyChecking=accept-new',
    '-o', `ConnectTimeout=10`,
    `${user}@${host}`,
    'docker',
    'inspect',
    '--format',
    '{{range .Config.Env}}{{println .}}{{end}}',
    CONTAINER,
  ];

  let raw: string;
  try {
    raw = await (runnerOverride ?? defaultRunner)(argv);
  } catch (err) {
    throw new DeployedRevError('unreadable', `could not read ${CONTAINER}'s env: ${String(err)}`);
  }

  const line = raw
    .split('\n')
    .map((l) => l.trim())
    .find((l) => l.startsWith('APP_SHA='));
  const value = (line ? line.slice('APP_SHA='.length) : raw).trim();

  if (!SHA_RE.test(value)) {
    throw new DeployedRevError(
      'malformed',
      `container reported ${JSON.stringify(value.slice(0, 64))}, not a 40-hex SHA`,
    );
  }
  return value;
}
```

Note the fallback: when the runner returns a bare SHA with no `APP_SHA=` prefix (the stubbed shape in tests, and the shape of a future simpler remote command), the raw output is validated directly. Either way the regex is the gate.

- [ ] **Step 4: Run test to verify it passes**

Run: `cd /var/home/jason/Projects/RepOS/api && npx vitest run tests/services/deployed-rev.test.ts`
Expected: PASS — 5 tests.

- [ ] **Step 5: Mutation-check the SHA validation**

Temporarily change `SHA_RE` to `/^[0-9a-fA-F]+$/`.

Run: `npx vitest run tests/services/deployed-rev.test.ts`
Expected: FAIL — "rejects a malformed SHA rather than returning it" (the uppercase case). Case-insensitive matching would make `merge-base` compare a SHA git will not resolve.

Revert and re-run. Expected: PASS.

- [ ] **Step 6: Commit**

```bash
cd /var/home/jason/Projects/RepOS
git add api/src/services/deployedRev.ts api/tests/services/deployed-rev.test.ts
git commit -m "feat(feedback): read the deployed SHA from the running container"
```

---

### Task 4: `check-shipped`

**Files:**
- Create: `api/src/services/checkShipped.ts`
- Create: `api/tests/services/feedback-check-shipped.test.ts`

**Interfaces:**
- Consumes: `readDeployedRev`, `listResolvable`, `sendResolvedEmail`, `SHA_RE`, `db`.
- Produces:
  - `function __setAncestryForTesting(f: ((a: string, d: string) => Promise<boolean>) | null): void`
  - `isAncestor(candidate: string, deployed: string, repoDir?: string): Promise<boolean>`
  - `interface CheckShippedResult { deployedSha: string | null; considered: number; shipped: number; emailed: number; skipped: number }`
  - `checkShipped(opts?: { dryRun?: boolean }): Promise<CheckShippedResult>`

**Why ancestry and not merge state.** A commit can be merged into `main` and not be deployed for days. `git merge-base --is-ancestor <fix> <deployed>` asks the only question that matters: is the fix contained in what is running? It is also monotone — once true it stays true — so a re-run cannot flip a decision back.

**Why an unknown object is a no-op, not `false`.** `--is-ancestor` exits non-zero both for "not an ancestor" and for "I do not have that object". Treating the second as a definite "not shipped" would be harmless today but would hide a broken clone forever. The implementation distinguishes them with `git cat-file -e` and refuses to answer when the object is missing.

- [ ] **Step 1: Write the failing test**

Create `api/tests/services/feedback-check-shipped.test.ts`:

```ts
import 'dotenv/config';
import { describe, it, expect, beforeEach, afterAll, vi } from 'vitest';
import pg from 'pg';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';
import { createEphemeralDb } from '../helpers/ephemeral-db.js';
import { runMigrations } from '../../src/db/runMigrations.js';

const eph = await createEphemeralDb('fb-shipped');
{
  const bootstrap = new pg.Pool({ connectionString: eph.url, max: 4 });
  await runMigrations(bootstrap);
  await bootstrap.end();
}
process.env.DATABASE_URL = eph.url;
process.env.FEEDBACK_FROM_EMAIL = 'feedback@send.jpmtech.com';
process.env.RESEND_API_KEY = 'test-key';

const { db } = await import('../../src/db/client.js');
const { triage } = await import('../../src/services/feedbackTriage.js');
const { link } = await import('../../src/services/fixLifecycle.js');
const mailer = await import('../../src/services/feedbackMailer.js');
const deployed = await import('../../src/services/deployedRev.js');
const { checkShipped, isAncestor, __setAncestryForTesting } = await import(
  '../../src/services/checkShipped.js'
);

// A real repository, because the ancestry rules are the thing under test and a
// stub would only assert that the stub was called.
const repo = await mkdtemp(join(tmpdir(), 'fb-shipped-repo-'));
const git = (...args: string[]) =>
  execFileSync('git', ['-C', repo, ...args], { encoding: 'utf8' }).trim();

git('init', '-q', '-b', 'main');
git('config', 'user.email', 'test@example.test');
git('config', 'user.name', 'Test');
git('commit', '-q', '--allow-empty', '-m', 'base');
const OLD = git('rev-parse', 'HEAD');
git('commit', '-q', '--allow-empty', '-m', 'the fix');
const FIX = git('rev-parse', 'HEAD');
git('commit', '-q', '--allow-empty', '-m', 'deployed');
const DEPLOYED = git('rev-parse', 'HEAD');
git('checkout', '-q', '-b', 'side', OLD);
git('commit', '-q', '--allow-empty', '-m', 'never merged');
const SIDE = git('rev-parse', 'HEAD');

afterAll(async () => {
  await db.end();
  await eph.drop();
  await rm(repo, { recursive: true, force: true });
});

const ok = () => vi.fn(async () => new Response(JSON.stringify({ id: 'm1' }), { status: 200 }));

async function mkFixed(sha: string, email: string | null = 'sub@example.test'): Promise<string> {
  const { rows } = await db.query<{ id: string }>(
    `INSERT INTO feedback (body, user_email_at_submit) VALUES ('broke',$1) RETURNING id`,
    [email],
  );
  await triage({ id: rows[0].id, category: 'bug', severity: 'p2', note: 'real' });
  await link(rows[0].id, sha);
  return rows[0].id;
}

beforeEach(async () => {
  await db.query('DELETE FROM feedback_emails');
  await db.query('DELETE FROM feedback');
  mailer.__setMailFetchForTesting(null);
  __setAncestryForTesting(null);
  deployed.__setDeployedRevRunnerForTesting(async () => DEPLOYED);
});

describe('isAncestor', () => {
  it('is true for an ancestor and false for a sibling', async () => {
    expect(await isAncestor(FIX, DEPLOYED, repo)).toBe(true);
    expect(await isAncestor(SIDE, DEPLOYED, repo)).toBe(false);
  });

  it('is true for the deployed commit itself', async () => {
    expect(await isAncestor(DEPLOYED, DEPLOYED, repo)).toBe(true);
  });

  it('is false for a descendant — direction matters', async () => {
    expect(await isAncestor(DEPLOYED, FIX, repo)).toBe(false);
  });

  it('throws on an unknown object rather than answering false', async () => {
    // Non-zero exit means BOTH "not an ancestor" and "no such object".
    // Collapsing them would hide a broken clone forever.
    await expect(isAncestor('0'.repeat(40), DEPLOYED, repo)).rejects.toThrow(/unknown object/i);
  });

  it('refuses a malformed SHA without invoking git', async () => {
    await expect(isAncestor('not-a-sha', DEPLOYED, repo)).rejects.toThrow(/40-hex/);
  });
});

describe('checkShipped', () => {
  it('emails the submitter when the fix is an ancestor of the deployed SHA', async () => {
    const fetchMock = ok();
    mailer.__setMailFetchForTesting(fetchMock);
    __setAncestryForTesting(async (a, d) => isAncestor(a, d, repo));
    const id = await mkFixed(FIX);

    const res = await checkShipped();
    expect(res).toMatchObject({ deployedSha: DEPLOYED, considered: 1, shipped: 1, emailed: 1 });

    const { rows } = await db.query(
      `SELECT kind, sent_at FROM feedback_emails WHERE feedback_id=$1`, [id],
    );
    expect(rows).toHaveLength(1);
    expect(rows[0].kind).toBe('resolved');
    expect(rows[0].sent_at).not.toBeNull();
  });

  it('does not email when the fix is not deployed', async () => {
    const fetchMock = ok();
    mailer.__setMailFetchForTesting(fetchMock);
    __setAncestryForTesting(async (a, d) => isAncestor(a, d, repo));
    await mkFixed(SIDE);

    const res = await checkShipped();
    expect(res).toMatchObject({ shipped: 0, emailed: 0 });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('emails a duplicate submitter using the canonical row SHA', async () => {
    mailer.__setMailFetchForTesting(ok());
    __setAncestryForTesting(async (a, d) => isAncestor(a, d, repo));
    const canonical = await mkFixed(FIX);
    const { rows } = await db.query<{ id: string }>(
      `INSERT INTO feedback (body, user_email_at_submit) VALUES ('same','dup@example.test') RETURNING id`,
    );
    await triage({
      id: rows[0].id, category: 'bug', severity: 'p2', note: 'dup', dedupeOf: canonical,
    });

    const res = await checkShipped();
    expect(res.emailed).toBe(2);
    const { rows: sent } = await db.query(
      `SELECT feedback_id FROM feedback_emails WHERE kind='resolved' ORDER BY feedback_id`,
    );
    expect(sent.map((r) => r.feedback_id).sort()).toEqual([canonical, rows[0].id].sort());
  });

  it('no-ops entirely when the deployed SHA is unreadable', async () => {
    const fetchMock = ok();
    mailer.__setMailFetchForTesting(fetchMock);
    __setAncestryForTesting(async () => true);
    await mkFixed(FIX);
    deployed.__setDeployedRevRunnerForTesting(async () => {
      throw new Error('No route to host');
    });

    const res = await checkShipped();
    expect(res).toMatchObject({ deployedSha: null, considered: 0, shipped: 0, emailed: 0 });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('skips a row whose object is unknown and still processes the rest', async () => {
    // One broken row must not abandon the sweep.
    mailer.__setMailFetchForTesting(ok());
    __setAncestryForTesting(async (a, d) => isAncestor(a, d, repo));
    await mkFixed('0'.repeat(40), 'ghost@example.test');
    const good = await mkFixed(FIX);

    const res = await checkShipped();
    expect(res.skipped).toBe(1);
    expect(res.emailed).toBe(1);
    const { rows } = await db.query(`SELECT feedback_id FROM feedback_emails WHERE kind='resolved'`);
    expect(rows.map((r) => r.feedback_id)).toEqual([good]);
  });

  it('dryRun reports what would be sent and sends nothing', async () => {
    const fetchMock = ok();
    mailer.__setMailFetchForTesting(fetchMock);
    __setAncestryForTesting(async (a, d) => isAncestor(a, d, repo));
    await mkFixed(FIX);

    const res = await checkShipped({ dryRun: true });
    expect(res).toMatchObject({ shipped: 1, emailed: 0 });
    expect(fetchMock).not.toHaveBeenCalled();
    const { rows } = await db.query(`SELECT 1 FROM feedback_emails`);
    expect(rows).toHaveLength(0);
  });

  it('is idempotent — a second run emails nobody twice', async () => {
    const fetchMock = ok();
    mailer.__setMailFetchForTesting(fetchMock);
    __setAncestryForTesting(async (a, d) => isAncestor(a, d, repo));
    await mkFixed(FIX);

    await checkShipped();
    const second = await checkShipped();
    expect(second.emailed).toBe(0);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('does not abort the sweep when one send fails', async () => {
    __setAncestryForTesting(async (a, d) => isAncestor(a, d, repo));
    await mkFixed(FIX, 'a@example.test');
    await mkFixed(FIX, 'b@example.test');
    let n = 0;
    mailer.__setMailFetchForTesting(
      vi.fn(async () => {
        n += 1;
        return n === 1
          ? new Response('nope', { status: 500 })
          : new Response(JSON.stringify({ id: 'm2' }), { status: 200 });
      }),
    );
    const res = await checkShipped();
    expect(res.emailed).toBe(1);
    expect(res.skipped).toBe(1);
  });
});

describe('re-triage cannot undo a shipped decision', () => {
  it('preserves merged across a re-triage', async () => {
    // Ruling 5 from Plan 1: `decided` fix_status values survive re-triage.
    const id = await mkFixed(FIX);
    await triage({ id, category: 'ux', severity: 'p3', note: 'reclassified' });
    const { rows } = await db.query(`SELECT fix_status FROM feedback WHERE id=$1`, [id]);
    expect(rows[0].fix_status).toBe('merged');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd /var/home/jason/Projects/RepOS/api && npx vitest run tests/services/feedback-check-shipped.test.ts`
Expected: FAIL — cannot resolve `checkShipped.js`.

- [ ] **Step 3: Write the implementation**

Create `api/src/services/checkShipped.ts`:

```ts
// Ship detection.
//
// The question is never "was it merged?" — a commit can sit in main for days
// without being deployed. It is "is the fix contained in what production is
// running?", answered by ancestry against the SHA the container reports.
// Ancestry is also monotone: once true it stays true, so a re-run cannot flip
// a decision back and un-tell somebody.
import { spawn } from 'node:child_process';
import { db } from '../db/client.js';
import { readDeployedRev } from './deployedRev.js';
import { listResolvable, SHA_RE } from './fixLifecycle.js';
import { sendResolvedEmail } from './feedbackEmails.js';

type Ancestry = (candidate: string, deployed: string) => Promise<boolean>;
let ancestryOverride: Ancestry | null = null;

export function __setAncestryForTesting(f: Ancestry | null): void {
  ancestryOverride = f;
}

function runGit(args: string[], cwd: string): Promise<number> {
  return new Promise((resolve, reject) => {
    const child = spawn('git', args, {
      cwd,
      stdio: 'ignore',
      env: {
        ...process.env,
        GIT_CONFIG_NOSYSTEM: '1',
        GIT_CONFIG_GLOBAL: '/dev/null',
        GIT_TERMINAL_PROMPT: '0',
      },
    });
    child.on('error', reject);
    child.on('close', (code) => resolve(code ?? 1));
  });
}

/**
 * Is `candidate` contained in `deployed`?
 *
 * `--is-ancestor` exits non-zero for BOTH "not an ancestor" and "I do not have
 * that object", so the object's existence is checked first. Collapsing the two
 * would report a definite "not shipped" for a broken clone, and hide it
 * forever.
 */
export async function isAncestor(
  candidate: string,
  deployed: string,
  repoDir: string = process.cwd(),
): Promise<boolean> {
  for (const sha of [candidate, deployed]) {
    if (!SHA_RE.test(sha)) throw new Error(`not a full lowercase 40-hex SHA: ${sha}`);
  }
  for (const sha of [candidate, deployed]) {
    if ((await runGit(['cat-file', '-e', `${sha}^{commit}`], repoDir)) !== 0) {
      throw new Error(`unknown object ${sha} in ${repoDir}`);
    }
  }
  return (await runGit(['merge-base', '--is-ancestor', candidate, deployed], repoDir)) === 0;
}

export interface CheckShippedResult {
  deployedSha: string | null;
  considered: number;
  shipped: number;
  emailed: number;
  skipped: number;
}

export async function checkShipped(
  opts: { dryRun?: boolean } = {},
): Promise<CheckShippedResult> {
  const result: CheckShippedResult = {
    deployedSha: null,
    considered: 0,
    shipped: 0,
    emailed: 0,
    skipped: 0,
  };

  let deployedSha: string;
  try {
    deployedSha = await readDeployedRev();
  } catch {
    // Cannot read production: no-op. Guessing here is how somebody gets told
    // their bug shipped when it did not.
    return result;
  }
  result.deployedSha = deployedSha;

  const ancestry: Ancestry = ancestryOverride ?? ((a, d) => isAncestor(a, d));
  const rows = await listResolvable();
  result.considered = rows.length;

  for (const row of rows) {
    let shipped: boolean;
    try {
      shipped = await ancestry(row.effective_fix_sha, deployedSha);
    } catch {
      // Unknown object or a broken clone — one bad row does not abandon the
      // sweep, and the row stays selectable for the next run.
      result.skipped += 1;
      continue;
    }
    if (!shipped) continue;
    result.shipped += 1;
    if (opts.dryRun) continue;

    try {
      const res = await sendResolvedEmail({ id: row.id, bodyText: resolvedCopy(row.body) });
      if (res.status === 'sent') result.emailed += 1;
      else result.skipped += 1;
    } catch {
      result.skipped += 1;
    }
  }

  return result;
}

function resolvedCopy(body: string): string {
  const quoted = body.trim().replace(/\s+/g, ' ').slice(0, 160);
  return [
    'You reported this:',
    `"${quoted}"`,
    'It is fixed and live. Thanks for telling us — it made the app better.',
  ].join('\n\n');
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd /var/home/jason/Projects/RepOS/api && npx vitest run tests/services/feedback-check-shipped.test.ts`
Expected: PASS — 14 tests.

- [ ] **Step 5: Mutation-check the unknown-object distinction**

In `isAncestor`, temporarily delete the `cat-file -e` loop.

Run: `npx vitest run tests/services/feedback-check-shipped.test.ts`
Expected: FAIL — "throws on an unknown object rather than answering false" and "skips a row whose object is unknown".

Revert and re-run. Expected: PASS.

- [ ] **Step 6: Mutation-check the no-op on an unreadable deployed SHA**

Temporarily replace the `catch` around `readDeployedRev()` with one that assigns a hardcoded SHA and continues.

Run: `npx vitest run tests/services/feedback-check-shipped.test.ts`
Expected: FAIL — "no-ops entirely when the deployed SHA is unreadable". This is the test that stops an SSH outage from emailing everybody.

Revert and re-run. Expected: PASS.

- [ ] **Step 7: Commit**

```bash
cd /var/home/jason/Projects/RepOS
git add api/src/services/checkShipped.ts api/tests/services/feedback-check-shipped.test.ts
git commit -m "feat(feedback): check-shipped by ancestry against the deployed SHA"
```

---

### Task 5: `reconcile-fixes` — observed remote state

**Files:**
- Create: `api/src/services/githubState.ts`
- Create: `api/src/services/reconcileFixes.ts`
- Create: `api/tests/services/feedback-reconcile.test.ts`

**Interfaces:**
- Consumes: `db`, `withFeedbackLock`, `SHA_RE`, `FixStatus`.
- Produces (`githubState.ts`):
  - `function __setGithubFetchForTesting(f: typeof fetch | null): void`
  - `interface BranchState { exists: boolean; headSha: string | null }`
  - `interface PrState { number: number; state: 'open' | 'closed'; merged: boolean; mergeCommitSha: string | null }`
  - `lookupBranch(branch: string): Promise<BranchState>`
  - `lookupPrForBranch(branch: string): Promise<PrState | null>`
- Produces (`reconcileFixes.ts`):
  - `interface ReconcileResult { examined: number; changed: number; unchanged: number; errored: number }`
  - `reconcileFixes(): Promise<ReconcileResult>`

**Why observation instead of bookkeeping.** `submit-patch` and `open-pr` cross a process boundary and their responses can be lost — a push can succeed and the reply never arrive. If those verbs wrote the state, a lost response would leave the database claiming less than reality and the next run would try again. Instead they write nothing, and `reconcileFixes` asks GitHub what is actually there. An interrupted attempt resumes from observed reality.

This is also why `reconcileFixes` is the **sole writer** of `patch_submitted`, `pr_open` and `merged`. Two writers for one fact is how the fact stops being one.

The read is anonymous — the repository is public. `repos-git`'s token is for writes only, and giving the observer a token would put a credential in the path that runs on every sweep for no gain.

- [ ] **Step 1: Write the failing test**

Create `api/tests/services/feedback-reconcile.test.ts`:

```ts
import 'dotenv/config';
import { describe, it, expect, beforeEach, afterEach, afterAll, vi } from 'vitest';
import pg from 'pg';
import { createEphemeralDb } from '../helpers/ephemeral-db.js';
import { runMigrations } from '../../src/db/runMigrations.js';

const eph = await createEphemeralDb('fb-reconcile');
{
  const bootstrap = new pg.Pool({ connectionString: eph.url, max: 4 });
  await runMigrations(bootstrap);
  await bootstrap.end();
}
process.env.DATABASE_URL = eph.url;

const { db } = await import('../../src/db/client.js');
const { triage } = await import('../../src/services/feedbackTriage.js');
const gh = await import('../../src/services/githubState.js');
const { reconcileFixes } = await import('../../src/services/reconcileFixes.js');

afterAll(async () => {
  await db.end();
  await eph.drop();
});

const HEAD = 'd'.repeat(40);
const MERGE = 'e'.repeat(40);

/** Route by URL so one stub serves both the branch and the PR lookup. */
function stub(routes: Record<string, { status: number; body: unknown }>) {
  return vi.fn(async (input: RequestInfo | URL) => {
    const url = String(input);
    for (const [needle, res] of Object.entries(routes)) {
      if (url.includes(needle)) {
        return new Response(JSON.stringify(res.body), {
          status: res.status,
          headers: { 'content-type': 'application/json' },
        });
      }
    }
    return new Response('{}', { status: 404, headers: { 'content-type': 'application/json' } });
  });
}

async function mkNeeded(): Promise<string> {
  const { rows } = await db.query<{ id: string }>(
    `INSERT INTO feedback (body, user_email_at_submit) VALUES ('broke','s@example.test') RETURNING id`,
  );
  await triage({ id: rows[0].id, category: 'bug', severity: 'p2', note: 'real' });
  return rows[0].id;
}

async function state(id: string) {
  const { rows } = await db.query(
    `SELECT fix_status, fix_branch, fix_pr_number, fix_commit_sha FROM feedback WHERE id=$1`,
    [id],
  );
  return rows[0];
}

beforeEach(async () => {
  await db.query('DELETE FROM feedback_emails');
  await db.query('DELETE FROM feedback');
});

afterEach(() => gh.__setGithubFetchForTesting(null));

describe('reconcileFixes', () => {
  it('promotes needed to patch_submitted when the branch exists with no PR', async () => {
    const id = await mkNeeded();
    gh.__setGithubFetchForTesting(
      stub({
        [`/git/ref/heads/feedback%2F${id}`]: { status: 200, body: { object: { sha: HEAD } } },
        '/pulls?': { status: 200, body: [] },
      }),
    );
    const res = await reconcileFixes();
    expect(res).toMatchObject({ examined: 1, changed: 1 });
    expect(await state(id)).toMatchObject({
      fix_status: 'patch_submitted',
      fix_branch: `feedback/${id}`,
    });
  });

  it('promotes to pr_open when an open PR exists', async () => {
    const id = await mkNeeded();
    gh.__setGithubFetchForTesting(
      stub({
        [`/git/ref/heads/feedback%2F${id}`]: { status: 200, body: { object: { sha: HEAD } } },
        '/pulls?': {
          status: 200,
          body: [{ number: 91, state: 'open', merged_at: null, merge_commit_sha: null }],
        },
      }),
    );
    await reconcileFixes();
    expect(await state(id)).toMatchObject({ fix_status: 'pr_open', fix_pr_number: 91 });
  });

  it('promotes to merged and records the merge commit SHA', async () => {
    const id = await mkNeeded();
    await db.query(`UPDATE feedback SET fix_status='pr_open', fix_pr_number=91 WHERE id=$1`, [id]);
    gh.__setGithubFetchForTesting(
      stub({
        [`/git/ref/heads/feedback%2F${id}`]: { status: 404, body: { message: 'Not Found' } },
        '/pulls?': {
          status: 200,
          body: [
            { number: 91, state: 'closed', merged_at: '2026-09-05T00:00:00Z', merge_commit_sha: MERGE },
          ],
        },
      }),
    );
    await reconcileFixes();
    expect(await state(id)).toMatchObject({ fix_status: 'merged', fix_commit_sha: MERGE });
  });

  it('does not demote merged back to needed when the branch is deleted', async () => {
    // Post-merge branch deletion is routine. A reconciler that demoted on it
    // would flip the row every sweep and could re-trigger work already done.
    const id = await mkNeeded();
    await db.query(
      `UPDATE feedback SET fix_status='merged', fix_commit_sha=$2, fix_pr_number=91 WHERE id=$1`,
      [id, MERGE],
    );
    gh.__setGithubFetchForTesting(stub({}));  // everything 404s
    const res = await reconcileFixes();
    expect(res.examined).toBe(0);
    expect(await state(id)).toMatchObject({ fix_status: 'merged', fix_commit_sha: MERGE });
  });

  it('demotes pr_open to needed when neither branch nor PR exists', async () => {
    // A closed-unmerged PR with the branch gone means the attempt was
    // abandoned. The row must become workable again.
    const id = await mkNeeded();
    await db.query(`UPDATE feedback SET fix_status='pr_open', fix_pr_number=91 WHERE id=$1`, [id]);
    gh.__setGithubFetchForTesting(
      stub({
        '/pulls?': {
          status: 200,
          body: [{ number: 91, state: 'closed', merged_at: null, merge_commit_sha: null }],
        },
      }),
    );
    await reconcileFixes();
    expect(await state(id)).toMatchObject({ fix_status: 'needed', fix_pr_number: null });
  });

  it('never touches a deferred row', async () => {
    const id = await mkNeeded();
    await db.query(`UPDATE feedback SET fix_status='deferred' WHERE id=$1`, [id]);
    gh.__setGithubFetchForTesting(
      stub({ [`/git/ref/heads/feedback%2F${id}`]: { status: 200, body: { object: { sha: HEAD } } } }),
    );
    const res = await reconcileFixes();
    expect(res.examined).toBe(0);
    expect(await state(id)).toMatchObject({ fix_status: 'deferred' });
  });

  it('never touches a duplicate', async () => {
    const canonical = await mkNeeded();
    const dup = await mkNeeded();
    await triage({ id: dup, category: 'bug', severity: 'p2', note: 'dup', dedupeOf: canonical });
    gh.__setGithubFetchForTesting(stub({ '/pulls?': { status: 200, body: [] } }));
    const res = await reconcileFixes();
    expect(res.examined).toBe(1);
    expect(await state(dup)).toMatchObject({ fix_status: 'n/a' });
  });

  it('leaves the row untouched when GitHub errors, and reports it', async () => {
    const id = await mkNeeded();
    gh.__setGithubFetchForTesting(
      vi.fn(async () => new Response('boom', { status: 503 })),
    );
    const res = await reconcileFixes();
    expect(res).toMatchObject({ examined: 1, changed: 0, errored: 1 });
    expect(await state(id)).toMatchObject({ fix_status: 'needed' });
  });

  it('one failing row does not abandon the others', async () => {
    const bad = await mkNeeded();
    const good = await mkNeeded();
    gh.__setGithubFetchForTesting(
      vi.fn(async (input: RequestInfo | URL) => {
        const url = String(input);
        if (url.includes(`feedback%2F${bad}`)) return new Response('boom', { status: 503 });
        if (url.includes('/pulls?')) {
          return new Response(
            JSON.stringify([{ number: 92, state: 'open', merged_at: null, merge_commit_sha: null }]),
            { status: 200, headers: { 'content-type': 'application/json' } },
          );
        }
        return new Response(JSON.stringify({ object: { sha: HEAD } }), {
          status: 200, headers: { 'content-type': 'application/json' },
        });
      }),
    );
    const res = await reconcileFixes();
    expect(res.errored).toBe(1);
    expect(await state(good)).toMatchObject({ fix_status: 'pr_open' });
  });

  it('sends no Authorization header — the repository is public', async () => {
    const id = await mkNeeded();
    const spy = vi.fn(async () => new Response('[]', {
      status: 200, headers: { 'content-type': 'application/json' },
    }));
    gh.__setGithubFetchForTesting(spy);
    await reconcileFixes();
    for (const call of spy.mock.calls) {
      const init = call[1] as RequestInit | undefined;
      const headers = new Headers(init?.headers ?? {});
      expect(headers.get('authorization')).toBeNull();
    }
    expect(await state(id)).toBeTruthy();
  });

  it('rejects a merge_commit_sha that is not 40-hex rather than storing it', async () => {
    const id = await mkNeeded();
    await db.query(`UPDATE feedback SET fix_status='pr_open', fix_pr_number=91 WHERE id=$1`, [id]);
    gh.__setGithubFetchForTesting(
      stub({
        '/pulls?': {
          status: 200,
          body: [{ number: 91, state: 'closed', merged_at: '2026-09-05T00:00:00Z',
                   merge_commit_sha: 'NOTASHA' }],
        },
      }),
    );
    const res = await reconcileFixes();
    expect(res.errored).toBe(1);
    expect(await state(id)).toMatchObject({ fix_status: 'pr_open', fix_commit_sha: null });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd /var/home/jason/Projects/RepOS/api && npx vitest run tests/services/feedback-reconcile.test.ts`
Expected: FAIL — cannot resolve `githubState.js`.

- [ ] **Step 3: Write `githubState.ts`**

```ts
// Anonymous reads of the public repository's branch and PR state.
//
// No token: the repo is public, and putting a credential in the path that runs
// on every sweep buys nothing. repos-git's token is for writes only.
const API = 'https://api.github.com';
const TIMEOUT_MS = 10_000;

let fetchOverride: typeof fetch | null = null;

export function __setGithubFetchForTesting(f: typeof fetch | null): void {
  fetchOverride = f;
}

export function repoSlug(): string {
  return process.env.FEEDBACK_GITHUB_REPO ?? 'otahesh/RepOS';
}

export interface BranchState {
  exists: boolean;
  headSha: string | null;
}

export interface PrState {
  number: number;
  state: 'open' | 'closed';
  merged: boolean;
  mergeCommitSha: string | null;
}

async function get(path: string): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    return await (fetchOverride ?? fetch)(`${API}${path}`, {
      method: 'GET',
      headers: {
        accept: 'application/vnd.github+json',
        'x-github-api-version': '2022-11-28',
        'user-agent': 'repos-feedback-triage',
      },
      signal: controller.signal,
    });
  } finally {
    clearTimeout(timer);
  }
}

export async function lookupBranch(branch: string): Promise<BranchState> {
  const res = await get(
    `/repos/${repoSlug()}/git/ref/heads/${encodeURIComponent(branch)}`,
  );
  if (res.status === 404) return { exists: false, headSha: null };
  if (!res.ok) throw new Error(`github branch lookup failed: ${res.status}`);
  const body = (await res.json()) as { object?: { sha?: string } };
  return { exists: true, headSha: body.object?.sha ?? null };
}

export async function lookupPrForBranch(branch: string): Promise<PrState | null> {
  const [owner] = repoSlug().split('/');
  const res = await get(
    `/repos/${repoSlug()}/pulls?state=all&head=${encodeURIComponent(`${owner}:${branch}`)}&per_page=10`,
  );
  if (!res.ok) throw new Error(`github pr lookup failed: ${res.status}`);
  const body = (await res.json()) as Array<{
    number: number;
    state: string;
    merged_at: string | null;
    merge_commit_sha: string | null;
  }>;
  if (!Array.isArray(body) || body.length === 0) return null;

  // Prefer a merged PR, then an open one, then the most recent closed one.
  const merged = body.find((p) => p.merged_at !== null);
  const open = body.find((p) => p.state === 'open');
  const chosen = merged ?? open ?? body[0];
  return {
    number: chosen.number,
    state: chosen.state === 'open' ? 'open' : 'closed',
    merged: chosen.merged_at !== null,
    mergeCommitSha: chosen.merge_commit_sha ?? null,
  };
}
```

- [ ] **Step 4: Write `reconcileFixes.ts`**

```ts
// The sole writer of every remote-derived fix_status.
//
// submit-patch and open-pr write NOTHING to the database. Their responses can
// be lost — a push can succeed and the reply never arrive — so if they wrote
// the state, a lost response would leave the row claiming less than reality.
// Here the state is observed instead, and an interrupted attempt resumes from
// what is actually on the remote.
import { db } from '../db/client.js';
import { withFeedbackLock, LockTimeoutError } from './feedbackLock.js';
import { SHA_RE } from './fixLifecycle.js';
import { lookupBranch, lookupPrForBranch } from './githubState.js';
import type { FixStatus } from './feedbackTriage.js';

export interface ReconcileResult {
  examined: number;
  changed: number;
  unchanged: number;
  errored: number;
}

/** The states this function owns. Anything else it leaves entirely alone. */
const OBSERVABLE: readonly FixStatus[] = ['needed', 'patch_submitted', 'pr_open'];

export async function reconcileFixes(): Promise<ReconcileResult> {
  const result: ReconcileResult = { examined: 0, changed: 0, unchanged: 0, errored: 0 };

  const { rows } = await db.query<{
    id: string;
    fix_status: FixStatus;
    fix_pr_number: number | null;
    fix_commit_sha: string | null;
  }>(
    `SELECT id, fix_status, fix_pr_number, fix_commit_sha
       FROM feedback
      WHERE fix_status = ANY($1::text[])
        AND dedupe_of IS NULL
      ORDER BY created_at, id`,
    [OBSERVABLE],
  );
  result.examined = rows.length;

  for (const row of rows) {
    const branch = `feedback/${row.id}`;
    let next: { status: FixStatus; pr: number | null; sha: string | null };

    try {
      const [branchState, pr] = await Promise.all([
        lookupBranch(branch),
        lookupPrForBranch(branch),
      ]);

      if (pr?.merged) {
        if (pr.mergeCommitSha === null || !SHA_RE.test(pr.mergeCommitSha)) {
          // A merged PR with no usable SHA cannot drive ship detection.
          // Leave the row where it is rather than record something the
          // ancestry check will refuse.
          throw new Error(`merged pr #${pr.number} has no usable merge_commit_sha`);
        }
        next = { status: 'merged', pr: pr.number, sha: pr.mergeCommitSha };
      } else if (pr && pr.state === 'open') {
        next = { status: 'pr_open', pr: pr.number, sha: row.fix_commit_sha };
      } else if (branchState.exists) {
        next = { status: 'patch_submitted', pr: null, sha: row.fix_commit_sha };
      } else {
        // No branch, no open PR, not merged: the attempt is gone. Back to
        // workable — but only from a state this function owns, which is why
        // `merged` and `deferred` were never selected above.
        next = { status: 'needed', pr: null, sha: row.fix_commit_sha };
      }
    } catch {
      result.errored += 1;
      continue;
    }

    const unchanged =
      next.status === row.fix_status &&
      next.pr === row.fix_pr_number &&
      next.sha === row.fix_commit_sha;
    if (unchanged) {
      result.unchanged += 1;
      continue;
    }

    try {
      await withFeedbackLock(row.id, async () => {
        // Re-check under the lock: triage or defer may have moved the row out
        // of an observable state since the batch SELECT.
        const { rowCount } = await db.query(
          `UPDATE feedback
              SET fix_status=$2, fix_branch=$3, fix_pr_number=$4,
                  fix_commit_sha=COALESCE($5, fix_commit_sha)
            WHERE id=$1
              AND fix_status = ANY($6::text[])
              AND dedupe_of IS NULL`,
          [row.id, next.status, next.status === 'needed' ? null : branch, next.pr, next.sha, OBSERVABLE],
        );
        if (rowCount === 1) result.changed += 1;
        else result.unchanged += 1;
      });
    } catch (err) {
      if (err instanceof LockTimeoutError) {
        result.errored += 1;
        continue;
      }
      throw err;
    }
  }

  return result;
}
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `cd /var/home/jason/Projects/RepOS/api && npx vitest run tests/services/feedback-reconcile.test.ts`
Expected: PASS — 11 tests.

- [ ] **Step 6: Mutation-check the no-demotion guarantee**

Temporarily add `'merged'` to `OBSERVABLE`.

Run: `npx vitest run tests/services/feedback-reconcile.test.ts`
Expected: FAIL — "does not demote merged back to needed when the branch is deleted". Post-merge branch deletion is routine, so this mutation would flip every finished row on every sweep.

Revert and re-run. Expected: PASS.

- [ ] **Step 7: Commit**

```bash
cd /var/home/jason/Projects/RepOS
git add api/src/services/githubState.ts api/src/services/reconcileFixes.ts api/tests/services/feedback-reconcile.test.ts
git commit -m "feat(feedback): reconcile-fixes as the sole writer of remote-derived state"
```

---

### Task 6: Patch approval — privacy scan and Ed25519 signing

**Files:**
- Create: `api/src/services/patchApproval.ts`
- Create: `api/tests/services/patch-approval.test.ts`

**Interfaces:**
- Consumes: `SHA_RE` from `./fixLifecycle.js`.
- Produces:
  - `class ApprovalError extends Error { readonly code: ApprovalErrorCode }`
  - `interface Approval { feedbackId: string; baseSha: string; patchDigest: string; expiry: number }`
  - `patchDigest(patch: string): string` — sha256 hex of the exact bytes
  - `scanPatch(patch: string): string[]` — human-readable reasons, empty when clean
  - `signApproval(a: Approval, privateKeyPem: string): string` — base64 detached signature
  - `verifyApproval(a: Approval, sig: string, publicKeyPem: string, now?: number): void` — throws on any failure
  - `approvalMessage(a: Approval): Buffer` — the exact signed bytes

**Why the signature is over four fields and not just the digest.** Signing only the patch would let an approved patch be replayed against a different base commit, where the same diff means something else, or attached to a different feedback id, or used forever. Binding `(feedback_id, base_sha, patch_digest, expiry)` makes the approval specific to one patch, one base, one item, one window.

**Why the privacy scan runs on the broker side.** `repos-git` receives an inert diff and pushes it. If the scan lived there, the check would be inside the process that holds the write credential, and a bypass would be a single edit away from a push. Here it is a gate the patch must pass before an approval exists at all.

- [ ] **Step 1: Write the failing test**

Create `api/tests/services/patch-approval.test.ts`:

```ts
import { describe, it, expect, beforeAll } from 'vitest';
import { generateKeyPairSync, createHash } from 'node:crypto';
import {
  patchDigest,
  scanPatch,
  signApproval,
  verifyApproval,
  approvalMessage,
  type Approval,
} from '../../src/services/patchApproval.js';

let priv: string;
let pub: string;
let otherPriv: string;

beforeAll(() => {
  const a = generateKeyPairSync('ed25519');
  priv = a.privateKey.export({ type: 'pkcs8', format: 'pem' }).toString();
  pub = a.publicKey.export({ type: 'spki', format: 'pem' }).toString();
  otherPriv = generateKeyPairSync('ed25519')
    .privateKey.export({ type: 'pkcs8', format: 'pem' })
    .toString();
});

const CLEAN = `diff --git a/api/src/routes/programs.ts b/api/src/routes/programs.ts
--- a/api/src/routes/programs.ts
+++ b/api/src/routes/programs.ts
@@ -1,3 +1,3 @@
-  const limit = 10;
+  const limit = 25;
`;

const base = (): Approval => ({
  feedbackId: '5',
  baseSha: 'a'.repeat(40),
  patchDigest: patchDigest(CLEAN),
  expiry: Math.floor(Date.now() / 1000) + 600,
});

describe('patchDigest', () => {
  it('is sha256 of the exact bytes', () => {
    expect(patchDigest(CLEAN)).toBe(createHash('sha256').update(CLEAN, 'utf8').digest('hex'));
  });

  it('changes with a single whitespace edit', () => {
    expect(patchDigest(CLEAN)).not.toBe(patchDigest(`${CLEAN} `));
  });
});

describe('scanPatch', () => {
  it('passes a clean patch', () => {
    expect(scanPatch(CLEAN)).toEqual([]);
  });

  it('catches an added email address', () => {
    const p = `${CLEAN}+const owner = 'someone@example.com';\n`;
    expect(scanPatch(p).join(' ')).toMatch(/email/i);
  });

  it('catches secret-shaped material', () => {
    for (const line of [
      `+const k = 're_1234567890abcdefghijklmnop';`,
      `+RESEND_API_KEY=abc123`,
      `+-----BEGIN OPENSSH PRIVATE KEY-----`,
      `+const t = 'ghp_0123456789abcdefghijklmnopqrstuvwxyz';`,
      `+DATABASE_URL=postgres://repos:hunter2@10.0.0.1:5432/repos`,
    ]) {
      expect(scanPatch(`${CLEAN}${line}\n`).length).toBeGreaterThan(0);
    }
  });

  it('ignores matches on REMOVED lines', () => {
    // Deleting a secret is exactly what we want to encourage.
    expect(scanPatch(`${CLEAN}-const k = 're_1234567890abcdefghijklmnop';\n`)).toEqual([]);
  });

  it('ignores matches in context lines', () => {
    expect(scanPatch(`${CLEAN} someone@example.com\n`)).toEqual([]);
  });

  it('refuses a patch that touches a forbidden path', () => {
    const p = `diff --git a/.github/workflows/ci.yml b/.github/workflows/ci.yml\n+    run: curl evil\n`;
    expect(scanPatch(p).join(' ')).toMatch(/\.github/);
  });

  it('refuses a patch touching git config or hooks', () => {
    for (const path of ['.git/config', '.githooks/pre-commit', 'api/.env']) {
      const p = `diff --git a/${path} b/${path}\n+x\n`;
      expect(scanPatch(p).length).toBeGreaterThan(0);
    }
  });
});

describe('signApproval / verifyApproval', () => {
  it('round-trips', () => {
    const a = base();
    expect(() => verifyApproval(a, signApproval(a, priv), pub)).not.toThrow();
  });

  it('produces a 64-byte signature', () => {
    expect(Buffer.from(signApproval(base(), priv), 'base64')).toHaveLength(64);
  });

  it('rejects a signature from a different key', () => {
    const a = base();
    expect(() => verifyApproval(a, signApproval(a, otherPriv), pub)).toThrow(/bad signature/i);
  });

  it('rejects a changed patch digest — the approval is for one patch', () => {
    const a = base();
    const sig = signApproval(a, priv);
    expect(() => verifyApproval({ ...a, patchDigest: patchDigest('other') }, sig, pub)).toThrow(
      /bad signature/i,
    );
  });

  it('rejects a changed base SHA — the same diff means something else elsewhere', () => {
    const a = base();
    const sig = signApproval(a, priv);
    expect(() => verifyApproval({ ...a, baseSha: 'b'.repeat(40) }, sig, pub)).toThrow(
      /bad signature/i,
    );
  });

  it('rejects a changed feedback id', () => {
    const a = base();
    const sig = signApproval(a, priv);
    expect(() => verifyApproval({ ...a, feedbackId: '6' }, sig, pub)).toThrow(/bad signature/i);
  });

  it('rejects an expired approval', () => {
    const a = { ...base(), expiry: Math.floor(Date.now() / 1000) - 1 };
    expect(() => verifyApproval(a, signApproval(a, priv), pub)).toThrow(/expired/i);
  });

  it('rejects an extended expiry — expiry is signed, not advisory', () => {
    const a = base();
    const sig = signApproval(a, priv);
    expect(() => verifyApproval({ ...a, expiry: a.expiry + 86_400 }, sig, pub)).toThrow(
      /bad signature/i,
    );
  });

  it('rejects garbage in the signature slot without throwing a raw crypto error', () => {
    for (const bad of ['', 'not-base64!!', 'AAAA']) {
      expect(() => verifyApproval(base(), bad, pub)).toThrow(/bad signature/i);
    }
  });

  it('signs unambiguously — field values cannot be shifted across the delimiter', () => {
    // A naive join would let ("5|aaa", "bbb") and ("5", "aaa|bbb") collide.
    const m1 = approvalMessage({ ...base(), feedbackId: '5' }).toString('hex');
    const m2 = approvalMessage({ ...base(), feedbackId: '5\n' + 'a'.repeat(40) }).toString('hex');
    expect(m1).not.toBe(m2);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd /var/home/jason/Projects/RepOS/api && npx vitest run tests/services/patch-approval.test.ts`
Expected: FAIL — cannot resolve `patchApproval.js`.

- [ ] **Step 3: Write the implementation**

Create `api/src/services/patchApproval.ts`:

```ts
// Approval for a patch that is about to cross a privilege boundary.
//
// repos-git holds a write credential and no judgement; it will push whatever
// carries a valid approval. So the approval binds four things at once —
// (feedback_id, base_sha, patch_digest, expiry) — and every one of them is
// inside the signed bytes. Signing the digest alone would let an approved
// patch be replayed against a different base, where the same diff means
// something else, or reused forever.
import { createHash, createPublicKey, createPrivateKey, sign, verify } from 'node:crypto';
import { SHA_RE } from './fixLifecycle.js';

export type ApprovalErrorCode = 'bad_signature' | 'expired' | 'malformed';

export class ApprovalError extends Error {
  readonly code: ApprovalErrorCode;
  constructor(code: ApprovalErrorCode, message: string) {
    super(message);
    this.name = 'ApprovalError';
    this.code = code;
  }
}

export interface Approval {
  feedbackId: string;
  baseSha: string;
  patchDigest: string;
  expiry: number; // unix seconds
}

export function patchDigest(patch: string): string {
  return createHash('sha256').update(patch, 'utf8').digest('hex');
}

/**
 * Length-prefixed encoding so no field value can be shifted across a
 * delimiter into its neighbour. A naive join lets ("5|aaa","bbb") and
 * ("5","aaa|bbb") produce identical bytes — one signature, two meanings.
 */
export function approvalMessage(a: Approval): Buffer {
  const parts = [a.feedbackId, a.baseSha, a.patchDigest, String(a.expiry)];
  const chunks: Buffer[] = [Buffer.from('repos-feedback-approval-v1\n', 'utf8')];
  for (const p of parts) {
    const b = Buffer.from(p, 'utf8');
    const len = Buffer.alloc(4);
    len.writeUInt32BE(b.length);
    chunks.push(len, b);
  }
  return Buffer.concat(chunks);
}

export function signApproval(a: Approval, privateKeyPem: string): string {
  // Ed25519 signs the message directly; the digest algorithm argument is null.
  return sign(null, approvalMessage(a), createPrivateKey(privateKeyPem)).toString('base64');
}

export function verifyApproval(
  a: Approval,
  signatureB64: string,
  publicKeyPem: string,
  now: number = Math.floor(Date.now() / 1000),
): void {
  if (!SHA_RE.test(a.baseSha)) {
    throw new ApprovalError('malformed', `base sha is not 40-hex: ${a.baseSha}`);
  }
  if (!/^[0-9a-f]{64}$/.test(a.patchDigest)) {
    throw new ApprovalError('malformed', 'patch digest is not sha256 hex');
  }
  if (!Number.isSafeInteger(a.expiry)) {
    throw new ApprovalError('malformed', 'expiry is not an integer');
  }

  let sigBytes: Buffer;
  try {
    sigBytes = Buffer.from(signatureB64, 'base64');
  } catch {
    throw new ApprovalError('bad_signature', 'signature is not base64');
  }
  if (sigBytes.length !== 64) {
    throw new ApprovalError('bad_signature', 'signature is not 64 bytes');
  }

  let good: boolean;
  try {
    good = verify(null, approvalMessage(a), createPublicKey(publicKeyPem), sigBytes);
  } catch {
    throw new ApprovalError('bad_signature', 'signature verification failed');
  }
  if (!good) throw new ApprovalError('bad_signature', 'bad signature for this approval');

  // Expiry is checked AFTER the signature, so a forged approval cannot be
  // distinguished from an expired one by which error comes back.
  if (a.expiry <= now) {
    throw new ApprovalError('expired', `approval expired at ${a.expiry}`);
  }
}

/** Paths a feedback patch may never touch, whatever it claims to fix. */
const FORBIDDEN_PATHS = [
  /^\.github\//,
  /^\.git\//,
  /^\.githooks\//,
  /(^|\/)\.env($|\.)/,
  /^docker\/entrypoint/,
  /(^|\/)id_(rsa|ed25519)/,
];

const SECRET_PATTERNS: Array<[RegExp, string]> = [
  [/[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/, 'an email address'],
  [/\bre_[A-Za-z0-9_-]{16,}/, 'a Resend-shaped API key'],
  [/\bgh[pousr]_[A-Za-z0-9]{20,}/, 'a GitHub-shaped token'],
  [/-----BEGIN [A-Z ]*PRIVATE KEY-----/, 'a private key block'],
  [/\b(?:API_KEY|SECRET|PASSWORD|TOKEN|WEBHOOK_URL)\s*[=:]\s*\S{8,}/i, 'an assigned secret'],
  [/\b[a-z]+:\/\/[^\s/@]+:[^\s/@]+@/, 'a URL with inline credentials'],
];

/**
 * Reasons this patch must not be pushed. Empty means clean.
 *
 * Only ADDED lines are scanned. Deleting a secret is exactly the change we
 * want to encourage, and flagging removals would block it.
 *
 * This runs on the broker side, before an approval exists. Putting it inside
 * repos-git would place the check in the process that holds the write
 * credential, one edit away from a push.
 */
export function scanPatch(patch: string): string[] {
  const reasons: string[] = [];

  for (const line of patch.split('\n')) {
    const m = /^diff --git a\/(\S+) b\/(\S+)/.exec(line);
    if (!m) continue;
    for (const path of [m[1], m[2]]) {
      for (const rule of FORBIDDEN_PATHS) {
        if (rule.test(path)) reasons.push(`touches a forbidden path: ${path}`);
      }
    }
  }

  for (const line of patch.split('\n')) {
    if (!line.startsWith('+') || line.startsWith('+++')) continue;
    const added = line.slice(1);
    for (const [rule, label] of SECRET_PATTERNS) {
      if (rule.test(added)) reasons.push(`added line contains ${label}`);
    }
  }

  return [...new Set(reasons)];
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd /var/home/jason/Projects/RepOS/api && npx vitest run tests/services/patch-approval.test.ts`
Expected: PASS — 18 tests.

- [ ] **Step 5: Mutation-check the field binding**

In `approvalMessage`, temporarily drop `a.baseSha` from `parts`.

Run: `npx vitest run tests/services/patch-approval.test.ts`
Expected: FAIL — "rejects a changed base SHA". Then restore `baseSha` and drop `String(a.expiry)`.
Expected: FAIL — "rejects an extended expiry".

Revert both and re-run. Expected: PASS.

- [ ] **Step 6: Commit**

```bash
cd /var/home/jason/Projects/RepOS
git add api/src/services/patchApproval.ts api/tests/services/patch-approval.test.ts
git commit -m "feat(feedback): Ed25519 patch approval and the privacy scan"
```

---

### Task 7: `repos-git` — `submit-patch` and `open-pr`

**Files:**
- Create: `api/src/reposGit/index.ts`
- Create: `api/src/reposGit/submitPatch.ts`
- Create: `api/src/reposGit/openPr.ts`
- Create: `api/tests/reposGit/submit-patch.test.ts`
- Create: `api/tests/reposGit/open-pr.test.ts`

**Interfaces:**
- Consumes: `verifyApproval`, `patchDigest`, `Approval`, `ApprovalError`, `SHA_RE`.
- Produces (`submitPatch.ts`):
  - `class RepoGitError extends Error { readonly code: RepoGitErrorCode }`
  - `const GIT_HARDENING: readonly string[]`
  - `interface SubmitPatchInput { feedbackId: string; patch: string; approval: Approval; signature: string; message: string; repoDir: string; publicKeyPem: string; remote?: string }`
  - `interface SubmitPatchResult { branch: string; headSha: string; replaced: boolean }`
  - `submitPatch(input: SubmitPatchInput): Promise<SubmitPatchResult>`
- Produces (`openPr.ts`):
  - `function __setPrFetchForTesting(f: typeof fetch | null): void`
  - `interface OpenPrInput { feedbackId: string; title: string; body: string; baseBranch?: string }`
  - `openPr(input: OpenPrInput): Promise<{ number: number; url: string }>`

**Why a fast-forward replacement commit.** `main` here is protected with `required_linear_history`, and a force push to a feedback branch would discard whatever review history is on it. So a revised patch is applied to the pinned base and committed with the **current branch tip as parent**. The result fast-forwards; nothing is rewritten and nothing is lost.

**Why this module may not import the database.** Plan 3 runs it as a separate OS principal holding the GitHub token. Nothing here may reach the database or the mailer, and nothing on the broker side may reach the token. Task 8 asserts those import boundaries — the split is enforced before the processes exist.

- [ ] **Step 1: Write the failing test for `submitPatch`**

Create `api/tests/reposGit/submit-patch.test.ts`:

```ts
import { describe, it, expect, beforeEach, afterAll } from 'vitest';
import { generateKeyPairSync } from 'node:crypto';
import { mkdtemp, rm, writeFile, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';
import { submitPatch, RepoGitError, GIT_HARDENING } from '../../src/reposGit/submitPatch.js';
import { patchDigest, signApproval, type Approval } from '../../src/services/patchApproval.js';

const keys = generateKeyPairSync('ed25519');
const priv = keys.privateKey.export({ type: 'pkcs8', format: 'pem' }).toString();
const pub = keys.publicKey.export({ type: 'spki', format: 'pem' }).toString();
const otherPriv = generateKeyPairSync('ed25519')
  .privateKey.export({ type: 'pkcs8', format: 'pem' })
  .toString();

const dirs: string[] = [];
afterAll(async () => {
  for (const d of dirs) await rm(d, { recursive: true, force: true });
});

const git = (dir: string, ...args: string[]) =>
  execFileSync('git', ['-C', dir, ...args], { encoding: 'utf8' }).trim();

/** A bare "remote" plus a working clone, so the push is real and local. */
async function makeRepo() {
  const bare = await mkdtemp(join(tmpdir(), 'fb-bare-'));
  const work = await mkdtemp(join(tmpdir(), 'fb-work-'));
  dirs.push(bare, work);
  execFileSync('git', ['init', '-q', '--bare', '-b', 'main', bare]);
  execFileSync('git', ['init', '-q', '-b', 'main', work]);
  git(work, 'config', 'user.email', 'test@example.test');
  git(work, 'config', 'user.name', 'Test');
  await writeFile(join(work, 'app.txt'), 'limit = 10\n');
  git(work, 'add', 'app.txt');
  git(work, 'commit', '-q', '-m', 'base');
  git(work, 'remote', 'add', 'origin', bare);
  git(work, 'push', '-q', 'origin', 'main');
  return { bare, work, base: git(work, 'rev-parse', 'HEAD') };
}

function diffFor(from: string, to: string): string {
  return [
    'diff --git a/app.txt b/app.txt',
    '--- a/app.txt',
    '+++ b/app.txt',
    '@@ -1 +1 @@',
    `-${from}`,
    `+${to}`,
    '',
  ].join('\n');
}

function approvalFor(feedbackId: string, base: string, patch: string, ttl = 600): Approval {
  return {
    feedbackId,
    baseSha: base,
    patchDigest: patchDigest(patch),
    expiry: Math.floor(Date.now() / 1000) + ttl,
  };
}

describe('submitPatch', () => {
  it('creates feedback/<id> on the remote with the patch applied', async () => {
    const { bare, work, base } = await makeRepo();
    const patch = diffFor('limit = 10', 'limit = 25');
    const approval = approvalFor('5', base, patch);

    const res = await submitPatch({
      feedbackId: '5', patch, approval, signature: signApproval(approval, priv),
      message: 'fix: raise the programs page limit', repoDir: work, publicKeyPem: pub,
    });

    expect(res.branch).toBe('feedback/5');
    expect(res.replaced).toBe(false);
    expect(git(bare, 'rev-parse', 'refs/heads/feedback/5')).toBe(res.headSha);
    expect(git(bare, 'show', `${res.headSha}:app.txt`)).toBe('limit = 25');
  });

  it('derives the branch name and ignores any caller-supplied one', async () => {
    const { bare, work, base } = await makeRepo();
    const patch = diffFor('limit = 10', 'limit = 25');
    const approval = approvalFor('5', base, patch);
    await submitPatch({
      // @ts-expect-error branch is deliberately not part of the input type
      branch: 'main',
      feedbackId: '5', patch, approval, signature: signApproval(approval, priv),
      message: 'fix: x', repoDir: work, publicKeyPem: pub,
    });
    // main is untouched; only the derived branch moved.
    expect(git(bare, 'show', 'refs/heads/main:app.txt')).toBe('limit = 10');
    expect(git(bare, 'rev-parse', 'refs/heads/feedback/5')).toBeTruthy();
  });

  it('a revision fast-forwards: the old tip is the new commit parent', async () => {
    const { bare, work, base } = await makeRepo();
    const first = diffFor('limit = 10', 'limit = 25');
    const a1 = approvalFor('5', base, first);
    const r1 = await submitPatch({
      feedbackId: '5', patch: first, approval: a1, signature: signApproval(a1, priv),
      message: 'fix: first try', repoDir: work, publicKeyPem: pub,
    });

    const second = diffFor('limit = 10', 'limit = 50');
    const a2 = approvalFor('5', base, second);
    const r2 = await submitPatch({
      feedbackId: '5', patch: second, approval: a2, signature: signApproval(a2, priv),
      message: 'fix: second try', repoDir: work, publicKeyPem: pub,
    });

    expect(r2.replaced).toBe(true);
    expect(git(bare, 'rev-parse', `${r2.headSha}^`)).toBe(r1.headSha);
    expect(git(bare, 'show', `${r2.headSha}:app.txt`)).toBe('limit = 50');
    // Nothing was rewritten: the first commit is still reachable.
    expect(git(bare, 'cat-file', '-t', r1.headSha)).toBe('commit');
  });

  it('never force-pushes', async () => {
    const { work, base } = await makeRepo();
    const patch = diffFor('limit = 10', 'limit = 25');
    const approval = approvalFor('5', base, patch);
    const seen: string[][] = [];
    await submitPatch({
      feedbackId: '5', patch, approval, signature: signApproval(approval, priv),
      message: 'fix: x', repoDir: work, publicKeyPem: pub,
      // @ts-expect-error test-only hook asserted below
      __onGit: (argv: string[]) => seen.push(argv),
    });
    const pushes = seen.filter((a) => a.includes('push'));
    expect(pushes.length).toBeGreaterThan(0);
    for (const p of pushes) {
      expect(p).not.toContain('--force');
      expect(p).not.toContain('-f');
      expect(p.some((x) => x.startsWith('+'))).toBe(false);
    }
  });

  it('hardens every git invocation against hooks and inherited config', async () => {
    const { work, base } = await makeRepo();
    const patch = diffFor('limit = 10', 'limit = 25');
    const approval = approvalFor('5', base, patch);
    const seen: string[][] = [];
    await submitPatch({
      feedbackId: '5', patch, approval, signature: signApproval(approval, priv),
      message: 'fix: x', repoDir: work, publicKeyPem: pub,
      // @ts-expect-error test-only hook
      __onGit: (argv: string[]) => seen.push(argv),
    });
    expect(seen.length).toBeGreaterThan(0);
    for (const argv of seen) {
      for (const flag of GIT_HARDENING) expect(argv).toContain(flag);
    }
  });

  it('refuses a patch whose digest does not match the approval', async () => {
    const { work, base } = await makeRepo();
    const patch = diffFor('limit = 10', 'limit = 25');
    const approval = approvalFor('5', base, patch);
    const sig = signApproval(approval, priv);
    await expect(
      submitPatch({
        feedbackId: '5', patch: diffFor('limit = 10', 'limit = 99'), approval, signature: sig,
        message: 'fix: x', repoDir: work, publicKeyPem: pub,
      }),
    ).rejects.toMatchObject({ code: 'digest_mismatch' });
  });

  it('refuses a signature from the wrong key', async () => {
    const { work, base } = await makeRepo();
    const patch = diffFor('limit = 10', 'limit = 25');
    const approval = approvalFor('5', base, patch);
    await expect(
      submitPatch({
        feedbackId: '5', patch, approval, signature: signApproval(approval, otherPriv),
        message: 'fix: x', repoDir: work, publicKeyPem: pub,
      }),
    ).rejects.toMatchObject({ code: 'bad_signature' });
  });

  it('refuses an expired approval', async () => {
    const { work, base } = await makeRepo();
    const patch = diffFor('limit = 10', 'limit = 25');
    const approval = approvalFor('5', base, patch, -10);
    await expect(
      submitPatch({
        feedbackId: '5', patch, approval, signature: signApproval(approval, priv),
        message: 'fix: x', repoDir: work, publicKeyPem: pub,
      }),
    ).rejects.toMatchObject({ code: 'expired' });
  });

  it('refuses when the approval is for a different feedback id', async () => {
    const { work, base } = await makeRepo();
    const patch = diffFor('limit = 10', 'limit = 25');
    const approval = approvalFor('6', base, patch);
    await expect(
      submitPatch({
        feedbackId: '5', patch, approval, signature: signApproval(approval, priv),
        message: 'fix: x', repoDir: work, publicKeyPem: pub,
      }),
    ).rejects.toMatchObject({ code: 'id_mismatch' });
  });

  it('refuses a feedback id that is not a plain integer', async () => {
    const { work, base } = await makeRepo();
    const patch = diffFor('limit = 10', 'limit = 25');
    for (const bad of ['../main', '5;rm -rf /', 'HEAD', '5 5', '']) {
      const approval = approvalFor(bad, base, patch);
      await expect(
        submitPatch({
          feedbackId: bad, patch, approval, signature: signApproval(approval, priv),
          message: 'fix: x', repoDir: work, publicKeyPem: pub,
        }),
      ).rejects.toMatchObject({ code: 'bad_feedback_id' });
    }
  });

  it('refuses a base SHA the repository does not have', async () => {
    const { work } = await makeRepo();
    const patch = diffFor('limit = 10', 'limit = 25');
    const approval = approvalFor('5', '0'.repeat(40), patch);
    await expect(
      submitPatch({
        feedbackId: '5', patch, approval, signature: signApproval(approval, priv),
        message: 'fix: x', repoDir: work, publicKeyPem: pub,
      }),
    ).rejects.toMatchObject({ code: 'unknown_base' });
  });

  it('refuses a patch that does not apply, leaving the remote untouched', async () => {
    const { bare, work, base } = await makeRepo();
    const patch = diffFor('limit = 999', 'limit = 25');
    const approval = approvalFor('5', base, patch);
    await expect(
      submitPatch({
        feedbackId: '5', patch, approval, signature: signApproval(approval, priv),
        message: 'fix: x', repoDir: work, publicKeyPem: pub,
      }),
    ).rejects.toMatchObject({ code: 'apply_failed' });
    expect(() => git(bare, 'rev-parse', 'refs/heads/feedback/5')).toThrow();
  });

  it('does not disturb the working tree it ran in', async () => {
    const { work, base } = await makeRepo();
    const patch = diffFor('limit = 10', 'limit = 25');
    const approval = approvalFor('5', base, patch);
    const before = git(work, 'rev-parse', 'HEAD');
    await submitPatch({
      feedbackId: '5', patch, approval, signature: signApproval(approval, priv),
      message: 'fix: x', repoDir: work, publicKeyPem: pub,
    });
    expect(git(work, 'rev-parse', 'HEAD')).toBe(before);
    expect(git(work, 'status', '--porcelain')).toBe('');
    expect(await readFile(join(work, 'app.txt'), 'utf8')).toBe('limit = 10\n');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd /var/home/jason/Projects/RepOS/api && npx vitest run tests/reposGit/submit-patch.test.ts`
Expected: FAIL — cannot resolve `submitPatch.js`.

- [ ] **Step 3: Write `submitPatch.ts`**

```ts
// The write side of the privilege boundary.
//
// This module holds a credential and no judgement: it pushes whatever carries
// a valid approval. Everything it refuses, it refuses structurally — a derived
// branch name, a verified signature, a matching digest, a pinned base, and a
// push that can only fast-forward.
//
// It must NOT import the database or the mailer. Plan 3 runs it as a separate
// OS principal; tests/reposGit/boundaries.test.ts enforces that today.
import { spawn } from 'node:child_process';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  verifyApproval,
  patchDigest,
  ApprovalError,
  type Approval,
} from '../services/patchApproval.js';

const SHA_RE = /^[0-9a-f]{40}$/;

export type RepoGitErrorCode =
  | 'bad_feedback_id'
  | 'id_mismatch'
  | 'digest_mismatch'
  | 'bad_signature'
  | 'expired'
  | 'malformed'
  | 'unknown_base'
  | 'apply_failed'
  | 'push_failed';

export class RepoGitError extends Error {
  readonly code: RepoGitErrorCode;
  readonly detail?: string;
  constructor(code: RepoGitErrorCode, message: string, detail?: string) {
    super(message);
    this.name = 'RepoGitError';
    this.code = code;
    this.detail = detail;
  }
}

/**
 * Applied to EVERY git invocation.
 *
 * Hooks in $GIT_DIR/hooks and repo-local config (core.sshCommand, core.pager,
 * core.fsmonitor, filter.*.clean) execute as the invoking user. This process
 * holds a write credential, so any of them would be arbitrary code execution
 * with it. The environment additions in `gitEnv` cover the rest.
 */
export const GIT_HARDENING: readonly string[] = ['-c', 'core.hooksPath=/dev/null'];

function gitEnv(): NodeJS.ProcessEnv {
  return {
    ...process.env,
    GIT_CONFIG_NOSYSTEM: '1',
    GIT_CONFIG_GLOBAL: '/dev/null',
    GIT_TERMINAL_PROMPT: '0',
    GIT_ASKPASS: '/bin/true',
  };
}

type GitSpy = (argv: string[]) => void;

function runGit(
  args: string[],
  cwd: string,
  opts: { input?: string; spy?: GitSpy } = {},
): Promise<{ code: number; stdout: string; stderr: string }> {
  const argv = [...GIT_HARDENING, ...args];
  opts.spy?.(argv);
  return new Promise((resolve, reject) => {
    const child = spawn('git', argv, {
      cwd,
      env: gitEnv(),
      stdio: [opts.input === undefined ? 'ignore' : 'pipe', 'pipe', 'pipe'],
    });
    let stdout = '';
    let stderr = '';
    child.stdout.setEncoding('utf8');
    child.stderr.setEncoding('utf8');
    child.stdout.on('data', (c: string) => { stdout += c; });
    child.stderr.on('data', (c: string) => { stderr += c; });
    child.on('error', reject);
    child.on('close', (code) => resolve({ code: code ?? 1, stdout, stderr }));
    if (opts.input !== undefined) {
      child.stdin.end(opts.input, 'utf8');
    }
  });
}

export interface SubmitPatchInput {
  feedbackId: string;
  patch: string;
  approval: Approval;
  signature: string;
  message: string;
  repoDir: string;
  publicKeyPem: string;
  remote?: string;
}

export interface SubmitPatchResult {
  branch: string;
  headSha: string;
  replaced: boolean;
}

export async function submitPatch(input: SubmitPatchInput): Promise<SubmitPatchResult> {
  const spy = (input as unknown as { __onGit?: GitSpy }).__onGit;

  // The branch is DERIVED, never accepted. This module has no database, so the
  // id is the only fact it has — and an accepted branch name is a way to push
  // to main.
  if (!/^[1-9][0-9]{0,18}$/.test(input.feedbackId)) {
    throw new RepoGitError('bad_feedback_id', `not a plain positive integer: ${input.feedbackId}`);
  }
  const branch = `feedback/${input.feedbackId}`;
  const remote = input.remote ?? 'origin';

  if (input.approval.feedbackId !== input.feedbackId) {
    throw new RepoGitError(
      'id_mismatch',
      `approval is for ${input.approval.feedbackId}, not ${input.feedbackId}`,
    );
  }
  if (patchDigest(input.patch) !== input.approval.patchDigest) {
    throw new RepoGitError('digest_mismatch', 'patch does not match the approved digest');
  }
  try {
    verifyApproval(input.approval, input.signature, input.publicKeyPem);
  } catch (err) {
    if (err instanceof ApprovalError) {
      throw new RepoGitError(err.code as RepoGitErrorCode, err.message);
    }
    throw err;
  }

  const base = input.approval.baseSha;
  if (!SHA_RE.test(base)) throw new RepoGitError('malformed', `base sha is not 40-hex: ${base}`);
  if ((await runGit(['cat-file', '-e', `${base}^{commit}`], input.repoDir, { spy })).code !== 0) {
    throw new RepoGitError('unknown_base', `repository has no commit ${base}`);
  }

  // Is there already a branch to build on? Its tip becomes the parent, so the
  // push fast-forwards and nothing already pushed is rewritten.
  const tip = await runGit(['rev-parse', '--verify', `${remote}/${branch}`], input.repoDir, { spy });
  const existingTip = tip.code === 0 ? tip.stdout.trim() : null;
  const replaced = existingTip !== null;

  // A scratch index and work tree: the caller's checkout is never touched.
  const scratch = await mkdtemp(join(tmpdir(), 'repos-git-'));
  const indexFile = join(scratch, 'index');
  const patchFile = join(scratch, 'patch.diff');
  await writeFile(patchFile, input.patch, 'utf8');

  try {
    const scoped = (args: string[], extra: Record<string, string> = {}) =>
      runGitScoped(args, input.repoDir, indexFile, scratch, extra, spy);

    // Seed the index from the pinned base, then apply the patch to the index
    // and a scratch work tree.
    let r = await scoped(['read-tree', base]);
    if (r.code !== 0) throw new RepoGitError('apply_failed', 'could not read the base tree', r.stderr);

    r = await scoped(['checkout-index', '-a', '-f']);
    if (r.code !== 0) throw new RepoGitError('apply_failed', 'could not materialise the base', r.stderr);

    r = await scoped(['apply', '--index', '--whitespace=nowarn', patchFile]);
    if (r.code !== 0) {
      throw new RepoGitError('apply_failed', 'the patch does not apply to the pinned base', r.stderr);
    }

    r = await scoped(['write-tree']);
    if (r.code !== 0) throw new RepoGitError('apply_failed', 'could not write the tree', r.stderr);
    const tree = r.stdout.trim();

    const parents = existingTip ? ['-p', existingTip] : ['-p', base];
    r = await scoped(['commit-tree', tree, ...parents, '-m', input.message], {
      GIT_AUTHOR_NAME: 'RepOS feedback agent',
      GIT_AUTHOR_EMAIL: 'feedback-agent@users.noreply.github.com',
      GIT_COMMITTER_NAME: 'RepOS feedback agent',
      GIT_COMMITTER_EMAIL: 'feedback-agent@users.noreply.github.com',
    });
    if (r.code !== 0) throw new RepoGitError('apply_failed', 'could not commit', r.stderr);
    const headSha = r.stdout.trim();
    if (!SHA_RE.test(headSha)) {
      throw new RepoGitError('apply_failed', `commit-tree returned ${headSha}`);
    }

    // No leading '+', no --force: this refspec can only fast-forward.
    const push = await runGit(
      ['push', remote, `${headSha}:refs/heads/${branch}`],
      input.repoDir,
      { spy },
    );
    if (push.code !== 0) {
      throw new RepoGitError('push_failed', `push to ${branch} was refused`, push.stderr);
    }

    return { branch, headSha, replaced };
  } finally {
    await rm(scratch, { recursive: true, force: true });
  }
}

function runGitScoped(
  args: string[],
  repoDir: string,
  indexFile: string,
  workTree: string,
  extraEnv: Record<string, string>,
  spy?: GitSpy,
): Promise<{ code: number; stdout: string; stderr: string }> {
  const argv = [...GIT_HARDENING, ...args];
  spy?.(argv);
  return new Promise((resolve, reject) => {
    const child = spawn('git', argv, {
      cwd: repoDir,
      env: { ...gitEnv(), GIT_INDEX_FILE: indexFile, GIT_WORK_TREE: workTree, ...extraEnv },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let stdout = '';
    let stderr = '';
    child.stdout.setEncoding('utf8');
    child.stderr.setEncoding('utf8');
    child.stdout.on('data', (c: string) => { stdout += c; });
    child.stderr.on('data', (c: string) => { stderr += c; });
    child.on('error', reject);
    child.on('close', (code) => resolve({ code: code ?? 1, stdout, stderr }));
  });
}
```

Note `runGit(['rev-parse', '--verify', `${remote}/${branch}`])` reads the remote-tracking ref. Add a fetch of that ref before it so a second submit in a fresh process still sees the existing tip:

```ts
  await runGit(['fetch', '--quiet', remote, `refs/heads/${branch}:refs/remotes/${remote}/${branch}`],
    input.repoDir, { spy });
```
Place it immediately before the `tip` lookup. A missing remote branch makes this exit non-zero, which is fine and deliberately unchecked.

- [ ] **Step 4: Run the submit-patch tests**

Run: `cd /var/home/jason/Projects/RepOS/api && npx vitest run tests/reposGit/submit-patch.test.ts`
Expected: PASS — 13 tests.

- [ ] **Step 5: Mutation-check the derived branch name**

Temporarily change the branch line to `const branch = (input as any).branch ?? \`feedback/${input.feedbackId}\`;`.

Run: `npx vitest run tests/reposGit/submit-patch.test.ts`
Expected: FAIL — "derives the branch name and ignores any caller-supplied one". That test is the one standing between a compromised broker and a push to `main`.

Revert and re-run. Expected: PASS.

- [ ] **Step 6: Mutation-check the fast-forward property**

Temporarily change the push refspec to `+${headSha}:refs/heads/${branch}` and the parents to `['-p', base]` unconditionally.

Run: `npx vitest run tests/reposGit/submit-patch.test.ts`
Expected: FAIL — "never force-pushes" and "a revision fast-forwards".

Revert and re-run. Expected: PASS.

- [ ] **Step 7: Write the failing test for `openPr`**

Create `api/tests/reposGit/open-pr.test.ts`:

```ts
import { describe, it, expect, afterEach, vi } from 'vitest';
import { openPr, __setPrFetchForTesting } from '../../src/reposGit/openPr.js';

const saved = process.env.FEEDBACK_GITHUB_TOKEN;

afterEach(() => {
  __setPrFetchForTesting(null);
  if (saved === undefined) delete process.env.FEEDBACK_GITHUB_TOKEN;
  else process.env.FEEDBACK_GITHUB_TOKEN = saved;
});

const created = () =>
  new Response(JSON.stringify({ number: 93, html_url: 'https://github.com/x/y/pull/93' }), {
    status: 201, headers: { 'content-type': 'application/json' },
  });

describe('openPr', () => {
  it('opens a PR from the derived branch into main', async () => {
    process.env.FEEDBACK_GITHUB_TOKEN = 'ghp_test';
    let body: Record<string, unknown> = {};
    __setPrFetchForTesting(vi.fn(async (_u, init) => {
      body = JSON.parse(String((init as RequestInit).body));
      return created();
    }));
    const res = await openPr({ feedbackId: '5', title: 'fix: programs page', body: 'closes it' });
    expect(res).toEqual({ number: 93, url: 'https://github.com/x/y/pull/93' });
    expect(body).toMatchObject({ head: 'feedback/5', base: 'main' });
  });

  it('never targets a base other than main', async () => {
    process.env.FEEDBACK_GITHUB_TOKEN = 'ghp_test';
    let body: Record<string, unknown> = {};
    __setPrFetchForTesting(vi.fn(async (_u, init) => {
      body = JSON.parse(String((init as RequestInit).body));
      return created();
    }));
    // @ts-expect-error baseBranch is accepted but constrained
    await openPr({ feedbackId: '5', title: 't', body: 'b', baseBranch: 'production' });
    expect(body.base).toBe('main');
  });

  it('refuses a feedback id that is not a plain integer', async () => {
    process.env.FEEDBACK_GITHUB_TOKEN = 'ghp_test';
    const spy = vi.fn(async () => created());
    __setPrFetchForTesting(spy);
    await expect(openPr({ feedbackId: '../main', title: 't', body: 'b' })).rejects.toMatchObject({
      code: 'bad_feedback_id',
    });
    expect(spy).not.toHaveBeenCalled();
  });

  it('refuses when no token is configured', async () => {
    delete process.env.FEEDBACK_GITHUB_TOKEN;
    const spy = vi.fn(async () => created());
    __setPrFetchForTesting(spy);
    await expect(openPr({ feedbackId: '5', title: 't', body: 'b' })).rejects.toMatchObject({
      code: 'not_configured',
    });
    expect(spy).not.toHaveBeenCalled();
  });

  it('surfaces a rejected create as pr_failed without leaking the token', async () => {
    process.env.FEEDBACK_GITHUB_TOKEN = 'ghp_supersecret';
    __setPrFetchForTesting(vi.fn(async () => new Response('{"message":"nope"}', { status: 422 })));
    const err = await openPr({ feedbackId: '5', title: 't', body: 'b' }).catch((e) => e);
    expect(err).toMatchObject({ code: 'pr_failed' });
    expect(JSON.stringify(err.message) + String(err.detail)).not.toContain('ghp_supersecret');
  });
});
```

- [ ] **Step 8: Write `openPr.ts`**

```ts
// Opening the PR. The only place the write token is used over HTTP.
//
// Like submitPatch, the head branch is derived from the id and the base is
// pinned to main — a caller cannot redirect either.
import { RepoGitError } from './submitPatch.js';

const API = 'https://api.github.com';
const TIMEOUT_MS = 15_000;
const BASE_BRANCH = 'main';

let fetchOverride: typeof fetch | null = null;

export function __setPrFetchForTesting(f: typeof fetch | null): void {
  fetchOverride = f;
}

export interface OpenPrInput {
  feedbackId: string;
  title: string;
  body: string;
  /** Accepted for signature stability and deliberately ignored — see BASE_BRANCH. */
  baseBranch?: string;
}

export async function openPr(input: OpenPrInput): Promise<{ number: number; url: string }> {
  if (!/^[1-9][0-9]{0,18}$/.test(input.feedbackId)) {
    throw new RepoGitError('bad_feedback_id', `not a plain positive integer: ${input.feedbackId}`);
  }
  const token = process.env.FEEDBACK_GITHUB_TOKEN;
  if (!token) {
    throw new RepoGitError(
      'not_configured' as never,
      'FEEDBACK_GITHUB_TOKEN is not set',
    );
  }
  const repo = process.env.FEEDBACK_GITHUB_REPO ?? 'otahesh/RepOS';

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  let res: Response;
  try {
    res = await (fetchOverride ?? fetch)(`${API}/repos/${repo}/pulls`, {
      method: 'POST',
      headers: {
        accept: 'application/vnd.github+json',
        'x-github-api-version': '2022-11-28',
        'user-agent': 'repos-feedback-triage',
        authorization: `Bearer ${token}`,
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        title: input.title,
        body: input.body,
        head: `feedback/${input.feedbackId}`,
        base: BASE_BRANCH,
      }),
      signal: controller.signal,
    });
  } catch (err) {
    throw new RepoGitError('push_failed', 'the pull request request failed', String(err));
  } finally {
    clearTimeout(timer);
  }

  if (!res.ok) {
    // The body is echoed, the token never is.
    const detail = (await res.text().catch(() => '')).slice(0, 300);
    throw new RepoGitError('pr_failed' as never, `github refused the pull request: ${res.status}`, detail);
  }

  const body = (await res.json()) as { number?: number; html_url?: string };
  if (typeof body.number !== 'number' || typeof body.html_url !== 'string') {
    throw new RepoGitError('pr_failed' as never, 'github returned an unexpected pull request shape');
  }
  return { number: body.number, url: body.html_url };
}
```

Add `'not_configured'` and `'pr_failed'` to `RepoGitErrorCode` in `submitPatch.ts` and drop the two `as never` casts.

- [ ] **Step 9: Write `index.ts`**

```ts
// The repos-git surface. Plan 3 puts a socket in front of exactly these two.
export {
  submitPatch,
  RepoGitError,
  GIT_HARDENING,
  type SubmitPatchInput,
  type SubmitPatchResult,
  type RepoGitErrorCode,
} from './submitPatch.js';
export { openPr, __setPrFetchForTesting, type OpenPrInput } from './openPr.js';
```

- [ ] **Step 10: Run both suites**

Run: `cd /var/home/jason/Projects/RepOS/api && npx vitest run tests/reposGit/`
Expected: PASS — 18 tests.

- [ ] **Step 11: Commit**

```bash
cd /var/home/jason/Projects/RepOS
git add api/src/reposGit api/tests/reposGit
git commit -m "feat(feedback): repos-git submit-patch and open-pr"
```

---

### Task 8: Import boundaries, CLI wiring, and the full gate

**Files:**
- Create: `api/tests/reposGit/boundaries.test.ts`
- Modify: `api/src/services/feedbackTriage-cli.ts`
- Modify: `api/.env.example`
- Modify: `docs/superpowers/specs/2026-08-10-feedback-triage-agent-design.md` (status note only)

**Interfaces:**
- Consumes: everything from Tasks 1–7.
- Produces: CLI verbs `check-shipped`, `reconcile`, `link`, `approve-patch`, `submit-patch`, `open-pr`.

**Why the boundary test exists now.** Plan 3 splits these into two OS principals. If the import graph tangles before then, the split becomes a refactor instead of a packaging step. A test is cheaper than the refactor.

- [ ] **Step 1: Write the boundary test**

Create `api/tests/reposGit/boundaries.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { readFile, readdir } from 'node:fs/promises';
import { join } from 'node:path';

const SRC = new URL('../../src/', import.meta.url).pathname;

async function sourcesIn(dir: string): Promise<Array<{ path: string; text: string }>> {
  const out: Array<{ path: string; text: string }> = [];
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) out.push(...(await sourcesIn(full)));
    else if (entry.name.endsWith('.ts')) out.push({ path: full, text: await readFile(full, 'utf8') });
  }
  return out;
}

describe('privilege boundaries', () => {
  it('repos-git reaches neither the database nor the mailer', async () => {
    // Plan 3 runs this as a separate OS principal holding the GitHub token.
    // A tangled import graph turns that split into a refactor.
    for (const f of await sourcesIn(join(SRC, 'reposGit'))) {
      expect(f.text, f.path).not.toMatch(/from '.*db\/client\.js'/);
      expect(f.text, f.path).not.toMatch(/from '.*feedbackMailer\.js'/);
      expect(f.text, f.path).not.toMatch(/from '.*feedbackEmails\.js'/);
    }
  });

  it('no broker-side service reads the GitHub write token', async () => {
    const brokerSide = (await sourcesIn(join(SRC, 'services'))).filter(
      (f) => !f.path.endsWith('-cli.ts'),
    );
    for (const f of brokerSide) {
      expect(f.text, f.path).not.toContain('FEEDBACK_GITHUB_TOKEN');
    }
  });

  it('nothing outside reposGit invokes git push', async () => {
    for (const f of await sourcesIn(SRC)) {
      if (f.path.includes('/reposGit/')) continue;
      expect(f.text, f.path).not.toMatch(/'push'/);
    }
  });

  it('no service builds a shell command string for a subprocess', async () => {
    // The 2026-09-04 hardening: argv arrays only.
    for (const f of await sourcesIn(SRC)) {
      expect(f.text, f.path).not.toMatch(/spawn\(\s*'(?:ba)?sh'/);
      expect(f.text, f.path).not.toMatch(/\bexec\(\s*`/);
      expect(f.text, f.path).not.toMatch(/shell:\s*true/);
    }
  });
});
```

- [ ] **Step 2: Run it**

Run: `cd /var/home/jason/Projects/RepOS/api && npx vitest run tests/reposGit/boundaries.test.ts`
Expected: PASS — 4 tests. If any fails, fix the import, not the test.

- [ ] **Step 3: Add the CLI verbs**

In `api/src/services/feedbackTriage-cli.ts`, extend the usage text and the `switch`. Keep the file's existing pattern: static `import type` only, `await import()` for values.

```ts
    case 'check-shipped': {
      const { checkShipped } = await import('./checkShipped.js');
      const dryRun = args.includes('--dry-run');
      const res = await checkShipped({ dryRun });
      console.log(
        `deployed=${res.deployedSha ?? 'unreadable'} considered=${res.considered} ` +
          `shipped=${res.shipped} emailed=${res.emailed} skipped=${res.skipped}` +
          (dryRun ? ' (dry run — nothing sent)' : ''),
      );
      break;
    }

    case 'reconcile': {
      const { reconcileFixes } = await import('./reconcileFixes.js');
      const res = await reconcileFixes();
      console.log(
        `examined=${res.examined} changed=${res.changed} unchanged=${res.unchanged} errored=${res.errored}`,
      );
      break;
    }

    case 'link': {
      const id = requireArg(args[0], 'link <feedback-id> <sha>');
      const sha = requireArg(args[1], 'link <feedback-id> <sha>');
      const { link } = await import('./fixLifecycle.js');
      await link(id, sha);
      console.log(`linked ${id} -> ${sha} (merged)`);
      break;
    }

    case 'approve-patch': {
      // Reads the patch from stdin so it never appears in argv or shell history.
      const id = requireArg(args[0], 'approve-patch <feedback-id> <base-sha> < patch.diff');
      const baseSha = requireArg(args[1], 'approve-patch <feedback-id> <base-sha> < patch.diff');
      const keyPath = process.env.FEEDBACK_APPROVAL_KEY;
      if (!keyPath) throw new Error('FEEDBACK_APPROVAL_KEY (path to the Ed25519 private key) is not set');
      const { readFile } = await import('node:fs/promises');
      const { patchDigest, scanPatch, signApproval } = await import('./patchApproval.js');
      const patch = await readStdin();
      const reasons = scanPatch(patch);
      if (reasons.length > 0) {
        console.error('refused — the patch must not be pushed:');
        for (const r of reasons) console.error(`  - ${r}`);
        process.exitCode = 2;
        break;
      }
      const ttl = Number(process.env.FEEDBACK_APPROVAL_TTL_SECONDS ?? 900);
      const approval = {
        feedbackId: id,
        baseSha,
        patchDigest: patchDigest(patch),
        expiry: Math.floor(Date.now() / 1000) + ttl,
      };
      const signature = signApproval(approval, await readFile(keyPath, 'utf8'));
      console.log(JSON.stringify({ approval, signature }));
      break;
    }

    case 'submit-patch': {
      // Consumes the JSON from approve-patch on stdin, with the patch at $1.
      const patchPath = requireArg(args[0], 'submit-patch <patch-file> < approval.json');
      const { readFile } = await import('node:fs/promises');
      const { submitPatch } = await import('../reposGit/index.js');
      const keyPath = process.env.FEEDBACK_APPROVAL_PUBKEY;
      if (!keyPath) throw new Error('FEEDBACK_APPROVAL_PUBKEY is not set');
      const { approval, signature } = JSON.parse(await readStdin()) as {
        approval: { feedbackId: string; baseSha: string; patchDigest: string; expiry: number };
        signature: string;
      };
      const patch = await readFile(patchPath, 'utf8');
      const res = await submitPatch({
        feedbackId: approval.feedbackId,
        patch,
        approval,
        signature,
        message: process.env.FEEDBACK_COMMIT_MESSAGE ?? `fix: feedback ${approval.feedbackId}`,
        repoDir: process.env.FEEDBACK_REPO_DIR ?? process.cwd(),
        publicKeyPem: await readFile(keyPath, 'utf8'),
      });
      console.log(`pushed ${res.branch} @ ${res.headSha}${res.replaced ? ' (revision)' : ''}`);
      console.log('run `npm run feedback reconcile` to record the state');
      break;
    }

    case 'open-pr': {
      const id = requireArg(args[0], 'open-pr <feedback-id> <title>');
      const title = requireArg(args[1], 'open-pr <feedback-id> <title>');
      const { openPr } = await import('../reposGit/index.js');
      const res = await openPr({
        feedbackId: id,
        title,
        body: `Fixes feedback item ${id}.\n\nOpened by the RepOS feedback triage tooling.`,
      });
      console.log(`opened #${res.number} — ${res.url}`);
      console.log('run `npm run feedback reconcile` to record the state');
      break;
    }
```

Add the two helpers near the file's existing helpers:

```ts
function requireArg(v: string | undefined, usage: string): string {
  if (!v) throw new Error(`usage: ${usage}`);
  return v;
}

async function readStdin(): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const c of process.stdin) chunks.push(Buffer.from(c));
  return Buffer.concat(chunks).toString('utf8');
}
```

Both CLI paths print the reconcile reminder rather than writing state themselves — Global Constraints, `reconcile-fixes` is the sole writer.

- [ ] **Step 4: Document the new environment variables**

Append to `api/.env.example`:

```
# Feedback triage — ship detection (Plan 2)
# Where to ask what production is actually running.
UNRAID_SSH_HOST=
UNRAID_SSH_USER=root

# Feedback triage — the fix lifecycle (Plan 2)
FEEDBACK_GITHUB_REPO=otahesh/RepOS
# Write token, used ONLY by repos-git (open-pr). Broker-side code must not read it.
FEEDBACK_GITHUB_TOKEN=
# Ed25519 keypair for patch approval. The private key signs; repos-git holds only the public half.
FEEDBACK_APPROVAL_KEY=
FEEDBACK_APPROVAL_PUBKEY=
FEEDBACK_APPROVAL_TTL_SECONDS=900
# The clone submit-patch applies patches in. Never the live working tree.
FEEDBACK_REPO_DIR=
```

- [ ] **Step 5: Typecheck, lint, and run the full suite**

```bash
cd /var/home/jason/Projects/RepOS/api
npx tsc --noEmit
npm run lint
npm test
```
Expected: typecheck clean, lint clean, and the suite green **except** `tests/backups-create.test.ts`, which fails at merge-base `30fee9f` too and is unrelated to this work. If any other test fails, it is this plan's regression — fix it before continuing.

- [ ] **Step 6: Exercise the CLI against a real database**

Typecheck does not prove a CLI runs. Do this end to end:

```bash
cd /var/home/jason/Projects/RepOS/api
npm run build

# A throwaway approval keypair.
openssl genpkey -algorithm ed25519 -out /tmp/fb-approval.pem
openssl pkey -in /tmp/fb-approval.pem -pubout -out /tmp/fb-approval.pub

ID=$(psql "$DATABASE_URL" -Atc \
  "INSERT INTO feedback (body, user_email_at_submit) VALUES ('cli smoke','you@example.test') RETURNING id" | head -1)
echo "id=$ID"

npm run feedback -- triage "$ID" bug p3 "smoke test"
npm run feedback -- link "$ID" "$(git -C /var/home/jason/Projects/RepOS rev-parse HEAD)"
npm run feedback -- check-shipped --dry-run
npm run feedback -- reconcile

BASE=$(git -C /var/home/jason/Projects/RepOS rev-parse HEAD)
printf 'diff --git a/README.md b/README.md\n' > /tmp/fb.diff
FEEDBACK_APPROVAL_KEY=/tmp/fb-approval.pem \
  npm run feedback -- approve-patch "$ID" "$BASE" < /tmp/fb.diff

# The privacy scan must refuse this one.
printf 'diff --git a/x b/x\n+API_KEY=abcdefghijklmno\n' > /tmp/fb-bad.diff
FEEDBACK_APPROVAL_KEY=/tmp/fb-approval.pem \
  npm run feedback -- approve-patch "$ID" "$BASE" < /tmp/fb-bad.diff; echo "exit=$?"

psql "$DATABASE_URL" -c "DELETE FROM feedback WHERE id = $ID"
rm -f /tmp/fb-approval.pem /tmp/fb-approval.pub /tmp/fb.diff /tmp/fb-bad.diff
```

Note the `| head -1` on the `psql` insert — without it the `INSERT 0 1` status line is appended to `$ID` and every later command gets a non-numeric id.

Expected: `check-shipped --dry-run` reports `deployed=unreadable` locally (no SSH host set) and sends nothing; `reconcile` reports counts without error; the clean `approve-patch` prints a JSON approval; the dirty one prints `added line contains an assigned secret` and exits 2.

- [ ] **Step 7: Note the spec status**

In `docs/superpowers/specs/2026-08-10-feedback-triage-agent-design.md`, under the components table, add one line:

```markdown
> **Implementation status (2026-09-05):** Plan 1 (`502e96d`) shipped triage, the email ledger and delivery. Plan 2 shipped `check-shipped`, `reconcile-fixes`, the fix lifecycle verbs, patch approval and `repos-git` as tested library functions plus operator CLI verbs. The broker daemon, the socket boundary and the two OS principals are Plan 3 — until then these verbs run at operator trust level, not agent trust level.
```

- [ ] **Step 8: Commit**

```bash
cd /var/home/jason/Projects/RepOS
git add api/src/services/feedbackTriage-cli.ts api/tests/reposGit/boundaries.test.ts \
        api/.env.example docs/superpowers/specs/2026-08-10-feedback-triage-agent-design.md
git commit -m "feat(feedback): CLI verbs for the fix lifecycle and the boundary test"
```

---

## What this plan deliberately does not build

Named so a reviewer can see they are choices, not oversights.

- **The broker daemon, the socket, and the three OS accounts.** Plan 3. Until then these verbs run at operator trust level: whoever can run `npm run feedback` can already run `psql`, so the CLI grants nothing new. That stops being true the moment an agent can call them, which is exactly the boundary Plan 3 builds.
- **Automatic patch generation.** Nothing here writes a diff. `approve-patch` signs a patch a human produced. The agent authoring patches is a Plan 3 capability and wants its own review.
- **A worktree pool.** `submitPatch` applies to a scratch index against a pinned base, which gives isolation without managing worktree lifetime. If concurrent submits ever become real, the spec's worktree design is still the right answer.
- **Rate limiting on `open-pr`.** One PR per feedback item per sweep, with `reconcile` observing the result, bounds this in practice. A real limiter belongs with the daemon.
- **Dead-letter alert batching.** Still unbounded, inherited from Plan 1 and still a deliberate follow-up.

## Self-Review

**1. Spec coverage.** Every Plan-2 requirement maps to a task: `check-shipped` (Tasks 3–4), the fix lifecycle verbs (Tasks 2, 5, 8), `repos-git` (Task 7), patch approval signing (Task 6), `reconcile-fixes` (Task 5), and the `resolved` email the spec's two-emails-max rule requires (Task 1). Not covered, and deferred on purpose above: the socket boundary, worktree isolation, and agent-authored patches — all Plan 3.

**2. Placeholders.** None. Every code step carries real code, every test step real assertions, and every run step an exact command with an expected result.

**3. Type consistency.** `SHA_RE` is defined once in `fixLifecycle.ts` and imported by `checkShipped.ts`, `reconcileFixes.ts` and `patchApproval.ts`; `reposGit/submitPatch.ts` declares its own copy on purpose, because it may not import a service that imports the database. `FixStatus` comes from `feedbackTriage.ts` throughout. `Approval` is defined in `patchApproval.ts` and consumed by `submitPatch`. `RepoGitErrorCode` gains `'not_configured'` and `'pr_failed'` in Task 7 Step 8. `sendResolvedEmail` is added in Task 1 and called only from `checkShipped.ts`.

**One consistency note for the executor:** Task 7 Step 3 writes `openPr.ts` importing `RepoGitError` from `submitPatch.js`, and Step 8 widens `RepoGitErrorCode`. Do those in that order or the file will not typecheck between steps.
