// Q35 — DR-level. Every schema-entry path must yield a working admin.
import 'dotenv/config';
import { describe, it, expect, afterAll, vi } from 'vitest';
import pg from 'pg';
import { existsSync } from 'node:fs';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createEphemeralDb } from '../helpers/ephemeral-db.js';
import { unwindToPreW9 } from '../helpers/migration-unwind.js';
import { runMigrations } from '../../src/db/runMigrations.js';
import { FOUNDING_ADMIN_EMAIL } from '../../src/constants/users.js';

const cleanups: Array<() => Promise<void>> = [];
// LIFO, not FIFO. preO80Database registers `pool.end(); eph.drop()` first, and
// cases (b)–(d) later register the app / singleton-db teardown against that
// same database. Draining in registration order would DROP DATABASE while the
// app's pool still holds connections to it, which Postgres refuses with
// "database is being accessed by other users".
afterAll(async () => {
  for (const c of cleanups.reverse()) await c();
});

/**
 * Reconstruct a pre-W9 database: full schema, then unwind EVERY migration this
 * wave adds — 080, 081 and 082.
 *
 * The unwind itself lives in `tests/helpers/migration-unwind.ts` and is shared
 * with `tests/db/migration-080.test.ts`. It was a per-file copy twice and was
 * incomplete both times: the first left 081's `_migrations` row applied, the
 * second left 082's. Either way the re-run skips that file and the test quietly
 * stops covering it, while still reading as though it covered everything. A
 * real pre-080 dump contains none of the three, and the whole point of this
 * harness is to be indistinguishable from one.
 *
 * `migration-082.test.ts` asserts the helper is complete — it unwinds, re-runs,
 * and requires all three filenames back in the applied list. Extend the helper
 * when the range grows; do not fork it.
 *
 * Returns the URL alongside the pool because cases (b)–(d) must point
 * `DATABASE_URL` at THIS database before importing the singleton db client.
 */
async function preO80Database(tag: string): Promise<{ pool: pg.Pool; url: string }> {
  const eph = await createEphemeralDb(tag);
  const pool = new pg.Pool({ connectionString: eph.url, max: 3 });
  cleanups.push(async () => {
    await pool.end();
    await eph.drop();
  });
  await runMigrations(pool);
  // The ONE unwind (tests/helpers/migration-unwind.ts) — do not inline a copy.
  // It drops 082's trigger and function before the columns they depend on, and
  // re-arms all three W9 migrations; an inlined 080/081-only version fails on
  // `DROP COLUMN status` because the trigger still references it.
  await unwindToPreW9(pool);
  return { pool, url: eph.url };
}

