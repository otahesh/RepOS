// Q7, Q8, Q12, Q17, Q18, Q27, Q29, Q30 — the invite path.
//
// Ephemeral DB: the cohort cap counts every row in `users`, so this suite
// cannot share the dev database with other test files.
import 'dotenv/config';
import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest';
import { randomUUID } from 'node:crypto';
import { createEphemeralDb } from '../helpers/ephemeral-db.js';
import { runMigrations } from '../../src/db/runMigrations.js';
import pg from 'pg';

const eph = await createEphemeralDb('invite');
{
  const bootstrap = new pg.Pool({ connectionString: eph.url, max: 2 });
  await runMigrations(bootstrap);
  await bootstrap.end();
}
process.env.DATABASE_URL = eph.url;

const { buildApp } = await import('../../src/app.js');
const { db } = await import('../../src/db/client.js');
const policy = await import('../../src/services/cfAccessPolicy.js');
const mailer = await import('../../src/services/inviteMailer.js');
const { initialIdempotencyKey, SUPPORT_CONTACT } = mailer;
const { humanActor, systemActor } = await import('../../src/services/accountEvents.js');
const { withMembershipLock } = await import('../../src/services/membershipLock.js');
const { setupTestJwks } = await import('../helpers/cf-access-jwt.js');

let app: Awaited<ReturnType<typeof buildApp>>;
let jwks: Awaited<ReturnType<typeof setupTestJwks>>;
const ADMIN = 'admin.invite@repos.test';
let adminId: string;

let policyEmails: string[];
let fetchPolicyImpl: () => Promise<unknown>;
let sentMail: Array<{
  request: { to: string[]; from: string; html: string; text: string };
  idempotencyKey: string;
}>;
let mailImpl: () => Promise<{ messageId: string }>;

// Two env vars this suite cannot run without, neither of which is in api/.env:
//
//   PUBLIC_ORIGIN — csrfOrigin fails CLOSED when it is unset (403
//     csrf_origin_misconfigured) and it does that BEFORE looking at the
//     X-RepOS-CSRF header, so every request below would 403 for a reason that
//     has nothing to do with the invite path.
//   INVITE_FROM_EMAIL — buildInviteRequest throws mail_not_configured without
//     it, so every happy path would report invite_sent:false. The
//     missing-from case deletes it deliberately and restores it.
const savedEnv: Record<string, string | undefined> = {};
function setEnv(key: string, value: string): void {
  savedEnv[key] = process.env[key];
  process.env[key] = value;
}

beforeAll(async () => {
  setEnv('PUBLIC_ORIGIN', 'https://repos.invite.test');
  setEnv('INVITE_FROM_EMAIL', 'repos@send.jpmtech.com');
  jwks = await setupTestJwks();
  app = await buildApp();
  const { rows } = await db.query<{ id: string }>(
    `INSERT INTO users (email, role, status) VALUES ($1,'admin','active') RETURNING id`,
    [ADMIN],
  );
  adminId = rows[0].id;
});

