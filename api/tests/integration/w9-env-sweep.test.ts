// The two env vars W9 removes must be read NOWHERE. A stale reader would
// reintroduce exactly the redeploy coupling this wave exists to remove.
//
// The patterns below are anchored on the READ, never on the bare name:
// migration 080's mapping header, the cfAccess.ts replacement comment and
// bootstrap-guards.ts all cite the removed variables on purpose, to record
// what replaced them. A bare-name assertion would force deleting that history
// to go green.
import { describe, it, expect } from 'vitest';
import { readdir, readFile, stat } from 'node:fs/promises';
import { join } from 'node:path';

const REMOVED = 'CF_ACCESS_ALLOWED_EMAILS|REPOS_ADMIN_EMAILS';

/** `process.env.X` and `process.env['X']` — both real read forms in this repo. */
const JS_READ = new RegExp(`process\\.env(\\.|\\[['"\`])(${REMOVED})`);
/** `$X` / `${X}` — the shell read form, for the container's s6 scripts. */
const SH_READ = new RegExp(`\\$\\{?(${REMOVED})\\b`);

const SCANNED_EXTENSIONS = /\.(ts|tsx|mjs|sql|sh|md|yml|yaml|conf)$/;

/**
 * Extensionless files are scanned too. `docker/root/etc/s6-overlay/scripts/*`
 * (init-migrations, run-api, wait-for-postgres…) and `docker/Dockerfile` carry
 * no extension, and those are precisely the files that plumb an env var into
 * the container — an extension allowlist alone would skip every one of them.
 */
function shouldScan(name: string): boolean {
  return SCANNED_EXTENSIONS.test(name) || !name.includes('.');
}

async function walk(dir: string, out: string[] = []): Promise<string[]> {
  for (const e of await readdir(dir)) {
    if (e === 'node_modules' || e === 'dist' || e === '.git') continue;
    const p = join(dir, e);
    if ((await stat(p)).isDirectory()) await walk(p, out);
    else if (shouldScan(e)) out.push(p);
  }
  return out;
}

const ROOTS = ['api/src', 'api/tests', 'frontend/src', 'docker', 'scripts'];
const repoRoot = join(process.cwd(), '..');

async function scanAll(): Promise<{ files: string[]; offenders: string[] }> {
  const files: string[] = [];
  const offenders: string[] = [];
  for (const root of ROOTS) {
    for (const f of await walk(join(repoRoot, root)).catch(() => [] as string[])) {
      files.push(f);
      const body = await readFile(f, 'utf8');
      if (JS_READ.test(body) || (SH_READ.test(body) && !f.endsWith('.md'))) offenders.push(f);
    }
  }
  return { files, offenders };
}

describe('W9 env-var removal is complete', () => {
  it('no source file READS CF_ACCESS_ALLOWED_EMAILS or REPOS_ADMIN_EMAILS', async () => {
    const { offenders } = await scanAll();
    expect(offenders).toEqual([]);
  });

  // `expect([]).toEqual([])` is also what a sweep that scanned NOTHING returns.
  // These assertions prove the sweep reached the tree it claims to police —
  // including the extensionless container scripts, which the obvious
  // extension-allowlist implementation silently skips.
  it('the sweep actually reaches the files it claims to cover', async () => {
    const { files } = await scanAll();
    expect(files.length).toBeGreaterThan(200);
    for (const expected of [
      'api/src/middleware/cfAccess.ts',
      'frontend/src/lib/api/adminUsers.ts',
      'docker/root/etc/s6-overlay/scripts/run-api',   // extensionless
      'docker/Dockerfile',                             // extensionless
      'scripts/run-restore.sh',
    ]) {
      expect(files.some((f) => f.endsWith(expected)), `never scanned ${expected}`).toBe(true);
    }
  });

  // The history mentions must SURVIVE the sweep — if they ever start failing
  // it, the patterns have stopped being anchored on the read.
  it('deliberate history mentions are not offenders', async () => {
    const { offenders } = await scanAll();
    for (const historical of [
      'api/src/db/migrations/080_users_roles_status.sql',
      'api/src/middleware/cfAccess.ts',
      'api/src/bootstrap-guards.ts',
    ]) {
      const body = await readFile(join(repoRoot, historical), 'utf8');
      expect(body).toMatch(new RegExp(REMOVED));                 // still records it
      expect(offenders.some((f) => f.endsWith(historical))).toBe(false);
    }
  });

  // The reader sweep matches read syntax in code files, so it can never catch
  // the tracked env template — `.env.example` declares rather than reads.
  // Assert it separately or the template keeps advertising both removed vars
  // to every future operator.
  it('api/.env.example advertises the five new vars and neither removed one', async () => {
    const tpl = await readFile(join(process.cwd(), '.env.example'), 'utf8');
    expect(tpl).not.toMatch(/CF_ACCESS_ALLOWED_EMAILS/);
    expect(tpl).not.toMatch(/REPOS_ADMIN_EMAILS/);
    for (const v of [
      'CF_API_TOKEN', 'CF_ACCOUNT_ID', 'CF_ACCESS_POLICY_ID',
      'RESEND_API_KEY', 'INVITE_FROM_EMAIL',
    ]) {
      expect(tpl).toContain(v);
    }
  });
});