describe('restore of a pre-080 dump (Q35)', () => {
  it('(a) migrations alone, with NO Cloudflare, yield an active admin', async () => {
    const { pool } = await preO80Database('dr-a');
    await pool.query(`INSERT INTO users (email) VALUES ('beta.user@repos.test')`);
    // No CF_API_TOKEN is set anywhere in this test — that is the point.
    await runMigrations(pool);
    const { rows } = await pool.query<{ email: string }>(
      `SELECT email FROM users WHERE role='admin' AND status='active'`,
    );
    expect(rows).toHaveLength(1);
    expect(rows[0].email).toBe(FOUNDING_ADMIN_EMAIL);

    // BOTH W9 migrations re-applied, not just 080. Without this the harness
    // could silently stop unwinding 081 — the restore would still yield an
    // admin, the test would still pass, and the invite path would come back up
    // missing the column its Q30 replay depends on.
    const cols = await pool.query<{ column_name: string }>(
      `SELECT column_name FROM information_schema.columns
        WHERE table_name='users' AND column_name IN ('status','invite_request')`,
    );
    expect(cols.rows.map((r) => r.column_name).sort()).toEqual(['invite_request', 'status']);
  });

  it('(b) that admin can clear maintenance — the lockout scenario is closed', async () => {
    // This is the whole point of the wave's DR story, so it EXERCISES the
    // endpoint. Asserting role/status off a SELECT only restates migration
    // 080; it cannot catch a gate that rejects the row for some other reason
    // (a stale allowlist read, the Q17b precondition applied too broadly, a
    // non-async preHandler that hangs). Boot the app and clear the flag.
    const { pool, url } = await preO80Database('dr-b');
    await runMigrations(pool);

    // Capture BEFORE overwriting. Reading it after the assignment below just
    // hands back the temp path, so cleanup would "restore" the env to a flag
    // file that the negative case leaves on disk — every later suite in this
    // process would then boot into maintenance mode.
    const savedFlagPath = process.env.MAINTENANCE_FLAG_PATH;

    // Keep the directory, not just the file: cleanup below removes the whole
    // temp dir. Deleting only the flag leaks one empty /tmp/repos-dr-* per run.
    const flagDir = await mkdtemp(join(tmpdir(), 'repos-dr-'));
    const flag = join(flagDir, 'maintenance.flag');
    await writeFile(flag, 'restore in progress');
    process.env.MAINTENANCE_FLAG_PATH = flag;

    // Fresh module registry so app.js and client.js bind to THIS database
    // rather than a pool cached by an earlier case.
    vi.resetModules();
    process.env.DATABASE_URL = url;
    const { buildApp } = await import('../../src/app.js');
    const { db } = await import('../../src/db/client.js');
    const { setupTestJwks } = await import('../helpers/cf-access-jwt.js');

    const jwks = await setupTestJwks();
    const app = await buildApp();

    // CRITICAL: requireAdminKeyOrCfAccess short-circuits to authMode='admin'
    // and returns WITHOUT looking at the JWT whenever ADMIN_API_KEY is unset
    // (api/src/middleware/cfAccess.ts — the "dev / test: open admin path"
    // branch). Leaving it unset makes this test pass for a database with no
    // admin at all, which is precisely the regression it exists to catch.
    // Set it, send NO x-admin-key, and the gate is forced down the CF Access
    // path where the founding admin's role is actually resolved.
    const savedAdminKey = process.env.ADMIN_API_KEY;
    process.env.ADMIN_API_KEY = 'dr-guard-key';
    cleanups.push(async () => {
      if (savedAdminKey === undefined) delete process.env.ADMIN_API_KEY;
      else process.env.ADMIN_API_KEY = savedAdminKey;
      // Restore the ORIGINAL path (captured before the overwrite) and delete
      // the temp flag the negative case deliberately left in place, so no
      // later suite can pick up either. Remove the whole mkdtemp directory,
      // not just the flag inside it.
      if (savedFlagPath === undefined) delete process.env.MAINTENANCE_FLAG_PATH;
      else process.env.MAINTENANCE_FLAG_PATH = savedFlagPath;
      await rm(flagDir, { recursive: true, force: true });
      await app.close();
      await db.end();
      await jwks.teardown();
    });

    const r = await app.inject({
      method: 'POST',
      url: '/api/maintenance/clear',
      headers: {
        'cf-access-jwt-assertion': await jwks.mintJwt(FOUNDING_ADMIN_EMAIL),
        'x-repos-csrf': '1',
      },
    });
    expect(r.statusCode).toBe(204);
    expect(existsSync(flag)).toBe(false);

    // Prove the gate was really exercised rather than bypassed: the same
    // request from a non-admin identity must be refused. If ADMIN_API_KEY
    // were unset, this would also return 204 and the assertion above would be
    // meaningless.
    await writeFile(flag, 'restore in progress');
    await db.query(
      `INSERT INTO users (email, role, status) VALUES ('member.dr@repos.test','member','active')`,
    );
    const denied = await app.inject({
      method: 'POST',
      url: '/api/maintenance/clear',
      headers: {
        'cf-access-jwt-assertion': await jwks.mintJwt('member.dr@repos.test'),
        'x-repos-csrf': '1',
      },
    });
    expect(denied.statusCode).toBe(403);
    expect(denied.json<{ error: string }>().error).toBe('not_an_admin');
    expect(existsSync(flag)).toBe(true);

    // No Cloudflare was consulted to get here — the row is unstamped and the
    // clear still worked. That is the property the lockout regression needs.
    const { rows } = await db.query<{ cf_synced_at: Date | null }>(
      `SELECT cf_synced_at FROM users WHERE lower(email)=$1`,
      [FOUNDING_ADMIN_EMAIL],
    );
    expect(rows[0].cf_synced_at).toBeNull();
    void pool;
  });

  it('(c) the CF reconciliation reconstructs the CF-only invite', async () => {
    const eph = await createEphemeralDb('dr-c');
    const pool = new pg.Pool({ connectionString: eph.url, max: 3 });
    cleanups.push(async () => {
      await pool.end();
      await eph.drop();
    });
    await runMigrations(pool);

    // vi.resetModules() BEFORE setting DATABASE_URL and importing: db/client.js
    // is a singleton that reads the URL once at module evaluation. Without a
    // registry reset the dynamic import below returns whatever pool an earlier
    // case already built, so this case would silently reconcile the WRONG
    // database while asserting against this one.
    vi.resetModules();
    process.env.DATABASE_URL = eph.url;
    const policy = await import('../../src/services/cfAccessPolicy.js');
    const { reconcileCfBaseline } = await import('../../src/services/cfReconcile.js');
    const { db } = await import('../../src/db/client.js');
    cleanups.push(async () => {
      await db.end();
    });

    // `emails` is DERIVED from config.include by toSnapshot, so a fixture must
    // keep the two agreeing — an empty include[] beside a populated emails[] is
    // a shape fetchPolicy can never return, and would hide a bug in any code
    // that reads config instead of emails.
    const restoredEmails = [FOUNDING_ADMIN_EMAIL, 'thesugardog@repos.test'];
    vi.spyOn(policy, 'fetchPolicy').mockResolvedValue({
      emails: restoredEmails,
      name: 'Owner Only',
      decision: 'allow',
      config: {
        name: 'Owner Only',
        decision: 'allow',
        include: restoredEmails.map((e) => ({ email: { email: e } })),
        exclude: [],
        require: [],
      },
    } as never);

    const r = await reconcileCfBaseline('restore');
    expect(r.imported).toEqual(['thesugardog@repos.test']);
    const { rows } = await db.query<{ status: string; cf_synced_at: Date | null }>(
      `SELECT status, cf_synced_at FROM users WHERE email='thesugardog@repos.test'`,
    );
    expect(rows[0].status).toBe('invited');
    expect(rows[0].cf_synced_at).not.toBeNull();
    const ev = await db.query<{ meta: Record<string, unknown> }>(
      `SELECT ae.meta FROM account_events ae
         JOIN users u ON u.id = ae.user_id
        WHERE u.email='thesugardog@repos.test' AND ae.kind='user_imported'`,
    );
    expect(ev.rows[0].meta).toMatchObject({ actor_kind: 'system', source: 'restore' });
    vi.restoreAllMocks();
  });

  it('(d) a reconciliation failure leaves the restored data valid and the failure visible', async () => {
    const eph = await createEphemeralDb('dr-d');
    const pool = new pg.Pool({ connectionString: eph.url, max: 3 });
    cleanups.push(async () => {
      await pool.end();
      await eph.drop();
    });
    await runMigrations(pool);
    await pool.query(`INSERT INTO users (email, status) VALUES ('kept@repos.test','active')`);

    // Same reason as case (c): without the reset this would run against dr-c's
    // cached pool and pass vacuously while asserting against dr-d.
    vi.resetModules();
    process.env.DATABASE_URL = eph.url;
    const policy = await import('../../src/services/cfAccessPolicy.js');
    const { reconcileCfBaseline, ReconcileAbort } =
      await import('../../src/services/cfReconcile.js');
    const { db } = await import('../../src/db/client.js');
    cleanups.push(async () => {
      await db.end();
    });
    vi.spyOn(policy, 'fetchPolicy').mockRejectedValue(
      new policy.CfPolicyError('app_count_not_one', 'attached to two apps'),
    );

    await expect(reconcileCfBaseline('restore')).rejects.toBeInstanceOf(ReconcileAbort);

    // The data restore itself is valid — nothing was rolled back or dropped.
    const { rows } = await pool.query<{ n: number }>(`SELECT count(*)::int n FROM users`);
    expect(rows[0].n).toBe(2); // founding admin + kept@
    const admin = await pool.query<{ n: number }>(
      `SELECT count(*)::int n FROM users WHERE role='admin' AND status='active'`,
    );
    expect(admin.rows[0].n).toBe(1);
    vi.restoreAllMocks();
  });
});