afterAll(async () => {
  await app.close();
  await jwks.teardown();
  await db.end();
  await eph.drop();
  for (const [k, v] of Object.entries(savedEnv)) {
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
});

beforeEach(() => {
  vi.restoreAllMocks();
  policyEmails = [ADMIN];
  fetchPolicyImpl = async () => ({
    emails: [...policyEmails],
    name: 'Owner Only',
    decision: 'allow',
    config: {
      name: 'Owner Only',
      decision: 'allow',
      include: policyEmails.map((e) => ({ email: { email: e } })),
      exclude: [],
      require: [],
    },
  });
  vi.spyOn(policy, 'fetchPolicy').mockImplementation(() => fetchPolicyImpl() as never);
  vi.spyOn(policy, 'putPolicyEmails').mockImplementation(async (emails: string[]) => {
    policyEmails = [...emails];
  });
  sentMail = [];
  mailImpl = async () => ({ messageId: 'msg_x' });
  vi.spyOn(mailer, 'sendInviteRequest').mockImplementation(
    async (request: never, idempotencyKey: never, _expectedTo: never) => {
      sentMail.push({
        request: request as unknown as { to: string[]; from: string; html: string; text: string },
        idempotencyKey: idempotencyKey as unknown as string,
      });
      return mailImpl();
    },
  );
});

async function invite(email: string, role: 'member' | 'admin' = 'member') {
  return app.inject({
    method: 'POST',
    url: '/api/admin/users/invite',
    headers: {
      'cf-access-jwt-assertion': await jwks.mintJwt(ADMIN),
      'x-repos-csrf': '1',
    },
    payload: { email, role },
  });
}

function freshEmail(tag: string) {
  return `inv-${tag}-${randomUUID().slice(0, 8)}@repos.test`;
}

async function seed(
  email: string,
  status: string,
  cfSynced: Date | null,
  sentAt: Date | null = null,
  // Defaults to ADMIN because the real INSERT always stamps invited_by. The
  // replayed sender does NOT come from this column, though — it comes from the
  // audit snapshot written below.
  invitedBy: string | null = adminId,
  // Every real `invited` row carries exactly one user_invited or user_imported
  // event, committed with the row (Q27), and originalSender() FAILS CLOSED
  // without one. Seeding it here is therefore not incidental setup — a fixture
  // missing it does not model any state the system can actually produce. A
  // string writes the human shape naming that address; null writes the Q31b
  // system-actor import shape.
  inviterEmail: string | null = ADMIN,
) {
  const { rows } = await db.query<{ id: string }>(
    `INSERT INTO users (email, status, cf_synced_at, invited_at, invite_sent_at, invited_by)
     VALUES ($1,$2,$3, now(), $4, $5) RETURNING id`,
    [email, status, cfSynced, sentAt, invitedBy],
  );
  const id = rows[0].id;
  await db.query(
    `INSERT INTO account_events (user_id, user_email_at_event, kind, meta)
     VALUES ($1,$2,$3,$4::jsonb)`,
    inviterEmail === null
      ? [id, email, 'user_imported', JSON.stringify(systemActor('cf_reconciliation', 'cutover'))]
      : [id, email, 'user_invited', JSON.stringify(humanActor(invitedBy ?? adminId, inviterEmail))],
  );
  return id;
}

describe('POST /api/admin/users/invite — happy path', () => {
  it('creates an invited row, syncs CF, stamps, and mails — in that order', async () => {
    const email = freshEmail('ok');
    const r = await invite(email);
    expect(r.statusCode).toBe(201);
    const body = r.json<{ id: string; status: string; cf_synced: boolean; invite_sent: boolean }>();
    expect(body.status).toBe('invited');
    expect(body.cf_synced).toBe(true);
    expect(body.invite_sent).toBe(true);

    const { rows } = await db.query<{
      status: string;
      cf_synced_at: Date | null;
      invited_by: string;
      invite_sent_at: Date | null;
      invite_message_id: string | null;
      invited_at: Date;
    }>(
      `SELECT status, cf_synced_at, invited_by, invite_sent_at, invite_message_id, invited_at
         FROM users WHERE id=$1`,
      [body.id],
    );
    expect(rows[0].status).toBe('invited');
    expect(rows[0].cf_synced_at).not.toBeNull();
    expect(rows[0].invited_by).toBe(adminId);
    expect(rows[0].invite_sent_at).not.toBeNull();
    expect(rows[0].invite_message_id).toBe('msg_x');
    expect(policyEmails).toContain(email);
  });

  it('Q27: user_invited commits with the INSERT and carries the human actor', async () => {
    const email = freshEmail('audit');
    const r = await invite(email);
    const id = r.json<{ id: string }>().id;
    const { rows } = await db.query<{ meta: Record<string, unknown> }>(
      `SELECT meta FROM account_events WHERE user_id=$1 AND kind='user_invited'`,
      [id],
    );
    expect(rows).toHaveLength(1);
    expect(rows[0].meta).toMatchObject({
      actor_kind: 'user',
      actor_user_id: adminId,
      actor_email: ADMIN,
    });
  });

  // Audit provenance. In production the socket peer is nginx on loopback
  // (client → Cloudflare → cloudflared → nginx → Fastify), so `req.ip`
  // attributed every admin action to 127.0.0.1. actorOf now resolves the
  // address through clientIp(). Asserting the exact value — rather than
  // "not null" — is what makes this fail if the proxy address comes back:
  // 127.0.0.1 is also non-null.
  it('attributes the audit row to the Cf-Connecting-Ip client, not the proxy', async () => {
    const email = freshEmail('ip');
    const r = await app.inject({
      method: 'POST',
      url: '/api/admin/users/invite',
      headers: {
        'cf-access-jwt-assertion': await jwks.mintJwt(ADMIN),
        'x-repos-csrf': '1',
        'cf-connecting-ip': '203.0.113.77',
      },
      payload: { email, role: 'member' },
    });
    expect(r.statusCode).toBe(201);
    const { rows } = await db.query<{ ip: string | null }>(
      `SELECT ip FROM account_events WHERE user_id=$1 AND kind='user_invited'`,
      [r.json<{ id: string }>().id],
    );
    expect(rows[0].ip).toBe('203.0.113.77');
  });

  it('Q27: a Resend failure still leaves the user_invited event committed', async () => {
    mailImpl = async () => {
      throw new mailer.MailerError('mail_http_error', 'nope');
    };
    const email = freshEmail('mailfail');
    const r = await invite(email);
    // 201 even though the mail failed — `created` tracks the row INSERT, not
    // delivery. That separation is the whole reason it exists.
    expect(r.statusCode).toBe(201);
    expect(r.json<{ created: boolean }>().created).toBe(true);
    const id = r.json<{ id: string; invite_sent: boolean }>().id;
    expect(r.json<{ invite_sent: boolean }>().invite_sent).toBe(false);
    const { rows } = await db.query<{ n: number }>(
      `SELECT count(*)::int n FROM account_events WHERE user_id=$1 AND kind='user_invited'`,
      [id],
    );
    expect(rows[0].n).toBe(1);
    // Row keeps invite_sent_at NULL; the user is already in the policy and CAN sign in.
    const u = await db.query<{ invite_sent_at: Date | null; cf_synced_at: Date | null }>(
      `SELECT invite_sent_at, cf_synced_at FROM users WHERE id=$1`,
      [id],
    );
    expect(u.rows[0].invite_sent_at).toBeNull();
    expect(u.rows[0].cf_synced_at).not.toBeNull();
  });
});

describe('CF sync failure on a grant (Q7, Q8)', () => {
  it('leaves the row sync-pending, does NOT roll back, and sends NO email', async () => {
    fetchPolicyImpl = async () => {
      throw new policy.CfPolicyError('cf_http_error', 'down');
    };
    const email = freshEmail('syncfail');
    const r = await invite(email);
    expect(r.statusCode).toBe(201);
    const body = r.json<{
      id: string;
      cf_synced: boolean;
      invite_sent: boolean;
      sync_error: string;
    }>();
    expect(body.cf_synced).toBe(false);
    expect(body.invite_sent).toBe(false);
    expect(body.sync_error).toBe('cf_http_error');
    expect(sentMail).toHaveLength(0);

    const { rows } = await db.query<{ status: string; cf_synced_at: Date | null }>(
      `SELECT status, cf_synced_at FROM users WHERE id=$1`,
      [body.id],
    );
    // Q17b — the row exists and is NOT activatable.
    expect(rows[0].status).toBe('invited');
    expect(rows[0].cf_synced_at).toBeNull();
  });

  it('an app_count breach refuses the same way', async () => {
    fetchPolicyImpl = async () => {
      throw new policy.CfPolicyError('app_count_not_one', 'two apps');
    };
    const r = await invite(freshEmail('appcount'));
    expect(r.json<{ sync_error: string }>().sync_error).toBe('app_count_not_one');
    expect(sentMail).toHaveLength(0);
  });
});

describe('duplicate invite — all five cases (Q29)', () => {
  it('invited + cf_synced_at NULL -> retries the sync, mails only on success, 200 resynced', async () => {
    const email = freshEmail('unsynced');
    await seed(email, 'invited', null);
    const r = await invite(email);
    expect(r.statusCode).toBe(200);
    expect(r.json<{ resynced: boolean }>().resynced).toBe(true);
    expect(policyEmails).toContain(email);
    expect(sentMail).toHaveLength(1);
  });

  it('invited + unsynced + the retry ALSO fails -> no mail at all', async () => {
    const email = freshEmail('unsynced2');
    await seed(email, 'invited', null);
    fetchPolicyImpl = async () => {
      throw new policy.CfPolicyError('cf_timeout', 'slow');
    };
    const r = await invite(email);
    expect(r.statusCode).toBe(200);
    expect(r.json<{ resynced: boolean }>().resynced).toBe(false);
    expect(sentMail).toHaveLength(0);
  });

  it('invited + synced + already delivered -> intentional resend with a FRESH key, 200 resent', async () => {
    const email = freshEmail('synced');
    // invite_sent_at NON-NULL: a delivery is already known to have succeeded,
    // so every further invite is a deliberate second delivery.
    const id = await seed(email, 'invited', new Date(), new Date());
    policyEmails.push(email);
    const first = await invite(email);
    const second = await invite(email);
    expect(first.statusCode).toBe(200);
    expect(first.json<{ resent: boolean }>().resent).toBe(true);
    expect(sentMail).toHaveLength(2);
    expect(sentMail[0].idempotencyKey).not.toBe(sentMail[1].idempotencyKey);
    expect(second.statusCode).toBe(200);
    expect(id).toBeTruthy();
  });

  // Q30's real failure mode: Resend ACCEPTED the initial send but the response
  // never came back, so the row is invited + CF-synced + invite_sent_at NULL.
  // Retrying must reuse the deterministic initial key — that is the only thing
  // that lets Resend collapse the two requests into one delivery.
  it('invited + synced + NEVER delivered -> reuses the INITIAL key, not a fresh one', async () => {
    const email = freshEmail('lostack');
    const id = await seed(email, 'invited', new Date(), null);
    policyEmails.push(email);

    const { rows } = await db.query<{ invited_at: Date }>(
      `SELECT invited_at FROM users WHERE id=$1`,
      [id],
    );
    const expected = initialIdempotencyKey(id, rows[0].invited_at);

    const r = await invite(email);
    // 200, not 201: nothing was created. This is the case that broke when the
    // route inferred freshness from `resent`/`resynced` instead of `created`.
    expect(r.statusCode).toBe(200);
    expect(r.json<{ created: boolean }>().created).toBe(false);
    expect(sentMail).toHaveLength(1);
    expect(sentMail[0].idempotencyKey).toBe(expected);
    // Not a resend — this is the initial delivery finally completing.
    expect(r.json<{ resent: boolean }>().resent).toBe(false);

    // ...and only NOW does a further invite become a genuine resend.
    const again = await invite(email);
    expect(again.json<{ resent: boolean }>().resent).toBe(true);
    expect(sentMail[1].idempotencyKey).not.toBe(expected);
  });

  it('a lost-ack retry by a DIFFERENT admin renders the ORIGINAL inviter', async () => {
    // Admin A invites; Resend ACCEPTS the send but the response is lost, so
    // the row is left invited + synced + invite_sent_at NULL. Admin B then
    // retries. Reusing A's deterministic key with a body naming B is precisely
    // what Resend rejects with 409 invalid_idempotent_request — the key would
    // be dead for 24h and the invite could not complete. The retry must
    // reproduce A's payload, recovered from the durable audit snapshot.
    const adminA = `inv-origadmin-${randomUUID().slice(0, 8)}@repos.test`;
    const { rows: aRows } = await db.query<{ id: string }>(
      `INSERT INTO users (email, role, status) VALUES ($1,'admin','active') RETURNING id`,
      [adminA],
    );
    const email = freshEmail('crossadmin');
    // seed() writes the user_invited snapshot naming Admin A. The sender is
    // replayed from that frozen row, not from invited_by — which is why
    // deleting Admin A below must not change the outcome.
    const id = await seed(email, 'invited', new Date(), null, aRows[0].id, adminA);
    policyEmails.push(email);
    mailImpl = async () => {
      throw new mailer.MailerError('mail_timeout', 'ack lost');
    };
    const { rows } = await db.query<{ invited_at: Date }>(
      `SELECT invited_at FROM users WHERE id=$1`,
      [id],
    );

    await invite(email); // performed by ADMIN — i.e. Admin B

    expect(sentMail).toHaveLength(1);
    expect(sentMail[0].idempotencyKey).toBe(initialIdempotencyKey(id, rows[0].invited_at));
    // The key and the body must belong to the same request.
    expect(sentMail[0].request.html).toContain(adminA);
    expect(sentMail[0].request.html).not.toContain(ADMIN);

    // Deleting the inviter nulls invited_by but cannot touch the audit
    // snapshot, so a later attempt still replays A.
    await db.query(`DELETE FROM users WHERE id=$1`, [aRows[0].id]);
    await invite(email);
    expect(sentMail[1].idempotencyKey).toBe(sentMail[0].idempotencyKey);
    // Byte-identical, not merely "same sender" — that is what Resend collapses.
    expect(sentMail[1].request).toEqual(sentMail[0].request);
  });

  it('an IMPORTED row replays an identical key AND payload on every attempt', async () => {
    // Q31b creates imported rows as invited + synced + invite_sent_at NULL,
    // invited_by NULL, with a SYSTEM-actor user_imported event — so there is
    // no original sender to recover. That is the designed steady state of
    // every imported row, not a deleted-inviter edge case.
    //
    // Two attempts, because one cannot catch the bug this guards: if a lost
    // ack leaves the row untouched, attempt two must still produce the SAME
    // key and the SAME body, or Resend treats it as a new request and delivers
    // a second time.
    const email = freshEmail('imported');
    const id = await seed(email, 'invited', new Date(), null, null, null);
    policyEmails.push(email);
    // The lost ACK has to be simulated, not assumed: Resend accepts the send
    // but the response never arrives, so invite_sent_at is never stamped and
    // the row is byte-for-byte what it was. With the default success stub the
    // first attempt STAMPS invite_sent_at and the second becomes an
    // intentional resend on a fresh key — a different branch that proves
    // nothing about replay.
    mailImpl = async () => {
      throw new mailer.MailerError('mail_timeout', 'ack lost');
    };

    await invite(email);
    const mid = await db.query<{ invite_sent_at: Date | null }>(
      `SELECT invite_sent_at FROM users WHERE id=$1`,
      [id],
    );
    expect(mid.rows[0].invite_sent_at).toBeNull();

    await invite(email); // the retry: nothing about the row changed

    expect(sentMail).toHaveLength(2);
    expect(sentMail[1].idempotencyKey).toBe(sentMail[0].idempotencyKey);
    expect(sentMail[1].request).toEqual(sentMail[0].request);
    // Stable across attempts precisely because it is a constant, not the
    // current admin — who could differ between the two.
    expect(sentMail[0].request.html).toContain(SUPPORT_CONTACT);
  });

  it('an ordinary lost-ack retry also replays identically across two attempts', async () => {
    // The same property for the human-actor shape: the sender comes from the
    // frozen user_invited meta, so repeated attempts cannot drift.
    const email = freshEmail('replay');
    const id = await seed(email, 'invited', new Date(), null);
    policyEmails.push(email);
    mailImpl = async () => {
      throw new mailer.MailerError('mail_timeout', 'ack lost');
    };

    await invite(email);
    const mid = await db.query<{ invite_sent_at: Date | null }>(
      `SELECT invite_sent_at FROM users WHERE id=$1`,
      [id],
    );
    expect(mid.rows[0].invite_sent_at).toBeNull();

    await invite(email);

    expect(sentMail[1].idempotencyKey).toBe(sentMail[0].idempotencyKey);
    expect(sentMail[1].request).toEqual(sentMail[0].request);
  });

  it('Q30: the replay survives a config change between attempts', async () => {
    // The case that forced freezing rather than re-rendering. Attempt one is
    // accepted but its acknowledgement is lost; the deployment then changes
    // INVITE_FROM_EMAIL — a redeploy inside Resend's 24h window. Attempt two
    // must still send byte-identical bytes under the same key, or Resend
    // treats it as a new request and the invitee gets a second email.
    const email = freshEmail('redeploy');
    const id = await seed(email, 'invited', new Date(), null);
    policyEmails.push(email);
    mailImpl = async () => {
      throw new mailer.MailerError('mail_timeout', 'ack lost');
    };

    await invite(email);

    const savedFrom = process.env.INVITE_FROM_EMAIL;
    process.env.INVITE_FROM_EMAIL = 'rotated@send.jpmtech.com';
    try {
      await invite(email);
    } finally {
      if (savedFrom === undefined) delete process.env.INVITE_FROM_EMAIL;
      else process.env.INVITE_FROM_EMAIL = savedFrom;
    }

    expect(sentMail[1].idempotencyKey).toBe(sentMail[0].idempotencyKey);
    expect(sentMail[1].request).toEqual(sentMail[0].request);
    // And the frozen copy is the one that was persisted, not the new config.
    expect(sentMail[1].request.from).not.toContain('rotated@');
    const { rows } = await db.query<{ invite_request: string }>(
      `SELECT invite_request FROM users WHERE id=$1`,
      [id],
    );
    // Stored as TEXT so the bytes survive verbatim — jsonb would reorder keys.
    expect(JSON.parse(rows[0].invite_request)).toEqual(sentMail[0].request);
    // And the audit row is untouched: 060 declares account_events append-only.
    const ev = await db.query<{ meta: Record<string, unknown> }>(
      `SELECT meta FROM account_events WHERE user_id=$1 AND kind='user_invited'`,
      [id],
    );
    expect(ev.rows[0].meta.invite_request).toBeUndefined();
  });

  it('a missing INVITE_FROM_EMAIL leaves the invitation DURABLE and PROVISIONED', async () => {
    // Freezing the request can fail on a config gap, and that failure must
    // cost the invitee nothing but the email. Two orderings are asserted here
    // because getting either one wrong is invisible in the other's assertions:
    //
    //   1. Freezing happens outside the creation transaction, so the row
    //      survives — building it inside would unwind the invitation and
    //      discard admin intent over a config gap.
    //   2. Freezing happens AFTER the CF add and the stamp, so the row is
    //      provisioned — building it before provisionAndMail would return
    //      mail_not_configured with cf_synced_at NULL and the invitee absent
    //      from the policy, unable to sign in over a mail-side failure. Q7
    //      orders this sync → stamp → email, and Q29 leans on it: the retry
    //      branch keys off cf_synced_at, so a stranded NULL also mislabels the
    //      next attempt as a re-provision.
    const email = freshEmail('nofrom');
    // This case needs the INSERT path, so it needs headroom under the cohort
    // cap. Every fresh invite above adds a counted row and the seeds add more,
    // so by this point the table is well past 10 and the request would 409 on
    // the cap before it ever reached the freeze — asserting the config gap
    // against a cap breach that never exercises it. Same prune idiom the cap
    // describe uses.
    await db.query(`DELETE FROM users WHERE email <> $1`, [ADMIN]);
    const savedFrom = process.env.INVITE_FROM_EMAIL;
    delete process.env.INVITE_FROM_EMAIL;
    let r;
    try {
      r = await invite(email);
    } finally {
      if (savedFrom !== undefined) process.env.INVITE_FROM_EMAIL = savedFrom;
    }

    expect(r.statusCode).toBe(201);
    const body = r.json<{ invite_sent: boolean; mail_error: string | null; cf_synced: boolean }>();
    expect(body.invite_sent).toBe(false);
    expect(body.mail_error).toBe('mail_not_configured');
    expect(sentMail).toHaveLength(0);
    // The CF add ran to completion before the freeze was even attempted.
    expect(body.cf_synced).toBe(true);
    expect(policyEmails).toContain(email);

    const { rows } = await db.query<{
      status: string;
      invite_sent_at: Date | null;
      cf_synced_at: Date | null;
    }>(`SELECT status, invite_sent_at, cf_synced_at FROM users WHERE lower(email)=$1`, [email]);
    expect(rows).toHaveLength(1);
    expect(rows[0].status).toBe('invited');
    expect(rows[0].invite_sent_at).toBeNull();
    expect(rows[0].cf_synced_at).not.toBeNull();
  });

  it('fails closed when the durable provenance is missing entirely', async () => {
    // Q27 guarantees exactly one user_invited/user_imported event per invited
    // row. If it is absent the original body cannot be reproduced, so reusing
    // the original key would pair it with a guessed payload — the 409 this
    // machinery exists to avoid, hidden behind a plausible send. Refuse.
    const email = freshEmail('noprov');
    const id = await seed(email, 'invited', new Date(), null);
    await db.query(`DELETE FROM account_events WHERE user_id=$1`, [id]);
    policyEmails.push(email);

    const r = await invite(email);
    expect(r.statusCode).toBe(500);
    expect(r.json<{ error: string }>().error).toBe('invite_provenance_invalid');
    expect(sentMail).toHaveLength(0);
  });

  it('fails closed on a user_invited carrying the wrong actor shape', async () => {
    // A system-shaped user_invited has no actor_email. Defaulting it to the
    // support constant would send a body that never matches the original.
    const email = freshEmail('badshape');
    const id = await seed(email, 'invited', new Date(), null);
    await db.query(`UPDATE account_events SET meta=$2::jsonb WHERE user_id=$1`, [
      id,
      JSON.stringify(systemActor('cf_reconciliation', 'cutover')),
    ]);
    policyEmails.push(email);

    const r = await invite(email);
    expect(r.statusCode).toBe(500);
    expect(sentMail).toHaveLength(0);
  });

  it('an unsynced retry whose mail never landed also reuses the INITIAL key', async () => {
    const email = freshEmail('unsyncedkey');
    const id = await seed(email, 'invited', null, null);
    const { rows } = await db.query<{ invited_at: Date }>(
      `SELECT invited_at FROM users WHERE id=$1`,
      [id],
    );
    await invite(email);
    expect(sentMail[0].idempotencyKey).toBe(initialIdempotencyKey(id, rows[0].invited_at));
  });

  it('active -> 409 already_active', async () => {
    const email = freshEmail('active');
    await seed(email, 'active', new Date());
    const r = await invite(email);
    expect(r.statusCode).toBe(409);
    expect(r.json<{ error: string }>().error).toBe('already_active');
  });

  it('suspended -> 409 suspended_use_reinstate', async () => {
    const email = freshEmail('susp');
    await seed(email, 'suspended', new Date());
    const r = await invite(email);
    expect(r.statusCode).toBe(409);
    expect(r.json<{ error: string }>().error).toBe('suspended_use_reinstate');
  });

  it('deleting -> 409 deletion_in_progress', async () => {
    const email = freshEmail('del');
    await seed(email, 'deleting', null);
    const r = await invite(email);
    expect(r.statusCode).toBe(409);
    expect(r.json<{ error: string }>().error).toBe('deletion_in_progress');
  });

  it('never surfaces a raw UNIQUE violation as a 500', async () => {
    const email = freshEmail('uniq');
    await seed(email, 'active', new Date());
    const r = await invite(email);
    expect(r.statusCode).not.toBe(500);
  });
});

describe('cohort cap (Q12, Q18)', () => {
  async function fillTo(n: number): Promise<void> {
    const { rows } = await db.query<{ c: number }>(
      `SELECT count(*)::int c FROM users WHERE status IN ('active','invited','deleting')`,
    );
    for (let i = rows[0].c; i < n; i++) {
      await db.query(`INSERT INTO users (email, status) VALUES ($1,'active')`, [
        freshEmail(`fill${i}`),
      ]);
    }
  }

  it('409 with the current count, counted as active+invited+deleting', async () => {
    await db.query(`DELETE FROM users WHERE email <> $1`, [ADMIN]);
    await fillTo(10);
    const r = await invite(freshEmail('over'));
    expect(r.statusCode).toBe(409);
    const body = r.json<{ error: string; count: number; cap: number }>();
    expect(body.error).toBe('cohort_cap_reached');
    expect(body.count).toBe(10);
    expect(body.cap).toBe(10);
  });

  it('a deleting row still occupies its slot', async () => {
    await db.query(`DELETE FROM users WHERE email <> $1`, [ADMIN]);
    await fillTo(9);
    await db.query(`INSERT INTO users (email, status) VALUES ($1,'deleting')`, [
      freshEmail('pending'),
    ]);
    const r = await invite(freshEmail('blocked'));
    expect(r.statusCode).toBe(409);
  });

  it('a suspended row does NOT occupy a slot', async () => {
    await db.query(`DELETE FROM users WHERE email <> $1`, [ADMIN]);
    await fillTo(9);
    await db.query(`INSERT INTO users (email, status) VALUES ($1,'suspended')`, [
      freshEmail('susp'),
    ]);
    const r = await invite(freshEmail('allowed'));
    expect(r.statusCode).toBe(201);
  });

  it('the 10th and 11th fired concurrently yield exactly one 201 and one 409', async () => {
    await db.query(`DELETE FROM users WHERE email <> $1`, [ADMIN]);
    await fillTo(9);
    const [a, b] = await Promise.all([invite(freshEmail('c1')), invite(freshEmail('c2'))]);
    const codes = [a.statusCode, b.statusCode].sort();
    expect(codes).toEqual([201, 409]);
    const { rows } = await db.query<{ c: number }>(
      `SELECT count(*)::int c FROM users WHERE status IN ('active','invited','deleting')`,
    );
    expect(rows[0].c).toBe(10);
  });
});

describe('auth (Q20)', () => {
  it('rejects X-Admin-Key', async () => {
    const saved = process.env.ADMIN_API_KEY;
    process.env.ADMIN_API_KEY = 'k';
    try {
      const r = await app.inject({
        method: 'POST',
        url: '/api/admin/users/invite',
        headers: { 'x-admin-key': 'k', 'x-repos-csrf': '1' },
        payload: { email: freshEmail('key'), role: 'member' },
      });
      expect(r.statusCode).toBe(403);
    } finally {
      if (saved === undefined) delete process.env.ADMIN_API_KEY;
      else process.env.ADMIN_API_KEY = saved;
    }
  });

  it('403s a CF-Access member', async () => {
    const member = freshEmail('member');
    await seed(member, 'active', new Date());
    const r = await app.inject({
      method: 'POST',
      url: '/api/admin/users/invite',
      headers: { 'cf-access-jwt-assertion': await jwks.mintJwt(member), 'x-repos-csrf': '1' },
      payload: { email: freshEmail('x'), role: 'member' },
    });
    expect(r.statusCode).toBe(403);
  });

  it('400s an invalid email', async () => {
    const r = await invite('not-an-email');
    expect(r.statusCode).toBe(400);
  });
});

describe('POST /api/admin/users/:id/resend-invite (Q29)', () => {
  async function resend(id: string) {
    return app.inject({
      method: 'POST',
      url: `/api/admin/users/${id}/resend-invite`,
      headers: {
        'cf-access-jwt-assertion': await jwks.mintJwt(ADMIN),
        'x-repos-csrf': '1',
      },
    });
  }

  it('completes a never-delivered invite under the INITIAL key', async () => {
    const email = freshEmail('resendok');
    const id = await seed(email, 'invited', new Date(), null);
    policyEmails.push(email);
    const { rows } = await db.query<{ invited_at: Date }>(
      `SELECT invited_at FROM users WHERE id=$1`,
      [id],
    );

    const r = await resend(id);
    expect(r.statusCode).toBe(200);
    const body = r.json<{ id: string; created: boolean; invite_sent: boolean }>();
    // Resend can NEVER create — that is the whole point of the branch it takes.
    expect(body.created).toBe(false);
    expect(body.id).toBe(id);
    expect(body.invite_sent).toBe(true);
    expect(sentMail).toHaveLength(1);
    expect(sentMail[0].idempotencyKey).toBe(initialIdempotencyKey(id, rows[0].invited_at));
  });

  it('404s an unknown id without creating anything', async () => {
    const before = await db.query<{ c: number }>(`SELECT count(*)::int c FROM users`);
    const r = await resend(randomUUID());
    expect(r.statusCode).toBe(404);
    expect(r.json<{ error: string }>().error).toBe('user_not_found');
    expect(sentMail).toHaveLength(0);
    const after = await db.query<{ c: number }>(`SELECT count(*)::int c FROM users`);
    expect(after.rows[0].c).toBe(before.rows[0].c);
  });

  it('cannot resurrect a user deleted while it waited for the membership lock', async () => {
    // The resurrection window. Resolving the id to an email OUTSIDE the lock
    // and then handing that email to the creation-capable invite path means a
    // deletion that commits while the resend is queued is undone by it: the
    // in-lock lookup finds no row for that address, falls through to the cap
    // check, and INSERTs a NEW row for the deleted identity — provisioned in
    // Cloudflare and mailed, under a fresh id the admin never asked for.
    //
    // The lock is what makes this deterministic rather than a timing test:
    // hold it, let the resend block in acquisition, delete the row, release.
    // Whatever the resend reads, it reads after the deletion has committed.
    // Headroom under the cohort cap. Without it the resurrecting INSERT is
    // refused by the cap instead of the fix, so the test would pass for a
    // reason that has nothing to do with resolving the id inside the lock.
    await db.query(`DELETE FROM users WHERE email <> $1`, [ADMIN]);
    const email = freshEmail('resurrect');
    const id = await seed(email, 'invited', new Date(), null);
    policyEmails.push(email);

    let release!: () => void;
    const holding = new Promise<void>((r) => {
      release = r;
    });
    const lockHeld = withMembershipLock(async () => {
      await holding;
    });
    await new Promise((r) => setTimeout(r, 60));

    const pending = resend(id);
    await new Promise((r) => setTimeout(r, 60));
    await db.query(`DELETE FROM users WHERE id=$1`, [id]);
    release();
    await lockHeld;

    const r = await pending;
    expect(r.statusCode).toBe(404);
    expect(sentMail).toHaveLength(0);
    // The identity stays deleted, and no replacement row wears its address.
    // (No assertion on policyEmails: this test seeds the address into the
    // policy itself, to model a row whose cf_synced_at is set, so
    // `not.toContain` would be false by construction and `toContain` true
    // regardless of the outcome. The row count is what actually discriminates.)
    const { rows } = await db.query<{ id: string }>(`SELECT id FROM users WHERE lower(email)=$1`, [
      email,
    ]);
    expect(rows).toHaveLength(0);
  });
});

describe('invite_at provenance (Q30)', () => {
  it('a null invited_at fails closed on BOTH attempts instead of minting a key each time', async () => {
    // invited_at is nullable, so this row is representable. The initial key is
    // derived from it, and defaulting a missing one to `new Date()` mints a
    // DIFFERENT key per attempt — which is the unbounded-resend failure Q30
    // forbids, not a graceful degradation: a lost ack leaves the row
    // untouched, so every retry looks new to Resend and delivers again.
    //
    // Two attempts, because one cannot see it. A single attempt succeeds
    // either way; only the second reveals that the "retry" was a fresh
    // delivery under a fresh key.
    const email = freshEmail('noinvitedat');
    const id = await seed(email, 'invited', new Date(), null);
    await db.query(`UPDATE users SET invited_at = NULL WHERE id=$1`, [id]);
    policyEmails.push(email);

    const first = await invite(email);
    expect(first.statusCode).toBe(500);
    expect(first.json<{ error: string }>().error).toBe('invite_provenance_invalid');

    const second = await invite(email);
    expect(second.statusCode).toBe(500);
    expect(second.json<{ error: string }>().error).toBe('invite_provenance_invalid');

    // Nothing reached the wire on either attempt. Under the defaulting
    // behaviour this would be two sends carrying two different keys.
    expect(sentMail).toHaveLength(0);
    const { rows } = await db.query<{ invite_sent_at: Date | null }>(
      `SELECT invite_sent_at FROM users WHERE id=$1`,
      [id],
    );
    expect(rows[0].invite_sent_at).toBeNull();
  });

  it('a deliberate resend of an already-delivered row does NOT need invited_at', async () => {
    // The guard is scoped to the replay path on purpose. Once a delivery has
    // succeeded the key comes from the id alone, so a null invited_at cannot
    // affect it — refusing here would block a legitimate resend for a value
    // the operation never reads.
    const email = freshEmail('nullsent');
    const id = await seed(email, 'invited', new Date(), new Date());
    await db.query(`UPDATE users SET invited_at = NULL WHERE id=$1`, [id]);
    policyEmails.push(email);

    const r = await invite(email);
    expect(r.statusCode).toBe(200);
    expect(r.json<{ resent: boolean }>().resent).toBe(true);
    expect(sentMail).toHaveLength(1);
  });
});
